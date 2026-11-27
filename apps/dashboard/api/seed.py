"""Seed the dashboard database from the HearMe simulation output.

Inputs (written by sim/gen_city_data.py):
  apps/dashboard/api/data/synthetic_counts.csv
      cell_id, lat, lon, hour, fast_passes, urgent_alerts
  apps/dashboard/api/data/synthetic_pois.json
      synthetic schools / bus stops with name, lat, lon, kind

If they are missing, the built-in fallback generator (synthetic.py) is used.

Reseed from the repo root:
    python -m apps.dashboard.api.seed            # wipe and reload
    python -m apps.dashboard.api.seed --fallback # force the built-in generator
"""

from __future__ import annotations

import argparse
import csv
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from . import synthetic
from .db import Store
from .grid import cell_id_for, is_cell_id

DATA_DIR = Path(__file__).resolve().parent / "data"
DEFAULT_DB = DATA_DIR / "dashboard.db"
COUNTS_CSV = DATA_DIR / "synthetic_counts.csv"
POIS_JSON = DATA_DIR / "synthetic_pois.json"


def default_db_path() -> Path:
    return Path(os.environ.get("HEARME_DASHBOARD_DB", DEFAULT_DB))


def _norm_kind(kind: str) -> str | None:
    k = (kind or "").strip().lower()
    if "school" in k:
        return "school"
    if "stop" in k or "bus" in k:
        return "bus_stop"
    return None


def load_pois_json(path: Path) -> list[dict]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    items: list[dict] = []
    if isinstance(raw, list):
        items = raw
    elif isinstance(raw, dict):
        if isinstance(raw.get("pois"), list):
            items = raw["pois"]
        else:  # {"schools": [...], "bus_stops": [...]} style
            for key, val in raw.items():
                if isinstance(val, list):
                    for it in val:
                        if isinstance(it, dict):
                            items.append({"kind": it.get("kind", key), **it})
    out = []
    for it in items:
        kind = _norm_kind(str(it.get("kind") or it.get("type") or ""))
        try:
            lat, lon = float(it["lat"]), float(it["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        if kind is None:
            continue
        out.append({"name": str(it.get("name") or kind), "kind": kind, "lat": lat, "lon": lon})
    return out


def load_counts_csv(path: Path) -> list[tuple[str, int, int, int]]:
    """Read the simulation CSV. The cell is derived from lat/lon on our grid so the
    simulation's own cell_id naming does not have to match ours exactly."""
    rows = []
    with path.open(newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            try:
                hour = int(float(r["hour"]))
                fp = int(float(r.get("fast_passes") or 0))
                ua = int(float(r.get("urgent_alerts") or 0))
            except (KeyError, ValueError):
                continue
            if not 0 <= hour <= 23 or fp < 0 or ua < 0:
                continue
            cid = None
            if r.get("lat") not in (None, "") and r.get("lon") not in (None, ""):
                try:
                    cid = cell_id_for(float(r["lat"]), float(r["lon"]))
                except ValueError:
                    cid = None
            if cid is None and is_cell_id(str(r.get("cell_id", ""))):
                cid = r["cell_id"]
            if cid is None:
                continue
            rows.append((cid, hour, fp, ua))
    return rows


def seed(store: Store, *, force_fallback: bool = False, counts_csv: Path = COUNTS_CSV,
         pois_json: Path = POIS_JSON) -> dict:
    """Wipe the store and load synthetic data. Returns a summary dict."""
    store.clear()
    if not force_fallback and counts_csv.exists():
        rows = load_counts_csv(counts_csv)
        source = f"HearMe simulation output ({counts_csv.name}, sim/gen_city_data.py)"
    else:
        rows = [(r["cell_id"], r["hour"], r["fast_passes"], r["urgent_alerts"])
                for r in synthetic.fallback_counts()]
        source = synthetic.SOURCE_LABEL
    pois = load_pois_json(pois_json) if (not force_fallback and pois_json.exists()) else []
    poi_source = f"{pois_json.name}" if pois else "built-in fallback POIs (synthetic)"
    if not pois:
        pois = synthetic.fallback_pois()
    store.add_counts(rows)
    store.replace_pois(pois)
    summary = {
        "counts_source": source,
        "poi_source": poi_source,
        "seed_rows": len(rows),
        "seeded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    for k, v in summary.items():
        store.set_meta(k, v)
    return summary


def seed_if_empty(store: Store) -> dict | None:
    """Seed an empty DB. Also reseed once the simulation CSV appears if the DB
    was previously filled by the fallback generator."""
    if store.is_empty():
        return seed(store)
    if COUNTS_CSV.exists() and store.get_meta().get("counts_source") == synthetic.SOURCE_LABEL:
        return seed(store)
    return None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", type=Path, default=default_db_path(), help="SQLite file (default: %(default)s)")
    ap.add_argument("--fallback", action="store_true", help="use the built-in synthetic generator")
    args = ap.parse_args()
    store = Store(args.db)
    summary = seed(store, force_fallback=args.fallback)
    print(f"Seeded {args.db}")
    for k, v in summary.items():
        print(f"  {k}: {v}")
    print(f"  stats: {store.stats()}")


if __name__ == "__main__":
    main()
