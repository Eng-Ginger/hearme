// HearMe pedestrian phone app (accessible mockup).
// Runs its own copy of receiver-core; in this digital prototype it receives packets from the
// Lab's simulated radio over a BroadcastChannel ("hearme-radio") instead of real BLE scanning.
import { useEffect, useRef, useState } from "react";
import { hexToBytes, TEST_FLEET_KEY } from "@hearme/protocol";
import { Receiver, hapticFor, type AlertEvent } from "@hearme/receiver-core";
import "./phone.css";

type Lang = "en" | "ar";
const T = {
  en: {
    title: "HearMe", listening: "Listening", paused: "Paused", tapStart: "Tap to start listening", tapStop: "Tap to pause",
    last: "Last alert", none: "No vehicles near you", history: "Recent", lang: "العربية", packets: "packets",
    source: "Receiving from the HearMe Lab simulated radio", noSource: "Waiting for the HearMe Lab radio…", speak: "Speak alerts",
  },
  ar: {
    title: "اسمعني", listening: "يستمع", paused: "متوقف", tapStart: "اضغط لبدء الاستماع", tapStop: "اضغط للإيقاف",
    last: "آخر تنبيه", none: "لا توجد مركبات بالقرب منك", history: "الأحدث", lang: "English", packets: "حزمة",
    source: "يستقبل من الراديو المحاكى في مختبر اسمعني", noSource: "في انتظار راديو المختبر…", speak: "نطق التنبيهات",
  },
};

export interface PhoneAppProps { embedded?: boolean; speakDefault?: boolean; initialLang?: Lang }

export function PhoneApp({ embedded = false, speakDefault = true, initialLang = "en" }: PhoneAppProps) {
  const [listening, setListening] = useState(true);
  const [lang, setLang] = useState<Lang>(initialLang);
  const [speak, setSpeak] = useState(speakDefault);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [pkts, setPkts] = useState(0);
  const [live, setLive] = useState(false);
  const [flash, setFlash] = useState(0);
  const rx = useRef(new Receiver({ fleet_key: TEST_FLEET_KEY }));
  const st = useRef({ listening, lang, speak });
  st.current = { listening, lang, speak };

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bc = new BroadcastChannel("hearme-radio");
    let count = 0, lastSeen = 0;
    const timer = window.setInterval(() => { setPkts(count); setLive(performance.now() - lastSeen < 1500); }, 400);
    bc.onmessage = (m: MessageEvent) => {
      const d = m.data;
      lastSeen = performance.now();
      if (d.k === "reset") { rx.current = new Receiver({ fleet_key: TEST_FLEET_KEY, use_position: d.receiverMode !== "rssi" }); return; }
      if (d.k === "pose") { rx.current.setPose(d.lat, d.lon, d.heading); return; }
      if (d.k === "tick") { rx.current.tick(d.t); return; }
      if (d.k !== "pkt" || !st.current.listening) return;
      count++;
      const ev = rx.current.processPayload(d.t, d.rssi, hexToBytes(d.hex));
      for (const a of ev) {
        setAlerts((prev) => [a, ...prev].slice(0, 6));
        setFlash((f) => f + 1);
        // Browsers only allow vibration after the user has tapped the page; the embedded Lab copy never vibrates.
        const act = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
        if (!embedded && act?.hasBeenActive && "vibrate" in navigator) navigator.vibrate(hapticFor(a) as number[]);
        if (st.current.speak && a.kind !== "vehicle_aware" && typeof speechSynthesis !== "undefined") {
          const u = new SpeechSynthesisUtterance(st.current.lang === "ar" ? a.text_ar : a.text_en);
          u.lang = st.current.lang === "ar" ? "ar-SA" : "en-US";
          if (a.kind === "vehicle_urgent") speechSynthesis.cancel();
          speechSynthesis.speak(u);
        }
      }
    };
    return () => { bc.close(); clearInterval(timer); };
  }, []);

  const t = T[lang];
  const last = alerts[0];
  const text = (a: AlertEvent) => (lang === "ar" ? a.text_ar : a.text_en);
  const lvl = last ? (last.kind === "vehicle_urgent" ? "urgent" : last.kind === "vehicle_warn" ? "warn" : last.kind === "bus_arriving" ? "bus" : "info") : "none";

  return (
    <div className={`hm-phone ${embedded ? "embedded" : ""}`} dir={lang === "ar" ? "rtl" : "ltr"} lang={lang}>
      <header className="hm-top">
        <h1>{t.title}</h1>
        <button className="hm-lang" onClick={() => setLang(lang === "en" ? "ar" : "en")} aria-label="Switch language">{t.lang}</button>
      </header>
      <button
        className={`hm-listen ${listening ? "on" : "off"}`}
        aria-pressed={listening}
        onClick={() => setListening(!listening)}
        aria-label={`${listening ? t.listening : t.paused}. ${listening ? t.tapStop : t.tapStart}`}
      >
        <span className="hm-ring" aria-hidden="true" key={flash} />
        <span className="hm-listen-label">{listening ? t.listening : t.paused}</span>
        <span className="hm-listen-sub">{listening ? t.tapStop : t.tapStart}</span>
      </button>
      <section className={`hm-alert lvl-${lvl}`} aria-live="assertive" aria-atomic="true">
        <div className="hm-alert-cap">{t.last}</div>
        <div className="hm-alert-text">{last ? text(last) : t.none}</div>
      </section>
      <section className="hm-history" aria-label={t.history}>
        <h2>{t.history}</h2>
        <ul>{alerts.slice(1, 5).map((a, i) => <li key={i + a.t}>{text(a)}</li>)}</ul>
      </section>
      <footer className="hm-foot">
        <label className="hm-toggle"><input type="checkbox" checked={speak} onChange={(e) => setSpeak(e.target.checked)} /> {t.speak}</label>
        <div className={`hm-src ${live ? "live" : ""}`}>{live ? t.source : t.noSource} · {pkts} {t.packets}</div>
      </footer>
    </div>
  );
}
export default PhoneApp;
