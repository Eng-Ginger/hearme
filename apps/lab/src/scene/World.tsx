// Scene graph: lighting, sky, street, vehicles, first-person camera, and the per-frame loop
// that advances the engine and keeps the 3D audio in sync.
import { useEffect, useMemo, useReducer, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
import * as THREE from "three";
import { engine, type VehicleInst } from "../sim/engine";
import { SILENT } from "../sim/scenarios";
import { audio } from "../audio/audio";
import { store, useUI } from "../state/store";
import { Street } from "./Street";
import { BusModel, CarModel, EBikeModel, EScooterModel, MotorcycleModel, TukTukModel } from "./Models";
import { camCtl } from "./cameraControl";

function VehicleView({ v, night }: { v: VehicleInst; night: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const wobble = useMemo(() => Math.random() * 10, []);
  useFrame((st) => {
    const g = ref.current;
    if (!g) return;
    g.position.set(v.x, 0, v.z);
    g.rotation.y = v.dir === 1 ? 0 : Math.PI;
    if (v.type === "e_bike" || v.type === "e_scooter" || v.type === "motorcycle") g.rotation.x = Math.sin(st.clock.elapsedTime * 1.3 + wobble) * 0.02;
  });
  const color = v.spec.color;
  return (
    <group ref={ref} position={[v.x, 0, v.z]}>
      {v.type === "e_bike" && <EBikeModel color={color} night={night} />}
      {v.type === "e_scooter" && <EScooterModel night={night} />}
      {v.type === "motorcycle" && <MotorcycleModel night={night} />}
      {v.type === "car" && <CarModel color={color} night={night} />}
      {v.type === "bus" && <BusModel route={v.spec.route} night={night} />}
      {v.type === "tuk_tuk" && <TukTukModel color={color} night={night} />}
      {night && (v.type === "bus" || v.type === "car") && <pointLight position={[v.type === "bus" ? 7 : 3, 0.8, 0]} intensity={12} distance={14} color="#fff2cc" />}
    </group>
  );
}

function Vehicles({ night }: { night: boolean }) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => engine.on((e) => { if (e.kind === "roster" || e.kind === "reset") force(); }), []);
  return <>{engine.vehicles.map((v) => <VehicleView key={v.uid} v={v} night={night} />)}</>;
}

/** First-person camera at 1.6 m; drag to look around. The engine/receiver use the camera yaw. */
function FirstPerson() {
  const { camera, gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    let down = false, lx = 0, ly = 0;
    const pd = (e: PointerEvent) => { if (store.get().director) return; down = true; lx = e.clientX; ly = e.clientY; el.setPointerCapture(e.pointerId); };
    const pm = (e: PointerEvent) => {
      if (!down) return;
      camCtl.yaw -= (e.clientX - lx) * 0.25;
      camCtl.pitch = Math.max(-35, Math.min(30, camCtl.pitch - (e.clientY - ly) * 0.2));
      camCtl.target = null;
      lx = e.clientX; ly = e.clientY;
    };
    const pu = () => { down = false; };
    el.addEventListener("pointerdown", pd); el.addEventListener("pointermove", pm); window.addEventListener("pointerup", pu);
    return () => { el.removeEventListener("pointerdown", pd); el.removeEventListener("pointermove", pm); window.removeEventListener("pointerup", pu); };
  }, [gl]);
  useFrame((_, dt) => {
    if (camCtl.target !== null) camCtl.yaw += (camCtl.target - camCtl.yaw) * Math.min(1, dt * camCtl.speed);
    // yaw: compass degrees, 0 = north (-z)
    let yaw = ((camCtl.yaw % 360) + 540) % 360 - 180;
    camCtl.yaw = yaw;
    const p = engine.ped;
    camera.position.set(p.x, 1.6, p.z);
    const yr = THREE.MathUtils.degToRad(yaw), pr = THREE.MathUtils.degToRad(camCtl.pitch);
    camera.lookAt(p.x + Math.sin(yr) * Math.cos(pr), 1.6 + Math.sin(pr), p.z - Math.cos(yr) * Math.cos(pr));
    yaw = (yaw + 360) % 360;
    engine.ped.yaw = yaw;
  });
  return null;
}

/** Advances the simulation and keeps audio voices + listener in sync, once per frame. */
function Loop() {
  const alive = useRef(new Set<number>());
  useFrame((_, dt) => {
    const ui = store.get();
    if (!ui.started) return;
    if (!ui.paused) engine.step(Math.min(dt, 0.1));
    if (!audio.ctx) return;
    const p = engine.ped;
    audio.setListener(p.x, 1.6, p.z, p.yaw);
    const a = alive.current;
    a.clear();
    const avas = ui.mode === "avas";
    for (const v of engine.vehicles) {
      a.add(v.uid);
      audio.ensureVoice(v.uid, v.type);
      audio.updateVoice(v.uid, { x: v.x, y: v.type === "bus" ? 1.2 : 0.7, z: v.z, speed: v.v, braking: v.braking, avas: avas && SILENT.has(v.type) });
    }
    audio.pruneVoices(a);
    if (ui.mode === "on" && !ui.paused) audio.proximityPulse(engine.mostUrgent());
  });
  return null;
}

export function World() {
  const night = useUI((s) => s.scenarioId === "night");
  const { scene } = useThree();
  useEffect(() => {
    scene.fog = new THREE.Fog(night ? "#0b1020" : "#e9c9a0", night ? 25 : 70, night ? 140 : 260);
    scene.background = night ? new THREE.Color("#070b18") : null;
  }, [night, scene]);
  // warm late-afternoon sun from the west, low elevation
  const sunPos: [number, number, number] = [-80, 22, 30];
  return (
    <>
      {!night && <Sky sunPosition={sunPos} turbidity={7} rayleigh={1.6} mieCoefficient={0.006} mieDirectionalG={0.85} distance={4000} />}
      <hemisphereLight args={[night ? "#28324d" : "#ffe2bf", night ? "#0d0f14" : "#7a6248", night ? 0.09 : 0.75]} />
      <ambientLight intensity={night ? 0.03 : 0.18} />
      <directionalLight
        position={night ? [30, 40, -20] : sunPos}
        intensity={night ? 0.06 : 2.4}
        color={night ? "#8fa3d6" : "#ffc58a"}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-45} shadow-camera-right={45} shadow-camera-top={30} shadow-camera-bottom={-30}
        shadow-camera-near={1} shadow-camera-far={200} shadow-bias={-0.0004}
      />
      <Street night={night} />
      <Vehicles night={night} />
      <FirstPerson />
      <Loop />
    </>
  );
}
