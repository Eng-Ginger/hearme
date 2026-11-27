// Low-poly Ajman-style neighbourhood street: two-lane road, unsignalised zebra crossing,
// parked cars, bus stop, school gate, villas with boundary walls, palms, a minaret.
import { useMemo } from "react";
import * as THREE from "three";
import { noiseTexture, signTexture } from "./textures";
import { STOP_X } from "../sim/scenarios";
import { CarModel } from "./Models";

const SAND = "#d8c09a", WALL = "#e9dcc3", PAVER = "#c9b79a", KERB = "#e8e2d6";

function Palm({ x, z, h = 6, s = 1 }: { x: number; z: number; h?: number; s?: number }) {
  const leaves = useMemo(() => Array.from({ length: 9 }, (_, i) => (i / 9) * Math.PI * 2 + (x * 0.37) % 1), [x]);
  return (
    <group position={[x, 0, z]} scale={s}>
      <mesh position={[0, h / 2, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.26, h, 7]} />
        <meshStandardMaterial color="#8b6a45" roughness={1} />
      </mesh>
      {leaves.map((a, i) => (
        <mesh key={i} position={[Math.cos(a) * 1.25, h - 0.35, Math.sin(a) * 1.25]} rotation={[0, -a, -0.55]} castShadow>
          <boxGeometry args={[2.7, 0.05, 0.55]} />
          <meshStandardMaterial color={i % 2 ? "#3f7a35" : "#4f8c3c"} roughness={0.9} />
        </mesh>
      ))}
      <mesh position={[0, h - 0.1, 0]}>
        <sphereGeometry args={[0.38, 8, 6]} />
        <meshStandardMaterial color="#6d5233" />
      </mesh>
    </group>
  );
}

function Villa({ x, z, w, d, h, color, north }: { x: number; z: number; w: number; d: number; h: number; color: string; north: boolean }) {
  const wallZ = north ? z + d / 2 + 2.2 : z - d / 2 - 2.2;
  return (
    <group>
      <mesh position={[x, h / 2, z]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={color} roughness={0.95} />
      </mesh>
      {/* parapet + window bands */}
      <mesh position={[x, h + 0.25, z]} castShadow>
        <boxGeometry args={[w + 0.2, 0.5, d + 0.2]} />
        <meshStandardMaterial color="#f1e7d3" roughness={0.9} />
      </mesh>
      {[0.3, 0.7].map((f) => (
        <mesh key={f} position={[x - w / 2 + w * f, h * 0.62, north ? z + d / 2 + 0.01 : z - d / 2 - 0.01]}>
          <planeGeometry args={[1.4, 1.2]} />
          <meshStandardMaterial color="#5d7a8c" roughness={0.3} metalness={0.2} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* boundary wall along the street */}
      <mesh position={[x, 1.1, wallZ]} castShadow receiveShadow>
        <boxGeometry args={[w + 3, 2.2, 0.3]} />
        <meshStandardMaterial color={WALL} roughness={1} />
      </mesh>
    </group>
  );
}

function Lamp({ x, z, night, side }: { x: number; z: number; night: boolean; side: 1 | -1 }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 3.5, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.09, 7, 6]} />
        <meshStandardMaterial color="#6b6f75" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, 7, side * -0.7]}>
        <boxGeometry args={[0.3, 0.12, 1.5]} />
        <meshStandardMaterial color="#555" />
      </mesh>
      <mesh position={[0, 6.92, side * -1.3]}>
        <boxGeometry args={[0.35, 0.05, 0.5]} />
        <meshStandardMaterial color="#fff3c4" emissive="#ffd27a" emissiveIntensity={night ? 3 : 0} />
      </mesh>
      {night && <pointLight position={[0, 6.6, side * -1.6]} intensity={40} distance={22} decay={1.6} color="#ffcf8a" />}
    </group>
  );
}

export function Street({ night }: { night: boolean }) {
  const asphalt = useMemo(() => noiseTexture("#3d3f43", 26, 256, 40), []);
  const sand = useMemo(() => noiseTexture(SAND, 22, 256, 30), []);
  const pavers = useMemo(() => noiseTexture(PAVER, 18, 128, 60), []);
  const schoolSign = useMemo(() => signTexture([
    { text: "مدرسة النعيمية", size: 58 }, { text: "AL NUAIMIYA SCHOOL", size: 40 },
  ], "#1d5c3a"), []);
  const stopSign = useMemo(() => signTexture([{ text: "🚌 12", size: 80 }, { text: "Al Jurf Stop · موقف الجرف", size: 34 }], "#0e4c8a", 512, 256), []);
  const shopSign = useMemo(() => signTexture([{ text: "بقالة الخير", size: 70 }, { text: "AL KHAIR GROCERY", size: 36 }], "#a2261d"), []);
  const xingSign = useMemo(() => signTexture([{ text: "🚸", size: 150 }], "#f3c400", 256, 256), []);

  const dashes = useMemo(() => Array.from({ length: 30 }, (_, i) => -145 + i * 10).filter((x) => Math.abs(x) > 4), []);
  const stripes = useMemo(() => Array.from({ length: 7 }, (_, i) => -3.0 + i * 1.0), []);

  const villasN = [
    { x: -40, w: 14, h: 7, c: "#e7d5b5" }, { x: -24, w: 12, h: 9, c: "#efe2c9" }, { x: 26, w: 16, h: 7.5, c: "#e3cfae" },
    { x: 44, w: 12, h: 9.5, c: "#f0e6d2" }, { x: 62, w: 14, h: 7, c: "#e2cba7" }, { x: -60, w: 14, h: 8, c: "#eadcc2" },
  ];
  const villasS = [
    { x: -36, w: 14, h: 8, c: "#efe1c6" }, { x: -18, w: 10, h: 7, c: "#e5d1ad" }, { x: 40, w: 14, h: 9, c: "#e9d8bb" },
    { x: 58, w: 12, h: 7.5, c: "#f1e5cf" }, { x: -56, w: 14, h: 9, c: "#e3cca8" }, { x: 76, w: 14, h: 8, c: "#ecdcc0" },
  ];

  return (
    <group>
      {/* ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[420, 220]} />
        <meshStandardMaterial map={sand} roughness={1} />
      </mesh>
      {/* road */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[320, 7]} />
        <meshStandardMaterial map={asphalt} roughness={0.92} />
      </mesh>
      {/* lane dashes + edge lines */}
      {dashes.map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.006, 0]}>
          <planeGeometry args={[4, 0.14]} />
          <meshStandardMaterial color="#e9e6dc" roughness={0.7} />
        </mesh>
      ))}
      {[-3.3, 3.3].map((z) => (
        <mesh key={z} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, z]}>
          <planeGeometry args={[320, 0.12]} />
          <meshStandardMaterial color="#e3c651" roughness={0.7} />
        </mesh>
      ))}
      {/* zebra crossing (no signals) */}
      {stripes.map((z) => (
        <mesh key={z} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, z]} receiveShadow>
          <planeGeometry args={[4, 0.5]} />
          <meshStandardMaterial color="#f4f2ec" roughness={0.6} />
        </mesh>
      ))}
      {/* sidewalks + kerbs */}
      {[1, -1].map((s) => (
        <group key={s}>
          <mesh position={[0, 0.08, s * 6.25]} receiveShadow>
            <boxGeometry args={[320, 0.16, 5.5]} />
            <meshStandardMaterial map={pavers} roughness={0.95} />
          </mesh>
          <mesh position={[0, 0.09, s * 3.55]} receiveShadow castShadow>
            <boxGeometry args={[320, 0.18, 0.2]} />
            <meshStandardMaterial color={KERB} roughness={0.8} />
          </mesh>
        </group>
      ))}
      {/* tactile paving at the crossing */}
      {[1, -1].map((s) => (
        <mesh key={s} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.17, s * 4.2]}>
          <planeGeometry args={[4, 1]} />
          <meshStandardMaterial color="#d8a21d" roughness={0.9} />
        </mesh>
      ))}

      {villasN.map((v) => <Villa key={"n" + v.x} x={v.x} z={-19} w={v.w} d={11} h={v.h} color={v.c} north />)}
      {villasS.map((v) => <Villa key={"s" + v.x} x={v.x} z={19} w={v.w} d={11} h={v.h} color={v.c} north={false} />)}

      {/* school (north side, behind the crossing) */}
      <group>
        <mesh position={[-6, 4.5, -22]} castShadow receiveShadow>
          <boxGeometry args={[26, 9, 12]} />
          <meshStandardMaterial color="#f3ead8" roughness={0.95} />
        </mesh>
        {[-14, -9, -4, 1].map((x) => (
          <mesh key={x} position={[x, 5, -15.98]}>
            <planeGeometry args={[3, 2]} />
            <meshStandardMaterial color="#5d8095" roughness={0.3} />
          </mesh>
        ))}
        <mesh position={[-6, 1.2, -9.5]} castShadow receiveShadow>
          <boxGeometry args={[34, 2.4, 0.35]} />
          <meshStandardMaterial color="#e4d6bc" />
        </mesh>
        {/* gate */}
        {[-3.6, 3.6].map((dx) => (
          <mesh key={dx} position={[dx, 1.9, -9.5]} castShadow>
            <boxGeometry args={[0.7, 3.8, 0.7]} />
            <meshStandardMaterial color="#cdb894" />
          </mesh>
        ))}
        <mesh position={[0, 3.6, -9.45]} castShadow>
          <boxGeometry args={[8.2, 1.4, 0.4]} />
          <meshStandardMaterial color="#1d5c3a" />
        </mesh>
        <mesh position={[0, 3.6, -9.24]}>
          <planeGeometry args={[7.8, 1.3]} />
          <meshBasicMaterial map={schoolSign} toneMapped={false} />
        </mesh>
      </group>

      {/* school crossing sign */}
      <group position={[2.8, 0, 4.4]}>
        <mesh position={[0, 1.3, 0]}><cylinderGeometry args={[0.04, 0.04, 2.6, 6]} /><meshStandardMaterial color="#888" /></mesh>
        <mesh position={[0, 2.6, 0.01]} rotation={[0, 0, Math.PI / 4]}>
          <planeGeometry args={[0.75, 0.75]} /><meshBasicMaterial map={xingSign} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      </group>

      {/* bus stop shelter */}
      <group position={[STOP_X, 0, 6.7]}>
        <mesh position={[0, 2.5, 0.9]} castShadow>
          <boxGeometry args={[5, 0.12, 2.2]} />
          <meshStandardMaterial color="#d6d9dc" metalness={0.4} roughness={0.4} />
        </mesh>
        {[-2.4, 2.4].map((dx) => (
          <mesh key={dx} position={[dx, 1.25, 1.8]} castShadow>
            <boxGeometry args={[0.1, 2.5, 0.1]} /><meshStandardMaterial color="#9aa0a6" metalness={0.5} />
          </mesh>
        ))}
        <mesh position={[0, 1.4, 1.95]}>
          <boxGeometry args={[4.8, 2.0, 0.05]} />
          <meshStandardMaterial color="#9fc7dd" transparent opacity={0.35} roughness={0.1} />
        </mesh>
        <mesh position={[0, 0.5, 1.6]} castShadow>
          <boxGeometry args={[3, 0.1, 0.45]} /><meshStandardMaterial color="#7d6a55" />
        </mesh>
        <mesh position={[-3.2, 1.5, 0]}><cylinderGeometry args={[0.05, 0.05, 3, 6]} /><meshStandardMaterial color="#888" /></mesh>
        <mesh position={[-3.2, 2.9, 0.06]}>
          <planeGeometry args={[1.3, 0.65]} /><meshBasicMaterial map={stopSign} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      </group>

      {/* corner grocery */}
      <group position={[-30, 0, 12.5]}>
        <mesh position={[0, 2, 0]} castShadow receiveShadow><boxGeometry args={[10, 4, 6]} /><meshStandardMaterial color="#efe6d6" /></mesh>
        <mesh position={[0, 3.3, -3.02]}><planeGeometry args={[7, 1.4]} /><meshBasicMaterial map={shopSign} toneMapped={false} /></mesh>
        <mesh position={[0, 1.2, -3.02]}><planeGeometry args={[6, 2.2]} /><meshStandardMaterial color="#38505e" roughness={0.2} /></mesh>
      </group>

      {/* minaret in the distance */}
      <group position={[70, 0, -48]}>
        <mesh position={[0, 11, 0]} castShadow><cylinderGeometry args={[1.1, 1.4, 22, 10]} /><meshStandardMaterial color="#f4ecdc" /></mesh>
        <mesh position={[0, 22.6, 0]}><cylinderGeometry args={[1.7, 1.7, 0.6, 12]} /><meshStandardMaterial color="#e7dcc6" /></mesh>
        <mesh position={[0, 25, 0]}><coneGeometry args={[1.0, 4, 10]} /><meshStandardMaterial color="#c9a95e" metalness={0.3} roughness={0.5} /></mesh>
        <mesh position={[-9, 5, 6]} castShadow><boxGeometry args={[14, 10, 14]} /><meshStandardMaterial color="#f4ecdc" /></mesh>
        <mesh position={[-9, 10.5, 6]}><sphereGeometry args={[4.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#e8dfcc" /></mesh>
      </group>

      {/* palms along both sidewalks */}
      {[-70, -50, -32, -12, 10, 30, 48, 68, 88].map((x, i) => <Palm key={"pn" + x} x={x} z={-7.6} h={5.5 + (i % 3) * 0.8} />)}
      {[-62, -44, -22, 32, 52, 72].map((x, i) => <Palm key={"ps" + x} x={x} z={7.8} h={5.8 + (i % 2) * 0.9} />)}

      {/* street lamps */}
      {[-48, -16, 16, 48].map((x) => <Lamp key={"ln" + x} x={x} z={-4.3} night={night} side={-1} />)}
      {[-32, 9, 34, 64].map((x) => <Lamp key={"ls" + x} x={x} z={4.3} night={night} side={1} />)}

      {/* parked cars along the north kerb (outside the travel lane) and in villa driveways */}
      {[{ x: -22, c: "#d9d4c7" }, { x: -15, c: "#8a1c1c" }, { x: 12, c: "#2b4c7e" }, { x: 34, c: "#f0f0f0" }, { x: 41, c: "#3a3a3a" }].map((p) => (
        <CarModel key={p.x} position={[p.x, 0.17, -5.6]} rotation={[0, Math.PI / 2, 0]} color={p.c} parked />
      ))}
      {[{ x: -42, c: "#6e7b85" }, { x: 46, c: "#c7b48b" }].map((p) => (
        <CarModel key={p.x} position={[p.x, 0.17, 10.8]} rotation={[0, 0, 0]} color={p.c} parked />
      ))}
    </group>
  );
}
