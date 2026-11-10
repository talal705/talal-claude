// Real-browser check of the lessons in the network lab: list, start, first check of the
// untouched start, hints through the tutor, and the Test Yourself lock. Completion through the UI is
// checked for the PC lab in browser-check-lesson.mjs; here the worked examples are covered by unit tests.
// Needs the production server. Usage: node scripts/browser-check-lessons-labs.mjs [baseUrl]
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://localhost:3000";
const root = fileURLToPath(new URL("..", import.meta.url));
const msg = (locale, module) => JSON.parse(readFileSync(`${root}apps/web/messages/${locale}/${module}.json`, "utf8"));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${String(detail).replace(/\s+/g, " ").slice(0, 400)})` : ""}`);
};

const cases = [
  { lab: "network", learn: { en: "Connect an ONT, a router", ar: "وصّل ONT وراوتر" }, test: { en: "Test yourself: get a phone", ar: "اختبر نفسك: وصّل جوال" }, ready: "#devices-heading" },
];

const browser = await chromium.launch();
for (const locale of ["en", "ar"]) {
  const L = msg(locale, "labs").lessons;
  const tutor = msg(locale, "tutor").tutor;
  for (const c of cases) {
    const tag = `${locale} ${c.lab}`;
    const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
    await context.addCookies([{ name: "ytl_locale", value: locale, url: base }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const panel = () => page.evaluate(() => document.querySelector(".lesson-goal")?.closest("section")?.innerText ?? "");
    const aside = () => page.evaluate(() => document.querySelector("aside")?.innerText ?? "");
    const openHints = async () => {
      if ((await page.getByRole("button", { name: tutor.ladder.ask1 }).count()) === 0) await page.getByRole("button", { name: new RegExp(`^${L.panel.hints}`) }).first().click();
      await page.waitForTimeout(400);
    };
    const start = async (mode, title) => {
      await page.goto(`${base}/${c.lab}?mode=${mode}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(600);
      await page.getByRole("button", { name: new RegExp(`^${L.start}.*${title.slice(0, 14).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).first().click();
      await page.waitForURL(/lesson=/, { timeout: 15000 });
      await page.waitForSelector(".lesson-goal", { timeout: 15000 });
      await page.waitForSelector(c.ready, { timeout: 15000 });
    };

    await page.goto(`${base}/${c.lab}?mode=learn`, { waitUntil: "networkidle" });
    const list = await page.evaluate(() => document.body.innerText);
    check(`${tag}: Learn lists the lab's lessons`, list.includes(L.listHeading.learn) && list.includes(c.learn[locale].slice(0, 14)));

    // Optional starting check: "I don't know" everywhere suggests the lesson that teaches those skills, with no score.
    const B = L.baseline;
    await page.getByText(B.toggle, { exact: true }).first().click();
    await page.waitForTimeout(300);
    const groups = page.locator("fieldset", { has: page.getByLabel(B.dontKnow) });
    const n = await groups.count();
    for (let i = 0; i < n; i++) await groups.nth(i).getByLabel(B.dontKnow).check();
    await page.getByRole("button", { name: B.submit, exact: true }).click();
    await page.waitForTimeout(400);
    const suggestion = await page.evaluate(() => document.body.innerText);
    check(`${tag}: the optional starting check suggests where to begin, without a score`, n >= 3 && [B.start_here, B.no_answers].some((k) => suggestion.includes(k.split("{")[0].trim())) && !/score|درجة|\d+\s*\/\s*\d+/i.test(suggestion.slice(suggestion.indexOf(B.result), suggestion.indexOf(B.result) + 300)), `${n} questions`);

    await start("learn", c.learn[locale]);
    const skip = page.getByRole("button", { name: L.panel.predictSkip });
    if (await skip.count()) await skip.click();
    await page.getByRole("button", { name: L.panel.check, exact: true }).click();
    await page.waitForFunction((label) => (document.querySelector(".lesson-goal")?.closest("section")?.innerText ?? "").includes(label), L.panel.rubric, { timeout: 120000 }).catch(() => {});
    const first = await panel();
    check(`${tag}: checking the untouched start says "not yet" with the rubric`, first.includes(L.panel.notPassed) && first.includes(L.panel.rubric), first.slice(0, 200));
    await openHints();
    await page.getByRole("button", { name: tutor.ladder.ask1 }).first().click().catch(() => {});
    await page.waitForTimeout(400);
    const hint = await aside();
    check(`${tag}: the lesson's first hint comes through the tutor`, hint.includes(tutor.ladder.label1) && !hint.includes(tutor.ladder.label3), hint.slice(0, 160));
    await page.getByRole("button", { name: tutor.launcher.close, exact: true }).click().catch(() => {});

    await start("test", c.test[locale]);
    await openHints();
    for (const ask of [tutor.ladder.ask1, tutor.ladder.ask2, tutor.ladder.ask3]) await page.getByRole("button", { name: ask }).first().click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(400);
    const locked = await aside();
    check(`${tag}: Test Yourself keeps the last hint locked before an attempt`, !locked.includes(tutor.ladder.label3) && locked.includes(tutor.ladder.locked) && (await page.getByRole("button", { name: L.panel.showExample }).count()) === 0, locked.slice(0, 200));
    check(`${tag}: no uncaught page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
    await context.close();
  }
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
