/*
 * hearme_receiver.h - HearMe receiver core, C99 port of sim/receiver.py.
 *
 * Line-for-line equivalent of the Python reference (and packages/receiver-core):
 * same config defaults, same double-precision math in the same order, same
 * hysteresis and event rules, same English / Arabic (UTF-8) texts.
 * tests/cross_language/run_all.py proves the outputs are identical.
 *
 * No malloc: a single static receiver instance with a fixed track table.
 * Build with -ffp-contract=off so the compiler never fuses a*b+c into an FMA
 * (that would change the last bit of results versus Python).
 */
#ifndef HEARME_RECEIVER_H
#define HEARME_RECEIVER_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define HM_RX_MAX_TRACKS 32
#define HM_RX_TEXT_LEN   192   /* UTF-8 bytes incl. NUL; longest Arabic text is ~110 bytes */
#define HM_RX_MAX_EVENTS 4     /* an evaluation emits at most 2; 4 is a safe buffer size */

enum { HM_LVL_IGNORE = 0, HM_LVL_AWARE = 1, HM_LVL_WARN = 2, HM_LVL_URGENT = 3 };

typedef struct {
    double tx_power_1m;          /* -50.0 RSSI at 1 m for a +10 dBm beacon */
    double path_loss_n;          /* 2.2   log-distance exponent */
    double rssi_alpha;           /* 0.3   EMA weight on new RSSI sample */
    double ab_alpha;             /* 0.35  alpha-beta gains on distance */
    double ab_beta;              /* 0.06 */
    double stale_s;              /* 2.5   no packet for this long -> ignore */
    double forget_s;             /* 30.0  drop the track entirely */
    double danger_radius_m;      /* 3.0   RSSI-only "will reach you" radius */
    double pass_radius_m;        /* 8.0   GPS: base pass radius */
    double pass_k;               /* 0.5   pass radius += pass_k * combined GPS error */
    double vehicle_gps_acc_m;    /* 4.0   assumed beacon GPS horizontal RMS (m) */
    double pedestrian_gps_acc_m; /* 4.0   used when the pose has no accuracy */
    double aware_dist_m;         /* 35.0 */
    double warn_ttr_s;           /* 6.0   minimum warn threshold */
    double urgent_ttr_s;         /* 3.0   urgent threshold at warn_ttr_s; scales with warn */
    double road_width_m;         /* 7.0   crossing-aware warning */
    double walk_speed_mps;       /* 1.0   slow 0.7 / normal 1.0 / fast 1.3 */
    double crossing_margin_s;    /* 2.0 */
    double urgent_dist_m;        /* 6.0   close + approaching -> urgent */
    double hysteresis_s;         /* 1.0   exit time thresholds looser by (s) */
    double hysteresis_m;         /* 2.0   exit distance thresholds looser by (m) */
    double hold_s;               /* 1.5   lower level must persist this long */
    double warn_hold_s;          /* 2.0   WARN/URGENT held at least this long */
    double min_approach_mps;     /* 0.8   RSSI-only closing speed */
    double moving_mps;           /* 0.5   below this a vehicle is parked */
    double alert_repeat_s;       /* 4.0   unused since v1.1 (every re-escalation alerts) */
    double bus_announce_dist_m;  /* 30.0 */
    double infra_announce_dist_m;/* 12.0 */
    double infra_reannounce_s;   /* 120.0 */
    int    require_mac;          /* 0: unverified packets still warn (fail-safe) */
    int    use_position;         /* 1: use GPS geometry when available */
    int    has_fleet_key;        /* 0 = Python fleet_key None */
    uint8_t fleet_key[64];
    size_t fleet_key_len;
    int    max_tracks;           /* 32 (clamped to 1..HM_RX_MAX_TRACKS) */
} hm_rx_config_t;

typedef struct {
    double t;
    char   id[9];                /* rolling id, 8 lowercase hex chars */
    char   kind[16];             /* vehicle_aware|vehicle_warn|vehicle_urgent|bus_arriving|place */
    char   type[16];             /* e_bike, bus, bus_stop, ... */
    char   side[8];              /* left|right|ahead|behind|unknown */
    int    has_seconds;          /* 0 = Python None */
    int    seconds;
    int    urgency;              /* 0..3 */
    char   text_en[HM_RX_TEXT_LEN];
    char   text_ar[HM_RX_TEXT_LEN];
} hm_rx_event_t;

/* Per-track state (exposed for UI / debugging). */
typedef struct {
    int      used;
    uint32_t seq;                /* insertion order (Python dict order) */
    char     id[9];
    uint8_t  type;
    double   first_t, last_t;
    long     packets;
    double   rssi_ema, dist, rate;
    int      level;
    double   lower_since;
    double   warn_since;           /* when the track last rose to WARN or above */
    double   last_alert_t[4];
    int      announced;
    double   last_announce_t;
    int      verified;
    /* last packet (decoded) */
    uint8_t  p_type, p_speed_raw, p_heading_raw, p_gps_valid, p_has_position, p_door, p_braking;
    int32_t  p_lat_e7, p_lon_e7;
    char     p_route[6 * 3 + 1];  /* UTF-8, non-ASCII bytes -> U+FFFD like Python */
    char     p_name[12 * 3 + 1];
    /* last geometry */
    const char *side;
    int      has_ttr;
    double   ttr;
    int      has_geo_dist;
    double   geo_dist;
} hm_rx_track_t;

void hm_rx_default_config(hm_rx_config_t *cfg);
/* Reset the receiver. cfg may be NULL for defaults. */
void hm_rx_init(const hm_rx_config_t *cfg);
const hm_rx_config_t *hm_rx_config(void);
void hm_rx_set_pose(double lat, double lon, double heading_deg);          /* accuracy unknown */
void hm_rx_set_pose_acc(double lat, double lon, double heading_deg, double acc_m);
/* Crossing-aware thresholds (s) and the current adaptive pass radius (m). */
void hm_rx_warn_thresholds(double *warn, double *urgent);
double hm_rx_pass_radius(void);
/* Feed one manufacturer-data payload (bytes after the company ID).
 * Returns number of events written to out (<= max). */
int  hm_rx_process_payload(double t, double rssi, const uint8_t *payload, size_t len,
                           hm_rx_event_t *out, int max);
/* Call periodically (e.g. 10 Hz). Downgrades stale tracks / forgets old ones; never emits. */
int  hm_rx_tick(double t);
long hm_rx_packets_rejected(void);
/* Track table access (slots may be unused: check .used). */
const hm_rx_track_t *hm_rx_tracks(int *count);
const char *hm_rx_level_name(int level);

#ifdef __cplusplus
}
#endif
#endif /* HEARME_RECEIVER_H */
