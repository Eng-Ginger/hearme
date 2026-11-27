// Live receiver panel: packets per vehicle, RSSI/distance chart, state per vehicle,
// lead time at each pass, and seconds of warning gained vs no HearMe.
import { useEffect, useState } from "react";
import { engine, type PassRecord, type VehicleInst } from "../sim/engine";
import { store, useUI } from "../state/store";
import type { CarryMode } from "../config/radio";

const TYPE_LABEL: Record<string, string> = { e_bike: "E-bike", e_scooter: "E-scooter", motorcycle: "Motorbike (petrol)", car: "Car (petrol)", bus: "Bus 12", tuk_tuk: "E-tuk-tuk" };
const LEVEL_CLASS = ["lv0", "lv1", "lv2", "lv3"];
const LEVELS = ["ignore", "aware", "warn", "urgent"];

interface Row { uid: number; type: string; beacon: boolean; packets: number; rssi: number | null; trueD: number; est: number | null; gps: number | null; level: number; ttr: number | null; passed: boolean }

function snapshot() {
  const rows: Row[] = engine.vehicles.map((v) => {
    const st = engine.trackFor(v);
    return {
      uid: v.uid, type: v.type, beacon: v.spec.beacon, packets: v.packets, rssi: v.lastRssi, trueD: v.trueDist,
      est: st ? st.dist : null, gps: st?.geo_dist ?? null, level: st ? LEVELS.indexOf(st.level) : -1, ttr: st?.ttr ?? null, passed: v.passed,
    };
  });
  // chart focus: nearest beaconed vehicle that has history
  const cand = engine.vehicles.filter((v) => v.spec.beacon && v.history.length > 2).sort((a, b) => a.trueDist - b.trueDist);
  const focus: VehicleInst | undefined = cand[0];
  return {
    rows, focus: focus ? { type: focus.type, hist: focus.history.slice() } : null, passes: engine.passes.slice(-6).reverse(),
    gained: engine.gainedTotal, gainedN: engine.gainedCount, t: engine.t,
  };
}

function Chart({ hist, now }: { hist: VehicleInst["history"]; now: number }) {
  const W = 340, H = 150, span = 20, maxD = 60;
  const x = (t: number) => W - ((now - t) / span) * W;
  const y = (d: number) => H - (Math.min(d, maxD) / maxD) * (H - 8) - 4;
  const line = (sel: (h: VehicleInst["history"][number]) => number | null) =>
    hist.filter((h) => now - h.t <= span).map((h) => { const v = sel(h); return v === null ? null : `${x(h.t).toFixed(1)},${y(v).toFixed(1)}`; })
      .filter(Boolean).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Distance over the last 20 seconds">
      {[0, 15, 30, 45, 60].map((d) => (
        <g key={d}><line x1={0} x2={W} y1={y(d)} y2={y(d)} className="grid" /><text x={2} y={y(d) - 2} className="tick">{d} m</text></g>
      ))}
      <polyline points={line((h) => h.d)} className="l-true" />
      <polyline points={line((h) => h.est)} className="l-rssi" />
      <polyline points={line((h) => h.gps)} className="l-gps" />
    </svg>
  );
}

const fmt = (v: number | null, d = 1, unit = "") => (v === null ? "–" : `${v.toFixed(d)}${unit}`);

export function SidePanel() {
  const open = useUI((s) => s.panelOpen);
  const rmode = useUI((s) => s.receiverMode);
  const carry = useUI((s) => s.carry);
  const [snap, setSnap] = useState(snapshot);
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setSnap(snapshot()), 200);
    return () => clearInterval(id);
  }, [open]);
  if (!open) return null;
  return (
    <aside className="panel" aria-label="Live receiver panel">
      <div className="panel-h"><h2>Live receiver</h2><span className="sim-tag">simulated radio</span></div>
      <div className="gained">
        <div className="gained-n">{snap.gained.toFixed(1)}<small> s</small></div>
        <div className="gained-l">warning gained vs no HearMe<br /><span>{snap.gainedN} silent vehicle pass{snap.gainedN === 1 ? "" : "es"}</span></div>
      </div>
      <div className="seg-row">
        <div className="seg" role="group" aria-label="Receiver mode">
          {(["gps", "rssi"] as const).map((m) => (
            <button key={m} className={rmode === m ? "on" : ""} onClick={() => { engine.setReceiverMode(m); store.set({ receiverMode: m }); }}>{m === "gps" ? "GPS + RSSI" : "RSSI only"}</button>
          ))}
        </div>
        <select aria-label="Where the phone is carried" value={carry} onChange={(e) => { engine.carry = e.target.value as CarryMode; store.set({ carry: e.target.value as CarryMode }); }}>
          <option value="pocket">Phone in pocket</option><option value="hand">Phone in hand</option><option value="wrist">Wristband</option>
        </select>
      </div>
      <h3>Vehicles in range</h3>
      <table className="vt">
        <thead><tr><th>Vehicle</th><th>Pkts</th><th>RSSI</th><th>Est.</th><th>True</th><th>State</th></tr></thead>
        <tbody>
          {snap.rows.filter((r) => r.trueD < 160).sort((a, b) => a.trueD - b.trueD).slice(0, 7).map((r) => (
            <tr key={r.uid} className={r.passed ? "passed" : ""}>
              <td>{TYPE_LABEL[r.type]}{!r.beacon && <em> no beacon</em>}</td>
              <td>{r.beacon ? r.packets : "–"}</td>
              <td>{r.rssi === null ? "–" : r.rssi}</td>
              <td>{fmt(r.gps ?? r.est, 0, " m")}</td>
              <td>{r.trueD.toFixed(0)} m</td>
              <td>{r.level >= 0 ? <span className={`chip ${LEVEL_CLASS[r.level]}`}>{LEVELS[r.level]}{r.ttr !== null && r.level >= 2 ? ` ${r.ttr.toFixed(1)}s` : ""}</span> : <span className="chip">–</span>}</td>
            </tr>
          ))}
          {snap.rows.length === 0 && <tr><td colSpan={6} className="muted">Street is quiet…</td></tr>}
        </tbody>
      </table>
      <h3>Distance: true vs estimated {snap.focus && <span className="muted">({TYPE_LABEL[snap.focus.type]})</span>}</h3>
      {snap.focus ? <Chart hist={snap.focus.hist} now={snap.t} /> : <div className="chart-empty">Waiting for a beacon…</div>}
      <div className="legend"><span className="k-true">true</span><span className="k-rssi">RSSI estimate</span><span className="k-gps">GPS packet</span></div>
      <h3>Warning lead time at each pass</h3>
      <ul className="passes">
        {snap.passes.map((p: PassRecord) => (
          <li key={p.uid + ":" + p.t}>
            <b>{TYPE_LABEL[p.type]}</b> passed {p.passDist.toFixed(1)} m away at {(p.speed * 3.6).toFixed(0)} km/h
            <span>HearMe {p.beacon ? fmt(p.leadWarn, 1, " s") : "n/a"} · ears {fmt(p.leadAudible, 1, " s")}</span>
          </li>
        ))}
        {snap.passes.length === 0 && <li className="muted">No passes yet.</li>}
      </ul>
    </aside>
  );
}
