"""The aggregation grid.

A cell is a 0.001 x 0.001 degree square (about 111 m x 100 m at Ajman's latitude).
Its id is "<lat_index>_<lon_index>" where index = floor(degrees / 0.001), so
cell "25405_55513" covers 25.405-25.406 N, 55.513-55.514 E. The id alone is all a
receiver uploads; the server derives the cell centre from it.
"""

from __future__ import annotations

import math
import re

CELL_DEG = 0.001
CELL_ID_PATTERN = r"^-?\d{1,6}_-?\d{1,6}$"
_CELL_RE = re.compile(CELL_ID_PATTERN)

# Ajman, UAE (city centre, approx.)
CENTER_LAT = 25.405
CENTER_LON = 55.513


def is_cell_id(value: str) -> bool:
    if not _CELL_RE.match(value):
        return False
    lat_i, lon_i = (int(p) for p in value.split("_"))
    return -90_000 <= lat_i < 90_000 and -180_000 <= lon_i < 180_000


def cell_id_for(lat: float, lon: float) -> str:
    # small epsilon so a value given as an exact cell centre/edge floors predictably
    lat_i = math.floor(lat / CELL_DEG + 1e-9)
    lon_i = math.floor(lon / CELL_DEG + 1e-9)
    return f"{lat_i}_{lon_i}"


def cell_center(cell_id: str) -> tuple[float, float]:
    lat_i, lon_i = (int(p) for p in cell_id.split("_"))
    return (round((lat_i + 0.5) * CELL_DEG, 6), round((lon_i + 0.5) * CELL_DEG, 6))


def cell_bounds(cell_id: str) -> list[list[float]]:
    lat_i, lon_i = (int(p) for p in cell_id.split("_"))
    return [
        [round(lat_i * CELL_DEG, 6), round(lon_i * CELL_DEG, 6)],
        [round((lat_i + 1) * CELL_DEG, 6), round((lon_i + 1) * CELL_DEG, 6)],
    ]


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))
