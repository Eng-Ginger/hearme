"""Generate protocol/test_vectors.json from the Python reference codec.

Run:  python protocol/tools/gen_vectors.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "python"))
import hearme_protocol as hp  # noqa: E402

EPOCH = hp.epoch_of(1_800_000_000)   # fixed epoch for reproducibility
AJMAN_LAT, AJMAN_LON = 254052000, 555136000   # ~25.4052 N, 55.5136 E (Ajman)

valid = [
    ("ebike_gps", hp.Packet("e_bike", hp.rolling_id_for(b"bike-001", EPOCH),
                            speed_raw=hp.speed_to_raw(7.2), heading_raw=hp.heading_to_raw(90),
                            gps_valid=True, lat_e7=AJMAN_LAT, lon_e7=AJMAN_LON - 300)),
    ("ebike_braking_no_gps", hp.Packet("e_bike", "00a1b2c3", speed_raw=55,
                                        heading_raw=hp.HEADING_UNKNOWN, braking=True)),
    ("escooter_gps", hp.Packet("e_scooter", "deadbeef", speed_raw=62, heading_raw=135,
                               gps_valid=True, lat_e7=AJMAN_LAT + 150, lon_e7=AJMAN_LON + 220)),
    ("tuktuk_reversing", hp.Packet("tuk_tuk", "01020304", speed_raw=8, heading_raw=0,
                                   reversing=True, gps_valid=True,
                                   lat_e7=-1234567, lon_e7=-987654321)),
    ("car_unknown_speed", hp.Packet("car", "ffffffff")),
    ("bus_route12_gps", hp.Packet("bus", hp.rolling_id_for(b"bus-12-a", EPOCH), speed_raw=45,
                                  heading_raw=hp.heading_to_raw(270), gps_valid=True,
                                  lat_e7=AJMAN_LAT + 40, lon_e7=AJMAN_LON + 900,
                                  route="12", door="front", ramp=True)),
    ("bus_long_route_no_gps", hp.Packet("bus", "0badc0de", speed_raw=0, heading_raw=10,
                                        route="E400X1", door="middle")),
    ("bus_stop", hp.Packet("bus_stop", "5709aa01", speed_raw=0, heading_raw=45,
                           short_code=101, name="Al Jurf Stop")),
    ("crossing", hp.Packet("crossing", "c0055001", speed_raw=0, heading_raw=0,
                           short_code=7, name="School Xing")),
    ("school_zone_long_name", hp.Packet("school_zone", "5c400001", speed_raw=0,
                                        heading_raw=hp.HEADING_UNKNOWN, short_code=65535,
                                        name="Al Nuaimiya Primary")),   # truncated to 12
    ("motorcycle_max_speed", hp.Packet("motorcycle", "12345678", speed_raw=254, heading_raw=179,
                                       gps_valid=False, lat_e7=AJMAN_LAT, lon_e7=AJMAN_LON)),
]

vectors = []
for name, p in valid:
    payload = hp.encode(p, hp.TEST_FLEET_KEY, EPOCH)
    adv = hp.encode_adv(p, hp.TEST_FLEET_KEY, EPOCH)
    dec = hp.decode(payload)
    vectors.append({
        "name": name, "valid": True, "epoch": EPOCH,
        "fields": dec.fields(), "payload_hex": payload.hex(), "adv_hex": adv.hex(),
        "mac_hex": dec.mac, "length": len(payload),
    })

base = bytes.fromhex(vectors[0]["payload_hex"])
bad_mac = bytearray(base); bad_mac[-1] ^= 0x01
invalid = [
    ("too_short", base[:10], "decode"),
    ("bad_version", bytes([0x20 | base[0] & 0x0F]) + base[1:], "decode"),
    ("bad_type", bytes([0x1F]) + base[1:], "decode"),
    ("bad_length", base + b"\x00", "decode"),
    ("bad_heading", base[:7] + bytes([200]) + base[8:], "decode"),
    ("bad_mac", bytes(bad_mac), "mac"),
    ("wrong_epoch_far", base, "mac_far_epoch"),
]
for name, data, kind in invalid:
    vectors.append({"name": name, "valid": False, "failure": kind,
                    "epoch": EPOCH + (5 if kind == "mac_far_epoch" else 0),
                    "payload_hex": data.hex()})

# ---- v1.1 scan response (service UUID), checked by has_hearme_uuid()
sr = hp.encode_scan_response()
uuid_be = bytes.fromhex(hp.SERVICE_UUID.replace("-", ""))
other_uuid = bytes(range(16))
sr_cases = [
    ("hearme_scan_response", sr, True),
    ("flags_then_uuid", bytes([0x02, 0x01, 0x06]) + sr, True),
    ("incomplete_list_0x06", bytes([0x11, 0x06]) + hp.SERVICE_UUID_LE, True),
    ("uuid_second_in_list", bytes([0x21, 0x07]) + other_uuid + hp.SERVICE_UUID_LE, True),
    ("uuid_big_endian", bytes([0x11, 0x07]) + uuid_be, False),
    ("other_uuid", bytes([0x11, 0x07]) + other_uuid, False),
    ("one_byte_changed", sr[:-1] + bytes([sr[-1] ^ 0x01]), False),
    ("uuid_in_manufacturer_data", bytes([0x13, 0xFF, 0xFF, 0xFF]) + hp.SERVICE_UUID_LE, False),
    ("truncated", sr[:10], False),
    ("bad_list_length", bytes([0x12, 0x07]) + hp.SERVICE_UUID_LE + bytes([0]), False),
    ("v1_adv_packet", bytes.fromhex(vectors[0]["adv_hex"]), False),
    ("empty", b"", False),
]
for name, data, want in sr_cases:
    assert hp.has_hearme_uuid(data) == want, name
scan_response = {
    "description": "v1.1 scan response: one 'Complete List of 128-bit Service UUIDs' AD "
                   "(type 0x07), UUID bytes little-endian. The main advertising packet "
                   "(adv_hex above) is unchanged.",
    "service_uuid": hp.SERVICE_UUID, "uuid_le_hex": hp.SERVICE_UUID_LE.hex(),
    "scan_response_hex": sr.hex(), "length": len(sr),
    "cases": [{"name": n, "data_hex": d.hex(), "has_hearme_uuid": w} for n, d, w in sr_cases],
}

out = {
    "description": "HearMe v1 shared test vectors. Generated by protocol/tools/gen_vectors.py "
                   "from the Python reference codec. payload_hex = manufacturer data after the "
                   "2-byte company ID; adv_hex = complete legacy advertising data.",
    "company_id": hp.COMPANY_ID, "fleet_key_hex": hp.TEST_FLEET_KEY.hex(),
    "epoch_seconds": hp.EPOCH_SECONDS, "vectors": vectors,
    "scan_response": scan_response,
}
path = os.path.join(HERE, "..", "test_vectors.json")
with open(path, "w", encoding="utf-8") as f:
    json.dump(out, f, indent=2)
print(f"wrote {len(vectors)} vectors -> {os.path.normpath(path)}")
for v in vectors:
    if v["valid"]:
        print(f"  {v['name']:24s} {v['length']:2d} bytes")
print(f"scan response {len(sr)} bytes: {sr.hex()} ({len(sr_cases)} cases)")
