"""Cross-language check: Python reference vs C (and TypeScript if present).

For every tests/traces/<name>.json:
  * Python : sim/receiver.run_trace(trace)            (the reference)
  * stored : trace["expected"]                        (sanity: traces up to date)
  * C      : build/run_trace.exe <name>.txt           (firmware/lib/hearme_receiver)
  * TS     : npx tsx packages/receiver-core/scripts/run_trace.ts <name>.json  (if it exists)
Events must match exactly; t may differ by < 1e-9.
Also builds and runs the C codec test protocol/c/test/test_packet.c.

Run from anywhere:  python tests/cross_language/run_all.py
Needs a C compiler: uses `python -m ziglang cc` (pip install ziglang), or $CC.
"""
from __future__ import annotations

import glob
import json
import os
import shlex
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "sim"))
from receiver import run_trace  # noqa: E402

BUILD = os.path.join(ROOT, "build")
EXE = ".exe" if os.name == "nt" else ""
FIELDS = ["id", "kind", "type", "side", "seconds", "urgency", "text_en", "text_ar"]


def cc_cmd():
    if os.environ.get("CC"):
        return shlex.split(os.environ["CC"])
    return [sys.executable, "-m", "ziglang", "cc"]


def build(out, sources, includes):
    os.makedirs(BUILD, exist_ok=True)
    cmd = cc_cmd() + ["-std=c99", "-O2", "-Wall", "-Wextra", "-ffp-contract=off"]
    cmd += ["-I" + os.path.join(ROOT, i) for i in includes]
    cmd += [os.path.join(ROOT, s) for s in sources] + ["-o", out]
    if os.name != "nt":
        cmd.append("-lm")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print("BUILD FAILED:", " ".join(cmd))
        print(r.stdout, r.stderr)
        return False
    if r.stderr.strip():
        print(r.stderr.strip())
    return True


def compare(ref, got):
    """Return None if equal, else a short description of the first difference."""
    if len(ref) != len(got):
        return f"event count {len(got)} != {len(ref)}"
    for i, (a, b) in enumerate(zip(ref, got)):
        if not (a["t"] == b["t"] or abs(a["t"] - b["t"]) < 1e-9):
            return f"event {i}: t {b['t']!r} != {a['t']!r}"
        for k in FIELDS:
            if a.get(k) != b.get(k):
                return f"event {i}: {k} {b.get(k)!r} != {a.get(k)!r}"
    return None


def run_c(exe, txt):
    r = subprocess.run([exe, txt], capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode("utf-8", "replace"))
    return [json.loads(l) for l in r.stdout.decode("utf-8").splitlines() if l.strip()]


VARIANTS = [  # extra config variants (C vs Python only) to exercise eviction, hysteresis, RSSI mode
    {"max_tracks": 1},
    {"use_position": False},
    {"alert_repeat_s": 0.5, "hold_s": 0.3, "hysteresis_s": 0.2},
    {"require_mac": True, "stale_s": 0.4, "forget_s": 1.0},
]


def write_txt(trace, path):
    """Same line format as sim/make_traces.write_line_format."""
    nl = chr(10)
    with open(path, "w", encoding="utf-8", newline=nl) as f:
        for k, v in trace["config"].items():
            if k == "fleet_key_hex":
                f.write(f"KEY {v}" + nl)
            else:
                f.write(f"CFG {k} {int(v) if isinstance(v, bool) else v!r}" + nl)
        for e in trace["events"]:
            if e["k"] == "pose":
                f.write(f"POSE {e['lat']!r} {e['lon']!r} {e['heading']!r}" + (f" {e['acc']!r}" if e.get('acc') is not None else "") + nl)
            elif e["k"] == "pkt":
                f.write(f"PKT {e['t']!r} {e['rssi']} {e['hex']}" + nl)
            else:
                f.write(f"TICK {e['t']!r}" + nl)


def ts_runner():
    script = os.path.join(ROOT, "packages", "receiver-core", "scripts", "run_trace.ts")
    if not os.path.exists(script):
        return None, "packages/receiver-core/scripts/run_trace.ts not found"
    npx = shutil.which("npx") or shutil.which("npx.cmd")
    if not npx:
        return None, "npx not on PATH"
    return [npx, "tsx", script], None


def run_ts(cmd, js):
    r = subprocess.run(cmd + [js], capture_output=True, cwd=ROOT, shell=(os.name == "nt"))
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode("utf-8", "replace")[-500:])
    return json.loads(r.stdout.decode("utf-8"))


def main():
    ok_all = True
    rows = []

    # 1. C codec test
    codec_exe = os.path.join(BUILD, "test_packet" + EXE)
    if build(codec_exe, ["protocol/c/test/test_packet.c"], ["protocol/c"]):
        r = subprocess.run([codec_exe], capture_output=True, text=True, cwd=os.path.join(ROOT, "protocol", "c", "test"))
        codec_ok = r.returncode == 0
        rows.append(("C codec (test_packet.c)", "PASS" if codec_ok else "FAIL", r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""))
    else:
        codec_ok = False
        rows.append(("C codec (test_packet.c)", "FAIL", "build failed"))
    ok_all &= codec_ok

    # 2. C receiver runner
    c_exe = os.path.join(BUILD, "run_trace" + EXE)
    c_built = build(c_exe, ["firmware/tools/run_trace.c", "firmware/lib/hearme_receiver/hearme_receiver.c"],
                    ["protocol/c", "firmware/lib/hearme_receiver"])
    ok_all &= c_built
    ts_cmd, ts_why = ts_runner()

    traces = sorted(glob.glob(os.path.join(ROOT, "tests", "traces", "*.json")))
    if not traces:
        print("no traces found")
        return 1
    table = []
    vrows = []
    for js in traces:
        name = os.path.splitext(os.path.basename(js))[0]
        with open(js, encoding="utf-8") as f:
            trace = json.load(f)
        ref = run_trace(trace)
        res = {"n": len(ref)}
        d = compare(ref, trace.get("expected", []))
        res["stored"] = ("PASS", "") if d is None else ("FAIL", "stored expected is stale: " + d)
        if c_built:
            try:
                d = compare(ref, run_c(c_exe, js[:-5] + ".txt"))
                res["C"] = ("PASS", "") if d is None else ("FAIL", d)
            except Exception as e:  # noqa: BLE001
                res["C"] = ("FAIL", str(e)[:200])
        else:
            res["C"] = ("FAIL", "not built")
        if ts_cmd:
            try:
                d = compare(ref, run_ts(ts_cmd, js))
                res["TS"] = ("PASS", "") if d is None else ("FAIL", d)
            except Exception as e:  # noqa: BLE001
                res["TS"] = ("FAIL", str(e)[:200])
        else:
            res["TS"] = ("SKIP", "")
        for k in ("stored", "C", "TS"):
            if res[k][0] == "FAIL":
                ok_all = False
        table.append((name, res))
        if c_built:
            for i, var in enumerate(VARIANTS):
                tv = dict(trace)
                tv["config"] = dict(trace["config"], **var)
                vref = run_trace(tv)
                vtxt = os.path.join(BUILD, f"variant_{name}_{i}.txt")
                write_txt(tv, vtxt)
                try:
                    d = compare(vref, run_c(c_exe, vtxt))
                except Exception as e:  # noqa: BLE001
                    d = str(e)[:200]
                vrows.append((f"{name} {var}", len(vref), d))
                ok_all &= d is None

    print()
    print(f"{'trace':28s} {'events':>6s}  {'py-stored':9s} {'C':5s} {'TS':5s}")
    print("-" * 60)
    for name, res in table:
        print(f"{name:28s} {res['n']:6d}  {res['stored'][0]:9s} {res['C'][0]:5s} {res['TS'][0]:5s}")
        for k in ("stored", "C", "TS"):
            if res[k][1]:
                print(f"    {k}: {res[k][1]}")
    print("-" * 60)
    print("config variants (Python vs C):")
    for label, n, d in vrows:
        print(f"  {label:70s} {n:4d} ev  {'PASS' if d is None else 'FAIL ' + d}")
    print("-" * 60)
    for label, st, info in rows:
        print(f"{label:38s} {st:5s} {info}")
    if not ts_cmd:
        print(f"TypeScript runner skipped: {ts_why}")
    print()
    print("OVERALL:", "PASS" if ok_all else "FAIL")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
