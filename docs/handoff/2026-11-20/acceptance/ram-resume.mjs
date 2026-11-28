// Reload scenarios for the welcome back: the robot speaks from the saved hand and build, and the reload changes nothing. Real pointer and keys.
import { chromium } from "@playwright/test";
const base = process.argv[2] ?? "http://127.0.0.1:3001";
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n} ${x}`); if (c) pass++; else { fail++; process.exitCode = 1; } };
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addCookies([{ name: "ytl_locale", value: process.argv[3] ?? "ar", url: base }]);
const ar = (process.argv[3] ?? "ar") === "ar";
const page = await ctx.newPage(); page.setDefaultTimeout(180000); const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(base + "/pc"); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForSelector("#planner-title", { timeout: 120000 });
const press = async (l) => {
  await l.first().evaluate((el) => el.scrollIntoView({ block: "center" })); await page.waitForTimeout(300);
  const b = await l.first().boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(500);
  await page.evaluate(() => { const c = document.querySelector("canvas"); if (c) { const r = c.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) window.scrollBy(0, r.top - Math.max(0, (innerHeight - r.height) / 2)); } }); await page.waitForTimeout(300);
};
await press(page.getByRole("radio", { name: ar ? /ألعاب/ : /Gaming/ })); await press(page.getByRole("button", { name: ar ? "ساعدني أختار" : "Help me choose" })); await press(page.getByRole("button", { name: ar ? "ابدأ التجميع" : "Start assembly" }));
await page.waitForSelector("canvas", { timeout: 120000 }); await page.waitForTimeout(5000);
const lab = page.locator("section[aria-labelledby='simple-pc-title']");
const st = () => page.evaluate(() => window.__ytlSimplePc());
const scr = () => page.evaluate(() => window.__ytlSocketScreen?.() ?? {});
const bubble = async () => (await page.locator("[class*=bubble]").first().innerText()).replace(/\s+/g, " ").trim();
// `held: null` and no `held` field both mean nothing in hand (the parser drops a null one).
const saved = () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem("ytl_pc_plan_progress_v1")); if (s) s.held = s.held ?? null; return s; });
const held = async () => (await saved())?.held ?? null;
const tile = (re) => lab.locator("[role=group] button:has(img)").filter({ hasText: re });
const keys = async (...ks) => { await page.locator("[class*=canvas]").first().focus(); for (const k of ks) { await page.keyboard.press(k); await page.waitForTimeout(120); } await page.waitForTimeout(900); };
const alignTo = async (target) => {
  for (let i = 0; i < 70; i++) {
    const h = await held(); if (!h) return;
    const dx = target[0] - h.offsetMm[0], dz = target[1] - h.offsetMm[1];
    if (Math.abs(dz) >= 1) await keys(dz > 0 ? "ArrowRight" : "ArrowLeft");
    else if (Math.abs(dx) >= 1) await keys(dx > 0 ? "ArrowDown" : "ArrowUp");
    else return;
  }
};
/** Reloads; the welcome back must have these line keys, and the save (progress and pose) and the hand stay exactly as they were. */
const reload = async (label, expected, text) => {
  const before = await saved(); const selBefore = (await st()).selection;
  await page.reload(); await page.waitForSelector("canvas", { timeout: 120000 }); await page.waitForTimeout(6000);
  const s = await st(); const after = await saved(); const b = await bubble();
  ok(`${label}: says ${expected.join(" + ")}`, JSON.stringify(s.lines) === JSON.stringify(expected) && (!text || text.test(b)), `${JSON.stringify(s.lines)} | "${b}"`);
  ok(`${label}: progress, pose and hand unchanged by the reload`, JSON.stringify(after) === JSON.stringify(before) && (!before.held || JSON.stringify(s.selection) === JSON.stringify(selBefore)), `${JSON.stringify(before)} -> ${JSON.stringify(after)}; sel ${JSON.stringify(selBefore)} -> ${JSON.stringify(s.selection)}`);
};
const ramTile = ar ? /^الرام ·/ : /^RAM ·/;

// 1. In hand, over no slot.
await press(tile(ramTile)); await page.waitForTimeout(2500);
await reload("held over no slot", ["welcomeBack", "hands.ramPick"]);
// 2. Over B1, clip closed (and still the wrong way round): B1 named, open its clip.
let p = await scr();
await page.mouse.move(...p.held); await page.mouse.down();
for (let i = 1; i <= 8; i++) { await page.mouse.move(p.held[0] + ((p["slot:dimm-b1"][0] - p.held[0]) * i) / 8, p.held[1] + ((p["slot:dimm-b1"][1] - p.held[1]) * i) / 8); await page.waitForTimeout(150); }
await page.mouse.up(); await page.waitForTimeout(1500);
await alignTo([1, 10]);
await reload("over B1, clip closed", ["welcomeBack", "resume.ramOver", "hands.ramOpenFirst"], /DIMM_B1/);
// 3. Clip opened in the view: turn it round.
p = await scr(); await page.mouse.click(...p["clip:dimm-b1"]); await page.waitForTimeout(2000);
await reload("over B1, clip open, reversed", ["welcomeBack", "resume.ramOver", "hands.ramTurn"], /DIMM_B1/);
// 4. Turned, 3 mm off: line it up.
await keys("q"); await alignTo([4, 10]);
await reload("over B1, 3 mm off", ["welcomeBack", "resume.ramOver", "hands.ramCentre"], /DIMM_B1/);
// 5. Lined up: lower it into B1.
await alignTo([1, 10]);
await reload("lined up over B1", ["welcomeBack", "resume.ramReady"], /DIMM_B1/);
// 6. Lowered: resting in B1, press it home.
await keys("Enter");
ok("lowered: resting, not installed", (await st()).ram?.seating !== "seated" && (await st()).history.at(-1)?.startsWith("lower:ram"), JSON.stringify((await st()).history));
await reload("resting in B1", ["welcomeBack", "hands.ramResting"], /DIMM_B1/);
// 7. Pressed home: installed; the next step from progress (the CPU is still out).
await press(tile(ramTile)); await page.waitForTimeout(1200);
await press(lab.getByRole("button", { name: ar ? "اضغطها لين تطق" : "Press it in until it clicks", exact: true })); await page.waitForTimeout(1500);
ok("pressed home", (await st()).history.at(-1) === "seat:ram", JSON.stringify((await st()).history));
await reload("installed in B1", ["welcomeBack", "next.cpu"]);
// 8. Picked up, then put down (cancel): nothing in hand after the reload.
await press(tile(ar ? /^الرام 2 ·/ : /^RAM 2 ·/)); await page.waitForTimeout(1200);
await press(lab.getByRole("button", { name: ar ? "إلغاء الاختيار" : "Cancel selection", exact: true })); await page.waitForTimeout(1200);
ok("put down: nothing saved in hand", (await held()) === null, JSON.stringify(await held()));
await reload("module put down", ["welcomeBack", "next.cpu"]);
// 9. The CPU in hand: the same first step as when it was picked up.
await press(tile(ar ? /^المعالج ·/ : /^CPU ·/)); await page.waitForTimeout(1500);
const picked = (await st()).lines;
await reload("CPU in hand", ["welcomeBack", ...picked]);
// 10. An older save with no `held` field: still restores, nothing in hand, the step from progress.
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("ytl_pc_plan_progress_v1")); delete s.held; localStorage.setItem("ytl_pc_plan_progress_v1", JSON.stringify(s)); });
await page.reload(); await page.waitForSelector("canvas", { timeout: 120000 }); await page.waitForTimeout(6000);
let s = await st();
ok("save without a hand: restores the build, nothing in hand, next step from progress", JSON.stringify(s.lines) === JSON.stringify(["welcomeBack", "next.cpu"]) && s.selection === null && s.history.includes("seat:ram"), `${JSON.stringify(s.lines)} ${JSON.stringify(s.history)}`);
ok("no page errors", errors.length === 0, errors.join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
