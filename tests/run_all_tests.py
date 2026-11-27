"""Run every test suite in the repo and print one summary table.

    python tests/run_all_tests.py
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NPX = "npx.cmd" if os.name == "nt" else "npx"
NPM = "npm.cmd" if os.name == "nt" else "npm"
CC = [sys.executable, "-m", "ziglang", "cc"]

SUITES = [
    ("Protocol codec (Python)", [sys.executable, "-m", "pytest", "-q", "protocol/python"], ROOT),
    ("Protocol + receiver (TypeScript, vitest)", [NPM, "test"], ROOT),
    ("Cross-language receiver (Python = TS = C) + C codec", [sys.executable, "tests/cross_language/run_all.py"], ROOT),
    ("Firmware native tests (C, Unity shim)", None, ROOT),
    ("City dashboard API (pytest)", [sys.executable, "-m", "pytest", "-q", "apps/dashboard/api/tests"], ROOT),
]


def native():
    os.makedirs(os.path.join(ROOT, "build"), exist_ok=True)
    fw = os.path.join(ROOT, "firmware")
    exe = os.path.join(ROOT, "build", "test_native.exe")
    b = subprocess.run(CC + ["-std=c99", "-O2", "-ffp-contract=off", "-Itools/unity_shim", "-I../protocol/c",
                             "-I../protocol/c/test", "-Ilib/hearme_receiver", "test/test_native/test_main.c",
                             "lib/hearme_receiver/hearme_receiver.c", "-o", exe], cwd=fw, capture_output=True, text=True)
    if b.returncode:
        return b.returncode, b.stdout + b.stderr
    r = subprocess.run([exe], cwd=fw, capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
results = []
for name, cmd, cwd in SUITES:
    print(f"\n=== {name}")
    if cmd is None:
        code, out = native()
    else:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                           env={**os.environ, "PYTHONIOENCODING": "utf-8"})
        code, out = p.returncode, p.stdout + p.stderr
    print("\n".join(out.strip().splitlines()[-6:]))
    results.append((name, code == 0))

print("\n" + "=" * 64)
for name, ok in results:
    print(f"{'PASS' if ok else 'FAIL'}  {name}")
sys.exit(0 if all(ok for _, ok in results) else 1)
