/*
 * HearMe vehicle beacon - ESP32-C3 + NMEA GNSS module.
 *
 *  - GNSS (TinyGPSPlus) on UART1: RX GPIO20, TX GPIO21, 9600 baud
 *  - every 100 ms: dead-reckoned position (1 Hz fixes + GNSS speed/course),
 *    HearMe packet via ../protocol/c/hearme_packet.h, non-connectable BLE advertising
 *    with raw manufacturer data (company 0xFFFF), TX power +9 dBm
 *  - rolling ID regenerated every 10-minute epoch from a device secret
 *  - ignition sense GPIO3 / no motion -> parked: advertising off, light sleep with periodic wake
 *  - status LED GPIO8
 *
 * Configuration via build flags (see platformio.ini):
 *   HEARME_VEHICLE_TYPE, HEARME_FLEET_KEY_HEX, HEARME_DEVICE_SECRET, HEARME_BUS_ROUTE,
 *   HEARME_BUS_DOOR, HEARME_TX_POWER, HEARME_IGNITION_SENSE, HEARME_IGN_PULLUP, HEARME_LED_RGB
 *
 * Privacy: the BLE advertiser address is a static random address derived from the
 * device secret and the epoch (HMAC "HMad"||epoch), so it rotates together with the
 * rolling ID and the two can't be linked across epochs.
 */
#include <Arduino.h>
#include <NimBLEDevice.h>
#include <TinyGPSPlus.h>
#include <esp_sleep.h>
#include <driver/gpio.h>
#include <math.h>

#include "hearme_packet.h"

extern "C" int ble_hs_id_set_rnd(const uint8_t *rnd_addr);  // NimBLE host (host/ble_hs_id.h)

#ifndef HEARME_VEHICLE_TYPE
#define HEARME_VEHICLE_TYPE HM_E_BIKE
#endif
#ifndef HEARME_FLEET_KEY_HEX
#define HEARME_FLEET_KEY_HEX "4865617224d650a1c3e79f0b8a2d5e6f1b3c4d5e6f708192a3b4c5d6e7f80910"
#endif
#ifndef HEARME_BUS_ROUTE
#define HEARME_BUS_ROUTE ""
#endif
#ifndef HEARME_BUS_DOOR
#define HEARME_BUS_DOOR HM_DOOR_UNKNOWN
#endif
#ifndef HEARME_TX_POWER
#define HEARME_TX_POWER ESP_PWR_LVL_P9
#endif
#ifndef HEARME_IGNITION_SENSE
#define HEARME_IGNITION_SENSE 1
#endif
#ifndef HEARME_IGN_PULLUP
#define HEARME_IGN_PULLUP 0  // 0: external divider + pull-down (schematic); 1: bench, pin unwired
#endif
#ifndef HEARME_LED_RGB
#define HEARME_LED_RGB 1
#endif

static const int PIN_GPS_RX = 20, PIN_GPS_TX = 21, PIN_IGNITION = 3, PIN_LED = 8;
static const uint32_t ADV_PERIOD_MS = 100;
static const uint32_t NO_MOTION_PARK_MS = 120000;  // stationary this long -> parked
static const float MOVING_MPS = 0.5f;
static const uint64_t SLEEP_US = 5ULL * 1000000ULL; // light-sleep period while parked
static const uint32_t AWAKE_CHECK_MS = 1500;        // listen to GNSS this long after each wake

static TinyGPSPlus gps;
static HardwareSerial GPSSerial(1);
static NimBLEAdvertising *adv = nullptr;

static uint8_t fleet_key[64];
static size_t fleet_key_len = 0;
static uint8_t device_secret[32];
static size_t device_secret_len = 0;

// last fix (for dead reckoning)
static double fix_lat = 0, fix_lon = 0;
static double fix_speed = -1, fix_course = -1;  // -1 = unknown
static uint32_t fix_ms = 0;
static bool have_fix = false;
static int64_t unix_at_sync = 0;                // GNSS UTC time
static uint32_t ms_at_sync = 0;
static bool have_time = false;

static uint32_t last_motion_ms = 0;
static uint32_t cur_epoch = 0xFFFFFFFF;
static uint8_t rolling_id[4];
static bool advertising = false;

// ------------------------------------------------------------------ helpers
static size_t parse_hex(const char *s, uint8_t *out, size_t cap) {
  size_t n = 0;
  auto hv = [](char c) -> int {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  };
  while (s[0] && s[1] && n < cap && hv(s[0]) >= 0 && hv(s[1]) >= 0) {
    out[n++] = (uint8_t)(hv(s[0]) * 16 + hv(s[1]));
    s += 2;
  }
  return n;
}

static void led(uint8_t r, uint8_t g, uint8_t b) {
#if HEARME_LED_RGB
  neopixelWrite(PIN_LED, r, g, b);
#else
  digitalWrite(PIN_LED, (r | g | b) ? HIGH : LOW);
#endif
}

static int64_t days_from_civil(int y, unsigned m, unsigned d) {  // H. Hinnant
  y -= m <= 2;
  const int64_t era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + (int64_t)doe - 719468;
}

static double now_unix() {
  if (have_time) return (double)unix_at_sync + (millis() - ms_at_sync) / 1000.0;
  return millis() / 1000.0;  // no GNSS time yet: MACs will not verify (receivers still warn)
}

static bool ignition_on() {
#if HEARME_IGNITION_SENSE
  return digitalRead(PIN_IGNITION) == HIGH;
#else
  return true;
#endif
}

// ------------------------------------------------------------------ GNSS
static void poll_gps() {
  while (GPSSerial.available()) {
    if (!gps.encode((char)GPSSerial.read())) continue;
    if (gps.location.isUpdated() && gps.location.isValid()) {
      fix_lat = gps.location.lat();
      fix_lon = gps.location.lng();
      fix_ms = millis() - gps.location.age();
      have_fix = true;
      fix_speed = gps.speed.isValid() ? gps.speed.mps() : -1;
      // course is meaningless when (almost) stationary
      fix_course = (gps.course.isValid() && fix_speed >= 1.0) ? gps.course.deg() : -1;
      if (fix_speed < 0 || fix_speed >= MOVING_MPS) last_motion_ms = millis();
    }
    if (gps.time.isUpdated() && gps.time.isValid() && gps.date.isValid() && gps.date.year() >= 2024) {
      int64_t days = days_from_civil(gps.date.year(), gps.date.month(), gps.date.day());
      unix_at_sync = days * 86400 + gps.time.hour() * 3600 + gps.time.minute() * 60 + gps.time.second();
      ms_at_sync = millis() - gps.time.age() - gps.time.centisecond() * 10;
      have_time = true;
    }
  }
}

static bool fix_fresh() { return have_fix && (millis() - fix_ms) < 3000; }

// Dead-reckon from the last 1 Hz fix using GNSS speed/course (flat-earth, < 3 s).
static void current_position(double *lat, double *lon) {
  *lat = fix_lat;
  *lon = fix_lon;
  if (fix_speed <= 0 || fix_course < 0) return;
  double dt = (millis() - fix_ms) / 1000.0;
  if (dt > 2.0) dt = 2.0;
  const double k = PI / 180.0, R = 6371008.8;
  double d = fix_speed * dt;
  double dn = d * cos(fix_course * k), de = d * sin(fix_course * k);
  *lat = fix_lat + dn / (k * R);
  *lon = fix_lon + de / (k * R * cos(fix_lat * k));
}

// ------------------------------------------------------------------ BLE
static void stop_advertising();

// Static random address for this epoch: HMAC(secret, "HMad"||epoch)[0:6], two MSBs = 11.
static void set_epoch_address(uint32_t epoch) {
  uint8_t m[8], full[32], addr[6];
  m[0] = 'H'; m[1] = 'M'; m[2] = 'a'; m[3] = 'd';
  m[4] = (uint8_t)epoch; m[5] = (uint8_t)(epoch >> 8); m[6] = (uint8_t)(epoch >> 16); m[7] = (uint8_t)(epoch >> 24);
  hm_hmac2(device_secret, device_secret_len, m, 8, NULL, 0, full);
  memcpy(addr, full, 6);   // little-endian: addr[5] is the most significant byte
  addr[5] |= 0xC0;         // static random
  int rc = ble_hs_id_set_rnd(addr);
  Serial.printf("[beacon] address %02x:%02x:%02x:%02x:%02x:%02x rc=%d\n", addr[5], addr[4], addr[3], addr[2],
                addr[1], addr[0], rc);
}

static void update_rolling_id(uint32_t epoch) {
  if (epoch == cur_epoch) return;
  cur_epoch = epoch;
  hm_rolling_id(device_secret, device_secret_len, epoch, rolling_id);
  stop_advertising();       // the address can only change while not advertising
  set_epoch_address(epoch);
  Serial.printf("[beacon] epoch %lu rolling id %02x%02x%02x%02x\n", (unsigned long)epoch, rolling_id[0],
                rolling_id[1], rolling_id[2], rolling_id[3]);
}

static void build_and_advertise() {
  double t = now_unix();
  uint32_t epoch = hm_epoch_of(t);
  update_rolling_id(epoch);

  hm_packet_t p;
  memset(&p, 0, sizeof p);
  p.type = (uint8_t)(HEARME_VEHICLE_TYPE);
  memcpy(p.rolling_id, rolling_id, 4);
  bool fresh = fix_fresh();
  p.speed_raw = (fresh && fix_speed >= 0) ? hm_speed_to_raw(fix_speed) : HM_SPEED_UNKNOWN;
  p.heading_raw = (fresh && fix_course >= 0) ? hm_heading_to_raw(fix_course) : HM_HEADING_UNKNOWN;
  p.gps_valid = fresh;
  p.has_position = fresh;
  if (fresh) {
    double lat, lon;
    current_position(&lat, &lon);
    p.lat_e7 = (int32_t)lround(lat * 1e7);
    p.lon_e7 = (int32_t)lround(lon * 1e7);
  }
  if (p.type == HM_BUS) {
    strncpy(p.route, HEARME_BUS_ROUTE, 6);
    p.door = (uint8_t)(HEARME_BUS_DOOR);
  }

  uint8_t raw[31];
  int n = hm_encode_adv(&p, fleet_key, fleet_key_len, epoch, raw, sizeof raw);
  if (n < 0) {
    Serial.printf("[beacon] encode error %d\n", n);
    return;
  }
  NimBLEAdvertisementData ad;
  ad.addData((char *)raw, (size_t)n);  // raw AD structure; no flags (non-connectable, 31-byte limit)
  adv->setAdvertisementData(ad);
  if (!advertising) {
    adv->start();
    advertising = true;
  }
}

static void stop_advertising() {
  if (advertising) {
    adv->stop();
    advertising = false;
  }
}

// ------------------------------------------------------------------ parking
static bool parked() {
  if (!ignition_on()) return true;
  return have_fix && (millis() - last_motion_ms) > NO_MOTION_PARK_MS;
}

static void park_sleep() {
  stop_advertising();
  led(0, 0, 0);
  Serial.println("[beacon] parked -> light sleep");
  Serial.flush();
  esp_sleep_enable_timer_wakeup(SLEEP_US);
#if HEARME_IGNITION_SENSE
  gpio_wakeup_enable((gpio_num_t)PIN_IGNITION, GPIO_INTR_HIGH_LEVEL);
  esp_sleep_enable_gpio_wakeup();
#endif
  esp_light_sleep_start();
  // after wake: listen to the GNSS for a moment to see whether we move again
  uint32_t t0 = millis();
  while (millis() - t0 < AWAKE_CHECK_MS) {
    poll_gps();
    if (ignition_on() && fix_speed >= MOVING_MPS && fix_fresh()) break;
    delay(10);
  }
  if (ignition_on() && (millis() - last_motion_ms) < AWAKE_CHECK_MS + 1000) {
    Serial.println("[beacon] motion -> awake");
  }
}

// ------------------------------------------------------------------ main
void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
#if HEARME_IGNITION_SENSE
  // Schematic: ignition -> 100k series -> GPIO3, 100k pull-down + 3.3 V zener (active high).
  // Bench without that circuit: build with -DHEARME_IGN_PULLUP=1 so the floating pin reads "on".
  pinMode(PIN_IGNITION, HEARME_IGN_PULLUP ? INPUT_PULLUP : INPUT);
#endif
  GPSSerial.begin(9600, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);

  fleet_key_len = parse_hex(HEARME_FLEET_KEY_HEX, fleet_key, sizeof fleet_key);
#ifdef HEARME_DEVICE_SECRET
  device_secret_len = strlen(HEARME_DEVICE_SECRET);
  if (device_secret_len > sizeof device_secret) device_secret_len = sizeof device_secret;
  memcpy(device_secret, HEARME_DEVICE_SECRET, device_secret_len);
#else
  // per-device secret from the eFuse MAC (never broadcast; only the HMAC-derived rolling ID is)
  uint64_t mac = ESP.getEfuseMac();
  const char tag[] = "hearme-dev";
  memcpy(device_secret, tag, sizeof tag - 1);
  memcpy(device_secret + sizeof tag - 1, &mac, 6);
  device_secret_len = sizeof tag - 1 + 6;
#endif

  NimBLEDevice::init("");
  NimBLEDevice::setOwnAddrType(BLE_OWN_ADDR_RANDOM);  // advertise from the epoch's static random address
  NimBLEDevice::setPower(HEARME_TX_POWER, ESP_BLE_PWR_TYPE_ADV);
  NimBLEDevice::setPower(HEARME_TX_POWER, ESP_BLE_PWR_TYPE_DEFAULT);
  adv = NimBLEDevice::getAdvertising();
  adv->setAdvertisementType(BLE_GAP_CONN_MODE_NON);  // non-connectable, undirected
  adv->setScanResponse(false);
  adv->setMinInterval(160);  // 100 ms (units of 0.625 ms)
  adv->setMaxInterval(176);  // 110 ms: spreads collisions between beacons
  last_motion_ms = millis();
  Serial.printf("[beacon] HearMe vehicle beacon type=%s\n", HM_TYPE_NAMES[HEARME_VEHICLE_TYPE]);
}

void loop() {
  static uint32_t next_adv = 0, led_until = 0;
  poll_gps();
  if (parked()) {
    park_sleep();
    return;
  }
  uint32_t now = millis();
  if ((int32_t)(now - next_adv) >= 0) {
    next_adv = now + ADV_PERIOD_MS;
    build_and_advertise();
    if (now % 1000 < ADV_PERIOD_MS) {  // 1 Hz heartbeat: green = GNSS fix, amber = no fix
      if (fix_fresh()) led(0, 16, 0); else led(16, 8, 0);
      led_until = now + 30;
    }
  }
  if (led_until && (int32_t)(now - led_until) >= 0) {
    led(0, 0, 0);
    led_until = 0;
  }
  delay(2);
}
