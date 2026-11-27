// End-to-end check of the HearMe Lab with Playwright.
// Runs DIRECTOR MODE start to finish at 1920x1080, fails on any console error, records FPS,
// and saves README screenshots to docs/screenshots/.
//
// Usage: start the Lab (npm run dev -w @hearme/lab), then
//   LAB_URL=http://localhost:5173 node apps/lab/e2e/director.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const URL = process.env.LAB_URL ?? "http://localhost:5173";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs/screenshots");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: process.env.HEADED ? false : true,
  args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist", "--enable-gpu", "--use-angle=d3d11", "--enable-unsafe-swiftshader"],
});
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } }); // one context: BroadcastChannel is per context
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

const state = () => page.evaluate(() => {
  const h = window.__hearme, s = h.store.get(), e = h.engine;
  return { t: e.t, director: s.director, view: s.view, mode: s.mode, title: s.titleCard, caption: s.caption, spoken: s.spoken,
    alerts: e.alerts.map((a) => ({ t: +a.t.toFixed(2), kind: a.alert.kind, text: a.alert.text_en, muted: a.muted })),
    passes: e.passes.map((p) => ({ key: p.key, t: +p.t.toFixed(2), passDist: +p.passDist.toFixed(2), kmh: +(p.speed * 3.6).toFixed(1), leadWarn: p.leadWarn, leadAudible: p.leadAudible, mode: p.mode })) };
});
const fps = (ms = 3000) => page.evaluate((ms) => new Promise((r) => {
  let n = 0; const t0 = performance.now();
  const f = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(f); else r(+(n / (ms / 1000)).toFixed(1)); };
  requestAnimationFrame(f);
}), ms);
const shot = (name) => page.screenshot({ path: resolve(OUT, name + ".png") });

const report = { url: URL, checkpoints: [], fps: {}, errors };

// ---- 1. Director mode end to end
await page.goto(`${URL}/?autostart=1&director=1`);
await page.waitForFunction(() => window.__hearme?.store.get().director === true);
const checkpoints = [
  ["intro", (s) => s.title === "intro"],
  ["sighted-street", (s) => s.title === "none" && s.view === "sighted" && s.caption.startsWith("Petrol")],
  ["blind-off", (s) => s.view === "blind" && s.caption.startsWith("HearMe is OFF")],
  ["heard-nothing", (s) => s.caption.startsWith("You heard nothing")],
  ["hearme-on-alert", (s) => s.mode === "on" && /Electric bike/.test(s.spoken)],
  ["warned-caption", (s) => s.caption.startsWith("HearMe warned you")],
  ["bus-arriving", (s) => /^Bus 12 arriving/.test(s.spoken)],
  ["outro", (s) => s.title === "outro"],
];
const t0 = Date.now();
let idx = 0, fpsSampled = false;
while (idx < checkpoints.length && Date.now() - t0 < 240000) {
  const s = await state();
  if (!fpsSampled && s.t > 6) { report.fps.director = await fps(); fpsSampled = true; }
  if (checkpoints[idx][1](s)) {
    const [name] = checkpoints[idx];
    await page.waitForTimeout(name === "sighted-street" ? 1800 : name === "blind-off" ? 600 : 250);
    await shot("director-" + (idx + 1) + "-" + name);
    report.checkpoints.push({ name, wallS: (Date.now() - t0) / 1000, simT: +s.t.toFixed(2), caption: s.caption, spoken: s.spoken });
    console.log(`  ✓ ${name.padEnd(16)} sim t=${s.t.toFixed(1)}s  ${s.caption || s.spoken}`);
    idx++;
  } else await page.waitForTimeout(150);
}
const final = await state();
report.directorCompleted = idx === checkpoints.length;
report.alerts = final.alerts;
report.passes = final.passes;
report.directorWallS = (Date.now() - t0) / 1000;

// ---- 2. Free-play screenshots for the README
await page.keyboard.press("Escape");
await page.goto(`${URL}/?autostart=1&scenario=school`);
await page.waitForFunction(() => window.__hearme?.store.get().started === true);
await page.evaluate(() => { window.__hearme.camCtl.yaw = -58; });
await page.waitForFunction(() => window.__hearme.engine.alerts.some((a) => a.alert.kind === "vehicle_warn"), null, { timeout: 60000 });
await page.waitForTimeout(600);
report.fps.freeplay = await fps();
await shot("lab-school-crossing");
await page.keyboard.press("b");
await page.waitForTimeout(2500);
await shot("lab-blind-mode-panel");
await page.goto(`${URL}/?autostart=1&scenario=night`);
await page.waitForFunction(() => window.__hearme?.store.get().started === true);
await page.evaluate(() => { window.__hearme.camCtl.yaw = -62; });
await page.waitForTimeout(9000);
report.fps.night = await fps();
await shot("lab-night");
await page.goto(`${URL}/?autostart=1&scenario=busstop`);
await page.waitForFunction(() => window.__hearme.engine.alerts.some((a) => a.alert.kind === "bus_arriving"), null, { timeout: 60000 });
await page.evaluate(() => { window.__hearme.camCtl.yaw = -40; });
await page.waitForTimeout(3000);
await shot("lab-bus-stop");
await page.goto(URL);
await shot("lab-landing");

// ---- 3. Standalone phone page linked over BroadcastChannel
const phone = await ctx.newPage();
await phone.setViewportSize({ width: 390, height: 844 });
phone.on("pageerror", (e) => errors.push("phone pageerror: " + e.message));
await phone.goto(`${URL}/phone.html`);
await page.goto(`${URL}/?autostart=1&scenario=twobikes`);
await page.bringToFront(); // keep the Lab tab animating; the phone is message-driven
await phone.waitForFunction(() => /Stop!|Electric|E-scooter/.test(document.querySelector(".hm-alert-text")?.textContent ?? ""), null, { timeout: 60000 });
await phone.waitForTimeout(400);
await phone.screenshot({ path: resolve(OUT, "phone-standalone.png") });

writeFileSync(resolve(OUT, "e2e-report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(`\nDirector completed: ${report.directorCompleted} (${report.directorWallS.toFixed(0)} s wall)`);
console.log("FPS:", report.fps);
console.log("Passes:", report.passes.map((p) => `${p.key}[${p.mode}] ${p.passDist} m @ ${p.kmh} km/h, warn ${p.leadWarn?.toFixed?.(2) ?? "-"} s, ears ${p.leadAudible?.toFixed?.(2) ?? "-"} s`).join("\n        "));
console.log(`Console errors: ${errors.length}`);
for (const e of errors) console.log("  ✗", e);
process.exit(report.directorCompleted && errors.length === 0 ? 0 : 1);
