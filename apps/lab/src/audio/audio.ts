// Procedural 3D audio for the HearMe Lab (Web Audio API, HRTF panning).
// Every sound is synthesised at runtime: no audio files are shipped (see ATTRIBUTION.md).
// Parameter changes use setTargetAtTime so there are no zipper noises or clicks.
import type { VType } from "../sim/scenarios";

const TC = 0.04; // smoothing time constant for AudioParams (s)

export interface VoiceUpdate { x: number; y: number; z: number; speed: number; braking: boolean; avas: boolean }

function smooth(p: AudioParam, v: number, ctx: BaseAudioContext, tc = TC) {
  p.setTargetAtTime(v, ctx.currentTime, tc);
}

function makePanner(ctx: AudioContext): PannerNode {
  return new PannerNode(ctx, {
    panningModel: "HRTF", distanceModel: "inverse", refDistance: 2, rolloffFactor: 1.15,
    maxDistance: 400, coneInnerAngle: 360, coneOuterAngle: 360,
  });
}

class Voice {
  readonly out: GainNode;
  readonly panner: PannerNode;
  private nodes: AudioScheduledSourceNode[] = [];
  private engineOsc: OscillatorNode[] = [];
  private engineGain: GainNode | null = null;
  private tyreGain: GainNode;
  private tyreFilter: BiquadFilterNode;
  private avasGain: GainNode;
  private avasOsc: OscillatorNode[] = [];
  private hissGain: GainNode | null = null;
  private whineOsc: OscillatorNode | null = null;
  private whineGain: GainNode | null = null;

  constructor(private ctx: AudioContext, readonly type: VType, noise: AudioBuffer, dest: AudioNode) {
    this.panner = makePanner(ctx);
    this.out = new GainNode(ctx, { gain: 0 });
    this.out.connect(this.panner).connect(dest);
    smooth(this.out.gain, 1, ctx, 0.3); // fade in on spawn

    // tyre / rolling noise (all vehicles)
    const tyreSrc = new AudioBufferSourceNode(ctx, { buffer: noise, loop: true, loopStart: Math.random() * 2 });
    this.tyreFilter = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 900, Q: 0.8 });
    this.tyreGain = new GainNode(ctx, { gain: 0 });
    tyreSrc.connect(this.tyreFilter).connect(this.tyreGain).connect(this.out);
    tyreSrc.start(ctx.currentTime, Math.random() * 3);
    this.nodes.push(tyreSrc);

    // combustion engines
    if (type === "motorcycle" || type === "car" || type === "bus") {
      const shaper = new WaveShaperNode(ctx, { curve: Voice.drive(type === "motorcycle" ? 6 : 3), oversample: "2x" });
      const lp = new BiquadFilterNode(ctx, { type: "lowpass", frequency: type === "motorcycle" ? 1400 : type === "bus" ? 380 : 650, Q: 0.9 });
      this.engineGain = new GainNode(ctx, { gain: 0 });
      const mix = new GainNode(ctx, { gain: 0.5 });
      const harmonics = type === "motorcycle" ? [1, 2.01, 0.5] : type === "bus" ? [1, 1.5, 2.02] : [1, 2, 3.01];
      for (const [i, m] of harmonics.entries()) {
        const o = new OscillatorNode(ctx, { type: i === 0 ? "sawtooth" : "square", frequency: 40 * m });
        const g = new GainNode(ctx, { gain: i === 0 ? 0.6 : 0.18 });
        o.connect(g).connect(mix);
        o.start();
        this.engineOsc.push(o);
        this.nodes.push(o);
        (o as OscillatorNode & { mult?: number }).mult = m;
      }
      mix.connect(shaper).connect(lp).connect(this.engineGain).connect(this.out);
      if (type === "bus") {
        const hissSrc = new AudioBufferSourceNode(ctx, { buffer: noise, loop: true });
        const hp = new BiquadFilterNode(ctx, { type: "highpass", frequency: 3500 });
        this.hissGain = new GainNode(ctx, { gain: 0 });
        hissSrc.connect(hp).connect(this.hissGain).connect(this.out);
        hissSrc.start();
        this.nodes.push(hissSrc);
      }
    }
    // faint electric motor whine (e-scooter, tuk-tuk)
    if (type === "e_scooter" || type === "tuk_tuk") {
      this.whineOsc = new OscillatorNode(ctx, { type: "sine", frequency: 700 });
      this.whineGain = new GainNode(ctx, { gain: 0 });
      this.whineOsc.connect(this.whineGain).connect(this.out);
      this.whineOsc.start();
      this.nodes.push(this.whineOsc);
    }
    // AVAS-style hum (comparison mode): two detuned tones + 6 Hz tremolo, pitch follows speed
    this.avasGain = new GainNode(ctx, { gain: 0 });
    const trem = new GainNode(ctx, { gain: 0.75 });
    const lfo = new OscillatorNode(ctx, { frequency: 6 });
    const lfoDepth = new GainNode(ctx, { gain: 0.25 });
    lfo.connect(lfoDepth).connect(trem.gain);
    lfo.start();
    this.nodes.push(lfo);
    for (const f of [380, 571]) {
      const o = new OscillatorNode(ctx, { type: "triangle", frequency: f });
      o.connect(trem);
      o.start();
      this.avasOsc.push(o);
      this.nodes.push(o);
    }
    trem.connect(this.avasGain).connect(this.out);
  }

  private static drive(k: number): Float32Array {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
    return c;
  }

  update(u: VoiceUpdate) {
    const ctx = this.ctx, now = ctx.currentTime;
    this.panner.positionX.setTargetAtTime(u.x, now, 0.02);
    this.panner.positionY.setTargetAtTime(u.y, now, 0.02);
    this.panner.positionZ.setTargetAtTime(u.z, now, 0.02);
    const sp = Math.max(0, u.speed);
    // Tyre noise: very quiet for two-wheelers (the whole point), louder for cars/buses.
    const tyreBase = this.type === "e_bike" || this.type === "e_scooter" ? 0.012 : this.type === "tuk_tuk" ? 0.03 : this.type === "motorcycle" ? 0.05 : 0.12;
    smooth(this.tyreGain.gain, tyreBase * Math.min(1.5, (sp / 7) ** 1.5), ctx);
    smooth(this.tyreFilter.frequency, 500 + sp * 90, ctx);
    if (this.engineGain) {
      const idle = this.type === "motorcycle" ? 28 : this.type === "bus" ? 22 : 30;
      const f = idle + sp * (this.type === "motorcycle" ? 6.5 : this.type === "bus" ? 2.2 : 3.4);
      for (const o of this.engineOsc) smooth(o.frequency, f * ((o as OscillatorNode & { mult?: number }).mult ?? 1), ctx, 0.08);
      const g = this.type === "motorcycle" ? 0.55 : this.type === "bus" ? 0.6 : 0.22;
      smooth(this.engineGain.gain, g * (0.55 + Math.min(1, sp / 12) * 0.45), ctx);
    }
    if (this.hissGain) smooth(this.hissGain.gain, u.braking && sp < 3 && sp > 0.2 ? 0.08 : 0, ctx, 0.1);
    if (this.whineOsc && this.whineGain) {
      smooth(this.whineOsc.frequency, 500 + sp * 120, ctx, 0.1);
      smooth(this.whineGain.gain, (this.type === "tuk_tuk" ? 0.012 : 0.006) * Math.min(1, sp / 5), ctx);
    }
    const avasOn = u.avas && sp < 8.5; // AVAS rules require sound up to ~20 km/h; we keep it on up to ~30
    for (const [i, o] of this.avasOsc.entries()) smooth(o.frequency, (i ? 571 : 380) * (1 + sp / 30), ctx, 0.1);
    smooth(this.avasGain.gain, avasOn ? 0.09 : 0, ctx, 0.15);
  }

  dispose() {
    const ctx = this.ctx;
    smooth(this.out.gain, 0, ctx, 0.15);
    const stopAt = ctx.currentTime + 0.8;
    for (const n of this.nodes) { try { n.stop(stopAt); } catch { /* already stopped */ } }
    setTimeout(() => { try { this.out.disconnect(); this.panner.disconnect(); } catch { /* noop */ } }, 1200);
  }
}

export type EarconKind = "aware" | "warn" | "urgent" | "bus" | "place" | "pulse";

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private vehicleBus!: GainNode;
  private alertBus!: GainNode;
  private ambientGain!: GainNode;
  private noise!: AudioBuffer;
  private voices = new Map<number, Voice>();
  private ambientNodes: AudioNode[] = [];
  private birdTimer: number | null = null;
  private night = false;
  private listenerPos = { x: 0, y: 1.6, z: 4.6 };
  private listenerYaw = 0;
  private nextPulse = 0;

  get ready() { return this.ctx !== null && this.ctx.state === "running"; }

  async init() {
    if (this.ctx) { await this.ctx.resume(); return; }
    const ctx = new AudioContext({ latencyHint: "interactive" });
    this.ctx = ctx;
    const comp = new DynamicsCompressorNode(ctx, { threshold: -14, knee: 10, ratio: 4, attack: 0.005, release: 0.2 });
    this.master = new GainNode(ctx, { gain: 0.9 });
    this.master.connect(comp).connect(ctx.destination);
    this.vehicleBus = new GainNode(ctx, { gain: 1 });
    this.alertBus = new GainNode(ctx, { gain: 0.9 });
    this.ambientGain = new GainNode(ctx, { gain: 0 });
    this.vehicleBus.connect(this.master);
    this.alertBus.connect(this.master);
    this.ambientGain.connect(this.master);
    // 4 s of white noise shared by every noise source
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.buildAmbient();
    await ctx.resume();
  }

  private buildAmbient() {
    const ctx = this.ctx!;
    // distant city rumble (brown-ish noise), wide stereo from two decorrelated sources
    for (const pan of [-0.7, 0.7]) {
      const src = new AudioBufferSourceNode(ctx, { buffer: this.noise, loop: true });
      const lp = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 320, Q: 0.5 });
      const lp2 = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 900 });
      const g = new GainNode(ctx, { gain: 0.16 });
      const p = new StereoPannerNode(ctx, { pan });
      src.connect(lp).connect(lp2).connect(g).connect(p).connect(this.ambientGain);
      src.start(0, pan > 0 ? 1.7 : 0.2);
      this.ambientNodes.push(src);
    }
    // soft wind / palm leaves
    const w = new AudioBufferSourceNode(ctx, { buffer: this.noise, loop: true });
    const bp = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 2500, Q: 0.4 });
    const wg = new GainNode(ctx, { gain: 0.012 });
    const lfo = new OscillatorNode(ctx, { frequency: 0.13 });
    const lfoG = new GainNode(ctx, { gain: 0.008 });
    lfo.connect(lfoG).connect(wg.gain);
    w.connect(bp).connect(wg).connect(this.ambientGain);
    w.start(0, 2.5); lfo.start();
    this.ambientNodes.push(w, lfo);
    this.scheduleCritters();
  }

  private scheduleCritters() {
    const loop = () => {
      if (!this.ctx) return;
      if (this.ctx.state === "running") (this.night ? this.cricket() : this.bird());
      this.birdTimer = window.setTimeout(loop, (this.night ? 900 : 2200) + Math.random() * 3500);
    };
    this.birdTimer = window.setTimeout(loop, 1500);
  }

  private critterPanner(): PannerNode {
    const ctx = this.ctx!, p = makePanner(ctx);
    const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 20;
    p.positionX.value = this.listenerPos.x + Math.cos(a) * r;
    p.positionY.value = 4 + Math.random() * 5;
    p.positionZ.value = this.listenerPos.z + Math.sin(a) * r;
    p.connect(this.ambientGain);
    return p;
  }

  private bird() {
    const ctx = this.ctx!, t = ctx.currentTime, p = this.critterPanner();
    const n = 2 + Math.floor(Math.random() * 4), base = 2600 + Math.random() * 1600;
    for (let i = 0; i < n; i++) {
      const o = new OscillatorNode(ctx, { type: "sine" }), g = new GainNode(ctx, { gain: 0 });
      const s = t + i * (0.09 + Math.random() * 0.05);
      o.frequency.setValueAtTime(base, s);
      o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.3), s + 0.06);
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.05, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0005, s + 0.08);
      o.connect(g).connect(p);
      o.start(s); o.stop(s + 0.1);
    }
    setTimeout(() => p.disconnect(), 2000);
  }

  private cricket() {
    const ctx = this.ctx!, t = ctx.currentTime, p = this.critterPanner();
    for (let i = 0; i < 3; i++) {
      const o = new OscillatorNode(ctx, { type: "sine", frequency: 4400 }), g = new GainNode(ctx, { gain: 0 });
      const s = t + i * 0.06;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.018, s + 0.008);
      g.gain.linearRampToValueAtTime(0, s + 0.04);
      o.connect(g).connect(p);
      o.start(s); o.stop(s + 0.05);
    }
    setTimeout(() => p.disconnect(), 1500);
  }

  setAmbient(db: number, night: boolean) {
    if (!this.ctx) return;
    this.night = night;
    // map 55-70 dB(A) to a comfortable headphone level
    smooth(this.ambientGain.gain, 0.35 + (db - 55) * 0.04, this.ctx, 0.6);
  }

  setListener(x: number, y: number, z: number, yawDeg: number) {
    if (!this.ctx) return;
    this.listenerPos = { x, y, z };
    this.listenerYaw = yawDeg;
    const L = this.ctx.listener, now = this.ctx.currentTime;
    const yaw = (yawDeg * Math.PI) / 180;
    const fx = Math.sin(yaw), fz = -Math.cos(yaw);
    if (L.positionX) {
      L.positionX.setTargetAtTime(x, now, 0.02); L.positionY.setTargetAtTime(y, now, 0.02); L.positionZ.setTargetAtTime(z, now, 0.02);
      L.forwardX.setTargetAtTime(fx, now, 0.02); L.forwardY.setTargetAtTime(0, now, 0.02); L.forwardZ.setTargetAtTime(fz, now, 0.02);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      (L as AudioListener & { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
      (L as AudioListener & { setOrientation(...a: number[]): void }).setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  ensureVoice(uid: number, type: VType) {
    if (!this.ctx || this.voices.has(uid)) return;
    this.voices.set(uid, new Voice(this.ctx, type, this.noise, this.vehicleBus));
  }

  updateVoice(uid: number, u: VoiceUpdate) { this.voices.get(uid)?.update(u); }

  pruneVoices(alive: Set<number>) {
    for (const [uid, v] of this.voices) if (!alive.has(uid)) { v.dispose(); this.voices.delete(uid); }
  }

  clearVoices() { for (const v of this.voices.values()) v.dispose(); this.voices.clear(); }

  /** World position 3 m from the listener in the direction of a relative bearing (deg, -left). */
  private dirPos(relDeg: number | null): [number, number, number] {
    const a = ((this.listenerYaw + (relDeg ?? 0)) * Math.PI) / 180;
    const r = relDeg === null ? 0.6 : 3;
    return [this.listenerPos.x + Math.sin(a) * r, this.listenerPos.y, this.listenerPos.z - Math.cos(a) * r];
  }

  /** Spatialised earcon from the vehicle's direction. */
  earcon(kind: EarconKind, relDeg: number | null) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const p = makePanner(ctx);
    p.refDistance = 3;
    const [x, y, z] = this.dirPos(relDeg);
    p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;
    p.connect(this.alertBus);
    const t = ctx.currentTime + 0.01;
    const beep = (s: number, f: number, dur: number, vol: number, type: OscillatorType = "sine", f2?: number) => {
      const o = new OscillatorNode(ctx, { type, frequency: f }), g = new GainNode(ctx, { gain: 0 });
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, s + dur);
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(vol, s + 0.008);
      g.gain.setTargetAtTime(0, s + dur * 0.6, dur * 0.25);
      o.connect(g).connect(p);
      o.start(s); o.stop(s + dur + 0.1);
    };
    let end = 0.3;
    switch (kind) {
      case "aware": beep(t, 660, 0.09, 0.35); beep(t + 0.22, 660, 0.09, 0.35); end = 0.5; break;
      case "warn": for (let i = 0; i < 3; i++) beep(t + i * 0.16, 880 + i * 60, 0.08, 0.45, "triangle"); end = 0.7; break;
      case "urgent": for (let i = 0; i < 6; i++) beep(t + i * 0.09, 1100 + i * 70, 0.06, 0.55, "square"); end = 0.8; break;
      case "pulse": beep(t, 1000, 0.05, 0.3, "triangle"); end = 0.2; break;
      case "bus": beep(t, 784, 0.5, 0.35); beep(t + 0.45, 587, 0.7, 0.35); end = 1.4; break;
      case "place": beep(t, 1318, 0.12, 0.22, "sine", 1568); end = 0.4; break;
    }
    setTimeout(() => p.disconnect(), (end + 0.6) * 1000);
  }

  /** Continuous pulse whose rate rises as time-to-reach falls. Call every frame. */
  proximityPulse(active: { level: number; ttr: number | null; bearing: number | null } | null) {
    if (!this.ctx || !active) return;
    const now = this.ctx.currentTime;
    if (now < this.nextPulse) return;
    const ttr = active.ttr ?? (active.level >= 3 ? 1.5 : 4);
    const interval = Math.min(0.6, Math.max(0.09, ttr * 0.11));
    this.nextPulse = now + interval;
    this.earcon("pulse", active.bearing);
  }

  setMasterMuted(m: boolean) { if (this.ctx) smooth(this.master.gain, m ? 0 : 0.9, this.ctx, 0.2); }
}

export const audio = new AudioEngine();

// ------------------------------------------------------------------ speech
export type SpeechLang = "en" | "ar";
class Speech {
  private voices: SpeechSynthesisVoice[] = [];
  lang: SpeechLang = "en";
  enabled = true;
  onSpeak: ((text: string, lang: SpeechLang) => void) | null = null;
  constructor() {
    if (typeof speechSynthesis === "undefined") return;
    const load = () => { this.voices = speechSynthesis.getVoices(); };
    load();
    speechSynthesis.addEventListener?.("voiceschanged", load);
  }
  get available() { return typeof speechSynthesis !== "undefined"; }
  hasArabic() { return this.voices.some((v) => v.lang.toLowerCase().startsWith("ar")); }
  speak(en: string, ar: string, priority: number) {
    const text = this.lang === "ar" ? ar : en;
    this.onSpeak?.(text, this.lang);
    if (!this.enabled || !this.available) return;
    try {
      if (priority >= 2) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = this.lang === "ar" ? "ar-SA" : "en-US";
      const v = this.voices.find((x) => x.lang.toLowerCase().startsWith(this.lang)) ?? null;
      if (v) u.voice = v;
      u.rate = priority >= 3 ? 1.25 : 1.1;
      u.volume = 1;
      speechSynthesis.speak(u);
    } catch { /* speech not available in this browser */ }
  }
  cancel() { try { if (this.available) speechSynthesis.cancel(); } catch { /* noop */ } }
}
export const speech = new Speech();
