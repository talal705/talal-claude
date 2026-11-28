// A save from the earlier per-lead derivation (two SATA drives on one modular lead) must load, persist and undo one end on the real page.
// Seeds: npx vitest run --config docs/handoff/2026-11-26/acceptance/seed.config.mjs   Usage: node legacy-shared-sata.mjs [en|ar] [width] [base]
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const locale = process.argv[2] ?? "en", width = Number(process.argv[3] ?? 1440), base = process.argv[4] ?? "http://127.0.0.1:3002";
const seed = JSON.parse(readFileSync(process.env.VTE_SEED ?? join(tmpdir(), "vte-seed.json"), "utf8")).legacySharedSata;
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const T = JSON.parse(readFileSync(`${root}apps/web/messages/${locale}/labs.json`, "utf8")).simplePc;
const shotDir = process.env.VTE_SHOTS ?? join(tmpdir(), "vte-shots"); mkdirSync(shotDir, { recursive: true });
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n} ${c ? "" : x}`); if (c) pass++; else { fail++; process.exitCode = 1; } };
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 900 : 1000 } });
  await ctx.addCookies([{ name: "ytl_locale", value: locale, url: base }]);
  await ctx.addInitScript(([plan, snap]) => { if (!localStorage.getItem("__seeded")) { localStorage.setItem("__seeded", "1"); localStorage.setItem("ytl_pc_plan_v1", JSON.stringify({ build: plan, phase: "assemble" })); localStorage.setItem("ytl_pc_plan_progress_v1", JSON.stringify(snap)); } }, [seed.plan, seed.snapshot]);
  const page = await ctx.newPage(); page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => errors.push(String(e)));
  const load = async () => { await page.goto(base + "/pc"); await page.waitForSelector("canvas"); await page.waitForTimeout(5000); };
  const st = () => page.evaluate(() => window.__ytlSimplePc());
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("ytl_pc_plan_progress_v1") || "null"));
  const [k1, k2] = seed.keys;
  const lab = page.locator("section[aria-labelledby='simple-pc-title']");
  await load();
  let s = await st();
  ok("the older save loads (not reset to an empty build)", s.placed.length >= 9 && s.history.length === seed.snapshot.history.length, `${s.placed.length} parts, ${s.history.length} steps`);
  ok("both leads on the shared source count as connected", s.connected.includes(k1) && s.connected.includes(k2), JSON.stringify(s.connected));
  await lab.getByText(/^(Cables|الكابلات|الأسلاك)/).first().click().catch(() => {});
  await page.screenshot({ path: join(shotDir, `legacy-shared-sata-loaded-${locale}-${width}.png`) });
  await page.reload(); await page.waitForSelector("canvas"); await page.waitForTimeout(5000);
  s = await st();
  ok("reload keeps the migrated save (history unchanged, both leads connected)", s.history.length === seed.snapshot.history.length && s.connected.includes(k1) && s.connected.includes(k2), JSON.stringify(s.connected));
  const saved = await stored();
  ok("the stored save still has the same history", JSON.stringify(saved.history) === JSON.stringify(seed.snapshot.history));
  // One-end undo: the last step (the second drive's own plug) goes; the shared source and the first lead stay.
  await lab.getByRole("button", { name: new RegExp(T.undo) }).first().click(); await page.waitForTimeout(1200);
  s = await st();
  ok("undo takes back exactly one step", s.history.length === seed.snapshot.history.length - 1, String(s.history.length));
  ok("the second lead is loose and the first stays connected", !s.connected.includes(k2) && s.connected.includes(k1), JSON.stringify(s.connected));
  await page.reload(); await page.waitForSelector("canvas"); await page.waitForTimeout(5000);
  s = await st();
  ok("reload after undo agrees", s.history.length === seed.snapshot.history.length - 1 && !s.connected.includes(k2) && s.connected.includes(k1), JSON.stringify(s.connected));
  await page.screenshot({ path: join(shotDir, `legacy-shared-sata-undone-${locale}-${width}.png`) });
  await ctx.close();
} catch (e) { ok("script completed without an exception", false, String(e).split("\n")[0]); }
finally { await browser.close().catch(() => {}); }
ok("no page errors", errors.length === 0, errors.join(" | "));
console.log(`${pass} passed, ${fail} failed`);
