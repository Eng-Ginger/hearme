"""Before/after comparison of the Monte Carlo: receiver v1 (docs/results/v1/results.json) vs
receiver v1.1 (docs/results/results.json). Same seed, same N. Writes docs/results/comparison_v1_v2.md,
comparison_v1_v2.png/.svg and audio_background_noise.png/.svg. Every number comes from the two runs.

Run: python sim/compare_v1_v2.py
"""
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs", "results")
v1 = json.load(open(os.path.join(D, "v1", "results.json"), encoding="utf-8"))
v2 = json.load(open(os.path.join(D, "results.json"), encoding="utf-8"))
LAB = {"none": "No warning", "avas": "AVAS speaker", "rssi": "HearMe RSSI-only", "gps": "HearMe with GPS"}


def lane(m, which):
    return m.get("exposed_by_lane", {}).get(which, {}).get("share_sustained_ge3")


METRICS = [
    ("Warned ≥ 3 s (%)", lambda m: 100 * m["share_ge3"], "{:.1f}"),
    ("Continuous warning ≥ 3 s (%)", lambda m: 100 * m["share_sustained_ge3"], "{:.1f}"),
    ("Conflicts per 1,000", lambda m: m["conflicts_per_1000"], "{:.1f}"),
    ("False alarms / attempt", lambda m: m["false_alarms_per_attempt"], "{:.3f}"),
    ("Mean wait at kerb (s)", lambda m: m["wait_mean_s"], "{:.1f}"),
    ("Median lead time (s)", lambda m: m["lead_median_s"], "{:.2f}"),
    ("Near lane: continuous ≥ 3 s (%)", lambda m: 100 * lane(m, "near") if lane(m, "near") is not None else None, "{:.1f}"),
    ("Far lane: continuous ≥ 3 s (%)", lambda m: 100 * lane(m, "far") if lane(m, "far") is not None else None, "{:.1f}"),
]

rows = []
for cond in ("rssi", "gps"):
    a, b = v1["main"][cond], v2["main"][cond]
    for name, f, fmt in METRICS:
        x, y = f(a), f(b)
        rows.append((LAB[cond], name, x, y, fmt))

ci = lambda m: "{:.1f}–{:.1f}".format(*m["conflicts_per_1000_ci"])
md = ["# Receiver v1 → v1.1: Monte Carlo before / after",
      "",
      "> **SIMULATED.** Both columns come from `sim/montecarlo.py` with the same base seed "
      f"({v2['meta']['base_seed']}) and the same N ({v2['main']['gps']['n']} attempts per condition); only the receiver "
      "changed. v1: `docs/results/v1/`. v1.1: `docs/results/`.",
      "",
      "Receiver v1.1 changes: crossing-aware warning (warn = max(6 s, road 7 m / walk 1.0 m/s + 2 s) = 9 s, urgent 4.5 s), "
      "pass radius 8 m + 0.5 × combined GPS error, warn hold while the vehicle is still closing, separate "
      "seconds/metres hysteresis, re-escalation always alerts.",
      "",
      "| Condition | Metric | v1 | v1.1 |",
      "|---|---|---|---|"]
for c, n, x, y, fmt in rows:
    md.append(f"| {c} | {n} | {fmt.format(x) if x is not None else '–'} | {fmt.format(y) if y is not None else '–'} |")
md += ["",
       f"Conflicts per 1,000, 95 % CI — GPS: v1 {ci(v1['main']['gps'])}, v1.1 {ci(v2['main']['gps'])}; "
       f"RSSI-only: v1 {ci(v1['main']['rssi'])}, v1.1 {ci(v2['main']['rssi'])}. "
       f"Baselines (unchanged, no receiver involved): no warning {v2['main']['none']['conflicts_per_1000']:.1f}, "
       f"AVAS {v2['main']['avas']['conflicts_per_1000']:.1f} conflicts per 1,000.",
       "",
       "![Before / after](comparison_v1_v2.png)",
       "",
       "![Audio baselines vs background noise](audio_background_noise.png)",
       ""]

# chart: grouped bars v1 vs v1.1 for the HearMe conditions
show = ["Warned ≥ 3 s (%)", "Continuous warning ≥ 3 s (%)", "Conflicts per 1,000", "False alarms / attempt",
        "Mean wait at kerb (s)", "Near lane: continuous ≥ 3 s (%)", "Far lane: continuous ≥ 3 s (%)"]
fig, axes = plt.subplots(2, 4, figsize=(15, 7.2))
for ax, name in zip(axes.flat, show):
    vals = [(c, x, y) for c, n, x, y, _ in rows if n == name]
    xs = range(len(vals))
    ax.bar([i - 0.2 for i in xs], [v[1] or 0 for v in vals], 0.38, label="v1", color="#9aa5b1")
    ax.bar([i + 0.2 for i in xs], [v[2] or 0 for v in vals], 0.38, label="v1.1", color="#1f77b4")
    for i, v in enumerate(vals):
        for dx, val in ((-0.2, v[1]), (0.2, v[2])):
            if val is not None:
                ax.text(i + dx, val, f"{val:.3f}" if val < 1 else f"{val:.1f}", ha="center", va="bottom", fontsize=8)
    ax.set_xticks(list(xs)); ax.set_xticklabels([v[0].replace("HearMe ", "") for v in vals], fontsize=9)
    ax.set_title(name, fontsize=10); ax.spines[["top", "right"]].set_visible(False)
axes.flat[-1].axis("off")
h, l = axes.flat[0].get_legend_handles_labels()
axes.flat[-1].legend(h, l, frameon=False, loc="center", fontsize=12, title="Receiver")
fig.suptitle("HearMe receiver v1 vs v1.1 (same seed, same N)", fontsize=13)
fig.text(0.5, 0.01, f"Simulated — HearMe Monte Carlo, N={v2['main']['gps']['n']} crossing attempts per condition, base seed {v2['meta']['base_seed']}.",
         ha="center", fontsize=8.5, color="#555")
fig.tight_layout(rect=(0, 0.03, 1, 0.95))
for ext in ("png", "svg"):
    fig.savefig(os.path.join(D, f"comparison_v1_v2.{ext}"), dpi=200)
plt.close(fig)

# chart: audio baselines vs background noise (receiver-independent)
bg = v2["sweeps"]["bg"]
fig, ax = plt.subplots(figsize=(8, 4.6))
for cond, col in (("avas", "#e8743b"), ("none", "#7f7f7f")):
    pts = bg[cond]
    ax.plot([p["x"] for p in pts], [100 * p["share_ge3"] for p in pts], "o-", color=col, label=LAB[cond], lw=2)
ax.axvspan(55, 70, color="#f2c200", alpha=0.15, label="normal urban traffic noise (55–70 dB(A), assumed)")
ax.set_xlabel("Background noise (dB(A))"); ax.set_ylabel("Attempts warned ≥ 3 s before arrival (%)")
ax.set_ylim(-3, 105); ax.legend(frameon=False, fontsize=9, loc="center right")
ax.spines[["top", "right"]].set_visible(False)
ax.set_title("A sound-only warning (AVAS) works only in a very quiet street", fontsize=11)
n_bg = bg["avas"][0]["n"]
fig.text(0.5, 0.01, f"Simulated — HearMe Monte Carlo, N={n_bg} per point.\nAssumptions: AVAS 56 dB(A) at 2 m, tyre noise 48 dB(A) at 2 m, detection SNR > −3 dB for 0.5 s.",
         ha="center", fontsize=7.5, color="#555")
fig.tight_layout(rect=(0, 0.07, 1, 1))
for ext in ("png", "svg"):
    fig.savefig(os.path.join(D, f"audio_background_noise.{ext}"), dpi=200)
plt.close(fig)
avas = {p["x"]: p["share_ge3"] for p in bg["avas"]}
md.append(f"Audio baselines (receiver-independent): an AVAS-style speaker warned ≥ 3 s ahead in "
          f"{100 * avas[35.0]:.1f} % of attempts at 35 dB(A) background, {100 * avas[40.0]:.1f} % at 40 dB(A) and "
          f"{100 * avas[60.0]:.1f} % at 60 dB(A): it works in a very quiet street and fails in normal traffic noise.")
open(os.path.join(D, "comparison_v1_v2.md"), "w", encoding="utf-8", newline="\n").write("\n".join(md) + "\n")
for c, n, x, y, fmt in rows:
    print(f"{c:18s} {n:32s} {fmt.format(x) if x is not None else '-':>8s} -> {fmt.format(y) if y is not None else '-':>8s}")
