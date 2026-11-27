"""Writes docs/results/results.md from the numbers in results.json (called by montecarlo.py, or
`python sim/report.py [dir]`). Every number in the document is formatted from the run output."""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mc_params import BEHAVIOUR, RUN, SCENE, TRAFFIC_MC  # noqa: E402
from params import AUDIO, GPS, PEDESTRIAN, RADIO, TRAFFIC  # noqa: E402

ORDER = ["none", "avas", "rssi", "gps", "gps_truepose"]


def pct(x, d=1):
    return f"{100 * x:.{d}f} %"


def ci_pct(ci, d=1):
    return f"{100 * ci[0]:.{d}f}–{100 * ci[1]:.{d}f}"


def param_table():
    rows = [
        ("Advertising interval", f"{RADIO['adv_interval_s'] * 1000:.0f} ms + 0–{RADIO['adv_delay_max_s'] * 1000:.0f} ms advDelay",
         "HearMe SPEC; BLE Core Spec v5.3 Vol 6 Part B 4.4.2.2"),
        ("RSSI at 1 m", f"{RADIO['tx_power_1m_dbm']:.0f} dBm", "Apple iBeacon spec (-59 dBm at 0 dBm) + SPEC +10 dBm"),
        ("Path-loss exponent", f"{RADIO['path_loss_n']}", "Rappaport, Wireless Communications 2nd ed., Table 4.2 (LOS)"),
        ("Shadowing σ / correlation", f"{RADIO['shadowing_sigma_db']} dB / {RADIO['shadowing_tau_s']} s",
         "Rappaport sec. 4.9.2 range; τ ASSUMPTION"),
        ("Fast fading σ", f"{RADIO['fast_fading_sigma_db']} dB", "ASSUMPTION"),
        ("Receiver sensitivity", f"{RADIO['sensitivity_dbm']:.0f} dBm", "ESP32-C3 datasheet −98 dBm; ASSUMPTION −95 dBm for phones"),
        ("Packet loss (default)", pct(RADIO["packet_loss"], 0), "ASSUMPTION (swept 0–60 %)"),
        ("Body loss, phone in pocket / wrist", f"{RADIO['body_loss_pocket_db']:.0f} dB / {RADIO['body_loss_wrist_db']:.0f} dB at worst angle",
         "ASSUMPTION within published 5–20+ dB range (swept 0–20 dB)"),
        ("Vehicle GPS error", f"{GPS['sigma_per_axis_m']} m per axis, τ = {GPS['tau_s']:.0f} s, {GPS['fix_rate_hz']:.0f} Hz fixes",
         "GPS.gov smartphone 4.9 m; τ ASSUMPTION"),
        ("GPS speed / heading noise", f"{GPS['speed_sigma_mps']} m/s / {GPS['heading_sigma_deg']}°", "ASSUMPTION"),
        ("Phone (receiver) GPS error", "same model, independent of the vehicle's" if RUN["phone_gps_error"] else "none",
         "ASSUMPTION (pessimistic: real nearby receivers share error)"),
        ("Rider speed", f"uniform {TRAFFIC['ebike_speed_kmh'][0]:.0f}–{TRAFFIC['ebike_speed_kmh'][1]:.0f} km/h",
         "EN 15194 25 km/h cut-off; ASSUMPTION range; same for e-scooters"),
        ("Traffic on the crossing road", f"{TRAFFIC_MC['main_rate_per_h']:.0f} /h both directions, Poisson",
         "ASSUMPTION (swept 60–600 /h)"),
        ("E-scooter share", pct(TRAFFIC_MC["escooter_share"], 0), "ASSUMPTION"),
        ("Rider lateral offset", f"N(0, {SCENE['lateral_sd_m']} m) around lane centre", "ASSUMPTION"),
        ("Parallel street", f"{SCENE['parallel_street_y_m']:.0f} m north, {TRAFFIC_MC['parallel_rate_ratio']:.0%} of main flow",
         "ASSUMPTION (distractor)"),
        ("Parked beaconing e-bikes", f"Poisson mean {TRAFFIC_MC['parked_mean']:.0f}, {TRAFFIC_MC['parked_x_range_m'][0]:.0f}–{TRAFFIC_MC['parked_x_range_m'][1]:.0f} m from the crossing",
         "ASSUMPTION (distractor)"),
        ("Riders yield", "never", "ASSUMPTION (worst case)"),
        ("Road", f"2 lanes × {TRAFFIC['lane_width_m']} m; pedestrian waits at y = {SCENE['ped_wait_y_m']} m",
         "ASSUMPTION"),
        ("Walking speed", f"N({PEDESTRIAN['walk_speed_mps'][0]}, {PEDESTRIAN['walk_speed_mps'][1]}) m/s, clipped {BEHAVIOUR['walk_speed_clip_mps'][0]}–{BEHAVIOUR['walk_speed_clip_mps'][1]}",
         "MUTCD 2009 4E.06 (1.07 m/s); ASSUMPTION for blind pedestrians"),
        ("Start delay at kerb", f"uniform {PEDESTRIAN['start_delay_s'][0]:.0f}–{PEDESTRIAN['start_delay_s'][1]:.0f} s", "ASSUMPTION"),
        ("Reaction time", f"{PEDESTRIAN['reaction_s']} s", "ASSUMPTION"),
        ("Give-up wait", f"{BEHAVIOUR['max_wait_s']:.0f} s, then crosses regardless", "ASSUMPTION"),
        ("Background noise", f"uniform {AUDIO['background_dba'][0]:.0f}–{AUDIO['background_dba'][1]:.0f} dB(A)",
         "ASSUMPTION (swept 35–70 dB(A))"),
        ("E-bike tyre/drivetrain noise", f"{AUDIO['ebike_tyre_dba_2m']:.0f} dB(A) at 2 m", "ASSUMPTION"),
        ("AVAS speaker", f"{AUDIO['avas_dba_2m']:.0f} dB(A) at 2 m", "UN R138 car levels; ASSUMPTION for a bike"),
        ("Audio detection", f"SNR > {AUDIO['detect_snr_db']:.0f} dB for {AUDIO['detect_dwell_s']} s; spreading 20·log10(d/2)",
         "ASSUMPTION"),
    ]
    out = ["| Parameter | Value | Source |", "|---|---|---|"]
    out += [f"| {a} | {b} | {c} |" for a, b, c in rows]
    return "\n".join(out)


def main_table(res):
    m, L = res["main"], res["labels"]
    h = ("| Condition | N | Lead time median (s) | Lead time mean (s) | Warned ≥ 3 s (95 % CI) | "
         "Continuous warning ≥ 3 s (95 % CI) | Conflicts / 1,000 (95 % CI) | False alarms / attempt (95 % CI) | "
         "Mean wait at kerb (s) |")
    out = [h, "|---|---|---|---|---|---|---|---|---|"]
    for c in ORDER:
        if c not in m:
            continue
        s = m[c]
        out.append(
            f"| {L[c]} | {s['n']} | {s['lead_median_s']:.2f} | {s['lead_mean_s']:.2f} | "
            f"{pct(s['share_ge3'])} ({ci_pct(s['share_ge3_ci'])}) | "
            f"{pct(s['share_sustained_ge3'])} ({ci_pct(s['share_sustained_ge3_ci'])}) | "
            f"{s['conflicts_per_1000']:.1f} ({s['conflicts_per_1000_ci'][0]:.1f}–{s['conflicts_per_1000_ci'][1]:.1f}) | "
            f"{s['false_alarms_per_attempt']:.3f} ({max(0.0, s['false_alarms_per_attempt_ci'][0]):.3f}–{s['false_alarms_per_attempt_ci'][1]:.3f}) | "
            f"{s['wait_mean_s']:.1f} |")
    return "\n".join(out)


def extra_table(res):
    m, L = res["main"], res["labels"]
    out = ["| Condition | Lead p10 / p90 (s) | Any warning before arrival | Critical rider arrives while pedestrian still at kerb or on road: N, warned ≥ 3 s | "
           "Attempts with ≥ 1 false alarm | All WARN/URGENT events / attempt | Step-backs / attempt | Gave up waiting (90 s) | URGENT on fast passes ≤ 5 m |",
           "|---|---|---|---|---|---|---|---|---|"]
    for c in ORDER:
        if c not in m:
            continue
        s = m[c]
        up = f"{s['fast_passes_with_urgent']} / {s['fast_passes']} ({pct(s['urgent_per_fast_pass'])})" if s["fast_passes"] else "–"
        out.append(
            f"| {L[c]} | {s['lead_p10_s']:.2f} / {s['lead_p90_s']:.2f} | {pct(s['warned_share'])} | "
            f"{s['n_exposed_at_crit']}, {pct(s['exposed_share_ge3'])} | {pct(s['share_attempts_with_false_alarm'])} | "
            f"{s['alert_events_per_attempt']:.2f} | {s['retreats_per_attempt']:.3f} | {pct(s['forced_share'])} | {up} |")
    return "\n".join(out)


def conflict_table(res):
    m, L = res["main"], res["labels"]
    out = ["| Condition | Conflicts | with the critical rider | in the far lane | while stepping back | rider warned/detected before the (last) step-out | after giving up waiting | median time from step-out to conflict (s) |",
           "|---|---|---|---|---|---|---|---|"]
    for c in ORDER:
        if c not in m:
            continue
        s = m[c]
        med = f"{s['conflict_after_step_median_s']:.1f}" if s["conflicts"] else "–"
        out.append(f"| {L[c]} | {s['conflicts']} | {s['conflicts_with_critical']} | {s['conflicts_far_lane']} | "
                   f"{s['conflicts_while_retreating']} | {s['conflicts_alert_before_step']} | {s['conflicts_forced']} | {med} |")
    return "\n".join(out)


def sweep_table(res, g, xlab, xf=lambda x: f"{x:g}"):
    data = res["sweeps"][g]
    L = res["labels"]
    out = [f"| {xlab} | Condition | N | Warned ≥ 3 s | Continuous ≥ 3 s | Lead median (s) | Conflicts / 1,000 (95 % CI) | False alarms / attempt | Mean wait (s) |",
           "|---|---|---|---|---|---|---|---|---|"]
    xs = sorted({p["x"] for c in data for p in data[c]})
    for x in xs:
        for c in ORDER:
            if c not in data:
                continue
            for p in data[c]:
                if p["x"] == x:
                    out.append(f"| {xf(x)} | {L[c]} | {p['n']} | {pct(p['share_ge3'])} | {pct(p['share_sustained_ge3'])} | "
                               f"{p['lead_median_s']:.2f} | {p['conflicts_per_1000']:.1f} ({p['conflicts_per_1000_ci'][0]:.1f}–{p['conflicts_per_1000_ci'][1]:.1f}) | "
                               f"{p['false_alarms_per_attempt']:.3f} | {p['wait_mean_s']:.1f} |")
    return "\n".join(out)


def pt(res, g, c, x):
    for p in res["sweeps"][g][c]:
        if p["x"] == x:
            return p
    raise KeyError((g, c, x))


def findings(res):
    """Sentences built only from computed numbers (no hand-typed results)."""
    m = res["main"]
    f = []
    g, r, a, n = m["gps"], m["rssi"], m["avas"], m["none"]
    f.append(
        f"- **Audio baselines.** With the default audibility assumptions (tyre noise {AUDIO['ebike_tyre_dba_2m']:.0f} dB(A) and AVAS "
        f"{AUDIO['avas_dba_2m']:.0f} dB(A) at 2 m against {AUDIO['background_dba'][0]:.0f}–{AUDIO['background_dba'][1]:.0f} dB(A) "
        f"background, detection at SNR > {AUDIO['detect_snr_db']:.0f} dB), the pedestrian was warned ≥ 3 s ahead in "
        f"{pct(n['share_ge3'])} (no warning) and {pct(a['share_ge3'])} (AVAS) of attempts, and had "
        f"{n['conflicts_per_1000']:.1f} and {a['conflicts_per_1000']:.1f} conflicts per 1,000 crossings.")
    f.append(
        f"- **HearMe with GPS.** Warned ≥ 3 s ahead in {pct(g['share_ge3'])} of attempts (median lead "
        f"{g['lead_median_s']:.2f} s), {g['conflicts_per_1000']:.1f} conflicts per 1,000 crossings, "
        f"{g['false_alarms_per_attempt']:.3f} false alarms per attempt, mean kerb wait {g['wait_mean_s']:.1f} s.")
    f.append(
        f"- **HearMe RSSI-only.** Warned ≥ 3 s ahead in {pct(r['share_ge3'])} of attempts (median first-warning lead "
        f"{r['lead_median_s']:.2f} s; median *continuous* lead {r['sustained_median_s']:.2f} s), "
        f"{r['conflicts_per_1000']:.1f} conflicts per 1,000, but {r['false_alarms_per_attempt']:.3f} false alarms per attempt "
        f"({pct(r['share_attempts_with_false_alarm'])} of attempts had at least one), {r['alert_events_per_attempt']:.2f} WARN/URGENT "
        f"events per attempt in total, a mean kerb wait of {r['wait_mean_s']:.1f} s and {pct(r['forced_share'])} of pedestrians "
        f"giving up after {BEHAVIOUR['max_wait_s']:.0f} s.")
    if "gps_truepose" in m:
        t = m["gps_truepose"]
        f.append(
            f"- **Phone position error (diagnostic).** If the phone knew its own position exactly, HearMe GPS would warn ≥ 3 s ahead in "
            f"{pct(t['share_ge3'])} of attempts (vs {pct(g['share_ge3'])} with independent phone GPS error), "
            f"{t['conflicts_per_1000']:.1f} conflicts per 1,000 (N = {t['n']}).")
    s = res["sweeps"]
    if "loss" in s:
        lo, hi = min(p["x"] for p in s["loss"]["gps"]), max(p["x"] for p in s["loss"]["gps"])
        for c in ("gps", "rssi"):
            p0, p1 = pt(res, "loss", c, lo), pt(res, "loss", c, hi)
            f.append(f"- **Packet loss, {res['labels'][c]}.** From {pct(lo, 0)} to {pct(hi, 0)} loss: warned ≥ 3 s "
                     f"{pct(p0['share_ge3'])} → {pct(p1['share_ge3'])}, conflicts {p0['conflicts_per_1000']:.1f} → "
                     f"{p1['conflicts_per_1000']:.1f} per 1,000, false alarms {p0['false_alarms_per_attempt']:.3f} → "
                     f"{p1['false_alarms_per_attempt']:.3f} per attempt.")
    if "body_db" in s:
        xs = sorted(p["x"] for p in s["body_db"]["gps"])
        for c in ("gps", "rssi"):
            p0, p1 = pt(res, "body_db", c, xs[0]), pt(res, "body_db", c, xs[-1])
            f.append(f"- **Body attenuation, {res['labels'][c]}.** From {xs[0]:g} dB to {xs[-1]:g} dB: warned ≥ 3 s "
                     f"{pct(p0['share_ge3'])} → {pct(p1['share_ge3'])}, median lead {p0['lead_median_s']:.2f} → "
                     f"{p1['lead_median_s']:.2f} s, conflicts {p0['conflicts_per_1000']:.1f} → {p1['conflicts_per_1000']:.1f} per 1,000, "
                     f"false alarms {p0['false_alarms_per_attempt']:.3f} → {p1['false_alarms_per_attempt']:.3f}.")
    if "density" in s:
        xs = sorted(p["x"] for p in s["density"]["gps"])
        for c in ORDER:
            if c in s["density"]:
                p0, p1 = pt(res, "density", c, xs[0]), pt(res, "density", c, xs[-1])
                f.append(f"- **Traffic density, {res['labels'][c]}.** From {xs[0]:g} to {xs[-1]:g} riders/h: conflicts "
                         f"{p0['conflicts_per_1000']:.1f} → {p1['conflicts_per_1000']:.1f} per 1,000, mean wait "
                         f"{p0['wait_mean_s']:.1f} → {p1['wait_mean_s']:.1f} s, gave up waiting {pct(p0['forced_share'])} → "
                         f"{pct(p1['forced_share'])}.")
    if "bg" in s:
        xs = sorted(p["x"] for p in s["bg"]["avas"])
        for c in ("none", "avas"):
            seg = ", ".join(f"{x:g} dB(A): {pct(pt(res, 'bg', c, x)['share_ge3'])}" for x in xs)
            f.append(f"- **Background noise, {res['labels'][c]}.** Warned ≥ 3 s by noise level — {seg}.")
    return "\n".join(f)


def write(res, out):
    m = res["main"]
    meta = res["meta"]
    dr = res["dashboard_rates"]
    md = f"""# HearMe Monte Carlo — simulated results

> **SIMULATED.** Every number on this page comes from `{meta['generated_by']}` (base seed {meta['base_seed']},
> {meta['attempts_total']} simulated crossing attempts in total, {meta['runtime_s']} s on {meta['workers']} worker processes).
> Nothing here is field data. Raw numbers: [`results.json`](results.json).

## 1. What was simulated

A blind pedestrian arrives at an unsignalised zebra crossing of a two-lane road (lanes at y = −1.75 m and +1.75 m,
road edge ±3.5 m) and waits at the south kerb (y = −4.5 m) facing north. E-bikes and e-scooters arrive as
independent Poisson streams in both directions, at constant speed, and **never yield** (worst case: a "conflict" is
exposure — a rider within 2 m of the pedestrian while the pedestrian is on the road — not a crash prediction).
Distractor traffic is present so false alarms can be measured: a parallel street {SCENE['parallel_street_y_m']:.0f} m
north and parked (speed 0) e-bikes that keep beaconing near the kerb.

Each attempt is simulated at 10 Hz from {RUN['warmup_s']:.0f} s before the pedestrian reaches the kerb until they have
crossed and the critical rider (the first rider to reach the crossing line after the pedestrian's kerb arrival)
has arrived. The same traffic, pedestrian and noise draws are reused across the conditions (common random numbers,
one `SeedSequence` per attempt), so differences between conditions are not sampling noise in the traffic.

**Conditions**

1. **No warning** — the pedestrian hears only tyre/drivetrain noise. Level at the ear = source level at 2 m −
   20·log10(d / 2 m); a rider is *detected* once SNR = level − background > {AUDIO['detect_snr_db']:.0f} dB has held for
   {AUDIO['detect_dwell_s']} s. Background noise is drawn per attempt.
2. **AVAS speaker** — same model with an AVAS-style source level.
3. **HearMe RSSI-only** — the real receiver core (`sim/receiver.py`) with `Config(use_position=False)`; beacons
   carry type, speed and heading but no position.
4. **HearMe with GPS** — the receiver with its default config; beacons carry their GPS position (1 Hz fixes,
   Gauss-Markov error, dead-reckoned between fixes, `sim/world.py`). The phone's own position also has GPS error.

For both HearMe conditions every advertising event (100 ms + 0–10 ms advDelay) of every beacon within
{RUN['radio_range_m']:.0f} m goes through `world.Channel` (log-distance path loss, correlated shadowing, fast fading,
random loss, sensitivity cut-off, phone-in-pocket body loss by angle). Surviving packets are rounded to integer RSSI
and fed as decoded `Packet` objects to `Receiver.process_packet`; `Receiver.tick` runs at 10 Hz. (Encoding and the
HMAC check are skipped for speed; they do not change the receiver's decisions when `require_mac` is off.)

**Pedestrian behaviour (deliberately simple)**

- Waits at the kerb for a random start delay (listening), then steps out at the first 10 Hz tick with **no
  threat**: HearMe — no receiver track at WARN or URGENT; audio — no rider currently detected and approaching.
- While crossing, a *new* warning (a WARN/URGENT event, or a new audio detection of an approaching rider) is acted
  on after the reaction time. If the pedestrian is then still in the first (near) half of the road — before the
  centre line — they walk back to the kerb, wait a fresh start delay and try again; otherwise they keep going.
- After {BEHAVIOUR['max_wait_s']:.0f} s of cumulative waiting they cross regardless and ignore further warnings
  ("gave up").
- Pedestrians in the HearMe conditions rely on HearMe only (their hearing is not added on top).

**Metrics**

- *Lead time*: arrival time of the critical rider at the crossing line minus the time of the first WARN/URGENT for
  that rider (first audio detection for the audio conditions); 0 if there was none before arrival.
- *Continuous lead time*: the same, but measured from the start of the last uninterrupted WARN/URGENT episode (audio:
  detection) that is still running when the rider arrives. This exposes warnings that came early and then dropped out.
- *Warned ≥ 3 s*: share of attempts with lead time ≥ 3 s (Wilson 95 % CI).
- *Conflicts per 1,000 crossings*: attempts in which any rider came within {RUN['conflict_radius_m']:.0f} m of the pedestrian
  while the pedestrian was on the carriageway (|y| < 3.5 m), checked on the swept segment of each 0.1 s step (Wilson CI).
- *False alarms*: WARN/URGENT events (audio: detection onsets) between kerb arrival and the end of the crossing for
  riders whose true closest approach to the crossing path is > {RUN['false_alarm_cpa_m']:.0f} m (parallel street, parked bikes),
  per attempt.
- *Waiting time*: total time spent waiting at the kerb, including the listening delay and re-waits.

## 2. Parameters

Physical parameters come from `sim/params.py`, scenario parameters from `sim/mc_params.py`.

{param_table()}

## 3. Results at the default parameters

{main_table(res)}

Additional numbers:

{extra_table(res)}

Where the conflicts come from (counts of attempts with a conflict, main run):

{conflict_table(res)}

Charts: [lead time ECDF](lead_time_ecdf.png), [lead time histograms](lead_time_hist.png),
[warned ≥ 3 s](share_ge3s.png), [conflicts](conflicts_per_1000.png), [false alarms](false_alarms.png),
[waiting time](waiting_time.png).

![Lead time ECDF](lead_time_ecdf.png)
![Share warned at least 3 s ahead](share_ge3s.png)
![Conflicts per 1000 crossings](conflicts_per_1000.png)
![False alarms](false_alarms.png)
![Waiting time](waiting_time.png)

## 4. Sensitivity

Each point uses fewer attempts than the main run (see N in the tables); other parameters stay at their defaults.

### Key numbers

{findings(res)}

### Packet loss

![Packet loss sensitivity](sensitivity_packet_loss.png)

{sweep_table(res, 'loss', 'Packet loss', lambda x: f"{100 * x:.0f} %")}

### Body attenuation (phone in pocket vs wrist)

![Body attenuation sensitivity](sensitivity_body_attenuation.png)

{sweep_table(res, 'body_db', 'Body loss at worst angle (dB)')}

### Traffic density

![Traffic density sensitivity](sensitivity_traffic_density.png)

{sweep_table(res, 'density', 'Riders / h')}

### Background noise (audio baselines only)

![Background noise sensitivity](sensitivity_background_noise.png)

{sweep_table(res, 'bg', 'Background dB(A)')}

## 5. Interpretation

{interpretation(res)}

## 6. What this simulation can and cannot show

**It can show**

- How the actual HearMe receiver logic (`sim/receiver.py`, the same algorithm as the TypeScript and C ports) behaves
  against a modelled radio channel, GPS error and realistic packet timing, over thousands of randomised encounters.
- Relative differences between warning strategies under identical traffic, and which parameters (packet loss, body
  blocking, traffic density, background noise) move the result and in which direction.
- Design weaknesses that only appear statistically (false alarms from distractor traffic, missed far-lane riders,
  the waiting-time cost of over-warning).

**It cannot show**

- Real-world safety benefit or crash reduction. Riders never yield or swerve here, so conflicts are exposure counts,
  not crash predictions; real riders often slow down for a pedestrian with a white cane.
- Real radio performance: the channel is a textbook log-distance model with assumed shadowing, body loss and packet
  loss; real phones differ in scan duty cycle, RSSI calibration and background-scan throttling (iOS/Android).
- Real human hearing or behaviour: the audibility model is a broadband SNR threshold with no spectral masking, no
  binaural localisation and no learning; the step-out/step-back rule is a simplification. The audio baselines are
  therefore only as good as the assumed source and noise levels (see the background-noise sweep).
- Cars, buses, tuk-tuks, junctions, turning traffic, groups of riders, overtaking interactions, occlusion by parked
  vehicles, or riders without a beacon (100 % fleet adoption is assumed for the HearMe conditions).
- Rolling-ID changes (every 600 s) during an encounter are not exercised: each attempt fits inside one epoch.

All assumptions are labelled in `sim/params.py` and `sim/mc_params.py`. Re-run with `python sim/montecarlo.py`
(or `--quick` for a smoke test); results are reproducible from the base seed.

## 7. Values passed to the city dashboard generator

`sim/gen_city_data.py` reads `dashboard_rates` from `results.json`: in the HearMe GPS condition
{dr['fast_passes_with_urgent']} of {dr['fast_passes']} fast passes within 5 m of the pedestrian
({pct(dr['urgent_per_fast_pass'])}) produced at least one URGENT alert. The dashboard data built from it is synthetic.
"""
    with open(os.path.join(out, "results.md"), "w", encoding="utf-8") as fh:
        fh.write(md)


def interpretation(res):
    """Explanations of the mechanisms behind the numbers. Numbers are pulled from res; the
    mechanisms were checked by tracing individual attempts (see the final report)."""
    m, sw = res["main"], res["sweeps"]
    g, r, n, a = m["gps"], m["rssi"], m["none"], m["avas"]
    gl, rl = g["exposed_by_lane"], r["exposed_by_lane"]
    bg_lo = min(p["x"] for p in sw["bg"]["avas"])
    av_lo, no_lo = pt(res, "bg", "avas", bg_lo), pt(res, "bg", "none", bg_lo)
    av_next = pt(res, "bg", "avas", sorted(p["x"] for p in sw["bg"]["avas"])[1])
    rb0, rb20 = pt(res, "body_db", "rssi", 0.0), pt(res, "body_db", "rssi", 20.0)
    rl0, rl6 = pt(res, "loss", "rssi", 0.0), pt(res, "loss", "rssi", 0.6)
    return f"""**1. The audio baselines warn nobody under the default assumptions.** Tyre noise ({AUDIO['ebike_tyre_dba_2m']:.0f} dB(A) at 2 m)
never clears the detection threshold against {AUDIO['background_dba'][0]:.0f}–{AUDIO['background_dba'][1]:.0f} dB(A) background, and the
AVAS source ({AUDIO['avas_dba_2m']:.0f} dB(A) at 2 m) only within about 3 m even in the quietest default background — a rider passes
through that zone in less than the {AUDIO['detect_dwell_s']} s detection dwell time, so it is never detected. Both baselines therefore behave identically ({n['conflicts_per_1000']:.1f} vs {a['conflicts_per_1000']:.1f} conflicts per 1,000):
the pedestrian simply steps out after the listening delay. The background-noise sweep shows how strongly this hinges on the
assumed levels: at {bg_lo:g} dB(A) the AVAS speaker gives a ≥ 3 s warning in {pct(av_lo['share_ge3'])} of attempts
({av_lo['conflicts_per_1000']:.1f} conflicts per 1,000) but at {av_next['x']:g} dB(A) already {pct(av_next['share_ge3'])}; tyre noise at
{bg_lo:g} dB(A) is heard only {no_lo['lead_median_s']:.2f} s (median) before arrival. Treat the audio baselines as a
"quiet e-bike in normal street noise" bound, not as a measured human hearing performance.

**2. HearMe with GPS gives a consistent ~{g['lead_median_s']:.1f} s warning with almost no false alarms.** The lead time is set by the
receiver's `warn_ttr_s` = 6 s threshold (median {g['lead_median_s']:.2f} s, p10–p90 {g['lead_p10_s']:.2f}–{g['lead_p90_s']:.2f} s). Its
remaining {g['conflicts']} conflicts in {g['n']} attempts: {g['conflicts_while_retreating']} happened while the pedestrian was stepping back
(the step-back rule can walk them into a near-lane rider), and {g['conflicts'] - g['conflicts_alert_before_step']} involved a rider that had
*not* been warned before the pedestrian's last step-out (the two groups overlap) — typically a rider still more than 6 s away at
step-out, while a pedestrian at 0.6–1.4 m/s needs about 5–12 s to cross the 7 m carriageway. A WARN horizon shorter than the crossing time is a structural limit of
the current thresholds, not radio failure.

**3. GPS warnings flicker for riders about 6 m to the side.** When the pedestrian is at the kerb, far-lane riders pass about
6.25 m away, inside the receiver's `pass_radius_m` = 8 m but by less than the combined GPS error (vehicle and phone, each
{GPS['sigma_per_axis_m']} m per axis). For critical riders arriving while the pedestrian was still at the kerb or on the road, a
*continuous* ≥ 3 s warning was present in {pct(gl['near']['share_sustained_ge3'])} of near-lane cases (N = {gl['near']['n']}) but only
{pct(gl['far']['share_sustained_ge3'])} of far-lane cases (N = {gl['far']['n']}); the first warning was ≥ 3 s ahead in {pct(gl['near']['share_ge3'])}
and {pct(gl['far']['share_ge3'])} respectively. With exact phone position (diagnostic row) conflicts drop from {g['conflicts_per_1000']:.1f} to
{m['gps_truepose']['conflicts_per_1000']:.1f} per 1,000 (overlapping CIs; N = {m['gps_truepose']['n']}).

**4. RSSI-only "wins" on first-warning lead time for the wrong reason.** Its median first-warning lead ({r['lead_median_s']:.2f} s) is
longer than GPS ({g['lead_median_s']:.2f} s) — the opposite of what one would expect — but this is not better ranging. In RSSI-only mode
`receiver.py` treats a track as approaching whenever the filtered range rate shows ≥ 0.8 m/s of closing, and then uses the
*advertised ground speed* (not the closing speed) to compute time-to-reach. Shadowing and fast fading (σ {RADIO['shadowing_sigma_db']:.0f} + {RADIO['fast_fading_sigma_db']:.0f} dB)
move the RSSI-derived range by up to about a factor of two (6 dB ≈ ×1.9 with n = 2.2), i.e. tens of metres for riders
30–100 m away, and near the sensitivity limit only up-faded packets survive, so distant
riders look closer than they are. The result is early, intermittent WARN/URGENT alerts for almost every rider in range, including
receding ones and the parallel street: {r['alert_events_per_attempt']:.2f} WARN/URGENT events per attempt (GPS: {g['alert_events_per_attempt']:.2f}) and
{r['false_alarms_per_attempt']:.3f} false alarms per attempt. Measured from the last uninterrupted warning, the two modes are close
(median continuous lead {r['sustained_median_s']:.2f} s RSSI-only vs {g['sustained_median_s']:.2f} s GPS).
The cost is waiting: mean {r['wait_mean_s']:.1f} s at the kerb vs {g['wait_mean_s']:.1f} s, and {pct(r['forced_share'])} of pedestrians
gave up after {BEHAVIOUR['max_wait_s']:.0f} s and crossed while ignoring warnings — {r['conflicts_forced']} of RSSI-only's
{r['conflicts']} conflicts happened in such forced crossings. In the field this alert rate would very likely be switched off by users.

**5. Sensitivity.** The GPS mode is nearly flat across packet loss 0–60 % and body attenuation 0–20 dB (it needs only a few packets
per second, and position does not depend on RSSI). RSSI-only gets *fewer* false alarms with *worse* radio — {rl0['false_alarms_per_attempt']:.2f}
→ {rl6['false_alarms_per_attempt']:.2f} per attempt from 0 % to 60 % loss, {rb0['false_alarms_per_attempt']:.2f} → {rb20['false_alarms_per_attempt']:.2f}
from 0 to 20 dB body loss — because fewer distant packets reach the receiver; another sign its alerts are noise-driven. Traffic
density raises conflicts in every condition (riders never yield); for RSSI-only it also drives waiting time and give-ups up
steeply. All these statements are about the model, under its stated assumptions.
"""

if __name__ == "__main__":
    d = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "docs", "results")
    with open(os.path.join(d, "results.json"), encoding="utf-8") as fh:
        write(json.load(fh), d)
