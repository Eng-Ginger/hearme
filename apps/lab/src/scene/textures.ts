// Canvas-generated textures (no image files, no network font loading).
import * as THREE from "three";

const cache = new Map<string, THREE.Texture>();

export function signTexture(lines: { text: string; size: number; color?: string; font?: string }[], bg: string, w = 512, h = 256): THREE.Texture {
  const key = JSON.stringify([lines, bg, w, h]);
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.textAlign = "center"; g.textBaseline = "middle";
  const total = lines.reduce((a, l) => a + l.size * 1.25, 0);
  let y = h / 2 - total / 2;
  for (const l of lines) {
    y += (l.size * 1.25) / 2;
    g.fillStyle = l.color ?? "#fff";
    g.font = `${l.font ?? "bold"} ${l.size}px "Segoe UI", "Noto Sans Arabic", Tahoma, Arial, sans-serif`;
    g.fillText(l.text, w / 2, y);
    y += (l.size * 1.25) / 2;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

/** Subtle noisy asphalt / sand texture. */
export function noiseTexture(base: string, amp: number, size = 256, repeat = 8): THREE.Texture {
  const key = `n:${base}:${amp}:${size}:${repeat}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * amp;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}
