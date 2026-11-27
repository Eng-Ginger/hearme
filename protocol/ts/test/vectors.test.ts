import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as hm from "../src/index";

const VEC = JSON.parse(readFileSync(fileURLToPath(new URL("../../test_vectors.json", import.meta.url)), "utf8"));
const KEY = hm.hexToBytes(VEC.fleet_key_hex);

describe("HearMe TS codec vs shared test vectors", () => {
  for (const v of VEC.vectors) {
    it(v.name, () => {
      const data = hm.hexToBytes(v.payload_hex);
      if (v.valid) {
        const p = hm.decode(data);
        expect(hm.fields(p)).toEqual(v.fields);
        expect(hm.bytesToHex(hm.encode(p, KEY, v.epoch))).toBe(v.payload_hex);
        const adv = hm.encodeAdv(p, KEY, v.epoch);
        expect(hm.bytesToHex(adv)).toBe(v.adv_hex);
        expect(adv.length).toBeLessThanOrEqual(31);
        expect(hm.verify(data, KEY, v.epoch)).toBe(true);
        expect(hm.bytesToHex(hm.parseAdv(adv)!)).toBe(v.payload_hex);
      } else if (v.failure === "decode") {
        expect(() => hm.decode(data)).toThrow(hm.DecodeError);
      } else {
        hm.decode(data);
        expect(hm.verify(data, KEY, v.epoch)).toBe(false);
      }
    });
  }
  it("rolling id matches Python reference", () => {
    const v0 = VEC.vectors[0];
    expect(hm.rollingIdFor(new TextEncoder().encode("bike-001"), v0.epoch)).toBe(v0.fields.rolling_id);
  });
  it("sha256 known answer", () => {
    expect(hm.bytesToHex(hm.sha256(new TextEncoder().encode("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
