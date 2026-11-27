// Blind-mode fade, caption bar, edge flash (direction cue for video viewers), title cards.
import { useEffect, useState } from "react";
import { useUI } from "../state/store";

export function BlindOverlay() {
  const blind = useUI((s) => s.view === "blind");
  return <div className={`blind ${blind ? "on" : ""}`} aria-hidden="true" />;
}

export function CaptionBar() {
  const on = useUI((s) => s.captionsOn);
  const caption = useUI((s) => s.caption);
  const spoken = useUI((s) => s.spoken);
  const spokenAt = useUI((s) => s.spokenAt);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (!spoken) return;
    setFresh(true);
    const id = window.setTimeout(() => setFresh(false), 4200);
    return () => clearTimeout(id);
  }, [spoken, spokenAt]);
  if (!on || (!caption && !fresh)) return null;
  return (
    <div className="captions" role="status" aria-live="polite">
      {fresh && <div className="cap-spoken"><span className="cap-icon">🔊</span>{spoken}</div>}
      {caption && <div className="cap-narr">{caption}</div>}
    </div>
  );
}

export function EdgeFlash() {
  const f = useUI((s) => s.edgeFlash);
  const blind = useUI((s) => s.view === "blind");
  const [k, setK] = useState(0);
  useEffect(() => { if (f) setK((x) => x + 1); }, [f]);
  if (!f || !blind) return null;
  return <div key={k} className={`edge edge-${f.side} lvl${f.level}`} aria-hidden="true" />;
}

export function TitleCard() {
  const card = useUI((s) => s.titleCard);
  if (card === "none") return null;
  return (
    <div className={`title-card ${card}`}>
      <div className="tc-logo">Hear<span>Me</span></div>
      {card === "intro" ? (
        <div className="tc-sub">Electric vehicles are silent. We made them speak.<div className="tc-hp">🎧 Best with headphones</div></div>
      ) : (
        <>
          <div className="tc-sub">Electric vehicles are silent. We made them speak.</div>
          <div className="tc-facts">$1 per vehicle · no internet · nothing installed on the road</div>
          <div className="tc-team">Mohammed Shehadeh · M. Ghaith Ali · Moundir Mekkaoui<br />WFEO Hackathon 2027 · Challenge 1: Inclusive Mobility</div>
          <div className="tc-note">Digital prototype. Radio, GPS and traffic are simulated.</div>
        </>
      )}
    </div>
  );
}
