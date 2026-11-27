/* C codec test against protocol/test_vectors.json (via generated header).
 * Build: cc -std=c99 -Wall -Wextra -I.. test_packet.c -o test_packet */
#include <stdio.h>
#include "../hearme_packet.h"
#include "test_vectors_gen.h"

static int failures = 0;
#define CHECK(c, msg) do { if (!(c)) { printf("  FAIL %s: %s\n", v->name, msg); failures++; } } while (0)

int main(void) {
    int i;
    for (i = 0; i < HM_NVECS; i++) {
        const hm_vec_t *v = &HM_VECS[i];
        hm_packet_t p; int rc = hm_decode(v->payload, (size_t)v->len, &p);
        if (v->valid) {
            uint8_t out[40]; int n; size_t ml = 0; const uint8_t *md;
            CHECK(rc == HM_OK, "decode failed");
            if (rc != HM_OK) continue;
            CHECK(p.type == v->type, "type");
            CHECK(memcmp(p.rolling_id, v->rid, 4) == 0, "rolling id");
            CHECK(p.speed_raw == v->speed_raw && p.heading_raw == v->heading_raw, "speed/heading");
            CHECK(p.braking == v->braking && p.gps_valid == v->gps_valid && p.reversing == v->reversing, "flags");
            CHECK(p.has_position == v->has_pos, "has_position");
            if (v->has_pos) CHECK(p.lat_e7 == v->lat_e7 && p.lon_e7 == v->lon_e7, "position");
            if (p.type == HM_BUS) CHECK(strcmp(p.route, v->route) == 0 && p.door == v->door && p.ramp == v->ramp, "bus payload");
            if (hm_is_infra(p.type)) CHECK(p.short_code == v->short_code && strcmp(p.name, v->name_f) == 0, "infra payload");
            CHECK(hm_verify(v->payload, (size_t)v->len, HM_TEST_FLEET_KEY, 32, v->epoch, 1), "mac verify");
            n = hm_encode(&p, HM_TEST_FLEET_KEY, 32, v->epoch, out, sizeof out);
            CHECK(n == v->len && memcmp(out, v->payload, (size_t)n) == 0, "re-encode bytes");
            n = hm_encode_adv(&p, HM_TEST_FLEET_KEY, 32, v->epoch, out, sizeof out);
            CHECK(n == v->adv_len && memcmp(out, v->adv, (size_t)n) == 0, "adv bytes");
            CHECK(n <= 31, "adv fits legacy 31 bytes");
            md = hm_parse_adv(v->adv, (size_t)v->adv_len, &ml);
            CHECK(md && ml == (size_t)v->len && memcmp(md, v->payload, ml) == 0, "parse_adv");
        } else if (strcmp(v->failure, "decode") == 0) {
            CHECK(rc != HM_OK, "expected decode error");
        } else {
            CHECK(rc == HM_OK, "decode should succeed");
            CHECK(!hm_verify(v->payload, (size_t)v->len, HM_TEST_FLEET_KEY, 32, v->epoch, 1), "expected mac failure");
        }
    }
    /* rolling id matches python reference for a known secret */
    {
        uint8_t id[4]; hm_rolling_id((const uint8_t *)"bike-001", 8, HM_VECS[0].epoch, id);
        if (memcmp(id, HM_VECS[0].rid, 4) != 0) { printf("  FAIL rolling_id derivation\n"); failures++; }
    }
    printf("C codec: %d vectors, %d failures\n", HM_NVECS, failures);
    return failures ? 1 : 0;
}
