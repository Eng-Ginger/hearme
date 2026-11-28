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
  quality: "auto" | "high" | "medium" | "low";
  autoLevel: "medium" | "low";   // what "auto" currently resolves to
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

// Narrow windows (< 1400 px) start with the live panel and phone mockup collapsed so the street fills the view.
const WIDE = typeof window === "undefined" || window.innerWidth >= 1400;

let state: UIState = {
  started: false, view: "sighted", mode: "on", receiverMode: "gps", carry: "pocket", walker: "normal", quality: "auto", autoLevel: "medium", scenarioId: "school",
  panelOpen: WIDE, phoneOpen: WIDE, wristOpen: true, captionsOn: true, lang: "en", speechOn: true,
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
