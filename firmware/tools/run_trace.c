/*
 * run_trace.c - run a tests/traces/<name>.txt trace through the C receiver and print
 * the emitted events as JSON lines (one object per line).
 *
 * Build (from repo root):
 *   python -m ziglang cc -std=c99 -O2 -ffp-contract=off -Iprotocol/c -Ifirmware/lib/hearme_receiver \
 *       firmware/tools/run_trace.c firmware/lib/hearme_receiver/hearme_receiver.c -o build/run_trace.exe
 * Usage: run_trace <trace.txt>
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "hearme_receiver.h"

static int hexval(int c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}
static int parse_hex(const char *s, unsigned char *out, int cap) {
    int n = 0;
    while (s[0] && s[1] && hexval(s[0]) >= 0 && hexval(s[1]) >= 0 && n < cap) {
        out[n++] = (unsigned char)(hexval(s[0]) * 16 + hexval(s[1])); s += 2;
    }
    return n;
}

static void json_str(const char *s) {
    putchar('"');
    for (; *s; s++) {
        unsigned char c = (unsigned char)*s;
        if (c == '"' || c == '\\') { putchar('\\'); putchar(c); }
        else if (c < 0x20) printf("\\u%04x", c);
        else putchar(c);  /* UTF-8 passes through */
    }
    putchar('"');
}

static void print_event(const hm_rx_event_t *e) {
    printf("{\"t\": %.17g, \"id\": ", e->t); json_str(e->id);
    printf(", \"kind\": "); json_str(e->kind);
    printf(", \"type\": "); json_str(e->type);
    printf(", \"side\": "); json_str(e->side);
    if (e->has_seconds) printf(", \"seconds\": %d", e->seconds); else printf(", \"seconds\": null");
    printf(", \"urgency\": %d, \"text_en\": ", e->urgency); json_str(e->text_en);
    printf(", \"text_ar\": "); json_str(e->text_ar);
    printf("}\n");
}

static int set_cfg(hm_rx_config_t *c, const char *name, const char *val) {
    double v = strtod(val, NULL);
    if (!strcmp(val, "True")) v = 1; else if (!strcmp(val, "False")) v = 0;
#define F(n) if (!strcmp(name, #n)) { c->n = v; return 1; }
    F(tx_power_1m) F(path_loss_n) F(rssi_alpha) F(ab_alpha) F(ab_beta) F(stale_s) F(forget_s)
    F(danger_radius_m) F(pass_radius_m) F(aware_dist_m) F(warn_ttr_s) F(urgent_ttr_s) F(urgent_dist_m)
    F(hysteresis_s) F(hold_s) F(min_approach_mps) F(moving_mps) F(alert_repeat_s) F(bus_announce_dist_m)
    F(infra_announce_dist_m) F(infra_reannounce_s)
#undef F
    if (!strcmp(name, "require_mac")) { c->require_mac = v != 0; return 1; }
    if (!strcmp(name, "use_position")) { c->use_position = v != 0; return 1; }
    if (!strcmp(name, "max_tracks")) { c->max_tracks = (int)v; return 1; }
    return 0;
}

int main(int argc, char **argv) {
    static char line[1024];
    FILE *f;
    hm_rx_config_t cfg;
    int started = 0;
    if (argc < 2) { fprintf(stderr, "usage: %s trace.txt\n", argv[0]); return 2; }
    f = fopen(argv[1], "r");
    if (!f) { perror(argv[1]); return 2; }
    hm_rx_default_config(&cfg);
    while (fgets(line, sizeof line, f)) {
        char *tok = strtok(line, " \t\r\n");
        if (!tok) continue;
        if (!strcmp(tok, "KEY")) {
            char *h = strtok(NULL, " \t\r\n");
            if (h) { cfg.fleet_key_len = (size_t)parse_hex(h, cfg.fleet_key, (int)sizeof cfg.fleet_key); cfg.has_fleet_key = 1; }
            continue;
        }
        if (!strcmp(tok, "CFG")) {
            char *n = strtok(NULL, " \t\r\n"), *v = strtok(NULL, " \t\r\n");
            if (n && v && !set_cfg(&cfg, n, v)) fprintf(stderr, "warning: unknown CFG %s\n", n);
            continue;
        }
        if (!started) { hm_rx_init(&cfg); started = 1; }
        if (!strcmp(tok, "POSE")) {
            double lat = strtod(strtok(NULL, " "), NULL), lon = strtod(strtok(NULL, " "), NULL);
            double hd = strtod(strtok(NULL, " \r\n"), NULL);
            hm_rx_set_pose(lat, lon, hd);
        } else if (!strcmp(tok, "PKT")) {
            hm_rx_event_t ev[HM_RX_MAX_EVENTS];
            unsigned char buf[64];
            double t = strtod(strtok(NULL, " "), NULL), rssi = strtod(strtok(NULL, " "), NULL);
            int len = parse_hex(strtok(NULL, " \r\n"), buf, (int)sizeof buf), n, i;
            n = hm_rx_process_payload(t, rssi, buf, (size_t)len, ev, HM_RX_MAX_EVENTS);
            for (i = 0; i < n; i++) print_event(&ev[i]);
        } else if (!strcmp(tok, "TICK")) {
            hm_rx_tick(strtod(strtok(NULL, " \r\n"), NULL));
        }
    }
    fclose(f);
    return 0;
}
