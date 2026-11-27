// Virtual wristband: plays the real haptic patterns (shared with firmware + phone) as animation.
import { useEffect, useRef, useState } from "react";
import { onHaptic } from "../alerts";
import { useUI } from "../state/store";

const LEVEL_COLOR = ["#6b7280", "#ffd400", "#ff9f0a", "#ff3b30"];

export function Wristband() {
  const open = useUI((s) => s.wristOpen);
  const ref = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState("Listening");
  const [level, setLevel] = useState(0);
  const timers = useRef<number[]>([]);

  useEffect(() => { const off = onHaptic((pattern, lab, lvl) => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
    setLabel(lab);
    setLevel(lvl);
    const el = ref.current;
    let at = 0;
    pattern.forEach((ms, i) => {
      const on = i % 2 === 0;
      timers.current.push(window.setTimeout(() => el?.classList.toggle("buzz", on), at));
      at += ms;
    });
    timers.current.push(window.setTimeout(() => el?.classList.remove("buzz"), at));
    timers.current.push(window.setTimeout(() => { setLabel("Listening"); setLevel(0); }, at + 2500));
  }); return () => { off(); }; }, []);

  if (!open) return null;
  return (
    <div className="wrist" aria-hidden="true">
      <div className="wrist-strap" />
      <div ref={ref} className="wrist-face" style={{ ["--lvl" as string]: LEVEL_COLOR[level] }}>
        <div className="wrist-led" />
        <div className="wrist-label">{label}</div>
        <div className="wrist-brand">HearMe band</div>
      </div>
      <div className="wrist-legend">
        <span><i className="p-slow" />nearby</span><span><i className="p-fast" />approaching</span><span><i className="p-long" />bus</span>
      </div>
    </div>
  );
}
