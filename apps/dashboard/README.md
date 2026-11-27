# HearMe City Dashboard

Prototype for the WFEO Hackathon 2027. HearMe receivers (the phones and wristbands
of blind pedestrians) can upload **anonymous, aggregated counts** of fast two-wheeler
passes and urgent alerts (near misses) per ~100 m grid cell and hour. The dashboard
shows where these cluster near schools and bus stops in Ajman, UAE, and ranks sites
for a raised crossing or speed hump.

> **All data shown is SYNTHETIC**: it comes from the HearMe simulation
> (`sim/gen_city_data.py`) or, if that output is missing, from a built-in fallback
> generator. Schools and stops are invented ("Synthetic School A", "Synthetic Stop 1").
> None of it is a real measurement.

```
apps/dashboard/
  api/        FastAPI + SQLite (stdlib sqlite3)
    main.py       app, endpoints, ingest models, static serving
    seed.py       loads data/synthetic_counts.csv + data/synthetic_pois.json; reseed CLI
    synthetic.py  fallback generator (synthetic) used when the CSV is missing
    scoring.py    ranking of crossing / speed-hump sites
    grid.py       cell ids and geometry
    data/         seed inputs and dashboard.db (the *.db file is gitignored)
    tests/        pytest
  web/        Vite + React + TypeScript + Leaflet (react-leaflet), own package.json
```

## Run (one command after a build)

All commands run from the **repository root** unless stated. Tested on Windows 11
with Python 3.13 and Node 24 (PowerShell or Git Bash).

```bash
# 1. Python deps (once)
pip install fastapi uvicorn httpx pytest

# 2. Build the web app (once, or after changing web/)
cd apps/dashboard/web
npm install
npm run build          # outputs apps/dashboard/web/dist
cd ../../..

# 3. Start everything (API + built web app) from the repo root
python -m uvicorn apps.dashboard.api.main:app --port 8000
```

Open <http://127.0.0.1:8000/>. API docs: <http://127.0.0.1:8000/docs>.

On first start the database (`apps/dashboard/api/data/dashboard.db`) is created and
seeded from `data/synthetic_counts.csv` if it exists, otherwise from the fallback
generator. If the DB was filled by the fallback and the simulation CSV appears later,
the next start reseeds automatically. To reseed by hand (wipes ingested counts too):

```bash
python -m apps.dashboard.api.seed              # from the simulation CSV/JSON if present
python -m apps.dashboard.api.seed --fallback   # force the built-in synthetic generator
```

Set `HEARME_DASHBOARD_DB=path/to/file.db` to use another database file.

### Development with hot reload

```bash
python -m uvicorn apps.dashboard.api.main:app --port 8000 --reload   # terminal 1, repo root
cd apps/dashboard/web && npm run dev                                  # terminal 2
```

Open <http://localhost:5173/>; Vite proxies `/api` to `http://127.0.0.1:8000`. The
API also allows CORS from `localhost:5173` / `127.0.0.1:5173`.

### Tests

```bash
python -m pytest apps/dashboard/api/tests -q
```

## Data format

**Grid.** A cell is 0.001 x 0.001 degrees (about 111 m x 100 m in Ajman). Its id is
`<floor(lat/0.001)>_<floor(lon/0.001)>`, e.g. `25405_55513` covers
25.405-25.406 N, 55.513-55.514 E. The server derives the centre from the id.

**Seed CSV** `api/data/synthetic_counts.csv`:
`cell_id,lat,lon,hour,fast_passes,urgent_alerts`. The loader assigns each row to a
cell from its `lat`/`lon` (so the simulation's own `cell_id` naming does not need to
match), falling back to `cell_id` only if lat/lon are blank. Rows for the same cell
and hour are summed.

**Seed POIs** `api/data/synthetic_pois.json`: a list of `{name, kind, lat, lon}`, or
`{"pois": [...]}`, or `{"schools": [...], "bus_stops": [...]}`. `kind` containing
"school" maps to `school`; "stop"/"bus" maps to `bus_stop`.

## API

| Method | Path | Notes |
|---|---|---|
| POST | `/api/ingest` | Body `{"records": [...]}` or a bare list. Each record is exactly `{cell_id, hour 0-23, fast_passes >= 0, urgent_alerts >= 0}` (integers). Counts are added to the (cell, hour) bucket. Max 5,000 records per batch, 10,000 per count. |
| GET | `/api/cells?hour=&min=` | Per-cell totals with centre, bounds, max values. `hour` omitted = all day. `min` can raise, never lower, the suppression threshold. |
| GET | `/api/pois` | Synthetic schools and bus stops. |
| GET | `/api/top?limit=10&hour=` | Ranked sites (see scoring). |
| GET | `/api/export.csv?hour=` | Cell totals + rank, score, nearest POI, intervention. First line is a `#` comment saying the data is synthetic. |
| GET | `/api/meta` | `synthetic: true`, data source, record counts, privacy notes. |

```bash
curl -X POST http://127.0.0.1:8000/api/ingest -H "Content-Type: application/json" \
  -d '{"records":[{"cell_id":"25405_55513","hour":8,"fast_passes":2,"urgent_alerts":1}]}'
```

### Privacy by construction

* The ingest models use `extra="forbid"` and strict types: a record (or batch) with
  any extra field, such as `device_id`, `rolling_id`, a precise `lat`/`lon` or a
  `timestamp`, is rejected with **422** and nothing is stored.
* Only summed (cell, hour) buckets are stored; individual uploads are not kept.
* **Minimum count (k-anonymity style):** every GET endpoint, including the CSV
  export and the ranking, hides cells whose total (fast passes + urgent alerts) in
  the requested view is below **3**, so a single person's few events cannot be
  singled out. The response reports how many cells were hidden.

### Scoring (`/api/top`)

Only cells whose centre is within **150 m** of a school or bus stop are ranked.

```
score = (fast_passes + 3 * urgent_alerts) * (2 - d / 150) * kind_weight
kind_weight = 1.25 for a school, 1.0 for a bus stop
```

`d` is the distance in metres from the cell centre to the nearest POI. Suggested
intervention: **Raised zebra crossing** when the nearest POI is a school, **Speed
hump + signage** otherwise. These are planning prompts for engineers, not
recommendations validated against real traffic data.

## Web app

* OpenStreetMap tiles (with attribution), grid cells as coloured rectangles,
  6-class sequential scale with legend; toggle fast passes / urgent alerts.
* Hour slider: all day or a single hour. Ranking, totals and export follow it.
* School and bus-stop markers (div icons), top-10 list (click or Enter to fly to the
  cell), CSV export button, and a fixed **SYNTHETIC DATA** banner.
* Keyboard usable (native radio, range, buttons; Leaflet keyboard panning), visible
  focus rings, AA-contrast text, honours `prefers-reduced-motion`, stacks on phones.

## Not done / limits

* Map tiles come from tile.openstreetmap.org, so the map background needs internet
  (the data and UI work offline). Heavy use should switch to a self-hosted or
  commercial tile server per the OSM tile usage policy.
* No authentication on `/api/ingest`. A real deployment needs rate limiting and
  device attestation that does not identify the user, and possibly noise (differential
  privacy) on top of the minimum-count rule.
* Hour is local time of day only; there is no date dimension.
