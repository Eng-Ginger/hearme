// Tiny global UI store (useSyncExternalStore), no dependency needed.
import { useSyncExternalStore } from "react";
import type { HearMeMode, ReceiverMode } from "../sim/engine";
import type { CarryMode } from "../config/radio";
import type { SpeechLang } from "../audio/audio";

export interface UIState {
  started: boolean;
  view: "sighted" | "blind";
  mode: HearMeMode;
  receiverMode: ReceiverMode;
  carry: CarryMode;
  walker: "slow" | "normal" | "fast";
  scenarioId: string;
  panelOpen: boolean;
  phoneOpen: boolean;
  wristOpen: boolean;
  captionsOn: boolean;
  lang: SpeechLang;
  speechOn: boolean;
  director: boolean;
  caption: string;          // director narration caption
  spoken: string;           // last spoken alert text (live caption)
  spokenAt: number;
  titleCard: "none" | "intro" | "outro";
  edgeFlash: { side: "left" | "right" | "ahead" | "behind" | "unknown"; level: number; at: number } | null;
  paused: boolean;
  hint: string;
}

let state: UIState = {
  started: false, view: "sighted", mode: "on", receiverMode: "gps", carry: "pocket", walker: "normal", scenarioId: "school",
  panelOpen: true, phoneOpen: true, wristOpen: true, captionsOn: true, lang: "en", speechOn: true,
  director: false, caption: "", spoken: "", spokenAt: 0, titleCard: "none", edgeFlash: null, paused: false, hint: "",
};
const subs = new Set<() => void>();

export const store = {
  get: () => state,
  set(patch: Partial<UIState>) { state = { ...state, ...patch }; for (const s of subs) s(); },
  subscribe(fn: () => void) { subs.add(fn); return () => subs.delete(fn); },
};

export function useUI<T>(sel: (s: UIState) => T): T {
  return useSyncExternalStore(store.subscribe, () => sel(store.get()));
}
