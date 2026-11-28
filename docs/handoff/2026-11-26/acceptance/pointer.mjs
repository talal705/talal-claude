// Where the guide robot's ring and dotted line show, on the real page: on the chosen socket while it can be seen
// (first and alternate socket, after zoom and resize), and not at all while something stands in front of it.
// Screenshots of the 3D view are saved for looking at; the state assertions alone do not prove the placement.
// Seeds: npx vitest run --config docs/handoff/2026-11-26/acceptance/seed.config.mjs   Usage: node pointer.mjs [en|ar] [width] [base]
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const locale = process.argv[2] ?? "en", width = Number(process.argv[3] ?? 1440), base = process.argv[4] ?? "http://127.0.0.1:3002";
const seed = JSON.parse(readFileSync(process.env.VTE_SEED ?? join(tmpdir(), "vte-seed.json"), "utf8"));
const T = JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../apps/web/messages/${locale}/labs.json`, import.meta.url)), "utf8")).simplePc;
const dir = process.env.VTE_SHOTS ?? join(tmpdir(), "vte-shots");
mkdirSync(dir, { recursive: true });
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n} ${c ? "" : x}`); if (c) pass++; else { fail++; process.exitCode = 1; } };
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 900 : 1000 } });
  await ctx.addCookies([{ name: "ytl_locale", value: locale, url: base }]);
  await ctx.addInitScript(([plan, snap]) => { if (!localStorage.getItem("__seeded")) { localStorage.setItem("__seeded", "1"); localStorage.setItem("ytl_pc_plan_v1", JSON.stringify({ build: plan, phase: "assemble" })); localStorage.setItem("ytl_pc_plan_progress_v1", JSON.stringify(snap)); } }, [seed.plan, seed.unwired]);
  const page = await ctx.newPage(); page.setDefaultTimeout(60000);
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "/pc"); await page.waitForSelector("canvas"); await page.waitForTimeout(5000);
  const lab = page.locator("section[aria-labelledby='simple-pc-title']");
  const canvas = page.locator("canvas").first();
  const robot = () => page.evaluate(() => window.__ytlRobot?.() ?? null);
  const guide = () => page.evaluate(() => window.__ytlSimplePc().guide?.targets?.[0] ?? null);
  const click = async (l) => { await l.evaluate((el) => el.scrollIntoView({ block: "center" })); await l.click(); await page.waitForTimeout(900); };
  const look = async (name) => { await canvas.evaluate((el) => el.scrollIntoView({ block: "center" })); await page.waitForTimeout(2500); const r = await robot(); await canvas.screenshot({ path: join(dir, `pointer-${name}-${locale}-${width}.png`) }); console.log("INFO", name, JSON.stringify({ target: r?.target, centre: r?.centre, radiusPx: r?.radiusPx, pointing: r?.pointing, occluded: r?.occluded, marks: r?.marks, size: r?.size, guide: await guide() })); return r; };
  const inView = (r) => r?.target && r.target[0] >= 0 && r.target[0] <= r.size[0] && r.target[1] >= 0 && r.target[1] <= r.size[1];
  const clear = (r) => !r.centre || Math.hypot(r.centre[0] - r.target[0], r.centre[1] - r.target[1]) > r.radiusPx;
  const drag = async (dx, dy) => { await canvas.evaluate((el) => el.scrollIntoView({ block: "center" })); await page.waitForTimeout(300); const b = await canvas.boundingBox(); const x = b.x + b.width * 0.5, y = b.y + b.height * 0.5; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 12 }); await page.mouse.up(); await page.waitForTimeout(700); };

  /** Turns the view until something stands in front of the robot's target (or gives up). */
  const hide = async (name) => {
    for (let i = 1; i <= 14; i += 1) {
      await drag(width < 600 ? 90 : 170, 0);
      await page.waitForTimeout(1500);
      const r = await robot();
      if (r?.shown && r.occluded) return look(name);
    }
    return null;
  };
  const seen = (r) => r.pointing && r.marks === true && inView(r) && clear(r);
  const unseen = (r) => r.pointing === false && r.marks === false;

  // Nothing in hand: ask "What next?", and the robot shows the next step with its ring and dotted line.
  await click(lab.getByRole("button", { name: T.companion.quick.next, exact: true }).first());
  const next = await look("next");
  ok("next step: ring and line show exactly when the socket can be seen, without covering it", next && next.marks === next.pointing && (!next.pointing || seen(next)), JSON.stringify(next));
  const nextHidden = await hide("next-hidden");
  ok("turned until something is in front of that socket: no ring, no line", nextHidden && unseen(nextHidden), JSON.stringify(nextHidden));
  await click(lab.getByRole("button", { name: T.center }).first());

  // A lead with several matching sockets: the chosen one, then an alternate one.
  await click(lab.locator("button[aria-pressed]").filter({ hasText: T.cablesTab }).first());
  await click(lab.getByRole("button", { name: new RegExp(T.cables.caseFan1.name) }).first());
  const panel = lab.locator("[class*=cableDetail]");
  // Only the headers that fit and are free move the robot; a taken or look-alike socket leaves it on the planned one.
  const states = [];
  for (let i = 0; i < 4; i += 1) {
    await click(panel.getByRole("radio").nth(i));
    states.push({ guide: await guide(), r: await look(`fan-socket${i + 1}`) });
  }
  ok("each header chosen moves the robot's target to that header", new Set(states.map((s) => s.guide.placeId)).size === states.length && new Set(states.map((s) => JSON.stringify(s.r.target))).size === states.length, states.map((s) => s.guide.placeId).join(","));
  ok("for every header: ring and line only when it can be seen, and the robot does not cover it", states.every(({ r }) => r.marks === r.pointing && (!r.pointing || (inView(r) && clear(r)))), JSON.stringify(states.map(({ r }) => [r.pointing, r.marks])));

  // A header seen directly: from the first view the case's own frame stands in front, so the learner turns the view
  // (the robot never does) until the board's CPU fan header can be seen.
  await click(lab.getByRole("button", { name: new RegExp(T.cables.cpuFan.name) }).first());
  await click(panel.getByRole("radio").first());
  let open1 = await robot();
  for (let i = 0; i < 20 && !open1?.pointing; i += 1) { await drag(i % 6 === 5 ? 0 : (width < 600 ? 60 : 110), i % 6 === 5 ? 60 : 0); await page.waitForTimeout(1200); open1 = await robot(); }
  open1 = await look("cpu-fan-seen");
  ok("a header in view is pointed at, with ring or line, and not covered by the robot", seen(open1), JSON.stringify(open1));
  await click(lab.getByRole("button", { name: T.zoomIn, exact: true }));
  const zoomed = await look("zoom");
  ok("after a zoom the same holds", zoomed.marks === zoomed.pointing && (!zoomed.pointing || (inView(zoomed) && clear(zoomed))), JSON.stringify(zoomed));
  await page.setViewportSize({ width: width < 600 ? 390 : 1100, height: 900 });
  const resized = await look("resize");
  ok("after a resize the same holds and the robot stays in the view", resized.marks === resized.pointing && resized.centre[0] >= 0 && resized.centre[0] <= resized.size[0] && resized.centre[1] >= 0 && resized.centre[1] <= resized.size[1], JSON.stringify(resized));
  await page.setViewportSize({ width, height: width < 600 ? 900 : 1000 });
  await page.waitForTimeout(1500);

  // A socket the graphics card stands in front of, with no turning at all.
  await click(lab.getByRole("button", { name: T.center }).first());
  await click(lab.getByRole("button", { name: new RegExp(locale === "ar" ? "SATA" : "SATA data 1") }).first());
  await click(panel.getByRole("radio").first());
  await click(panel.getByRole("button", { name: T.hands.turnPlug }));
  await click(panel.getByRole("button", { name: T.hands.plugIn }));
  await click(panel.getByRole("radio").first());
  const behind = await look("behind-card");
  ok("a socket behind the graphics card is not pointed at", behind.occluded && unseen(behind), JSON.stringify(behind));
  await ctx.close();
} catch (e) { ok("script completed without an exception", false, String(e).split("\n")[0]); }
await browser.close().catch(() => {});
ok("no page errors", errors.length === 0, errors.join(" | "));
console.log(`${pass} passed, ${fail} failed`);
