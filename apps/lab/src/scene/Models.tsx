// Simple low-poly vehicle models. All models face +x (direction of travel) and sit on y = 0.
import { forwardRef, useMemo, type ReactNode } from "react";
import * as THREE from "three";
import type { GroupProps } from "@react-three/fiber";
import { signTexture } from "./textures";

const Wheel = ({ x, r, w = 0.08, y, z = 0 }: { x: number; r: number; w?: number; y?: number; z?: number }) => (
  // name/userData let VehicleView spin every wheel at v / r
  <group position={[x, y ?? r, z]} name="wheel" userData={{ r }}>
    <mesh castShadow><torusGeometry args={[r * 0.8, r * 0.22, 8, 20]} /><meshStandardMaterial color="#1b1b1b" roughness={0.85} /></mesh>
    <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[r * 0.6, r * 0.6, w, 14]} /><meshStandardMaterial color="#9aa0a6" metalness={0.6} roughness={0.4} /></mesh>
    <mesh><boxGeometry args={[r * 1.2, r * 0.09, w * 1.1]} /><meshStandardMaterial color="#2a2d31" metalness={0.4} /></mesh>
    <mesh rotation={[0, 0, Math.PI / 2]}><boxGeometry args={[r * 1.2, r * 0.09, w * 1.1]} /><meshStandardMaterial color="#2a2d31" metalness={0.4} /></mesh>
  </group>
);

function Rider({ x = 0, y = 0.9, lean = 0.3, shirt = "#2d6cdf", helmet = "#f2f2f2", standing = false }: { x?: number; y?: number; lean?: number; shirt?: string; helmet?: string; standing?: boolean }) {
  return (
    <group position={[x, y, 0]}>
      {/* legs */}
      <mesh position={[standing ? 0 : 0.12, standing ? 0.0 : -0.1, 0]} rotation={[0, 0, standing ? 0 : 0.9]} castShadow>
        <boxGeometry args={[0.18, standing ? 0.85 : 0.6, 0.32]} />
        <meshStandardMaterial color="#2a2f3a" />
      </mesh>
      {/* torso */}
      <mesh position={[0.05, standing ? 0.75 : 0.42, 0]} rotation={[0, 0, -lean]} castShadow>
        <boxGeometry args={[0.28, 0.62, 0.4]} />
        <meshStandardMaterial color={shirt} roughness={0.85} />
      </mesh>
      {/* arms */}
      <mesh position={[0.28, standing ? 0.85 : 0.5, 0]} rotation={[0, 0, -1.0]} castShadow>
        <boxGeometry args={[0.1, 0.5, 0.46]} />
        <meshStandardMaterial color={shirt} />
      </mesh>
      {/* head + helmet */}
      <mesh position={[0.16, standing ? 1.2 : 0.86, 0]} castShadow>
        <sphereGeometry args={[0.15, 10, 8]} />
        <meshStandardMaterial color="#b07b55" />
      </mesh>
      <mesh position={[0.16, standing ? 1.25 : 0.92, 0]} castShadow>
        <sphereGeometry args={[0.17, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={helmet} roughness={0.4} />
      </mesh>
    </group>
  );
}

function Lights({ front, back, y, night, width = 0 }: { front: number; back: number; y: number; night: boolean; width?: number }) {
  return (
    <>
      {(width ? [-width, width] : [0]).map((z) => (
        <mesh key={"f" + z} position={[front, y, z]}>
          <sphereGeometry args={[0.07, 8, 6]} />
          <meshStandardMaterial color="#fffbe8" emissive="#fff3c0" emissiveIntensity={night ? 4 : 0.4} />
        </mesh>
      ))}
      {(width ? [-width, width] : [0]).map((z) => (
        <mesh key={"b" + z} position={[back, y, z]}>
          <sphereGeometry args={[0.05, 8, 6]} />
          <meshStandardMaterial color="#ff3b30" emissive="#ff2a1a" emissiveIntensity={night ? 3 : 0.6} />
        </mesh>
      ))}
    </>
  );
}

export function EBikeModel({ color = "#e8432e", night = false }: { color?: string; night?: boolean }) {
  return (
    <group>
      <Wheel x={-0.55} r={0.34} /><Wheel x={0.55} r={0.34} />
      <mesh position={[0, 0.62, 0]} rotation={[0, 0, 0.35]} castShadow><boxGeometry args={[1.0, 0.07, 0.07]} /><meshStandardMaterial color={color} metalness={0.4} roughness={0.4} /></mesh>
      <mesh position={[0.05, 0.5, 0]} castShadow><boxGeometry args={[0.38, 0.22, 0.12]} /><meshStandardMaterial color="#222" /></mesh>
      <mesh position={[0.5, 0.85, 0]}><boxGeometry args={[0.05, 0.5, 0.05]} /><meshStandardMaterial color="#333" /></mesh>
      <mesh position={[0.5, 1.08, 0]}><boxGeometry args={[0.05, 0.05, 0.6]} /><meshStandardMaterial color="#222" /></mesh>
      {/* delivery box */}
      <mesh position={[-0.55, 1.05, 0]} castShadow><boxGeometry args={[0.45, 0.45, 0.45]} /><meshStandardMaterial color={color} roughness={0.7} /></mesh>
      <Rider x={-0.1} y={0.82} shirt={color} />
      <Lights front={0.6} back={-0.8} y={0.9} night={night} />
    </group>
  );
}

export function EScooterModel({ night = false }: { night?: boolean }) {
  return (
    <group>
      <Wheel x={-0.45} r={0.13} /><Wheel x={0.45} r={0.13} />
      <mesh position={[0, 0.17, 0]} castShadow><boxGeometry args={[0.9, 0.06, 0.18]} /><meshStandardMaterial color="#1f2937" /></mesh>
      <mesh position={[0.45, 0.62, 0]} rotation={[0, 0, -0.08]} castShadow><boxGeometry args={[0.05, 0.95, 0.05]} /><meshStandardMaterial color="#9ca3af" metalness={0.6} /></mesh>
      <mesh position={[0.48, 1.08, 0]}><boxGeometry args={[0.04, 0.04, 0.5]} /><meshStandardMaterial color="#111" /></mesh>
      <Rider x={0.05} y={0.25} lean={0.05} shirt="#16a34a" helmet="#111827" standing />
      <Lights front={0.5} back={-0.48} y={0.95} night={night} />
    </group>
  );
}

export function MotorcycleModel({ night = false }: { night?: boolean }) {
  return (
    <group>
      <Wheel x={-0.7} r={0.33} w={0.14} /><Wheel x={0.72} r={0.33} w={0.14} />
      <mesh position={[0, 0.62, 0]} castShadow><boxGeometry args={[1.1, 0.35, 0.32]} /><meshStandardMaterial color="#1e3a8a" metalness={0.5} roughness={0.35} /></mesh>
      <mesh position={[0.15, 0.85, 0]} castShadow><boxGeometry args={[0.5, 0.2, 0.36]} /><meshStandardMaterial color="#1e40af" metalness={0.5} roughness={0.3} /></mesh>
      <mesh position={[-0.3, 0.38, 0.2]} rotation={[0, 0, 0.2]}><cylinderGeometry args={[0.05, 0.05, 0.8, 6]} /><meshStandardMaterial color="#b0b0b0" metalness={0.8} /></mesh>
      <Rider x={-0.15} y={0.82} shirt="#3f3f46" helmet="#dc2626" />
      <Lights front={0.85} back={-0.85} y={0.9} night={night} />
    </group>
  );
}

export function TukTukModel({ color = "#2fa84f", night = false }: { color?: string; night?: boolean }) {
  return (
    <group>
      <Wheel x={1.0} r={0.24} y={0.24} /><Wheel x={-0.6} r={0.24} z={-0.55} /><Wheel x={-0.6} r={0.24} z={0.55} />
      <mesh position={[0, 0.55, 0]} castShadow><boxGeometry args={[2.3, 0.5, 1.25]} /><meshStandardMaterial color={color} roughness={0.6} /></mesh>
      <mesh position={[-0.1, 1.75, 0]} castShadow><boxGeometry args={[2.1, 0.1, 1.35]} /><meshStandardMaterial color="#111" /></mesh>
      {[[-1.05, -0.6], [-1.05, 0.6], [0.85, -0.6], [0.85, 0.6]].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, 1.25, z]}><boxGeometry args={[0.06, 1.0, 0.06]} /><meshStandardMaterial color="#222" /></mesh>
      ))}
      <mesh position={[0.95, 1.2, 0]}><boxGeometry args={[0.04, 0.8, 1.15]} /><meshStandardMaterial color="#9fc7dd" transparent opacity={0.4} /></mesh>
      <Rider x={0.45} y={0.8} lean={0.05} shirt="#f59e0b" helmet="#2a2a2a" />
      <Lights front={1.16} back={-1.16} y={0.7} night={night} width={0.45} />
    </group>
  );
}

export const CarModel = forwardRef<THREE.Group, GroupProps & { color?: string; parked?: boolean; night?: boolean }>(
  function CarModel({ color = "#d9d4c7", parked = false, night = false, ...rest }, ref) {
    return (
      <group ref={ref} {...rest}>
        {[[-1.35, -0.78], [-1.35, 0.78], [1.35, -0.78], [1.35, 0.78]].map(([x, z]) => <Wheel key={`${x}${z}`} x={x} r={0.33} w={0.22} z={z} />)}
        <mesh position={[0, 0.65, 0]} castShadow receiveShadow><boxGeometry args={[4.4, 0.7, 1.8]} /><meshStandardMaterial color={color} metalness={0.35} roughness={0.45} /></mesh>
        <mesh position={[-0.25, 1.22, 0]} castShadow><boxGeometry args={[2.3, 0.55, 1.62]} /><meshStandardMaterial color={color} metalness={0.35} roughness={0.45} /></mesh>
        <mesh position={[-0.25, 1.22, 0]}><boxGeometry args={[2.32, 0.42, 1.64]} /><meshStandardMaterial color="#26323b" roughness={0.15} metalness={0.4} /></mesh>
        {!parked && <Lights front={2.21} back={-2.21} y={0.75} night={night} width={0.65} />}
      </group>
    );
  },
);

export function BusModel({ route = "12", night = false }: { route?: string; night?: boolean }) {
  const sign = useMemo(() => signTexture([{ text: `${route}  Al Jurf · الجرف`, size: 64, color: "#ffb300" }], "#111", 512, 96), [route]);
  const windows: ReactNode[] = [];
  for (let i = 0; i < 6; i++) windows.push(
    <mesh key={i} position={[-4.5 + i * 1.75, 1.95, 1.27]}><planeGeometry args={[1.5, 1.0]} /><meshStandardMaterial color="#233441" roughness={0.1} metalness={0.5} emissive="#fff1c9" emissiveIntensity={night ? 0.25 : 0} /></mesh>,
  );
  return (
    <group>
      {[[-3.8, -1.05], [-3.8, 1.05], [3.6, -1.05], [3.6, 1.05]].map(([x, z]) => <Wheel key={`${x}${z}`} x={x} r={0.5} w={0.3} z={z} />)}
      <mesh position={[0, 1.65, 0]} castShadow receiveShadow><boxGeometry args={[12, 2.9, 2.5]} /><meshStandardMaterial color="#f1f1ee" roughness={0.5} metalness={0.2} /></mesh>
      <mesh position={[0, 0.55, 0]}><boxGeometry args={[12.02, 0.5, 2.52]} /><meshStandardMaterial color="#c8102e" /></mesh>
      <mesh position={[0, 3.15, 0]}><boxGeometry args={[11.5, 0.15, 2.3]} /><meshStandardMaterial color="#d1d5db" /></mesh>
      {windows}
      {/* windscreen + destination sign */}
      <mesh position={[6.01, 1.9, 0]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[2.3, 1.6]} /><meshStandardMaterial color="#1f2d38" roughness={0.1} metalness={0.4} /></mesh>
      <mesh position={[6.02, 2.95, 0]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[2.1, 0.38]} /><meshBasicMaterial map={sign} toneMapped={false} /></mesh>
      {/* front door (kerb side = +z) */}
      <mesh position={[5.0, 1.45, 1.26]}><planeGeometry args={[1.1, 2.3]} /><meshStandardMaterial color="#2c3e4c" roughness={0.2} side={THREE.DoubleSide} /></mesh>
      <Lights front={6.02} back={-6.02} y={0.9} night={night} width={0.95} />
    </group>
  );
}
