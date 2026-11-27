// Top control bar, landing screen and phone frame.
import { useEffect } from "react";
import { PhoneApp } from "@hearme/receiver-pwa";
import { engine, type HearMeMode } from "../sim/engine";
import { SCENARIOS } from "../sim/scenarios";
import { audio, speech } from "../audio/audio";
import { store, useUI } from "../state/store";
import { startDirector, stopDirector } from "../director/director";
import { camCtl } from "../scene/cameraControl";

export function loadScenario(id: string) {
  const sc = SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
  if (store.get().director) stopDirector();
  speech.cancel();
  audio.clearVoices();
  engine.reset(sc, { autoSpawn: true });
  audio.setAmbient(sc.ambientDb, sc.night);
  camCtl.yaw = sc.ped.yaw; camCtl.target = null;
  store.set({ scenarioId: sc.id, caption: "", spoken: "" });
}

export function setMode(m: HearMeMode) {
  engine.mode = m;
  if (m !== "on") speech.cancel();
  store.set({ mode: m });
}

const MODES: { id: HearMeMode; label: string }[] = [{ id: "off", label: "HearMe OFF" }, { id: "on", label: "HearMe ON" }, { id: "avas", label: "AVAS sound only" }];

export function ControlBar() {
  const s = useUI((x) => x);
  return (
    <header className="bar">
      <div className="brand">Hear<span>Me</span> <small>Lab</small></div>
      <div className="seg" role="group" aria-label="View">
        <button className={s.view === "sighted" ? "on" : ""} onClick={() => store.set({ view: "sighted" })}>Sighted view</button>
        <button className={s.view === "blind" ? "on" : ""} onClick={() => store.set({ view: "blind" })}>Blind mode</button>
      </div>
      <div className="seg" role="group" aria-label="HearMe mode">
        {MODES.map((m) => <button key={m.id} className={s.mode === m.id ? "on " + m.id : ""} onClick={() => setMode(m.id)}>{m.label}</button>)}
      </div>
      <select aria-label="Scenario" value={s.scenarioId} onChange={(e) => loadScenario(e.target.value)}>
        {SCENARIOS.map((sc) => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
      </select>
      <div className="seg small" role="group" aria-label="Speech language">
        <button className={s.lang === "en" ? "on" : ""} onClick={() => store.set({ lang: "en" })}>EN</button>
        <button className={s.lang === "ar" ? "on" : ""} onClick={() => store.set({ lang: "ar" })}>عربي</button>
      </div>
      <div className="spacer" />
      <button className="ghost" aria-pressed={s.panelOpen} onClick={() => store.set({ panelOpen: !s.panelOpen })}>Panel</button>
      <button className="ghost" aria-pressed={s.phoneOpen} onClick={() => store.set({ phoneOpen: !s.phoneOpen })}>Phone</button>
      <button className="ghost" aria-pressed={s.wristOpen} onClick={() => store.set({ wristOpen: !s.wristOpen })}>Band</button>
      <button className="ghost" aria-pressed={s.captionsOn} onClick={() => store.set({ captionsOn: !s.captionsOn })}>CC</button>
      <button className="director-btn" onClick={() => startDirector()} title="Director mode (D)">● Director</button>
    </header>
  );
}

export function ScenarioBlurb() {
  const id = useUI((s) => s.scenarioId);
  const director = useUI((s) => s.director);
  const blind = useUI((s) => s.view === "blind");
  const hint = useUI((s) => s.hint);
  if (director || blind) return null;
  const sc = SCENARIOS.find((x) => x.id === id);
  return <div className="blurb"><b>{sc?.name}</b> — {sc?.blurb}<span>{hint || "Drag to look around · D director · B blind · H HearMe mode · 1-4 scenarios · ? help"}</span></div>;
}

export function PhoneFrame() {
  const open = useUI((s) => s.phoneOpen);
  if (!open) return null;
  return (
    <div className="phone-frame" aria-label="HearMe phone app (live)">
      <div className="phone-notch" />
      <div className="phone-screen"><PhoneApp embedded speakDefault={false} /></div>
    </div>
  );
}

export function Landing({ onStart }: { onStart: () => void }) {
  const started = useUI((s) => s.started);
  useEffect(() => {
    if (started) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Enter") onStart(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [started, onStart]);
  if (started) return null;
  return (
    <div className="landing">
      <div className="landing-inner">
        <div className="l-logo">Hear<span>Me</span></div>
        <p className="l-tag">Electric vehicles are silent. We made them speak.</p>
        <div className="l-hp"><span aria-hidden="true">🎧</span> Put on headphones. Sound in this demo is fully 3D.</div>
        <button className="l-start" onClick={onStart} autoFocus>Start</button>
        <p className="l-small">WFEO Hackathon 2027 · Challenge 1: Inclusive Mobility · Digital prototype, all radio and traffic simulated</p>
      </div>
    </div>
  );
}
