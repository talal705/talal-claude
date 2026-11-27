// Graphics card on the real page from seeded saves, isolated browser context (never the owner's storage).
// Install (every part but the card fitted): slot covers one at a time, latch, turn, seat, bracket screws one per click.
// Removal and reinstall (everything fitted and wired): power and side-panel guards, only the card's lead end out,
// screws one per click, latch, straight lift, undo and reload part-way, then fitted and plugged again.
// Seeds: npx vitest run --config docs/handoff/2026-11-26/acceptance/seed.config.mjs   Usage: node gpu-install.mjs [en|ar] [width] [base]
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const locale = process.argv[2] ?? "en", width = Number(process.argv[3] ?? 1440), base = process.argv[4] ?? "http://127.0.0.1:3002";
const seed = JSON.parse(readFileSync(process.env.VTE_SEED ?? join(tmpdir(), "vte-seed.json"), "utf8"));
const T = JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../apps/web/messages/${locale}/labs.json`, import.meta.url)), "utf8")).simplePc;
const shot = (n) => join(process.env.VTE_SHOTS ?? tmpdir(), `${n}-${locale}-${width}.png`);
const prefix = (text) => new RegExp("^" + text.split("{")[0].trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
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
  await lab.getByRole("button", { name: T.hands.flip, exact: true }).first().click(); await page.waitForTimeout(700);
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
// Removal and reinstall, from a build with every part and lead in.
try {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 900 : 1000 } });
  await ctx.addCookies([{ name: "ytl_locale", value: locale, url: base }]);
  await ctx.addInitScript(([plan, snap]) => { if (!localStorage.getItem("__seeded")) { localStorage.setItem("__seeded", "1"); localStorage.setItem("ytl_pc_plan_v1", JSON.stringify({ build: plan, phase: "assemble" })); localStorage.setItem("ytl_pc_plan_progress_v1", JSON.stringify(snap)); } }, [seed.plan, seed.allWhole]);
  const page = await ctx.newPage(); page.setDefaultTimeout(60000);
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "/pc"); await page.waitForSelector("canvas"); await page.waitForTimeout(5000);
  const lab = page.locator("section[aria-labelledby='simple-pc-title']");
  const st = () => page.evaluate(() => window.__ytlSimplePc());
  const cam = () => page.evaluate(() => JSON.stringify(window.__ytlCamera?.() ?? null));
  const hist = async () => (await st()).history;
  const bubble = async () => (await lab.locator("[class*=bubble]").first().innerText()).replace(/\s+/g, " ").trim();
  const btn = (name) => lab.getByRole("button", { name }).first();
  const click = async (l) => { await l.evaluate((el) => el.scrollIntoView({ block: "center" })); await l.click(); await page.waitForTimeout(800); };
  /** Clicks once and returns the saved steps it added. */
  const take = async (l) => { const n = (await hist()).length; await click(l); const added = (await hist()).slice(n); acted += 1; await steady(added.join(",") || "a refused click"); return added; };
  const tab = (name) => click(lab.locator("button[aria-pressed]").filter({ hasText: name }).first());
  const card = () => lab.locator("[role=group] button:has(img)").filter({ hasText: /RTX 5060/ }).first();
  // The card's own controls sit in the folded "part options" under its tile.
  const selectCard = async () => {
    await tab(T.partsTab);
    // Clicking the tile of the part already in hand puts it down again.
    if ((await st()).selection?.key !== "gpu") await click(card());
    const options = lab.locator("details").first();
    if ((await options.count()) && !(await options.evaluate((el) => el.open))) await click(options.locator("summary"));
  };
  const selectLead = async () => { await tab(T.cablesTab); if ((await st()).selection?.key !== "gpuPower") await click(btn(new RegExp(T.cables.gpuPower.name))); };
  const panel = () => lab.locator("[class*=cableDetail]");
  const outs = () => panel().getByRole("button", { name: prefix(T.hands.unplugEnd) });
  const unscrew = () => btn(prefix(T.hands.unscrewNext));
  const release = () => lab.getByRole("button", { name: T.hands.releasePcie });
  const lift = () => lab.getByRole("button", { name: T.hands.liftOut, exact: true });
  const undo = () => click(btn(new RegExp(T.undo)));
  const snapshot = async () => { const s = await st(); return JSON.stringify([s.history, s.placed, s.connected, s.powered]); };
  /** With the panel closed, `attempt` must leave the saved steps and the build exactly as they were. */
  const refused = async (name, attempt, reselect) => {
    await click(btn(T.ready.do.panel.closed));
    await reselect();
    const was = await snapshot();
    await attempt();
    await steady(`refused ${name}`);
    ok(`panel closed: ${name} changes neither the saved steps nor the build, and the robot says why`, (await snapshot()) === was && (await bubble()).includes(T.companion.hands.caseShut), await bubble());
    await click(btn(T.ready.do.panel.open));
    await reselect();
  };
  const before = await st();
  // The view is framed once per page load (it can differ with the card out), so it is compared within each load:
  // every action between two loads must leave it exactly where that load put it.
  let framed = await cam();
  const moved = [];
  const steady = async (after) => { const now = await cam(); if (now !== framed) { moved.push(`after ${after}: ${framed} -> ${now}`); framed = now; } };
  let acted = 0;
  const load = async () => { await page.reload(); await page.waitForSelector("canvas"); await page.waitForTimeout(5000); return cam(); };
  const reload = async () => { await steady("last action"); framed = await load(); };
  /** The framing a load gives is a function of what is on show: loading the same build twice frames it the same. */
  const sameFraming = async () => { const again = await load(); ok("loading the same build again frames it the same", again === framed, `${framed} -> ${again}`); framed = again; };

  // Powered on: nothing comes apart.
  for (const label of [T.ready.do.panel.closed, T.ready.do.wall.in, T.ready.do.psu.on, T.ready.press]) await click(btn(label));
  ok("the build powers on", (await st()).powered);
  let n = (await hist()).length;
  await selectLead();
  const outCount = await outs().count();
  const outDisabled = outCount === 0 || await outs().first().isDisabled();
  await selectCard();
  ok("while running, the card's lead cannot be taken out and no step is saved", outDisabled && (await hist()).length === n);
  ok("while running, the robot says to turn the PC off", (await bubble()).length > 0 && (await st()).lines.some((l) => /turnOff/i.test(l)), JSON.stringify((await st()).lines));
  await click(btn(T.ready.off));
  ok("turn off is one saved step", !(await st()).powered && (await hist()).at(-1) === "sys:power:off");

  // Off, but the side panel is still closed: nothing inside the case moves.
  await selectLead();
  n = (await hist()).length;
  await click(outs().nth(1));
  ok("with the side panel closed the lead is not taken out, and the robot says to open it", (await hist()).length === n && (await bubble()).includes(T.companion.hands.caseShut), await bubble());
  await selectCard();
  await click(unscrew());
  ok("with the side panel closed a bracket screw stays in", (await hist()).length === n && (await st()).placed.includes("gpu"), (await hist()).at(-1));
  await page.screenshot({ path: shot("gpu-panel-shut") });
  const opened = await take(btn(T.ready.do.panel.open));
  ok("opening the side panel is its own step", opened.length === 1 && opened[0] === "sys:panel:open", JSON.stringify(opened));

  // Only the card's end of its lead comes out.
  const wired = (await st()).connected;
  await selectLead();
  ok("each end of the card's lead has its own take-out", (await outs().count()) === 2);
  let a = await take(outs().nth(1));
  ok("one click takes out only the card's end; the supply end and every other lead stay", a.length === 1 && a[0] === "unplug:gpuPower:1" && (await outs().count()) === 1
    && JSON.stringify((await st()).connected) === JSON.stringify(wired.filter((k) => k !== "gpuPower")), JSON.stringify(a));

  // Screws, one per click; the latch and lift are not offered while they hold the card.
  await selectCard();
  ok("while screwed, neither the latch nor lifting is offered", (await release().count()) === 0 && (await lift().count()) === 0);
  n = (await hist()).length;
  await unscrew().evaluate((el) => el.scrollIntoView({ block: "center" })); await unscrew().dblclick(); await page.waitForTimeout(1500);
  ok("a double click on take-out-screw is one screw", (await hist()).length === n + 1, JSON.stringify((await hist()).slice(n)));
  const mid = JSON.stringify(await hist());
  await reload(); await selectCard();
  ok("reload with one screw out keeps it; one screw still holds the card", JSON.stringify(await hist()) === mid && (await unscrew().count()) === 1 && (await release().count()) === 0 && (await lift().count()) === 0);
  await undo(); await selectCard();
  ok("undo puts that one screw back", (await hist()).length === n);
  a = await take(unscrew()); const b2 = await take(unscrew());
  ok("two screws come out as two separate steps", a.length === 1 && b2.length === 1 && (await lift().count()) === 0, JSON.stringify([a, b2]));
  ok("with the latch still shut, lifting is not offered", (await lift().count()) === 0 && (await release().count()) === 1);
  await refused("releasing the latch", () => click(release()), selectCard);
  a = await take(release());
  ok("releasing the PCIe latch is its own step and the card stays in", a.length === 1 && /pcie-x16-1-latch:open$/.test(a[0]) && (await st()).placed.includes("gpu"), JSON.stringify(a));
  await refused("lifting the card", () => click(lift()), selectCard);
  const beforeLift = await hist();
  a = await take(lift());
  ok("lifting the card straight out is one step", a.length === 1 && a[0] === "lift:gpu" && !(await st()).placed.includes("gpu"), JSON.stringify(a));
  await page.screenshot({ path: shot("gpu-lifted") });
  ok("nothing else moved: same other parts and leads, covers stay out", JSON.stringify((await st()).placed) === JSON.stringify(before.placed.filter((k) => k !== "gpu"))
    && JSON.stringify((await st()).connected) === JSON.stringify(before.connected.filter((k) => k !== "gpuPower")) && !(await hist()).slice(before.history.length).some((x) => x.includes("slot-covers")));
  await reload();
  ok("reload keeps the card out", !(await st()).placed.includes("gpu"));
  await sameFraming();
  const lifted = await hist();
  await undo(); await selectCard();
  const back = await hist();
  ok("undo of the lift removes exactly that one step", back.length === lifted.length - 1 && JSON.stringify(back) === JSON.stringify(beforeLift), JSON.stringify(back.slice(-3)));
  ok("and the card is back in its slot as it was: unscrewed, latch released, ready to lift", (await st()).placed.includes("gpu") && (await lift().count()) === 1 && (await release().count()) === 0 && (await unscrew().count()) === 0);
  a = await take(lift());
  ok("lifting again is one step", a.length === 1 && a[0] === "lift:gpu", JSON.stringify(a));

  // Back in: each click one step at most, then the lead's card end.
  await selectCard();
  const primary = () => lab.locator("[class*=toolPrimary]").first();
  const deltas = [];
  // "placed" turns true as soon as the card sits in its slot, so the loop runs until both bracket screws are saved.
  const screwed = () => deltas.flat().filter((x) => x.startsWith("screw:gpu")).length;
  let triedShutScrew = false;
  for (let i = 0; i < 10 && screwed() < 2; i += 1) {
    if (!triedShutScrew && deltas.flat().includes("lower:gpu")) { triedShutScrew = true; await refused("putting a bracket screw in", () => click(primary()), selectCard); }
    const d = await take(primary()); deltas.push(d);
    if (!d.length && (await st()).lines.includes("hands.gpuTurn")) await click(lab.getByRole("button", { name: T.hands.flip, exact: true }).first());
  }
  ok("reinstalled one step per click: seated, then each screw", (await st()).placed.includes("gpu") && deltas.every((d) => d.length <= 1) && screwed() === 2 && deltas.flat()[0] === "lower:gpu", JSON.stringify(deltas));
  ok("the lead is still out until it is plugged by hand", !(await st()).connected.includes("gpuPower"));
  await selectLead();
  const aimPlug = async () => {
    await selectLead(); await click(panel().getByRole("radio").first());
    if (await panel().getByText(T.hands.plugReversed).count()) await click(panel().getByRole("button", { name: T.hands.turnPlug }));
  };
  await aimPlug();
  await refused("plugging the card's lead", () => click(panel().getByRole("button", { name: T.hands.plugIn })), aimPlug);
  a = await take(panel().getByRole("button", { name: T.hands.plugIn }));
  ok("plugging the card's end is one step and the lead is connected again", a.length === 1 && /^plug:gpuPower:1@/.test(a[0]) && (await st()).connected.includes("gpuPower"), JSON.stringify(a));
  await steady("the end");
  ok(`the camera stayed put after each of the ${acted} single actions and every refused one`, moved.length === 0 && acted >= 8, moved.join(" | "));
  await page.screenshot({ path: shot("gpu-reinstalled") });
  await ctx.close();
} catch (e) { ok("removal section completed without an exception", false, String(e).split("\n")[0]); }
await browser.close().catch(() => {});
ok("no page errors", errors.length === 0, errors.join(" | "));
console.log(`${pass} passed, ${fail} failed`);
