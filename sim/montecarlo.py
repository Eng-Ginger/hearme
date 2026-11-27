"""HearMe Monte Carlo: blind pedestrian at an unsignalised zebra crossing.

Compares four warning conditions over thousands of seeded crossing attempts:
  none  - no warning device: the pedestrian hears only e-bike tyre noise
  avas  - an AVAS-style speaker on every e-bike (same audibility model, louder source)
  rssi  - HearMe receiver, RSSI-only (Config(use_position=False)), beacons without GPS
  gps   - HearMe receiver, default config, beacons with GPS position
plus a diagnostic condition
  gps_truepose - as gps, but the pedestrian's phone knows its own position exactly

The real receiver core (sim/receiver.py) is driven with decoded Packet objects through
Receiver.process_packet and ticked at 10 Hz. Radio, GPS and beacons come from sim/world.py,
physical parameters from sim/params.py, scenario/behaviour parameters from sim/mc_params.py.

Run:
  python sim/montecarlo.py            # full run (>= 2000 attempts per condition + sweeps)
  python sim/montecarlo.py --quick    # smoke run, small N, writes to docs/results/quick/
Everything produced is SIMULATED.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from multiprocessing import Pool

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "protocol", "python"))

import hearme_protocol as hp  # noqa: E402
from mc_params import BEHAVIOUR, RUN, SCENE, SEED, TRAFFIC_MC  # noqa: E402
from params import AUDIO, GPS, PEDESTRIAN, RADIO, TRAFFIC  # noqa: E402
from receiver import URGENT, WARN, Config, Receiver  # noqa: E402
from world import T0, Beacon, Channel, GpsError, Vehicle, rel_angle, to_latlon  # noqa: E402

CONDITIONS = ["none", "avas", "rssi", "gps"]
HEARME = {"rssi", "gps", "gps_truepose"}
LABELS = {
    "none": "No warning (tyre noise only)",
    "avas": "AVAS speaker on e-bike",
    "rssi": "HearMe RSSI-only",
    "gps": "HearMe with GPS",
    "gps_truepose": "HearMe GPS, exact phone position",
}
MAIN, PARALLEL, PARKED = 0, 1, 2


# ------------------------------------------------------------------ scenario
def make_scenario(idx: int, base_seed: int, density: float, bg_override=None):
    """Traffic + pedestrian draw for attempt idx. Identical across conditions (common random
    numbers): only the traffic density changes the realisation."""
    ss = np.random.SeedSequence([base_seed, idx])
    s_traffic, s_noise, s_ped = ss.spawn(3)
    rt = np.random.default_rng(s_traffic)
    lo, hi = BEHAVIOUR["walk_speed_clip_mps"]
    ped = dict(
        speed=float(np.clip(rt.normal(*PEDESTRIAN["walk_speed_mps"]), lo, hi)),
        delay=float(rt.uniform(*PEDESTRIAN["start_delay_s"])),
        bg=float(rt.uniform(*AUDIO["background_dba"])),
    )
    if bg_override is not None:
        ped["bg"] = float(bg_override)

    t_s = RUN["t_start_s"]
    t_k = t_s + RUN["warmup_s"]
    a0 = t_s - 25.0
    a1 = t_k + BEHAVIOUR["max_wait_s"] + 80.0
    vmin, vmax = (k / 3.6 for k in TRAFFIC["ebike_speed_kmh"])
    veh = []   # dicts: kind, ta, vx, y, x0 (parked), type

    def stream(rate_h, y, direction, kind):
        lam = rate_h / 3600.0
        a = a0
        while True:
            a += rt.exponential(1.0 / lam)
            sp = rt.uniform(vmin, vmax)
            off = rt.normal(0.0, SCENE["lateral_sd_m"])
            vt = "e_scooter" if rt.random() < TRAFFIC_MC["escooter_share"] else "e_bike"
            veh.append(dict(kind=kind, ta=a, vx=direction * sp, y=y + off, x0=0.0, type=vt))
            if a > a1:
                break

    ly_s, ly_n = SCENE["lane_y_m"]
    py = SCENE["parallel_street_y_m"]
    half = density / 2.0
    stream(half, ly_s, +1, MAIN)       # eastbound, south lane (right-hand traffic)
    stream(half, ly_n, -1, MAIN)       # westbound, north lane
    par = density * TRAFFIC_MC["parallel_rate_ratio"] / 2.0
    stream(par, py + ly_s, +1, PARALLEL)
    stream(par, py + ly_n, -1, PARALLEL)
    for _ in range(rt.poisson(TRAFFIC_MC["parked_mean"])):
        x = rt.choice([-1, 1]) * rt.uniform(*TRAFFIC_MC["parked_x_range_m"])
        y = float(rt.choice(TRAFFIC_MC["parked_y_m"]))
        veh.append(dict(kind=PARKED, ta=math.nan, vx=0.0, y=y, x0=float(x), type="e_bike",
                        heading=float(rt.uniform(0, 360))))
    return ped, veh, s_noise, s_ped, t_s, t_k


def path_cpa(v) -> float:
    """True closest approach of a vehicle to the crossing path (x = 0, y in [wait_y, end_y])."""
    y0, y1 = SCENE["ped_wait_y_m"], SCENE["ped_end_y_m"]
    if v["kind"] == PARKED:
        dy = 0.0 if y0 <= v["y"] <= y1 else min(abs(v["y"] - y0), abs(v["y"] - y1))
        return math.hypot(v["x0"], dy)
    return 0.0 if y0 <= v["y"] <= y1 else min(abs(v["y"] - y0), abs(v["y"] - y1))


# ------------------------------------------------------------------ one attempt
def simulate(cond: str, idx: int, base_seed: int, ov: dict) -> dict:
    density = ov.get("density", TRAFFIC_MC["main_rate_per_h"])
    ped, veh, s_noise, s_ped, t_s, t_k = make_scenario(idx, base_seed, density, ov.get("bg"))
    rn = np.random.default_rng(s_noise)
    rp = np.random.default_rng(s_ped)
    dt = RUN["tick_s"]
    n = len(veh)
    kind = np.array([v["kind"] for v in veh])
    ta = np.array([v["ta"] for v in veh])
    vx = np.array([v["vx"] for v in veh])
    vy_ = np.array([v["y"] for v in veh])
    x0 = np.array([v["x0"] for v in veh])
    main_idx = np.where(kind == MAIN)[0]
    moving = kind != PARKED

    def xs(t):
        return np.where(moving, vx * (t - np.nan_to_num(ta)), x0)

    # critical vehicle: first main-road vehicle reaching x = 0 after kerb arrival
    after = main_idx[ta[main_idx] >= t_k]
    crit = int(after[np.argmin(ta[after])])
    t_crit = float(ta[crit])
    cpa = np.array([path_cpa(v) for v in veh])
    distractor = cpa > RUN["false_alarm_cpa_m"]

    hearme = cond in HEARME
    if hearme:
        cfg = Config(use_position=(cond != "rssi"))
        rx = Receiver(cfg)
        chan = Channel(rn, loss=ov.get("loss", RADIO["packet_loss"]),
                       body_db=ov.get("body_db", RADIO["body_loss_pocket_db"]))
        use_gps = cond != "rssi"
        beacons, rid_to_idx = [], {}
        t_veh0 = t_s - 30.0
        for i, v in enumerate(veh):
            if v["kind"] == PARKED:
                vv = Vehicle(v["type"], (v["x0"], v["y"]), v["heading"], 0.0, t_start=t_veh0,
                             secret=b"v%d" % i)
            else:
                hd = 90.0 if v["vx"] > 0 else 270.0
                vv = Vehicle(v["type"], (v["vx"] * (t_veh0 - v["ta"]), v["y"]), hd, abs(v["vx"]),
                             t_start=t_veh0, secret=b"v%d" % i)
            b = Beacon(vv, rn, gps=use_gps)
            b.next_adv = t_s + rn.uniform(0, RADIO["adv_interval_s"])
            beacons.append(b)
            rid_to_idx[hp.rolling_id_for(vv.secret, hp.epoch_of(T0 + t_s))] = i
        crit_key = hp.rolling_id_for(b"v%d" % crit, hp.epoch_of(T0 + t_s)) + ":" + veh[crit]["type"]
        phone_err = GpsError(rn) if (cond == "gps" and RUN["phone_gps_error"]) else None
    else:
        src = AUDIO["avas_dba_2m"] if cond == "avas" else AUDIO["ebike_tyre_dba_2m"]
        src = ov.get("src_dba", src)
        above_since = np.full(n, np.nan)
        prev_det = np.zeros(n, dtype=bool)

    first_alert = np.full(n, np.nan)      # first WARN/URGENT (or first audio detection) per vehicle
    got_urgent = np.zeros(n, dtype=bool)
    min_d = np.full(n, np.inf)            # min distance to pedestrian during [t_k, end]
    fa_events = 0
    all_events = 0
    conflict_v = -1
    t_step_conf = y_conf = math.nan
    retreat_conf = False
    crit_on_since = math.nan              # start of the current WARN+/detection episode of the critical vehicle
    sustained = 0.0
    exposed_at_crit = None                # pedestrian still at the kerb or on the road when it arrives?
    t_conflict = math.nan

    y = SCENE["ped_wait_y_m"]
    state = "pre"
    go_after = math.inf
    wait_total = 0.0
    pending = None
    forced = False
    retreats = 0
    t_step = math.nan
    t_done = math.nan
    t_end_cap = 590.0                     # stay inside one rolling-ID epoch
    rw = SCENE["road_half_width_m"]
    t = t_s
    while True:
        tn = t + dt
        new_alert = False
        x_a = xs(t)
        # ---------------- sensing over (t, tn]
        if hearme:
            if phone_err is not None:
                ex, ey = phone_err.at(t)
            else:
                ex = ey = 0.0
            lat, lon = to_latlon(ex, y + ey)
            rx.set_pose(lat, lon, 0.0)
            d_now = np.hypot(x_a, vy_ - y)
            pk = []
            for i in range(n):
                b = beacons[i]
                if d_now[i] < RUN["radio_range_m"]:
                    while b.next_adv < tn:
                        pk.append((b.next_adv, i))
                        b.next_adv += RADIO["adv_interval_s"] + rn.uniform(0, RADIO["adv_delay_max_s"])
                elif b.next_adv < tn:
                    k = math.ceil((tn - b.next_adv) / RADIO["adv_interval_s"])
                    b.next_adv += k * RADIO["adv_interval_s"]
            pk.sort()
            for tp, i in pk:
                px = vx[i] * (tp - ta[i]) if moving[i] else x0[i]
                d = math.hypot(px, vy_[i] - y)
                r = chan.rssi(i, tp, d, rel_angle((0.0, y), 0.0, px, vy_[i]))
                if r is None:
                    continue
                evs = rx.process_packet(tp, float(int(round(r))), beacons[i].packet(tp))
                for e in evs:
                    if e["urgency"] >= WARN:
                        j = rid_to_idx.get(e["id"], -1)
                        all_events += 1
                        if j >= 0:
                            if math.isnan(first_alert[j]):
                                first_alert[j] = e["t"]
                            if e["urgency"] == URGENT:
                                got_urgent[j] = True
                            if distractor[j] and e["t"] >= t_k and state != "done":
                                fa_events += 1
                        if state == "cross":
                            new_alert = True
            rx.tick(tn)
            threat = any(tr.level >= WARN for tr in rx.tracks.values())
            ctr = rx.tracks.get(crit_key)
            crit_on = ctr is not None and ctr.level >= WARN
        else:
            x_n = xs(tn)
            d = np.hypot(x_n, vy_ - y)
            lvl = src - 20.0 * np.log10(np.maximum(d, 0.5) / 2.0)
            above = moving & (d < RUN["audio_range_m"]) & (lvl - ped["bg"] > AUDIO["detect_snr_db"])
            above_since = np.where(above, np.where(np.isnan(above_since), tn, above_since), np.nan)
            det = above & (tn - above_since >= AUDIO["detect_dwell_s"] - 1e-9)
            appr = det & (x_n * vx < 0)
            onset = appr & ~prev_det
            prev_det = appr
            for j in np.where(onset)[0]:
                all_events += 1
                if math.isnan(first_alert[j]):
                    first_alert[j] = tn
                if distractor[j] and tn >= t_k and state != "done":
                    fa_events += 1
                if state == "cross":
                    new_alert = True
            threat = bool(appr.any())
            crit_on = bool(appr[crit])

        if tn <= t_crit:
            if crit_on:
                if math.isnan(crit_on_since):
                    crit_on_since = tn
            else:
                crit_on_since = math.nan
            sustained = 0.0 if math.isnan(crit_on_since) else t_crit - crit_on_since
        elif exposed_at_crit is None:
            exposed_at_crit = state != "done"
        # ---------------- exposure / conflicts over (t, tn] (pedestrian position y during it)
        x_b = xs(tn)
        if tn > t_k:
            dy = vy_[main_idx] - y
            xa, xb = x_a[main_idx], x_b[main_idx]
            straddle = (xa <= 0) != (xb <= 0)
            dm = np.where(straddle, np.abs(dy), np.minimum(np.hypot(xa, dy), np.hypot(xb, dy)))
            min_d[main_idx] = np.minimum(min_d[main_idx], dm)
            if state in ("cross", "retreat") and abs(y) < rw and conflict_v < 0:
                hit = np.where(dm < RUN["conflict_radius_m"])[0]
                if hit.size:
                    conflict_v = int(main_idx[hit[0]])
                    t_conflict = tn
                    t_step_conf = t_step
                    y_conf = y
                    retreat_conf = state == "retreat"

        # ---------------- pedestrian behaviour at tn
        if state == "pre" and tn >= t_k - 1e-9:
            state = "wait"
            go_after = t_k + ped["delay"]
        if state == "wait":
            wait_total += dt if tn > t_k + 1e-9 else 0.0
            if wait_total >= BEHAVIOUR["max_wait_s"]:
                state, forced = "cross", True
            elif tn >= go_after - 1e-9 and not threat:
                state = "cross"
            if state == "cross":
                pending = None
                t_step = tn
        elif state == "cross":
            if new_alert and pending is None and not forced:
                pending = tn + PEDESTRIAN["reaction_s"]
            if pending is not None and tn >= pending - 1e-9:
                pending = None
                if y < 0.0:
                    state = "retreat"
                    retreats += 1
        if state == "cross":
            y += ped["speed"] * dt
            if y >= SCENE["ped_end_y_m"]:
                y = SCENE["ped_end_y_m"]
                state, t_done = "done", tn
        elif state == "retreat":
            y -= ped["speed"] * dt
            if y <= SCENE["ped_wait_y_m"]:
                y = SCENE["ped_wait_y_m"]
                state = "wait"
                d2 = rp.uniform(*PEDESTRIAN["start_delay_s"]) if BEHAVIOUR["restart_delay_after_retreat"] else 0.0
                go_after = tn + d2
        t = tn
        if (state == "done" and t >= t_crit + 0.5) or t >= t_end_cap:
            break

    fa = first_alert[crit]
    lead = (t_crit - fa) if (not math.isnan(fa) and fa < t_crit) else 0.0
    t_end = t
    t_ped_end = t_done if not math.isnan(t_done) else t_end
    fp = [j for j in main_idx if t_k <= ta[j] <= t_ped_end and min_d[j] <= RUN["fast_pass_radius_m"]]
    return dict(
        cond=cond, idx=idx, lead=float(lead), sustained=float(sustained), crit_far=bool(vy_[crit] > 0),
        exposed_at_crit=bool(exposed_at_crit if exposed_at_crit is not None else state != "done"), warned=bool(not math.isnan(fa) and fa < t_crit),
        conflict=bool(conflict_v >= 0), conflict_is_crit=bool(conflict_v == crit),
        conflict_far_lane=bool(conflict_v >= 0 and vy_[conflict_v] > 0),
        conflict_alert_before_step=bool(conflict_v >= 0 and not math.isnan(first_alert[conflict_v])
                                        and first_alert[conflict_v] <= t_step_conf),
        conflict_after_step_s=float(t_conflict - t_step_conf) if conflict_v >= 0 else math.nan,
        conflict_while_retreating=bool(retreat_conf),
        conflict_ped_y=float(y_conf) if conflict_v >= 0 else math.nan,
        fa=int(fa_events), events=int(all_events), wait=float(wait_total), forced=bool(forced),
        retreats=int(retreats), done=bool(state == "done"),
        fast_passes=len(fp), fast_urgent=int(sum(bool(got_urgent[j]) for j in fp)),
        crit_dt=float(t_crit - t_k), bg=ped["bg"], speed=ped["speed"],
    )


def run_chunk(args):
    cond, idxs, base_seed, ov = args
    return [simulate(cond, i, base_seed, ov) for i in idxs]


# ------------------------------------------------------------------ statistics
def wilson(k: int, n: int, z: float = 1.959964):
    if n == 0:
        return (math.nan, math.nan)
    p = k / n
    den = 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (max(0.0, c - h), min(1.0, c + h))


def mean_ci(x):
    x = np.asarray(x, dtype=float)
    m = float(x.mean())
    se = float(x.std(ddof=1) / math.sqrt(len(x))) if len(x) > 1 else 0.0
    return m, (m - 1.959964 * se, m + 1.959964 * se)


def summarise(rows):
    n = len(rows)
    lead = np.array([r["lead"] for r in rows])
    k3 = int((lead >= RUN["lead_ok_s"]).sum())
    kc = int(sum(r["conflict"] for r in rows))
    kw = int(sum(r["warned"] for r in rows))
    fa = [r["fa"] for r in rows]
    fam, faci = mean_ci(fa)
    wm, wci = mean_ci([r["wait"] for r in rows])
    kfa1 = int(sum(1 for r in rows if r["fa"] > 0))
    fpn = int(sum(r["fast_passes"] for r in rows))
    fpu = int(sum(r["fast_urgent"] for r in rows))
    sus = np.array([r["sustained"] for r in rows])
    ks3 = int((sus >= RUN["lead_ok_s"]).sum())
    ex = [r for r in rows if r["exposed_at_crit"]]
    nex = len(ex)
    lex = np.array([r["lead"] for r in ex]) if nex else np.array([0.0])
    kex3 = int((lex >= RUN["lead_ok_s"]).sum()) if nex else 0
    by_lane = {}
    for lane in ("near", "far"):
        sub = [r for r in ex if r["crit_far"] == (lane == "far")]
        if sub:
            by_lane[lane] = dict(
                n=len(sub),
                share_ge3=float(np.mean([r["lead"] >= RUN["lead_ok_s"] for r in sub])),
                share_sustained_ge3=float(np.mean([r["sustained"] >= RUN["lead_ok_s"] for r in sub])))
    lo3, hi3 = wilson(k3, n)
    loc, hic = wilson(kc, n)
    return dict(
        n=n,
        lead_mean_s=float(lead.mean()), lead_median_s=float(np.median(lead)),
        lead_p10_s=float(np.percentile(lead, 10)), lead_p90_s=float(np.percentile(lead, 90)),
        warned_share=kw / n,
        sustained_mean_s=float(sus.mean()), sustained_median_s=float(np.median(sus)),
        share_sustained_ge3=ks3 / n, share_sustained_ge3_ci=list(wilson(ks3, n)),
        n_exposed_at_crit=nex, exposed_lead_median_s=float(np.median(lex)),
        exposed_share_ge3=(kex3 / nex) if nex else math.nan,
        exposed_share_sustained_ge3=float(np.mean([r["sustained"] >= RUN["lead_ok_s"] for r in ex])) if nex else math.nan,
        exposed_by_lane=by_lane,
        exposed_share_ge3_ci=list(wilson(kex3, nex)) if nex else [math.nan, math.nan],
        share_ge3=k3 / n, share_ge3_ci=[lo3, hi3], n_ge3=k3,
        conflicts=kc, conflicts_per_1000=1000.0 * kc / n, conflicts_per_1000_ci=[1000 * loc, 1000 * hic],
        conflicts_with_critical=int(sum(r["conflict_is_crit"] for r in rows)),
        conflicts_far_lane=int(sum(r["conflict_far_lane"] for r in rows)),
        conflicts_alert_before_step=int(sum(r["conflict_alert_before_step"] for r in rows)),
        conflicts_while_retreating=int(sum(r["conflict_while_retreating"] for r in rows)),
        conflicts_forced=int(sum(r["conflict"] and r["forced"] for r in rows)),
        conflict_after_step_median_s=float(np.median([r["conflict_after_step_s"] for r in rows if r["conflict"]])) if kc else math.nan,
        false_alarms_per_attempt=fam, false_alarms_per_attempt_ci=list(faci),
        share_attempts_with_false_alarm=kfa1 / n,
        alert_events_per_attempt=float(np.mean([r["events"] for r in rows])),
        wait_mean_s=wm, wait_mean_ci=list(wci),
        wait_median_s=float(np.median([r["wait"] for r in rows])),
        forced_share=float(np.mean([r["forced"] for r in rows])),
        retreats_per_attempt=float(np.mean([r["retreats"] for r in rows])),
        fast_passes=fpn, fast_passes_with_urgent=fpu,
        urgent_per_fast_pass=(fpu / fpn) if fpn else math.nan,
        lead_values=[round(float(v), 3) for v in lead],
        sustained_values=[round(float(v), 3) for v in sus],
    )


# ------------------------------------------------------------------ driver
def build_jobs(quick: bool):
    n_main = 200 if quick else 2000
    n_sweep = 60 if quick else 800
    n_audio = 200 if quick else 2000
    jobs = []   # (group, point_value, cond, n, base_seed, idx_offset, ov)
    for c in CONDITIONS + ["gps_truepose"]:
        jobs.append(("main", None, c, n_main if c != "gps_truepose" else n_main // 2, SEED, 0, {}))
    sweeps = {
        "loss": ([0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6], ["rssi", "gps"], "loss"),
        "body_db": ([0.0, 4.0, 10.0, 15.0, 20.0], ["rssi", "gps"], "body_db"),
        "density": ([60.0, 120.0, 200.0, 300.0, 450.0, 600.0], CONDITIONS, "density"),
    }
    for g, (vals, conds, key) in sweeps.items():
        for v in vals:
            for c in conds:
                jobs.append((g, v, c, n_sweep, SEED + 1, 100000, {key: v}))
    for v in [35.0, 40.0, 45.0, 50.0, 55.0, 60.0, 65.0, 70.0]:
        for c in ["none", "avas"]:
            jobs.append(("bg", v, c, n_audio, SEED + 2, 200000, {"bg": v}))
    return jobs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true", help="small N smoke run -> docs/results/quick/")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    a = ap.parse_args()
    out = os.path.join(HERE, "..", "docs", "results")
    if a.quick:
        out = os.path.join(out, "quick")
    os.makedirs(out, exist_ok=True)
    jobs = build_jobs(a.quick)
    tasks, keys = [], []
    for j, (g, v, c, n, seed, off, ov) in enumerate(jobs):
        cs = 10
        for s in range(0, n, cs):
            idxs = list(range(off + s, off + min(n, s + cs)))
            # heavier HearMe chunks first for better load balance
            tasks.append((c, idxs, seed, ov))
            keys.append(j)
    order = sorted(range(len(tasks)), key=lambda k: (tasks[k][0] not in HEARME, -tasks[k][3].get("density", 200)))
    t0 = time.time()
    results = [[] for _ in jobs]
    with Pool(a.workers) as pool:
        done = 0
        for k, rows in zip(order, pool.imap(run_chunk, [tasks[k] for k in order], chunksize=1)):
            results[keys[k]].extend(rows)
            done += 1
            if done % 200 == 0:
                print(f"  {done}/{len(tasks)} chunks, {time.time() - t0:.0f} s", flush=True)
    runtime = time.time() - t0
    print(f"simulation done in {runtime:.1f} s with {a.workers} workers")

    res = {"meta": dict(
        generated_by="sim/montecarlo.py" + (" --quick" if a.quick else ""),
        label="SIMULATED - HearMe Monte Carlo. Not field data.",
        runtime_s=round(runtime, 1), workers=a.workers, base_seed=SEED,
        attempts_total=int(sum(len(r) for r in results)),
    ), "labels": LABELS, "main": {}, "sweeps": {}}
    for j, (g, v, c, n, seed, off, ov) in enumerate(jobs):
        rows = sorted(results[j], key=lambda r: r["idx"])
        s = summarise(rows)
        if g == "main":
            res["main"][c] = s
        else:
            s.pop("lead_values")
            s.pop("sustained_values")
            res["sweeps"].setdefault(g, {}).setdefault(c, []).append(dict(x=v, **s))
    for g in res["sweeps"]:
        for c in res["sweeps"][g]:
            res["sweeps"][g][c].sort(key=lambda d: d["x"])
    res["dashboard_rates"] = dict(
        source_condition="gps",
        urgent_per_fast_pass=res["main"]["gps"]["urgent_per_fast_pass"],
        fast_passes=res["main"]["gps"]["fast_passes"],
        fast_passes_with_urgent=res["main"]["gps"]["fast_passes_with_urgent"],
        definition="share of e-bike/e-scooter passes within 5 m of the pedestrian (after kerb arrival, "
                   "before the end of the crossing) for which the receiver issued at least one URGENT alert",
    )
    with open(os.path.join(out, "results.json"), "w", encoding="utf-8") as f:
        json.dump(res, f, indent=1)
    import plots
    import report
    plots.make_all(res, out)
    report.write(res, out)
    print_table(res)


def print_table(res):
    print(f"{'condition':34s} {'N':>5s} {'lead med':>8s} {'lead mean':>9s} {'>=3s':>6s} "
          f"{'confl/1000':>10s} {'FA/att':>7s} {'wait':>6s}")
    for c, s in res["main"].items():
        print(f"{LABELS[c]:34s} {s['n']:5d} {s['lead_median_s']:8.2f} {s['lead_mean_s']:9.2f} "
              f"{100 * s['share_ge3']:5.1f}% {s['conflicts_per_1000']:10.1f} "
              f"{s['false_alarms_per_attempt']:7.3f} {s['wait_mean_s']:6.1f}")


if __name__ == "__main__":
    main()
