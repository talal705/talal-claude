// CPU and memory regression for the click-based toolbar (planned gaming build, TUF GAMING Z790-PLUS WIFI):
// each click takes at most one step; a wrong turn is refused and never corrected for the learner; the
// part ends installed; a reload mid-way keeps everything; the camera never moves on its own.
// Usage: node cpu-ram-click.mjs <base url> <ar|en> [width]   (CHROME=<path> if not /usr/bin/google-chrome)
import { chromium } from "@playwright/test";
const base = process.argv[2] ?? "http://127.0.0.1:3001";
const ar = (process.argv[3] ?? "ar") === "ar";
const width = Number(process.argv[4] ?? 1440);
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n} ${c ? "" : x}`); if (c) pass++; else { fail++; process.exitCode = 1; } };
const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
await ctx.addCookies([{ name: "ytl_locale", value: ar ? "ar" : "en", url: base }]);
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
const held = () => page.evaluate(() => JSON.parse(localStorage.getItem("ytl_pc_plan_progress_v1"))?.held ?? null);
const cam = () => page.evaluate(() => window.__ytlCamera?.() ?? null);
const primary = lab.locator("[class*=toolPrimary]");
const tile = (re) => lab.locator("[role=group] button:has(img)").filter({ hasText: re });
const turnRight = lab.getByRole("button", { name: ar ? /لف لليمين|يمين/ : /Turn right/ });
const flip = lab.getByRole("button", { name: ar ? "اقلبها" : "Turn it round", exact: true });

/** Clicks the toolbar's one action until the part is in; turns it (the learner's own click) only after a refusal. */
async function fit(key, turn) {
  let refusedTurn = false, oneStep = true, turned = 0;
  for (let i = 0; i < 16; i += 1) {
    const before = (await st()).history.length;
    await press(primary);
    const s = await st();
    if (s.history.length > before + 1) oneStep = false;
    if (s.placed.includes(key) && s.selection === null) return { refusedTurn, oneStep, turned };
    const h = await held();
    if (s.history.length === before && h && h.rotationDeg !== 0) { refusedTurn = true; await press(turn); turned += 1; }
  }
  return { refusedTurn, oneStep, turned, stuck: true };
}

const cam0 = await cam();
// CPU: lever, plate, over the socket, turn (refused first), lower, plate, lever.
await press(tile(/14600K/));
let r = await fit("cpu", turnRight);
ok("CPU installed through the toolbar, one step per click", !r.stuck && r.oneStep, JSON.stringify(r));
ok("CPU: the wrong turn was refused and turned only by the learner's clicks", r.refusedTurn && r.turned >= 1, JSON.stringify(r));
let s = await st();
ok("no CPU step moved the camera", JSON.stringify(await cam()) === JSON.stringify(cam0), `${cam0} -> ${await cam()}`);
ok("CPU history ends with the lever locked", s.history.some((x) => x.startsWith("lower:cpu")) && s.history.at(-1) === "mech:cpu-socket-plate:lever:closed", JSON.stringify(s.history));

// Memory: choose DIMM_A2 with its slot button, clip, turn (refused first), lower, press home; reload mid-way.
await press(tile(ar ? /^الرام ·/ : /^RAM ·/));
await press(lab.locator("[class*=toolGroup] button").filter({ hasText: "DIMM_A2" }));
ok("RAM held over DIMM_A2 by its slot button", (await st()).ram?.target === "dimm-a2", JSON.stringify((await st()).ram));
const snap = await page.evaluate(() => localStorage.getItem("ytl_pc_plan_progress_v1"));
await page.reload(); await page.waitForSelector("canvas", { timeout: 120000 }); await page.waitForTimeout(7000); await settle();
s = await st();
ok("reload with the module in hand: nothing changed, the robot names DIMM_A2", (await page.evaluate(() => localStorage.getItem("ytl_pc_plan_progress_v1"))) === snap && s.lines[0] === "welcomeBack" && s.lines.includes("resume.ramOver"), JSON.stringify(s.lines));
const camR = await cam();
r = await fit("ram", flip);
s = await st();
ok("RAM installed in DIMM_A2, one step per click; the reversed module was refused first", !r.stuck && r.oneStep && r.refusedTurn && s.history.at(-1) === "seat:ram", `${JSON.stringify(r)} ${JSON.stringify(s.history.slice(-3))}`);
ok("no memory step moved the camera", JSON.stringify(await cam()) === JSON.stringify(camR), `${camR} -> ${await cam()}`);
ok("no page errors", errors.length === 0, errors.join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
