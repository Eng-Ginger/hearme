import { useEffect, useMemo } from "react";
import L from "leaflet";
import { MapContainer, Marker, Rectangle, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { Cell, Metric, Poi } from "./api";
import { METRIC_LABEL, colourFor } from "./scale";

export const AJMAN_CENTRE: [number, number] = [25.405, 55.513];

export interface Focus {
  lat: number;
  lon: number;
  cellId: string;
  nonce: number;
}

const SCHOOL_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 3 1 9l11 6 9-4.9V17h2V9L12 3zm-6.5 9.6V16c0 1.9 2.9 4 6.5 4s6.5-2.1 6.5-4v-3.4L12 16.2l-6.5-3.6z"/></svg>';
const BUS_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M5 4.5C5 3 7.7 2 12 2s7 1 7 2.5V17c0 .8-.4 1.5-1 1.8V21a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-2H9v2a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-2.2c-.6-.3-1-1-1-1.8V4.5zM7 6v5h10V6H7zm1.5 7.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>';

export const poiIconHtml = (kind: Poi["kind"]) =>
  `<span class="poi-icon poi-${kind}">${kind === "school" ? SCHOOL_SVG : BUS_SVG}</span>`;

const makeIcon = (kind: Poi["kind"]) =>
  L.divIcon({ className: "poi-marker", html: poiIconHtml(kind), iconSize: [28, 28], iconAnchor: [14, 14] });

const ICONS: Record<Poi["kind"], L.DivIcon> = {
  school: makeIcon("school"),
  bus_stop: makeIcon("bus_stop"),
};

function FlyTo({ focus }: { focus: Focus | null }) {
  const map = useMap();
  useEffect(() => {
    if (!focus) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) map.setView([focus.lat, focus.lon], 18);
    else map.flyTo([focus.lat, focus.lon], 18, { duration: 0.8 });
  }, [focus, map]);
  return null;
}

/** Keep Leaflet's idea of the container size in sync with the CSS layout. */
function SizeWatcher() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    ro.observe(el);
    map.invalidateSize({ pan: false });
    return () => ro.disconnect();
  }, [map]);
  return null;
}

interface Props {
  cells: Cell[];
  pois: Poi[];
  metric: Metric;
  classBreaks: number[];
  focus: Focus | null;
}

export default function MapView({ cells, pois, metric, classBreaks, focus }: Props) {
  const selectedId = focus?.cellId;
  const rects = useMemo(
    () =>
      cells.map((c) => {
        const v = c[metric];
        const selected = selectedId === c.cell_id;
        return (
          <Rectangle
            key={c.cell_id}
            bounds={c.bounds}
            pathOptions={{
              color: selected ? "#0b1f33" : v > 0 ? "#5a3a1a" : "#8a94a0",
              weight: selected ? 3 : 0.6,
              opacity: selected ? 1 : 0.5,
              fillColor: v > 0 ? colourFor(v, classBreaks, metric) : "#c9d1d9",
              fillOpacity: v > 0 ? 0.72 : 0.18,
            }}
          >
            <Tooltip sticky>
              <strong>Cell {c.cell_id}</strong>
              <br />
              {METRIC_LABEL.fast_passes}: {c.fast_passes}
              <br />
              {METRIC_LABEL.urgent_alerts}: {c.urgent_alerts}
            </Tooltip>
          </Rectangle>
        );
      }),
    [cells, metric, classBreaks, selectedId],
  );

  return (
    <MapContainer center={AJMAN_CENTRE} zoom={15} minZoom={12} maxZoom={19} className="map" keyboard>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      {rects}
      {pois.map((p) => (
        <Marker
          key={`${p.kind}-${p.name}`}
          position={[p.lat, p.lon]}
          icon={ICONS[p.kind]}
          title={`${p.name} (${p.kind === "school" ? "school" : "bus stop"})`}
          alt={p.name}
        >
          <Tooltip direction="top" offset={[0, -12]}>
            {p.name}
          </Tooltip>
        </Marker>
      ))}
      <FlyTo focus={focus} />
      <SizeWatcher />
    </MapContainer>
  );
}
