// Stage 4: an air cooler (Freezer 36 on the TUF GAMING Z790-PLUS WIFI, planned gaming build) fitted and taken off
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
await page.goto(base + "/pc"); await page.waitForSelector("#planner-title", { timeout: 120000 });
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
const hw = () => page.evaluate(() => window.__ytlHardware?.() ?? null);
const cam = () => page.evaluate(() => window.__ytlCamera?.() ?? null);
const primary = lab.locator("[class*=toolPrimary]");
const tile = (re) => lab.locator("[role=group] button:has(img)").filter({ hasText: re });
const turnRight = lab.getByRole("button", { name: ar ? /لف لليمين|يمين/ : /Turn right/ });
const shot = async () => { for (let k = 0; k < 3; k += 1) { try { return (await page.locator("canvas").first().screenshot({ timeout: 25000 })).toString("base64"); } catch { await page.waitForTimeout(1500); } } return null; };

async function fitCpu() {
  for (let i = 0; i < 16; i += 1) {
    const before = (await st()).history.length;
    await press(primary);
    const s = await st();
    if (s.placed.includes("cpu") && s.selection === null) return true;
    if (s.history.length === before) await press(turnRight);
  }
  return false;
}
await press(tile(/14600K/));
ok("CPU fitted first (the frame holds it down)", await fitCpu());

const cam0 = await cam();
await press(tile(/Freezer 36/));
const opened = async () => { if ((await lab.locator("details").count()) === 0) { await press(tile(/Freezer 36/)); } const d = lab.locator("details").first(); if (!(await d.evaluate((e) => e.open))) await d.locator("summary").click(); await page.waitForTimeout(300); };
await opened();
const h0 = await hw();
ok("before any cooler step the scene draws the socket frame as usual", h0 && h0.ilmRemoved === false && h0.frame === false && Object.keys(h0.screws).length === 0, JSON.stringify(h0));
const px0 = await shot();

// Backplate: an explicit choice, never made for the learner.
if (process.env.DEBUG) { await page.screenshot({ path: process.env.DEBUG, fullPage: false }); console.log(await primary.first().innerText().catch(() => "no primary")); }
const pad = lab.getByRole("button", { name: ar ? /الحشوة/ : /padding/ });
ok("the backplate support is the learner's choice (padding or tape both offered)", (await pad.count()) === 1 && (await lab.getByRole("button", { name: ar ? /الشريط/ : /tape/ }).count()) === 1);
await pad.click(); await page.waitForTimeout(900);
let s = await st();
ok("backplate padding recorded and drawn", s.history.at(-1) === "prep:motherboard:backplate:padding" && (await hw()).backplate === "padding", JSON.stringify(s.history.at(-1)));

// Each click: one step. Collect the history after every click until the frame is fully down.
const trail = [];
async function click1() {
  const before = (await st()).history.length;
  await press(primary);
  const s2 = await st();
  trail.push(s2.history.slice(before));
  return s2;
}
await click1(); await click1(); // lever, plate
let h = await hw();
ok("socket frame still drawn while lever and plate are only open", h.ilmRemoved === false);
await click1();
h = await hw();
ok("socket frame removed: four empty screw holes appear, no contact frame yet", h.ilmRemoved && !h.frame && Object.values(h.screws).length === 4 && Object.values(h.screws).every((v) => v === "empty"), JSON.stringify(h));
const px1 = await shot();
if (px0 && px1) ok("the picture of the socket changed when the frame came off", px1 !== px0); else console.log("SKIP  pixel comparison: the canvas could not be captured (software GL); not counted as a pass");
await click1();
h = await hw();
ok("contact frame placed", h.frame === true, JSON.stringify(h));
// Frame screws: 4 engaged then 4 tight, tight ones across.
const states = [];
for (let i = 0; i < 8; i += 1) { await click1(); states.push(Object.entries((await hw()).screws).filter(([k]) => k.startsWith("frame-screw")).map(([, v]) => ({ empty: "0", engaged: "1", tight: "2" })[v]).join("")); }
ok("each engaged click engages exactly one more screw", [1, 2, 3, 4].every((n, i) => states[i].split("").filter((c) => c === "1").length === n), JSON.stringify(states));
ok("tightening goes across the frame (second tight screw is opposite the first)", (() => { const t = states.slice(4).map((x) => x.split("").map((c, i) => (c === "2" ? i : -1)).filter((i) => i >= 0)); return t[1].length === 2 && (t[1][1] - t[1][0]) === 2; })(), JSON.stringify(states));
ok("all four tight at the end", states.at(-1) === "2222", JSON.stringify(states));
const camA = await cam();
ok("no step moved the camera", JSON.stringify(camA) === JSON.stringify(cam0), `${JSON.stringify(cam0)} -> ${JSON.stringify(camA)}`);

// Reload mid-way (after paste), then continue: the same picture comes back.
await click1(); // paste
const snap = (await st()).history.join("|");
const hBefore = JSON.stringify(await hw());
await page.reload(); await page.waitForSelector("canvas", { timeout: 120000 }); await page.waitForTimeout(7000); await settle();
for (let k = 0; k < 30 && !(await hw()); k += 1) await page.waitForTimeout(500);
s = await st();
ok("reload: progress untouched, the same hardware drawn again, the robot names the next cooler step", (await st()).history.join("|") === snap && JSON.stringify(await hw()) === hBefore && s.lines[0] === "welcomeBack" && s.lines.some((l) => l.startsWith("cooler.")), `${JSON.stringify(s.lines)}`);

// Back to the cooler, double click once: only one step.
await press(tile(/Freezer 36/)); await opened();
await primary.first().evaluate((el) => el.scrollIntoView({ block: "center" })); await page.waitForTimeout(300);
const b = await primary.boundingBox(); const n0 = (await st()).history.length;
await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(1200);
ok("a double click takes one step, not two", (await st()).history.length === n0 + 1, `${n0} -> ${(await st()).history.length}`);
await click1(); // place (film was the double-click step); whichever remains
for (let i = 0; i < 12 && !(await st()).history.includes("hw:cooler:screws:22"); i += 1) await click1();
s = await st();
h = await hw();
ok("cooler placed: its two screws appear as holes to fill, in order", s.history.some((x) => x === "place:cooler") && Object.keys(h.screws).some((k) => k.startsWith("body-screw")), JSON.stringify(h));
for (let i = 0; i < 12 && !(await st()).history.includes("hw:cooler:screws:22"); i += 1) await click1();
s = await st();
ok("cooler fully fitted, the robot says the cables come later", s.placed.includes("cooler") && s.lines.some((l) => l === "cooler.notWired" || l === "cooler.done"), JSON.stringify(s.lines));
h = await hw();
ok("both cooler screws drawn tight, frame screws still tight", h.screws["body-screw-0"] === "tight" && h.screws["body-screw-1"] === "tight" && h.screws["frame-screw-0"] === "tight", JSON.stringify(h));

// Undo steps the last screw back (engine and scene agree), then it is redone.
const undo = lab.getByRole("button", { name: ar ? /تراجع/ : /Undo/ });
const hbU = JSON.stringify(h); await press(undo);
const hu = await hw();
ok("undo: the last screw is back to engaged in the picture", hu.screws["body-screw-1"] !== "tight" || !(await st()).placed.includes("cooler"), JSON.stringify(hu));
await press(tile(/Freezer 36/)); await opened();
for (let i = 0; i < 4 && !(await st()).history.includes("hw:cooler:screws:22"); i += 1) await click1();
ok("redo by clicking the same step returns the same picture", JSON.stringify(await hw()) === hbU);

// Removal: physical steps, not Undo (the build keeps its history).
await press(tile(/Freezer 36/)); await opened();
const histLen = (await st()).history.length;
const off = lab.getByRole("button", { name: ar ? /أرخ|أخرج|ارفع|انزع/ : /Loosen|Take|Lift/ }).first();
for (let i = 0; i < 6 && (await st()).placed.includes("cooler"); i += 1) { await press(off); }
s = await st();
ok("cooler taken off step by step: screws loosened, then out, then lifted", !s.placed.includes("cooler") && s.history.length > histLen && s.history.at(-1) === "lift:cooler", JSON.stringify(s.history.slice(-6)));
h = await hw();
ok("removed cooler leaves its screws out of the picture; the contact frame stays on the board", Object.keys(h.screws).every((k) => !k.startsWith("body-screw")) && h.frame === true, JSON.stringify(h));

// Taking the contact frame off (the learner's own choice), one click each. The removal button is found by its semantic
// group, never by its words or position; the fitting alternative lives in a different group.
const camB = await cam();
await press(tile(/Freezer 36/)); await opened();
const removalGroup = lab.getByRole("group", { name: ar ? "فكّ إطار التلامس" : "Take the contact frame off" });
const refitGroup = lab.getByRole("group", { name: ar ? "تركيب مبرّد بدلًا من ذلك" : "Fit a cooler instead" });
const removal = removalGroup.getByRole("button");
const text = async (l) => (await l.first().innerText()).trim();
ok("optional: exactly one removal step is offered while the contact frame is on, and nothing is taken yet", (await removalGroup.count()) === 1 && (await removal.count()) === 1 && (await refitGroup.count()) === 0);
const hBefore2 = await hw();
const primaryText = async () => text(primary);
const mTrail = [];
const roleOf = async () => ({ removal: await text(removal), primary: await primaryText(), alt: (await refitGroup.count()) ? await text(refitGroup.getByRole("button")) : null, lines: (await st()).lines });
async function removeOne() { await opened(); const n = (await st()).history.length; await press(removal); const s3 = await st(); mTrail.push(s3.history.slice(n)); return s3; }
await removeOne(); // first screw loosened
let g = await roleOf();
ok("after the first loosening the primary action and the robot follow removal, not tightening", g.primary === g.removal && g.lines.some((l) => l === "cooler.frameScrewLoosen") && !g.lines.some((l) => l === "cooler.frameScrewTight"), JSON.stringify(g));
ok("fitting is still offered, as a clearly separate alternative", g.alt !== null && g.alt !== g.removal && g.alt !== g.primary, JSON.stringify(g));
await removeOne(); // second loosened
const sBeforeUndo = JSON.stringify((await hw()).screws);
await press(lab.getByRole("button", { name: ar ? /تراجع/ : /Undo/ })); await opened();
g = await roleOf();
const hU = await hw();
ok("undo restores the screw as it was in the scene, and guidance is still removal", JSON.stringify(hU.screws) !== sBeforeUndo && g.primary === g.removal, JSON.stringify({ g, hU }));
mTrail.pop(); await removeOne(); // redo the second loosening
const snapR = (await st()).history.join("|"); const hR = JSON.stringify((await hw()).screws);
await page.reload(); await page.waitForSelector("canvas", { timeout: 120000 }); await page.waitForTimeout(7000); await settle();
for (let k = 0; k < 30 && !(await hw()); k += 1) await page.waitForTimeout(500);
await press(tile(/Freezer 36/)); await opened();
g = await roleOf(); s = await st();
ok("reload part-way through removal: same saved steps, same picture, guidance still removal", s.history.join("|") === snapR && JSON.stringify((await hw()).screws) === hR && g.primary === g.removal && s.lines.some((l) => l === "cooler.frameScrewLoosen"), JSON.stringify({ g, same: s.history.join("|") === snapR }));
const lifted = async () => (await st()).history.includes("hw:motherboard:frame:");
let guard = 0;
while (!(await lifted()) && guard++ < 12) {
  const hh = await hw();
  const before = await text(removal);
  ok(`the frame is not offered for lifting while a frame screw is still in: "${before.slice(0, 40)}"`, !/contact frame off|ارفع إطار التلامس/i.test(before) || Object.entries(hh.screws).filter(([k]) => k.startsWith("frame-screw")).every(([, v]) => v === "empty"), JSON.stringify(hh.screws));
  await removeOne();
}
h = await hw(); s = await st();
ok("the frame comes off only after every screw is out; the CPU stays in the socket", s.history.includes("hw:motherboard:frame:") && h.frame === false && s.placed.includes("cpu"), JSON.stringify(h));
g = await roleOf();
ok("with the frame off the primary action and robot offer the original socket frame back", g.primary === g.removal && g.lines.some((l) => l === "cooler.cpuFree"), JSON.stringify(g));
await removeOne(); // original frame (ILM) back
s = await st(); h = await hw();
ok("one history step per click through the whole removal (4 loosened, 4 out, frame off, ILM back)", mTrail.length === 10 && mTrail.every((x) => x.length === 1) && mTrail.at(-2)[0] === "hw:motherboard:frame:" && mTrail.at(-1)[0] === "hw:motherboard:ilm:", JSON.stringify(mTrail));
ok("the scene draws the socket as original again (no frame, no frame screws, plate back)", h.frame === false && h.ilmRemoved === false && Object.keys(h.screws).every((k) => !k.startsWith("frame-screw")), JSON.stringify(h));
ok("the CPU stayed in the socket (never lifted for the learner)", s.placed.includes("cpu"));
ok("mounting steps moved no camera", JSON.stringify(await cam()) === JSON.stringify(camB));
ok("no page errors", errors.length === 0, errors.join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
