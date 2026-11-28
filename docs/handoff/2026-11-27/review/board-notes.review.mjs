// Independent Codex review copy: original Claude harness preserved. Only the M.2 slot-button locator and bounded timeout differ.
// The CPU socket and M.2 source notes on the real page, for every board the planner offers: each shows its own manual
// only where one was read, general guidance otherwise, and a screw-held M.2 slot never mentions a Q-Latch.
// Usage: node board-notes.mjs [en|ar] [width] [base]
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const locale = process.argv[2] ?? "en", width = Number(process.argv[3] ?? 1440), base = process.argv[4] ?? "http://127.0.0.1:3002";
const H = JSON.parse(readFileSync(fileURLToPath(new URL(`../../../../apps/web/messages/${locale}/labs.json`, import.meta.url)), "utf8")).simplePc.hands;
const fill = (key, values = {}) => Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, v), H[key]);
const plan = (motherboard, more = {}) => ({ version: 1, purpose: "gaming", workload: "1080p", parts: { case: "corsair-4000d-airflow-black", motherboard, cpu: "intel-core-i5-14600k", cooler: "arctic-freezer-36", psu: "corsair-rm850x-atx31", gpu: "asus-dual-rtx5060-o8g", ram: { id: "corsair-vengeance-rgb-ddr5-6000-32gb-kit", modules: 2 }, storage: ["samsung-990-pro-1tb"], fans: [], ...more } });
const BOARDS = [
  { name: "z790", plan: plan("asus-tuf-gaming-z790-plus-wifi"), cpu: "lgaSource", m2: ["m2SourceQLatch", "TUF GAMING Z790-PLUS WIFI", "E21279", "2-8"] },
  { name: "d4", plan: plan("asus-tuf-gaming-z790-plus-wifi-d4", { ram: { id: "corsair-vengeance-lpx-ddr4-3600-16gb-kit", modules: 2 } }), cpu: "lgaSourceGeneral", m2: ["m2SourceQLatch", "TUF GAMING Z790-PLUS WIFI D4", "E20581", "2-8"] },
  { name: "b760", plan: plan("asus-prime-b760m-a-wifi"), cpu: "lgaSourceGeneral", m2: ["m2SourceScrew", "PRIME B760M-A WIFI", "E21693", "1-14"] },
  { name: "h81", plan: plan("asus-h81m-k", { cpu: "intel-core-i5-4590", cooler: "arctic-freezer-7-x", psu: "corsair-cx550", gpu: null, ram: { id: "corsair-vengeance-lp-ddr3-1600-16gb-kit", modules: 2 }, storage: ["samsung-870-evo-1tb"] }), cpu: "lgaSourceGeneral", m2: null },
];
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n} ${c ? "" : x}`); if (c) pass++; else { fail++; process.exitCode = 1; } };
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
for (const board of BOARDS) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 900 : 1000 } });
  try {
    await ctx.addCookies([{ name: "ytl_locale", value: locale, url: base }]);
    await ctx.addInitScript((p) => { if (!localStorage.getItem("__seeded")) { localStorage.setItem("__seeded", "1"); localStorage.setItem("ytl_pc_plan_v1", JSON.stringify({ build: p, phase: "assemble" })); localStorage.setItem("ytl_pc_plan_progress_v1", JSON.stringify({ version: 4, plan: p, placed: [], connected: [], history: [], powered: false })); } }, board.plan);
    const page = await ctx.newPage(); page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(`${board.name}: ${e}`));
    await page.goto(base + "/pc"); await page.waitForSelector("canvas"); await page.waitForTimeout(5000);
    const lab = page.locator("section[aria-labelledby='simple-pc-title']");
    const click = async (l) => { await l.evaluate((el) => el.scrollIntoView({ block: "center" })); await l.click(); await page.waitForTimeout(900); };
    const choose = async (name) => {
      await click(lab.locator("[role=group] button:has(img)").filter({ hasText: name }).first());
      const options = lab.locator("details").first();
      if ((await options.count()) && !(await options.evaluate((el) => el.open))) await click(options.locator("summary"));
    };
    const shows = async (text) => (await lab.getByText(text, { exact: true }).count()) === 1;
    const notes = () => lab.locator("details [class*=cablesNote]").allInnerTexts();
    await choose(board.name === "h81" ? /4590/ : /14600K/);
    ok(`${board.name}: the CPU note is the one for this board`, await shows(H[board.cpu]), JSON.stringify(await notes()));
    await page.screenshot({ path: join(process.env.VTE_SHOTS ?? tmpdir(), `note-cpu-${board.name}-${locale}-${width}.png`), fullPage: true });
    if (board.m2) {
      await choose(/990 PRO/);
      ok(`${board.name}: before a slot is chosen no mechanism or manual is claimed`, await shows(H.m2SourcePick), JSON.stringify(await notes()));
      await click(lab.locator("[class*=toolbar] button").filter({ hasText: /M\.2_1/ }).first());
      const [key, name, manual, pageNo] = board.m2;
      ok(`${board.name}: M.2_1 shows this board's own note`, await shows(fill(key, { board: name, manual, page: pageNo })), JSON.stringify(await notes()));
      const text = await lab.innerText();
      if (key === "m2SourceScrew") ok(`${board.name}: nothing on the page mentions a Q-Latch for a screw-held slot`, !/Q-Latch/i.test(text), (text.match(/.{0,60}Q-Latch.{0,40}/i) ?? [""])[0]);
      await page.screenshot({ path: join(process.env.VTE_SHOTS ?? tmpdir(), `note-m2-${board.name}-${locale}-${width}.png`), fullPage: true });
    }
  } catch (e) { ok(`${board.name}: completed without an exception`, false, String(e).split("\n")[0]); }
  finally { await ctx.close().catch(() => {}); }
}
await browser.close().catch(() => {});
ok("no page errors", errors.length === 0, errors.join(" | "));
console.log(`${pass} passed, ${fail} failed`);
