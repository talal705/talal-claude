// Stage 3: an M.2 drive installed and taken out by click on the TUF GAMING Z790-PLUS WIFI (planned gaming
// build), in the real page with the real pointer and keys: slot chosen in the 3D view, heatsink, Q-Latch,
// turn, tilt, insert, press flat, latch, film, refit, screws; double click, wrong turn, reloads, undo,
// removal; and the camera never moves on its own.
// Usage: node m2.mjs <base url> <ar|en> [width]   (CHROME=<path to Chrome> if not /usr/bin/google-chrome)
import { chromium } from "@playwright/test";
const base = process.argv[2] ?? "http://127.0.0.1:3001";
const locale = process.argv[3] ?? "ar";
const width = Number(process.argv[4] ?? 1440);
const ar = locale === "ar";
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n} ${c ? "" : x}`); if (c) pass++; else { fail++; process.exitCode = 1; } };
const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
await ctx.addCookies([{ name: "ytl_locale", value: locale, url: base }]);
const page = await ctx.newPage(); page.setDefaultTimeout(180000); const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(base + "/pc"); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForSelector("#planner-title", { timeout: 120000 });
const settle = async () => page.evaluate(() => { const c = document.querySelector("canvas"); if (c) { const r = c.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) window.scrollBy(0, r.top - Math.max(0, (innerHeight - r.height) / 2)); } });
const press = async (l) => {
  await l.first().evaluate((el) => el.scrollIntoView({ block: "center" })); await page.waitForTimeout(300);
  const b = await l.first().boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(900);
  await settle(); await page.waitForTimeout(300);
};
await press(page.getByRole("radio", { name: ar ? /ألعاب/ : /Gaming/ })); await press(page.getByRole("button", { name: ar ? "ساعدني أختار" : "Help me choose" })); await press(page.getByRole("button", { name: ar ? "ابدأ التجميع" : "Start assembly" }));
await page.waitForSelector("canvas", { timeout: 120000 }); await page.waitForTimeout(6000);
const lab = page.locator("section[aria-labelledby='simple-pc-title']");
const st = () => page.evaluate(() => window.__ytlSimplePc());
const saved = () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem("ytl_pc_plan_progress_v1")); if (s) s.held = s.held ?? null; return s; });
const last = async () => (await st()).history.at(-1);
const cam = () => page.evaluate(() => window.__ytlCamera?.() ?? null);
const scr = () => page.evaluate(() => window.__ytlSocketScreen?.() ?? {});
const bubble = async () => (await page.locator("[class*=bubble]").first().innerText()).replace(/\s+/g, " ").trim();
const primary = lab.locator("[class*=toolPrimary]");
const drive = lab.locator("[role=group] button:has(img)").filter({ hasText: /990 PRO/ });
const reload = async () => { await page.reload(); await page.waitForSelector("canvas", { timeout: 120000 }); await page.waitForTimeout(7000); await settle(); };
const keys = (st) => JSON.stringify(st.lines);

// 1. Pick the drive up: no slot is named.
await press(drive); await page.waitForTimeout(1500);
let s = await st();
ok("picked up: the robot asks which M.2 slot, none is named", s.selection?.key === "storage" && keys(s) === JSON.stringify(["hands.m2Pick"]), keys(s));
const cam0 = await cam();
ok("camera pose is readable for the check", Array.isArray(cam0), String(cam0));

// 2. Choose M.2_1 by clicking it in the 3D view.
let p = await scr();
ok("M.2_1 is on screen to click", Array.isArray(p["m2:m2-1"]), JSON.stringify(Object.keys(p)));
if (p["m2:m2-1"]) { await page.mouse.click(...p["m2:m2-1"]); await page.waitForTimeout(1500); }
let h = (await saved()).held;
ok("a click on M.2_1 in the view aims the drive there; turn kept", h?.slotId === "m2-1" && h?.rotationDeg === 180, JSON.stringify(h));
s = await st();
ok("robot: over M.2_1, its heatsink comes off first", keys(s) === JSON.stringify(["resume.m2Over", "hands.m2HsScrewsFirst"]) && /M\.2_1/.test(await bubble()), `${keys(s)} | ${await bubble()}`);

// 3. A double click on the action takes exactly one step.
const before = (await st()).history.length;
{ await primary.first().evaluate((el) => el.scrollIntoView({ block: "center" })); await page.waitForTimeout(300); const b = await primary.first().boundingBox(); await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(1200); await settle(); }
s = await st();
ok("double click: one step only (heatsink screws loosened)", s.history.length === before + 1 && s.history.at(-1) === "mech:m2-hs-1:screws:open", JSON.stringify(s.history));
await press(primary);
ok("lift the heatsink off", (await last()) === "mech:m2-hs-1:open", await last());
await press(primary);
ok("turn the Q-Latch open", (await last()) === "mech:m2-1-qlatch:open", await last());
await press(primary);
h = (await saved()).held;
ok("tilt up (one click, the learner's)", h?.tiltDeg === 25, JSON.stringify(h));
// Still turned the wrong way: the insertion is refused, nothing is corrected.
const n0 = (await st()).history.length;
await press(primary);
s = await st();
ok("wrong way round: refused with the notch reason, nothing inserted, not turned for the learner", s.history.length === n0 && (await saved()).held?.rotationDeg === 180 && (ar ? /الشق|اقلب/ : /notch|round/i).test(await bubble()), await bubble());
await press(lab.getByRole("button", { name: ar ? "اقلبها" : "Turn it round", exact: true }));
ok("turned round by the learner", (await saved()).held?.rotationDeg === 0, JSON.stringify((await saved()).held));
ok("no step moved the camera", JSON.stringify(await cam()) === JSON.stringify(cam0), `${cam0} -> ${await cam()}`);

// 4. Reload while holding it, tilted, over M.2_1.
let snap = await saved();
await reload();
s = await st();
ok("reload in hand: welcome back, over M.2_1, ready to slide in", keys(s) === JSON.stringify(["welcomeBack", "resume.m2Over", "hands.m2Ready"]), keys(s));
ok("reload in hand: progress, pose, tilt and slot unchanged", JSON.stringify(await saved()) === JSON.stringify(snap), JSON.stringify(await saved()));
const cam1 = await cam();
await press(primary);
ok("inserted at an angle into M.2_1", /^lower:storage:0:0:0:t25:sm2-1$/.test(await last()), await last());

// 5. Reload while it rests at an angle.
snap = await saved();
await reload();
s = await st();
ok("reload resting: welcome back, press it flat in M.2_1", keys(s) === JSON.stringify(["welcomeBack", "hands.m2PressFlat"]) && /M\.2_1/.test(await bubble()), `${keys(s)} | ${await bubble()}`);
ok("reload resting: nothing changed", JSON.stringify(await saved()) === JSON.stringify(snap));
const cam2 = await cam();
await press(drive);
for (const [label, step] of [["press flat", "seat:storage"], ["Q-Latch shut", "mech:m2-1-qlatch:closed"], ["pad film peeled", "mech:m2-hs-1:film:open"], ["heatsink refitted", "mech:m2-hs-1:closed"], ["heatsink screws in", "mech:m2-hs-1:screws:closed"]]) {
  await press(primary);
  ok(label, (await last()) === step, await last());
}
s = await st();
ok("drive in: counted, put down, robot says it is in", s.placed.includes("storage") && s.selection === null && keys(s) === JSON.stringify(["hands.m2Done"]), `${keys(s)} ${JSON.stringify(s.selection)}`);
ok("no step moved the camera (after the reload)", JSON.stringify(await cam()) === JSON.stringify(cam2), `${cam2} -> ${await cam()}`);

// 6. Undo the last step: the screws are loose again, nothing else.
await press(lab.getByRole("button", { name: ar ? "تراجع عن آخر خطوة" : "Undo last step" }));
ok("undo: only the last step is taken back", (await last()) === "mech:m2-hs-1:closed", await last());
await press(drive); await press(primary);
ok("tightened again", (await last()) === "mech:m2-hs-1:screws:closed", await last());

// 7. Take it out with the panel: heatsink off, Q-Latch open (the drive rises), lift it out.
await press(drive);
const options = lab.locator("details[class*=partOptions] > summary");
if (!(await lab.locator("details[class*=partOptions]").first().evaluate((d) => d.open))) await press(options);
for (const [name, step] of [[ar ? "فك براغي مشتّت M.2" : "Loosen the M.2 heatsink's screws", "mech:m2-hs-1:screws:open"], [ar ? "شيل المشتّت" : "Lift the heatsink off", "mech:m2-hs-1:open"]]) {
  await press(lab.getByRole("button", { name, exact: true }));
  ok(`removal: ${step}`, (await last()) === step, await last());
}
await press(lab.locator("[class*=hands] button").filter({ hasText: ar ? /افتح.*Q-Latch|Q-Latch.*فتح|لف.*لفتح/ : /unlock/i }).first());
ok("removal: Q-Latch open, the drive rises", (await last()) === "mech:m2-1-qlatch:open" && (await st()).placed.includes("storage"), await last());
await press(lab.getByRole("button", { name: ar ? "طلّعها" : "Lift it out", exact: true }));
s = await st();
ok("removal: the drive comes out, back in hand", (await last()) === "lift:storage" && !s.placed.includes("storage"), `${await last()} ${JSON.stringify(s.placed)}`);
ok("no page errors", errors.length === 0, errors.join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
