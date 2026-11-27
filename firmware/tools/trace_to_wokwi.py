"""Convert a tests/traces trace into wristband_wokwi serial-injection lines.

Output format (one command per line, see firmware/README.md):
    TIME <unix>                 set the wristband clock
    POSE <lat> <lon> <heading>  pedestrian pose
    PKT <rssi> <hex>            one received advertisement (t = wristband clock now)
    # ...                       comment (ignored by the firmware)

Each PKT is preceded by TIME <t of that packet>, so the receiver sees the same
timestamps as the trace even if the lines arrive in a burst (pasted into the
serial monitor). Trace TICKs are dropped: the firmware ticks itself at 10 Hz.

Usage:
    python firmware/tools/trace_to_wokwi.py tests/traces/ebike_left_gps.json -o firmware/wokwi/inject_example.txt
    # stream in real time to the simulator's RFC2217 serial port (wokwi.toml: rfc2217ServerPort = 4000)
    python firmware/tools/trace_to_wokwi.py tests/traces/ebike_left_gps.json --send rfc2217://localhost:4000
    # or to a real board flashed with wristband_wokwi:  --send COM5
"""
from __future__ import annotations

import argparse
import json
import sys
import time


def load_events(path):
    if path.endswith(".json"):
        with open(path, encoding="utf-8") as f:
            tr = json.load(f)
        return tr.get("name", path), tr["events"], tr.get("expected", [])
    events = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            p = line.split()
            if not p:
                continue
            if p[0] == "POSE":
                events.append({"k": "pose", "lat": float(p[1]), "lon": float(p[2]), "heading": float(p[3])})
            elif p[0] == "PKT":
                events.append({"k": "pkt", "t": float(p[1]), "rssi": int(p[2]), "hex": p[3]})
            elif p[0] == "TICK":
                events.append({"k": "tick", "t": float(p[1])})
    return path, events, []


def to_lines(name, events, expected):
    """Yield (t or None, line)."""
    yield None, f"# HearMe trace {name}: TIME before each PKT reproduces the trace timestamps"
    t_last = None
    for e in events:
        if e["k"] == "pose":
            yield t_last, f"POSE {e['lat']!r} {e['lon']!r} {e['heading']!r}"
        elif e["k"] == "pkt":
            t_last = e["t"]
            yield e["t"], f"TIME {e['t']!r}"
            yield e["t"], f"PKT {e['rssi']} {e['hex']}"
    for ev in expected:
        yield None, f"# expected: t={ev['t']!r} {ev['kind']} {ev['text_en']}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("trace", help="tests/traces/<name>.json or .txt")
    ap.add_argument("-o", "--out", help="write lines to this file (default: stdout)")
    ap.add_argument("--send", help="stream in real time to a serial port / pyserial URL (needs pyserial)")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--speed", type=float, default=1.0, help="replay speed factor for --send")
    a = ap.parse_args()
    name, events, expected = load_events(a.trace)
    lines = list(to_lines(name, events, expected))

    if a.send:
        import serial  # pyserial
        port = serial.serial_for_url(a.send, baudrate=a.baud, timeout=0)
        t0_trace = next((t for t, _ in lines if t is not None), 0.0)
        t0 = time.monotonic()
        for t, line in lines:
            if line.startswith("#"):
                continue
            if t is not None:
                delay = (t - t0_trace) / a.speed - (time.monotonic() - t0)
                if delay > 0:
                    time.sleep(delay)
            port.write((line + "\n").encode("ascii"))
            got = port.read(4096)
            if got:
                sys.stdout.write(got.decode("utf-8", "replace"))
        end = time.monotonic() + 3.0
        while time.monotonic() < end:
            got = port.read(4096)
            if got:
                sys.stdout.write(got.decode("utf-8", "replace"))
            time.sleep(0.05)
        return 0

    text = "\n".join(l for _, l in lines) + "\n"
    if a.out:
        with open(a.out, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        print(f"wrote {sum(1 for _, l in lines if l.startswith('PKT'))} packets to {a.out}")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
