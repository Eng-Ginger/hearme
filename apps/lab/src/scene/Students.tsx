// Students walking along the wide campus sidewalks: simple procedural walk cycle
// (legs and arms swing, body bobs). Built from primitives (no external assets).
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const OUTFITS = [
  { top: "#f4f4f2", legs: "#f4f4f2", head: "#f4f4f2" },   // kandura + ghutra
  { top: "#141414", legs: "#141414", head: "#141414" },   // abaya + shayla
  { top: "#2f6fb0", legs: "#2b2f3a", head: "#5a3b26" },   // casual
  { top: "#c0503a", legs: "#3b3b3b", head: "#2a1d14" },
  { top: "#141414", legs: "#141414", head: "#3d2f6b" },
  { top: "#e9e1cf", legs: "#5a5146", head: "#2a1d14" },
];

function Walker({ i }: { i: number }) {
  const g = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null), legR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null), armR = useRef<THREE.Group>(null);
  const cfg = useMemo(() => {
    const north = i % 2 === 0;
    return {
      z: north ? -7.2 - (i % 3) * 0.9 : 8.4 + (i % 3) * 0.8,       // north sidewalk, or south one behind the viewer
      dir: (i % 4 < 2 ? 1 : -1) as 1 | -1,
      speed: 1.15 + (i % 5) * 0.08,
      x0: -90 + ((i * 37) % 180),
      o: OUTFITS[i % OUTFITS.length],
      bag: i % 3 !== 1,
    };
  }, [i]);
  const pos = useRef(cfg.x0);
  useFrame(({ clock }, dt) => {
    pos.current += cfg.dir * cfg.speed * Math.min(dt, 0.1);
    if (pos.current > 95) pos.current = -95; else if (pos.current < -95) pos.current = 95;
    const ph = clock.elapsedTime * cfg.speed * 5.2 + i;
    const swing = Math.sin(ph) * 0.5;
    if (g.current) { g.current.position.set(pos.current, 0.16 + Math.abs(Math.cos(ph)) * 0.035, cfg.z); g.current.rotation.y = cfg.dir === 1 ? Math.PI / 2 : -Math.PI / 2; }
    if (legL.current) legL.current.rotation.x = swing;
    if (legR.current) legR.current.rotation.x = -swing;
    if (armL.current) armL.current.rotation.x = -swing * 0.7;
    if (armR.current) armR.current.rotation.x = swing * 0.7;
  });
  const { o } = cfg;
  return (
    <group ref={g}>
      {[[-0.1, legL], [0.1, legR]].map(([x, r]) => (
        <group key={x as number} ref={r as React.RefObject<THREE.Group>} position={[x as number, 0.9, 0]}>
          <mesh position={[0, -0.45, 0]} castShadow><boxGeometry args={[0.14, 0.9, 0.16]} /><meshStandardMaterial color={o.legs} roughness={0.9} /></mesh>
        </group>
      ))}
      <mesh position={[0, 1.22, 0]} castShadow><boxGeometry args={[0.42, 0.68, 0.24]} /><meshStandardMaterial color={o.top} roughness={0.9} /></mesh>
      {[[-0.27, armL], [0.27, armR]].map(([x, r]) => (
        <group key={x as number} ref={r as React.RefObject<THREE.Group>} position={[x as number, 1.5, 0]}>
          <mesh position={[0, -0.3, 0]} castShadow><boxGeometry args={[0.1, 0.6, 0.12]} /><meshStandardMaterial color={o.top} roughness={0.9} /></mesh>
        </group>
      ))}
      <mesh position={[0, 1.72, 0]} castShadow><sphereGeometry args={[0.13, 12, 10]} /><meshStandardMaterial color="#b07b55" /></mesh>
      <mesh position={[0, 1.78, -0.01]}><sphereGeometry args={[0.145, 12, 10, 0, Math.PI * 2, 0, Math.PI / 1.7]} /><meshStandardMaterial color={o.head} roughness={0.9} /></mesh>
      {cfg.bag && <mesh position={[0, 1.25, -0.2]} castShadow><boxGeometry args={[0.32, 0.4, 0.14]} /><meshStandardMaterial color="#3b4a5a" roughness={0.8} /></mesh>}
    </group>
  );
}

export function Students({ count }: { count: number }) {
  return <>{Array.from({ length: count }, (_, i) => <Walker key={i} i={i} />)}</>;
}
