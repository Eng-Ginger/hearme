// DIRECTOR MODE: a scripted ~85 s sequence for recording the hackathon video.
// sighted street -> blind -> silent e-bike, HearMe OFF ("you heard nothing")
// -> same bike, HearMe ON (alert from the left, wristband) -> bus arrival announcement -> title.
// All waits are in simulation time, so the script stays in sync even if frames drop.
import { engine, type PassRecord } from "../sim/engine";
import { DIRECTOR_SCENARIO, KERB_Z, STOP_X, CROSSING_X, type VehicleSpec } from "../sim/scenarios";
import { audio, speech } from "../audio/audio";
import { store } from "../state/store";
import { camCtl } from "../scene/cameraControl";
import { kmh } from "../sim/util";

let runId = 0;
class Aborted extends Error {}

const EBIKE: VehicleSpec = { key: "director-ebike", type: "e_bike", beacon: true, dir: 1, speed: 7.2, spawn: 0, startX: -80, z: 2.5, color: "#e8432e", seedSalt: 2027 };

export function directorRunning() { return runId > 0 && store.get().director; }

export function stopDirector() {
  runId++;
  speech.cancel();
  store.set({ director: false, caption: "", titleCard: "none", panelOpen: true, phoneOpen: true, wristOpen: true, paused: false });
  camCtl.target = null;
}

export async function startDirector() {
  const id = ++runId;
  const alive = () => { if (id !== runId) throw new Aborted(); };
  const until = (pred: () => boolean) => new Promise<void>((res, rej) => {
    const f = () => { if (id !== runId) return rej(new Aborted()); if (pred()) res(); else requestAnimationFrame(f); };
    f();
  });
  const wait = (s: number) => { const t0 = engine.t; return until(() => engine.t >= t0 + s); };
  const caption = (c: string) => store.set({ caption: c });
  const nextPass = (key: string): Promise<PassRecord> => {
    let got: PassRecord | null = null;
    const off = engine.on((e) => { if (e.kind === "pass" && e.pass.key === key && !got) got = e.pass; });
    return until(() => got !== null).then(() => { off(); return got!; }, (err) => { off(); throw err; });
  };
  const nextAlert = (pred: (k: string) => boolean): Promise<void> => {
    let got = false;
    const off = engine.on((e) => { if (e.kind === "alert" && !e.muted && pred(e.alert.kind)) got = true; });
    return until(() => got).then(() => { off(); }, (err) => { off(); throw err; });
  };
  const setMode = (m: "on" | "off") => { engine.mode = m; store.set({ mode: m }); };

  try {
    speech.cancel();
    audio.clearVoices();
    store.set({
      director: true, started: true, panelOpen: false, phoneOpen: false, wristOpen: false, captionsOn: store.get().captionsOn,
      view: "sighted", titleCard: "intro", caption: "", spoken: "", scenarioId: "school", paused: false, receiverMode: "gps", carry: "pocket",
    });
    engine.receiverMode = "gps";
    engine.carry = "pocket";
    setMode("off");
    engine.reset(DIRECTOR_SCENARIO, { seed: 7, autoSpawn: false });
    audio.setAmbient(60, false);
    camCtl.yaw = -55; camCtl.pitch = -3; camCtl.target = null;
    await wait(3.5);

    // 1. Sighted street
    store.set({ titleCard: "none" });
    caption("An Ajman side street, late afternoon. A zebra crossing with no signals, next to a school.");
    camCtl.speed = 0.22; camCtl.target = 35;
    engine.spawn({ key: "director-moto", type: "motorcycle", beacon: false, dir: -1, speed: 11, spawn: 0, startX: 95 });
    await wait(2.5);
    engine.spawn({ key: "director-car", type: "car", beacon: false, dir: 1, speed: 10, spawn: 0, startX: -100, color: "#d9d4c7" });
    await wait(2.5);
    caption("Petrol motorbikes and cars announce themselves. You hear them coming.");
    await wait(4.5);
    camCtl.speed = 0.8; camCtl.target = 0;
    caption("Now close your eyes.");
    await wait(2.2);

    // 2. Blind, HearMe OFF
    store.set({ view: "blind" });
    await wait(2.0);
    caption("HearMe is OFF. Listen.");
    engine.spawn(EBIKE);
    const off = await nextPass(EBIKE.key);
    await wait(0.9);
    caption(`You heard nothing. An electric bike just passed ${off.passDist.toFixed(1)} m in front of you at ${Math.round(kmh(off.speed))} km/h.`);
    await wait(5.5);

    // 3. Replay, HearMe ON
    caption("Same street. Same bike. Now with HearMe.");
    setMode("on");
    engine.resetReceiver();
    store.set({ wristOpen: true, phoneOpen: true });
    await wait(2.6);
    caption("");
    engine.forgetSpawns(EBIKE.key); // identical radio trace to the first run
    engine.spawn(EBIKE);
    const warnP = nextAlert((k) => k === "vehicle_warn" || k === "vehicle_urgent");
    await warnP;
    const on = await nextPass(EBIKE.key);
    await wait(0.9);
    const lead = on.leadWarn ?? 0;
    caption(`HearMe warned you ${lead.toFixed(1)} s before it passed, from your left. No internet. Nothing installed on the road.`);
    await wait(6);

    // 4. Bus stop
    caption("Later, at the bus stop.");
    audio.clearVoices();
    engine.clearVehicles();
    engine.setPed(STOP_X, KERB_Z, 0);
    engine.resetReceiver();
    await wait(2.6);
    caption("");
    engine.spawn({ key: "director-bus", type: "bus", beacon: true, dir: 1, speed: 9, spawn: 0, startX: -70, stopAtX: STOP_X - 1, dwell: 30, route: "12" });
    await nextAlert((k) => k === "bus_arriving");
    await until(() => engine.vehicles.some((v) => v.spec.key === "director-bus" && v.phase === "stopped"));
    await wait(2.0);
    caption("One $1 beacon per vehicle. A $3 wristband or a free phone app.");
    await wait(4.5);
    store.set({ view: "sighted" });
    caption("");
    await wait(3.5);

    // 5. Title
    store.set({ titleCard: "outro", wristOpen: false, phoneOpen: false });
    await wait(7);
    alive();
    engine.setPed(CROSSING_X, KERB_Z, 0);
  } catch (e) {
    if (!(e instanceof Aborted)) { console.error(e); stopDirector(); }
  }
}
