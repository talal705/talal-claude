// Stage 10/11 acceptance on the real production page, from isolated seeded saves (fresh browser context, no owner storage).
// Seeds: npx vitest run --config docs/handoff/2026-11-26/acceptance/seed.config.mjs  (writes VTE_SEED or <tmp>/vte-seed.json)
// Usage: node wiring-startup.mjs [en|ar] [width] [base url]     Chrome: CHROME=<path> else Playwright's Chromium.
// Any exception or timeout fails the run (exit code 1); the browser is always closed.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const locale = process.argv[2] ?? "en", width = Number(process.argv[3] ?? 1440), base = process.argv[4] ?? "http://127.0.0.1:3002";
const seed = JSON.parse(readFileSync(process.env.VTE_SEED ?? join(tmpdir(), "vte-seed.json"), "utf8"));
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const T = JSON.parse(readFileSync(`${root}apps/web/messages/${locale}/labs.json`, "utf8")).simplePc;
const shotDir = process.env.VTE_SHOTS ?? join(tmpdir(), "vte-shots");
mkdirSync(shotDir, { recursive: true });
const shot = (n) => join(shotDir, `${n}-${locale}-${width}.png`);
const TAKE_OUT = T.hands.unplugEnd.split("{")[0].trim();
let pass = 0, fail = 0, section = "start";
const ok = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n} ${c ? "" : x}`); if (c) pass++; else { fail++; process.exitCode = 1; } };
const errors = [];
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

async function open(which) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 900 : 1000 } });
  await ctx.addCookies([{ name: "ytl_locale", value: locale, url: base }]);
  await ctx.addInitScript(([plan, snap]) => { if (!localStorage.getItem("__seeded")) { localStorage.setItem("__seeded", "1"); localStorage.setItem("ytl_pc_plan_v1", JSON.stringify({ build: plan, phase: "assemble" })); localStorage.setItem("ytl_pc_plan_progress_v1", JSON.stringify(snap)); } }, [seed.plan, seed[which]]);
  const page = await ctx.newPage(); page.setDefaultTimeout(60000);
  page.on("pageerror", (e) => errors.push(`[${section}] ${String(e)} ${(e.stack ?? "").split("\n").slice(1, 4).join(" ")}`));
  await page.goto(base + "/pc"); await page.waitForSelector("canvas"); await page.waitForTimeout(5000);
  const lab = page.locator("section[aria-labelledby='simple-pc-title']");
  const h = {
    ctx, page, lab,
    st: () => page.evaluate(() => window.__ytlSimplePc()),
    cam: () => page.evaluate(() => JSON.stringify(window.__ytlCamera?.() ?? null)),
    hist: async () => (await h.st()).history,
    btn: (name) => lab.getByRole("button", { name, exact: false }).first(),
    settle: (ms = 700) => page.waitForTimeout(ms),
    click: async (l) => { await l.evaluate((el) => el.scrollIntoView({ block: "center" })); await l.click(); await h.settle(); },
    bubble: async () => (await lab.locator("[class*=bubble]").first().innerText()).replace(/\s+/g, " ").trim(),
    reload: async () => { await page.reload(); await page.waitForSelector("canvas"); await page.waitForTimeout(5000); },
    lead: (name) => h.click(h.btn(name instanceof RegExp ? name : new RegExp(name))),
    panel: () => lab.locator("[class*=cableDetail]"),
    radios: () => h.panel().getByRole("radio"),
    undo: () => h.click(h.btn(new RegExp(T.undo ?? "Undo"))),
    shot: (name) => page.screenshot({ path: shot(name) }),
  };
  return h;
}
const plug = async (h, { turn = true } = {}) => {
  if (turn) await h.click(h.panel().getByRole("button", { name: T.hands.turnPlug }));
  await h.click(h.panel().getByRole("button", { name: T.hands.plugIn }));
};
/** Runs one section; an exception or timeout is a failure, and its browser context is always closed. */
async function run(name, which, body) {
  section = name;
  let h;
  try { h = await open(which); await body(h); }
  catch (e) { ok(`section ${name} completed without an exception`, false, String(e).split("\n")[0]); }
  finally { await h?.ctx.close().catch(() => {}); }
}
const SATA = locale === "ar" ? "SATA" : "SATA data 1";

try {
  await run("A", "unwired", async (h) => {
    await h.lead(SATA);
    const first = (await h.hist()).length, cam0 = await h.cam();
    await h.click(h.radios().first());
    await h.click(h.panel().getByRole("button", { name: T.hands.plugIn }));
    ok("a reversed plug is refused, no step is saved", (await h.hist()).length === first, await h.bubble());
    await plug(h);
    let hist = await h.hist();
    ok("drive end saved with its actual socket", /^plug:sataData1:0@/.test(hist.at(-1)), hist.at(-1));
    ok("a partly connected lead is not counted connected", !(await h.st()).connected.includes("sataData1"));
    ok("the board end offers several equivalent sockets", (await h.radios().count()) >= 3);
    await h.click(h.radios().nth(1));
    const g = (await h.st()).guide;
    ok("the robot points at the socket the learner picked", /sata-2$/.test(g?.targets?.[0]?.placeId ?? ""), JSON.stringify(g?.targets));
    await h.shot("wiring-ends");
    await plug(h);
    const alt = (await h.hist()).at(-1);
    ok("the alternate socket is accepted and recorded as chosen", /^plug:sataData1:1@sata-2$/.test(alt), alt);
    ok("the lead is now connected", (await h.st()).connected.includes("sataData1"));
    await h.reload();
    ok("reload keeps the same actual socket", (await h.hist()).at(-1) === alt);
    await h.lead(SATA);
    const outs = h.panel().getByRole("button", { name: TAKE_OUT });
    ok("each connected end has its own take-out button", (await outs.count()) === 2);
    await h.click(outs.nth(1));
    hist = await h.hist();
    ok("one take-out saves exactly one unplug step", hist.at(-1) === "unplug:sataData1:1" && !(await h.st()).connected.includes("sataData1"), hist.at(-1));
    ok("the other end stays in", (await h.panel().getByRole("button", { name: TAKE_OUT }).count()) === 1);
    await h.reload();
    ok("reload agrees: one end out", (await h.hist()).at(-1) === "unplug:sataData1:1");
    await h.undo();
    ok("undo puts that end back into its socket", (await h.hist()).at(-1) === alt && (await h.st()).connected.includes("sataData1"));
    ok("the camera never moved on its own through selecting, plugging, removing and undoing", (await h.cam()) === cam0, `${cam0} -> ${await h.cam()}`);
  });

  // A2. A look-alike socket of the wrong kind: turned the right way, it is still refused with a reason.
  await run("A2", "unwired", async (h) => {
    await h.lead(T.cables.atx.name);
    const n = (await h.hist()).length;
    await h.click(h.radios().first());
    await plug(h);
    ok("modular lead: PSU end plugs first", (await h.hist()).length === n + 1 && /^plug:atx:0@/.test((await h.hist()).at(-1)));
    const labels = await h.radios().allInnerTexts();
    ok("the board end lists its 24-pin socket first and look-alike sockets after", labels.length >= 2, JSON.stringify(labels));
    await h.click(h.radios().nth(1)); // an EPS/other socket: another connector kind
    await h.click(h.panel().getByRole("button", { name: T.hands.turnPlug }));
    ok("the plug is turned the right way before the wrong socket is tried", (await h.panel().getByText(T.hands.plugMatched).count()) === 1);
    const before = await h.hist();
    await h.click(h.panel().getByRole("button", { name: T.hands.plugIn }));
    const after = await h.hist(), said = await h.bubble();
    ok("the wrong-kind socket is refused: history unchanged, lead not connected", JSON.stringify(after) === JSON.stringify(before) && !(await h.st()).connected.includes("atx"), after.at(-1));
    ok("and the robot gives a reason, not the success line", said.length > 0 && said !== T.companion.hands.endIn && !said.includes(T.companion.hands.endIn), said);
    await h.shot("wiring-wrong-socket");
  });

  // A3. A real occupied-socket refusal: the fan header another lead already uses.
  await run("A3", "unwired", async (h) => {
    await h.lead(T.cables.caseFan1.name);
    await h.click(h.radios().nth(1));
    await plug(h);
    const used = (await h.hist()).at(-1);
    ok("case fan 1 plugged into an alternate header, recorded", /^plug:caseFan1:\d@cha-fan-/.test(used), used);
    await h.lead(T.cables.caseFan2.name);
    const taken = h.panel().getByRole("radio").filter({ hasText: T.hands.positionTag.taken });
    ok("the header in use is marked as taken for the next lead", (await taken.count()) === 1, String(await taken.count()));
    const before = await h.hist();
    await h.click(taken.first());
    await plug(h);
    ok("an occupied socket is refused: no step saved, lead not connected", JSON.stringify(await h.hist()) === JSON.stringify(before) && !(await h.st()).connected.includes("caseFan2"), (await h.hist()).at(-1));
    ok("with a reason from the engine", (await h.bubble()).length > 0);
    await h.shot("wiring-occupied");
  });

  // B. A lead saved whole (older cable step): remove one end, the other stays; a double click is one step.
  await run("B", "allWhole", async (h) => {
    await h.lead(SATA);
    const outs = h.panel().getByRole("button", { name: TAKE_OUT });
    ok("older whole-lead save shows take-out for each end", (await outs.count()) === 2);
    const n = (await h.hist()).length;
    await outs.first().evaluate((el) => el.scrollIntoView({ block: "center" }));
    await outs.first().dblclick(); await h.settle(1200);
    const hist = await h.hist();
    ok("a double click on take-out is one step", hist.length === n + 1, `${hist.length - n} steps`);
    ok("history keeps the whole-lead step and adds one unplug", hist.includes("cable:sataData1") && hist.at(-1) === "unplug:sataData1:0", hist.at(-1));
    ok("the lead no longer counts as connected, the other end remains", !(await h.st()).connected.includes("sataData1") && (await h.panel().getByRole("button", { name: TAKE_OUT }).count()) === 1);
  });

  // B2. Choosing another loose end connects nothing, keeps the camera, and does not inherit the old plug orientation.
  await run("B2", "unwired", async (h) => {
    await h.lead(SATA);
    const n = (await h.hist()).length, cam0 = await h.cam();
    await h.click(h.panel().getByRole("button", { name: T.hands.turnPlug }));
    ok("plug turned for the first end", (await h.panel().getByText(T.hands.plugMatched).count()) === 1);
    const endButton = h.panel().locator("li button[aria-pressed=false]").first();
    ok("a second loose end can be chosen by clicking it", (await endButton.count()) === 1);
    await h.click(endButton);
    ok("choosing an end connects nothing and keeps the camera", (await h.hist()).length === n && (await h.cam()) === cam0);
    ok("the other plug starts turned the wrong way again", (await h.panel().getByText(T.hands.plugReversed).count()) === 1);
    ok("the robot now points at the board's sockets", /^motherboard/.test((await h.st()).guide?.targets?.[0]?.hostInstanceId ?? ""), JSON.stringify((await h.st()).guide?.targets));
  });

  // C. Readiness: refusal, steps, success, off, undo, reload; the real Readiness group is captured.
  await run("C", "allWhole", async (h) => {
    const group = h.lab.locator("[class*=readiness]");
    const cam0 = await h.cam();
    const snap = async (name) => { await group.scrollIntoViewIfNeeded(); await h.settle(300); await group.screenshot({ path: shot(name) }); };
    await snap("readiness-start");
    await h.click(h.lab.getByRole("button", { name: T.ready.press }));
    let s = await h.st();
    ok("pressing power before the switches reports a failure and changes nothing", !s.powered && (await h.hist()).every((x) => !x.startsWith("sys:")));
    ok("the failure says what to do first", (await h.lab.getByText(T.ready.fixFirst.split("{")[0].trim()).count()) >= 1);
    await snap("readiness-failed");
    for (const label of [T.ready.do.panel.closed, T.ready.do.wall.in, T.ready.do.psu.on]) await h.click(h.lab.getByRole("button", { name: label }));
    ok("each switch is its own saved step", JSON.stringify((await h.hist()).filter((x) => x.startsWith("sys:"))) === JSON.stringify(["sys:panel:closed", "sys:wall:in", "sys:psu:on"]));
    await h.click(h.lab.getByRole("button", { name: T.ready.press }));
    s = await h.st();
    ok("power on: the engine says it works, saved as a step", s.powered && (await h.hist()).at(-1) === "sys:power:on");
    await snap("readiness-running");
    const flips = [T.ready.do.panel.open, T.ready.do.wall.out, T.ready.do.psu.off];
    ok("while running, the other switches are disabled and the hint says so", (await Promise.all(flips.map((f) => h.lab.getByRole("button", { name: f }).isDisabled()))).every(Boolean) && (await group.getByText(T.ready.running).count()) === 1);
    await h.reload();
    ok("reload: still running, controls agree", (await h.st()).powered && (await h.lab.getByRole("button", { name: T.ready.off }).isEnabled()));
    await h.click(h.lab.getByRole("button", { name: T.ready.off }));
    ok("turn off is a saved step", !(await h.st()).powered && (await h.hist()).at(-1) === "sys:power:off");
    await snap("readiness-off");
    await h.reload();
    ok("reload: stays off", !(await h.st()).powered);
    await h.undo();
    ok("undo of the power-off runs the PC again, consistently", (await h.st()).powered && (await h.lab.getByRole("button", { name: T.ready.off }).isEnabled()));
    ok("the camera was stable through the readiness steps", (await h.cam()) === cam0, `${cam0} -> ${await h.cam()}`);
  });

  // D. An unfitted optional fan does not stop startup; booting is not finishing.
  await run("D", "essentialNoFan", async (h) => {
    for (const label of [T.ready.do.panel.closed, T.ready.do.wall.in, T.ready.do.psu.on]) await h.click(h.lab.getByRole("button", { name: label }));
    await h.click(h.lab.getByRole("button", { name: T.ready.press }));
    const s = await h.st();
    ok("boots without the optional fan", s.powered, JSON.stringify(s.lines));
    ok("and it is not reported as a finished build", !s.complete);
    await h.shot("optional-boot");
  });

  // E. Fault finder: the wrong-header fault (power switch in the reset header) is unplugged and reconnected end by end.
  await run("E", "allWhole", async (h) => {
    let found = false;
    for (let i = 0; i < 25 && !found; i++) {
      await h.click(h.lab.getByText(T.modes.guided, { exact: true }).first());
      await h.click(h.lab.getByText(T.modes.fault, { exact: true }).first());
      found = (await h.st()).fault === "frontPanelWrong";
    }
    ok("the wrong-header fault was reached by re-rolling", found, String((await h.st()).fault));
    if (found) {
      await h.lead(T.cables.powerSwitch.name);
      const outs = h.panel().getByRole("button", { name: TAKE_OUT });
      ok("the wrongly plugged end has its take-out button", (await outs.count()) === 1);
      await h.click(outs.first());
      ok("it comes out and the lead is loose", (await outs.count()) === 0);
      await h.click(h.radios().first());
      await plug(h);
      ok("it goes back into the right header: the lead completes and its panel closes", (await h.st()).selection === null && (await h.panel().count()) === 0);
      await h.click(h.lab.getByRole("button", { name: T.power }));
      ok("the fault is then solved by the real engine", (await h.st()).faultSolved === true);
    }
  });
} finally {
  await browser.close().catch(() => {});
}
ok("no page errors", errors.length === 0, errors.join(" | "));
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
