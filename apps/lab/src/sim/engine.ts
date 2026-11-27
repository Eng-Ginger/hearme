// HearMe Lab simulation engine: vehicles, simulated BLE radio, GPS noise and the real
// receiver-core. Lives outside React; the scene, audio and panels read from it.
import {
  encode, epochOf, rollingIdFor, speedToRaw, headingToRaw, bytesToHex, TEST_FLEET_KEY, type Packet,
} from "@hearme/protocol";
import { Receiver, type AlertEvent, type TrackState } from "@hearme/receiver-core";
import { RADIO, GPS, AUDIO_MODEL, type CarryMode } from "../config/radio";
import { Rng, T0, toLatLon, compassOf, relAngle } from "./util";
import { INFRA, laneZ, SILENT, type InfraSpec, type Scenario, type VehicleSpec, type VType } from "./scenarios";

export type HearMeMode = "off" | "on" | "avas";
export type ReceiverMode = "gps" | "rssi";

export interface VehicleInst {
  uid: number;
  spec: VehicleSpec;
  type: VType;
  x: number; z: number; v: number; dir: 1 | -1; heading: number;
  phase: "cruise" | "braking" | "stopped" | "leaving";
  stoppedAt: number;
  braking: boolean;
  rng: Rng;
  secret: Uint8Array;
  rid: string;
  epoch: number;
  gpsErr: { ex: number; ez: number; t: number };
  fix: { t: number; x: number; z: number; v: number; h: number } | null;
  nextAdv: number;
  shadow: { t: number; s: number } | null;
  packets: number;
  lastRssi: number | null;
  trueDist: number;
  minDist: number;
  passed: boolean;
  tPass: number | null;
  firstWarnT: number | null;
  firstAudibleT: number | null;
  audibleAccum: number;
  history: { t: number; d: number; est: number | null; gps: number | null; rssi: number | null }[];
  gone: boolean;
}

interface InfraInst { spec: InfraSpec; rng: Rng; secret: Uint8Array; rid: string; nextAdv: number; shadow: { t: number; s: number } | null; packets: number }

export interface PassRecord {
  uid: number; key: string; type: VType; beacon: boolean; t: number; speed: number; passDist: number;
  leadWarn: number | null; leadAudible: number | null; gained: number; mode: HearMeMode;
}

export type LabEvent =
  | { kind: "alert"; alert: AlertEvent; uid: number | null; bearing: number | null; muted: boolean }
  | { kind: "pass"; pass: PassRecord }
  | { kind: "roster" }
  | { kind: "reset" };

/** Lab receiver overrides: announce stops/crossings only when within ~8 m (RSSI estimate), so a stop
 *  26 m away is not announced from the crossing because of shadowing (docs/limitations.md #7). */
export const LAB_RECEIVER_CONFIG = { infra_announce_dist_m: 8 };
const enc = new TextEncoder();
const RADIO_CHANNEL = "hearme-radio";
const SUBSTEP = 0.02;

function hashKey(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export class Engine {
  t = 0;
  scenario!: Scenario;
  mode: HearMeMode = "on";
  receiverMode: ReceiverMode = "gps";
  carry: CarryMode = "pocket";
  walkSpeedMps = 1.0;   // user setting: slow 0.7 / normal 1.0 / fast 1.3 (crossing-aware warning)
  seed = 1;
  ped = { x: 0, z: 4.6, yaw: 0 };
  vehicles: VehicleInst[] = [];
  infra: InfraInst[] = [];
  passes: PassRecord[] = [];
  alerts: { t: number; alert: AlertEvent; muted: boolean }[] = [];
  gainedTotal = 0;
  gainedCount = 0;
  receiver!: Receiver;
  autoSpawn = true;
  private spawnIdx: number[] = [];
  private nextUid = 1;
  private tickNext = 0;
  private ridToUid = new Map<string, number>();
  private listeners = new Set<(e: LabEvent) => void>();
  private bc: BroadcastChannel | null = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(RADIO_CHANNEL) : null;
  private spawnCounts = new Map<string, number>();

  on(fn: (e: LabEvent) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(e: LabEvent) { for (const fn of this.listeners) fn(e); }
  private post(msg: unknown) { try { this.bc?.postMessage(msg); } catch { /* channel closed */ } }

  reset(scenario: Scenario, opts: { seed?: number; autoSpawn?: boolean; keepStats?: boolean } = {}) {
    this.scenario = scenario;
    this.seed = opts.seed ?? this.seed;
    this.autoSpawn = opts.autoSpawn ?? true;
    this.t = 0;
    this.tickNext = 0;
    this.ped = { ...scenario.ped };
    this.vehicles = [];
    this.spawnIdx = scenario.vehicles.map(() => 0);
    this.spawnCounts.clear();
    this.ridToUid.clear();
    if (!opts.keepStats) { this.passes = []; this.alerts = []; this.gainedTotal = 0; this.gainedCount = 0; }
    this.resetReceiver();
    this.infra = INFRA.map((spec, i) => {
      const rng = new Rng(this.seed * 7919 + 101 + i);
      const secret = enc.encode("infra-" + spec.name);
      return { spec, rng, secret, rid: rollingIdFor(secret, epochOf(T0)), nextAdv: rng.uniform(0, 0.1), shadow: null, packets: 0 };
    });
    this.emit({ kind: "reset" });
    this.emit({ kind: "roster" });
  }

  resetReceiver() {
    this.receiver = new Receiver({ fleet_key: TEST_FLEET_KEY, use_position: this.receiverMode === "gps", walk_speed_mps: this.walkSpeedMps, ...LAB_RECEIVER_CONFIG });
    this.ridToUid.clear();
    for (const v of this.vehicles) { v.firstWarnT = null; this.ridToUid.set(v.rid, v.uid); }
    this.post({ k: "reset", receiverMode: this.receiverMode });
  }

  setReceiverMode(m: ReceiverMode) { this.receiverMode = m; this.resetReceiver(); }

  setPed(x: number, z: number, yaw: number) { this.ped = { x, z, yaw }; }

  /** Make the next spawn of `key` reuse the first spawn's RNG seed and secret (identical replay). */
  forgetSpawns(key: string) { this.spawnCounts.delete(key); }

  /** Remove all vehicles (director scene change). */
  clearVehicles() { this.vehicles = []; this.emit({ kind: "roster" }); }

  spawn(spec: VehicleSpec): VehicleInst {
    const n = (this.spawnCounts.get(spec.key) ?? 0) + 1;
    this.spawnCounts.set(spec.key, n);
    // per-vehicle RNG: replaying the same spec with the same seed gives an identical radio trace
    const rng = new Rng(hashKey(spec.key) ^ (this.seed * 2654435761) ^ (spec.seedSalt ?? 0) ^ (n * 40503));
    const secret = enc.encode(`veh-${spec.key}-${n}-${this.seed}`);
    const startX = spec.startX ?? (spec.dir === 1 ? -110 : 110);
    const epoch = epochOf(T0 + this.t);
    const v: VehicleInst = {
      uid: this.nextUid++, spec, type: spec.type, x: startX, z: spec.z ?? laneZ(spec.dir), v: spec.speed, dir: spec.dir,
      heading: spec.dir === 1 ? 90 : 270, phase: "cruise", stoppedAt: 0, braking: false, rng, secret,
      rid: rollingIdFor(secret, epoch), epoch,
      gpsErr: { ex: rng.normal(0, GPS.sigmaPerAxisM), ez: rng.normal(0, GPS.sigmaPerAxisM), t: this.t },
      fix: null, nextAdv: this.t + rng.uniform(0, RADIO.advIntervalS), shadow: null, packets: 0, lastRssi: null,
      trueDist: 999, minDist: 999, passed: false, tPass: null, firstWarnT: null, firstAudibleT: null, audibleAccum: 0,
      history: [], gone: false,
    };
    this.vehicles.push(v);
    this.ridToUid.set(v.rid, v.uid);
    this.emit({ kind: "roster" });
    return v;
  }

  /** Advance the simulation by dt seconds (sub-stepped for stable radio timing). */
  step(dt: number) {
    let left = Math.min(dt, 0.25);
    while (left > 1e-6) {
      const h = Math.min(SUBSTEP, left);
      this.sub(h);
      left -= h;
    }
  }

  private sub(h: number) {
    this.t += h;
    const t = this.t;
    if (this.autoSpawn) {
      this.scenario.vehicles.forEach((spec, i) => {
        const at = spec.spawn + this.spawnIdx[i] * this.scenario.period;
        if (t >= at) { this.spawnIdx[i]++; this.spawn(spec); }
      });
    }
    let rosterChanged = false;
    for (const v of this.vehicles) {
      this.move(v, h);
      const d = Math.hypot(v.x - this.ped.x, v.z - this.ped.z);
      v.trueDist = d;
      if (d < v.minDist) v.minDist = d;
      this.audibility(v, h, d);
      if (!v.passed && (v.x - this.ped.x) * v.dir >= 0) this.recordPass(v);
      if (v.spec.beacon) this.radio(v, t, d);
      if ((v.x - this.ped.x) * v.dir > 140) { v.gone = true; rosterChanged = true; }
    }
    for (const inf of this.infra) this.radioInfra(inf, t);
    if (rosterChanged) {
      this.vehicles = this.vehicles.filter((v) => !v.gone);
      this.emit({ kind: "roster" });
    }
    if (t >= this.tickNext) {
      this.tickNext = t + 0.1;
      const [lat, lon] = toLatLon(this.ped.x, this.ped.z);
      this.receiver.setPose(lat, lon, this.ped.yaw);
      this.receiver.tick(T0 + t);
      this.post({ k: "pose", t: T0 + t, lat, lon, heading: this.ped.yaw });
      this.post({ k: "tick", t: T0 + t });
      for (const v of this.vehicles) {
        const st = this.trackFor(v);
        v.history.push({ t, d: v.trueDist, est: st ? st.dist : null, gps: st?.geo_dist ?? null, rssi: v.lastRssi });
        if (v.history.length > 220) v.history.shift();
      }
    }
  }

  private move(v: VehicleInst, h: number) {
    const s = v.spec;
    if (s.stopAtX !== undefined && v.phase !== "leaving") {
      const remaining = (s.stopAtX - v.x) * v.dir;
      const decel = s.type === "bus" ? 0.67 : 1.3; // buses ease into stops from ~60 m
      if (v.phase === "cruise" && remaining <= (v.v * v.v) / (2 * decel) + 0.5) v.phase = "braking";
      if (v.phase === "braking") {
        v.braking = true;
        v.v = remaining > 0.05 ? Math.min(v.v, Math.sqrt(2 * decel * Math.max(remaining, 0))) : 0;
        if (v.v < 0.05) { v.v = 0; v.phase = "stopped"; v.stoppedAt = this.t; }
      } else if (v.phase === "stopped") {
        v.braking = true; // brake held while stopped
        if (this.t - v.stoppedAt >= (s.dwell ?? 8)) v.phase = "leaving";
      }
    } else if (v.phase === "leaving") {
      v.braking = false;
      v.v = Math.min(s.speed, v.v + 1.0 * h);
    }
    v.x += v.dir * v.v * h;
  }

  private sourceLevel(v: VehicleInst): number {
    const avas = this.mode === "avas" && SILENT.has(v.type);
    switch (v.type) {
      case "e_bike": case "e_scooter": return avas ? AUDIO_MODEL.avasDba2m : AUDIO_MODEL.ebikeDba2m + 20 * Math.log10(Math.max(v.v, 0.5) / 7);
      case "tuk_tuk": return avas ? AUDIO_MODEL.avasDba2m : AUDIO_MODEL.tuktukElectricDba2m;
      case "motorcycle": return AUDIO_MODEL.motorcycleDba2m;
      case "car": return AUDIO_MODEL.carDba2m;
      case "bus": return AUDIO_MODEL.busDba2m;
    }
  }

  private audibility(v: VehicleInst, h: number, d: number) {
    if (v.passed || v.firstAudibleT !== null) return;
    const level = this.sourceLevel(v) - 20 * Math.log10(Math.max(d, 0.5) / 2);
    if (level - this.scenario.ambientDb >= AUDIO_MODEL.detectSnrDb) {
      v.audibleAccum += h;
      if (v.audibleAccum >= AUDIO_MODEL.detectDwellS) v.firstAudibleT = this.t;
    } else v.audibleAccum = 0;
  }

  private recordPass(v: VehicleInst) {
    v.passed = true;
    v.tPass = this.t;
    const leadWarn = v.firstWarnT !== null ? this.t - v.firstWarnT : null;
    const leadAudible = v.firstAudibleT !== null ? this.t - v.firstAudibleT : null;
    const gained = v.spec.beacon ? Math.max(0, (leadWarn ?? 0) - (leadAudible ?? 0)) : 0;
    const pass: PassRecord = {
      uid: v.uid, key: v.spec.key, type: v.type, beacon: v.spec.beacon, t: this.t, speed: v.v,
      passDist: Math.abs(v.z - this.ped.z), leadWarn, leadAudible, gained, mode: this.mode,
    };
    if (v.spec.beacon && SILENT.has(v.type)) { this.gainedTotal += gained; this.gainedCount++; }
    this.passes.push(pass);
    if (this.passes.length > 50) this.passes.shift();
    this.emit({ kind: "pass", pass });
  }

  private channelRssi(rng: Rng, shadowRef: { shadow: { t: number; s: number } | null }, t: number, d: number, x: number, z: number, txOffsetDb = 0): number | null {
    if (rng.next() < RADIO.packetLoss) return null;
    const prev = shadowRef.shadow;
    let s: number;
    if (!prev) s = rng.normal(0, RADIO.shadowingSigmaDb);
    else {
      const a = Math.exp(-(t - prev.t) / RADIO.shadowingTauS);
      s = a * prev.s + RADIO.shadowingSigmaDb * Math.sqrt(1 - a * a) * rng.normal();
    }
    shadowRef.shadow = { t, s };
    const rel = relAngle(this.ped.x, this.ped.z, this.ped.yaw, x, z);
    const body = (RADIO.bodyLossDb[this.carry] * (1 - Math.cos((rel * Math.PI) / 180))) / 2;
    const r = RADIO.txPower1mDbm + txOffsetDb - 10 * RADIO.pathLossN * Math.log10(Math.max(d, 0.3)) + s + rng.normal(0, RADIO.fastFadingSigmaDb) - body;
    return r < RADIO.sensitivityDbm ? null : Math.round(r);
  }

  private radio(v: VehicleInst, t: number, d: number) {
    while (v.nextAdv <= t) {
      const at = v.nextAdv;
      v.nextAdv += RADIO.advIntervalS + v.rng.uniform(0, RADIO.advDelayMaxS);
      if (d > 160) continue;
      const rssi = this.channelRssi(v.rng, v, at, d, v.x, v.z, v.spec.phoneBeacon ? RADIO.phoneBeaconOffsetDb : 0);
      // GPS fix + dead reckoning (advance the error process even if the packet is lost)
      const pkt = this.vehiclePacket(v, at);
      if (rssi === null) continue;
      this.deliver(at, rssi, pkt, v);
    }
  }

  private vehiclePacket(v: VehicleInst, t: number): Packet {
    const epoch = epochOf(T0 + t);
    if (epoch !== v.epoch) { v.epoch = epoch; v.rid = rollingIdFor(v.secret, epoch); this.ridToUid.set(v.rid, v.uid); }
    const period = 1 / GPS.fixRateHz;
    if (!v.fix || t - v.fix.t >= period) {
      const e = v.gpsErr;
      const a = Math.exp(-(t - e.t) / GPS.tauS), sd = GPS.sigmaPerAxisM * Math.sqrt(1 - a * a);
      e.ex = a * e.ex + sd * v.rng.normal(); e.ez = a * e.ez + sd * v.rng.normal(); e.t = t;
      const sp = v.v > 0 ? Math.max(0, v.v + v.rng.normal(0, GPS.speedSigmaMps)) : 0;
      const hd = v.heading + (v.v > 1 ? v.rng.normal(0, GPS.headingSigmaDeg) : 0);
      v.fix = { t, x: v.x + e.ex, z: v.z + e.ez, v: sp, h: hd };
    }
    const f = v.fix, age = t - f.t, hr = (f.h * Math.PI) / 180;
    const px = f.x + f.v * age * Math.sin(hr), pz = f.z - f.v * age * Math.cos(hr);
    const [lat, lon] = toLatLon(px, pz);
    const p: Packet = {
      type: v.type, rolling_id: v.rid, speed_raw: speedToRaw(f.v), heading_raw: headingToRaw(f.h),
      braking: v.braking, gps_valid: true, reversing: false,
      lat_e7: this.receiverMode === "gps" ? Math.round(lat * 1e7) : null,
      lon_e7: this.receiverMode === "gps" ? Math.round(lon * 1e7) : null,
    };
    if (this.receiverMode !== "gps") p.gps_valid = false;
    if (v.type === "bus") { p.route = v.spec.route ?? ""; p.door = "front"; p.ramp = true; }
    return p;
  }

  private radioInfra(inf: InfraInst, t: number) {
    while (inf.nextAdv <= t) {
      const at = inf.nextAdv;
      inf.nextAdv += RADIO.advIntervalS + inf.rng.uniform(0, RADIO.advDelayMaxS);
      const d = Math.hypot(inf.spec.x - this.ped.x, inf.spec.z - this.ped.z);
      if (d > 120) continue;
      const rssi = this.channelRssi(inf.rng, inf, at, d, inf.spec.x, inf.spec.z);
      if (rssi === null) continue;
      const p: Packet = {
        type: inf.spec.type, rolling_id: inf.rid, speed_raw: 0, heading_raw: 0, braking: false, gps_valid: false,
        reversing: false, lat_e7: null, lon_e7: null, short_code: inf.spec.shortCode, name: inf.spec.name,
      };
      inf.packets++;
      this.deliver(at, rssi, p, null);
    }
  }

  private deliver(at: number, rssi: number, p: Packet, v: VehicleInst | null) {
    const tAbs = T0 + at;
    const payload = encode(p, TEST_FLEET_KEY, epochOf(tAbs));
    if (v) { v.packets++; v.lastRssi = rssi; }
    this.post({ k: "pkt", t: tAbs, rssi, hex: bytesToHex(payload) });
    const events = this.receiver.processPayload(tAbs, rssi, payload);
    for (const a of events) {
      const uid = this.ridToUid.get(a.id) ?? null;
      const veh = uid !== null ? this.vehicles.find((x) => x.uid === uid) : undefined;
      if (veh && !veh.passed && veh.firstWarnT === null && (a.kind === "vehicle_warn" || a.kind === "vehicle_urgent")) veh.firstWarnT = this.t;
      const muted = this.mode !== "on";
      this.alerts.push({ t: this.t, alert: a, muted });
      if (this.alerts.length > 40) this.alerts.shift();
      this.emit({ kind: "alert", alert: a, uid, bearing: this.bearingOf(a.id, a.type), muted });
    }
  }

  /** Relative bearing (deg, negative = left) of a track, from the receiver's own data (GPS position). */
  bearingOf(rid: string, type: string): number | null {
    const tr = this.receiver.tracks.get(rid + ":" + type);
    const p = tr?.pkt;
    if (!p || p.lat_e7 === null || p.lon_e7 === null || !p.gps_valid) return null;
    // invert toLatLon
    const M = 6371008.8 * Math.PI / 180;
    const z = -((p.lat_e7 / 1e7 - 25.4052) * M);
    const x = (p.lon_e7 / 1e7 - 55.5136) * M * Math.cos(25.4052 * Math.PI / 180);
    return relAngle(this.ped.x, this.ped.z, this.ped.yaw, x, z);
  }

  trackFor(v: VehicleInst): TrackState | undefined {
    const tr = this.receiver.tracks.get(v.rid + ":" + v.type);
    if (!tr) return undefined;
    return { id: tr.id, type: tr.type, level: (["ignore", "aware", "warn", "urgent"] as const)[tr.level], dist: tr.dist, geo_dist: tr.geo_dist,
      rssi: tr.rssi_ema, ttr: tr.ttr, side: tr.side, packets: tr.packets, verified: tr.verified, last_t: tr.last_t };
  }

  /** Most urgent live vehicle track (for the continuous proximity pulse). */
  mostUrgent(): { rid: string; type: string; level: number; ttr: number | null; bearing: number | null } | null {
    let best: { rid: string; type: string; level: number; ttr: number | null; bearing: number | null } | null = null;
    for (const tr of this.receiver.tracks.values()) {
      if (tr.level < 2 || T0 + this.t - tr.last_t > 1.0) continue;
      if (!best || tr.level > best.level || (tr.level === best.level && (tr.ttr ?? 99) < (best.ttr ?? 99))) {
        best = { rid: tr.id, type: tr.type, level: tr.level, ttr: tr.ttr, bearing: null };
      }
    }
    if (best) best.bearing = this.bearingOf(best.rid, best.type);
    return best;
  }

  compassToVehicle(v: VehicleInst) { return compassOf(v.x - this.ped.x, v.z - this.ped.z); }
}

export const engine = new Engine();
