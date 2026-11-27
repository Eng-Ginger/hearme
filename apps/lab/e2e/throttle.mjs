// Load test under Chrome DevTools-style throttling: "Fast 4G" network + 4x CPU slowdown.
// Measures bytes transferred until the street is loaded, time to loaded, fps after Start, and the
// quality level that "auto" settles on. Also checks /phone.html, /dashboard/ and /credits.html load.
// Usage: LAB_URL=https://... node apps/lab/e2e/throttle.mjs
import { chromium } from "playwright";

const URL = process.env.LAB_URL ?? "http://localhost:8090";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--ignore-gpu-blocklist", "--enable-gpu", "--use-angle=d3d11"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
// DevTools "Fast 4G" preset: 9 Mbit/s down, 1.5 Mbit/s up, 60 ms latency (approximately)
await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 60, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 });
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
let bytes = 0;
cdp.on("Network.loadingFinished", (e) => { bytes += e.encodedDataLength; });

const t0 = Date.now();
await page.goto(URL + "/");
await page.waitForSelector(".l-start");
const tInteractive = (Date.now() - t0) / 1000;
await page.waitForFunction(() => document.querySelector(".l-load-txt")?.textContent?.includes("Street loaded"), null, { timeout: 180000 });
const tLoaded = (Date.now() - t0) / 1000;
const loadedBytes = bytes;
await page.click(".l-start");
await page.waitForTimeout(8000);   // let auto quality settle
const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 4000) requestAnimationFrame(f); else r(+(n / 4).toFixed(1)); }; requestAnimationFrame(f); }));
const q = await page.evaluate(() => { const s = window.__hearme.store.get(); return `${s.quality} -> ${s.autoLevel}`; });
const alerts = await page.evaluate(() => window.__hearme.engine.alerts.length);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
const pages = {};
for (const p of ["/phone.html", "/dashboard/", "/credits.html"]) {
  const pg = await ctx.newPage();
  pg.on("pageerror", (e) => errors.push(p + ": " + e.message));
  const r = await pg.goto(URL + p);
  await pg.waitForTimeout(p === "/dashboard/" ? 4000 : 800);
  pages[p] = `${r.status()} ${(await pg.title()).slice(0, 40)}` + (p === "/dashboard/" ? ` · ${await pg.evaluate(() => document.querySelectorAll("path.leaflet-interactive").length)} cells drawn` : "");
  await pg.close();
}
console.log(JSON.stringify({ url: URL, throttling: "Fast 4G (9 Mbit/s, 60 ms) + 4x CPU", startButtonS: tInteractive, streetLoadedS: tLoaded,
  transferredMB: +(loadedBytes / 1e6).toFixed(2), fpsThrottled: fps, quality: q, alertsSoFar: alerts, pages, consoleErrors: errors }, null, 1));
await browser.close();
process.exit(errors.length ? 1 : 0);
