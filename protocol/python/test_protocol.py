"""Python codec tests against protocol/test_vectors.json.  Run: python -m pytest protocol/python"""
import json
import os

import hearme_protocol as hp

VEC = json.load(open(os.path.join(os.path.dirname(__file__), "..", "test_vectors.json"), encoding="utf-8"))
KEY = bytes.fromhex(VEC["fleet_key_hex"])


def test_valid_vectors_roundtrip():
    for v in VEC["vectors"]:
        if not v["valid"]:
            continue
        data = bytes.fromhex(v["payload_hex"])
        p = hp.decode(data)
        assert p.fields() == v["fields"], v["name"]
        assert hp.encode(p, KEY, v["epoch"]).hex() == v["payload_hex"], v["name"]
        assert hp.encode_adv(p, KEY, v["epoch"]).hex() == v["adv_hex"], v["name"]
        assert len(bytes.fromhex(v["adv_hex"])) <= 31
        assert hp.verify(data, KEY, v["epoch"])
        assert hp.parse_adv(bytes.fromhex(v["adv_hex"])) == data


def test_invalid_vectors():
    for v in VEC["vectors"]:
        if v["valid"]:
            continue
        data = bytes.fromhex(v["payload_hex"])
        if v["failure"] == "decode":
            try:
                hp.decode(data)
            except hp.DecodeError:
                continue
            raise AssertionError("expected decode error: " + v["name"])
        hp.decode(data)
        assert not hp.verify(data, KEY, v["epoch"]), v["name"]


def test_rolling_id_changes_each_epoch():
    a = hp.rolling_id_for(b"secret", 100)
    assert a == hp.rolling_id_for(b"secret", 100)
    assert a != hp.rolling_id_for(b"secret", 101)


def test_conversions():
    assert hp.speed_to_raw(7.25) == 73 and hp.speed_to_raw(99) == 254 and hp.speed_to_raw(None) == 255
    assert hp.heading_to_raw(359.5) == 0 and hp.heading_to_raw(-90) == 135


def test_scan_response_vector():
    sr = VEC["scan_response"]
    out = hp.encode_scan_response()
    assert out.hex() == sr["scan_response_hex"]
    assert len(out) == sr["length"] == hp.SCAN_RESPONSE_LEN <= 31
    assert sr["service_uuid"] == hp.SERVICE_UUID
    assert hp.SERVICE_UUID_LE.hex() == sr["uuid_le_hex"]
    assert out[0] == 17 and out[1] == 0x07


def test_scan_response_cases():
    for c in VEC["scan_response"]["cases"]:
        assert hp.has_hearme_uuid(bytes.fromhex(c["data_hex"])) == c["has_hearme_uuid"], c["name"]
        assert hp.parse_scan_response(bytes.fromhex(c["data_hex"])) == c["has_hearme_uuid"], c["name"]


def test_main_packet_has_no_uuid_and_scan_response_has_no_packet():
    sr = hp.encode_scan_response()
    assert hp.parse_adv(sr) is None
    for v in VEC["vectors"]:
        if v["valid"]:
            assert not hp.has_hearme_uuid(bytes.fromhex(v["adv_hex"])), v["name"]
