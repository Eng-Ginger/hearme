// Wristband vibration patterns, shared by the Lab's virtual wristband, the phone app
// (navigator.vibrate) and documented for the firmware (firmware/src/wristband).
// Pattern = alternating [on_ms, off_ms, on_ms, ...] like navigator.vibrate().
import type { AlertEvent } from "./receiver";

export const HAPTICS = {
  /** Slow double pulse: vehicle nearby. */
  aware: [120, 180, 120],
  /** Fast pulses: vehicle approaching. */
  warn: [80, 70, 80, 70, 80, 70, 80],
  /** Faster, longer burst: approaching fast / about to reach you. */
  urgent: [60, 40, 60, 40, 60, 40, 60, 40, 60, 40, 60, 40, 60],
  /** Long buzz: bus arriving. */
  bus: [900],
  /** Single short tick: place announcement (stop / crossing). */
  place: [60],
} as const;

export function hapticFor(e: AlertEvent): readonly number[] {
  switch (e.kind) {
    case "vehicle_aware": return HAPTICS.aware;
    case "vehicle_warn": return HAPTICS.warn;
    case "vehicle_urgent": return HAPTICS.urgent;
    case "bus_arriving": return HAPTICS.bus;
    default: return HAPTICS.place;
  }
}
