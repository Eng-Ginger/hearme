// Routes receiver events to the user: spatial earcon, speech, wristband haptics, captions.
import { hapticFor, type AlertEvent } from "@hearme/receiver-core";
import { engine } from "./sim/engine";
import { audio, speech, type EarconKind } from "./audio/audio";
import { store } from "./state/store";

type HapticListener = (pattern: readonly number[], label: string, level: number) => void;
const hapticSubs = new Set<HapticListener>();
export const onHaptic = (fn: HapticListener) => { hapticSubs.add(fn); return () => hapticSubs.delete(fn); };

const LABEL: Record<AlertEvent["kind"], string> = {
  vehicle_aware: "Vehicle nearby", vehicle_warn: "Approaching", vehicle_urgent: "Approaching fast",
  bus_arriving: "Bus arriving", place: "Place",
};
const EARCON: Record<AlertEvent["kind"], EarconKind> = {
  vehicle_aware: "aware", vehicle_warn: "warn", vehicle_urgent: "urgent", bus_arriving: "bus", place: "place",
};

export function installAlertRouting() {
  speech.onSpeak = (text) => store.set({ spoken: text, spokenAt: performance.now() });
  return engine.on((e) => {
    if (e.kind !== "alert" || e.muted) return;
    const a = e.alert;
    const ui = store.get();
    audio.earcon(EARCON[a.kind], e.bearing);
    const level = a.kind === "vehicle_urgent" ? 3 : a.kind === "vehicle_warn" ? 2 : a.kind === "bus_arriving" ? 2 : 1;
    // aware = haptic only (no speech), to avoid alert fatigue
    if (a.kind !== "vehicle_aware") {
      speech.enabled = ui.speechOn;
      speech.lang = ui.lang;
      speech.speak(a.text_en, a.text_ar, level + (a.kind === "vehicle_urgent" ? 1 : 0));
    }
    for (const fn of hapticSubs) fn(hapticFor(a), LABEL[a.kind], level);
    if (a.kind.startsWith("vehicle")) store.set({ edgeFlash: { side: a.side, level, at: performance.now() } });
  });
}
