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
await click(lab.locator("[role=group] button:has(img)").filter({ hasText: /^المعالج/ }));
await click(lab.getByRole("button", { name: "تقريب" })); await page.waitForTimeout(4000);
let p = await scr(); console.log("screen", JSON.stringify(p));
await page.screenshot({ path: "/tmp/cpu-1-closeup.png" });
// Lower while closed (keyboard Enter on the scene) is refused.
await page.locator("[class*=canvas]").first().focus(); await page.keyboard.press("Enter"); await settle();
ok("closed socket rejects placement (Enter in the view)", /ارفع ذراع المقبس أول/.test(await bubble()), await bubble());
// The plate cannot open before the lever.
await page.mouse.click(...p.plate); await settle();
ok("plate click before the lever is refused", /ارفع ذراع المقبس أول/.test(await bubble()), await bubble());
await page.mouse.click(...p.lever); await settle();
let s = await st(); ok("lever clicked in the view: released and up", s.history.at(-1) === "mech:cpu-socket-plate:lever:open", s.history.at(-1));
p = await scr(); await page.mouse.click(...p.plate); await settle();
s = await st(); ok("plate clicked in the view: open", s.history.at(-1) === "mech:cpu-socket-plate:open", s.history.at(-1));
await page.screenshot({ path: "/tmp/cpu-2-open.png" });
// Drag the CPU from beside the socket over it.
p = await scr();
await page.mouse.move(...p.held); await page.mouse.down();
const steps = 8; for (let i = 1; i <= steps; i++) { await page.mouse.move(p.held[0] + ((p.centre[0] - p.held[0]) * i) / steps, p.held[1] + ((p.centre[1] - p.held[1]) * i) / steps); await page.waitForTimeout(150); }
await page.mouse.up(); await settle();
const align1 = await lab.locator("[class*=alignState]").innerText(); console.log("after drag", align1);
const dragged = await page.evaluate(() => JSON.parse(localStorage.getItem("ytl_pc_plan_progress_v1")).held?.offsetMm);
ok("dragging in the view brings the CPU over the socket (from 36.7 mm off to under 8 mm)", dragged && Math.hypot(dragged[0], dragged[1]) < 8, JSON.stringify(dragged));
await page.screenshot({ path: "/tmp/cpu-3-dragged.png" });
await page.locator("[class*=canvas]").first().focus(); await page.keyboard.press("Enter"); await settle();
ok("still turned 90°: refused with the triangle hint", /المثلث/.test(await bubble()), await bubble());
await page.keyboard.press("q"); await settle();
// Fine centring with the arrows (same state as dragging).
for (let i = 0; i < 40; i++) {
  const t = await lab.locator("[class*=alignState]").innerText();
  const m = /بعيد ([\d.]+)/.exec(t); if (!m) break;
  const off = await page.evaluate(() => JSON.parse(localStorage.getItem("ytl_pc_plan_progress_v1")).held?.offsetMm);
  if (!off) break;
  if (Math.abs(off[0]) >= 1) await page.keyboard.press(off[0] > 0 ? "ArrowLeft" : "ArrowRight");
  else if (Math.abs(off[1]) >= 1) await page.keyboard.press(off[1] > 0 ? "ArrowUp" : "ArrowDown");
  else break;
  await page.waitForTimeout(250);
}
await settle();
const held = await page.evaluate(() => JSON.parse(localStorage.getItem("ytl_pc_plan_progress_v1")).held);
ok("held pose is saved", held && held.rotationDeg === 0, JSON.stringify(held));
// Reload keeps the held pose.
await page.reload(); await page.waitForSelector("canvas", { timeout: 120000 }); await page.waitForTimeout(5000);
const after = await page.evaluate(() => JSON.parse(localStorage.getItem("ytl_pc_plan_progress_v1")).held);
ok("reload restores the held CPU's angle and offset", JSON.stringify(after) === JSON.stringify(held), JSON.stringify(after));
s = await st(); ok("reload restores lever and plate", s.history.join() === "mech:cpu-socket-plate:lever:open,mech:cpu-socket-plate:open", JSON.stringify(s.history));
await page.locator("[class*=canvas]").first().focus(); await page.keyboard.press("Enter"); await settle();
s = await st(); ok("aligned CPU lowers and seats", s.history.at(-1).startsWith("lower:cpu"), `${s.history.at(-1)} ${await bubble()}`);
await page.screenshot({ path: "/tmp/cpu-4-seated.png" });
p = await scr(); await page.mouse.click(...p.lever); await settle();
ok("lever cannot lock with the plate up", /سكّر الغطا أول/.test(await bubble()), await bubble());
await page.mouse.click(...p.plate); await settle();
p = await scr(); await page.mouse.click(...p.lever); await settle();
s = await st(); ok("plate then lever: CPU installed, cover off", s.placed.includes("cpu") && s.history.slice(-2).join() === "mech:cpu-socket-plate:closed,mech:cpu-socket-plate:lever:closed", `${JSON.stringify(s.history.slice(-2))} ${await bubble()}`);
await page.screenshot({ path: "/tmp/cpu-5-locked.png" });
// Undo restores the lever up.
await click(lab.getByRole("button", { name: "تراجع" })); s = await st();
ok("undo: lever up again, CPU no longer counted", s.history.at(-1) === "mech:cpu-socket-plate:closed" && !s.placed.includes("x"), JSON.stringify(s.history.slice(-1)));
ok("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
