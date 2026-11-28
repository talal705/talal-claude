// A fresh learner's journey: planner -> individual assembly clicks -> wiring -> startup.
// No saved assembly is seeded and no engine mutation is called from the browser.
// Usage: node release-journey.mjs [en|ar] [width] [base URL]
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const locale = process.argv[2] ?? "en", width = Number(process.argv[3] ?? 1440);
const base = process.argv[4] ?? "http://127.0.0.1:3027";
const T = JSON.parse(readFileSync(new URL(`../../../../apps/web/messages/${locale}/labs.json`, import.meta.url))).simplePc;
const P = T.planner, H = T.hands;
const artifacts = process.env.VTE_SHOTS ?? "/private/tmp/vte-release-journey";
mkdirSync(artifacts, { recursive: true });
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let passed = 0, failed = 0;
function check(name, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : `: ${detail}`}`);
  if (condition) passed++; else { failed++; process.exitCode = 1; }
}
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width, height: width < 600 ? 900 : 1000 } });
await context.addCookies([{ name: "ytl_locale", value: locale, url: base }]);
const page = await context.newPage();
page.setDefaultTimeout(25000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const click = async (locator) => {
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
  await page.waitForTimeout(600);
};
const plan = () => page.evaluate(() => JSON.parse(localStorage.getItem("ytl_pc_plan_v1") ?? "null")?.build);
const snapshot = () => page.evaluate(() => JSON.parse(localStorage.getItem("ytl_pc_plan_progress_v1") ?? "null"));
const state = () => page.evaluate(() => window.__ytlSimplePc());
const camera = () => page.evaluate(() => JSON.stringify(window.__ytlCamera?.() ?? null));
const lab = page.locator("section[aria-labelledby='simple-pc-title']");
const toolbar = lab.locator("[class*=toolbar]").first();
const primary = lab.locator("[class*=toolPrimary]");
const options = lab.locator("details").first();
const tile = (name) => lab.getByRole("group", { name: T.partsLabel, exact: true }).getByRole("button").filter({ hasText: name }).first();
async function controls() {
  if (!(await options.evaluate((el) => el.open))) await click(options.locator("summary"));
}
async function select(name) {
  await click(tile(name));
  await controls();
  return (await state()).selection.key;
}
async function capture(name) {
  try { await options.screenshot({ path: join(artifacts, `${name}-${locale}-${width}.png`), timeout: 15000 }); }
  catch (e) { console.log(`SKIP screenshot ${name}: ${String(e).split("\n")[0]}`); }
}
async function fit(name, { slot, preparation = [] } = {}) {
  const beforeCamera = await camera();
  const key = await select(name);
  if (slot) await click(toolbar.getByRole("button").filter({ hasText: slot }).first());
  for (const label of preparation) await click(options.getByRole("button", { name: label, exact: true }));
  let refused = 0;
  for (let i = 0; i < 60; i++) {
    const before = await state();
    if (before.placed.includes(key) && before.selection === null) {
      check(`${key}: fitted through individual clicks`, true);
      check(`${key}: camera remains unchanged`, (await camera()) === beforeCamera);
      return key;
    }
    if (await primary.isDisabled()) throw new Error(`${key}: disabled primary: ${await toolbar.innerText()}`);
    const label = await primary.innerText();
    await click(primary);
    const after = await state();
    if (after.history.length > before.history.length + 1) throw new Error(`${key}: one click saved multiple steps`);
    const held = (await snapshot())?.held;
    if (after.history.length === before.history.length && held?.rotationDeg) {
      refused++;
      const turn = toolbar.getByRole("button", { name: key === "cpu" ? H.rotateRight : H.flip, exact: true });
      await click(turn);
    } else if (JSON.stringify(before) === JSON.stringify(after)) {
      throw new Error(`${key}: no progress after ${label}`);
    }
    console.log(`STEP ${key}: ${label} -> ${after.history.at(-1) ?? "no saved step"}`);
  }
  throw new Error(`${key}: did not finish in 60 clicks; ${refused} orientation refusals`);
}

try {
  await page.goto(`${base}/pc`);
  await page.waitForSelector("#planner-title");
  for (const purpose of ["study", "creator", "gaming"]) {
    await click(page.getByRole("radio", { name: new RegExp(`^${escape(P.purposes[purpose].name)}`) }));
    await click(page.getByRole("button", { name: P.helpMe, exact: true }));
    check(`${purpose}: a suggested build is available`, (await plan()).purpose === purpose && !!(await plan()).parts.cpu);
  }
  await click(page.getByRole("tab", { name: P.categories.ram, exact: true }));
  const card = (model) => page.locator("#planner-catalog article").filter({ has: page.getByRole("heading", { name: model }) }).first();
  const add = (model) => card(model).getByRole("button", { name: new RegExp(`^(${escape(P.add)}|${escape(P.replace)}) `) });
  await click(add(/VENGEANCE LPX.*DDR4/));
  const warning = await page.locator("aside[aria-labelledby=build-title] [role=status] p").innerText();
  check("DDR4 on the DDR5 board: the robot's warning names both generations", /DDR4/.test(warning) && /DDR5/.test(warning) && await page.getByRole("button", { name: P.start, exact: true }).isDisabled(), warning);
  console.log("NOTE incompatibility:", warning);
  await click(add(/VENGEANCE RGB.*DDR5/));
  await click(page.getByRole("tab", { name: P.categories.storage, exact: true }));
  await click(add(/870 EVO/));
  await click(add(/870 EVO/));
  const remove870 = page.getByRole("button", { name: new RegExp(`^${escape(P.remove)} .*870 EVO`) }).filter({ hasText: "✕" });
  await click(remove870.first());
  check("removing one duplicate storage copy preserves the other and M.2", (await plan()).parts.storage.length === 2 && (await plan()).parts.storage.includes("samsung-990-pro-1tb"));
  await click(card(/870 EVO/).getByRole("button", { name: new RegExp(`^${escape(P.removeFromBuild)} `) }));
  check("the catalog's Remove from my build button removes its selected drive", !(await plan()).parts.storage.includes("samsung-870-evo-1tb"));
  await click(add(/870 EVO/));
  await click(page.getByRole("tab", { name: P.categories.fans, exact: true }));
  await click(card(/^ARCTIC P12 PWM PST(?! A-RGB)/).getByRole("button", { name: new RegExp(`^${escape(P.removeFromBuild)} `) }));
  check("a suggested case fan can be removed before assembly", (await plan()).parts.fans.length === 0);
  await click(add(/^ARCTIC P12 PWM PST(?! A-RGB)/));
  check("adding a case fan selects exactly one copy", (await plan()).parts.fans.length === 1);
  const chosen = await plan();
  await page.reload();
  await page.waitForSelector("#planner-title");
  check("all planner choices survive reload", JSON.stringify(await plan()) === JSON.stringify(chosen));
  await click(page.getByRole("button", { name: P.start, exact: true }));
  await page.waitForSelector("canvas");
  await page.waitForTimeout(4000);
  check("assembly begins with no learner-installed CPU, board or GPU", !(await state()).placed.some((k) => ["cpu", "motherboard", "gpu"].includes(k)));

  await fit(/14600K/);
  await fit(new RegExp(`^${escape(T.roles.ram)} ·`), { slot: "DIMM_A2" });
  await fit(new RegExp(`^${escape(T.roles.ram)} 2 ·`), { slot: "DIMM_B2" });
  await fit(/990 PRO/, { slot: "M.2_1" });
  const cooler = await select(/Freezer 36/);
  await click(options.getByRole("button", { name: T.companion.cooler.backplatePadding, exact: true }));
  // Continue the already selected cooler without toggling its tile off.
  await click(options.getByRole("button", { name: T.cancel, exact: true }));
  await fit(/Freezer 36/);
  const bench = await state();
  check("CPU, memory, M.2 and cooler are prepared before the board enters the case", ["cpu", "ram", "ram2", "storage", cooler].every((k) => bench.placed.includes(k)) && !bench.placed.includes("motherboard"));
  await fit(/TUF GAMING/, { preparation: [H.checkStandoffs] });
  await fit(/RM650e/, { preparation: [H.psuFanDown] });
  const storage = await select(/870 EVO/);
  await click(options.getByRole("group", { name: H.positionTitle.storage }).getByRole("button").filter({ hasText: locale === "ar" ? /2\.5 بوصة 1/ : /2\.5-inch SSD tray 1/ }).first());
  for (let i = 0; i < 8 && (await state()).selection !== null; i++) await click(primary);
  check("SATA drive fitted and screwed in its chosen bay", (await state()).placed.includes(storage) && (await state()).selection === null);
  await fit(/RTX 5060/);
  const fan = await select(/P12 PWM/);
  await click(options.getByRole("button", { name: H.fanExhaust, exact: true }));
  await click(options.getByRole("group", { name: H.positionTitle.fan }).getByRole("button").filter({ hasText: locale === "ar" ? /علوية رقم 1/ : /Top fan position 1/ }).first());
  for (let i = 0; i < 8 && (await state()).selection !== null; i++) await click(primary);
  check("optional case fan fitted and screwed at a selected place", (await state()).placed.includes(fan) && (await state()).selection === null);

  const camWiring = await camera();
  await click(lab.getByRole("button", { name: new RegExp(`^${escape(T.cablesTab)} `) }));
  const leads = lab.getByRole("group", { name: T.cablesLabel, exact: true }).getByRole("button");
  const leadCount = await leads.count();
  for (let i = 0; i < leadCount; i++) {
    await click(leads.nth(i));
    const key = (await state()).selection.key;
    for (let j = 0; j < 4 && !(await state()).connected.includes(key); j++) {
      const panel = lab.locator("[class*=cableDetail]");
      const free = panel.getByRole("radio").filter({ hasNotText: H.positionTag.taken }).first();
      await click(free);
      await click(panel.getByRole("button", { name: H.turnPlug, exact: true }));
      const n = (await state()).history.length;
      await click(panel.getByRole("button", { name: H.plugIn, exact: true }));
      if ((await state()).history.length !== n + 1) throw new Error(`${key}: plug did not record exactly one step`);
    }
    check(`${key}: its cable ends are connected`, (await state()).connected.includes(key));
  }
  check("selecting sockets and connecting leads keeps the camera still", await camera() === camWiring);
  await click(lab.getByRole("button", { name: T.ready.press, exact: false }));
  check("startup before readiness is refused", !(await state()).powered);
  for (const [control, value] of [["panel", "closed"], ["wall", "in"], ["psu", "on"]]) {
    await click(lab.getByRole("button", { name: T.ready.do[control][value], exact: true }));
  }
  await click(lab.getByRole("button", { name: T.ready.press, exact: false }));
  check("the fully assembled and wired build starts successfully", (await state()).powered && (await state()).complete);
  const running = await snapshot();
  writeFileSync(join(artifacts, `fresh-journey-running-${locale}-${width}.json`), JSON.stringify(running, null, 2));
  await page.reload();
  await page.waitForSelector("canvas");
  await page.waitForTimeout(4000);
  check("reload preserves the running build and every assembly step", (await state()).powered && JSON.stringify((await state()).history) === JSON.stringify(running.history));
  await click(lab.getByRole("button", { name: T.ready.off, exact: false }));
  check("power off keeps all components and leads", !(await state()).powered && (await state()).connected.length === running.connected.length);
  await click(toolbar.getByRole("button", { name: T.undo, exact: true }));
  check("undo reverses only power off", (await state()).powered && JSON.stringify((await state()).history) === JSON.stringify(running.history));
  await click(lab.getByRole("button", { name: T.ready.off, exact: false }));
  await click(toolbar.getByRole("button", { name: T.view.rgb, exact: true }));
  check("RGB remains optional and can be enabled", (await state()).view.rgb === true);
  check("no page-wide horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
} catch (e) {
  check("journey completed without an exception", false, String(e));
  console.log("DIAGNOSTIC", JSON.stringify(await state().catch(() => null)));
  await capture("journey-stopped");
} finally {
  check("no uncaught page errors", errors.length === 0, errors.join(" | "));
  console.log(`${passed} passed, ${failed} failed`);
  await browser.close();
}
