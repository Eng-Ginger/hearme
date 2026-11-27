// HearMe BLE packet codec (TypeScript). Mirrors protocol/python/hearme_protocol.py.
import { hmacSha256 } from "./sha256";
export { sha256, hmacSha256 } from "./sha256";

export const COMPANY_ID = 0xffff;
export const VERSION = 1;
export const EPOCH_SECONDS = 600;
export const MAC_LEN = 4;
export const HEADER_LEN = 8;
export const POS_LEN = 8;
export const MAX_BODY = 27;
export const SPEED_UNKNOWN = 0xff;
export const HEADING_UNKNOWN = 0xff;

export const TYPES = [
  "e_bike", "e_scooter", "tuk_tuk", "car", "bus", "bus_stop", "crossing", "school_zone", "motorcycle",
] as const;
export type BeaconType = (typeof TYPES)[number];
export const INFRA_TYPES: ReadonlySet<BeaconType> = new Set(["bus_stop", "crossing", "school_zone"]);
export const DOORS = ["front", "middle", "rear", "unknown"] as const;
export type Door = (typeof DOORS)[number];

export const FLAG_BRAKING = 0x01;
export const FLAG_GPS_VALID = 0x02;
export const FLAG_HAS_POSITION = 0x04;
export const FLAG_REVERSING = 0x08;

export interface Packet {
  type: BeaconType;
  rolling_id: string; // 8 hex chars
  speed_raw: number; // 0.1 m/s, 255 unknown
  heading_raw: number; // deg/2, 255 unknown
  braking: boolean;
  gps_valid: boolean;
  reversing: boolean;
  lat_e7: number | null;
  lon_e7: number | null;
  route?: string;
  door?: Door;
  ramp?: boolean;
  short_code?: number;
  name?: string;
  mac?: string;
}

export class DecodeError extends Error {}

export const speedMps = (p: Packet): number | null => (p.speed_raw === SPEED_UNKNOWN ? null : p.speed_raw / 10);
export const headingDeg = (p: Packet): number | null => (p.heading_raw === HEADING_UNKNOWN ? null : p.heading_raw * 2);
export const hasPosition = (p: Packet): boolean => p.lat_e7 !== null && p.lon_e7 !== null;

export function speedToRaw(mps: number | null): number {
  if (mps === null) return SPEED_UNKNOWN;
  return Math.max(0, Math.min(254, Math.floor(mps * 10 + 0.5)));
}
export function headingToRaw(deg: number | null): number {
  if (deg === null) return HEADING_UNKNOWN;
  const d = ((deg % 360) + 360) % 360;
  return Math.floor(d / 2 + 0.5) % 180;
}
export const epochOf = (unixS: number): number => Math.floor(unixS / EPOCH_SECONDS) >>> 0;

export const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
};
export const bytesToHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const ascii = (s: string) => Uint8Array.from(s, (c) => { const x = c.charCodeAt(0); return x < 128 ? x : 0x3f; });

function u32le(n: number): Uint8Array { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; }
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function rollingIdFor(deviceSecret: Uint8Array, epoch: number): string {
  return bytesToHex(hmacSha256(deviceSecret, concat(ascii("HMid"), u32le(epoch))).slice(0, 4));
}

export function computeMac(key: Uint8Array, epoch: number, body: Uint8Array): Uint8Array {
  const hdr = new Uint8Array([COMPANY_ID & 0xff, COMPANY_ID >> 8]);
  return hmacSha256(key, concat(ascii("HMv1"), u32le(epoch), hdr, body)).slice(0, MAC_LEN);
}

function fixedAscii(s: string, n: number): Uint8Array {
  const b = new Uint8Array(n);
  b.set(ascii(s).slice(0, n));
  return b;
}

/** Encode to manufacturer data after the company ID. */
export function encode(p: Packet, key: Uint8Array, epoch: number): Uint8Array {
  const tcode = TYPES.indexOf(p.type);
  if (tcode < 0) throw new Error("unknown type " + p.type);
  const infra = INFRA_TYPES.has(p.type);
  const hasPos = hasPosition(p) && !infra;
  const flags = (p.braking ? FLAG_BRAKING : 0) | (p.gps_valid ? FLAG_GPS_VALID : 0) |
    (hasPos ? FLAG_HAS_POSITION : 0) | (p.reversing ? FLAG_REVERSING : 0);
  const parts: Uint8Array[] = [
    new Uint8Array([(VERSION << 4) | tcode]), hexToBytes(p.rolling_id),
    new Uint8Array([flags, p.speed_raw & 0xff, p.heading_raw & 0xff]),
  ];
  if (hasPos) {
    const b = new Uint8Array(8); const dv = new DataView(b.buffer);
    dv.setInt32(0, p.lat_e7!, true); dv.setInt32(4, p.lon_e7!, true); parts.push(b);
  }
  if (p.type === "bus") {
    parts.push(fixedAscii(p.route ?? "", 6));
    parts.push(new Uint8Array([(DOORS.indexOf(p.door ?? "unknown") & 3) | (p.ramp ? 4 : 0)]));
  } else if (infra) {
    const sc = p.short_code ?? 0;
    parts.push(new Uint8Array([sc & 0xff, (sc >> 8) & 0xff]), fixedAscii(p.name ?? "", 12));
  }
  const body = concat(...parts);
  const out = concat(body, computeMac(key, epoch, body));
  if (out.length > MAX_BODY) throw new Error("packet too long");
  return out;
}

export function encodeAdv(p: Packet, key: Uint8Array, epoch: number): Uint8Array {
  const body = encode(p, key, epoch);
  return concat(new Uint8Array([body.length + 3, 0xff, COMPANY_ID & 0xff, COMPANY_ID >> 8]), body);
}

function readAscii(b: Uint8Array): string {
  let s = "";
  for (const x of b) { if (x === 0) break; s += x < 128 ? String.fromCharCode(x) : "�"; }
  return s;
}

/** Decode manufacturer data (after company ID). Does not verify the MAC. */
export function decode(data: Uint8Array): Packet {
  if (data.length < HEADER_LEN + MAC_LEN) throw new DecodeError("too short");
  const ver = data[0] >> 4, tcode = data[0] & 0x0f;
  if (ver !== VERSION) throw new DecodeError("bad version");
  if (tcode >= TYPES.length) throw new DecodeError("bad type");
  const type = TYPES[tcode];
  const flags = data[5];
  const hasPos = (flags & FLAG_HAS_POSITION) !== 0;
  const infra = INFRA_TYPES.has(type);
  if (infra && hasPos) throw new DecodeError("infrastructure packet with position");
  let expected = HEADER_LEN + (hasPos ? POS_LEN : 0) + MAC_LEN;
  if (type === "bus") expected += 7; else if (infra) expected += 14;
  if (data.length !== expected) throw new DecodeError("bad length");
  const p: Packet = {
    type, rolling_id: bytesToHex(data.slice(1, 5)), speed_raw: data[6], heading_raw: data[7],
    braking: (flags & FLAG_BRAKING) !== 0, gps_valid: (flags & FLAG_GPS_VALID) !== 0,
    reversing: (flags & FLAG_REVERSING) !== 0, lat_e7: null, lon_e7: null,
  };
  if (p.heading_raw !== HEADING_UNKNOWN && p.heading_raw >= 180) throw new DecodeError("bad heading");
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let off = HEADER_LEN;
  if (hasPos) { p.lat_e7 = dv.getInt32(off, true); p.lon_e7 = dv.getInt32(off + 4, true); off += 8; }
  if (type === "bus") {
    p.route = readAscii(data.slice(off, off + 6));
    const db = data[off + 6]; p.door = DOORS[db & 3]; p.ramp = (db & 4) !== 0; off += 7;
  } else if (infra) {
    p.short_code = dv.getUint16(off, true); p.name = readAscii(data.slice(off + 2, off + 14)); off += 14;
  }
  p.mac = bytesToHex(data.slice(off, off + 4));
  return p;
}

export function verify(data: Uint8Array, key: Uint8Array, epoch: number, window = 1): boolean {
  const body = data.slice(0, data.length - MAC_LEN), mac = data.slice(data.length - MAC_LEN);
  for (let d = -window; d <= window; d++) {
    const m = computeMac(key, (epoch + d) >>> 0, body);
    let diff = 0; for (let i = 0; i < MAC_LEN; i++) diff |= m[i] ^ mac[i];
    if (diff === 0) return true;
  }
  return false;
}

/** Find HearMe manufacturer data inside raw advertising data. */
export function parseAdv(adv: Uint8Array): Uint8Array | null {
  let i = 0;
  while (i < adv.length) {
    const ln = adv[i];
    if (ln === 0 || i + 1 + ln > adv.length) return null;
    if (adv[i + 1] === 0xff && ln >= 3 && (adv[i + 2] | (adv[i + 3] << 8)) === COMPANY_ID) return adv.slice(i + 4, i + 1 + ln);
    i += 1 + ln;
  }
  return null;
}

// ---- v1.1: scan response carrying the HearMe 128-bit service UUID (main packet unchanged)
export const SPEC_REVISION = "1.1";
export const SERVICE_UUID = "4f2a6c1e-7d3b-4e9a-9c51-8b0d2e6f3a71"; // random v4, not SIG-assigned
/** UUID bytes in on-air (little-endian) order. */
export const SERVICE_UUID_LE: Uint8Array = hexToBytes(SERVICE_UUID.replace(/-/g, "")).reverse();
export const AD_UUID128_INCOMPLETE = 0x06;
export const AD_UUID128_COMPLETE = 0x07;
export const SCAN_RESPONSE_LEN = 18;

/** Scan response AdvData: one "Complete List of 128-bit Service UUIDs" AD (18 bytes). */
export function encodeScanResponse(): Uint8Array {
  return concat(new Uint8Array([1 + SERVICE_UUID_LE.length, AD_UUID128_COMPLETE]), SERVICE_UUID_LE);
}

/** True if AdvData / scan-response data lists the HearMe service UUID (AD type 0x06 or 0x07). */
export function hasHearmeUuid(ad: Uint8Array): boolean {
  let i = 0;
  while (i < ad.length) {
    const ln = ad[i];
    if (ln === 0 || i + 1 + ln > ad.length) return false;
    const t = ad[i + 1];
    if ((t === AD_UUID128_INCOMPLETE || t === AD_UUID128_COMPLETE) && (ln - 1) % 16 === 0) {
      for (let j = i + 2; j < i + 1 + ln; j += 16) {
        let diff = 0;
        for (let k = 0; k < 16; k++) diff |= ad[j + k] ^ SERVICE_UUID_LE[k];
        if (diff === 0) return true;
      }
    }
    i += 1 + ln;
  }
  return false;
}
export const parseScanResponse = hasHearmeUuid;

/** Canonical field dict, same shape as test_vectors.json "fields". */
export function fields(p: Packet): Record<string, unknown> {
  const d: Record<string, unknown> = {
    type: p.type, rolling_id: p.rolling_id, speed_raw: p.speed_raw, heading_raw: p.heading_raw,
    braking: p.braking, gps_valid: p.gps_valid, reversing: p.reversing, lat_e7: p.lat_e7, lon_e7: p.lon_e7,
  };
  if (p.type === "bus") Object.assign(d, { route: p.route, door: p.door, ramp: p.ramp });
  if (INFRA_TYPES.has(p.type)) Object.assign(d, { short_code: p.short_code, name: p.name });
  return d;
}

export const TEST_FLEET_KEY = hexToBytes("4865617224d650a1c3e79f0b8a2d5e6f1b3c4d5e6f708192a3b4c5d6e7f80910");
