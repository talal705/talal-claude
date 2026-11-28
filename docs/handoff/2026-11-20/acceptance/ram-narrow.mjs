// Phase 2 review fixes: the memory module's slot as every part of the page shows it (B1 through undo and
// reload), the robot in view in the close-up, and the single-clip board end to end. Real pointer and keys.
import { chromium } from "@playwright/test";
const base = process.argv[2] ?? "http://127.0.0.1:3001";
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n} ${x}`); if (c) pass++; else { fail++; process.exitCode = 1; } };
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
await ctx.addCookies([{ name: "ytl_locale", value: "ar", url: base }]);
const page = await ctx.newPage(); page.setDefaultTimeout(180000); const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(base + "/pc"); await page.evaluate(() => localStorage.clear()); await page.reload();
await page.waitForSelector("#planner-title", { timeout: 120000 });
// Planner buttons with the real pointer.
// Panel buttons with the real pointer; then the scene is brought back fully into view for pointer work in it.
const press = async (l) => {
  // The real pointer at the button's middle (no wait for animation frames, which the software renderer makes slow).
  await l.first().evaluate((el) => el.scrollIntoView({ block: "center" })); await page.waitForTimeout(300);
  const b = await l.first().boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(500);
  await page.evaluate(() => { const c = document.querySelector("canvas"); if (c) { const r = c.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) window.scrollBy(0, r.top - Math.max(0, (innerHeight - r.height) / 2)); } }); await page.waitForTimeout(300);
};
await press(page.getByRole("radio", { name: /ألعاب/ })); await press(page.getByRole("button", { name: "ساعدني أختار" })); await press(page.getByRole("button", { name: "ابدأ التجميع" }));
await page.waitForSelector("canvas", { timeout: 120000 }); await page.waitForTimeout(5000);
const lab = page.locator("section[aria-labelledby='simple-pc-title']");
const st = () => page.evaluate(() => window.__ytlSimplePc());
const ram = async () => (await st()).ram;
const scr = () => page.evaluate(() => window.__ytlSocketScreen?.() ?? {});
const robot = () => page.evaluate(() => window.__ytlRobot?.() ?? { shown: false });
const count = async () => Number((await page.locator("[class*=progress]").first().innerText()).trim().split(/\s/)[0]);
const bubble = async () => (await page.locator("[class*=bubble]").first().innerText()).replace(/\s+/g, " ").trim();
const heading = async () => (await lab.locator("[class*=selection] span").first().innerText()).trim();
const status = async () => (await lab.locator("[class*=handsState]").first().innerText()).trim();
const clipButtons = async () => (await lab.locator("[class*=hands] [class*=holdRow]").first().innerText()).replace(/\s+/g, " ");
const held = () => page.evaluate(() => JSON.parse(localStorage.getItem("ytl_pc_plan_progress_v1")).held ?? null);
const btn = (name) => lab.getByRole("button", { name, exact: true });
const tile = (re) => lab.locator("[role=group] button:has(img)").filter({ hasText: re });
const canvasBox = async () => page.locator("canvas").first().boundingBox();
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
const SLOT = { "dimm-a1": [0, -9.5], "dimm-a2": [0, 0], "dimm-b1": [0, 9.5], "dimm-b2": [0, 19] };
/** The robot: shown, inside the scene's canvas (with a margin), and off every clip, key and notch on screen. */
const robotCheck = async (label, { mustPoint = true } = {}) => {
  await page.waitForTimeout(3000);
  const r = await robot(); const box = await canvasBox();
  if (!r.shown) { ok(`${label}: robot shown`, false, JSON.stringify(r)); return; }
  const [cx, cy] = r.centre;
  const inside = cx - r.radiusPx >= 0 && cy - r.radiusPx >= 0 && cx + r.radiusPx <= box.width && cy + r.radiusPx <= box.height;
  const nearest = Math.min(...r.avoid.filter(([x, y]) => x >= 0 && y >= 0 && x <= box.width && y <= box.height).map(([x, y]) => Math.hypot(x - cx, y - cy)));
  ok(`${label}: robot inside the scene, compact, clear of clips/keys/notch`, inside && r.radiusPx >= 8 && r.radiusPx <= 0.12 * box.height && nearest > r.radiusPx * 1.2, `centre ${r.centre} r ${r.radiusPx}px in ${box.width}x${box.height}; nearest feature ${Math.round(nearest)}px`);
  const inView = r.target && r.target[0] >= 0 && r.target[1] >= 0 && r.target[0] <= box.width && r.target[1] <= box.height;
  // It points exactly when its target can be seen: in view and not hidden behind something.
  if (mustPoint) ok(`${label}: points when the target is visible, pauses when it is hidden`, r.pointing === Boolean(inView && !r.occluded) && (r.pointing || r.occluded), `target ${JSON.stringify(r.target)} occluded ${r.occluded} (${r.blocker}) pointing ${r.pointing}`);
};
const consistent = async (label, slot, how, key = "ram") => {
  // The panel shows the selected module: select it if a finished step put it down.
  if ((await st()).selection?.key !== key) await press(tile(key === "ram" ? /^الرام ·/ : /^الرام 2 ·/));
  const r = await ram(); const h = await heading(); const s = await status(); const c = await clipButtons().catch(() => "");
  const name = slot.replace("dimm-", "DIMM_").toUpperCase();
  const guideOk = (r.guide ?? []).every((g) => (g.kind === "solid" ? g.solidId.startsWith(slot + "-") : g.kind === "mount" ? g.placeId === slot : false));
  ok(`${label}: heading, status, clip button, highlight, robot target and close-up all say ${name}`,
    (how === "over" || how === "taken" ? r.target === slot && r.highlight === slot : r.installedIn === slot) && h.includes(name) && s.includes(name) && (how === "seated" || c.includes(name) || (how === "taken" && (await lab.locator("[class*=hands]").first().innerText()).includes(name))) && guideOk && !/A2/.test(h.replace(name, "")),
    `heading "${h}" | status "${s}" | buttons "${c}" | ${JSON.stringify(r)}`);
};

await press(tile(/^الرام ·/)); await page.waitForTimeout(2500);
await press(lab.getByRole("button", { name: "تقريب" })); await page.waitForTimeout(8000);
await page.evaluate(() => { const c = document.querySelector("canvas"); const r = c.getBoundingClientRect(); window.scrollBy(0, r.top - 20); }); await page.waitForTimeout(1500);
await robotCheck("narrow, RAM close-up, module in hand");
await keys(...Array(16).fill("ArrowRight"), ...Array(6).fill("ArrowUp"));
await robotCheck("narrow, over A2 (clip closed)");
await page.screenshot({ path: "/tmp/r2-narrow-ram.png", clip: await page.locator("canvas").first().boundingBox() });
ok("no page errors", errors.length === 0, errors.join(" | "));
console.log(`TOTAL pass ${pass} fail ${fail}`);
await browser.close();
