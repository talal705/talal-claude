// One-click installation, the left sidebar and the free camera, through real browser input on a production build.
// A fresh learner: planner -> one click per part -> refusals, place choice, repeated clicks, Undo, reload, an older save
// without groups, removal and a lead by the existing controls, RGB, orbit/pan/zoom/focus/reset, layout and overflow.
// No assembly state is seeded and no engine function is called from the browser.
// Usage: node one-click.mjs [en|ar] [width] [base URL]   (CHROME=<path> to use another browser binary)
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const locale = process.argv[2] ?? "en", width = Number(process.argv[3] ?? 1440);
const base = process.argv[4] ?? "http://127.0.0.1:3031";
const T = JSON.parse(readFileSync(new URL(`../../../../apps/web/messages/${locale}/labs.json`, import.meta.url))).simplePc;
const P = T.planner, H = T.hands, A = T.action;
const phone = width < 800;
const artifacts = process.env.VTE_SHOTS ?? "/private/tmp/vte-one-click";
mkdirSync(artifacts, { recursive: true });
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let passed = 0, failed = 0;
function check(name, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"} ${name}${condition ? "" : `: ${detail}`}`);
  if (condition) passed++; else { failed++; process.exitCode = 1; }
}
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
// Narrow runs use Chromium's touch emulation (taps), which is not a physical phone.
const context = await browser.newContext({ viewport: { width, height: phone ? 900 : 1000 }, ...(phone ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}) });
await context.addCookies([{ name: "ytl_locale", value: locale, url: base }]);
const page = await context.newPage();
page.setDefaultTimeout(25000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const settle = (ms = 700) => page.waitForTimeout(ms);
const press = async (locator) => { await locator.scrollIntoViewIfNeeded(); if (phone) await locator.tap(); else await locator.click(); await settle(); };
const plan = () => page.evaluate(() => JSON.parse(localStorage.getItem("ytl_pc_plan_v1") ?? "null")?.build);
// The planned build's progress; the practice build (/pc?practice=1) keeps its own key.
let progressKey = "ytl_pc_plan_progress_v1";
const snapshot = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), progressKey);
const state = () => page.evaluate(() => window.__ytlSimplePc());
const camera = () => page.evaluate(() => JSON.stringify(window.__ytlCamera?.() ?? null));
const pivot = () => page.evaluate(() => window.__ytlScene?.camera() ?? null);
const lab = page.locator("section[aria-labelledby='simple-pc-title']");
const card = lab.locator("[class*=actionCard]");
const install = card.locator("[class*=installButton]");
const status = card.locator("[class*=actionStatus]");
const canvas = lab.locator("[class*=canvas]").first();
const tile = (name) => lab.getByRole("group", { name: T.partsLabel, exact: true }).getByRole("button").filter({ hasText: name }).first();
const lines = async () => (await state()).lines;
const details = lab.locator("details[class*=partOptions]");
const companion = lab.locator("[class*=companionSlot]");
const partsList = () => lab.getByRole("group", { name: T.partsLabel, exact: true });
/** Phone: every section full width, one under the other, in the intended order, never overlapping. */
async function checkStack(where) {
  const sections = [["card", card], ["view", lab.locator("[class*=viewer]").first()], ["robot", companion], ["parts", lab.locator("[class*=controls]").first()]];
  const rects = [];
  for (const [name, loc] of sections) rects.push([name, await box(loc)]);
  const outer = await box(lab.locator("[class*=workspace]"));
  check(`${where} phone: each section is full width`, rects.every(([, r]) => r && Math.abs(r.x - outer.x) <= 1 && r.width >= outer.width - 2), JSON.stringify(rects));
  check(`${where} phone: card, view, robot, parts one under the other without overlap`, rects.every(([, r], i) => i === 0 || r.y >= rects[i - 1][1].y + rects[i - 1][1].height - 1), JSON.stringify(rects));
}
/** Desktop: the parts start beside the view, and a part far down the list is chosen with the view and the card still in sight. */
async function checkBeside(where) {
  const view = await box(canvas), first = await box(partsList().getByRole("button").first());
  check(`${where} desktop: the parts list starts beside the 3D view, not below it`, first.y < view.y + view.height, JSON.stringify({ first, view }));
  const last = partsList().getByRole("button").last();
  await last.scrollIntoViewIfNeeded();
  await settle(300);
  const [v2, c2, l2] = [await box(canvas), await box(card), await box(last)];
  const inView = (r) => r && r.y < (phone ? 900 : 1000) && r.y + r.height > 0;
  check(`${where} desktop: the last part is reachable while the view and the card stay visible`, inView(v2) && inView(c2) && inView(l2) && v2.y + v2.height > 300, JSON.stringify({ v2, c2, l2 }));
}
const box = (locator) => locator.boundingBox();
async function shot(name) {
  try { await page.screenshot({ path: join(artifacts, `${name}-${locale}-${width}.png`), timeout: 15000 }); }
  catch (e) { console.log(`NOT CAPTURED ${name}: ${String(e).split("\n")[0]}`); }
}
/** Selects a part by its tile (deselecting first if it is already the selection). */
async function select(name) {
  // With every part in, the page opens on the Cables tab (also after a reload): the parts are one tab away.
  const partsTab = lab.getByRole("button", { name: new RegExp(`^${escape(T.partsTab)} `) });
  if ((await partsTab.getAttribute("aria-pressed")) !== "true") await press(partsTab);
  if ((await tile(name).getAttribute("aria-pressed")) !== "true") await press(tile(name));
  return (await state()).selection.key;
}
/** One click on Install: exactly one grouped action, the part in, nothing else, no lead, the camera unchanged. */
async function oneClick(name, label = String(name)) {
  const key = await select(name);
  const before = await state(), saved = await snapshot(), cam = await camera();
  check(`${label}: the card says it is ready`, (await status.innerText()) === A.status.ready, await status.innerText());
  await press(install);
  const after = await state(), now = await snapshot();
  const steps = after.history.length - before.history.length;
  check(`${label}: one click installed it completely`, after.placed.includes(key), JSON.stringify(after.placed));
  check(`${label}: its steps were saved as one action (${steps} steps)`, steps >= 1 && (now.groups?.length ?? 0) === (saved?.groups?.length ?? 0) + (steps > 1 ? 1 : 0), JSON.stringify(now.groups));
  check(`${label}: nothing else was added or removed`, before.placed.every((k) => after.placed.includes(k)) && after.placed.length === before.placed.length + 1 && after.connected.length === before.connected.length);
  check(`${label}: the camera did not move`, (await camera()) === cam);
  check(`${label}: the robot confirms it`, (await lines()).includes("install.doneIn"), JSON.stringify(await lines()));
  check(`${label}: the card shows it installed`, [A.status.installed, A.status.installing].includes(await status.innerText()), await status.innerText());
  return key;
}

try {
  await page.goto(`${base}/pc`);
  await page.waitForSelector("#planner-title");
  await press(page.getByRole("radio", { name: new RegExp(`^${escape(P.purposes.gaming.name)}`) }));
  await press(page.getByRole("button", { name: P.helpMe, exact: true }));
  check("planner: a suggested gaming build", (await plan()).purpose === "gaming" && !!(await plan()).parts.cpu);
  await press(page.getByRole("tab", { name: P.categories.storage, exact: true }));
  const pcard = (model) => page.locator("#planner-catalog article").filter({ has: page.getByRole("heading", { name: model }) }).first();
  await press(pcard(/870 EVO/).getByRole("button", { name: new RegExp(`^(${escape(P.add)}|${escape(P.replace)}) `) }));
  check("planner: a SATA drive is added", (await plan()).parts.storage.includes("samsung-870-evo-1tb"));
  await press(pcard(/870 EVO/).getByRole("button", { name: new RegExp(`^${escape(P.removeFromBuild)} `) }));
  check("planner: its own Remove from my build takes it out, the M.2 stays", !(await plan()).parts.storage.includes("samsung-870-evo-1tb") && (await plan()).parts.storage.includes("samsung-990-pro-1tb"));
  await press(pcard(/870 EVO/).getByRole("button", { name: new RegExp(`^(${escape(P.add)}|${escape(P.replace)}) `) }));
  await press(page.getByRole("button", { name: P.start, exact: true }));
  await page.waitForSelector("canvas");
  await settle(4000);

  // ---- Layout ----
  const c = await box(card), v = await box(canvas);
  check("the page keeps its language direction", (await page.evaluate(() => document.documentElement.dir)) === (locale === "ar" ? "rtl" : "ltr"));
  if (!phone) {
    check("desktop: the parts and controls sidebar is physically left of the 3D view", c.x + c.width <= v.x + 1, `card ${c.x}+${c.width}, view ${v.x}`);
    check("desktop: the sidebar's own text keeps the page direction", (await card.evaluate((el) => getComputedStyle(el).direction)) === (locale === "ar" ? "rtl" : "ltr"));
    await checkBeside("planned build");
    await page.evaluate(() => window.scrollTo(0, 0));
  } else {
    await checkStack("planned build");
    check("phone: the view is not shrunk (at least 280 px tall, full width)", v.height >= 280 && v.width >= width - 40, JSON.stringify(v));
  }
  check("no page-wide horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await shot("start");

  // ---- Mandatory prerequisite: nothing changes, the reason is shown and said ----
  const beforeBlocked = await state();
  await select(/RTX 5060/);
  check("card before the board is in: blocked, Install disabled", (await status.innerText()) === A.status.blocked && await install.isDisabled());
  check("card says what is required first", (await card.innerText()).includes(A.requiredFirst.replace(/:$/, "")), await card.innerText());
  check("the robot names the mandatory prerequisite", (await lines()).includes("blocked.boardFirst"), JSON.stringify(await lines()));
  check("a refused part changes nothing", JSON.stringify((await state()).history) === JSON.stringify(beforeBlocked.history));

  // ---- Switching language re-words the robot's guidance; progress, selection and camera stay ----
  await select(/14600K/);
  const other = locale === "ar" ? "en" : "ar";
  const switchTo = async (want) => {
    // The language button names (and is marked with) the language it switches to; "Settings" shares its look.
    await press(page.locator(`button.locale-switch[lang="${want}"]`));
    await page.waitForFunction((l) => document.documentElement.lang === l, want, { timeout: 15000 });
    await settle(1200);
  };
  for (const want of [other, locale]) {
    const [hist, cam, sel] = [JSON.stringify((await state()).history), await camera(), JSON.stringify((await state()).selection)];
    await switchTo(want);
    const placeNow = (await card.locator("[class*=actionPlace]").innerText()).replace(/^[^:：]*[:：]\s*/, "");
    const bubble = await companion.innerText();
    check(`switch to ${want}: the robot's place is named in ${want} (${placeNow})`, placeNow.length > 0 && bubble.includes(placeNow), bubble.slice(0, 200));
    check(`switch to ${want}: progress, selection and camera unchanged`, JSON.stringify((await state()).history) === hist && JSON.stringify((await state()).selection) === sel && (await camera()) === cam);
  }

  // ---- One click per part, in the bench order ----
  await oneClick(/14600K/, "CPU");
  const ram1 = await select(new RegExp(`^${escape(T.roles.ram)} ·`));
  check("memory: the board manual's slot is chosen and marked recommended", (await card.getByRole("radio", { checked: true }).innerText()).includes("DIMM_A2") && (await card.getByRole("radio", { checked: true }).innerText()).includes(A.recommended));
  await oneClick(new RegExp(`^${escape(T.roles.ram)} ·`), "RAM 1");
  check("RAM 1 went into DIMM_A2", (await snapshot()).history.some((s) => s.startsWith(`lower:${ram1}:`)) && (await state()).ram?.installedIn === "dimm-a2", JSON.stringify((await state()).ram));

  // Choosing another place, an occupied one refused, and back.
  await select(new RegExp(`^${escape(T.roles.ram)} 2 ·`));
  const radios = card.getByRole("radio");
  check("memory 2: the taken slot cannot be chosen", await radios.filter({ hasText: "DIMM_A2" }).first().isDisabled());
  check("memory 2: DIMM_B2 is chosen automatically", (await card.getByRole("radio", { checked: true }).innerText()).includes("DIMM_B2"));
  const camChoose = await camera();
  await press(radios.filter({ hasText: "DIMM_A1" }).first());
  check("choosing DIMM_A1 makes it the place, with the recommended one as a tip", (await card.getByRole("radio", { checked: true }).innerText()).includes("DIMM_A1") && (await card.locator("[class*=actionTip]").innerText()).includes("DIMM_B2"));
  check("choosing a place does not move the camera or install anything", (await camera()) === camChoose && !(await state()).placed.includes("ram2"));
  await press(radios.filter({ hasText: "DIMM_B2" }).first());

  // Repeated clicks: a double click is one installation.
  const beforeDouble = await snapshot();
  await install.scrollIntoViewIfNeeded();
  if (phone) { await install.tap(); await install.tap({ force: true }).catch(() => {}); } else await install.dblclick({ force: true });
  await settle(1200);
  const afterDouble = await snapshot();
  check("a double click installs memory 2 once", (afterDouble.groups?.length ?? 0) === (beforeDouble.groups?.length ?? 0) + 1 && afterDouble.placed.filter((k) => k === "ram2").length === 1, JSON.stringify(afterDouble.groups));
  check("memory 2 is in DIMM_B2", (await state()).ram?.installedIn === "dimm-b2", JSON.stringify((await state()).ram));

  // One Undo takes the whole installation back, nothing else.
  const camUndo = await camera();
  await press(card.getByRole("button", { name: T.undo, exact: true }));
  const undone = await snapshot();
  check("one Undo restores the state before the installation", JSON.stringify(undone.history) === JSON.stringify(beforeDouble.history) && !undone.placed.includes("ram2") && undone.placed.includes("ram"));
  check("Undo leaves the camera alone and says what it did", (await camera()) === camUndo && (await lines()).includes("install.undone"));
  await oneClick(new RegExp(`^${escape(T.roles.ram)} 2 ·`), "RAM 2 again");

  await oneClick(/990 PRO/, "M.2 drive");
  await oneClick(/Freezer 36/, "cooler (contact frame on the bench)");
  await oneClick(/TUF GAMING/, "motherboard");
  await oneClick(/RM850x|RM650e|RM\d+/, "power supply");
  const sata = await oneClick(/870 EVO/, "SATA drive");
  await oneClick(/RTX 5060/, "graphics card");
  const fan = await oneClick(/P12 PWM/, "case fan");
  const all = await state();
  check("every part is in and no lead was connected by installing", all.connected.length === 0 && all.history.every((s) => !/^(plug|cable):/.test(s)));
  await shot("all-installed");

  // ---- RGB: optional, never progress ----
  const beforeRgb = await state();
  await press(card.getByRole("button", { name: T.view.rgb, exact: true }));
  check("RGB toggles without changing progress", (await state()).view.rgb === !beforeRgb.view.rgb && JSON.stringify((await state()).history) === JSON.stringify(beforeRgb.history));

  // ---- Reload keeps the steps and the grouping ----
  const beforeReload = await snapshot();
  await page.reload();
  await page.waitForSelector("canvas");
  await settle(4000);
  const reloaded = await snapshot();
  check("reload keeps every step and every grouped action", JSON.stringify(reloaded.history) === JSON.stringify(beforeReload.history) && JSON.stringify(reloaded.groups) === JSON.stringify(beforeReload.groups));
  await press(card.getByRole("button", { name: T.undo, exact: true }));
  check("after reload, one Undo takes the last installation (the fan) back whole", !(await snapshot()).placed.includes(fan) && (await snapshot()).history.length === beforeReload.groups.at(-1)[0]);
  await oneClick(/P12 PWM/, "case fan after reload");

  // ---- An older save without groups still undoes one step at a time ----
  const grouped = await snapshot();
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("ytl_pc_plan_progress_v1")); delete s.groups; localStorage.setItem("ytl_pc_plan_progress_v1", JSON.stringify(s)); });
  await page.reload();
  await page.waitForSelector("canvas");
  await settle(4000);
  check("an older save without groups loads unchanged", JSON.stringify((await snapshot()).history) === JSON.stringify(grouped.history));
  await press(card.getByRole("button", { name: T.undo, exact: true }));
  check("…and its Undo takes back exactly one step", (await snapshot()).history.length === grouped.history.length - 1);
  // Put the fan's last screw back by its own control (the step-by-step controls stay available).
  await select(/P12 PWM/);
  if (!(await details.evaluate((el) => el.open))) await press(details.locator("summary"));
  await press(details.getByRole("button", { name: new RegExp(`^${escape(H.nextScrew.split("{")[0].trim())}`) }).first());
  check("the step-by-step control puts the last screw back", (await snapshot()).history.length === grouped.history.length && (await state()).placed.includes(fan));

  // ---- Existing removal workflow: screws out one by one, then lift ----
  await select(/P12 PWM/);
  if (!(await details.evaluate((el) => el.open))) await press(details.locator("summary"));
  for (let i = 0; i < 8 && (await state()).placed.includes(fan); i++) {
    const out = details.getByRole("button", { name: new RegExp(`^${escape(H.unscrewNext.split("{")[0].trim())}`) });
    if (await out.count()) await press(out.first());
    else await press(details.getByRole("button", { name: H.liftOutOf.fan, exact: true }));
  }
  check("removal by its own steps still works (the fan is out)", !(await state()).placed.includes(fan));
  await oneClick(/P12 PWM/, "case fan reinstalled");

  // ---- Existing cable workflow: one lead, one end per press ----
  await press(lab.getByRole("button", { name: new RegExp(`^${escape(T.cablesTab)} `) }));
  const lead = lab.getByRole("group", { name: T.cablesLabel, exact: true }).getByRole("button").first();
  await press(lead);
  const leadKey = (await state()).selection.key;
  for (let j = 0; j < 4 && !(await state()).connected.includes(leadKey); j++) {
    const panel = lab.locator("[class*=cableDetail]");
    await press(panel.getByRole("radio").filter({ hasNotText: H.positionTag.taken }).first());
    await press(panel.getByRole("button", { name: H.turnPlug, exact: true }));
    const n = (await state()).history.length;
    await press(panel.getByRole("button", { name: H.plugIn, exact: true }));
    check(`lead ${leadKey}: one plug, one saved step`, (await state()).history.length === n + 1);
  }
  check(`lead ${leadKey}: connected by its own controls`, (await state()).connected.includes(leadKey));
  await press(lab.getByRole("button", { name: new RegExp(`^${escape(T.partsTab)} `) }));

  // ---- Camera: orbit, pan, zoom, focus, reset; gestures never install or select ----
  await press(lab.getByRole("button", { name: A.resetView, exact: true }));
  // Measured after the press: on a phone pressing it scrolls the page, which moves the view.
  await canvas.scrollIntoViewIfNeeded();
  await settle(300);
  const viewBox = await box(canvas);
  const cx = viewBox.x + viewBox.width / 2, cy = viewBox.y + viewBox.height / 2;
  const home = await pivot();
  const homeCam = await camera();
  const hist0 = JSON.stringify((await state()).history), sel0 = JSON.stringify((await state()).selection);
  const drag = async (dx, dy, button = "left") => {
    if (phone && button === "left") {
      // One finger across the view, through the Chromium touch emulation.
      const client = await context.newCDPSession(page);
      const at = (x, y) => [{ x, y }];
      await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(cx, cy) });
      for (let i = 1; i <= 8; i++) await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(cx + (dx * i) / 8, cy + (dy * i) / 8) });
      await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await client.detach();
    } else {
      await page.mouse.move(cx, cy);
      await page.mouse.down({ button });
      for (let i = 1; i <= 8; i++) await page.mouse.move(cx + (dx * i) / 8, cy + (dy * i) / 8);
      await page.mouse.up({ button });
    }
    await settle(400);
  };
  await drag(180, 0);
  const orbited = await camera();
  check("orbit: dragging turns the view", orbited !== homeCam);
  await drag(0, -120);
  check("vertical angle: dragging up and down tilts the view", (await camera()) !== orbited);
  check("dragging never installs, selects or records anything", JSON.stringify((await state()).history) === hist0 && JSON.stringify((await state()).selection) === sel0);
  if (!phone) {
    const beforePan = await pivot();
    await drag(-160, 60, "right");
    const panned = await pivot();
    check("pan: a right-drag moves the pivot", JSON.stringify(panned.target) !== JSON.stringify(beforePan.target), JSON.stringify([beforePan, panned]));
    await page.mouse.move(cx, cy);
    const beforeZoom = await pivot();
    await page.mouse.wheel(0, -600);
    await settle(500);
    const zoomed = await pivot();
    const dist = (p) => Math.hypot(...p.position.map((n, i) => n - p.target[i]));
    check("zoom: the wheel brings the camera closer", dist(zoomed) < dist(beforeZoom), `${dist(beforeZoom)} -> ${dist(zoomed)}`);
  }
  await press(lab.getByRole("button", { name: `${T.zoomIn}`, exact: true }));
  check("zoom buttons still work", (await camera()) !== orbited);
  await select(/RTX 5060/);
  const beforeFocus = await camera();
  await press(lab.getByRole("button", { name: A.focus, exact: true }));
  await settle(900);
  check("Focus selected part moves the camera to it, only when pressed", (await camera()) !== beforeFocus);
  await press(lab.getByRole("button", { name: A.resetView, exact: true }));
  await settle(400);
  const back = await pivot();
  check("Reset view returns to the whole build", JSON.stringify(back.target.map(Math.round)) === JSON.stringify(home.target.map(Math.round)) && (await camera()) === homeCam, JSON.stringify([home, back]));
  check("the selection and every step are unchanged by camera use", JSON.stringify((await state()).history) === hist0);

  // ---- The card stays reachable while browsing the parts list ----
  await lab.getByRole("group", { name: T.partsLabel, exact: true }).getByRole("button").last().scrollIntoViewIfNeeded();
  await settle(300);
  const cardNow = await box(card);
  check("the Install card stays in view while the parts list is scrolled", cardNow && cardNow.y >= -1 && cardNow.y + 60 <= (phone ? 900 : 1000), JSON.stringify(cardNow));
  check("no page-wide horizontal overflow at the end", await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("end");

  // ---- Editing the plan keeps each untouched installation as one action ----
  // (Earlier the older-save check removed the saved groups; the fan's later reinstall is grouped again.)
  const beforeEdit = await snapshot();
  const steps = (snap, [a, b]) => JSON.stringify(snap.history.slice(a, b));
  const mentions = (st, key) => new RegExp(`[:@]${key}(?=[:@]|$)`).test(st);
  check("plan edit: there is a grouped installation to keep (the fan's)", (beforeEdit.groups?.length ?? 0) > 0 && beforeEdit.history.some((st) => mentions(st, sata)));
  await press(lab.getByRole("button", { name: P.editBuild, exact: true }));
  await page.waitForSelector("#planner-title");
  await press(page.getByRole("tab", { name: P.categories.storage, exact: true }));
  await press(page.locator("#planner-catalog article").filter({ has: page.getByRole("heading", { name: /870 EVO/ }) }).first().getByRole("button", { name: new RegExp(`^${escape(P.removeFromBuild)} `) }));
  await press(page.getByRole("button", { name: P.start, exact: true }));
  await page.waitForSelector("canvas");
  await settle(4000);
  const afterEdit = await snapshot();
  check("plan edit: the removed drive's steps leave the progress", !afterEdit.history.some((st) => mentions(st, sata)), afterEdit.history.filter((st) => mentions(st, sata)).join());
  check("plan edit: the untouched installation is still one action with the same steps", JSON.stringify((afterEdit.groups ?? []).map((g) => steps(afterEdit, g))) === JSON.stringify(beforeEdit.groups.map((g) => steps(beforeEdit, g))), JSON.stringify({ before: beforeEdit.groups, after: afterEdit.groups }));
  const lastGroup = afterEdit.groups.at(-1);
  if (lastGroup[1] === afterEdit.history.length) {
    await press(card.getByRole("button", { name: T.undo, exact: true }));
    check("plan edit: one Undo still takes that installation back whole", (await snapshot()).history.length === lastGroup[0]);
  } else console.log(`NOTE plan edit: ${afterEdit.history.length - lastGroup[1]} single step(s) after the group; whole-group Undo not exercised here`);

  // ---- The practice build (/pc?practice=1): layout, and guidance that follows the one-click plan ----
  await page.goto(`${base}/pc?practice=1`);
  progressKey = "ytl_simple_pc_v1";
  await page.waitForSelector("canvas");
  await settle(4000);
  if (phone) await checkStack("practice build"); else await checkBeside("practice build");
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("practice");
  await select(new RegExp(`^${escape(T.parts.cpu)}`));
  await press(lab.getByRole("button", { name: T.companion.quick.next, exact: true }));
  check("practice: What next? for the selected CPU says to press Install", (await lines()).includes("install.ready"), JSON.stringify(await lines()));
  await press(install);
  check("practice: one click installs the CPU", (await state()).placed.includes("cpu"));
  await press(card.getByRole("button", { name: T.undo, exact: true }));
  check("practice: one Undo takes it out again", !(await state()).placed.includes("cpu"));
  await page.reload();
  await page.waitForSelector("canvas");
  await settle(4000);
  const welcome = await lines();
  check("practice: after reload the CPU is selected and ready", (await status.innerText()) === A.status.ready);
  check("practice: the welcome back follows the plan (press Install), not a manual lever step", welcome[0] === "welcomeBack" && welcome.includes("install.ready") && !welcome.some((l) => /^hands\./.test(l)), JSON.stringify(welcome));
  await press(lab.getByRole("button", { name: T.companion.quick.help, exact: true }));
  check("practice: Help for the selected CPU follows the plan too", (await lines()).includes("install.ready"), JSON.stringify(await lines()));

  // ---- The practice build's liquid cooler: blocked twice with nothing changed, then one action, Undo, reload ----
  await oneClick(new RegExp(`^${escape(T.parts.cpu2)}`), "practice Core i9");
  const aioTile = new RegExp(`^${escape(T.parts.aio)}`);
  const unchanged = async (what, run) => {
    const before = JSON.stringify(await snapshot());
    await run();
    check(`${what}: the build and saved progress are unchanged`, JSON.stringify(await snapshot()) === before);
  };
  await unchanged("liquid cooler before the board", async () => {
    await select(aioTile);
    check("liquid cooler before the board: blocked, Install disabled, the board named as required first", (await status.innerText()) === A.status.blocked && await install.isDisabled() && (await lines()).includes("blocked.boardFirst"), JSON.stringify(await lines()));
  });
  for (const key of ["ram", "ram2", "storage", "motherboard"]) await oneClick(new RegExp(`^${escape(T.parts[key])}`), `practice ${key}`);
  await unchanged("liquid cooler with the case's front fan in the radiator place", async () => {
    await select(aioTile);
    const why = await card.locator("[class*=actionWhy]").innerText();
    check("…blocked, the fan named as what must come out first", (await lines()).includes("install.fanInTheWay") && why.includes(T.parts.sfan1) && await install.isDisabled(), why);
  });
  await select(new RegExp(`^${escape(T.parts.sfan1)}`));
  if (!(await details.evaluate((el) => el.open))) await press(details.locator("summary"));
  // Its four screws out one by one, then lifted out (at most six presses).
  for (let i = 0; i < 6; i++) {
    const out = details.getByRole("button", { name: new RegExp(`^${escape(H.unscrewNext.split("{")[0].trim())}`) });
    if (await out.count()) await press(out.first());
    else { await press(details.getByRole("button", { name: H.liftOutOf.fan, exact: true })); break; }
  }
  check("the case's front fan is out by its own steps", (await snapshot()).history.at(-1) === "lift:sfan1", (await snapshot()).history.slice(-3).join());
  const beforeAio = await snapshot();
  await oneClick(aioTile, "practice liquid cooler (whole: block, VRM module, radiator, screws)");
  const aioSteps = (await snapshot()).history.slice(beforeAio.history.length);
  check("the liquid cooler's one action holds its block and its radiator", aioSteps.includes("place:aio") && aioSteps.includes("rad:aio"), aioSteps.join());
  await press(card.getByRole("button", { name: T.undo, exact: true }));
  check("one Undo takes the whole liquid cooler back, the fan stays out", JSON.stringify((await snapshot()).history) === JSON.stringify(beforeAio.history));
  await oneClick(aioTile, "practice liquid cooler again");
  const afterAio = await snapshot();
  await page.reload();
  await page.waitForSelector("canvas");
  await settle(4000);
  check("reload keeps the liquid cooler and its grouped action", JSON.stringify((await snapshot()).history) === JSON.stringify(afterAio.history) && JSON.stringify((await snapshot()).groups) === JSON.stringify(afterAio.groups));
} catch (e) {
  check("run completed without an exception", false, String(e));
  console.log("DIAGNOSTIC", JSON.stringify(await state().catch(() => null)));
  await shot("stopped");
} finally {
  check("no uncaught page errors", errors.length === 0, errors.join(" | "));
  console.log(`${passed} passed, ${failed} failed`);
  await browser.close();
}
