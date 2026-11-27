import type { Metric } from "./api";

// Sequential ramps (ColorBrewer YlOrRd and RdPu, 6 classes): light = few, dark = many.
export const RAMPS: Record<Metric, string[]> = {
  fast_passes: ["#ffffb2", "#fed976", "#feb24c", "#fd8d3c", "#f03b20", "#bd0026"],
  urgent_alerts: ["#feebe2", "#fcc5c0", "#fa9fb5", "#f768a1", "#c51b8a", "#7a0177"],
};

export const METRIC_LABEL: Record<Metric, string> = {
  fast_passes: "Fast two-wheeler passes",
  urgent_alerts: "Urgent alerts (near misses)",
};

/** Class breaks: upper bound of each of the 6 bins. Quadratic spacing (finer at the low
 *  end) because counts are skewed: a few hotspots, many quiet cells. */
export function breaks(max: number): number[] {
  const n = RAMPS.fast_passes.length;
  if (max <= 0) return Array(n).fill(0);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const b = i === n - 1 ? max : Math.ceil(max * ((i + 1) / n) ** 2);
    out.push(Math.max(b, (out[i - 1] ?? 0) + 1, 1));
  }
  return out;
}

export function colourFor(value: number, bounds: number[], metric: Metric): string {
  const ramp = RAMPS[metric];
  for (let i = 0; i < bounds.length; i++) if (value <= bounds[i]) return ramp[i];
  return ramp[ramp.length - 1];
}

export function hourLabel(hour: number | null): string {
  if (hour === null) return "All day";
  const h = String(hour).padStart(2, "0");
  const h2 = String((hour + 1) % 24).padStart(2, "0");
  return `${h}:00–${h2}:00`;
}
