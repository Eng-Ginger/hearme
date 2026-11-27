// Scene graph: lighting, sky, street, vehicles, first-person camera, and the per-frame loop
// that advances the engine and keeps the 3D audio in sync.
import { Suspense, useEffect, useReducer, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import { Students } from "./Students";
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
  const wheels = useRef<THREE.Object3D[] | null>(null);
  const lastZ = useRef(v.z);
  const lean = useRef(0);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    if (!wheels.current) { const w: THREE.Object3D[] = []; g.traverse((o) => { if (o.name === "wheel") w.push(o); }); wheels.current = w; }
    for (const w of wheels.current) w.rotation.z -= (v.v * dt) / (w.userData.r as number);   // rolls at v / r
    g.position.set(v.x, 0, v.z);
    g.rotation.y = v.dir === 1 ? 0 : Math.PI;
    if (v.type === "e_bike" || v.type === "e_scooter" || v.type === "motorcycle") {
      // lean into the lateral motion of the lane wobble (roll ~ lateral speed change)
      const lat = dt > 0 ? (v.z - lastZ.current) / dt : 0;
      lean.current += (THREE.MathUtils.clamp(-lat * 0.35 * v.dir, -0.12, 0.12) - lean.current) * Math.min(1, dt * 4);
      g.rotation.x = lean.current;
    }
    lastZ.current = v.z;
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
  const smooth = useRef({ x: engine.ped.x, z: engine.ped.z, phase: 0, t: 0 });
  useFrame((_, dt) => {
    if (camCtl.target !== null) camCtl.yaw += (camCtl.target - camCtl.yaw) * Math.min(1, dt * camCtl.speed);
    // arrow keys: walk along the kerb at 1.3 m/s (the receiver pose follows)
    if (camCtl.walk !== 0 && !store.get().director) engine.ped.x += camCtl.walk * 1.3 * Math.min(dt, 0.1);
    // yaw: compass degrees, 0 = north (-z)
    let yaw = ((camCtl.yaw % 360) + 540) % 360 - 180;
    camCtl.yaw = yaw;
    const p = engine.ped, sm = smooth.current;
    sm.t += dt;
    const dx = p.x - sm.x, dz = p.z - sm.z, dist = Math.hypot(dx, dz);
    if (dist > 15) { sm.x = p.x; sm.z = p.z; }                       // scene change: cut
    else { const step = Math.min(dist, 1.4 * dt); if (dist > 1e-4) { sm.x += (dx / dist) * step; sm.z += (dz / dist) * step; } }
    const walking = dist > 0.02 || camCtl.walk !== 0;
    if (walking) sm.phase += dt * 2 * Math.PI * 1.85;                 // ~1.85 steps/s
    const bob = walking ? Math.abs(Math.sin(sm.phase)) * 0.045 - 0.02 : Math.sin(sm.t * 1.6) * 0.004;   // step bob / breathing
    const sway = walking ? Math.sin(sm.phase * 0.5) * 0.025 : Math.sin(sm.t * 0.37) * 0.012;           // weight shift
    const yr0 = THREE.MathUtils.degToRad(camCtl.yaw);
    camera.position.set(sm.x + Math.cos(yr0) * sway, 1.6 + bob, sm.z + Math.sin(yr0) * sway);
    const yr = THREE.MathUtils.degToRad(yaw), pr = THREE.MathUtils.degToRad(camCtl.pitch);
    camera.lookAt(camera.position.x + Math.sin(yr) * Math.cos(pr), camera.position.y + Math.sin(pr), camera.position.z - Math.cos(yr) * Math.cos(pr));
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
  const quality = useUI((s) => s.quality);
  const { scene, gl } = useThree();
  useEffect(() => {
    scene.fog = new THREE.Fog(night ? "#0b1020" : "#e7cfae", night ? 25 : 90, night ? 150 : 340);   // warm distant haze
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = night ? 0.55 : 0.95;
  }, [night, scene, gl]);
  // low late-afternoon sun from the south-west
  const sunPos: [number, number, number] = [-70, 26, 45];
  const hdri = night ? "/assets/polyhaven/qwantani_dusk_2_puresky_1k.hdr"
    : quality === "high" ? "/assets/polyhaven/qwantani_late_afternoon_puresky_2k.hdr" : "/assets/polyhaven/qwantani_late_afternoon_puresky_1k.hdr";
  const shadowSize = quality === "high" ? 4096 : 1024;
  return (
    <>
      <Suspense fallback={null}>
        <Environment files={hdri} background environmentIntensity={night ? 0.12 : 0.55} backgroundIntensity={night ? 0.25 : 1} />
      </Suspense>
      <hemisphereLight args={[night ? "#28324d" : "#ffe6c7", night ? "#0d0f14" : "#8a7356", night ? 0.08 : 0.25]} />
      <directionalLight
        key={shadowSize}
        position={night ? [30, 40, -20] : sunPos}
        intensity={night ? 0.05 : 2.6}
        color={night ? "#8fa3d6" : "#ffcf98"}
        castShadow
        shadow-mapSize={[shadowSize, shadowSize]}
        shadow-radius={quality === "high" ? 6 : 3}
        shadow-camera-left={-50} shadow-camera-right={50} shadow-camera-top={40} shadow-camera-bottom={-40}
        shadow-camera-near={1} shadow-camera-far={220} shadow-bias={-0.0004} shadow-normalBias={0.02}
      />
      <Suspense fallback={null}><Street night={night} /></Suspense>
      <Vehicles night={night} />
      <Students count={quality === "high" ? 8 : 4} />
      <FirstPerson />
      <Loop />
    </>
  );
}
