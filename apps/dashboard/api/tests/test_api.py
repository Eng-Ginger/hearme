import csv
import io

import pytest
from fastapi.testclient import TestClient

from apps.dashboard.api import synthetic
from apps.dashboard.api.grid import cell_center, cell_id_for
from apps.dashboard.api.main import K_MIN, create_app
from apps.dashboard.api.seed import load_counts_csv, load_pois_json, seed

SCHOOL = {"name": "Synthetic School A", "kind": "school", "lat": 25.4055, "lon": 55.5135}
STOP = {"name": "Synthetic Stop 1", "kind": "bus_stop", "lat": 25.4105, "lon": 55.5185}


def rec(cell_id, hour=8, fast=5, urgent=0):
    return {"cell_id": cell_id, "hour": hour, "fast_passes": fast, "urgent_alerts": urgent}


# ---- ingest -------------------------------------------------------------------
def test_ingest_ok_and_upsert_adds(client):
    r = client.post("/api/ingest", json={"records": [rec("25405_55513", 8, 4, 1)]})
    assert r.status_code == 200, r.text
    assert r.json() == {"accepted": 1, "cells": 1}
    # bare list form, same bucket: counts are added, not replaced
    r = client.post("/api/ingest", json=[rec("25405_55513", 8, 2, 1), rec("25406_55513", 9, 7, 0)])
    assert r.status_code == 200
    cells = {c["cell_id"]: c for c in client.get("/api/cells").json()["cells"]}
    assert cells["25405_55513"]["fast_passes"] == 6
    assert cells["25405_55513"]["urgent_alerts"] == 2
    assert cells["25406_55513"]["fast_passes"] == 7
    lat, lon = cell_center("25405_55513")
    assert cells["25405_55513"]["lat"] == pytest.approx(25.4055)
    assert cells["25405_55513"]["lon"] == pytest.approx(55.5135)
    assert (lat, lon) == (25.4055, 55.5135)


@pytest.mark.parametrize("extra", [
    {"device_id": "abc123"},
    {"rolling_id": "0x1f2e"},
    {"lat": 25.405123, "lon": 55.513456},
    {"timestamp": "2027-03-01T08:15:00Z"},
])
def test_ingest_rejects_identifying_fields(client, extra):
    r = client.post("/api/ingest", json={"records": [{**rec("25405_55513"), **extra}]})
    assert r.status_code == 422
    r = client.post("/api/ingest", json=[{**rec("25405_55513"), **extra}])
    assert r.status_code == 422
    # nothing was stored
    assert client.get("/api/meta").json()["counts"]["rows"] == 0


def test_ingest_rejects_extra_top_level_field(client):
    r = client.post("/api/ingest", json={"records": [rec("25405_55513")], "device": "x"})
    assert r.status_code == 422


@pytest.mark.parametrize("bad", [
    rec("cell-7"), rec("25405,55513"), rec("25405_55513", hour=24), rec("25405_55513", hour=-1),
    rec("25405_55513", fast=-1), rec("25405_55513", urgent=-2), rec("25405_55513", fast=1.5),
    rec("25405_55513", fast="3"), rec("99999_55513"),
])
def test_ingest_validation(client, bad):
    assert client.post("/api/ingest", json={"records": [bad]}).status_code == 422


# ---- suppression --------------------------------------------------------------
def test_small_cells_are_suppressed(client):
    client.post("/api/ingest", json=[
        rec("25405_55513", 8, 1, 0),   # total 1 -> hidden
        rec("25405_55514", 8, 1, 1),   # total 2 -> hidden
        rec("25405_55515", 8, 2, 1),   # total 3 -> shown
        rec("25405_55516", 8, 10, 0),
    ])
    body = client.get("/api/cells").json()
    ids = {c["cell_id"] for c in body["cells"]}
    assert ids == {"25405_55515", "25405_55516"}
    assert body["suppressed_cells"] == 2
    assert body["min_total"] == K_MIN
    # asking for min=0 cannot go below the k-anonymity floor
    assert {c["cell_id"] for c in client.get("/api/cells?min=0").json()["cells"]} == ids
    # raising the threshold is allowed
    assert {c["cell_id"] for c in client.get("/api/cells?min=5").json()["cells"]} == {"25405_55516"}
    # per-hour view applies the threshold to that hour's totals
    client.post("/api/ingest", json=[rec("25405_55516", 9, 1, 0)])
    h9 = client.get("/api/cells?hour=9").json()
    assert h9["cells"] == [] and h9["suppressed_cells"] == 1
    # suppressed cells never appear in the export either
    text = client.get("/api/export.csv").text
    assert "25405_55513" not in text and "25405_55514" not in text


# ---- ranking ------------------------------------------------------------------
def test_top_ranking_order(client, store):
    store.replace_pois([SCHOOL, STOP])
    school_cell = cell_id_for(SCHOOL["lat"], SCHOOL["lon"])   # distance 0
    stop_cell = cell_id_for(STOP["lat"], STOP["lon"])         # distance 0
    far_cell = "25390_55490"                                  # > 150 m from both
    client.post("/api/ingest", json=[
        rec(school_cell, 8, 10, 0),   # 10 * 2 * 1.25 = 25
        rec(stop_cell, 8, 10, 2),     # (10 + 6) * 2 * 1.0 = 32
        rec(far_cell, 8, 500, 50),    # busy but not near a school/stop: not ranked
    ])
    body = client.get("/api/top?limit=10").json()
    top = body["top"]
    assert [t["cell_id"] for t in top] == [stop_cell, school_cell]
    assert [t["rank"] for t in top] == [1, 2]
    assert top[0]["score"] == pytest.approx(32.0)
    assert top[1]["score"] == pytest.approx(25.0)
    assert top[0]["nearest_poi"] == "Synthetic Stop 1"
    assert top[0]["intervention"] == "Speed hump + signage"
    assert top[1]["intervention"] == "Raised zebra crossing"
    assert top[1]["distance_m"] < 1
    # urgent alerts outweigh fast passes
    client.post("/api/ingest", json=[rec(school_cell, 9, 0, 4)])  # +12 raw -> (22)*2*1.25 = 55
    assert client.get("/api/top").json()["top"][0]["cell_id"] == school_cell
    assert len(client.get("/api/top?limit=1").json()["top"]) == 1


def test_proximity_weighting(client, store):
    store.replace_pois([SCHOOL])
    near = cell_id_for(SCHOOL["lat"], SCHOOL["lon"])
    lat_i, lon_i = (int(x) for x in near.split("_"))
    next_door = f"{lat_i + 1}_{lon_i}"  # ~111 m away
    client.post("/api/ingest", json=[rec(near, 8, 10, 0), rec(next_door, 8, 10, 0)])
    top = client.get("/api/top").json()["top"]
    assert [t["cell_id"] for t in top] == [near, next_door]
    assert 100 < top[1]["distance_m"] < 150


# ---- csv export ---------------------------------------------------------------
def test_csv_export(client, store):
    store.replace_pois([SCHOOL, STOP])
    school_cell = cell_id_for(SCHOOL["lat"], SCHOOL["lon"])
    client.post("/api/ingest", json=[rec(school_cell, 8, 10, 1), rec("25390_55490", 8, 6, 0)])
    r = client.get("/api/export.csv")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    lines = r.text.splitlines()
    assert lines[0].startswith("# SYNTHETIC DATA")
    rows = list(csv.DictReader(io.StringIO("\n".join(lines[1:]))))
    assert [row["cell_id"] for row in rows] == [school_cell, "25390_55490"]
    assert rows[0]["rank"] == "1" and rows[0]["intervention"] == "Raised zebra crossing"
    assert rows[0]["total"] == "11"
    assert rows[1]["rank"] == ""  # not near a POI


# ---- meta, pois, seeding ------------------------------------------------------
def test_meta_and_pois(client, store):
    store.replace_pois([SCHOOL])
    meta = client.get("/api/meta").json()
    assert meta["synthetic"] is True
    assert "SYNTHETIC" in meta["notice"]
    assert meta["k_anonymity_min_total"] == K_MIN
    assert client.get("/api/pois").json()["pois"][0]["name"] == "Synthetic School A"


def test_fallback_seed(store, tmp_path):
    summary = seed(store, counts_csv=tmp_path / "missing.csv", pois_json=tmp_path / "missing.json")
    assert "fallback" in summary["counts_source"]
    assert summary["seed_rows"] > 100
    client = TestClient(create_app(store, seed_on_startup=False, web_dist=None))
    assert len(client.get("/api/cells").json()["cells"]) > 50
    assert len(client.get("/api/top").json()["top"]) == 10
    assert all(p["name"].startswith("Synthetic") for p in client.get("/api/pois").json()["pois"])


def test_csv_and_json_loader(tmp_path):
    csv_path = tmp_path / "c.csv"
    csv_path.write_text(
        "cell_id,lat,lon,hour,fast_passes,urgent_alerts\n"
        "r3_c7,25.4055,55.5135,8,4,1\n"     # sim-specific id: cell derived from lat/lon
        "x,25.4065,55.5135,25,4,1\n",       # bad hour: skipped
        encoding="utf-8")
    assert load_counts_csv(csv_path) == [("25405_55513", 8, 4, 1)]
    json_path = tmp_path / "p.json"
    json_path.write_text(
        '{"schools":[{"name":"Synthetic School A","lat":25.4,"lon":55.5}],'
        '"bus_stops":[{"name":"Synthetic Stop 1","lat":25.41,"lon":55.51,"kind":"bus_stop"}]}',
        encoding="utf-8")
    kinds = sorted(p["kind"] for p in load_pois_json(json_path))
    assert kinds == ["bus_stop", "school"]


def test_startup_seeds_empty_db(store):
    # seeds from the simulation CSV if present, else from the fallback generator
    with TestClient(create_app(store, web_dist=None)) as c:
        meta = c.get("/api/meta").json()
        assert meta["counts"]["rows"] > 0
        assert meta["data_source"]
    assert len(synthetic.fallback_pois()) == 12
