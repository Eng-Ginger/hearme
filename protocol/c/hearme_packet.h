/*
 * hearme_packet.h - HearMe v1 BLE packet codec, header-only C99.
 * Mirrors protocol/python/hearme_protocol.py byte for byte (see SPEC.md).
 * No malloc, no external crypto: includes a small SHA-256 / HMAC-SHA256.
 */
#ifndef HEARME_PACKET_H
#define HEARME_PACKET_H

#include <stdint.h>
#include <stddef.h>
#include <string.h>

#define HM_COMPANY_ID       0xFFFFu
#define HM_VERSION          1u
#define HM_EPOCH_SECONDS    600u
#define HM_MAC_LEN          4u
#define HM_HEADER_LEN       8u
#define HM_POS_LEN          8u
#define HM_MAX_BODY         27u
#define HM_SPEED_UNKNOWN    0xFFu
#define HM_HEADING_UNKNOWN  0xFFu

#define HM_FLAG_BRAKING      0x01u
#define HM_FLAG_GPS_VALID    0x02u
#define HM_FLAG_HAS_POSITION 0x04u
#define HM_FLAG_REVERSING    0x08u

typedef enum {
    HM_E_BIKE = 0, HM_E_SCOOTER, HM_TUK_TUK, HM_CAR, HM_BUS,
    HM_BUS_STOP, HM_CROSSING, HM_SCHOOL_ZONE, HM_MOTORCYCLE, HM_TYPE_COUNT
} hm_type_t;

typedef enum { HM_DOOR_FRONT = 0, HM_DOOR_MIDDLE, HM_DOOR_REAR, HM_DOOR_UNKNOWN } hm_door_t;

typedef enum {
    HM_OK = 0, HM_ERR_SHORT = -1, HM_ERR_VERSION = -2, HM_ERR_TYPE = -3,
    HM_ERR_LENGTH = -4, HM_ERR_HEADING = -5, HM_ERR_INFRA_POS = -6, HM_ERR_BUF = -7
} hm_err_t;

static const char *const HM_TYPE_NAMES[HM_TYPE_COUNT] = {
    "e_bike", "e_scooter", "tuk_tuk", "car", "bus", "bus_stop", "crossing", "school_zone", "motorcycle"
};
static const char *const HM_DOOR_NAMES[4] = { "front", "middle", "rear", "unknown" };

typedef struct {
    uint8_t  version;
    uint8_t  type;           /* hm_type_t */
    uint8_t  rolling_id[4];
    uint8_t  speed_raw;      /* 0.1 m/s, 255 unknown */
    uint8_t  heading_raw;    /* deg/2, 255 unknown */
    uint8_t  braking, gps_valid, reversing, has_position;
    int32_t  lat_e7, lon_e7;
    char     route[7];       /* bus: NUL-terminated, <= 6 chars */
    uint8_t  door;           /* hm_door_t */
    uint8_t  ramp;
    uint16_t short_code;     /* infrastructure */
    char     name[13];       /* infrastructure: NUL-terminated, <= 12 chars */
    uint8_t  mac[4];
} hm_packet_t;

static inline int hm_is_infra(uint8_t t) { return t == HM_BUS_STOP || t == HM_CROSSING || t == HM_SCHOOL_ZONE; }

/* ------------------------------------------------------------------ SHA-256 */
typedef struct { uint32_t h[8]; uint8_t buf[64]; uint64_t len; size_t fill; } hm_sha256_t;

static const uint32_t HM_SHA_K[64] = {
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
};
#define HM_ROR(x, n) (((x) >> (n)) | ((x) << (32 - (n))))

static inline void hm_sha256_block(hm_sha256_t *s, const uint8_t *p) {
    uint32_t w[64], a, b, c, d, e, f, g, h; int i;
    for (i = 0; i < 16; i++) w[i] = ((uint32_t)p[4*i] << 24) | ((uint32_t)p[4*i+1] << 16) | ((uint32_t)p[4*i+2] << 8) | p[4*i+3];
    for (i = 16; i < 64; i++) {
        uint32_t s0 = HM_ROR(w[i-15], 7) ^ HM_ROR(w[i-15], 18) ^ (w[i-15] >> 3);
        uint32_t s1 = HM_ROR(w[i-2], 17) ^ HM_ROR(w[i-2], 19) ^ (w[i-2] >> 10);
        w[i] = w[i-16] + s0 + w[i-7] + s1;
    }
    a = s->h[0]; b = s->h[1]; c = s->h[2]; d = s->h[3]; e = s->h[4]; f = s->h[5]; g = s->h[6]; h = s->h[7];
    for (i = 0; i < 64; i++) {
        uint32_t t1 = h + (HM_ROR(e, 6) ^ HM_ROR(e, 11) ^ HM_ROR(e, 25)) + ((e & f) ^ (~e & g)) + HM_SHA_K[i] + w[i];
        uint32_t t2 = (HM_ROR(a, 2) ^ HM_ROR(a, 13) ^ HM_ROR(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
        h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
    }
    s->h[0] += a; s->h[1] += b; s->h[2] += c; s->h[3] += d; s->h[4] += e; s->h[5] += f; s->h[6] += g; s->h[7] += h;
}
static inline void hm_sha256_init(hm_sha256_t *s) {
    static const uint32_t iv[8] = {0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
    memcpy(s->h, iv, sizeof iv); s->len = 0; s->fill = 0;
}
static inline void hm_sha256_update(hm_sha256_t *s, const uint8_t *p, size_t n) {
    s->len += n;
    while (n--) { s->buf[s->fill++] = *p++; if (s->fill == 64) { hm_sha256_block(s, s->buf); s->fill = 0; } }
}
static inline void hm_sha256_final(hm_sha256_t *s, uint8_t out[32]) {
    uint64_t bits = s->len * 8; uint8_t pad = 0x80, zero = 0, lb[8]; int i;
    hm_sha256_update(s, &pad, 1);
    while (s->fill != 56) hm_sha256_update(s, &zero, 1);
    for (i = 0; i < 8; i++) lb[i] = (uint8_t)(bits >> (56 - 8 * i));
    hm_sha256_update(s, lb, 8);
    for (i = 0; i < 8; i++) { out[4*i] = (uint8_t)(s->h[i] >> 24); out[4*i+1] = (uint8_t)(s->h[i] >> 16); out[4*i+2] = (uint8_t)(s->h[i] >> 8); out[4*i+3] = (uint8_t)s->h[i]; }
}

/* HMAC-SHA256 over the concatenation of two message parts. */
static inline void hm_hmac2(const uint8_t *key, size_t klen, const uint8_t *m1, size_t n1,
                            const uint8_t *m2, size_t n2, uint8_t out[32]) {
    uint8_t k[64], pad[64], inner[32]; hm_sha256_t s; int i;
    memset(k, 0, 64);
    if (klen > 64) { hm_sha256_init(&s); hm_sha256_update(&s, key, klen); hm_sha256_final(&s, k); }
    else memcpy(k, key, klen);
    for (i = 0; i < 64; i++) pad[i] = k[i] ^ 0x36;
    hm_sha256_init(&s); hm_sha256_update(&s, pad, 64); hm_sha256_update(&s, m1, n1);
    if (n2) hm_sha256_update(&s, m2, n2);
    hm_sha256_final(&s, inner);
    for (i = 0; i < 64; i++) pad[i] = k[i] ^ 0x5c;
    hm_sha256_init(&s); hm_sha256_update(&s, pad, 64); hm_sha256_update(&s, inner, 32); hm_sha256_final(&s, out);
}

/* ------------------------------------------------------------------ helpers */
static inline uint32_t hm_epoch_of(double unix_s) { return (uint32_t)(unix_s / HM_EPOCH_SECONDS); }

static inline void hm_compute_mac(const uint8_t *key, size_t klen, uint32_t epoch,
                                  const uint8_t *body, size_t blen, uint8_t mac[4]) {
    uint8_t pre[10], full[32];
    pre[0] = 'H'; pre[1] = 'M'; pre[2] = 'v'; pre[3] = '1';
    pre[4] = (uint8_t)epoch; pre[5] = (uint8_t)(epoch >> 8); pre[6] = (uint8_t)(epoch >> 16); pre[7] = (uint8_t)(epoch >> 24);
    pre[8] = (uint8_t)(HM_COMPANY_ID & 0xFF); pre[9] = (uint8_t)(HM_COMPANY_ID >> 8);
    hm_hmac2(key, klen, pre, 10, body, blen, full);
    memcpy(mac, full, 4);
}

static inline void hm_rolling_id(const uint8_t *secret, size_t slen, uint32_t epoch, uint8_t id[4]) {
    uint8_t m[8], full[32];
    m[0] = 'H'; m[1] = 'M'; m[2] = 'i'; m[3] = 'd';
    m[4] = (uint8_t)epoch; m[5] = (uint8_t)(epoch >> 8); m[6] = (uint8_t)(epoch >> 16); m[7] = (uint8_t)(epoch >> 24);
    hm_hmac2(secret, slen, m, 8, NULL, 0, full);
    memcpy(id, full, 4);
}

static inline uint8_t hm_speed_to_raw(double mps) {
    double v = mps * 10.0 + 0.5; if (v < 0) v = 0; if (v > 254) v = 254; return (uint8_t)v;
}
static inline uint8_t hm_heading_to_raw(double deg) {
    while (deg < 0) deg += 360.0; while (deg >= 360.0) deg -= 360.0;
    return (uint8_t)(((int)(deg / 2.0 + 0.5)) % 180);
}

static inline void hm_put_i32(uint8_t *p, int32_t v) { uint32_t u = (uint32_t)v; p[0] = (uint8_t)u; p[1] = (uint8_t)(u >> 8); p[2] = (uint8_t)(u >> 16); p[3] = (uint8_t)(u >> 24); }
static inline int32_t hm_get_i32(const uint8_t *p) { return (int32_t)((uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24)); }

/* Encode manufacturer data (after company ID). Returns length or negative hm_err_t. */
static inline int hm_encode(const hm_packet_t *p, const uint8_t *key, size_t klen, uint32_t epoch,
                            uint8_t *out, size_t outcap) {
    uint8_t b[HM_MAX_BODY]; size_t n = 0, i; int infra; uint8_t flags; int haspos;
    if (p->type >= HM_TYPE_COUNT) return HM_ERR_TYPE;
    infra = hm_is_infra(p->type);
    haspos = p->has_position && !infra;
    flags = (uint8_t)((p->braking ? HM_FLAG_BRAKING : 0) | (p->gps_valid ? HM_FLAG_GPS_VALID : 0) |
                      (haspos ? HM_FLAG_HAS_POSITION : 0) | (p->reversing ? HM_FLAG_REVERSING : 0));
    b[n++] = (uint8_t)((HM_VERSION << 4) | p->type);
    memcpy(b + n, p->rolling_id, 4); n += 4;
    b[n++] = flags; b[n++] = p->speed_raw; b[n++] = p->heading_raw;
    if (haspos) { hm_put_i32(b + n, p->lat_e7); hm_put_i32(b + n + 4, p->lon_e7); n += 8; }
    if (p->type == HM_BUS) {
        for (i = 0; i < 6; i++) b[n + i] = 0;
        for (i = 0; i < 6 && p->route[i]; i++) b[n + i] = (uint8_t)p->route[i];
        n += 6;
        b[n++] = (uint8_t)((p->door & 3) | (p->ramp ? 4 : 0));
    } else if (infra) {
        b[n++] = (uint8_t)(p->short_code & 0xFF); b[n++] = (uint8_t)(p->short_code >> 8);
        for (i = 0; i < 12; i++) b[n + i] = 0;
        for (i = 0; i < 12 && p->name[i]; i++) b[n + i] = (uint8_t)p->name[i];
        n += 12;
    }
    if (n + HM_MAC_LEN > outcap) return HM_ERR_BUF;
    memcpy(out, b, n);
    hm_compute_mac(key, klen, epoch, b, n, out + n);
    return (int)(n + HM_MAC_LEN);
}

/* Full advertising data (single manufacturer AD structure). Returns length or error. */
static inline int hm_encode_adv(const hm_packet_t *p, const uint8_t *key, size_t klen, uint32_t epoch,
                                uint8_t *out, size_t outcap) {
    int n;
    if (outcap < 4) return HM_ERR_BUF;
    n = hm_encode(p, key, klen, epoch, out + 4, outcap - 4);
    if (n < 0) return n;
    out[0] = (uint8_t)(n + 3); out[1] = 0xFF; out[2] = (uint8_t)(HM_COMPANY_ID & 0xFF); out[3] = (uint8_t)(HM_COMPANY_ID >> 8);
    return n + 4;
}

/* Decode manufacturer data (after company ID). Does not verify the MAC. */
static inline int hm_decode(const uint8_t *d, size_t len, hm_packet_t *p) {
    size_t expected, off; uint8_t t, flags; int haspos, infra, i;
    memset(p, 0, sizeof *p);
    if (len < HM_HEADER_LEN + HM_MAC_LEN) return HM_ERR_SHORT;
    if ((d[0] >> 4) != HM_VERSION) return HM_ERR_VERSION;
    t = d[0] & 0x0F;
    if (t >= HM_TYPE_COUNT) return HM_ERR_TYPE;
    flags = d[5]; haspos = (flags & HM_FLAG_HAS_POSITION) != 0; infra = hm_is_infra(t);
    if (infra && haspos) return HM_ERR_INFRA_POS;
    expected = HM_HEADER_LEN + (haspos ? HM_POS_LEN : 0) + HM_MAC_LEN + (t == HM_BUS ? 7 : (infra ? 14 : 0));
    if (len != expected) return HM_ERR_LENGTH;
    p->version = HM_VERSION; p->type = t; memcpy(p->rolling_id, d + 1, 4);
    p->braking = (flags & HM_FLAG_BRAKING) != 0; p->gps_valid = (flags & HM_FLAG_GPS_VALID) != 0;
    p->reversing = (flags & HM_FLAG_REVERSING) != 0; p->has_position = (uint8_t)haspos;
    p->speed_raw = d[6]; p->heading_raw = d[7];
    if (p->heading_raw != HM_HEADING_UNKNOWN && p->heading_raw >= 180) return HM_ERR_HEADING;
    p->door = HM_DOOR_UNKNOWN;
    off = HM_HEADER_LEN;
    if (haspos) { p->lat_e7 = hm_get_i32(d + off); p->lon_e7 = hm_get_i32(d + off + 4); off += 8; }
    if (t == HM_BUS) {
        for (i = 0; i < 6 && d[off + i]; i++) p->route[i] = (char)(d[off + i] < 128 ? d[off + i] : '?');
        p->route[i] = 0; p->door = d[off + 6] & 3; p->ramp = (d[off + 6] & 4) != 0; off += 7;
    } else if (infra) {
        p->short_code = (uint16_t)(d[off] | (d[off + 1] << 8));
        for (i = 0; i < 12 && d[off + 2 + i]; i++) p->name[i] = (char)(d[off + 2 + i] < 128 ? d[off + 2 + i] : '?');
        p->name[i] = 0; off += 14;
    }
    memcpy(p->mac, d + off, 4);
    return HM_OK;
}

/* 1 if the MAC matches for any epoch within +-window. Constant-time compare per epoch. */
static inline int hm_verify(const uint8_t *d, size_t len, const uint8_t *key, size_t klen, uint32_t epoch, int window) {
    int w; uint8_t m[4];
    if (len < HM_MAC_LEN) return 0;
    for (w = -window; w <= window; w++) {
        uint8_t diff = 0; int i;
        hm_compute_mac(key, klen, (uint32_t)(epoch + (uint32_t)w), d, len - HM_MAC_LEN, m);
        for (i = 0; i < 4; i++) diff |= (uint8_t)(m[i] ^ d[len - HM_MAC_LEN + i]);
        if (!diff) return 1;
    }
    return 0;
}

/* Returns pointer into adv to HearMe manufacturer data (after company ID), sets *outlen. */
static inline const uint8_t *hm_parse_adv(const uint8_t *adv, size_t len, size_t *outlen) {
    size_t i = 0;
    while (i < len) {
        uint8_t ln = adv[i];
        if (ln == 0 || i + 1 + ln > len) return NULL;
        if (adv[i + 1] == 0xFF && ln >= 3 && (adv[i + 2] | (adv[i + 3] << 8)) == HM_COMPANY_ID) {
            *outlen = (size_t)ln - 3; return adv + i + 4;
        }
        i += 1u + ln;
    }
    return NULL;
}

static const uint8_t HM_TEST_FLEET_KEY[32] = {
    0x48,0x65,0x61,0x72,0x24,0xd6,0x50,0xa1,0xc3,0xe7,0x9f,0x0b,0x8a,0x2d,0x5e,0x6f,
    0x1b,0x3c,0x4d,0x5e,0x6f,0x70,0x81,0x92,0xa3,0xb4,0xc5,0xd6,0xe7,0xf8,0x09,0x10
};

#endif /* HEARME_PACKET_H */
