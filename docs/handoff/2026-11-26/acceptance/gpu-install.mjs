// Graphics card on the real page from a seeded save (every part but the card fitted): slot covers one at a time, latch,
// turn, seat, bracket screws one per click, double-click gating, stable camera, reload. Install path only (removal not covered).
// Seeds: npx vitest run --config docs/handoff/2026-11-26/acceptance/seed.config.mjs   Usage: node gpu-install.mjs [en|ar] [width] [base]
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const locale = process.argv[2] ?? "en", width = Number(process.argv[3] ?? 1440), base = process.argv[4] ?? "http://127.0.0.1:3002";
const seed = JSON.parse(readFileSync(process.env.VTE_SEED ?? join(tmpdir(), "vte-seed.json"), "utf8"));
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n} ${c ? "" : x}`); if (c) pass++; else { fail++; process.exitCode = 1; } };
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 900 : 1000 } });
  await ctx.addCookies([{ name: "ytl_locale", value: locale, url: base }]);
  await ctx.addInitScript(([plan, snap]) => { if (!localStorage.getItem("__seeded")) { localStorage.setItem("__seeded", "1"); localStorage.setItem("ytl_pc_plan_v1", JSON.stringify({ build: plan, phase: "assemble" })); localStorage.setItem("ytl_pc_plan_progress_v1", JSON.stringify(snap)); } }, [seed.plan, seed.noGpu]);
  const page = await ctx.newPage(); page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "/pc"); await page.waitForSelector("canvas"); await page.waitForTimeout(5000);
  const lab = page.locator("section[aria-labelledby='simple-pc-title']");
  const st = () => page.evaluate(() => window.__ytlSimplePc());
  const cam = () => page.evaluate(() => JSON.stringify(window.__ytlCamera?.() ?? null));
  const primary = () => lab.locator("[class*=toolPrimary]").first();
  const step = async () => { const n = (await st()).history.length; await primary().click(); await page.waitForTimeout(900); return (await st()).history.slice(n); };
  await lab.locator("[role=group] button:has(img)").filter({ hasText: /RTX 5060/ }).first().click(); await page.waitForTimeout(1500);
  const cam0 = await cam();
  const seen = [];
  let a = await step(); seen.push(...a);
  ok("one click takes out exactly one slot cover", a.length === 1 && /^mech:slot-covers:1:open$/.test(a[0]), JSON.stringify(a));
  a = await step(); seen.push(...a);
  ok("the second cover is its own step", a.length === 1 && /^mech:slot-covers:2:open$/.test(a[0]), JSON.stringify(a));
  a = await step(); seen.push(...a);
  ok("the PCIe latch is its own step", a.length === 1 && /pcie-x16-1-latch:open$/.test(a[0]), JSON.stringify(a));
  a = await step();
  ok("bringing the card over the slot changes no build state; the robot says to turn it", a.length === 0 && (await st()).lines.includes("hands.gpuTurn"), JSON.stringify(a));
  await lab.getByRole("button", { name: /Turn it round|لف|دوّر/ }).first().click(); await page.waitForTimeout(700);
  a = await step(); seen.push(...a);
  ok("after turning it, the card goes in as one step", a.length === 1 && a[0] === "lower:gpu", JSON.stringify(a));
  // Double click: one screw only.
  const n = (await st()).history.length;
  await primary().dblclick(); await page.waitForTimeout(1500);
  const h = (await st()).history.slice(n);
  ok("a double click on the screw button is one screw", h.length === 1 && h[0] === "screw:gpu:0", JSON.stringify(h));
  a = await step(); seen.push(...a);
  ok("the second bracket screw is its own step and the card is installed", a.length === 1 && a[0] === "screw:gpu:1" && (await st()).placed.includes("gpu"), JSON.stringify(a));
  ok("the camera never moved on its own", (await cam()) === cam0, `${cam0} -> ${await cam()}`);
  await page.reload(); await page.waitForSelector("canvas"); await page.waitForTimeout(5000);
  ok("reload keeps the installed card", (await st()).placed.includes("gpu"));
  await ctx.close();
} catch (e) { ok("script completed without an exception", false, String(e).split("\n")[0]); }
finally { await browser.close().catch(() => {}); }
ok("no page errors", errors.length === 0, errors.join(" | "));
console.log(`${pass} passed, ${fail} failed`);
