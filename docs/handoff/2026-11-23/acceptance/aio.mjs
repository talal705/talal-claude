// Stage 4: a liquid cooler (Liquid Freezer III 280, practice build): pump block on the CPU, radiator in the case, taken off
// in the real page with the real pointer: backplate, socket frame off, contact frame, frame screws one at a time
// (engaged, then tight across), paste, film, cooler placed, its two screws, then removal. What the scene DRAWS is
// read from the scene's own read-only view (window.__ytlHardware) and from pixels of the canvas.
// Usage: node cooling.mjs <base url> <ar|en> [width]   (CHROME=<path to Chrome> if not /usr/bin/google-chrome)
import { chromium } from "@playwright/test";
const base = process.argv[2] ?? "http://127.0.0.1:3001";
const ar = (process.argv[3] ?? "en") === "ar";
const width = Number(process.argv[4] ?? 1440);
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n} ${c ? "" : x}`); if (c) pass++; else { fail++; process.exitCode = 1; } };
const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 900 : 1000 } });
await ctx.addCookies([{ name: "ytl_locale", value: ar ? "ar" : "en", url: base }]);
const page = await ctx.newPage(); page.setDefaultTimeout(180000); const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(base + "/pc?practice=1"); await page.waitForSelector("canvas", { timeout: 120000 }); await page.waitForTimeout(6000);
const settle = async () => page.evaluate(() => { const c = document.querySelector("canvas"); if (c) { const r = c.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) window.scrollBy(0, r.top - Math.max(0, (innerHeight - r.height) / 2)); } });
const press = async (l) => {
  await l.first().evaluate((el) => el.scrollIntoView({ block: "center" })); await page.waitForTimeout(300);
  const b = await l.first().boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(900);
  await settle(); await page.waitForTimeout(300);
};
const lab = page.locator("section[aria-labelledby='simple-pc-title']");
const st = () => page.evaluate(() => window.__ytlSimplePc());
const hw = () => page.evaluate(() => window.__ytlHardware?.() ?? null);
const cam = () => page.evaluate(() => window.__ytlCamera?.() ?? null);
const primary = lab.locator("[class*=toolPrimary]");
const tile = (re) => lab.locator("[role=group] button:has(img)").filter({ hasText: re });
const turnRight = lab.getByRole("button", { name: ar ? /لف لليمين|يمين/ : /Turn right/ });
const fitPart = async (key) => {
  for (let i = 0; i < 20; i += 1) {
    const before = (await st()).history.length;
    await press(primary);
    const s = await st();
    if (s.placed.includes(key) && s.selection === null) return true;
    if (s.history.length === before && (await turnRight.count()) > 0) await press(turnRight);
  }
  return false;
};
const opened = async () => { if ((await lab.locator("details").count()) === 0) await press(liquid); const d = lab.locator("details").first(); if (!(await d.evaluate((e) => e.open))) await d.locator("summary").click(); await page.waitForTimeout(300); };
const liquid = tile(ar ? /^المبرّد المائي 280/ : /^Liquid cooler 280/);
// CPU, memory and storage come from an old-format (version 3, whole-part steps) save of the practice build: this
// also checks that such a save still loads and the cooler goes on top of it, step by step.
await page.evaluate(() => localStorage.setItem("ytl_simple_pc_v1", JSON.stringify({ version: 3, placed: ["cpu", "ram", "ram2", "storage"], connected: [], powered: false, history: ["part:cpu", "part:ram", "part:ram2", "part:storage"] })));
await page.reload(); await page.waitForSelector("canvas", { timeout: 120000 }); await page.waitForTimeout(7000); await settle();
ok("an old whole-part save loads with CPU, memory and storage in", (await st()).placed.join() === "cpu,ram,ram2,storage", JSON.stringify((await st()).placed));
const cam0 = await cam();
await press(liquid); await opened();
const padBtn = lab.getByRole("button", { name: ar ? /الحشوة/ : /padding/ });
if ((await padBtn.count()) === 0) { console.log("DEBUG panel:", (await lab.locator("details").first().innerText().catch(() => "no details")).slice(0, 400), "| tiles:", await lab.locator("[role=group] button:has(img)").allInnerTexts()); }
await padBtn.click({ timeout: 30000 }); await page.waitForTimeout(900);
const click1 = async () => { await opened(); const before = (await st()).history.length; await press(primary); const s = await st(); return s.history.slice(before); };
// Everything up to the pump block on the CPU: frame work, paste, film, block placed, its screws.
let guard = 0, s = await st();
while (guard++ < 30 && !(await st()).history.some((x) => x === "place:aio")) await click1();
s = await st();
ok("pump block placed on the CPU through documented steps (frame, paste, film first)", s.history.some((x) => x === "hw:motherboard:frame:placed") && s.history.some((x) => x === "prep:aio:paste:applied") && s.history.some((x) => x === "place:aio") && s.history.indexOf("hw:motherboard:frame:placed") < s.history.indexOf("place:aio"), JSON.stringify(s.history.slice(-8)));
ok("the radiator is not fitted yet: the block and the radiator are separate steps", !s.history.some((x) => x.startsWith("rad:aio")));
ok("no AIO step moved the camera", JSON.stringify(await cam()) === JSON.stringify(cam0), `${JSON.stringify(cam0)} -> ${JSON.stringify(await cam())}`);
// Block fully on: the pump block's own screws and the small VRM fan, then the radiator step needs the board in the case.
while (guard++ < 60 && !(await st()).lines.includes("cooler.boardFirst")) await click1();
s = await st();
ok("without the board in the case the robot says the board comes first (nothing fitted early)", s.lines.includes("cooler.boardFirst") && !s.history.some((x) => x.startsWith("rad:aio")), JSON.stringify(s.lines));
// The board goes into the case with the CPU and the pump block already on it: standoffs, I/O shield, lower, screws.
await press(tile(ar ? /^اللوحة الأم/ : /^Motherboard/));
if ((await lab.locator("details").count()) === 0) await press(tile(ar ? /^اللوحة الأم/ : /^Motherboard/));
const d0 = lab.locator("details").first(); if (!(await d0.evaluate((e) => e.open))) await d0.locator("summary").click();
await lab.getByRole("button", { name: ar ? /^تأكد/ : /^Check the standoffs/ }).click(); await page.waitForTimeout(900);
const lower = lab.getByRole("button", { name: ar ? /نزّل اللوحة/ : /Lower the board/ });
await lower.click(); await page.waitForTimeout(900);
if (!(await st()).history.some((x) => x.startsWith("place:motherboard"))) {
  // This board's shield is not fixed to it: the learner fits the separate one, then lowers the board.
  await lab.getByRole("button", { name: ar ? /غطا المنافذ/ : /I\/O shield/ }).click(); await page.waitForTimeout(900);
  await lower.click(); await page.waitForTimeout(900);
}
if (process.env.DEBUG_BOARD) console.log("hist tail:", JSON.stringify((await st()).history.slice(-4)), "says:", (await st()).lines);
for (let i = 0; i < 12 && !(await st()).placed.includes("motherboard"); i += 1) { await lab.getByRole("button", { name: ar ? /اربط البرغي/ : /Tighten screw/ }).first().click(); await page.waitForTimeout(900); }
ok("motherboard fitted with the pump block already on it", (await st()).placed.includes("motherboard"));
await press(liquid); await opened();
let n = 0;
while (n++ < 24 && !(await st()).history.includes("radscrew:aio:8")) await click1();
s = await st();
ok("radiator mounted and screwed one screw per click (1..8)", s.history.includes("rad:aio") && [1, 2, 3, 4, 5, 6, 7, 8].every((k) => s.history.includes(`radscrew:aio:${k}`)), JSON.stringify(s.history.slice(-10)));
ok("radiator fans are not counted as extra parts", s.placed.filter((x) => /^fan/.test(x)).length === 0, JSON.stringify(s.placed));
ok("mechanically complete; the robot says the pump and fan cables come later", s.lines.some((l) => l === "cooler.notWired" || l === "cooler.done"), JSON.stringify(s.lines));
// Double click: one step.
const histLen = (await st()).history.length;
await opened();
const off = lab.getByRole("button", { name: ar ? /فك|ارفع|أخرج|أرخ/ : /Undo radiator|Lift|Loosen|Take/ });
await off.first().evaluate((el) => el.scrollIntoView({ block: "center" })); await page.waitForTimeout(300);
const b = await off.first().boundingBox();
await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(1500);
ok("a double click on the removal button takes one step", (await st()).history.length === histLen + 1, `${histLen} -> ${(await st()).history.length}`);
// Removal, radiator first.
n = 0;
while (n++ < 24 && (await st()).placed.includes("aio")) { await opened(); await off.first().click({ timeout: 30000 }).catch(() => {}); await page.waitForTimeout(1500); }
s = await st();
const rem = s.history.slice(histLen);
ok("removal: radiator unscrewed and lifted before the block's own screws and lift", !s.placed.includes("aio") && s.history.at(-1) === "lift:aio" && rem.indexOf("lift:aio:rad") >= 0 && rem.indexOf("lift:aio:rad") < rem.indexOf("lift:aio"), JSON.stringify(rem));
ok("the block's screws are gone from the picture after removal", Object.keys((await hw()).screws).every((k) => !k.startsWith("body-screw")));
ok("no page errors", errors.length === 0, errors.join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
