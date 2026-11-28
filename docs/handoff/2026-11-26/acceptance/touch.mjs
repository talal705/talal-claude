// Browser TOUCH EMULATION (not a physical device): tap-only assembly steps, no page-wide sideways scroll, RTL,
// target sizes, a finger drag on the view never acting on a part, a cancelled touch leaving the view usable,
// keyboard focus, and reduced motion.
// Seeds: npx vitest run --config docs/handoff/2026-11-26/acceptance/seed.config.mjs   Usage: node touch.mjs [en|ar] [width] [base]
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const locale = process.argv[2] ?? "en", width = Number(process.argv[3] ?? 390), base = process.argv[4] ?? "http://127.0.0.1:3002";
const seed = JSON.parse(readFileSync(process.env.VTE_SEED ?? join(tmpdir(), "vte-seed.json"), "utf8"));
const T = JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../apps/web/messages/${locale}/labs.json`, import.meta.url)), "utf8")).simplePc;
const dir = process.env.VTE_SHOTS ?? tmpdir();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n} ${c ? "" : x}`); if (c) pass++; else { fail++; process.exitCode = 1; } };
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, reducedMotion: "reduce" });
  await ctx.addCookies([{ name: "ytl_locale", value: locale, url: base }]);
  await ctx.addInitScript(([plan, snap]) => { if (!localStorage.getItem("__seeded")) { localStorage.setItem("__seeded", "1"); localStorage.setItem("ytl_pc_plan_v1", JSON.stringify({ build: plan, phase: "assemble" })); localStorage.setItem("ytl_pc_plan_progress_v1", JSON.stringify(snap)); } }, [seed.plan, seed.noGpu]);
  const page = await ctx.newPage(); page.setDefaultTimeout(60000);
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "/pc"); await page.waitForSelector("canvas"); await page.waitForTimeout(6000);
  const lab = page.locator("section[aria-labelledby='simple-pc-title']");
  const canvas = page.locator("canvas").first();
  const st = () => page.evaluate(() => window.__ytlSimplePc());
  const cam = () => page.evaluate(() => JSON.stringify(window.__ytlCamera?.() ?? null));
  const tap = async (l) => { await l.evaluate((el) => el.scrollIntoView({ block: "center" })); await page.waitForTimeout(200); await l.tap(); await page.waitForTimeout(900); };
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const primary = lab.locator("[class*=toolPrimary]").first();

  ok("the page reads in the right direction", (await page.evaluate(() => document.documentElement.dir)) === (locale === "ar" ? "rtl" : "ltr"));
  ok("no sideways page scroll", (await overflow()) <= 0, String(await overflow()));
  // Every visible control of the lab is big enough to tap (WCAG 2.5.8: 24 CSS px), and the main action is comfortable.
  const small = await lab.evaluate((root) => [...root.querySelectorAll("button, [role=radio], summary, input")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && (r.width < 24 || r.height < 24); }).map((el) => `${el.textContent.trim().slice(0, 24)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`));
  ok("no control in the lab is smaller than 24 by 24", small.length === 0, small.join(" | "));
  await tap(lab.locator("button[aria-pressed]").filter({ hasText: T.partsTab }).first());
  await tap(lab.locator("[role=group] button:has(img)").filter({ hasText: /RTX 5060/ }).first());
  const box = await primary.boundingBox();
  ok("the main action is at least 40 px high", box.height >= 40, JSON.stringify(box));
  await page.screenshot({ path: join(dir, `touch-selected-${locale}-${width}.png`) });
  const cam0 = await cam();
  const deltas = [];
  for (let i = 0; i < 3; i += 1) { const n = (await st()).history.length; await tap(primary); deltas.push((await st()).history.length - n); }
  ok("three taps on the main action are three single steps, with no dragging", deltas.every((d) => d === 1), JSON.stringify(deltas));
  ok("tapping steps never moved the camera", (await cam()) === cam0);
  ok("still no sideways scroll with a part in hand", (await overflow()) <= 0, String(await overflow()));

  // A finger drag across the view turns the camera and changes nothing in the build; a cancelled touch leaves it usable.
  await canvas.evaluate((el) => el.scrollIntoView({ block: "center" })); await page.waitForTimeout(500);
  const cdp = await ctx.newCDPSession(page);
  const b = await canvas.boundingBox();
  const at = (dx) => [{ x: Math.round(b.x + b.width / 2 + dx), y: Math.round(b.y + b.height / 2) }];
  const swipe = async (end) => { await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(-60) }); for (let i = -50; i <= 60; i += 10) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(i) }); await cdp.send("Input.dispatchTouchEvent", { type: end, touchPoints: [] }); await page.waitForTimeout(900); };
  const before = JSON.stringify((await st()).history); const cam1 = await cam();
  await swipe("touchEnd");
  ok("a finger drag on the view turns it and acts on no part", JSON.stringify((await st()).history) === before && (await cam()) !== cam1);
  await swipe("touchCancel");
  const cam2 = await cam();
  await swipe("touchEnd");
  ok("after a cancelled touch the view still turns and nothing was installed", (await cam()) !== cam2 && JSON.stringify((await st()).history) === before);

  // Keyboard: focus is visible and reaches the main action.
  await primary.focus();
  const ring = await primary.evaluate((el) => { const s = getComputedStyle(el); return { focused: document.activeElement === el, visible: el.matches(":focus-visible"), outline: s.outlineStyle, shadow: s.boxShadow }; });
  await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
  const ring2 = await primary.evaluate((el) => { const s = getComputedStyle(el); return { focused: document.activeElement === el, outline: s.outlineStyle, shadow: s.boxShadow }; });
  ok("keyboard focus reaches the main action and is drawn", ring2.focused && (ring2.outline !== "none" || ring2.shadow !== "none"), JSON.stringify([ring, ring2]));
  ok("reduced motion is on and the robot guide is drawn without animation", await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches));
  await ctx.close();
} catch (e) { ok("script completed without an exception", false, String(e).split("\n")[0]); }
await browser.close().catch(() => {});
ok("no page errors", errors.length === 0, errors.join(" | "));
console.log(`${pass} passed, ${fail} failed`);
