/*
 * Native unit tests (PlatformIO `pio test -e native`, Unity).
 * Also runs on a bare host with the shim in firmware/tools/unity_shim (see README).
 *
 *  - packet codec on the shared vectors (protocol/c/test/test_vectors_gen.h)
 *  - receiver state machine: aware -> warn -> urgent escalation, hysteresis hold,
 *    stale downgrade / forget, parked vehicle ignored, spoof rejected with require_mac,
 *    bus arrival and place announcements, Arabic text.
 */
#include <math.h>
#include <string.h>
#include <unity.h>

#include "hearme_packet.h"
#include "hearme_receiver.h"
#include "test_vectors_gen.h"

#define T0 1800000000.0
#define LAT0 25.40515953058363
#define LON0 55.5136
static const double K = 3.14159265358979323846 / 180.0;
static const double R = 6371008.8;

void setUp(void) {}
void tearDown(void) {}

/* ------------------------------------------------------------------ helpers */
static hm_rx_event_t g_ev[64];
static int g_nev;

static void rx_reset(int require_mac, int use_position) {
    hm_rx_config_t c;
    hm_rx_default_config(&c);
    c.has_fleet_key = 1;
    memcpy(c.fleet_key, HM_TEST_FLEET_KEY, 32);
    c.fleet_key_len = 32;
    c.require_mac = require_mac;
    c.use_position = use_position;
    hm_rx_init(&c);
    hm_rx_set_pose(LAT0, LON0, 0.0);   /* pedestrian at origin, facing north */
    g_nev = 0;
}

/* Build a vehicle packet at ENU offset (x east, y north) from the pedestrian. */
static int make_pkt(uint8_t type, const uint8_t rid[4], double x, double y, double speed, double heading,
                    const uint8_t *key, double t, uint8_t *out) {
    hm_packet_t p;
    memset(&p, 0, sizeof p);
    p.type = type;
    memcpy(p.rolling_id, rid, 4);
    p.speed_raw = speed < 0 ? HM_SPEED_UNKNOWN : hm_speed_to_raw(speed);
    p.heading_raw = heading < 0 ? HM_HEADING_UNKNOWN : hm_heading_to_raw(heading);
    p.gps_valid = 1;
    p.has_position = 1;
    p.lat_e7 = (int32_t)floor((LAT0 + y / (K * R)) * 1e7 + 0.5);
    p.lon_e7 = (int32_t)floor((LON0 + x / (K * R * cos(LAT0 * K))) * 1e7 + 0.5);
    if (type == HM_BUS) { strcpy(p.route, "12"); p.door = HM_DOOR_FRONT; }
    if (hm_is_infra(type)) { p.has_position = 0; p.gps_valid = 0; strcpy(p.name, "Al Jurf Stop"); p.short_code = 101; }
    return hm_encode(&p, key, 32, hm_epoch_of(t), out, 40);
}

static double rssi_for(double d) {
    if (d < 0.5) d = 0.5;
    return floor(-50.0 - 22.0 * log10(d) + 0.5);
}

static int feed(double t, uint8_t type, const uint8_t rid[4], double x, double y, double speed, double heading,
                const uint8_t *key) {
    uint8_t buf[40];
    int n = make_pkt(type, rid, x, y, speed, heading, key, t, buf), k;
    TEST_ASSERT_GREATER_THAN(0, n);
    k = hm_rx_process_payload(t, rssi_for(sqrt(x * x + y * y)), buf, (size_t)n, g_ev + g_nev, 64 - g_nev);
    g_nev += k;
    return k;
}

static const hm_rx_track_t *find_track(const uint8_t rid[4]) {
    int i, n; char id[9];
    const hm_rx_track_t *t = hm_rx_tracks(&n);
    snprintf(id, sizeof id, "%02x%02x%02x%02x", rid[0], rid[1], rid[2], rid[3]);
    for (i = 0; i < n; i++) if (t[i].used && !strcmp(t[i].id, id)) return &t[i];
    return NULL;
}

static const uint8_t RID_A[4] = { 0xa1, 0xb2, 0xc3, 0xd4 };
static const uint8_t ATTACKER_KEY[32] = { 'a', 't', 't', 'a', 'c', 'k', 'e', 'r' };

/* Drive an e-bike from x=-60 m toward the pedestrian at 3 m/s (passes through). Returns time of last packet. */
static double approach_until(double x_stop) {
    double t = T0, x = -60.0;
    while (x < x_stop) {
        feed(t, HM_E_BIKE, RID_A, x, 0.0, 3.0, 90.0, HM_TEST_FLEET_KEY);
        t += 0.1; x += 0.3;
    }
    return t - 0.1;
}

/* ------------------------------------------------------------------ codec */
static void test_codec_vectors(void) {
    int i;
    for (i = 0; i < HM_NVECS; i++) {
        const hm_vec_t *v = &HM_VECS[i];
        hm_packet_t p; uint8_t out[40]; int rc = hm_decode(v->payload, (size_t)v->len, &p), n;
        if (v->valid) {
            TEST_ASSERT_EQUAL_INT_MESSAGE(HM_OK, rc, v->name);
            TEST_ASSERT_EQUAL_INT_MESSAGE(v->type, p.type, v->name);
            TEST_ASSERT_EQUAL_MEMORY_MESSAGE(v->rid, p.rolling_id, 4, v->name);
            TEST_ASSERT_EQUAL_INT_MESSAGE(v->speed_raw, p.speed_raw, v->name);
            TEST_ASSERT_EQUAL_INT_MESSAGE(v->heading_raw, p.heading_raw, v->name);
            TEST_ASSERT_EQUAL_INT_MESSAGE(v->has_pos, p.has_position, v->name);
            if (v->has_pos) {
                TEST_ASSERT_EQUAL_INT_MESSAGE(v->lat_e7, p.lat_e7, v->name);
                TEST_ASSERT_EQUAL_INT_MESSAGE(v->lon_e7, p.lon_e7, v->name);
            }
            if (p.type == HM_BUS) TEST_ASSERT_EQUAL_STRING_MESSAGE(v->route, p.route, v->name);
            if (hm_is_infra(p.type)) TEST_ASSERT_EQUAL_STRING_MESSAGE(v->name_f, p.name, v->name);
            TEST_ASSERT_TRUE_MESSAGE(hm_verify(v->payload, (size_t)v->len, HM_TEST_FLEET_KEY, 32, v->epoch, 1), v->name);
            n = hm_encode(&p, HM_TEST_FLEET_KEY, 32, v->epoch, out, sizeof out);
            TEST_ASSERT_EQUAL_INT_MESSAGE(v->len, n, v->name);
            TEST_ASSERT_EQUAL_MEMORY_MESSAGE(v->payload, out, (size_t)n, v->name);
        } else if (strcmp(v->failure, "decode") == 0) {
            TEST_ASSERT_TRUE_MESSAGE(rc != HM_OK, v->name);
        } else {
            TEST_ASSERT_EQUAL_INT_MESSAGE(HM_OK, rc, v->name);
            TEST_ASSERT_FALSE(hm_verify(v->payload, (size_t)v->len, HM_TEST_FLEET_KEY, 32, v->epoch, 1));
        }
    }
}

static void test_receiver_rejects_garbage(void) {
    uint8_t junk[5] = { 1, 2, 3, 4, 5 };
    rx_reset(0, 1);
    TEST_ASSERT_EQUAL_INT(0, hm_rx_process_payload(T0, -60, junk, sizeof junk, g_ev, 4));
    TEST_ASSERT_EQUAL_INT(1, hm_rx_packets_rejected());
}

/* ------------------------------------------------------------------ receiver */
static void test_escalation_aware_warn_urgent(void) {
    rx_reset(0, 1);
    approach_until(-6.0);
    TEST_ASSERT_EQUAL_INT(3, g_nev);
    TEST_ASSERT_EQUAL_STRING("vehicle_aware", g_ev[0].kind);
    TEST_ASSERT_EQUAL_STRING("vehicle_warn", g_ev[1].kind);
    TEST_ASSERT_EQUAL_STRING("vehicle_urgent", g_ev[2].kind);
    TEST_ASSERT_EQUAL_INT(1, g_ev[0].urgency);
    TEST_ASSERT_EQUAL_INT(2, g_ev[1].urgency);
    TEST_ASSERT_EQUAL_INT(3, g_ev[2].urgency);
    TEST_ASSERT_EQUAL_STRING("left", g_ev[0].side);
    TEST_ASSERT_EQUAL_STRING("e_bike", g_ev[0].type);
    TEST_ASSERT_EQUAL_STRING("a1b2c3d4", g_ev[0].id);
    TEST_ASSERT_FALSE(g_ev[0].has_seconds);
    TEST_ASSERT_EQUAL_STRING("Electric bike nearby, from your left", g_ev[0].text_en);
    TEST_ASSERT_EQUAL_STRING("دراجة كهربائية بالقرب منك، من يسارك", g_ev[0].text_ar);
    TEST_ASSERT_TRUE(g_ev[1].has_seconds);
    TEST_ASSERT_TRUE(g_ev[1].seconds == 9 || g_ev[1].seconds == 8);   /* v1.1: warn = 7 m / 1.0 m/s + 2 s = 9 s */
    TEST_ASSERT_TRUE(g_ev[2].has_seconds);
    TEST_ASSERT_TRUE(g_ev[2].seconds == 5 || g_ev[2].seconds == 4);   /* urgent scales to 4.5 s */
    TEST_ASSERT_TRUE(strncmp(g_ev[2].text_en, "Stop! Electric bike, from your left, ", 37) == 0);
    TEST_ASSERT_TRUE(strncmp(g_ev[2].text_ar, "توقف! ", strlen("توقف! ")) == 0);
    TEST_ASSERT_EQUAL_INT(HM_LVL_URGENT, find_track(RID_A)->level);
}

static void test_hysteresis_hold_then_downgrade(void) {
    double t;
    const hm_rx_track_t *tr;
    rx_reset(0, 1);
    t = approach_until(-12.0);
    tr = find_track(RID_A);
    TEST_ASSERT_NOT_NULL(tr);
    TEST_ASSERT_EQUAL_INT(HM_LVL_URGENT, tr->level);
    g_nev = 0;
    /* vehicle turns north-west (moving away), stays 12 m away (outside the 10.8 m adaptive pass radius) */
    t += 0.1; feed(t, HM_E_BIKE, RID_A, -12.0, 0.0, 3.0, 330.0, HM_TEST_FLEET_KEY);   /* lower_since = t */
    {
        double t_lower = t;
        while (t < t_lower + 1.4) { t += 0.1; feed(t, HM_E_BIKE, RID_A, -12.0, 0.0, 3.0, 330.0, HM_TEST_FLEET_KEY); }
        TEST_ASSERT_EQUAL_INT(HM_LVL_URGENT, tr->level);       /* held for < hold_s */
        t = t_lower + 1.6; feed(t, HM_E_BIKE, RID_A, -12.0, 0.0, 3.0, 330.0, HM_TEST_FLEET_KEY);
        TEST_ASSERT_EQUAL_INT(HM_LVL_AWARE, tr->level);        /* downgraded after hold_s */
    }
    TEST_ASSERT_EQUAL_INT(0, g_nev);                            /* downgrades never emit */
}

static void test_hysteresis_band_keeps_level(void) {
    /* RSSI-only aware band: enter at <= 35 m, stay while <= 35 + hysteresis_m (2 m) */
    double t = T0;
    int i;
    const hm_rx_track_t *tr;
    rx_reset(0, 0);
    for (i = 0; i < 5; i++, t += 0.1) feed(t, HM_E_BIKE, RID_A, -30.0, 0.0, 3.0, 90.0, HM_TEST_FLEET_KEY);
    tr = find_track(RID_A);
    TEST_ASSERT_EQUAL_INT(HM_LVL_AWARE, tr->level);
    TEST_ASSERT_EQUAL_INT(1, g_nev);
    /* drift out to ~36.5 m: inside the stay band, level kept for well over hold_s */
    for (i = 0; i < 60; i++, t += 0.1) feed(t, HM_E_BIKE, RID_A, -36.5, 0.0, 3.0, 90.0, HM_TEST_FLEET_KEY);
    TEST_ASSERT_TRUE(tr->dist > 35.0 && tr->dist < 37.0);
    TEST_ASSERT_EQUAL_INT(HM_LVL_AWARE, tr->level);
    TEST_ASSERT_EQUAL_INT(1, g_nev);
}

static void test_stale_downgrade_and_forget(void) {
    double t;
    rx_reset(0, 1);
    t = approach_until(-15.0);
    TEST_ASSERT_TRUE(find_track(RID_A)->level >= HM_LVL_WARN);
    hm_rx_tick(t + 2.4);
    TEST_ASSERT_TRUE(find_track(RID_A)->level >= HM_LVL_WARN);
    hm_rx_tick(t + 2.6);
    TEST_ASSERT_EQUAL_INT(HM_LVL_IGNORE, find_track(RID_A)->level);
    TEST_ASSERT_FALSE(find_track(RID_A)->has_ttr);
    hm_rx_tick(t + 30.5);
    TEST_ASSERT_TRUE(find_track(RID_A) == NULL);
}

static void test_parked_vehicle_ignored(void) {
    double t = T0;
    int i;
    rx_reset(0, 1);
    for (i = 0; i < 50; i++, t += 0.1) {
        feed(t, HM_E_BIKE, RID_A, 3.0, -2.0, 0.0, 90.0, HM_TEST_FLEET_KEY);    /* 0 m/s, 3.6 m away */
        hm_rx_tick(t);
    }
    for (i = 0; i < 50; i++, t += 0.1) feed(t, HM_E_BIKE, RID_A, 3.0, -2.0, 0.3, 90.0, HM_TEST_FLEET_KEY); /* creeping */
    TEST_ASSERT_EQUAL_INT(0, g_nev);
    TEST_ASSERT_EQUAL_INT(HM_LVL_IGNORE, find_track(RID_A)->level);
}

static void test_spoof_rejected_with_require_mac(void) {
    double t = T0;
    int i;
    rx_reset(1, 1);
    for (i = 0; i < 200; i++, t += 0.1) feed(t, HM_E_BIKE, RID_A, -60.0 + 0.3 * i, 0.0, 3.0, 90.0, ATTACKER_KEY);
    TEST_ASSERT_EQUAL_INT(0, g_nev);
    TEST_ASSERT_EQUAL_INT(200, hm_rx_packets_rejected());
    TEST_ASSERT_TRUE(find_track(RID_A) == NULL);
    /* the genuine vehicle (right key) is still heard */
    rx_reset(1, 1);
    approach_until(-6.0);
    TEST_ASSERT_EQUAL_INT(3, g_nev);
    TEST_ASSERT_TRUE(find_track(RID_A)->verified);
}

static void test_unverified_still_warns_without_require_mac(void) {
    double t = T0, x = -60.0;
    rx_reset(0, 1);
    while (x < -6.0) { feed(t, HM_E_BIKE, RID_A, x, 0.0, 3.0, 90.0, ATTACKER_KEY); t += 0.1; x += 0.3; }
    TEST_ASSERT_EQUAL_INT(3, g_nev);       /* fail-safe: unknown fleets still warn */
    TEST_ASSERT_FALSE(find_track(RID_A)->verified);
}

static void test_bus_arrival_and_place(void) {
    static const uint8_t RID_BUS[4] = { 0xb0, 0x51, 0x12, 0x00 }, RID_STOP[4] = { 0x57, 0x09, 0xaa, 0x01 };
    double t = T0;
    int i, saw_bus = 0, saw_place = 0;
    rx_reset(0, 1);
    for (i = 0; i < 30; i++, t += 0.1) {
        feed(t, HM_BUS, RID_BUS, -20.0 + 0.2 * i, -2.0, 2.0, 90.0, HM_TEST_FLEET_KEY);  /* slowing bus on the left */
        feed(t + 0.01, HM_BUS_STOP, RID_STOP, 2.0, -1.0, -1, -1, HM_TEST_FLEET_KEY);
    }
    for (i = 0; i < g_nev; i++) {
        if (!strcmp(g_ev[i].kind, "bus_arriving")) {
            saw_bus++;
            TEST_ASSERT_EQUAL_STRING("Bus 12 arriving, front door on your left", g_ev[i].text_en);
            TEST_ASSERT_EQUAL_STRING("الحافلة 12 تصل، الباب الأمامي من يسارك", g_ev[i].text_ar);
        }
        if (!strcmp(g_ev[i].kind, "place")) {
            saw_place++;
            TEST_ASSERT_EQUAL_STRING("Bus stop: Al Jurf Stop", g_ev[i].text_en);
            TEST_ASSERT_EQUAL_STRING("موقف حافلات: Al Jurf Stop", g_ev[i].text_ar);
        }
    }
    TEST_ASSERT_EQUAL_INT(1, saw_bus);     /* announced once per track */
    TEST_ASSERT_EQUAL_INT(1, saw_place);   /* re-announced only after infra_reannounce_s */
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_codec_vectors);
    RUN_TEST(test_receiver_rejects_garbage);
    RUN_TEST(test_escalation_aware_warn_urgent);
    RUN_TEST(test_hysteresis_hold_then_downgrade);
    RUN_TEST(test_hysteresis_band_keeps_level);
    RUN_TEST(test_stale_downgrade_and_forget);
    RUN_TEST(test_parked_vehicle_ignored);
    RUN_TEST(test_spoof_rejected_with_require_mac);
    RUN_TEST(test_unverified_still_warns_without_require_mac);
    RUN_TEST(test_bus_arrival_and_place);
    return UNITY_END();
}
