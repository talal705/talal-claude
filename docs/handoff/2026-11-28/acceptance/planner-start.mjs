// Targeted check of the planner's Start assembly with saved one-click groups (final build): an unchanged plan keeps
// each installation as one Undo, also after a reload; malformed group metadata in storage is dropped at Start
// without losing the history or breaking the page. Usage: node planner-start.mjs [en|ar] [width] [base URL]
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const locale = process.argv[2] ?? "en", width = Number(process.argv[3] ?? 1440);
const base = process.argv[4] ?? "http://127.0.0.1:3031";
const T = JSON.parse(readFileSync(new URL(`../../../../apps/web/messages/${locale}/labs.json`, import.meta.url))).simplePc;
const P = T.planner;
const phone = width < 800;
let passed = 0, failed = 0;
function check(name, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : `: ${detail}`}`);
  if (condition) passed++; else { failed++; process.exitCode = 1; }
}
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width, height: phone ? 900 : 1000 }, ...(phone ? { hasTouch: true, isMobile: true } : {}) });
await context.addCookies([{ name: "ytl_locale", value: locale, url: base }]);
const page = await context.newPage();
page.setDefaultTimeout(25000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const press = async (l) => { await l.scrollIntoViewIfNeeded(); if (phone) await l.tap(); else await l.click(); await page.waitForTimeout(700); };
const snapshot = () => page.evaluate(() => JSON.parse(localStorage.getItem("ytl_pc_plan_progress_v1") ?? "null"));
const lab = page.locator("section[aria-labelledby='simple-pc-title']");
const card = lab.locator("[class*=actionCard]");
const undo = () => press(card.getByRole("button", { name: T.undo, exact: true }));
const tile = (name) => lab.getByRole("group", { name: T.partsLabel, exact: true }).getByRole("button").filter({ hasText: name }).first();
async function install(name) {
  // Undo leaves the part it took back selected; tapping a selected tile would deselect it.
  if ((await tile(name).getAttribute("aria-pressed")) !== "true") await press(tile(name));
  await press(card.locator("[class*=installButton]"));
}
async function restart() {
  await press(lab.getByRole("button", { name: P.editBuild, exact: true }));
  await page.waitForSelector("#planner-title");
  await press(page.getByRole("button", { name: P.start, exact: true }));
  await page.waitForSelector("canvas");
  await page.waitForTimeout(3500);
}
try {
  await page.goto(`${base}/pc`);
  await page.waitForSelector("#planner-title");
  await press(page.getByRole("radio", { name: new RegExp(`^${escape(P.purposes.gaming.name)}`) }));
  await press(page.getByRole("button", { name: P.helpMe, exact: true }));
  await press(page.getByRole("button", { name: P.start, exact: true }));
  await page.waitForSelector("canvas");
  await page.waitForTimeout(3500);
  await install(/14600K/);
  await install(new RegExp(`^${escape(T.roles.ram)} ·`));
  const two = await snapshot();
  check("two one-click installations, two groups", two.groups?.length === 2, JSON.stringify(two.groups));

  await restart();
  const same = await snapshot();
  check("Start again with the plan unchanged keeps the history and both groups", JSON.stringify(same.history) === JSON.stringify(two.history) && JSON.stringify(same.groups) === JSON.stringify(two.groups));
  await undo();
  check("one Undo takes the whole memory installation back", (await snapshot()).history.length === two.groups[1][0]);
  await page.reload();
  await page.waitForSelector("canvas");
  await page.waitForTimeout(3500);
  await undo();
  check("after reload one Undo takes the whole CPU installation back", (await snapshot()).history.length === 0);

  // Malformed group metadata in storage: Start drops it, keeps the history, and the page works.
  await install(/14600K/);
  await install(new RegExp(`^${escape(T.roles.ram)} ·`));
  const good = await snapshot();
  for (const bad of ["invalid", [null], [{}], [[0, 99]]]) {
    await page.evaluate((groups) => { const s = JSON.parse(localStorage.getItem("ytl_pc_plan_progress_v1")); s.groups = groups; localStorage.setItem("ytl_pc_plan_progress_v1", JSON.stringify(s)); }, bad);
    await restart();
    const after = await snapshot();
    check(`malformed groups ${JSON.stringify(bad)}: Start keeps every step and drops only the metadata`, JSON.stringify(after.history) === JSON.stringify(good.history) && after.groups === undefined, JSON.stringify(after.groups));
  }
  await undo();
  check("…and Undo then takes back one step", (await snapshot()).history.length === good.history.length - 1);
} catch (e) {
  check("run completed without an exception", false, String(e));
} finally {
  check("no uncaught page errors", errors.length === 0, errors.join(" | "));
  console.log(`${passed} passed, ${failed} failed`);
  await browser.close();
}
