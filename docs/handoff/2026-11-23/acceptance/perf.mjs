// Stage 4: what each page loads, and what the 3D scene does when idle and when entered and left repeatedly.
// Fresh browser context per page (no cache, no saved data). Usage: node perf.mjs <base url> [label]
//   CHROME=<path to Chrome> if not /usr/bin/google-chrome
import { chromium } from "@playwright/test";
const base = process.argv[2] ?? "http://127.0.0.1:3001";
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const out = {};
async function fresh(fn) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(() => { window.__raf = 0; const r = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => { window.__raf += 1; return r(cb); }; });
  const page = await ctx.newPage(); page.setDefaultTimeout(120000);
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  const res = new Map();
  page.on("response", async (r) => { try { const b = await r.body(); res.set(r.url(), b.length); } catch {} });
  try { return await fn(page, res, errors); } finally { await ctx.close(); }
}
const summary = (res) => {
  const all = [...res.entries()];
  const js = all.filter(([u]) => /\.js(\?|$)/.test(u));
  const assets = all.filter(([u]) => /\/assets\/pc\//.test(u));
  return { requests: all.length, totalKB: Math.round(all.reduce((s, [, n]) => s + n, 0) / 1024), jsKB: Math.round(js.reduce((s, [, n]) => s + n, 0) / 1024), pcAssets: assets.length, pcAssetKB: Math.round(assets.reduce((s, [, n]) => s + n, 0) / 1024) };
};
// An unrelated page and the planner.
out.home = await fresh(async (page, res) => { await page.goto(base + "/", { waitUntil: "networkidle" }); return summary(res); });
out.planner = await fresh(async (page, res) => { await page.goto(base + "/pc", { waitUntil: "networkidle" }); await page.waitForSelector("#planner-title"); const s = summary(res); s.canvases = await page.locator("canvas").count(); return s; });
// Starting assembly (the practice build), then the idle frame rate, then leaving and entering again.
out.assembly = await fresh(async (page, res, errors) => {
  await page.goto(base + "/pc", { waitUntil: "networkidle" }); await page.waitForSelector("#planner-title");
  const plannerRes = summary(res);
  await page.getByRole("button", { name: /practice build/ }).click();
  await page.waitForSelector("canvas", { timeout: 120000 }); await page.waitForTimeout(8000);
  const started = summary(res);
  const r0 = await page.evaluate(() => window.__raf); await page.waitForTimeout(3000); const idle = (await page.evaluate(() => window.__raf)) - r0;
  const cycles = [];
  for (let i = 0; i < 3; i += 1) {
    await page.getByRole("button", { name: /edit.*build|back.*plan|plan/i }).first().click().catch(() => {});
    await page.waitForTimeout(1500);
    const inPlanner = await page.locator("canvas").count();
    await page.getByRole("button", { name: /practice build/ }).click();
    await page.waitForSelector("canvas", { timeout: 120000 }); await page.waitForTimeout(4000);
    cycles.push({ canvasesInPlanner: inPlanner, canvasesInAssembly: await page.locator("canvas").count() });
  }
  return { plannerRes, started, idleRafPer3s: idle, cycles, afterCycles: summary(res), errors };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
