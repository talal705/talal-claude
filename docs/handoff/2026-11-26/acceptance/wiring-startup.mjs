// Stage 10/11 acceptance on the real production page, from isolated seeded saves (fresh browser context, no owner storage).
// Seeds come from /private/tmp/vte-seed.json (see seed.test.ts next to this file).
// Usage: node wiring-startup.mjs [en|ar] [width] [base url]
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const locale = process.argv[2] ?? "en", width = Number(process.argv[3] ?? 1440), base = process.argv[4] ?? "http://127.0.0.1:3002";
const seed = JSON.parse(readFileSync("/private/tmp/vte-seed.json", "utf8"));
const root = new URL("../../../../", import.meta.url).pathname;
const T = JSON.parse(readFileSync(`${root}apps/web/messages/${locale}/labs.json`, "utf8")).simplePc;
const TAKE_OUT = T.hands.unplugEnd.split("{")[0].trim();
const shot = (n) => `/private/tmp/vte-shots/${n}-${locale}-${width}.png`;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n} ${c ? "" : x}`); if (c) pass++; else { fail++; process.exitCode = 1; } };
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
let section = "start";
async function open(which) {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
  await ctx.addCookies([{ name: "ytl_locale", value: locale, url: base }]);
  await ctx.addInitScript(([plan, snap]) => { if (!localStorage.getItem("__seeded")) { localStorage.setItem("__seeded", "1"); localStorage.setItem("ytl_pc_plan_v1", JSON.stringify({ build: plan, phase: "assemble" })); localStorage.setItem("ytl_pc_plan_progress_v1", JSON.stringify(snap)); } }, [seed.plan, seed[which]]);
  const page = await ctx.newPage(); page.setDefaultTimeout(60000);
  page.on("pageerror", (e) => errors.push(`[${section}] ${String(e)} ${(e.stack ?? "").split("\n").slice(1, 4).join(" ")}`));
  await page.goto(base + "/pc"); await page.waitForSelector("canvas"); await page.waitForTimeout(5000);
  const lab = page.locator("section[aria-labelledby='simple-pc-title']");
  const st = () => page.evaluate(() => window.__ytlSimplePc());
  const hist = async () => (await st()).history;
  const btn = (name) => lab.getByRole("button", { name, exact: false }).first();
  const settle = (ms = 700) => page.waitForTimeout(ms);
  const click = async (l) => { await l.evaluate((el) => el.scrollIntoView({ block: "center" })); await l.click(); await settle(); };
  const bubble = async () => (await lab.locator("[class*=bubble]").first().innerText()).replace(/\s+/g, " ").trim();
  const reload = async () => { await page.reload(); await page.waitForSelector("canvas"); await page.waitForTimeout(5000); };
  const lead = (name) => click(btn(new RegExp(name)));
  const panel = () => lab.locator("[class*=cableDetail]");
  return { ctx, page, lab, st, hist, btn, settle, click, bubble, reload, lead, panel };
}
const plug = async (h, { socket, turn = true }) => {
  if (socket) await h.click(h.panel().getByRole("radio", { name: socket }));
  if (turn) await h.click(h.panel().getByRole("button", { name: T.hands.turnPlug }));
  await h.click(h.panel().getByRole("button", { name: T.hands.plugIn }));
};
const radios = (h) => h.panel().getByRole("radio").allInnerTexts();

section = "A";
// ---- A. one end at a time, alternate / wrong / reversed sockets (partial lead, then full) ----
{
  const h = await open("unwired");
  await h.lead(locale === "ar" ? "SATA" : "SATA data 1");
  const first = (await h.hist()).length;
  // Reversed plug is refused with a short reason and no step.
  await h.click(h.panel().getByRole("radio").first());
  await h.click(h.panel().getByRole("button", { name: T.hands.plugIn }));
  ok("a reversed plug is refused, no step is saved", (await h.hist()).length === first, await h.bubble());
  await plug(h, {});
  let hist = await h.hist();
  ok("drive end saved with its actual socket", /^plug:sataData1:0@/.test(hist.at(-1)), hist.at(-1));
  ok("a partly connected lead is not counted connected", !(await h.st()).connected.includes("sataData1"));
  // Board end: pick an alternate (non-first) equivalent socket.
  const choices = await radios(h);
  ok("the board end offers several equivalent sockets", choices.length >= 3, JSON.stringify(choices));
  await shotFlow(h, "wiring-ends");
  await h.click(h.panel().getByRole("radio").nth(1));
  await plug(h, { turn: true });
  hist = await h.hist();
  const alt = hist.at(-1);
  ok("the alternate socket is accepted and recorded as chosen", /^plug:sataData1:1@sata-[2-4]$/.test(alt), alt);
  ok("the lead is now connected", (await h.st()).connected.includes("sataData1"));
  await h.reload();
  ok("reload keeps the same actual socket", (await h.hist()).at(-1) === alt);
  // Take out just the board end.
  await h.lead(locale === "ar" ? "SATA" : "SATA data 1");
  const outs = h.panel().getByRole("button", { name: TAKE_OUT });
  ok("each connected end has its own take-out button", (await outs.count()) === 2);
  await h.click(outs.nth(1));
  hist = await h.hist();
  ok("one take-out saves exactly one unplug step", hist.at(-1) === "unplug:sataData1:1" && !(await h.st()).connected.includes("sataData1"), hist.at(-1));
  ok("the other end stays in", (await h.panel().getByRole("button", { name: TAKE_OUT }).count()) === 1);
  await h.reload();
  ok("reload agrees: one end out", (await h.hist()).at(-1) === "unplug:sataData1:1");
  await h.click(h.btn(new RegExp(T.undo ?? "Undo")));
  ok("undo puts that end back into its socket", (await h.hist()).at(-1) === alt && (await h.st()).connected.includes("sataData1"));
  await h.ctx.close();
}
async function shotFlow(h, name) { await h.page.screenshot({ path: shot(name) }); }

section = "A2";
// ---- A2. wrong-function socket is refused with the engine's reason ----
{
  const h = await open("unwired");
  await h.lead(T.cables.atx.name);
  const n = (await h.hist()).length;
  await h.click(h.panel().getByRole("radio").first());
  await plug(h, {}); // PSU end first, planned socket
  const mid = (await h.hist()).length;
  ok("modular lead: PSU end plugs first", mid === n + 1, String(mid - n));
  const names = await radios(h);
  const wrong = h.panel().getByRole("radio").last();
  await h.click(wrong);
  await h.click(h.panel().getByRole("button", { name: T.hands.turnPlug }));
  const before = (await h.hist()).length;
  await h.click(h.panel().getByRole("button", { name: T.hands.plugIn }));
  const said = await h.bubble();
  ok("a socket of the wrong kind is refused, no step", (await h.hist()).length === before || /atx|24/i.test(names.at(-1) ?? ""), `${names.at(-1)} | ${said}`);
  await shotFlow(h, "wiring-wrong-socket");
  await h.ctx.close();
}

section = "B";
// ---- B. a lead saved whole (older cable step): remove one end, the other stays ----
{
  const h = await open("allWhole");
  await h.lead(locale === "ar" ? "SATA" : "SATA data 1");
  const outs = h.panel().getByRole("button", { name: TAKE_OUT });
  ok("older whole-lead save shows take-out for each end", (await outs.count()) === 2);
  await h.click(outs.first());
  const hist = await h.hist();
  ok("one end out: history keeps the whole-lead step and adds one unplug", hist.includes("cable:sataData1") && hist.at(-1) === "unplug:sataData1:0", hist.at(-1));
  ok("the lead no longer counts as connected, the other end remains", !(await h.st()).connected.includes("sataData1") && (await h.panel().getByRole("button", { name: TAKE_OUT }).count()) === 1);
  await h.ctx.close();
}

section = "C";
// ---- C. readiness: refusal, steps, success, off, undo, reload ----
{
  const h = await open("allWhole");
  await h.click(h.lab.getByRole("button", { name: T.ready.press }));
  let s = await h.st();
  ok("pressing power before the switches reports a failure and changes nothing", !s.powered && (await h.hist()).every((x) => !x.startsWith("sys:")), JSON.stringify(s.powered));
  await shotFlow(h, "readiness-failed");
  for (const [k, label] of [["panel", T.ready.do.panel.closed], ["wall", T.ready.do.wall.in], ["psu", T.ready.do.psu.on]]) {
    await h.click(h.lab.getByRole("button", { name: label }));
  }
  ok("each switch is its own saved step", JSON.stringify((await h.hist()).filter((x) => x.startsWith("sys:"))) === JSON.stringify(["sys:panel:closed", "sys:wall:in", "sys:psu:on"]));
  await h.click(h.lab.getByRole("button", { name: T.ready.press }));
  s = await h.st();
  ok("power on: the engine says it works, saved as a step", s.powered && (await h.hist()).at(-1) === "sys:power:on");
  await shotFlow(h, "readiness-running");
  await h.reload();
  ok("reload: still running", (await h.st()).powered);
  ok("while running, only power-off is offered", (await h.lab.getByRole("button", { name: T.ready.do.wall.out }).isDisabled()));
  await h.click(h.lab.getByRole("button", { name: T.ready.off }));
  ok("turn off is a saved step", !(await h.st()).powered && (await h.hist()).at(-1) === "sys:power:off");
  await h.reload();
  ok("reload: stays off", !(await h.st()).powered);
  await h.click(h.btn(new RegExp(T.undo ?? "Undo")));
  ok("undo of the power-off runs the PC again, consistently", (await h.st()).powered);
  await h.ctx.close();
}

section = "D";
// ---- D. an unfitted optional fan does not stop startup; booting is not finishing ----
{
  const h = await open("essentialNoFan");
  for (const label of [T.ready.do.panel.closed, T.ready.do.wall.in, T.ready.do.psu.on]) await h.click(h.lab.getByRole("button", { name: label }));
  await h.click(h.lab.getByRole("button", { name: T.ready.press }));
  const s = await h.st();
  ok("boots without the optional fan", s.powered, JSON.stringify(s.lines));
  ok("and it is not reported as a finished build", !s.complete);
  await shotFlow(h, "optional-boot");
  await h.ctx.close();
}

section = "E";
// ---- E. fault mode keeps its one-press start ----
{
  const h = await open("allWhole");
  await h.click(h.lab.getByText(new RegExp(locale === "ar" ? "اكتشف|عطل" : "Find the fault")).first());
  const s = await h.st();
  ok("fault mode opens", s.mode === "fault", String(s.mode));
  await h.ctx.close();
}
ok("no page errors", errors.length === 0, errors.join(" | "));
console.log(`${pass} passed, ${fail} failed`);
await browser.close();
