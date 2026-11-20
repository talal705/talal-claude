import { chromium } from "@playwright/test";
const base = process.argv[2] ?? "http://127.0.0.1:3001"; const locale = process.argv[3] ?? "ar";
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ok = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n} ${x}`); if (!c) process.exitCode = 1; };
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addCookies([{ name: "ytl_locale", value: locale, url: base }]);
const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(base + "/pc"); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForSelector("#planner-title", { timeout: 120000 });
const click = async (l) => { await l.first().evaluate((el) => el.click()); await page.waitForTimeout(400); };
await click(page.getByRole("radio", { name: /ألعاب/ })); await click(page.getByRole("button", { name: "ساعدني أختار" })); await click(page.getByRole("button", { name: "ابدأ التجميع" }));
await page.waitForSelector("canvas", { timeout: 120000 }); await page.waitForTimeout(5000);
const lab = page.locator("section[aria-labelledby='simple-pc-title']");
const st = () => page.evaluate(() => window.__ytlSimplePc());
const scr = () => page.evaluate(() => window.__ytlSocketScreen?.() ?? {});
const bubble = async () => (await page.locator("[class*=bubble]").first().innerText()).replace(/\s+/g, " ").trim();
const settle = () => page.waitForTimeout(2500);
const heldPose = () => page.evaluate(() => JSON.parse(localStorage.getItem("ytl_pc_plan_progress_v1")).held ?? null);
const bubbleRaw = async () => (await page.locator("[class*=bubble]").first().innerText());
await click(lab.locator("[role=group] button:has(img)").filter({ hasText: /^المعالج/ }));
await click(lab.getByRole("button", { name: "تقريب" })); await page.waitForTimeout(6000);
let p = await scr();
await page.mouse.click(...p.lever); await settle();
p = await scr(); await page.mouse.click(...p.plate); await settle();
let s = await st(); ok("fresh socket opened in the view (lever, then plate)", s.history.join() === "mech:cpu-socket-plate:lever:open,mech:cpu-socket-plate:open", s.history.join());
// Contacts: sample the pixels at the socket centre (gold pins vs the old solid grey).
await page.screenshot({ path: "/tmp/fix-1-contacts.png", clip: { x: 400, y: 260, width: 1000, height: 640 } });
const gold = await page.evaluate(([x, y]) => {
  const c = document.querySelector("canvas"); const r = c.getBoundingClientRect();
  const gl = c.getContext("webgl2") || c.getContext("webgl"); return gl ? "has-gl" : "no-gl";
}, p.centre);
console.log("canvas", gold);
// Bring the CPU over and line it up, leaving a small accepted offset.
p = await scr();
await page.mouse.move(...p.held); await page.mouse.down();
for (let i = 1; i <= 8; i++) { await page.mouse.move(p.held[0] + ((p.centre[0] - p.held[0]) * i) / 8, p.held[1] + ((p.centre[1] - p.held[1]) * i) / 8); await page.waitForTimeout(120); }
await page.mouse.up(); await settle();
await page.locator("[class*=canvas]").first().focus();
for (let i = 0; i < 30; i++) {
  const off = (await heldPose())?.offsetMm; if (!off) break;
  if (Math.abs(off[0]) >= 1) await page.keyboard.press(off[0] > 0 ? "ArrowLeft" : "ArrowRight");
  else if (Math.abs(off[1]) >= 1) await page.keyboard.press(off[1] > 0 ? "ArrowUp" : "ArrowDown");
  else break;
  await page.waitForTimeout(200);
}
await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); await page.waitForTimeout(800);
const turnTo = async (want) => {
  await page.waitForTimeout(1500);
  const cur = (await heldPose()).rotationDeg;
  const n = (((want - cur) / 90) % 4 + 4) % 4;
  for (let i = 0; i < n; i++) { await page.keyboard.press("e"); await page.waitForTimeout(150); }
  await page.waitForTimeout(2000);
};
// It came up turned 90°: try 90, 180, 270 (each refused), then 0.
for (const want of [90, 180, 270]) {
  await turnTo(want);
  await page.keyboard.press("Enter"); await settle();
  s = await st(); ok(`turned ${want}°: refused with the triangle hint`, !s.history.some((x) => x.startsWith("lower:")) && /المثلث/.test(await bubble()), `${(await heldPose()).rotationDeg} ${await bubble()}`);
}
await turnTo(0);
const before = await heldPose();
ok("held over the socket, right way round, with a small nonzero offset", before.rotationDeg === 0 && Math.hypot(...before.offsetMm) > 0.5 && Math.hypot(...before.offsetMm) <= 3, JSON.stringify(before));
await page.screenshot({ path: "/tmp/fix-2-marks.png", clip: { x: 400, y: 260, width: 1000, height: 640 } });
await page.keyboard.press("Enter"); await settle();
s = await st();
ok("lowered: the step keeps the pose it was lowered from", s.history.at(-1) === `lower:cpu:0:${before.offsetMm[0]}:${before.offsetMm[1]}`, s.history.at(-1));
const camBefore = await scr();
await click(lab.getByRole("button", { name: "تراجع" })); await settle();
s = await st();
const after = await heldPose();
ok("undo takes back only the lowering (lever and plate stay open)", s.history.join() === "mech:cpu-socket-plate:lever:open,mech:cpu-socket-plate:open", s.history.join());
ok("undo puts the CPU back in hand with its exact pose", JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after));
ok("the CPU stays selected with its hold controls", (await lab.locator("[class*=holdControls]").count()) > 0 && JSON.stringify(s.selection) === JSON.stringify({ kind: "part", key: "cpu" }), JSON.stringify(s.selection));
const msg = await bubbleRaw();
ok("the robot says the CPU is back in hand (no raw key, no cable, no unrelated next step)", /رجع في يدك/.test(msg) && !/ابدأ باختيار/.test(msg) && !/simplePc|cables\./.test(msg), msg.replace(/\s+/g, " "));
const camAfter = await scr();
ok("camera unchanged by undo", JSON.stringify({ l: camBefore.lever, m: camBefore.mark }) === JSON.stringify({ l: camAfter.lever, m: camAfter.mark }), `${JSON.stringify(camBefore.mark)} → ${JSON.stringify(camAfter.mark)}`);
await page.screenshot({ path: "/tmp/fix-3-undo.png", clip: { x: 400, y: 260, width: 1000, height: 640 } });
await page.reload(); await page.waitForSelector("canvas", { timeout: 120000 }); await page.waitForTimeout(5000);
s = await st();
ok("reload keeps the restored pose and selection", JSON.stringify(await heldPose()) === JSON.stringify(before) && JSON.stringify(s.selection) === JSON.stringify({ kind: "part", key: "cpu" }) && (await lab.locator("[class*=holdControls]").count()) > 0, `${JSON.stringify(await heldPose())} ${JSON.stringify(s.selection)}`);
ok("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
