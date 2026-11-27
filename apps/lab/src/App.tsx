import { useCallback, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { World } from "./scene/World";
import { audio, speech } from "./audio/audio";
import { engine } from "./sim/engine";
import { store, useUI } from "./state/store";
import { installAlertRouting } from "./alerts";
import { BlindOverlay, CaptionBar, EdgeFlash, TitleCard } from "./ui/Overlays";
import { SidePanel } from "./ui/SidePanel";
import { Wristband } from "./ui/Wristband";
import { ControlBar, Landing, PhoneFrame, ScenarioBlurb, loadScenario, setMode } from "./ui/Controls";
import { startDirector, stopDirector } from "./director/director";
import { SCENARIOS } from "./sim/scenarios";
import { camCtl } from "./scene/cameraControl";

/** Arrow keys walk along the kerb (x axis) relative to the facing direction. */
function walkDir(key: string, yawDeg: number): -1 | 1 {
  const facingNorth = Math.cos((yawDeg * Math.PI) / 180) >= 0;
  const right = key === "ArrowRight";
  return (right === facingNorth ? 1 : -1);
}

const params = new URLSearchParams(location.search);

function useStageScale(director: boolean) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (!director) return;
    const f = () => setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    f();
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, [director]);
  return scale;
}

function Help() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "?") setOpen((o) => !o); if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  if (!open) return null;
  const rows = [["D", "Start director mode (scripted 85 s video sequence)"], ["Esc", "Stop director mode"], ["C", "Captions on/off"], ["B", "Blind mode / sighted view"],
    ["H", "Cycle HearMe OFF / ON / AVAS sound only"], ["1-5", "Scenarios"], ["← →", "Walk along the kerb"], ["Q", "Quality auto / high / medium / low"], ["P / F / W", "Panel / phone / wristband"], ["L", "Speech language EN / AR"], ["Space", "Pause"], ["Drag", "Look around"]];
  return (
    <div className="help" role="dialog" aria-label="Keyboard shortcuts" onClick={() => setOpen(false)}>
      <h2>Keyboard shortcuts</h2>
      <table><tbody>{rows.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody></table>
    </div>
  );
}

export default function App() {
  const director = useUI((s) => s.director);
  const quality = useUI((s) => (s.quality === "auto" ? s.autoLevel : s.quality));
  const scale = useStageScale(director);

  const start = useCallback(async () => {
    try { await audio.init(); } catch (e) { console.warn("Audio unavailable", e); }
    store.set({ started: true });
    if (params.get("director") === "1") startDirector();
    else loadScenario(params.get("scenario") ?? "school");
  }, []);

  useEffect(() => {
    const offAlerts = installAlertRouting();
    engine.reset(SCENARIOS[0], { autoSpawn: true });
    if (params.get("autostart") === "1") start();
    const k = (e: KeyboardEvent) => {
      if (!store.get().started || (e.target as HTMLElement)?.tagName === "SELECT") return;
      const s = store.get();
      switch (e.key.toLowerCase()) {
        case "d": if (!s.director) startDirector(); break;
        case "escape": if (s.director) { stopDirector(); loadScenario(s.scenarioId); } break;
        case "c": store.set({ captionsOn: !s.captionsOn }); break;
        case "b": store.set({ view: s.view === "blind" ? "sighted" : "blind" }); break;
        case "h": setMode(s.mode === "off" ? "on" : s.mode === "on" ? "avas" : "off"); break;
        case "p": store.set({ panelOpen: !s.panelOpen }); break;
        case "f": store.set({ phoneOpen: !s.phoneOpen }); break;
        case "w": store.set({ wristOpen: !s.wristOpen }); break;
        case "l": store.set({ lang: s.lang === "en" ? "ar" : "en" }); break;
        case " ": e.preventDefault(); store.set({ paused: !s.paused }); if (!s.paused) speech.cancel(); break;
        case "q": { const order = ["auto", "high", "medium", "low"] as const; store.set({ quality: order[(order.indexOf(s.quality) + 1) % 4], hint: "" }); break; }
        case "arrowleft": case "arrowright": e.preventDefault(); camCtl.walk = walkDir(e.key, camCtl.yaw); break;
        case "1": case "2": case "3": case "4": case "5": loadScenario(SCENARIOS[Number(e.key) - 1].id); break;
      }
    };
    const ku = (e: KeyboardEvent) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") camCtl.walk = 0; };
    window.addEventListener("keydown", k);
    window.addEventListener("keyup", ku);
    return () => { offAlerts(); window.removeEventListener("keydown", k); window.removeEventListener("keyup", ku); };
  }, [start]);

  const stageStyle = director
    ? { width: 1920, height: 1080, transform: `translate(-50%, -50%) scale(${scale})`, left: "50%", top: "50%", position: "absolute" as const }
    : { inset: 0, position: "absolute" as const };

  return (
    <div className="app">
      <div className={`stage ${director ? "director" : ""}`} style={stageStyle}>
        <Canvas
          shadows="soft"
          dpr={director ? 1 : quality === "high" ? [1, 1.75] : quality === "medium" ? [1, 1.25] : 1}
          camera={{ fov: 62, near: 0.1, far: 500, position: [0, 1.6, 4.6] }}
          gl={{ antialias: true, powerPreference: "high-performance" }}
          onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.0; }}
        >
          <World />
        </Canvas>
        <BlindOverlay />
        <EdgeFlash />
        <TitleCard />
        {!director && <ControlBar />}
        {!director && <SidePanel />}
        {!director && <ScenarioBlurb />}
        <PhoneFrame />
        <Wristband />
        <CaptionBar />
        {director && <div className="rec-dot" title="Director mode — Esc to stop">● REC · Esc to stop</div>}
      </div>
      <Landing onStart={start} />
      <Help />
    </div>
  );
}
