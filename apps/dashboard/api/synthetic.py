"""FALLBACK SYNTHETIC DATA GENERATOR.

Used only when sim/gen_city_data.py has not produced
apps/dashboard/api/data/synthetic_counts.csv. Everything here is invented: the
schools, stops and counts are not real places or measurements. The output has the
same shape as the simulation's CSV/JSON so the dashboard behaves the same way.
"""

from __future__ import annotations

import math
import random

from .grid import CELL_DEG, CENTER_LAT, CENTER_LON, cell_center, cell_id_for, haversine_m

SOURCE_LABEL = "built-in fallback generator (synthetic, not the HearMe simulation output)"

# Offsets in cells from the Ajman centre. Invented positions.
_SCHOOLS = [(-6, -4), (5, 7), (-3, 9), (8, -7)]
_STOPS = [(0, 0), (0, 6), (0, -6), (-7, 2), (6, 0), (3, -9), (-9, -8), (9, 9)]

# Relative traffic by hour (school runs, commute, evening)
_HOUR_PROFILE = [
    0.10, 0.05, 0.05, 0.05, 0.10, 0.30, 0.70, 1.00, 0.90, 0.60, 0.50, 0.55,
    0.70, 0.95, 0.85, 0.70, 0.75, 0.90, 0.95, 0.85, 0.65, 0.45, 0.30, 0.18,
]


def _poisson(rng: random.Random, lam: float) -> int:
    if lam <= 0:
        return 0
    if lam > 30:
        return max(0, int(round(rng.gauss(lam, math.sqrt(lam)))))
    l, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= l:
            return k
        k += 1


def fallback_pois() -> list[dict]:
    pois = []
    for i, (dy, dx) in enumerate(_SCHOOLS):
        pois.append({
            "name": f"Synthetic School {chr(ord('A') + i)}",
            "kind": "school",
            "lat": round(CENTER_LAT + dy * CELL_DEG + 0.0003, 6),
            "lon": round(CENTER_LON + dx * CELL_DEG + 0.0006, 6),
        })
    for i, (dy, dx) in enumerate(_STOPS):
        pois.append({
            "name": f"Synthetic Stop {i + 1}",
            "kind": "bus_stop",
            "lat": round(CENTER_LAT + dy * CELL_DEG + 0.0007, 6),
            "lon": round(CENTER_LON + dx * CELL_DEG + 0.0002, 6),
        })
    return pois


def fallback_counts(seed: int = 2027, half_size: int = 12) -> list[dict]:
    """Rows of {cell_id, lat, lon, hour, fast_passes, urgent_alerts}."""
    rng = random.Random(seed)
    pois = fallback_pois()
    rows = []
    base_i = math.floor(CENTER_LAT / CELL_DEG)
    base_j = math.floor(CENTER_LON / CELL_DEG)
    for di in range(-half_size, half_size + 1):
        for dj in range(-half_size, half_size + 1):
            on_road = di == 0 or dj in (-6, 0, 6) or di in (-7, 6)
            if not on_road and rng.random() < 0.55:
                continue  # quiet back streets: no receivers passed by
            cid = f"{base_i + di}_{base_j + dj}"
            lat, lon = cell_center(cid)
            near = min(haversine_m(lat, lon, p["lat"], p["lon"]) for p in pois)
            # invented hotspots: more fast riders near some stops / schools
            hot = 1.0 + 2.5 * math.exp(-((near / 120.0) ** 2)) * rng.uniform(0.3, 1.2)
            road = 2.2 if on_road else 0.35
            for hour, prof in enumerate(_HOUR_PROFILE):
                lam_fast = 1.6 * road * hot * prof
                fp = _poisson(rng, lam_fast)
                ua = _poisson(rng, 0.07 * lam_fast * hot)
                if fp or ua:
                    rows.append({
                        "cell_id": cid, "lat": lat, "lon": lon, "hour": hour,
                        "fast_passes": fp, "urgent_alerts": ua,
                    })
    return rows


def _selfcheck() -> None:  # pragma: no cover - manual helper
    rows = fallback_counts()
    assert all(cell_id_for(r["lat"], r["lon"]) == r["cell_id"] for r in rows)
    print(len(rows), "rows")


if __name__ == "__main__":  # pragma: no cover
    _selfcheck()
