// Shared harness for the 2026-11-25 stage 5-11 acceptance scripts (real pointer clicks on the production build).
// Usage in a script: const h = await open({ plan, lang, width }); then press()/button()/state().
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
export const messages = (lang) => JSON.parse(fs.readFileSync(path.join(root, `apps/web/messages/${lang}/labs.json`), "utf8")).simplePc;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const results = { pass: 0, fail: 0, skip: 0 };
export const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : ` ${extra}`}`);
  if (cond) results.pass += 1; else { results.fail += 1; process.exitCode = 1; }
};
export const skip = (name, why) => { console.log(`SKIP  ${name}: ${why}`); results.skip += 1; };

/** A RegExp for a message with {placeholders}. */
export const rx = (text) => new RegExp(escape(text).replace(/\\\{[a-zA-Z]+\\\}/g, ".+?"));

export async function open({ plan = null, practice = false, lang = "en", width = 1440, base = process.argv[2] ?? "http://127.0.0.1:3002", seed = null } = {}) {
  const ar = lang === "ar";
  const m = messages(lang);
  const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 900 : 1000 } });
  await ctx.addCookies([{ name: "ytl_locale", value: lang, url: base }]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/pc${practice ? "?practice=1" : ""}`);
  if (plan) {
    const empty = { version: 4, plan: { version: 1, purpose: "gaming", workload: "1080p", parts: plan }, placed: [], connected: [], history: [], powered: false };
    await page.evaluate(([p, s]) => {
      localStorage.setItem("ytl_pc_plan_v1", JSON.stringify({ build: p.plan, phase: "assemble" }));
      localStorage.setItem("ytl_pc_plan_progress_v1", JSON.stringify(s ?? p));
    }, [empty, seed]);
    await page.reload();
  }
  await page.waitForSelector("canvas", { timeout: 120000 });
  await page.waitForTimeout(6000);
  const lab = page.locator("section[aria-labelledby='simple-pc-title']");
  const settle = () => page.evaluate(() => { const c = document.querySelector("canvas"); if (c) { const r = c.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) window.scrollBy(0, r.top - Math.max(0, (innerHeight - r.height) / 2)); } });
  const press = async (locator) => {
    await locator.first().evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(250);
    const b = await locator.first().boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(700);
    await settle();
  };
  const state = () => page.evaluate(() => window.__ytlSimplePc());
  const cam = () => page.evaluate(() => window.__ytlCamera?.() ?? null);
  const tile = (re) => lab.locator("[role=group] button:has(img)").filter({ hasText: re });
  const button = (re) => lab.getByRole("button", { name: re });
  /** The part-controls panel stays open for the selected part. */
  const openControls = async () => {
    const d = lab.locator("details").first();
    if ((await d.count()) && !(await d.evaluate((e) => e.open))) await d.locator("summary").click();
    await page.waitForTimeout(250);
  };
  const select = async (re) => { await press(tile(re)); await openControls(); };
  const robot = async () => (await state()).lines;
  const reload = async () => { await page.reload(); await page.waitForSelector("canvas", { timeout: 120000 }); await page.waitForTimeout(6000); await settle(); };
  const shot = async (name) => {
    const dir = process.env.SHOTS; if (!dir) return;
    fs.mkdirSync(dir, { recursive: true });
    try { await page.screenshot({ path: path.join(dir, `${name}-${lang}-${width}.png`) }); } catch { /* capture can fail under software GL */ }
  };
  return { browser, page, lab, m, ar, lang, press, state, cam, tile, button, select, openControls, robot, reload, shot, errors, settle, msg: (p) => rx(p.split(".").reduce((o, k) => o[k], m)) };
}

export async function finish(h) {
  ok("no uncaught page errors", h.errors.length === 0, h.errors.join(" | "));
  console.log(`\n${results.pass} passed, ${results.fail} failed, ${results.skip} skipped`);
  await h.browser.close();
}
