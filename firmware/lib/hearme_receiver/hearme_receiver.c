/*
 * hearme_receiver.c - C99 port of sim/receiver.py (the reference).
 * Keep this file in lock-step with sim/receiver.py and
 * packages/receiver-core/src/receiver.ts; tests/cross_language/run_all.py
 * compares the three on tests/traces.
 */
#include "hearme_receiver.h"
#include "hearme_packet.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

#define EARTH_R 6371008.8
#define HM_PI 3.14159265358979323846

/* ------------------------------------------------------------------ state */
static hm_rx_config_t g_cfg;
static hm_rx_track_t  g_tracks[HM_RX_MAX_TRACKS];
static uint32_t       g_seq;
static int            g_have_pose;
static double         g_pose_lat, g_pose_lon, g_pose_head;
static int            g_pose_has_acc;
static double         g_pose_acc;
static long           g_rejected;

static const char *const LEVEL_NAMES[4] = { "ignore", "aware", "warn", "urgent" };

const char *hm_rx_level_name(int level) { return (level >= 0 && level < 4) ? LEVEL_NAMES[level] : "?"; }

void hm_rx_default_config(hm_rx_config_t *c) {
    memset(c, 0, sizeof *c);
    c->tx_power_1m = -50.0;
    c->path_loss_n = 2.2;
    c->rssi_alpha = 0.3;
    c->ab_alpha = 0.35;
    c->ab_beta = 0.06;
    c->stale_s = 2.5;
    c->forget_s = 30.0;
    c->danger_radius_m = 3.0;
    c->pass_radius_m = 8.0;
    c->pass_k = 0.5;
    c->vehicle_gps_acc_m = 4.0;
    c->pedestrian_gps_acc_m = 4.0;
    c->aware_dist_m = 35.0;
    c->warn_ttr_s = 6.0;
    c->urgent_ttr_s = 3.0;
    c->road_width_m = 7.0;
    c->walk_speed_mps = 1.0;
    c->crossing_margin_s = 2.0;
    c->urgent_dist_m = 6.0;
    c->hysteresis_s = 1.0;
    c->hysteresis_m = 2.0;
    c->hold_s = 1.5;
    c->warn_hold_s = 2.0;
    c->min_approach_mps = 0.8;
    c->moving_mps = 0.5;
    c->alert_repeat_s = 4.0;
    c->bus_announce_dist_m = 30.0;
    c->infra_announce_dist_m = 12.0;
    c->infra_reannounce_s = 120.0;
    c->require_mac = 0;
    c->use_position = 1;
    c->has_fleet_key = 0;
    c->fleet_key_len = 0;
    c->max_tracks = 32;
}

void hm_rx_init(const hm_rx_config_t *cfg) {
    if (cfg) g_cfg = *cfg; else hm_rx_default_config(&g_cfg);
    if (g_cfg.max_tracks < 1) g_cfg.max_tracks = 1;
    if (g_cfg.max_tracks > HM_RX_MAX_TRACKS) g_cfg.max_tracks = HM_RX_MAX_TRACKS;
    if (g_cfg.fleet_key_len > sizeof g_cfg.fleet_key) g_cfg.fleet_key_len = sizeof g_cfg.fleet_key;
    memset(g_tracks, 0, sizeof g_tracks);
    g_seq = 0;
    g_have_pose = 0;
    g_rejected = 0;
}

const hm_rx_config_t *hm_rx_config(void) { return &g_cfg; }
long hm_rx_packets_rejected(void) { return g_rejected; }
const hm_rx_track_t *hm_rx_tracks(int *count) { if (count) *count = HM_RX_MAX_TRACKS; return g_tracks; }

void hm_rx_set_pose(double lat, double lon, double heading_deg) {
    g_pose_lat = lat; g_pose_lon = lon; g_pose_head = heading_deg; g_have_pose = 1;
    g_pose_has_acc = 0; g_pose_acc = 0.0;
}

void hm_rx_set_pose_acc(double lat, double lon, double heading_deg, double acc_m) {
    hm_rx_set_pose(lat, lon, heading_deg);
    g_pose_has_acc = 1; g_pose_acc = acc_m;
}

/* Crossing-aware: warn = max(warn_ttr_s, road/walk + margin); urgent scales with warn. */
void hm_rx_warn_thresholds(double *warn, double *urgent) {
    double crossing = g_cfg.road_width_m / g_cfg.walk_speed_mps;
    double a = crossing + g_cfg.crossing_margin_s;
    double w = g_cfg.warn_ttr_s >= a ? g_cfg.warn_ttr_s : a;
    *warn = w;
    *urgent = g_cfg.urgent_ttr_s * w / g_cfg.warn_ttr_s;
}

/* Pass radius grown by the combined position uncertainty of vehicle and pedestrian. */
double hm_rx_pass_radius(void) {
    double ped = (g_have_pose && g_pose_has_acc) ? g_pose_acc : g_cfg.pedestrian_gps_acc_m;
    double sigma = sqrt(g_cfg.vehicle_gps_acc_m * g_cfg.vehicle_gps_acc_m + ped * ped);
    return g_cfg.pass_radius_m + g_cfg.pass_k * sigma;
}

/* ------------------------------------------------------------------ helpers */
/* Python float floor division (floatobject.c) so epoch_of matches exactly. */
static double py_floordiv(double vx, double wx) {
    double mod = fmod(vx, wx), div = (vx - mod) / wx, fl;
    if (mod != 0.0) { if ((wx < 0) != (mod < 0)) { div -= 1.0; } }
    if (div != 0.0) { fl = floor(div); if (div - fl > 0.5) fl += 1.0; }
    else fl = copysign(0.0, vx / wx);
    return fl;
}
static uint32_t py_epoch_of(double t) { return (uint32_t)(int64_t)py_floordiv(t, (double)HM_EPOCH_SECONDS); }

static long long round_half_up(double x) { return (long long)floor(x + 0.5); }

static double rssi_to_distance(double rssi) {
    return pow(10.0, (g_cfg.tx_power_1m - rssi) / (10.0 * g_cfg.path_loss_n));
}

static double py_degrees(double x) { return x * (180.0 / HM_PI); }
static double py_radians(double x) { return x * (HM_PI / 180.0); }

static const char *side_of(double rel) {
    if (-45.0 <= rel && rel <= 45.0) return "ahead";
    if (45.0 < rel && rel <= 135.0) return "right";
    if (-135.0 <= rel && rel < -45.0) return "left";
    return "behind";
}

/* ASCII field decode like Python bytes.split(b"\0")[0].decode("ascii", "replace"). */
static void ascii_field(const uint8_t *d, int n, char *out) {
    int i, o = 0;
    for (i = 0; i < n && d[i]; i++) {
        if (d[i] < 128) out[o++] = (char)d[i];
        else { out[o++] = (char)0xEF; out[o++] = (char)0xBF; out[o++] = (char)0xBD; }
    }
    out[o] = 0;
}

/* ------------------------------------------------------------------ text */
static const char *const NAMES_EN[HM_TYPE_COUNT] = {
    "Electric bike", "E-scooter", "Tuk-tuk", "Car", "Bus", "", "", "", "Motorbike" };
static const char *const NAMES_AR[HM_TYPE_COUNT] = {
    "دراجة كهربائية", "سكوتر كهربائي", "توك توك", "سيارة", "حافلة", "", "", "", "دراجة نارية" };
static int is_feminine(uint8_t t) { return t == HM_E_BIKE || t == HM_CAR || t == HM_BUS || t == HM_MOTORCYCLE; }

static const char *side_en(const char *s) {
    if (!strcmp(s, "left")) return "from your left";
    if (!strcmp(s, "right")) return "from your right";
    if (!strcmp(s, "ahead")) return "ahead";
    if (!strcmp(s, "behind")) return "from behind";
    return "";
}
static const char *side_ar(const char *s) {
    if (!strcmp(s, "left")) return "من يسارك";
    if (!strcmp(s, "right")) return "من يمينك";
    if (!strcmp(s, "ahead")) return "أمامك";
    if (!strcmp(s, "behind")) return "من خلفك";
    return "";
}
static const char *bus_side_en(const char *s) {
    if (!strcmp(s, "left")) return "on your left";
    if (!strcmp(s, "right")) return "on your right";
    if (!strcmp(s, "ahead")) return "ahead";
    if (!strcmp(s, "behind")) return "behind you";
    return "";
}
static const char *const DOOR_EN[4] = { "front", "middle", "rear", "" };
static const char *const DOOR_AR[4] = { "الأمامي", "الأوسط", "الخلفي", "" };
static const char *place_en(uint8_t t) {
    return t == HM_BUS_STOP ? "Bus stop" : t == HM_CROSSING ? "Crossing" : "School zone";
}
static const char *place_ar(uint8_t t) {
    return t == HM_BUS_STOP ? "موقف حافلات" : t == HM_CROSSING ? "معبر مشاة" : "منطقة مدرسية";
}

/* bounded string builder */
typedef struct { char *b; size_t cap, n; } sb_t;
static void sb_init(sb_t *s, char *buf, size_t cap) { s->b = buf; s->cap = cap; s->n = 0; buf[0] = 0; }
static void sb_add(sb_t *s, const char *str) {
    size_t l = strlen(str);
    if (s->n + l >= s->cap) l = s->cap - 1 - s->n;  /* truncate (never happens with 192-byte buffers) */
    memcpy(s->b + s->n, str, l); s->n += l; s->b[s->n] = 0;
}
static void sb_int(sb_t *s, long long v) { char tmp[24]; snprintf(tmp, sizeof tmp, "%lld", v); sb_add(s, tmp); }

static void seconds_en(sb_t *s, int n) {
    if (n == 1) { sb_add(s, "1 second"); return; }
    sb_int(s, n); sb_add(s, " seconds");
}
static void seconds_ar(sb_t *s, int n) {
    if (n == 1) { sb_add(s, "ثانية واحدة"); return; }
    if (n == 2) { sb_add(s, "ثانيتان"); return; }
    sb_int(s, n);
    sb_add(s, n <= 10 ? " ثوانٍ" : " ثانية");
}

static void speed_word(uint8_t vtype, int has_speed, double speed, const char **en, const char **ar) {
    int fem = is_feminine(vtype);
    *en = ""; *ar = "";
    if (!has_speed) return;
    if (speed >= 5.5) { *en = "fast"; *ar = fem ? "سريعة" : "سريع"; return; }
    if (speed < 2.5) { *en = "slow"; *ar = fem ? "بطيئة" : "بطيء"; }
}

static void vehicle_text(int level, uint8_t vtype, int has_speed, double speed, const char *side,
                         int has_seconds, int seconds, char *en_out, char *ar_out) {
    sb_t en, ar; const char *sw_en, *sw_ar;
    sb_init(&en, en_out, HM_RX_TEXT_LEN); sb_init(&ar, ar_out, HM_RX_TEXT_LEN);
    if (level == HM_LVL_URGENT) { sb_add(&en, "Stop! "); sb_add(&ar, "توقف! "); }
    sb_add(&en, NAMES_EN[vtype]); if (level == HM_LVL_AWARE) sb_add(&en, " nearby");
    sb_add(&ar, NAMES_AR[vtype]); if (level == HM_LVL_AWARE) sb_add(&ar, " بالقرب منك");
    speed_word(vtype, has_speed, speed, &sw_en, &sw_ar);
    if (level >= HM_LVL_WARN && sw_en[0]) {
        sb_add(&en, ", "); sb_add(&en, sw_en);
        sb_add(&ar, "، "); sb_add(&ar, sw_ar);
    }
    if (side_en(side)[0]) {
        sb_add(&en, ", "); sb_add(&en, side_en(side));
        sb_add(&ar, "، "); sb_add(&ar, side_ar(side));
    }
    if (level >= HM_LVL_WARN && has_seconds) {
        sb_add(&en, ", "); seconds_en(&en, seconds);
        sb_add(&ar, "، "); seconds_ar(&ar, seconds);
    }
}

static void bus_text(const char *route, uint8_t door, const char *side, char *en_out, char *ar_out) {
    sb_t en, ar;
    sb_init(&en, en_out, HM_RX_TEXT_LEN); sb_init(&ar, ar_out, HM_RX_TEXT_LEN);
    sb_add(&en, "Bus "); sb_add(&en, route); sb_add(&en, " arriving");
    sb_add(&ar, "الحافلة "); sb_add(&ar, route); sb_add(&ar, " تصل");
    if (DOOR_EN[door & 3][0]) {
        sb_add(&en, ", "); sb_add(&en, DOOR_EN[door & 3]); sb_add(&en, " door");
        sb_add(&ar, "، الباب "); sb_add(&ar, DOOR_AR[door & 3]);
        if (bus_side_en(side)[0]) {
            sb_add(&en, " "); sb_add(&en, bus_side_en(side));
            sb_add(&ar, " "); sb_add(&ar, side_ar(side));
        }
    }
}

static void place_text(uint8_t vtype, const char *name, char *en_out, char *ar_out) {
    sb_t en, ar;
    sb_init(&en, en_out, HM_RX_TEXT_LEN); sb_init(&ar, ar_out, HM_RX_TEXT_LEN);
    sb_add(&en, place_en(vtype)); sb_add(&en, ": "); sb_add(&en, name);
    sb_add(&ar, place_ar(vtype)); sb_add(&ar, ": "); sb_add(&ar, name);
}

/* ------------------------------------------------------------------ core */
typedef struct { hm_rx_event_t *out; int max, n; } evbuf_t;

static hm_rx_event_t *ev_new(evbuf_t *eb, const hm_rx_track_t *tr, double t, const char *kind,
                             int urgency, const char *side, int has_seconds, int seconds) {
    hm_rx_event_t *e;
    if (eb->n >= eb->max) return NULL;
    e = &eb->out[eb->n++];
    memset(e, 0, sizeof *e);
    e->t = t;
    memcpy(e->id, tr->id, 9);
    snprintf(e->kind, sizeof e->kind, "%s", kind);
    snprintf(e->type, sizeof e->type, "%s", HM_TYPE_NAMES[tr->type]);
    snprintf(e->side, sizeof e->side, "%s", side);
    e->has_seconds = has_seconds; e->seconds = has_seconds ? seconds : 0;
    e->urgency = urgency;
    return e;
}

static void evict(void) {
    int i, best = -1;
    for (i = 0; i < HM_RX_MAX_TRACKS; i++) {
        if (!g_tracks[i].used) continue;
        /* Python: min() over dict insertion order -> first minimal last_t */
        if (best < 0 || g_tracks[i].last_t < g_tracks[best].last_t ||
            (g_tracks[i].last_t == g_tracks[best].last_t && g_tracks[i].seq < g_tracks[best].seq))
            best = i;
    }
    if (best >= 0) g_tracks[best].used = 0;
}

static int track_count(void) {
    int i, n = 0;
    for (i = 0; i < HM_RX_MAX_TRACKS; i++) n += g_tracks[i].used;
    return n;
}

typedef struct { double dist; int has_ttr; double ttr; const char *side; int approaching, moving, closing; } geo_t;

static geo_t geometry(const hm_rx_track_t *tr) {
    geo_t g;
    int has_speed = tr->p_speed_raw != HM_SPEED_UNKNOWN;
    int has_heading = tr->p_heading_raw != HM_HEADING_UNKNOWN;
    double speed = has_speed ? tr->p_speed_raw / 10.0 : 0.0;
    double heading = has_heading ? tr->p_heading_raw * 2.0 : 0.0;
    g.moving = !has_speed || speed >= g_cfg.moving_mps;
    if (g_cfg.use_position && tr->p_has_position && tr->p_gps_valid && g_have_pose) {
        double plat = g_pose_lat, plon = g_pose_lon, phead = g_pose_head;
        double k = HM_PI / 180.0;
        double lat_to = (double)tr->p_lat_e7 / 1e7, lon_to = (double)tr->p_lon_e7 / 1e7;
        double rx = (lon_to - plon) * k * EARTH_R * cos(plat * k);
        double ry = (lat_to - plat) * k * EARTH_R;
        double bearing, rel;
        g.dist = sqrt(rx * rx + ry * ry);
        bearing = py_degrees(atan2(rx, ry));
        rel = bearing - phead;
        while (rel > 180.0) rel -= 360.0;
        while (rel <= -180.0) rel += 360.0;
        g.side = side_of(rel);
        g.has_ttr = 0; g.ttr = 0.0;
        g.approaching = 0;
        g.closing = 0;
        if (has_speed && has_heading && speed >= g_cfg.moving_mps) {
            double h = py_radians(heading);
            double vx = speed * sin(h), vy = speed * cos(h);
            double tc = -(rx * vx + ry * vy) / (speed * speed);
            if (tc > 0.0) {
                double cx = rx + vx * tc, cy = ry + vy * tc;
                double cpa = sqrt(cx * cx + cy * cy);
                g.closing = 1;          /* distance still decreasing */
                if (cpa <= hm_rx_pass_radius()) {
                    g.approaching = 1;
                    g.has_ttr = 1; g.ttr = tc;
                }
            }
        }
        return g;
    }
    /* RSSI-only */
    {
        double approach = -tr->rate;
        g.dist = tr->dist;
        g.has_ttr = 0; g.ttr = 0.0;
        g.side = "unknown";
        g.approaching = approach >= g_cfg.min_approach_mps && tr->packets >= 3;
        if (g.approaching) {
            double rate = (has_speed && speed > approach) ? speed : approach;
            g.has_ttr = 1;
            g.ttr = (g.dist - g_cfg.danger_radius_m) / rate;
            if (g.ttr < 0.0) g.ttr = 0.0;
        }
        g.closing = g.approaching;
    }
    return g;
}

static int level_for(const geo_t *g, double margin_s, double margin_m, double warn, double urgent) {
    if (!g->moving) return HM_LVL_IGNORE;
    if (g->has_ttr && g->ttr <= urgent + margin_s) return HM_LVL_URGENT;
    if (g->approaching && g->dist <= g_cfg.urgent_dist_m + margin_m) return HM_LVL_URGENT;
    if (g->has_ttr && g->ttr <= warn + margin_s) return HM_LVL_WARN;
    if (g->dist <= g_cfg.aware_dist_m + margin_m) return HM_LVL_AWARE;
    return HM_LVL_IGNORE;
}

static void evaluate(hm_rx_track_t *tr, double t, evbuf_t *eb) {
    geo_t g;
    int enter, stay;
    double warn, urgent;
    int has_speed = tr->p_speed_raw != HM_SPEED_UNKNOWN;
    double speed = has_speed ? tr->p_speed_raw / 10.0 : 0.0;
    hm_rx_event_t *e;

    if (hm_is_infra(tr->p_type)) {
        tr->has_geo_dist = 0;
        if (tr->dist <= g_cfg.infra_announce_dist_m &&
            (!tr->announced || t - tr->last_announce_t >= g_cfg.infra_reannounce_s)) {
            tr->announced = 1;
            tr->last_announce_t = t;
            e = ev_new(eb, tr, t, "place", 0, "unknown", 0, 0);
            if (e) place_text(tr->p_type, tr->p_name, e->text_en, e->text_ar);
        }
        return;
    }

    g = geometry(tr);
    tr->side = g.side; tr->has_ttr = g.has_ttr; tr->ttr = g.ttr;
    tr->has_geo_dist = 1; tr->geo_dist = g.dist;

    if (tr->p_type == HM_BUS && !tr->announced && g.dist <= g_cfg.bus_announce_dist_m &&
        (g.approaching || (has_speed && speed < 3.0))) {
        tr->announced = 1;
        tr->last_announce_t = t;
        e = ev_new(eb, tr, t, "bus_arriving", 0, g.side, 0, 0);
        if (e) bus_text(tr->p_route, tr->p_door, g.side, e->text_en, e->text_ar);
    }

    hm_rx_warn_thresholds(&warn, &urgent);
    enter = level_for(&g, 0.0, 0.0, warn, urgent);
    stay = level_for(&g, g_cfg.hysteresis_s, g_cfg.hysteresis_m, warn, urgent);
    /* minimum warn hold: a raised WARN does not drop out while the vehicle is still closing
     * (time to closest approach > 0) or within warn_hold_s of being raised */
    if (tr->level >= HM_LVL_WARN && stay < HM_LVL_WARN && g.moving &&
        (g.closing || t - tr->warn_since < g_cfg.warn_hold_s))
        stay = HM_LVL_WARN;
    /* a bus braking (into a stop) is expected, not a threat: cap at aware */
    if (tr->p_type == HM_BUS && tr->p_braking) {
        if (enter > HM_LVL_AWARE) enter = HM_LVL_AWARE;
        if (stay > HM_LVL_AWARE) stay = HM_LVL_AWARE;
    }
    if (enter > tr->level) {
        /* every upward transition alerts, including re-escalation after a drop */
        int has_seconds = 0, seconds = 0;
        char kind[16];
        if (enter >= HM_LVL_WARN && tr->level < HM_LVL_WARN) tr->warn_since = t;
        tr->level = enter;
        tr->lower_since = -1.0;
        tr->last_alert_t[enter] = t;
        if (enter >= HM_LVL_WARN && g.has_ttr) {
            long long s = round_half_up(g.ttr);
            if (s < 1) s = 1;
            has_seconds = 1; seconds = (int)s;
        }
        snprintf(kind, sizeof kind, "vehicle_%s", LEVEL_NAMES[enter]);
        e = ev_new(eb, tr, t, kind, enter, g.side, has_seconds, seconds);
        if (e) vehicle_text(enter, tr->p_type, has_speed, speed, g.side, has_seconds, seconds,
                            e->text_en, e->text_ar);
    } else if (stay < tr->level) {
        if (tr->lower_since < 0.0) {
            tr->lower_since = t;
        } else if (t - tr->lower_since >= g_cfg.hold_s) {
            tr->level = stay;
            tr->lower_since = -1.0;
        }
    } else {
        tr->lower_since = -1.0;
    }
}

int hm_rx_process_payload(double t, double rssi, const uint8_t *payload, size_t len,
                          hm_rx_event_t *out, int max) {
    hm_packet_t p;
    int verified = 0, i, slot = -1;
    char rid[9];
    hm_rx_track_t *tr;
    evbuf_t eb;
    size_t off;

    if (hm_decode(payload, len, &p) != HM_OK) { g_rejected++; return 0; }
    if (g_cfg.has_fleet_key) {
        verified = hm_verify(payload, len, g_cfg.fleet_key, g_cfg.fleet_key_len, py_epoch_of(t), 1);
        if (!verified && g_cfg.require_mac) { g_rejected++; return 0; }
    }
    snprintf(rid, sizeof rid, "%02x%02x%02x%02x", p.rolling_id[0], p.rolling_id[1], p.rolling_id[2], p.rolling_id[3]);

    for (i = 0; i < HM_RX_MAX_TRACKS; i++)
        if (g_tracks[i].used && g_tracks[i].type == p.type && !memcmp(g_tracks[i].id, rid, 9)) { slot = i; break; }

    if (slot < 0) {
        if (track_count() >= g_cfg.max_tracks) evict();
        for (i = 0; i < HM_RX_MAX_TRACKS; i++) if (!g_tracks[i].used) { slot = i; break; }
        if (slot < 0) return 0;  /* unreachable: evict() freed one */
        tr = &g_tracks[slot];
        memset(tr, 0, sizeof *tr);
        tr->used = 1; tr->seq = ++g_seq;
        memcpy(tr->id, rid, 9); tr->type = p.type;
        tr->first_t = t; tr->last_t = t;
        tr->packets = 0;
        tr->level = HM_LVL_IGNORE; tr->lower_since = -1.0; tr->warn_since = -1.0;
        for (i = 0; i < 4; i++) tr->last_alert_t[i] = -1e9;
        tr->announced = 0; tr->last_announce_t = -1e9;
        tr->side = "unknown";
        tr->rssi_ema = rssi;
        tr->dist = rssi_to_distance(rssi);
        tr->rate = 0.0;
    } else {
        double z, dt, pred, r;
        tr = &g_tracks[slot];
        tr->rssi_ema = tr->rssi_ema + g_cfg.rssi_alpha * (rssi - tr->rssi_ema);
        z = rssi_to_distance(tr->rssi_ema);
        dt = t - tr->last_t;
        if (dt < 0.01) dt = 0.01;
        pred = tr->dist + tr->rate * dt;
        r = z - pred;
        tr->dist = pred + g_cfg.ab_alpha * r;
        tr->rate = tr->rate + g_cfg.ab_beta * r / dt;
        if (tr->dist < 0.5) tr->dist = 0.5;
    }
    tr->last_t = t;
    tr->packets += 1;
    /* tr.pkt = p */
    tr->p_type = p.type; tr->p_speed_raw = p.speed_raw; tr->p_heading_raw = p.heading_raw;
    tr->p_gps_valid = p.gps_valid; tr->p_has_position = p.has_position; tr->p_braking = p.braking;
    tr->p_lat_e7 = p.lat_e7; tr->p_lon_e7 = p.lon_e7; tr->p_door = p.door;
    off = HM_HEADER_LEN + (p.has_position ? HM_POS_LEN : 0);
    tr->p_route[0] = 0; tr->p_name[0] = 0;
    if (p.type == HM_BUS) ascii_field(payload + off, 6, tr->p_route);
    else if (hm_is_infra(p.type)) ascii_field(payload + off + 2, 12, tr->p_name);
    tr->verified = verified;

    eb.out = out; eb.max = out ? max : 0; eb.n = 0;
    evaluate(tr, t, &eb);
    return eb.n;
}

int hm_rx_tick(double t) {
    int i;
    for (i = 0; i < HM_RX_MAX_TRACKS; i++) {
        hm_rx_track_t *tr = &g_tracks[i];
        double age;
        if (!tr->used) continue;
        age = t - tr->last_t;
        if (age > g_cfg.forget_s) {
            tr->used = 0;
        } else if (age > g_cfg.stale_s) {
            tr->level = HM_LVL_IGNORE;
            tr->lower_since = -1.0;
            tr->has_ttr = 0;
        }
    }
    return 0;
}
