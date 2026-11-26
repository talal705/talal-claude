// Planner: storage can be added, duplicated and removed one copy at a time, and the plan survives a reload.
// Usage: node planner-storage.mjs [en|ar] [width] [base url]     (CHROME=<path> optional; isolated fresh context)
import { chromium } from "@playwright/test";
const locale = process.argv[2] ?? "en", width = Number(process.argv[3] ?? 1440), base = process.argv[4] ?? "http://127.0.0.1:3002";
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${n} ${c ? "" : x}`); if (c) pass++; else { fail++; process.exitCode = 1; } };
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 900 : 1000 } });
  await ctx.addCookies([{ name: "ytl_locale", value: locale, url: base }]);
  const page = await ctx.newPage(); page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "/pc"); await page.waitForSelector("#planner-title");
  const storage = async () => { await page.waitForTimeout(500); return page.evaluate(() => JSON.parse(localStorage.getItem("ytl_pc_plan_v1") || "null")?.build?.parts?.storage ?? null); };
  await page.getByRole("radio", { name: locale === "ar" ? /ألعاب/ : /Gaming/ }).click();
  await page.getByRole("button", { name: locale === "ar" ? "ساعدني أختار" : "Help me choose" }).click(); await page.waitForTimeout(1500);
  ok("the suggested gaming build has one drive", (await storage())?.length === 1, JSON.stringify(await storage()));
  await page.getByRole("button", { name: /^(Storage|التخزين)/ }).first().click(); await page.waitForTimeout(1000);
  const tileButtons = async (model) => page.locator(`button[aria-label*="${model}"]`).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  const labels870 = await tileButtons("870 EVO");
  ok("the 870 EVO tile has a button to add it", labels870.length >= 1, JSON.stringify(labels870));
  const addBtn = page.locator('button[aria-label*="870 EVO"]').first();
  await addBtn.scrollIntoViewIfNeeded(); await addBtn.click();
  let s = await storage();
  ok("a second, different drive is added", s?.length === 2 && s.includes("samsung-870-evo-1tb"), JSON.stringify(s));
  // A duplicate copy of the same drive: the same add button on its tile adds another copy.
  await addBtn.click();
  s = await storage();
  ok("a duplicate copy of the same drive is added", s?.filter((x) => x === "samsung-870-evo-1tb").length === 2 && s.length === 3, JSON.stringify(s));
  const removeCopy = page.locator("button[aria-label*='870 EVO']:has-text('✕')");
  ok("each chosen copy has its own remove button", (await removeCopy.count()) === 2, String(await removeCopy.count()));
  await removeCopy.first().click();
  s = await storage();
  ok("removing one copy removes exactly that one drive", s?.length === 2 && s.filter((x) => x === "samsung-870-evo-1tb").length === 1 && s.includes("samsung-990-pro-1tb"), JSON.stringify(s));
  await page.reload(); await page.waitForSelector("#planner-title");
  ok("the plan survives a reload", JSON.stringify(await storage()) === JSON.stringify(s));
  await ctx.close();
} catch (e) { ok("script completed without an exception", false, String(e).split("\n")[0]); }
finally { await browser.close().catch(() => {}); }
ok("no page errors", errors.length === 0, errors.join(" | "));
console.log(`${pass} passed, ${fail} failed`);
