// Seeded RNG and geo helpers for the Lab simulation.

/** mulberry32: small, fast, seedable PRNG so director runs are identical every time. */
export class Rng {
  private s: number;
  private spare: number | null = null;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  uniform(a: number, b: number): number { return a + (b - a) * this.next(); }
  normal(mu = 0, sigma = 1): number {
    if (this.spare !== null) { const v = this.spare; this.spare = null; return mu + sigma * v; }
    let u = 0, v = 0, s = 0;
    do { u = this.next() * 2 - 1; v = this.next() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * m;
    return mu + sigma * u * m;
  }
}

// World frame (three.js): x = east, y = up, z = south.  North = -z.
export const ORIGIN_LAT = 25.4052, ORIGIN_LON = 55.5136; // Ajman, UAE
const EARTH_R = 6371008.8;
const K = Math.PI / 180;

export function toLatLon(x: number, z: number): [number, number] {
  const lat = ORIGIN_LAT + -z / (EARTH_R * K);
  const lon = ORIGIN_LON + x / (EARTH_R * K * Math.cos(ORIGIN_LAT * K));
  return [lat, lon];
}

/** Compass heading (0 = north, 90 = east) of a world-frame direction. */
export function compassOf(dx: number, dz: number): number {
  const h = Math.atan2(dx, -dz) / K;
  return (h + 360) % 360;
}

/** Signed angle (deg, -180..180] from the listener's facing to a target; negative = left. */
export function relAngle(px: number, pz: number, yawDeg: number, x: number, z: number): number {
  let r = compassOf(x - px, z - pz) - yawDeg;
  while (r > 180) r -= 360;
  while (r <= -180) r += 360;
  return r;
}

export const T0 = 1_800_000_000; // absolute time base for MAC epochs (matches sim/world.py)
export const kmh = (mps: number) => mps * 3.6;
