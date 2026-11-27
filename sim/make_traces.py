"""Generate cross-language receiver traces in tests/traces/.

Each trace is a deterministic, seeded recording of what a receiver hears:
pose updates, raw packets (integer RSSI + payload hex) and 10 Hz ticks.
The Python receiver's output is stored as the expected result; the TS and C
receivers must reproduce it exactly (tests/cross_language/run_all.py).

Run:  python sim/make_traces.py
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "protocol", "python"))
import hearme_protocol as hp  # noqa: E402
from receiver import run_trace  # noqa: E402
from world import T0, Beacon, Channel, Vehicle, rel_angle, to_latlon  # noqa: E402

OUT = os.path.join(HERE, "..", "tests", "traces")
PED = (0.0, -4.5)       # south kerb of an east-west road, lanes at y = -1.75 / +1.75
PED_HEADING = 0.0       # facing north, about to cross


def build(name, vehicles, duration, seed, config=None, gps=True, loss=0.10, body_db=10.0,
          spoof=None, ped=PED, ped_heading=PED_HEADING, description="", pose_acc=None, outage=None):
    rng = np.random.default_rng(seed)
    chan = Channel(rng, loss=loss, body_db=body_db)
    beacons = [Beacon(v, rng, gps=gps and not v.infra) for v in vehicles]
    lat, lon = to_latlon(*ped)
    events = [{"k": "pose", "t": T0, "lat": lat, "lon": lon, "heading": ped_heading}]
    if pose_acc is not None:
        events[0]["acc"] = pose_acc
    t, tick_next = 0.0, 0.0
    while t < duration:
        # next event: earliest adv or tick
        nb = min(beacons, key=lambda b: b.next_adv)
        if tick_next <= nb.next_adv:
            t = tick_next
            events.append({"k": "tick", "t": round(T0 + t, 3)})
            tick_next = round(tick_next + 0.1, 3)
            continue
        t = nb.next_adv
        nb.next_adv += 0.100 + rng.uniform(0, 0.010)
        if t < nb.v.t_start:
            continue
        if outage and outage[0] <= t < outage[1]:
            continue   # radio outage (e.g. a truck blocks the path): no packets

        x, y, _ = nb.v.state(t)
        d = float(np.hypot(x - ped[0], y - ped[1]))
        r = chan.rssi(id(nb), t, d, rel_angle(ped, ped_heading, x, y))
        if r is None:
            continue
        pkt = nb.packet(t)
        tt = round(T0 + t, 4)
        payload = hp.encode(pkt, hp.TEST_FLEET_KEY, hp.epoch_of(tt))
        events.append({"k": "pkt", "t": tt, "rssi": int(round(r)), "hex": payload.hex()})
        if spoof and rng.random() < 0.5:
            fake = hp.Packet("e_bike", "5900f000", speed_raw=80, heading_raw=45, gps_valid=True,
                             lat_e7=int(lat * 1e7) + 30, lon_e7=int(lon * 1e7) - 300)
            events.append({"k": "pkt", "t": round(tt + 0.0005, 4), "rssi": -60,
                           "hex": hp.encode(fake, b"attacker-key", hp.epoch_of(tt)).hex()})
    events.sort(key=lambda e: (e["t"], 0 if e["k"] == "pose" else 1))
    cfg = {"fleet_key_hex": hp.TEST_FLEET_KEY.hex()}
    cfg.update(config or {})
    trace = {"name": name, "description": description, "config": cfg, "events": events}
    trace["expected"] = run_trace(trace)
    return trace


def write_line_format(trace, path):
    """Plain-text form for the C runner (no JSON parser on the MCU side)."""
    c = trace["config"]
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        for k, v in c.items():
            if k == "fleet_key_hex":
                f.write(f"KEY {v}\n")
            else:
                f.write(f"CFG {k} {int(v) if isinstance(v, bool) else v!r}\n")
        for e in trace["events"]:
            if e["k"] == "pose":
                acc = f" {e['acc']!r}" if e.get("acc") is not None else ""
                f.write(f"POSE {e['lat']!r} {e['lon']!r} {e['heading']!r}{acc}\n")
            elif e["k"] == "pkt":
                f.write(f"PKT {e['t']!r} {e['rssi']} {e['hex']}\n")
            else:
                f.write(f"TICK {e['t']!r}\n")


def scenarios():
    yield build("ebike_left_gps", [Vehicle("e_bike", (-80, -1.75), 90, 7.0, secret=b"bike-a")],
                16, 1, description="Silent e-bike from the left in the near lane, GPS on.")
    yield build("escooter_right_rssi_only",
                [Vehicle("e_scooter", (70, 1.75), 270, 6.0, secret=b"scoot-b")], 16, 2,
                config={"use_position": False}, gps=False,
                description="E-scooter from the right, far lane, no GPS: RSSI-only warning.")
    yield build("bus_arrival", [
        Vehicle("bus", (-120, -1.75), 90, 9.0, secret=b"bus-12", stop_at_m=58, decel=0.67,
                route="12", door="front"),
        Vehicle("bus_stop", (6, -5.5), 90, 0, secret=b"stop-101", name="Al Jurf Stop", short_code=101),
    ], 24, 3, description="Bus 12 decelerates into the stop next to the pedestrian; stop beacon nearby.")
    yield build("two_bikes_both_sides", [
        Vehicle("e_bike", (-90, -1.75), 90, 7.5, secret=b"bike-l"),
        Vehicle("e_scooter", (75, 1.75), 270, 6.5, t_start=1.5, secret=b"scoot-r"),
    ], 18, 4, description="E-bike from the left and e-scooter from the right at nearly the same time.")
    yield build("parked_and_parallel", [
        Vehicle("e_bike", (5, -6.5), 0, 0.0, secret=b"parked"),
        Vehicle("e_bike", (-60, 25), 90, 7.0, secret=b"parallel"),
        Vehicle("crossing", (0, -4.0), 0, 0, secret=b"xing-7", name="School Xing", short_code=7),
    ], 18, 5, description="Parked e-bike and an e-bike on a parallel street 25 m away: no warnings.")
    yield build("lossy_pocket_tuktuk", [Vehicle("tuk_tuk", (-70, -1.75), 90, 6.0, secret=b"tuk-1")],
                16, 6, loss=0.4, body_db=14.0,
                description="40 % packet loss and 14 dB body blocking (phone in pocket).")
    yield build("spoof_rejected", [Vehicle("e_bike", (60, 1.75), 270, 7.0, secret=b"real")], 14, 7,
                config={"require_mac": True}, spoof=True,
                description="Attacker floods fake e-bike packets with a wrong key; require_mac drops them.")
    # v1.1 receiver fixes ----------------------------------------------------------------
    yield build("slow_walker_crossing", [Vehicle("e_bike", (-110, -1.75), 90, 7.0, secret=b"slow-w")], 18, 8,
                config={"walk_speed_mps": 0.7},
                description="Crossing-aware warning: slow walker (0.7 m/s) -> warn at 7/0.7+2 = 12 s, urgent 6 s.")
    yield build("far_lane_poor_gps", [Vehicle("e_scooter", (80, 1.75), 270, 6.5, secret=b"far-lane")], 16, 9,
                pose_acc=12.0,
                description="Far-lane rider with a poor pedestrian GPS fix (12 m): adaptive pass radius + warn hold.")
    yield build("reescalation_after_outage", [Vehicle("e_bike", (-90, -1.75), 90, 5.0, secret=b"outage")], 24, 10,
                outage=(9.6, 12.6),
                description="Packets stop for 3.2 s (stale -> ignore), then resume: the re-escalation must alert again.")
    yield build("hysteresis_units", [Vehicle("e_bike", (-70, -1.75), 90, 7.0, secret=b"hyst")], 14, 11,
                config={"hysteresis_s": 0.5, "hysteresis_m": 4.0},
                description="Separate time (s) and distance (m) hysteresis margins.")


def main():
    os.makedirs(OUT, exist_ok=True)
    for tr in scenarios():
        with open(os.path.join(OUT, tr["name"] + ".json"), "w", encoding="utf-8") as f:
            json.dump(tr, f, ensure_ascii=False)
        write_line_format(tr, os.path.join(OUT, tr["name"] + ".txt"))
        n_pkt = sum(1 for e in tr["events"] if e["k"] == "pkt")
        print(f"{tr['name']:26s} {n_pkt:4d} packets -> {len(tr['expected'])} events")
        for e in tr["expected"]:
            print(f"     t+{e['t'] - T0:6.2f}s {e['kind']:15s} {e['text_en']}  |  {e['text_ar']}")


if __name__ == "__main__":
    main()
