// Gulf university campus street in Ajman (gate area with an unsignalised crossing), modelled after
// CC BY-SA reference photos of a campus in Ajman (apps/lab/reference/ajman_uni, see ATTRIBUTION.md):
// a glass "student hub" with blue vertical fins, sand-coloured stone buildings with terracotta bands
// and domes, wide pale plazas, young trees, palms, shade structures and a bus stop.
// No university name or logo is used. PBR textures: Poly Haven (CC0).
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import { signTexture } from "./textures";
import { STOP_X } from "../sim/scenarios";
import { CarModel } from "./Models";

const PH = "/assets/polyhaven/";
const SAND = "#d9c4a0", STONE = "#e6d3b1", TERRACOTTA = "#b5653f", GLASS = "#1d3646";

function usePbr(name: string, repeat: [number, number], tint?: string, useColorMap = true) {
  const t = useTexture({
    ...(useColorMap ? { map: `${PH}${name}_diffuse_1k.webp` } : {}),
    normalMap: `${PH}${name}_nor_gl_1k.webp`, roughnessMap: `${PH}${name}_rough_1k.webp`,
  });
  return useMemo(() => {
    const out: Record<string, THREE.Texture> = {};
    for (const [k, tex] of Object.entries(t)) {
      const c = tex.clone();                     // per-use repeat without mutating the cached texture
      c.wrapS = c.wrapT = THREE.RepeatWrapping;
      c.repeat.set(repeat[0], repeat[1]);
      c.anisotropy = 8;
      c.colorSpace = k === "map" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      c.needsUpdate = true;
      out[k] = c;
    }
    return { ...out, color: tint ? new THREE.Color(tint) : undefined };
  }, [t, repeat[0], repeat[1], tint, useColorMap]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Palm with fronds swaying lightly in the wind. */
function Palm({ x, z, h = 6, s = 1 }: { x: number; z: number; h?: number; s?: number }) {
  const crown = useRef<THREE.Group>(null);
  const phase = useMemo(() => Math.abs(x * 0.37 + z * 0.11) % 6.28, [x, z]);
  const leaves = useMemo(() => Array.from({ length: 10 }, (_, i) => (i / 10) * Math.PI * 2 + phase), [phase]);
  useFrame(({ clock }) => {
    const g = crown.current;
    if (!g) return;
    const t = clock.elapsedTime;
    g.rotation.z = Math.sin(t * 0.9 + phase) * 0.035;
    g.rotation.x = Math.sin(t * 0.7 + phase * 1.3) * 0.025;
    for (let i = 0; i < g.children.length - 1; i++) g.children[i].rotation.x = Math.sin(t * 1.6 + i + phase) * 0.05;
  });
  return (
    <group position={[x, 0, z]} scale={s}>
      <mesh position={[0, h / 2, 0]} castShadow>
        <cylinderGeometry args={[0.17, 0.27, h, 8]} />
        <meshStandardMaterial color="#8a6a46" roughness={1} />
      </mesh>
      <group ref={crown} position={[0, h - 0.2, 0]}>
        {leaves.map((a, i) => (
          <group key={i} rotation={[0, -a, 0]}>
            <mesh position={[1.25, -0.15, 0]} rotation={[0, 0, -0.5]} castShadow>
              <boxGeometry args={[2.7, 0.04, 0.6]} />
              <meshStandardMaterial color={i % 2 ? "#3d7a32" : "#4d8a3a"} roughness={0.85} side={THREE.DoubleSide} />
            </mesh>
          </group>
        ))}
        <mesh><sphereGeometry args={[0.36, 10, 8]} /><meshStandardMaterial color="#6d5233" /></mesh>
      </group>
    </group>
  );
}

/** Young campus tree in a round planter (as in the reference plazas). */
function YoungTree({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0.16, z]}>
      <mesh position={[0, 0.2, 0]} receiveShadow><cylinderGeometry args={[0.7, 0.75, 0.4, 16]} /><meshStandardMaterial color="#cfc3ad" roughness={0.9} /></mesh>
      <mesh position={[0, 1.4, 0]} castShadow><cylinderGeometry args={[0.06, 0.09, 2.2, 6]} /><meshStandardMaterial color="#6b5137" /></mesh>
      <mesh position={[0, 2.8, 0]} castShadow><icosahedronGeometry args={[1.05, 1]} /><meshStandardMaterial color="#5f8f3e" roughness={0.9} flatShading /></mesh>
    </group>
  );
}

/** Modern glass "hub" building with blue vertical fins (generic, no signage). */
function GlassHub({ x, z, w, d }: { x: number; z: number; w: number; d: number }) {
  const fins = useMemo(() => {
    const out: { fx: number; c: string; h: number }[] = [];
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let fx = -w / 2 + 0.6; fx < w / 2; fx += 0.9) out.push({ fx, c: rnd() < 0.55 ? "#1f6fb2" : rnd() < 0.5 ? "#36a4d8" : "#0f3e6b", h: rnd() < 0.3 ? 3.2 : 7.4 });
    return out;
  }, [w]);
  const fz = z + d / 2 + 0.35;
  return (
    <group>
      <mesh position={[x, 6, z]} castShadow receiveShadow>
        <boxGeometry args={[w, 12, d]} />
        <meshStandardMaterial color={GLASS} metalness={0.85} roughness={0.08} envMapIntensity={1.2} />
      </mesh>
      {[0.15, 4.1, 8.1, 11.9].map((y) => (
        <mesh key={y} position={[x, y, z + 0.05]} castShadow><boxGeometry args={[w + 0.4, 0.45, d + 0.5]} /><meshStandardMaterial color="#8d9196" roughness={0.6} /></mesh>
      ))}
      {fins.map((f, i) => (
        <mesh key={i} position={[x + f.fx, 4.3 + f.h / 2, fz]} castShadow>
          <boxGeometry args={[0.32, f.h, 0.08]} />
          <meshStandardMaterial color={f.c} metalness={0.3} roughness={0.25} transparent opacity={0.85} />
        </mesh>
      ))}
      {Array.from({ length: Math.floor(w / 6) }, (_, i) => -w / 2 + 3 + i * 6).map((cx) => (
        <mesh key={cx} position={[x + cx, 2, z + d / 2 + 2.2]} castShadow><cylinderGeometry args={[0.3, 0.3, 4, 12]} /><meshStandardMaterial color="#b9bcbf" roughness={0.5} /></mesh>
      ))}
      <mesh position={[x, 4.05, z + d / 2 + 1.2]} castShadow><boxGeometry args={[w, 0.3, 2.6]} /><meshStandardMaterial color="#9ea2a6" roughness={0.6} /></mesh>
    </group>
  );
}

/** Older sand-stone campus building with terracotta bands and small domes. */
function StoneBlock({ x, z, w, d, h, domes = 2 }: { x: number; z: number; w: number; d: number; h: number; domes?: number }) {
  const plaster = usePbr("clay_plaster", [w / 6, h / 6], STONE, false);
  return (
    <group>
      <mesh position={[x, h / 2, z]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial {...plaster} roughness={0.95} />
      </mesh>
      {Array.from({ length: Math.floor(h / 2.2) }, (_, i) => 1.4 + i * 2.2).map((y) => (
        <mesh key={y} position={[x, y, z + d / 2 + 0.02]}><boxGeometry args={[w + 0.06, 0.32, 0.06]} /><meshStandardMaterial color={TERRACOTTA} roughness={0.9} /></mesh>
      ))}
      {Array.from({ length: Math.floor(w / 3.2) }, (_, i) => -w / 2 + 1.8 + i * 3.2).map((wx) =>
        [2.8, 5.0, 7.2].filter((wy) => wy < h - 1).map((wy) => (
          <mesh key={`${wx}:${wy}`} position={[x + wx, wy, z + d / 2 + 0.03]}><planeGeometry args={[1.1, 1.3]} /><meshStandardMaterial color="#3e5462" metalness={0.6} roughness={0.15} /></mesh>
        )))}
      <mesh position={[x, h + 0.3, z]} castShadow><boxGeometry args={[w + 0.3, 0.6, d + 0.3]} /><meshStandardMaterial color="#efe2c8" roughness={0.9} /></mesh>
      {Array.from({ length: domes }, (_, i) => -w / 3 + (i * (2 * w)) / 3 / Math.max(1, domes - 1)).map((dx) => (
        <group key={dx} position={[x + dx, h + 0.6, z + d / 2 - 2]}>
          <mesh castShadow><cylinderGeometry args={[1.5, 1.5, 1.2, 16]} /><meshStandardMaterial color={STONE} roughness={0.9} /></mesh>
          <mesh position={[0, 0.6, 0]} castShadow><sphereGeometry args={[1.5, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#efe0c2" roughness={0.8} /></mesh>
        </group>
      ))}
    </group>
  );
}

/** Campus gate: two stone piers with a terracotta-banded arch (no name, no logo). */
function Gate({ x, z }: { x: number; z: number }) {
  const sign = useMemo(() => signTexture([{ text: "بوابة ٢", size: 70, color: "#3a2a1a" }, { text: "GATE 2 · PEDESTRIANS", size: 34, color: "#3a2a1a" }], "#ecdcbd", 512, 200), []);
  return (
    <group position={[x, 0.16, z]}>
      {[-4.2, 4.2].map((dx) => (
        <group key={dx} position={[dx, 0, 0]}>
          <mesh position={[0, 2.6, 0]} castShadow receiveShadow><boxGeometry args={[1.4, 5.2, 1.4]} /><meshStandardMaterial color={STONE} roughness={0.95} /></mesh>
          {[1.2, 2.6, 4.0].map((y) => <mesh key={y} position={[0, y, 0]}><boxGeometry args={[1.46, 0.22, 1.46]} /><meshStandardMaterial color={TERRACOTTA} /></mesh>)}
          <mesh position={[0, 5.5, 0]} castShadow><coneGeometry args={[0.8, 0.8, 4]} /><meshStandardMaterial color="#e9d9b8" /></mesh>
        </group>
      ))}
      <mesh position={[0, 5.0, 0]} castShadow><boxGeometry args={[9.8, 1.1, 1.2]} /><meshStandardMaterial color={STONE} roughness={0.95} /></mesh>
      <mesh position={[0, 5.0, 0.62]}><planeGeometry args={[4.4, 0.9]} /><meshBasicMaterial map={sign} toneMapped={false} /></mesh>
      <mesh position={[0, 1.0, 0]}><torusGeometry args={[3.5, 0.18, 8, 24, Math.PI]} /><meshStandardMaterial color={TERRACOTTA} /></mesh>
    </group>
  );
}

/** Tensile shade structure over parking (as in the reference photos). */
function ShadeParking({ x, z, n }: { x: number; z: number; n: number }) {
  return (
    <group position={[x, 0, z]}>
      {Array.from({ length: n }, (_, i) => i * 6).map((dx) => (
        <group key={dx} position={[dx, 0, 0]}>
          <mesh position={[0, 1.6, -2.4]} castShadow><cylinderGeometry args={[0.08, 0.08, 3.2, 6]} /><meshStandardMaterial color="#9a9fa4" metalness={0.6} roughness={0.4} /></mesh>
          <mesh position={[0, 3.05, 0]} rotation={[0.18, 0, 0]} castShadow receiveShadow>
            <boxGeometry args={[5.8, 0.06, 5.6]} />
            <meshStandardMaterial color="#efe7d6" roughness={0.9} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Lamp({ x, z, night, side }: { x: number; z: number; night: boolean; side: 1 | -1 }) {
  return (
    <group position={[x, 0.16, z]}>
      <mesh position={[0, 4, 0]} castShadow><cylinderGeometry args={[0.07, 0.1, 8, 8]} /><meshStandardMaterial color="#c9cdd1" metalness={0.6} roughness={0.35} /></mesh>
      <mesh position={[0, 7.95, side * -0.8]}><boxGeometry args={[0.25, 0.1, 1.7]} /><meshStandardMaterial color="#c9cdd1" metalness={0.6} roughness={0.35} /></mesh>
      <mesh position={[0, 7.88, side * -1.5]}><boxGeometry args={[0.35, 0.06, 0.6]} /><meshStandardMaterial color="#fff3c4" emissive="#ffd27a" emissiveIntensity={night ? 3 : 0} /></mesh>
      {night && <pointLight position={[0, 7.5, side * -1.8]} intensity={45} distance={24} decay={1.6} color="#ffcf8a" />}
    </group>
  );
}

export function Street({ night }: { night: boolean }) {
  const asphalt = usePbr("asphalt_02", [160, 3.5], "#b9b4aa");      // sun-bleached
  const pavers = usePbr("concrete_pavement", [100, 3], "#e8ddca", false);   // pale campus pavers
  const plaza = usePbr("concrete_pavement", [40, 6], "#ece2d0", false);
  const sand = usePbr("coast_sand_01", [60, 30], "#dcc39a", false);
  const stopSign = useMemo(() => signTexture([{ text: "🚌 12", size: 80 }, { text: "Al Jurf Stop · موقف الجرف", size: 34 }], "#0e4c8a", 512, 256), []);
  const xingSign = useMemo(() => signTexture([{ text: "🚸", size: 150 }], "#f3c400", 256, 256), []);
  const dashes = useMemo(() => Array.from({ length: 30 }, (_, i) => -145 + i * 10).filter((x) => Math.abs(x) > 4), []);
  const stripes = useMemo(() => Array.from({ length: 7 }, (_, i) => -3.0 + i * 1.0), []);
  const marking = { color: "#e9e4d6", roughness: 0.75, transparent: true, opacity: 0.72 };   // faded paint

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[460, 260]} />
        <meshStandardMaterial {...sand} roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[320, 7]} />
        <meshStandardMaterial {...asphalt} roughness={0.95} />
      </mesh>
      {dashes.map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.006, 0]}><planeGeometry args={[4, 0.14]} /><meshStandardMaterial {...marking} /></mesh>
      ))}
      {[-3.3, 3.3].map((z) => (
        <mesh key={z} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, z]}><planeGeometry args={[320, 0.12]} /><meshStandardMaterial color="#d9bf62" roughness={0.8} transparent opacity={0.7} /></mesh>
      ))}
      {stripes.map((z) => (
        <mesh key={z} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, z]} receiveShadow><planeGeometry args={[4, 0.5]} /><meshStandardMaterial {...marking} opacity={0.85} /></mesh>
      ))}
      {[1, -1].map((s) => (
        <group key={s}>
          <mesh position={[0, 0.08, s * 7.3]} receiveShadow><boxGeometry args={[320, 0.16, 7.6]} /><meshStandardMaterial {...pavers} roughness={0.9} /></mesh>
          <mesh position={[0, 0.09, s * 3.55]} receiveShadow castShadow><boxGeometry args={[320, 0.18, 0.2]} /><meshStandardMaterial color="#d8d2c6" roughness={0.8} /></mesh>
          <mesh position={[0, 0.17, s * 11.9]} receiveShadow><boxGeometry args={[320, 0.04, 1.6]} /><meshStandardMaterial color="#5f9140" roughness={1} /></mesh>
        </group>
      ))}
      {[1, -1].map((s) => (
        <mesh key={s} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.17, s * 4.2]}><planeGeometry args={[4, 1]} /><meshStandardMaterial color="#d8a21d" roughness={0.9} /></mesh>
      ))}

      {/* campus (north) */}
      <Gate x={0} z={-13.5} />
      <mesh position={[-28, 0.6, -13.5]} castShadow receiveShadow><boxGeometry args={[46, 1.2, 0.4]} /><meshStandardMaterial color={STONE} roughness={0.95} /></mesh>
      <mesh position={[30, 0.6, -13.5]} castShadow receiveShadow><boxGeometry args={[42, 1.2, 0.4]} /><meshStandardMaterial color={STONE} roughness={0.95} /></mesh>
      <mesh position={[0, 0.06, -26]} receiveShadow><boxGeometry args={[150, 0.12, 24]} /><meshStandardMaterial {...plaza} roughness={0.9} /></mesh>
      <GlassHub x={14} z={-40} w={44} d={16} />
      <StoneBlock x={-34} z={-44} w={34} d={16} h={10} domes={3} />
      <StoneBlock x={58} z={-48} w={26} d={14} h={9} domes={2} />
      {[-22, -14, -6, 6, 14, 22, 30].map((x) => <YoungTree key={x} x={x} z={-20} />)}
      <ShadeParking x={-75} z={-24} n={6} />

      {/* bus stop shelter (south side) */}
      <group position={[STOP_X, 0.16, 7.6]}>
        <mesh position={[0, 2.6, 0.9]} castShadow><boxGeometry args={[5.4, 0.12, 2.3]} /><meshStandardMaterial color="#e8e9ea" metalness={0.4} roughness={0.35} /></mesh>
        {[-2.5, 2.5].map((dx) => <mesh key={dx} position={[dx, 1.3, 1.85]} castShadow><boxGeometry args={[0.1, 2.6, 0.1]} /><meshStandardMaterial color="#a8adb2" metalness={0.5} /></mesh>)}
        <mesh position={[0, 1.4, 2]}><boxGeometry args={[5, 2.1, 0.05]} /><meshStandardMaterial color="#a9d2e6" transparent opacity={0.3} roughness={0.05} /></mesh>
        <mesh position={[0, 0.5, 1.6]} castShadow><boxGeometry args={[3.2, 0.1, 0.45]} /><meshStandardMaterial color="#9a8a76" /></mesh>
        <mesh position={[-3.3, 1.5, 0]}><cylinderGeometry args={[0.05, 0.05, 3, 6]} /><meshStandardMaterial color="#888" /></mesh>
        <mesh position={[-3.3, 2.9, 0.06]}><planeGeometry args={[1.3, 0.65]} /><meshBasicMaterial map={stopSign} side={THREE.DoubleSide} toneMapped={false} /></mesh>
      </group>
      <group position={[2.8, 0.16, 4.4]}>
        <mesh position={[0, 1.3, 0]}><cylinderGeometry args={[0.04, 0.04, 2.6, 6]} /><meshStandardMaterial color="#999" /></mesh>
        <mesh position={[0, 2.6, 0.01]} rotation={[0, 0, Math.PI / 4]}><planeGeometry args={[0.75, 0.75]} /><meshBasicMaterial map={xingSign} side={THREE.DoubleSide} toneMapped={false} /></mesh>
      </group>

      {[{ x: -60, w: 24, h: 8 }, { x: -24, w: 18, h: 11 }, { x: 46, w: 22, h: 9 }, { x: 80, w: 20, h: 12 }].map((b) => (
        <mesh key={b.x} position={[b.x, b.h / 2, 30]} castShadow receiveShadow><boxGeometry args={[b.w, b.h, 12]} /><meshStandardMaterial color={SAND} roughness={0.95} /></mesh>
      ))}

      {[-70, -52, -34, -16, 16, 34, 52, 70, 88].map((x, i) => <Palm key={"pn" + x} x={x} z={-11.9} h={6 + (i % 3) * 0.8} />)}
      {[-64, -46, -28, -10, 42, 58, 76].map((x, i) => <Palm key={"ps" + x} x={x} z={11.9} h={6.2 + (i % 2) * 0.9} />)}
      {[-48, -16, 16, 48].map((x) => <Lamp key={"ln" + x} x={x} z={-4.3} night={night} side={-1} />)}
      {[-32, 9, 40, 64].map((x) => <Lamp key={"ls" + x} x={x} z={4.3} night={night} side={1} />)}

      {[{ x: -24, c: "#d9d4c7" }, { x: -17, c: "#8a1c1c" }, { x: 12, c: "#2b4c7e" }, { x: 34, c: "#f0f0f0" }, { x: 41, c: "#3a3a3a" }].map((p) => (
        <CarModel key={p.x} position={[p.x, 0.17, -5.6]} rotation={[0, Math.PI / 2, 0]} color={p.c} parked />
      ))}
      {[{ x: -48, c: "#6e7b85" }, { x: 52, c: "#c7b48b" }].map((p) => (
        <CarModel key={p.x} position={[p.x, 0.17, 9.4]} rotation={[0, 0, 0]} color={p.c} parked />
      ))}
    </group>
  );
}
