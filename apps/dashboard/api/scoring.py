"""Ranking of locations for a crossing / speed-reduction measure.

score = (fast_passes + URGENT_WEIGHT * urgent_alerts)
        * (1 + (1 - d / POI_RADIUS_M))      # 1x at 150 m, up to 2x at the POI
        * KIND_WEIGHT[kind of nearest POI]  # children walk to school

Only cells whose centre is within POI_RADIUS_M of a school or bus stop are ranked,
and cells below the k-anonymity threshold are never ranked.
"""

from __future__ import annotations

from .grid import cell_center, haversine_m

URGENT_WEIGHT = 3.0
POI_RADIUS_M = 150.0
KIND_WEIGHT = {"school": 1.25, "bus_stop": 1.0}
INTERVENTION = {
    "school": "Raised zebra crossing",
    "bus_stop": "Speed hump + signage",
}


def nearest_poi(lat: float, lon: float, pois: list[dict]) -> tuple[dict | None, float]:
    best, best_d = None, float("inf")
    for p in pois:
        d = haversine_m(lat, lon, p["lat"], p["lon"])
        if d < best_d:
            best, best_d = p, d
    return best, best_d


def rank_cells(cells: list[dict], pois: list[dict]) -> list[dict]:
    """cells: dicts with cell_id, fast_passes, urgent_alerts (already suppressed)."""
    ranked = []
    for c in cells:
        lat, lon = cell_center(c["cell_id"])
        poi, d = nearest_poi(lat, lon, pois)
        if poi is None or d > POI_RADIUS_M:
            continue
        raw = c["fast_passes"] + URGENT_WEIGHT * c["urgent_alerts"]
        proximity = 1.0 + (1.0 - d / POI_RADIUS_M)
        score = raw * proximity * KIND_WEIGHT.get(poi["kind"], 1.0)
        ranked.append({
            "cell_id": c["cell_id"],
            "lat": lat,
            "lon": lon,
            "fast_passes": c["fast_passes"],
            "urgent_alerts": c["urgent_alerts"],
            "nearest_poi": poi["name"],
            "poi_kind": poi["kind"],
            "distance_m": round(d, 1),
            "score": round(score, 1),
            "intervention": INTERVENTION.get(poi["kind"], INTERVENTION["bus_stop"]),
        })
    ranked.sort(key=lambda r: (-r["score"], r["distance_m"], r["cell_id"]))
    for i, r in enumerate(ranked, start=1):
        r["rank"] = i
    return ranked
