// Exploratory helper: opens the assembled page from a seeded save (isolated context) and prints the cable controls.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const base = "http://127.0.0.1:3002";
const seed = JSON.parse(readFileSync("/private/tmp/vte-seed.json", "utf8"));
const which = process.argv[2] ?? "unwired", locale = process.argv[3] ?? "en", width = Number(process.argv[4] ?? 1440);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
await ctx.addCookies([{ name: "ytl_locale", value: locale, url: base }]);
await ctx.addInitScript(([plan, snap]) => { if (!localStorage.getItem("__seeded")) { localStorage.setItem("__seeded", "1"); localStorage.setItem("ytl_pc_plan_v1", JSON.stringify({ build: plan, phase: "assemble" })); localStorage.setItem("ytl_pc_plan_progress_v1", JSON.stringify(snap)); } }, [seed.plan, seed[which]]);
const page = await ctx.newPage(); page.setDefaultTimeout(120000);
page.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
await page.goto(base + "/pc"); await page.waitForSelector("canvas"); await page.waitForTimeout(6000);
console.log(JSON.stringify(await page.evaluate(() => { const s = window.__ytlSimplePc(); return { placed: s.placed, connected: s.connected, powered: s.powered, history: s.history.length }; })));
console.log(await page.locator("section[aria-labelledby='simple-pc-title']").innerText());
await page.screenshot({ path: `/private/tmp/vte-shots/explore-${which}-${locale}.png`, fullPage: false });
await browser.close();
