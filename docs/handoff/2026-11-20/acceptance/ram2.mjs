// Phase 2 review fixes: the memory module's slot as every part of the page shows it (B1 through undo and
// reload), the robot in view in the close-up, and the single-clip board end to end. Real pointer and keys.
import { chromium } from "@playwright/test";
const base = process.argv[2] ?? "http://127.0.0.1:3001";
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n} ${x}`); if (c) pass++; else { fail++; process.exitCode = 1; } };
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
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

// 1. Pick the first module up: no slot is claimed.
await press(tile(/^الرام ·/)); await page.waitForTimeout(2500);
let r = await ram();
ok("in hand over no slot: heading and status say so; no slot highlighted; the robot looks at the module", r.target === null && r.highlight === null && /مو فوق أي فتحة/.test(await heading()) && /مو فوق أي فتحة/.test(await status()) && r.guide?.[0]?.kind === "part", `${await heading()} | ${JSON.stringify(r)}`);
await press(lab.getByRole("button", { name: "تقريب" })); await page.waitForTimeout(7000);
await robotCheck("close-up, module in hand");
await page.screenshot({ path: "/tmp/r2-robot-closeup.png", clip: await page.locator("canvas").first().boundingBox() });
await keys("Enter");
ok("Enter over no slot refused", /مو فوق فتحة/.test(await bubble()) && (await st()).history.length === 0, await bubble());

// 2. Drag over B1 in the view, then line it up with the keys (leaving a small accepted offset).
let p = await scr();
await page.mouse.move(...p.held); await page.mouse.down();
for (let i = 1; i <= 8; i++) { await page.mouse.move(p.held[0] + ((p["slot:dimm-b1"][0] - p.held[0]) * i) / 8, p.held[1] + ((p["slot:dimm-b1"][1] - p.held[1]) * i) / 8); await page.waitForTimeout(150); }
await page.mouse.up(); await page.waitForTimeout(1500);
const dragged = await held();
ok("dragging in the view moved the module", dragged.offsetMm[1] > -16, JSON.stringify(dragged));
await alignTo([1, 10]);
await consistent("held over B1", "dimm-b1", "over");
await robotCheck("over B1, clip closed");
await keys("Enter");
ok("closed clip refused", /افتح مشبك الفتحة أول/.test(await bubble()) && (await st()).history.length === 0, await bubble());
p = await scr(); await page.mouse.click(...p["clip:dimm-b1"]); await page.waitForTimeout(2000);
ok("B1's clip opened in the view (only B1's)", (await st()).history.join() === "mech:dimm-b1-latch:open", (await st()).history.join());
await keys("Enter");
ok("reversed module refused", /الشق/.test(await bubble()) && !(await st()).history.some((x) => x.startsWith("lower:")), await bubble());
await keys("q"); await alignTo([4, 10]);
await keys("Enter");
ok("3 mm off refused, nothing snapped", /مو متطابقة/.test(await bubble()) && !(await st()).history.some((x) => x.startsWith("lower:")) && Math.abs((await held()).offsetMm[0] - 4) <= 1, await bubble());
await alignTo([1, 10]);
const pose = await held();
await consistent("lined up over B1", "dimm-b1", "over");
await keys("Enter");
let s = await st();
ok("lowered into B1 with its pose: resting, not counted", s.history.at(-1) === `lower:ram:0:${pose.offsetMm[0]}:${pose.offsetMm[1]}` && s.ram.installedIn === "dimm-b1" && s.ram.seating !== "seated" && (await count()) === 0, `${s.history.at(-1)} pose ${JSON.stringify(pose)} bubble ${await bubble()} ${JSON.stringify(s.ram)}`);
await consistent("resting in B1", "dimm-b1", "resting");
await press(btn("اضغطها لين تطق")); await page.waitForTimeout(1500);
s = await st();
await press(tile(/^الرام ·/)); await page.waitForTimeout(1200);
ok("pressed home in B1: installed, clip closed", s.history.at(-1) === "seat:ram" && (await count()) === 1 && /مسكّر/.test(await status()), `${s.history.join()} | ${await status()}`);
ok("one module alone is a valid installation (not refused for lacking a second)", (await count()) === 1 && !s.placed.includes("ram2"));
await consistent("installed in B1", "dimm-b1", "seated");

// 3. Undo the press, then the lowering: back in hand over B1, everywhere.
const undo = lab.getByRole("button", { name: "تراجع عن آخر خطوة" });
await press(undo); await page.waitForTimeout(1500);
await consistent("after undoing the press", "dimm-b1", "resting");
await press(undo); await page.waitForTimeout(2000);
ok("undo of the lowering: exact pose back in hand", JSON.stringify(await held()) === JSON.stringify(pose), JSON.stringify(await held()));
await consistent("after undoing the lowering", "dimm-b1", "over");
await robotCheck("after undo, over B1");
await page.screenshot({ path: "/tmp/r2-b1-undo.png", fullPage: false });
// The close-up from the panel frames B1 (its slot point lands near the middle of the view).
await press(lab.getByRole("button", { name: "تقريب" })); await page.waitForTimeout(7000);
p = await scr(); const box = await canvasBox();
ok("close-up from the panel frames B1", Math.hypot(p["slot:dimm-b1"][0] - (box.x + box.width / 2), p["slot:dimm-b1"][1] - (box.y + box.height / 2)) < 0.15 * box.width, `${p["slot:dimm-b1"]} vs centre ${box.x + box.width / 2},${box.y + box.height / 2}`);

// 4. Reload: the same.
await page.reload(); await page.waitForSelector("canvas", { timeout: 120000 }); await page.waitForTimeout(6000);
ok("reload keeps the pose", JSON.stringify(await held()) === JSON.stringify(pose));
await consistent("after reload", "dimm-b1", "over");
await keys("Enter"); await press(btn("اضغطها لين تطق")); await page.waitForTimeout(1200);

// 5. The second module: B1 is taken; A2 works but the pair is not the recommended one (A2 + B2).
await press(tile(/^الرام 2 ·/)); for (let i = 0; i < 20 && (await held())?.key !== "ram2"; i++) await page.waitForTimeout(500);
await keys("q"); await alignTo(SLOT["dimm-b1"]);
await consistent("second module over the taken B1 (no clip buttons; the slot named as taken)", "dimm-b1", "taken", "ram2");
await keys("Enter");
s = await st();
ok("occupied B1 refused; the first module still seated there", /فيها شريحة/.test(await bubble()) && s.ram.target === "dimm-b1" && s.placed.includes("ram") && s.history.filter((x) => x.startsWith("lower:")).length === 1, await bubble());
await alignTo(SLOT["dimm-a2"]);
p = await scr(); await page.mouse.click(...p["clip:dimm-a2"]); await page.waitForTimeout(1500);
await keys("Enter");
ok("A2 + B1 accepted, with the manual's recommendation explained", /يوصي/.test(await bubble()) && (await st()).history.at(-1).startsWith("lower:ram2"), await bubble());
ok("the recommendation is shown apart, labelled as the manual's", /توصية الدليل/.test(await lab.locator("[class*=hands]").first().innerText()));
await press(btn("اضغطها لين تطق")); await page.waitForTimeout(1000);
ok("both counted", (await count()) === 2);

// 6. Remove the first: open its clip in the view (it rises: not counted), lift it out.
await press(tile(/^الرام ·/)); await page.waitForTimeout(1000);
p = await scr(); await page.mouse.click(...p["clip:dimm-b1"]); await page.waitForTimeout(1500);
s = await st();
ok("clip opened: module released, no longer counted", s.history.at(-1) === "mech:dimm-b1-latch:open" && (await count()) === 1 && s.ram.installedIn === "dimm-b1" && s.ram.seating !== "seated", JSON.stringify(s.ram));
await press(btn("طلّعها")); await page.waitForTimeout(1500);
s = await st();
ok("lifted out: in hand over B1, the other module untouched", s.history.at(-1) === "lift:ram" && s.ram.target === "dimm-b1" && s.placed.includes("ram2"), JSON.stringify(s.ram));

// 7. A drag cancelled with Escape gives the camera back.
p = await scr();
await page.mouse.move(...p.held); await page.mouse.down(); await page.mouse.move(p.held[0] + 30, p.held[1] + 10, { steps: 3 }); await page.waitForTimeout(300);
await page.keyboard.press("Escape"); await page.mouse.up(); await page.waitForTimeout(800);
const c0 = await scr();
const cb = await page.locator("canvas").first().boundingBox();
// An empty spot of the scene (bottom right of the canvas), dragged with the real pointer.
await page.mouse.move(cb.x + cb.width * 0.9, cb.y + cb.height * 0.85); await page.mouse.down(); await page.mouse.move(cb.x + cb.width * 0.78, cb.y + cb.height * 0.78, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(2000);
const c1 = await scr();
ok("camera orbits after the cancelled drag", JSON.stringify(c0["slot:dimm-a1"]) !== JSON.stringify(c1["slot:dimm-a1"]), `${c0["slot:dimm-a1"]} -> ${c1["slot:dimm-a1"]}`);
// After orbiting, the robot settles again in view and points accurately (no camera move for it).
await page.waitForTimeout(3000);
const c2 = await scr();
await robotCheck("after orbiting", { mustPoint: false });
const rb = await robot();
ok("pointing only at a target in view", rb.pointing === false || (rb.target[0] >= 0 && rb.target[1] >= 0), JSON.stringify(rb.target));
ok("the robot did not move the camera", JSON.stringify(c2["slot:dimm-a1"]) === JSON.stringify((await scr())["slot:dimm-a1"]));

// 8. Narrow viewport (phone width): the robot stays in the scene.
await page.setViewportSize({ width: 430, height: 932 }); await page.waitForTimeout(5000);
await page.locator("canvas").first().scrollIntoViewIfNeeded(); await page.waitForTimeout(2500);
await robotCheck("narrow viewport", { mustPoint: false });
await page.screenshot({ path: "/tmp/r2-narrow.png" });
await page.setViewportSize({ width: 1440, height: 1000 }); await page.waitForTimeout(2000);

ok("no raw translation keys", !/\b(simplePc|companion|hands|labs)\.[a-zA-Z]/.test(await page.locator("body").innerText()));
ok("no page errors", errors.length === 0, errors.join(" | "));
console.log(`TOTAL pass ${pass} fail ${fail}`);
await browser.close();
