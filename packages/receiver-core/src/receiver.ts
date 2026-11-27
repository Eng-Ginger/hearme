// HearMe receiver core (TypeScript). Line-for-line port of sim/receiver.py; the C port lives in
// firmware/lib/hearme_receiver. tests/cross_language/run_all.py proves identical outputs.
import {
  INFRA_TYPES, type BeaconType, type Packet, DecodeError, decode, epochOf, hexToBytes, verify,
  speedMps, headingDeg,
} from "@hearme/protocol";

export const IGNORE = 0, AWARE = 1, WARN = 2, URGENT = 3;
export type Level = 0 | 1 | 2 | 3;
export const LEVEL_NAMES = ["ignore", "aware", "warn", "urgent"] as const;
export type Side = "left" | "right" | "ahead" | "behind" | "unknown";
const EARTH_R = 6371008.8;

export interface Config {
  tx_power_1m: number; path_loss_n: number; rssi_alpha: number; ab_alpha: number; ab_beta: number;
  stale_s: number; forget_s: number; danger_radius_m: number; pass_radius_m: number; aware_dist_m: number;
  warn_ttr_s: number; urgent_ttr_s: number; urgent_dist_m: number; hysteresis_s: number; hold_s: number;
  min_approach_mps: number; moving_mps: number; alert_repeat_s: number; bus_announce_dist_m: number;
  infra_announce_dist_m: number; infra_reannounce_s: number; require_mac: boolean; use_position: boolean;
  fleet_key: Uint8Array | null; max_tracks: number;
}

export const DEFAULT_CONFIG: Config = {
  tx_power_1m: -50.0, path_loss_n: 2.2, rssi_alpha: 0.3, ab_alpha: 0.35, ab_beta: 0.06,
  stale_s: 2.5, forget_s: 30.0, danger_radius_m: 3.0, pass_radius_m: 8.0, aware_dist_m: 35.0,
  warn_ttr_s: 6.0, urgent_ttr_s: 3.0, urgent_dist_m: 6.0, hysteresis_s: 1.0, hold_s: 1.5,
  min_approach_mps: 0.8, moving_mps: 0.5, alert_repeat_s: 4.0, bus_announce_dist_m: 30.0,
  infra_announce_dist_m: 12.0, infra_reannounce_s: 120.0, require_mac: false, use_position: true,
  fleet_key: null, max_tracks: 32,
};

export type EventKind = "vehicle_aware" | "vehicle_warn" | "vehicle_urgent" | "bus_arriving" | "place";
export interface AlertEvent {
  t: number; id: string; kind: EventKind; type: BeaconType; side: Side;
  seconds: number | null; urgency: number; text_en: string; text_ar: string;
}

export interface Track {
  id: string; type: BeaconType; first_t: number; last_t: number; packets: number;
  rssi_ema: number; dist: number; rate: number; level: Level; lower_since: number;
  last_alert_t: number[]; announced: boolean; last_announce_t: number; pkt: Packet; verified: boolean;
  side: Side; ttr: number | null; geo_dist: number | null;
}

export interface TrackState {
  id: string; type: BeaconType; level: (typeof LEVEL_NAMES)[number]; dist: number; geo_dist: number | null;
  rssi: number; ttr: number | null; side: Side; packets: number; verified: boolean; last_t: number;
}

export const roundHalfUp = (x: number): number => Math.floor(x + 0.5);
export const rssiToDistance = (rssi: number, cfg: Config): number =>
  Math.pow(10.0, (cfg.tx_power_1m - rssi) / (10.0 * cfg.path_loss_n));

export function enuOffset(latFrom: number, lonFrom: number, latTo: number, lonTo: number): [number, number] {
  const k = Math.PI / 180.0;
  const dx = (lonTo - lonFrom) * k * EARTH_R * Math.cos(latFrom * k);
  const dy = (latTo - latFrom) * k * EARTH_R;
  return [dx, dy];
}

export function sideOf(rel: number): Side {
  if (rel >= -45.0 && rel <= 45.0) return "ahead";
  if (rel > 45.0 && rel <= 135.0) return "right";
  if (rel >= -135.0 && rel < -45.0) return "left";
  return "behind";
}

// ------------------------------------------------------------------ text
const NAMES_EN: Record<string, string> = { e_bike: "Electric bike", e_scooter: "E-scooter", tuk_tuk: "Tuk-tuk", car: "Car", bus: "Bus", motorcycle: "Motorbike" };
const NAMES_AR: Record<string, string> = { e_bike: "دراجة كهربائية", e_scooter: "سكوتر كهربائي", tuk_tuk: "توك توك", car: "سيارة", bus: "حافلة", motorcycle: "دراجة نارية" };
const FEMININE = new Set(["e_bike", "car", "bus", "motorcycle"]);
const SIDE_EN: Record<Side, string> = { left: "from your left", right: "from your right", ahead: "ahead", behind: "from behind", unknown: "" };
const SIDE_AR: Record<Side, string> = { left: "من يسارك", right: "من يمينك", ahead: "أمامك", behind: "من خلفك", unknown: "" };
const DOOR_EN: Record<string, string> = { front: "front", middle: "middle", rear: "rear", unknown: "" };
const DOOR_AR: Record<string, string> = { front: "الأمامي", middle: "الأوسط", rear: "الخلفي", unknown: "" };
const BUS_SIDE_EN: Record<Side, string> = { left: "on your left", right: "on your right", ahead: "ahead", behind: "behind you", unknown: "" };
const PLACE_EN: Record<string, string> = { bus_stop: "Bus stop", crossing: "Crossing", school_zone: "School zone" };
const PLACE_AR: Record<string, string> = { bus_stop: "موقف حافلات", crossing: "معبر مشاة", school_zone: "منطقة مدرسية" };

const secondsEn = (n: number) => (n === 1 ? "1 second" : `${n} seconds`);
function secondsAr(n: number): string {
  if (n === 1) return "ثانية واحدة";
  if (n === 2) return "ثانيتان";
  if (n <= 10) return `${n} ثوانٍ`;
  return `${n} ثانية`;
}
function speedWord(vtype: string, speed: number | null): [string, string] {
  if (speed === null) return ["", ""];
  const fem = FEMININE.has(vtype);
  if (speed >= 5.5) return ["fast", fem ? "سريعة" : "سريع"];
  if (speed < 2.5) return ["slow", fem ? "بطيئة" : "بطيء"];
  return ["", ""];
}
export function vehicleText(level: number, vtype: string, speed: number | null, side: Side, seconds: number | null): [string, string] {
  const en = [NAMES_EN[vtype] + (level === AWARE ? " nearby" : "")];
  const ar = [NAMES_AR[vtype] + (level === AWARE ? " بالقرب منك" : "")];
  const [swEn, swAr] = speedWord(vtype, speed);
  if (level >= WARN && swEn) { en.push(swEn); ar.push(swAr); }
  if (SIDE_EN[side]) { en.push(SIDE_EN[side]); ar.push(SIDE_AR[side]); }
  if (level >= WARN && seconds !== null) { en.push(secondsEn(seconds)); ar.push(secondsAr(seconds)); }
  let e = en.join(", "), a = ar.join("، ");
  if (level === URGENT) { e = "Stop! " + e; a = "توقف! " + a; }
  return [e, a];
}
export function busText(route: string, door: string, side: Side): [string, string] {
  let en = `Bus ${route} arriving`, ar = `الحافلة ${route} تصل`;
  if (DOOR_EN[door]) {
    en += `, ${DOOR_EN[door]} door`; ar += `، الباب ${DOOR_AR[door]}`;
    if (BUS_SIDE_EN[side]) { en += " " + BUS_SIDE_EN[side]; ar += " " + SIDE_AR[side]; }
  }
  return [en, ar];
}
export const placeText = (vtype: string, name: string): [string, string] => [`${PLACE_EN[vtype]}: ${name}`, `${PLACE_AR[vtype]}: ${name}`];

// ------------------------------------------------------------------ core
export class Receiver {
  cfg: Config;
  tracks = new Map<string, Track>();
  pose: [number, number, number] | null = null;
  packetsRejected = 0;

  constructor(cfg: Partial<Config> = {}) { this.cfg = { ...DEFAULT_CONFIG, ...cfg }; }

  setPose(lat: number, lon: number, headingDeg: number): void { this.pose = [lat, lon, headingDeg]; }

  processPayload(t: number, rssi: number, payload: Uint8Array): AlertEvent[] {
    let p: Packet;
    try { p = decode(payload); } catch (e) {
      if (e instanceof DecodeError) { this.packetsRejected++; return []; }
      throw e;
    }
    let verified = false;
    if (this.cfg.fleet_key !== null) {
      verified = verify(payload, this.cfg.fleet_key, epochOf(t));
      if (!verified && this.cfg.require_mac) { this.packetsRejected++; return []; }
    }
    return this.processPacket(t, rssi, p, verified);
  }

  processPacket(t: number, rssi: number, p: Packet, verified = false): AlertEvent[] {
    const cfg = this.cfg;
    const key = p.rolling_id + ":" + p.type;
    let tr = this.tracks.get(key);
    if (tr === undefined) {
      if (this.tracks.size >= cfg.max_tracks) this.evict();
      tr = {
        id: p.rolling_id, type: p.type, first_t: t, last_t: t, packets: 0, rssi_ema: rssi,
        dist: rssiToDistance(rssi, cfg), rate: 0.0, level: IGNORE, lower_since: -1.0,
        last_alert_t: [-1e9, -1e9, -1e9, -1e9], announced: false, last_announce_t: -1e9, pkt: p,
        verified, side: "unknown", ttr: null, geo_dist: null,
      };
      this.tracks.set(key, tr);
    } else {
      tr.rssi_ema = tr.rssi_ema + cfg.rssi_alpha * (rssi - tr.rssi_ema);
      const z = rssiToDistance(tr.rssi_ema, cfg);
      let dt = t - tr.last_t;
      if (dt < 0.01) dt = 0.01;
      const pred = tr.dist + tr.rate * dt;
      const r = z - pred;
      tr.dist = pred + cfg.ab_alpha * r;
      tr.rate = tr.rate + cfg.ab_beta * r / dt;
      if (tr.dist < 0.5) tr.dist = 0.5;
    }
    tr.last_t = t;
    tr.packets += 1;
    tr.pkt = p;
    tr.verified = verified;
    return this.evaluate(tr, t);
  }

  /** Call periodically (e.g. 10 Hz). Downgrades stale tracks; never emits events. */
  tick(t: number): AlertEvent[] {
    for (const [key, tr] of Array.from(this.tracks.entries())) {
      const age = t - tr.last_t;
      if (age > this.cfg.forget_s) this.tracks.delete(key);
      else if (age > this.cfg.stale_s) { tr.level = IGNORE; tr.lower_since = -1.0; tr.ttr = null; }
    }
    return [];
  }

  private evict(): void {
    let oldestKey: string | null = null, oldest = Infinity;
    for (const [k, tr] of this.tracks) if (tr.last_t < oldest) { oldest = tr.last_t; oldestKey = k; }
    if (oldestKey !== null) this.tracks.delete(oldestKey);
  }

  private geometry(tr: Track): [number, number | null, Side, boolean, boolean] {
    const cfg = this.cfg, p = tr.pkt;
    const speed = speedMps(p), heading = headingDeg(p);
    const moving = speed === null || speed >= cfg.moving_mps;
    if (cfg.use_position && p.lat_e7 !== null && p.lon_e7 !== null && p.gps_valid && this.pose !== null) {
      const [plat, plon, phead] = this.pose;
      const [rx, ry] = enuOffset(plat, plon, p.lat_e7 / 1e7, p.lon_e7 / 1e7);
      const dist = Math.sqrt(rx * rx + ry * ry);
      const bearing = Math.atan2(rx, ry) * (180.0 / Math.PI);
      let rel = bearing - phead;
      while (rel > 180.0) rel -= 360.0;
      while (rel <= -180.0) rel += 360.0;
      const side = sideOf(rel);
      let ttr: number | null = null, approaching = false;
      if (speed !== null && heading !== null && speed >= cfg.moving_mps) {
        const h = heading * (Math.PI / 180.0);
        const vx = speed * Math.sin(h), vy = speed * Math.cos(h);
        const tc = -(rx * vx + ry * vy) / (speed * speed);
        if (tc > 0.0) {
          const cx = rx + vx * tc, cy = ry + vy * tc;
          const cpa = Math.sqrt(cx * cx + cy * cy);
          if (cpa <= cfg.pass_radius_m) { approaching = true; ttr = tc; }
        }
      }
      return [dist, ttr, side, approaching, moving];
    }
    const dist = tr.dist, approach = -tr.rate;
    let ttr: number | null = null;
    const approaching = approach >= cfg.min_approach_mps && tr.packets >= 3;
    if (approaching) {
      const rate = speed !== null && speed > approach ? speed : approach;
      ttr = (dist - cfg.danger_radius_m) / rate;
      if (ttr < 0.0) ttr = 0.0;
    }
    return [dist, ttr, "unknown", approaching, moving];
  }

  private levelFor(dist: number, ttr: number | null, approaching: boolean, moving: boolean, margin: number): Level {
    const cfg = this.cfg;
    if (!moving) return IGNORE;
    if (ttr !== null && ttr <= cfg.urgent_ttr_s + margin) return URGENT;
    if (approaching && dist <= cfg.urgent_dist_m + margin) return URGENT;
    if (ttr !== null && ttr <= cfg.warn_ttr_s + margin) return WARN;
    if (dist <= cfg.aware_dist_m + margin * 5.0) return AWARE;
    return IGNORE;
  }

  private ev(tr: Track, t: number, kind: EventKind, urgency: number, side: Side, seconds: number | null, en: string, ar: string): AlertEvent {
    return { t, id: tr.id, kind, type: tr.type, side, seconds, urgency, text_en: en, text_ar: ar };
  }

  private evaluate(tr: Track, t: number): AlertEvent[] {
    const cfg = this.cfg, p = tr.pkt;
    const events: AlertEvent[] = [];
    if (INFRA_TYPES.has(p.type)) {
      tr.geo_dist = null;
      if (tr.dist <= cfg.infra_announce_dist_m && (!tr.announced || t - tr.last_announce_t >= cfg.infra_reannounce_s)) {
        tr.announced = true; tr.last_announce_t = t;
        const [en, ar] = placeText(p.type, p.name ?? "");
        events.push(this.ev(tr, t, "place", 0, "unknown", null, en, ar));
      }
      return events;
    }
    const [dist, ttr, side, approaching, moving] = this.geometry(tr);
    tr.side = side; tr.ttr = ttr; tr.geo_dist = dist;
    const sp = speedMps(p);
    if (p.type === "bus" && !tr.announced && dist <= cfg.bus_announce_dist_m && (approaching || (sp !== null && sp < 3.0))) {
      tr.announced = true; tr.last_announce_t = t;
      const [en, ar] = busText(p.route ?? "", p.door ?? "unknown", side);
      events.push(this.ev(tr, t, "bus_arriving", 0, side, null, en, ar));
    }
    const enter = this.levelFor(dist, ttr, approaching, moving, 0.0);
    const stay = this.levelFor(dist, ttr, approaching, moving, cfg.hysteresis_s);
    if (enter > tr.level) {
      tr.level = enter; tr.lower_since = -1.0;
      if (t - tr.last_alert_t[enter] >= cfg.alert_repeat_s) {
        tr.last_alert_t[enter] = t;
        let seconds: number | null = null;
        if (enter >= WARN && ttr !== null) { seconds = roundHalfUp(ttr); if (seconds < 1) seconds = 1; }
        const [en, ar] = vehicleText(enter, p.type, sp, side, seconds);
        events.push(this.ev(tr, t, ("vehicle_" + LEVEL_NAMES[enter]) as EventKind, enter, side, seconds, en, ar));
      }
    } else if (stay < tr.level) {
      if (tr.lower_since < 0.0) tr.lower_since = t;
      else if (t - tr.lower_since >= cfg.hold_s) { tr.level = stay; tr.lower_since = -1.0; }
    } else {
      tr.lower_since = -1.0;
    }
    return events;
  }

  states(): TrackState[] {
    return Array.from(this.tracks.values(), (tr) => ({
      id: tr.id, type: tr.type, level: LEVEL_NAMES[tr.level], dist: tr.dist, geo_dist: tr.geo_dist,
      rssi: tr.rssi_ema, ttr: tr.ttr, side: tr.side, packets: tr.packets, verified: tr.verified, last_t: tr.last_t,
    }));
  }
}

export interface TraceEvent { k: "pose" | "pkt" | "tick"; t: number; lat?: number; lon?: number; heading?: number; rssi?: number; hex?: string }
export interface Trace { name: string; config: Record<string, unknown>; events: TraceEvent[]; expected?: AlertEvent[] }

/** Run a cross-language trace (tests/traces/*.json). */
export function runTrace(trace: Trace): AlertEvent[] {
  const c: Partial<Config> = {};
  for (const [k, v] of Object.entries(trace.config)) if (k !== "fleet_key_hex") (c as Record<string, unknown>)[k] = v;
  if (typeof trace.config.fleet_key_hex === "string") c.fleet_key = hexToBytes(trace.config.fleet_key_hex);
  const rx = new Receiver(c);
  const out: AlertEvent[] = [];
  for (const e of trace.events) {
    if (e.k === "pose") rx.setPose(e.lat!, e.lon!, e.heading!);
    else if (e.k === "pkt") out.push(...rx.processPayload(e.t, e.rssi!, hexToBytes(e.hex!)));
    else out.push(...rx.tick(e.t));
  }
  return out;
}
