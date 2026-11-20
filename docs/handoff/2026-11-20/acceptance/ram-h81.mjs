// The two-clip design (ASUS H81M-K, DDR3): a plan the planner accepts, started from its own button.
import { chromium } from "@playwright/test";
const base = process.argv[2] ?? "http://127.0.0.1:3001"; const locale = process.argv[3] ?? "en";
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n} ${x}`); if (c) pass++; else { fail++; process.exitCode = 1; } };
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addCookies([{ name: "ytl_locale", value: locale, url: base }]);
const page = await ctx.newPage(); page.setDefaultTimeout(180000); const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(base + "/pc"); await page.evaluate(() => {
  localStorage.clear();
  const build = { version: 1, purpose: "study", workload: "", parts: { case: "fractal-pop-mini-air-rgb-black-tg", motherboard: "asus-h81m-k", cpu: "intel-core-i5-4590", cooler: "arctic-freezer-7-x", psu: "corsair-rm650e-2025", gpu: null, ram: { id: "corsair-vengeance-lp-ddr3-1600-16gb-kit", modules: 2 }, storage: ["samsung-870-evo-1tb"], fans: [] } };
  localStorage.setItem("ytl_pc_plan_v1", JSON.stringify({ build, phase: "plan" }));
});
await page.reload(); await page.waitForSelector("#planner-title", { timeout: 120000 }); await page.waitForTimeout(1500);
// Panel buttons with the real pointer; then the scene is brought back fully into view for pointer work in it.
const press = async (l) => {
  // The real pointer at the button's middle (no wait for animation frames, which the software renderer makes slow).
  await l.first().evaluate((el) => el.scrollIntoView({ block: "center" })); await page.waitForTimeout(300);
  const b = await l.first().boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(500);
  await page.evaluate(() => { const c = document.querySelector("canvas"); if (c) { const r = c.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) window.scrollBy(0, r.top - Math.max(0, (innerHeight - r.height) / 2)); } }); await page.waitForTimeout(300);
};
const start = page.getByRole("button", { name: /Start assembly|ابدأ التجميع/ });
ok("the planner accepts the H81M-K plan (its own check) and offers to start", (await start.count()) > 0 && await start.first().isEnabled());
await press(start);
await page.waitForSelector("canvas", { timeout: 120000 }); await page.waitForTimeout(5000);
const lab = page.locator("section[aria-labelledby='simple-pc-title']");
const st = () => page.evaluate(() => window.__ytlSimplePc());
const scr = () => page.evaluate(() => window.__ytlSocketScreen?.() ?? {});
const robot = () => page.evaluate(() => window.__ytlRobot?.() ?? { shown: false });
const count = async () => Number((await page.locator("[class*=progress]").first().innerText()).trim().split(/\s/)[0]);
const bubble = async () => (await page.locator("[class*=bubble]").first().innerText()).replace(/\s+/g, " ").trim();
const status = async () => (await lab.locator("[class*=handsState]").first().innerText()).trim();
const held = () => page.evaluate(() => JSON.parse(localStorage.getItem("ytl_pc_plan_progress_v1")).held ?? null);
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
const tiles = await lab.locator("[role=group] button:has(img)").allInnerTexts();
console.log("tiles", tiles.map((t) => t.replace(/\s+/g, " ")).join(" | "));
await press(tile(/^(RAM|Memory) ·|^RAM stick 1/)); await page.waitForTimeout(2500);
let s = await st();
ok("module in hand; no slot claimed", s.ram?.target === null, JSON.stringify(s.ram));
await press(lab.getByRole("button", { name: "Close-up" })); await page.waitForTimeout(7000);
let p = await scr();
ok("two clips per slot drawn (far and near for A1 and B1)", Boolean(p["clip:dimm-a1"] && p["near:dimm-a1"] && p["clip:dimm-b1"] && p["near:dimm-b1"]), JSON.stringify(p));
await page.mouse.move(...p.held); await page.mouse.down();
for (let i = 1; i <= 8; i++) { await page.mouse.move(p.held[0] + ((p["slot:dimm-a1"][0] - p.held[0]) * i) / 8, p.held[1] + ((p["slot:dimm-a1"][1] - p.held[1]) * i) / 8); await page.waitForTimeout(150); }
await page.mouse.up(); await page.waitForTimeout(1500);
await alignTo([0.5, 0.5]);
s = await st();
ok("over DIMM_A1", s.ram.target === "dimm-a1" && /DIMM_A1/.test(await status()), `${await status()} ${JSON.stringify(s.ram)}`);
p = await scr(); await page.mouse.click(...p["clip:dimm-a1"]); await page.waitForTimeout(1800);
s = await st();
ok("one clip opened in the view; the other end still closed", s.history.join() === "mech:dimm-a1-latch:open" && /other clip closed/i.test(await status()), `${s.history} | ${await status()}`);
await keys("q", "Enter");
ok("one clip still closed: refused", /open/i.test(await bubble()) && !(await st()).history.some((x) => x.startsWith("lower:")), await bubble());
p = await scr(); await page.mouse.click(...p["near:dimm-a1"]); await page.waitForTimeout(1800);
s = await st();
ok("the second clip opened on its own; B1's clips untouched", s.history.join() === "mech:dimm-a1-latch:open,mech:dimm-a1-latch:near:open", s.history.join());
await page.screenshot({ path: "/tmp/h81-both-open.png", clip: await page.locator("canvas").first().boundingBox() });
await keys("Enter");
s = await st();
ok("both open, lined up: lowered into A1, resting (not counted)", s.history.at(-1)?.startsWith("lower:ram") && s.ram.installedIn === "dimm-a1" && (await count()) === 0, `${s.history.at(-1)} ${JSON.stringify(s.ram)}`);
await press(lab.getByRole("button", { name: /Press it in|اضغطها/ })); await page.waitForTimeout(1500);
s = await st();
await press(tile(/^(RAM|Memory) ·|^RAM stick 1/)); await page.waitForTimeout(1200);
ok("pressed home: counted, both clips closed", (await count()) === 1 && /clip closed/i.test(await status()) && /other clip closed/i.test(await status()), `${s.history.at(-1)} | ${await status()}`);
await page.screenshot({ path: "/tmp/h81-installed.png", clip: await page.locator("canvas").first().boundingBox() });
// Removal: both clips, each on its own.
p = await scr(); await page.mouse.click(...p["clip:dimm-a1"]); await page.waitForTimeout(1500);
const lift = lab.getByRole("button", { name: /Lift it out|طلّعها/ });
if (await lift.count()) { await press(lift); await page.waitForTimeout(1200); }
s = await st();
ok("one clip open: the module cannot come out", s.history.at(-1) !== "lift:ram", `${s.history.slice(-2)} | ${await bubble()}`);
p = await scr(); await page.mouse.click(...p["near:dimm-a1"]); await page.waitForTimeout(1500);
await press(lab.getByRole("button", { name: /Lift it out|طلّعها/ })); await page.waitForTimeout(1500);
s = await st();
ok("both open: lifted out, back in hand over A1", s.history.at(-1) === "lift:ram" && s.ram.target === "dimm-a1", `${s.history.slice(-3)} ${JSON.stringify(s.ram)}`);
const rb = await robot(); const box = await page.locator("canvas").first().boundingBox();
ok("robot in the scene", rb.shown && rb.centre[0] >= 0 && rb.centre[1] >= 0 && rb.centre[0] <= box.width && rb.centre[1] <= box.height, JSON.stringify(rb.centre));
ok("no raw translation keys", !/\b(simplePc|companion|hands|labs)\.[a-zA-Z]/.test(await page.locator("body").innerText()));
ok("no page errors", errors.length === 0, errors.join(" | "));
console.log(`TOTAL pass ${pass} fail ${fail}`);
await browser.close();
