import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { encode, epochOf, headingToRaw, speedToRaw, TEST_FLEET_KEY, type Packet } from "@hearme/protocol";
import { Receiver, runTrace, vehicleText, busText, WARN, URGENT, type Trace } from "../src";

const TRACES = fileURLToPath(new URL("../../../tests/traces/", import.meta.url));

describe("cross-language traces (TS must equal Python reference)", () => {
  for (const f of readdirSync(TRACES).filter((x) => x.endsWith(".json"))) {
    it(f, () => {
      const tr = JSON.parse(readFileSync(TRACES + f, "utf8")) as Trace;
      expect(runTrace(tr)).toEqual(tr.expected);
    });
  }
});

const T0 = 1_800_000_000;
const LAT = 25.4052, LON = 55.5136;
const M_PER_DEG_LAT = 6371008.8 * Math.PI / 180;
function bikeAt(x: number, y: number, speed: number, heading: number, id = "0a0b0c0d"): Packet {
  return {
    type: "e_bike", rolling_id: id, speed_raw: speedToRaw(speed), heading_raw: headingToRaw(heading),
    braking: false, gps_valid: true, reversing: false,
    lat_e7: Math.round((LAT + y / M_PER_DEG_LAT) * 1e7),
    lon_e7: Math.round((LON + x / (M_PER_DEG_LAT * Math.cos(LAT * Math.PI / 180))) * 1e7),
  };
}

describe("state machine", () => {
  it("escalates warn -> urgent once each (at 7 m/s it is < 6 s away when it enters the 35 m aware radius)", () => {
    const rx = new Receiver();
    rx.setPose(LAT, LON, 0);
    const kinds: string[] = [];
    for (let i = 0; i < 120; i++) {
      const t = T0 + i * 0.1, x = -60 + 7 * i * 0.1;
      if (x > 0) break;
      for (const e of rx.processPacket(t, -50 - 22 * Math.log10(Math.max(1, Math.abs(x))), bikeAt(x, 2.75, 7, 90))) kinds.push(e.kind);
    }
    expect(kinds).toEqual(["vehicle_warn", "vehicle_urgent"]);
  });

  it("ignores a parked beaconing bike", () => {
    const rx = new Receiver();
    rx.setPose(LAT, LON, 0);
    const ev = [];
    for (let i = 0; i < 50; i++) ev.push(...rx.processPacket(T0 + i * 0.1, -55, bikeAt(2, 1, 0, 0)));
    expect(ev).toEqual([]);
  });

  it("hysteresis: holds level for hold_s before downgrading, stale -> ignore", () => {
    const rx = new Receiver();
    rx.setPose(LAT, LON, 0);
    rx.processPacket(T0, -60, bikeAt(-14, 2, 7, 90)); // ttr 2 s -> urgent
    expect(rx.states()[0].level).toBe("urgent");
    rx.processPacket(T0 + 0.1, -60, bikeAt(5, 2, 7, 90)); // passed: wants aware
    expect(rx.states()[0].level).toBe("urgent");
    rx.processPacket(T0 + 1.7, -60, bikeAt(15, 2, 7, 90));
    expect(rx.states()[0].level).toBe("aware");
    rx.tick(T0 + 5);
    expect(rx.states()[0].level).toBe("ignore");
  });

  it("rejects spoofed packets when require_mac is set", () => {
    const rx = new Receiver({ fleet_key: TEST_FLEET_KEY, require_mac: true });
    rx.setPose(LAT, LON, 0);
    const bad = encode(bikeAt(-10, 2, 7, 90), new TextEncoder().encode("attacker"), epochOf(T0));
    expect(rx.processPayload(T0, -50, bad)).toEqual([]);
    expect(rx.packetsRejected).toBe(1);
    const good = encode(bikeAt(-10, 2, 7, 90), TEST_FLEET_KEY, epochOf(T0));
    expect(rx.processPayload(T0, -50, good).length).toBeGreaterThan(0);
  });
});

describe("texts", () => {
  it("formats warnings in English and Arabic", () => {
    expect(vehicleText(WARN, "e_bike", 7, "left", 3)).toEqual(["Electric bike, fast, from your left, 3 seconds", "دراجة كهربائية، سريعة، من يسارك، 3 ثوانٍ"]);
    expect(vehicleText(URGENT, "e_scooter", 6, "right", 1)[0]).toBe("Stop! E-scooter, fast, from your right, 1 second");
    expect(busText("12", "front", "ahead")[0]).toBe("Bus 12 arriving, front door ahead");
  });
});
