export type Metric = "fast_passes" | "urgent_alerts";

export interface Cell {
  cell_id: string;
  lat: number;
  lon: number;
  bounds: [[number, number], [number, number]];
  fast_passes: number;
  urgent_alerts: number;
  total: number;
}

export interface CellsResponse {
  hour: number | null;
  min_total: number;
  suppressed_cells: number;
  max_fast_passes: number;
  max_urgent_alerts: number;
  cells: Cell[];
}

export interface Poi {
  name: string;
  kind: "school" | "bus_stop";
  lat: number;
  lon: number;
}

export interface Ranked {
  rank: number;
  cell_id: string;
  lat: number;
  lon: number;
  fast_passes: number;
  urgent_alerts: number;
  nearest_poi: string;
  poi_kind: "school" | "bus_stop";
  distance_m: number;
  score: number;
  intervention: string;
}

export interface Meta {
  synthetic: boolean;
  notice: string;
  data_source: string;
  poi_source: string | null;
  seeded_at: string | null;
  counts: { rows: number; cells: number; fast_passes: number; urgent_alerts: number; pois: number };
  k_anonymity_min_total: number;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

const hourQuery = (hour: number | null) => (hour === null ? "" : `hour=${hour}`);

// Static build (Vercel, read-only): responses were precomputed at build time from the same API
// (tools/build_deploy.py) and are served as JSON files next to the app.
const STATIC = import.meta.env.VITE_STATIC === "1";
const B = import.meta.env.BASE_URL;
const h = (hour: number | null) => (hour === null ? "all" : String(hour));

export const api = STATIC
  ? {
      cells: (hour: number | null) => get<CellsResponse>(`${B}data/cells_${h(hour)}.json`),
      pois: () => get<{ pois: Poi[] }>(`${B}data/pois.json`).then((r) => r.pois),
      top: (hour: number | null, limit = 10) =>
        get<{ top: Ranked[] }>(`${B}data/top_${h(hour)}.json`).then((r) => r.top.slice(0, limit)),
      meta: () => get<Meta>(`${B}data/meta.json`),
      exportUrl: (hour: number | null) => `${B}data/export_${h(hour)}.csv`,
    }
  : {
      cells: (hour: number | null) => get<CellsResponse>(`/api/cells?${hourQuery(hour)}`),
      pois: () => get<{ pois: Poi[] }>("/api/pois").then((r) => r.pois),
      top: (hour: number | null, limit = 10) =>
        get<{ top: Ranked[] }>(`/api/top?limit=${limit}&${hourQuery(hour)}`).then((r) => r.top),
      meta: () => get<Meta>("/api/meta"),
      exportUrl: (hour: number | null) => `/api/export.csv?${hourQuery(hour)}`,
    };
