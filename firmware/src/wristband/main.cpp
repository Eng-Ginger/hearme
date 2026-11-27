/*
 * HearMe wristband - ESP32-C3.
 *
 *  - passive NimBLE scan, keeps manufacturer data with company ID 0xFFFF
 *  - feeds lib/hearme_receiver (C port of sim/receiver.py), 10 Hz tick
 *  - haptics: PWM on GPIO5 (vibration motor through a transistor)
 *        slow double pulse  = aware / vehicle nearby
 *        fast pulses        = warn (faster + stronger for urgent; urgent repeats while it lasts)
 *        long buzz          = bus arriving
 *        single short tick  = place (bus stop / crossing / school zone)
 *  - status LED GPIO8, button GPIO9 (BOOT): short press = ack (stop + 10 s quiet for
 *    non-urgent repeats), long press = mute/unmute aware/place/bus cues.
 *    warn and urgent are never muted.
 *  - events are printed on Serial as JSON lines (same format as firmware/tools/run_trace.c)
 *  - serial commands (all builds): POSE <lat> <lon> <heading>, TIME <unix>
 *
 * HEARME_WOKWI build (env wristband_wokwi): Wokwi does not simulate BLE, so the radio is
 * replaced by serial packet injection: lines "PKT <rssi> <hex>" (t = now), "POSE ...",
 * "TIME <unix>". Motor stand-in: LED on GPIO5 (PWM) + buzzer on GPIO6 (tone()).
 */
#include <Arduino.h>

#ifndef HEARME_WOKWI
#include <NimBLEDevice.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#endif

#include "hearme_packet.h"
#include "hearme_receiver.h"

#ifndef HEARME_FLEET_KEY_HEX
#define HEARME_FLEET_KEY_HEX ""
#endif
#ifndef HEARME_REQUIRE_MAC
#define HEARME_REQUIRE_MAC 0
#endif
#ifndef HEARME_LED_RGB
#define HEARME_LED_RGB 1
#endif
#ifndef HEARME_BASE_TIME
#define HEARME_BASE_TIME 0  // unix seconds at boot until TIME is received
#endif

static const int PIN_MOTOR = 5, PIN_BUZZER = 6, PIN_LED = 8, PIN_BUTTON = 9;
static const int MOTOR_CH = 0;          // LEDC channel 0 (timer 0)
static const int TONE_CH = 2;           // tone() on channel 2 (timer 1) so it never retunes the motor
static const uint32_t TICK_MS = 100;

// ------------------------------------------------------------------ clock
static double base_unix = HEARME_BASE_TIME;  // unix time at millis() == 0
static double now_s() { return base_unix + millis() / 1000.0; }

// ------------------------------------------------------------------ haptics
struct Step { uint16_t on_ms, off_ms; uint8_t duty; uint16_t tone_hz; };
static const Step PAT_AWARE[] = { {150, 150, 170, 440}, {150, 0, 170, 440} };
static const Step PAT_WARN[] = { {80, 80, 220, 880}, {80, 80, 220, 880}, {80, 80, 220, 880},
                                 {80, 80, 220, 880}, {80, 80, 220, 880}, {80, 0, 220, 880} };
static const Step PAT_URGENT[] = { {45, 35, 255, 1760}, {45, 35, 255, 1760}, {45, 35, 255, 1760},
                                   {45, 35, 255, 1760}, {45, 35, 255, 1760}, {45, 35, 255, 1760},
                                   {45, 35, 255, 1760}, {45, 35, 255, 1760}, {45, 35, 255, 1760},
                                   {45, 0, 255, 1760} };
static const Step PAT_BUS[] = { {900, 0, 200, 330} };
static const Step PAT_PLACE[] = { {100, 0, 150, 660} };

static const Step *pat = nullptr;
static int pat_len = 0, pat_idx = 0, pat_prio = -1;
static bool pat_on = false;
static uint32_t pat_next = 0;

static void motor(uint8_t duty, uint16_t hz) {
  ledcWrite(MOTOR_CH, duty);
#ifdef HEARME_WOKWI
  if (duty) tone(PIN_BUZZER, hz); else noTone(PIN_BUZZER);
#else
  (void)hz;
#endif
}

static void play(const Step *p, int n, int prio) {
  if (pat && prio < pat_prio) return;  // never interrupt a more urgent cue
  pat = p; pat_len = n; pat_idx = 0; pat_prio = prio; pat_on = false; pat_next = millis();
}

static void stop_pattern() { pat = nullptr; pat_prio = -1; motor(0, 0); }

static void haptics_poll() {
  if (!pat) return;
  uint32_t now = millis();
  if ((int32_t)(now - pat_next) < 0) return;
  if (!pat_on) {
    if (pat_idx >= pat_len) { stop_pattern(); return; }
    motor(pat[pat_idx].duty, pat[pat_idx].tone_hz);
    pat_on = true;
    pat_next = now + pat[pat_idx].on_ms;
  } else {
    motor(0, 0);
    pat_on = false;
    pat_next = now + pat[pat_idx].off_ms;
    pat_idx++;
  }
}

// ------------------------------------------------------------------ LED / button
static void led(uint8_t r, uint8_t g, uint8_t b) {
#if HEARME_LED_RGB
  neopixelWrite(PIN_LED, r, g, b);
#else
  digitalWrite(PIN_LED, (r | g | b) ? HIGH : LOW);
#endif
}

static bool muted = false;           // mutes aware / place / bus cues only
static uint32_t ack_until = 0;       // quiet period for repeats after a short press

static void button_poll() {
  static bool prev = false;
  static uint32_t down_ms = 0;
  bool pressed = digitalRead(PIN_BUTTON) == LOW;
  uint32_t now = millis();
  if (pressed && !prev) down_ms = now;
  if (!pressed && prev) {
    uint32_t held = now - down_ms;
    if (held > 1000) {
      muted = !muted;
      Serial.printf("{\"button\": \"%s\"}\n", muted ? "mute" : "unmute");
      play(PAT_PLACE, 1, 0);
    } else if (held > 30) {
      stop_pattern();
      ack_until = now + 10000;
      Serial.println("{\"button\": \"ack\"}");
    }
  }
  prev = pressed;
}

// ------------------------------------------------------------------ events
static void json_str(const char *s) {
  Serial.write('"');
  for (; *s; s++) {
    unsigned char c = (unsigned char)*s;
    if (c == '"' || c == '\\') { Serial.write('\\'); Serial.write(c); }
    else if (c < 0x20) Serial.printf("\\u%04x", c);
    else Serial.write(c);
  }
  Serial.write('"');
}

static void print_event(const hm_rx_event_t *e) {
  Serial.printf("{\"t\": %.17g, \"id\": ", e->t); json_str(e->id);
  Serial.print(", \"kind\": "); json_str(e->kind);
  Serial.print(", \"type\": "); json_str(e->type);
  Serial.print(", \"side\": "); json_str(e->side);
  if (e->has_seconds) Serial.printf(", \"seconds\": %d", e->seconds); else Serial.print(", \"seconds\": null");
  Serial.printf(", \"urgency\": %d, \"text_en\": ", e->urgency); json_str(e->text_en);
  Serial.print(", \"text_ar\": "); json_str(e->text_ar);
  Serial.println("}");
}

static void handle_event(const hm_rx_event_t *e) {
  print_event(e);
  if (!strcmp(e->kind, "vehicle_urgent")) play(PAT_URGENT, 10, 3);
  else if (!strcmp(e->kind, "vehicle_warn")) play(PAT_WARN, 6, 2);
  else if (muted) return;
  else if (!strcmp(e->kind, "vehicle_aware")) play(PAT_AWARE, 2, 1);
  else if (!strcmp(e->kind, "bus_arriving")) play(PAT_BUS, 1, 1);
  else if (!strcmp(e->kind, "place")) play(PAT_PLACE, 1, 0);
}

static void feed(double t, double rssi, const uint8_t *payload, size_t len) {
  hm_rx_event_t ev[HM_RX_MAX_EVENTS];
  int n = hm_rx_process_payload(t, rssi, payload, len, ev, HM_RX_MAX_EVENTS);
  for (int i = 0; i < n; i++) handle_event(&ev[i]);
}

// Highest current level across tracks: LED colour + urgent repeat while it lasts.
static void status_poll() {
  static uint32_t last_urgent_cue = 0;
  int n, top = HM_LVL_IGNORE;
  const hm_rx_track_t *t = hm_rx_tracks(&n);
  for (int i = 0; i < n; i++) if (t[i].used && t[i].level > top) top = t[i].level;
  uint32_t now = millis();
  switch (top) {
    case HM_LVL_URGENT: led(64, 0, 0); break;
    case HM_LVL_WARN: led(48, 16, 0); break;
    case HM_LVL_AWARE: led(0, 24, 0); break;
    default: led(0, 0, (now % 3000) < 40 ? 16 : 0); break;  // idle heartbeat
  }
  if (top == HM_LVL_URGENT && !pat && (int32_t)(now - ack_until) >= 0 && now - last_urgent_cue > 1500) {
    last_urgent_cue = now;
    play(PAT_URGENT, 10, 3);
  }
}

// ------------------------------------------------------------------ serial commands
static int hexval(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}
static size_t parse_hex(const char *s, uint8_t *out, size_t cap) {
  size_t n = 0;
  while (s[0] && s[1] && n < cap && hexval(s[0]) >= 0 && hexval(s[1]) >= 0) {
    out[n++] = (uint8_t)(hexval(s[0]) * 16 + hexval(s[1]));
    s += 2;
  }
  return n;
}

static void handle_line(char *line) {
  char *tok = strtok(line, " \t\r\n");
  if (!tok) return;
  if (!strcmp(tok, "POSE")) {
    char *a = strtok(nullptr, " \t\r\n"), *b = strtok(nullptr, " \t\r\n"), *c = strtok(nullptr, " \t\r\n");
    if (a && b && c) hm_rx_set_pose(strtod(a, nullptr), strtod(b, nullptr), strtod(c, nullptr));
  } else if (!strcmp(tok, "TIME")) {
    char *a = strtok(nullptr, " \t\r\n");
    if (a) base_unix = strtod(a, nullptr) - millis() / 1000.0;
#ifdef HEARME_WOKWI
  } else if (!strcmp(tok, "PKT")) {
    char *r = strtok(nullptr, " \t\r\n"), *h = strtok(nullptr, " \t\r\n");
    if (r && h) {
      uint8_t buf[40];
      size_t n = parse_hex(h, buf, sizeof buf);
      feed(now_s(), strtod(r, nullptr), buf, n);
    }
#endif
  } else if (tok[0] != '#') {
    Serial.printf("{\"error\": \"unknown command\"}\n");
  }
}

static void serial_poll() {
  static char line[160];
  static size_t n = 0;
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (n) { line[n] = 0; handle_line(line); n = 0; }
    } else if (n < sizeof line - 1) {
      line[n++] = c;
    }
  }
}

// ------------------------------------------------------------------ BLE scan
#ifndef HEARME_WOKWI
struct RawAdv { int8_t rssi; uint8_t len; uint8_t data[HM_MAX_BODY]; uint32_t ms; };
static QueueHandle_t adv_queue;

class ScanCallbacks : public NimBLEAdvertisedDeviceCallbacks {
  void onResult(NimBLEAdvertisedDevice *dev) override {
    if (!dev->haveManufacturerData()) return;
    std::string md = dev->getManufacturerData();   // includes the 2-byte company ID
    if (md.size() < 2 + HM_HEADER_LEN + HM_MAC_LEN || md.size() > 2 + HM_MAX_BODY) return;
    if ((uint8_t)md[0] != (HM_COMPANY_ID & 0xFF) || (uint8_t)md[1] != (HM_COMPANY_ID >> 8)) return;
    RawAdv a;
    a.rssi = (int8_t)dev->getRSSI();
    a.len = (uint8_t)(md.size() - 2);
    memcpy(a.data, md.data() + 2, a.len);
    a.ms = millis();
    xQueueSend(adv_queue, &a, 0);  // drop if full; receiver runs in loop()
  }
};
static ScanCallbacks scan_cb;

static void ble_start() {
  adv_queue = xQueueCreate(64, sizeof(RawAdv));
  NimBLEDevice::init("");
  NimBLEScan *scan = NimBLEDevice::getScan();
  scan->setAdvertisedDeviceCallbacks(&scan_cb, true);  // want duplicates: every advert counts
  scan->setActiveScan(false);                          // passive: never transmits
  scan->setDuplicateFilter(false);
  scan->setMaxResults(0);                              // do not store results
  scan->setInterval(100);                              // ms
  scan->setWindow(100);                                // 100 % duty cycle
  scan->start(0, nullptr, false);                      // forever
}

static void ble_poll() {
  RawAdv a;
  static uint32_t last_restart = 0;
  while (xQueueReceive(adv_queue, &a, 0) == pdTRUE)
    feed(base_unix + a.ms / 1000.0, a.rssi, a.data, a.len);
  NimBLEScan *scan = NimBLEDevice::getScan();
  if (!scan->isScanning() && millis() - last_restart > 1000) {  // recover if the stack stopped it
    last_restart = millis();
    scan->start(0, nullptr, false);
  }
}
#endif

// ------------------------------------------------------------------ main
void setup() {
#ifdef HEARME_WOKWI
  Serial.setRxBufferSize(4096);  // injected traces can arrive in bursts
#endif
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  ledcSetup(MOTOR_CH, 5000, 8);
  ledcAttachPin(PIN_MOTOR, MOTOR_CH);
  ledcWrite(MOTOR_CH, 0);
#ifdef HEARME_WOKWI
  setToneChannel(TONE_CH);
#endif

  hm_rx_config_t cfg;
  hm_rx_default_config(&cfg);
  cfg.fleet_key_len = parse_hex(HEARME_FLEET_KEY_HEX, cfg.fleet_key, sizeof cfg.fleet_key);
  cfg.has_fleet_key = cfg.fleet_key_len > 0;
  cfg.require_mac = HEARME_REQUIRE_MAC;
  hm_rx_init(&cfg);

#ifdef HEARME_WOKWI
  Serial.println("{\"hello\": \"HearMe wristband (Wokwi: serial injection, no BLE)\"}");
#else
  ble_start();
  Serial.println("{\"hello\": \"HearMe wristband\"}");
#endif
  play(PAT_PLACE, 1, 0);  // boot tick
}

void loop() {
  static uint32_t next_tick = 0;
  serial_poll();
#ifndef HEARME_WOKWI
  ble_poll();
#endif
  uint32_t now = millis();
  if ((int32_t)(now - next_tick) >= 0) {
    next_tick = now + TICK_MS;
    hm_rx_tick(now_s());
    status_poll();
  }
  button_poll();
  haptics_poll();
  delay(1);
}
