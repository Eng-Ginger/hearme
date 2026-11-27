"""Charts for the HearMe Monte Carlo (called by montecarlo.py; or `python sim/plots.py [dir]`
to redraw from an existing results.json). Every chart is labelled as simulated."""
from __future__ import annotations

import json
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

COLORS = {"none": "#7d7c78", "avas": "#eb6834", "rssi": "#1baf7a", "gps": "#2a78d6",
          "gps_truepose": "#6250d6"}
SHORT = {"none": "No warning\n(tyre noise)", "avas": "AVAS\nspeaker", "rssi": "HearMe\nRSSI-only",
         "gps": "HearMe\nwith GPS", "gps_truepose": "HearMe GPS,\nexact phone pos."}
MAIN4 = ["none", "avas", "rssi", "gps"]
INK, INK2, GRID = "#1b1b1a", "#52514e", "#e4e3df"

plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 10.5, "axes.titlesize": 12.5, "axes.titleweight": "bold",
    "axes.labelsize": 10.5, "axes.edgecolor": "#b9b8b3", "axes.labelcolor": INK, "text.color": INK,
    "xtick.color": INK2, "ytick.color": INK2, "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.8,
    "axes.spines.top": False, "axes.spines.right": False, "axes.axisbelow": True, "legend.frameon": False,
    "figure.facecolor": "white", "axes.facecolor": "white", "savefig.facecolor": "white",
})


def _foot(fig, text):
    fig.text(0.01, 0.01, text, fontsize=8.5, color=INK2, ha="left", va="bottom")


def _save(fig, out, name):
    for ext in ("png", "svg"):
        fig.savefig(os.path.join(out, f"{name}.{ext}"), dpi=200, bbox_inches="tight")
    plt.close(fig)


def _ecdf(ax, vals, color, label, ls="-", lw=2.0):
    v = np.sort(np.asarray(vals))
    y = np.arange(1, len(v) + 1) / len(v)
    ax.step(np.concatenate([[0], v]), np.concatenate([[0], y]), where="post", color=color, lw=lw, ls=ls,
            label=label)


def lead_distribution(res, out):
    m = res["main"]
    fig, axes = plt.subplots(1, 2, figsize=(11.5, 4.6), sharey=True)
    xmax = max(np.percentile(m[c]["lead_values"], 99) for c in MAIN4)
    xmax = float(np.ceil(max(xmax, 10.0) / 5.0) * 5.0)
    for ax, key, title in ((axes[0], "lead_values", "First warning before arrival"),
                           (axes[1], "sustained_values", "Continuous warning up to arrival")):
        for c in MAIN4 + ["gps_truepose"]:
            if c in m:
                _ecdf(ax, m[c][key], COLORS[c], res["labels"][c], ls="--" if c == "gps_truepose" else "-",
                      lw=5.0 if c == "none" else 2.0)
        ax.axvline(3.0, color=INK2, lw=1, ls=":")
        ax.text(3.15, 0.93, "3 s", color=INK2, fontsize=9)
        ax.set_xlim(-0.3, xmax)
        ax.set_ylim(0, 1.02)
        ax.set_xlabel("Warning lead time before the critical rider reaches the crossing (s)")
        ax.set_title(title, loc="left")
    axes[0].set_ylabel("Cumulative share of attempts")
    axes[1].legend(loc="lower right", fontsize=9)
    fig.suptitle("Warning lead time (ECDF)", x=0.01, y=0.99, ha="left", fontsize=14, fontweight="bold")
    n = m["gps"]["n"]
    _foot(fig, f"Simulated — HearMe Monte Carlo, N={n} crossing attempts per condition "
               f"(N={m['gps_truepose']['n']} for the dashed diagnostic). Lead time 0 = no warning before arrival.\n"
               "No-warning and AVAS lines overlap (wide grey under orange); x-axis ends just past the 99th percentile.")
    fig.tight_layout(rect=(0, 0.07, 1, 0.97))
    _save(fig, out, "lead_time_ecdf")

    # histogram small multiples
    fig, axes = plt.subplots(1, 4, figsize=(12.5, 3.4), sharey=True)
    hx = float(np.ceil(max(max(np.percentile(m[c]["lead_values"], 99) for c in MAIN4), 10.0) / 5.0) * 5.0)
    bins = np.arange(0, hx + 0.5, 0.5)
    for ax, c in zip(axes, MAIN4):
        v = np.clip(np.asarray(m[c]["lead_values"]), 0, hx)
        w = np.ones_like(v) / len(v)
        ax.hist(v, bins=bins, weights=w, color=COLORS[c], edgecolor="white", linewidth=0.6)
        ax.axvline(3.0, color=INK2, lw=1, ls=":")
        ax.set_title(SHORT[c].replace("\n", " "), loc="left", fontsize=11)
        ax.set_xlabel("Lead time (s)")
        ax.set_xlim(0, hx)
    axes[0].set_ylabel("Share of attempts")
    _foot(fig, f"Simulated — HearMe Monte Carlo, N={m['gps']['n']} attempts per condition. "
               f"First-warning lead time; values above {hx:g} s are drawn in the last bin.")
    fig.tight_layout(rect=(0, 0.07, 1, 1))
    _save(fig, out, "lead_time_hist")


def _bars(ax, conds, vals, lo, hi, color_of, fmt, hatch=None, offset=0.0, width=0.62, alpha=1.0, label=None):
    x = np.arange(len(conds)) + offset
    err = np.clip(np.array([np.array(vals) - np.maximum(np.array(lo), 0), np.array(hi) - np.array(vals)]), 0, None)
    bars = ax.bar(x, vals, width=width, color=[color_of[c] for c in conds], alpha=alpha, hatch=hatch,
                  edgecolor="white", linewidth=1.5, label=label)
    ax.errorbar(x, vals, yerr=err, fmt="none", ecolor=INK, elinewidth=1.1, capsize=4)
    for xi, v, h in zip(x, vals, hi):
        ax.text(xi, h + ax.get_ylim()[1] * 0.015, fmt(v), ha="center", va="bottom", fontsize=9.5, color=INK)
    return bars


def bar_charts(res, out):
    m = res["main"]
    conds = MAIN4
    n = m["gps"]["n"]
    foot = f"Simulated — HearMe Monte Carlo, N={n} crossing attempts per condition. Error bars: 95% CI"

    # share >= 3 s
    fig, ax = plt.subplots(figsize=(8.4, 4.6))
    ax.set_ylim(0, 112)
    v1 = [100 * m[c]["share_ge3"] for c in conds]
    v2 = [100 * m[c]["share_sustained_ge3"] for c in conds]
    _bars(ax, conds, v1, [100 * m[c]["share_ge3_ci"][0] for c in conds],
          [100 * m[c]["share_ge3_ci"][1] for c in conds], COLORS, lambda v: f"{v:.1f}%", offset=-0.2,
          width=0.38, label="First warning ≥ 3 s before arrival")
    _bars(ax, conds, v2, [100 * m[c]["share_sustained_ge3_ci"][0] for c in conds],
          [100 * m[c]["share_sustained_ge3_ci"][1] for c in conds], COLORS, lambda v: f"{v:.1f}%", offset=0.2,
          width=0.38, alpha=0.45, hatch="///", label="Continuous warning ≥ 3 s up to arrival")
    ax.set_xticks(np.arange(len(conds)), [SHORT[c] for c in conds])
    ax.set_ylabel("Share of crossing attempts (%)")
    ax.set_title("Attempts warned at least 3 s before the critical rider arrives", loc="left")
    leg = ax.legend(loc="upper left", fontsize=9)
    for h in leg.legend_handles:
        h.set_facecolor("#9a9995")
    _foot(fig, foot + " (Wilson).")
    fig.tight_layout(rect=(0, 0.05, 1, 1))
    _save(fig, out, "share_ge3s")

    # conflicts
    fig, ax = plt.subplots(figsize=(8.4, 4.6))
    v = [m[c]["conflicts_per_1000"] for c in conds]
    hi = [m[c]["conflicts_per_1000_ci"][1] for c in conds]
    ax.set_ylim(0, max(hi) * 1.18 + 1)
    _bars(ax, conds, v, [m[c]["conflicts_per_1000_ci"][0] for c in conds], hi, COLORS, lambda x: f"{x:.1f}")
    ax.set_xticks(np.arange(len(conds)), [SHORT[c] for c in conds])
    ax.set_ylabel("Conflicts per 1,000 crossings")
    ax.set_title("Conflicts: rider within 2 m while the pedestrian is on the road", loc="left")
    _foot(fig, foot + " (Wilson). Riders assumed never to yield: exposure, not crash prediction.")
    fig.tight_layout(rect=(0, 0.05, 1, 1))
    _save(fig, out, "conflicts_per_1000")

    # false alarms
    fig, ax = plt.subplots(figsize=(8.4, 4.6))
    v = [m[c]["false_alarms_per_attempt"] for c in conds]
    hi = [m[c]["false_alarms_per_attempt_ci"][1] for c in conds]
    ax.set_ylim(0, max(hi) * 1.18 + 0.05)
    _bars(ax, conds, v, [m[c]["false_alarms_per_attempt_ci"][0] for c in conds], hi, COLORS,
          lambda x: f"{x:.2f}")
    ax.set_xticks(np.arange(len(conds)), [SHORT[c] for c in conds])
    ax.set_ylabel("False alarms per crossing attempt")
    ax.set_title("False alarms: WARN/URGENT for riders that never come within 5 m of the path",
                 loc="left", fontsize=11.5)
    _foot(fig, foot + " (normal approx.). Distractors: parallel street 25 m away, parked beaconing e-bikes.")
    fig.tight_layout(rect=(0, 0.05, 1, 1))
    _save(fig, out, "false_alarms")

    # waiting time
    fig, ax = plt.subplots(figsize=(8.4, 4.6))
    v = [m[c]["wait_mean_s"] for c in conds]
    hi = [m[c]["wait_mean_ci"][1] for c in conds]
    ax.set_ylim(0, max(hi) * 1.18 + 0.5)
    _bars(ax, conds, v, [m[c]["wait_mean_ci"][0] for c in conds], hi, COLORS, lambda x: f"{x:.1f} s")
    ax.set_xticks(np.arange(len(conds)), [SHORT[c] for c in conds])
    ax.set_ylabel("Mean time waiting at the kerb (s)")
    ax.set_title("Cost of warnings: time spent waiting at the kerb", loc="left")
    _foot(fig, foot + " (normal approx.). Includes the 1–4 s listening delay and any re-waits after stepping back.")
    fig.tight_layout(rect=(0, 0.05, 1, 1))
    _save(fig, out, "waiting_time")


SWEEP_META = {
    "loss": ("Random packet loss", lambda x: 100 * x, "Packet loss (%)", "sensitivity_packet_loss"),
    "body_db": ("Body attenuation (worst angle)", lambda x: x, "Body attenuation at worst angle (dB)",
                "sensitivity_body_attenuation"),
    "density": ("Traffic density", lambda x: x, "E-bikes / e-scooters per hour (both directions)",
                "sensitivity_traffic_density"),
    "bg": ("Background noise (audio baselines)", lambda x: x, "Background noise level (dB(A))",
           "sensitivity_background_noise"),
}


MARK_NOTE = {"body_db": "Dotted lines: wrist band (4 dB) and phone in pocket (10 dB, default).",
             "loss": "Dotted line: default (10 %).", "density": "Dotted line: default (200 /h)."}


def sweeps(res, out):
    for g, data in res["sweeps"].items():
        title, xf, xlabel, name = SWEEP_META[g]
        panels = [("share_ge3", "share_ge3_ci", 100, "Warned ≥ 3 s before arrival (%)"),
                  ("conflicts_per_1000", "conflicts_per_1000_ci", 1, "Conflicts per 1,000 crossings"),
                  ("false_alarms_per_attempt", "false_alarms_per_attempt_ci", 1, "False alarms per attempt"),
                  ("wait_mean_s", "wait_mean_ci", 1, "Mean wait at kerb (s)")]
        fig, axes = plt.subplots(2, 2, figsize=(11, 7.4))
        nmax = 0
        for ax, (k, kci, sc, lab) in zip(axes.flat, panels):
            for c in MAIN4:
                if c not in data:
                    continue
                pts = data[c]
                x = np.array([xf(p["x"]) for p in pts])
                y = np.array([sc * p[k] for p in pts])
                lo = np.array([sc * p[kci][0] for p in pts])
                hi = np.array([sc * p[kci][1] for p in pts])
                ax.fill_between(x, lo, hi, color=COLORS[c], alpha=0.14, linewidth=0)
                ax.plot(x, y, color=COLORS[c], lw=5 if c == "none" else 2, marker="o",
                        ms=8 if c == "none" else 5, label=SHORT[c].replace("\n", " "),
                        zorder=2 if c == "none" else 3)
                nmax = max(nmax, pts[0]["n"])
            ax.set_xlabel(xlabel)
            ax.set_title(lab, loc="left", fontsize=11.5)
            ax.set_ylim(bottom=0)
            if g == "body_db":
                for xv, txt in ((4, "wrist"), (10, "pocket\n(default)")):
                    ax.axvline(xv, color=INK2, lw=0.9, ls=":")
            if g == "loss":
                ax.axvline(10, color=INK2, lw=0.9, ls=":")
            if g == "density":
                ax.axvline(200, color=INK2, lw=0.9, ls=":")
        axes[0, 0].legend(loc="best", fontsize=9)
        fig.suptitle(f"Sensitivity: {title}", x=0.01, y=0.995, ha="left", fontsize=14, fontweight="bold")
        _foot(fig, f"Simulated — HearMe Monte Carlo, N={nmax} crossing attempts per point and condition. "
                   "Bands: 95% CI. Other parameters at their defaults. " + MARK_NOTE.get(g, "")
                   + (" No-warning (wide grey) and AVAS lines overlap where equal." if "none" in data else ""))
        fig.tight_layout(rect=(0, 0.04, 1, 0.975))
        _save(fig, out, name)


def make_all(res, out):
    lead_distribution(res, out)
    bar_charts(res, out)
    sweeps(res, out)


if __name__ == "__main__":
    d = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "docs", "results")
    with open(os.path.join(d, "results.json"), encoding="utf-8") as f:
        make_all(json.load(f), d)
