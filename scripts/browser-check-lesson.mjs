// Real-browser check of a complete lesson in the PC lab, done the way a learner does it, plus Test Yourself rules.
// Needs the production server running. Usage: node scripts/browser-check-lesson.mjs [baseUrl]
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { listDriver } from "./lib/pc-list-steps.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = `${root}docs/evidence/lessons`;
mkdirSync(outDir, { recursive: true });
const msg = (locale, module) => JSON.parse(readFileSync(`${root}apps/web/messages/${locale}/${module}.json`, "utf8"));

const jiti = createJiti(root);
const { lessonExamples } = await jiti.import("./content/lessons/examples.ts");
const firstBuild = lessonExamples.find((e) => e.lessonId === "pc.beginner.first-build");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${String(detail).replace(/\s+/g, " ").slice(0, 420)})` : ""}`);
};

const browser = await chromium.launch();
for (const [locale, width] of [["en", 1280], ["ar", 1280], ["ar", 375]]) {
  const L = msg(locale, "labs").lessons;
  const pc = msg(locale, "labs").pcLab;
  const tutor = msg(locale, "tutor").tutor;
  const aside = () => page.evaluate(() => document.querySelector("aside")?.innerText ?? "");
  // Lesson hints live on the tutor's ladder: the panel's "Hints" button opens it.
  const openHints = async () => {
    if ((await page.getByRole("button", { name: tutor.ladder.ask1 }).count()) === 0) await page.getByRole("button", { name: new RegExp(`^${L.panel.hints}`) }).first().click();
    await page.waitForTimeout(400);
  };
  const tag = `${locale}@${width}`;
  const context = await browser.newContext({ viewport: { width, height: 950 } });
  await context.addCookies([{ name: "ytl_locale", value: locale, url: base }]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const panel = () => page.evaluate(() => document.querySelector(".lesson-goal")?.closest("section")?.innerText ?? "");
  const lessonTitle = locale === "ar" ? "ركّب كمبيوتر من طاولة الشغل" : "Build a computer from the workbench";
  const doStep = listDriver(page, pc);

  // Learn -> the lesson list -> start the workbench lesson.
  await page.goto(`${base}/pc`, { waitUntil: "networkidle" });
  await page.locator('main a[href*="mode=learn"]').first().click();
  await page.waitForTimeout(900);
  const list = await page.evaluate(() => document.body.innerText);
  check(`${tag} Learn opens the lesson list as the next step`, list.includes(L.listHeading.learn) && list.includes(lessonTitle));
  await page.getByRole("button", { name: new RegExp(`^${L.start}.*${lessonTitle.slice(0, 12)}`) }).first().click();
  await page.waitForURL(/lesson=/, { timeout: 15000 });
  await page.waitForSelector(".lesson-goal");
  await page.waitForSelector(".pc-card");

  // Optional prediction, then a first check of the untouched start state: not yet, with rubric lines.
  const skip = page.getByRole("button", { name: L.panel.predictSkip });
  if (await skip.count()) await skip.click();
  await page.getByRole("button", { name: L.panel.check, exact: true }).click();
  await page.waitForTimeout(700);
  let text = await panel();
  check(`${tag} checking the untouched start says "not yet" with what the lab checked`, text.includes(L.panel.notPassed) && text.includes(L.panel.rubric), text.slice(0, 200));
  await openHints();
  await page.getByRole("button", { name: tutor.ladder.ask1 }).first().click();
  await page.waitForTimeout(400);
  let hintText = await aside();
  check(`${tag} the lesson's hints come through the tutor, one level at a time`, hintText.includes(tutor.ladder.label1) && !hintText.includes(tutor.ladder.label3), hintText.slice(0, 200));
  await page.getByRole("button", { name: tutor.launcher.close, exact: true }).click().catch(() => {});

  // Every step: do the worked example's actions with the list controls, check, continue.
  const total = firstBuild.steps.length;
  const passedSteps = [];
  for (const [index, step] of firstBuild.steps.entries()) {
    const skipPrediction = page.getByRole("button", { name: L.panel.predictSkip });
    if (await skipPrediction.count()) await skipPrediction.first().click();
    const onStep = (await panel()).includes(L.panel.step.replace("{current}", String(index + 1)).replace("{total}", String(total)));
    let error = "";
    for (const action of step.solution.actions) {
      try {
        await doStep(action);
        await page.waitForTimeout(100);
      } catch (e) {
        error = `${JSON.stringify(action)}: ${String(e).split("\n")[0]}`;
        break;
      }
    }
    await page.getByRole("button", { name: L.panel.check, exact: true }).click();
    await page.waitForTimeout(800);
    text = await panel();
    const ok = onStep && !error && (text.includes(L.notice.check_passed) || text.includes(L.panel.explanation) || text.includes(L.notice.lesson_completed));
    passedSteps.push(ok);
    if (!ok) { check(`${tag} step ${index + 1} (${step.stepId}) passes after doing it in the lab`, false, error || text.slice(0, 200)); break; }
    if (index === 3) await page.screenshot({ path: `${outDir}/${locale}-${width}-memory-step-passed.png`, fullPage: false });
    for (let i = 0; i < 3; i++) {
      const skipFollow = page.getByRole("button", { name: L.panel.skipFollowUp, exact: true });
      if (await skipFollow.count()) { await skipFollow.first().click(); await page.waitForTimeout(300); }
      const cont = page.getByRole("button", { name: L.panel.continue, exact: true });
      if (await cont.count()) { await cont.first().click(); await page.waitForTimeout(400); } else break;
    }
  }
  text = await page.evaluate(() => document.body.innerText);
  check(`${tag} all ${total} steps pass after doing each in the lab, and the lesson ends with a summary and one next step`, passedSteps.length === total && passedSteps.every(Boolean) && text.includes(L.summary.heading) && text.includes(L.summary.next), `${passedSteps.filter(Boolean).length}/${total}`);
  // Hints used are recorded in the stored progress (brief: record them without shaming); the summary carries no score.
  const progressHints = await page.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open("ytl-guest");
    open.onsuccess = () => {
      const names = [...open.result.objectStoreNames];
      const storeName = names.find((n) => /lesson/i.test(n));
      if (!storeName) return resolve({ error: names });
      const req = open.result.transaction(storeName).objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result.map((r) => JSON.stringify(r).match(/"hintLevel":\d/g)));
    };
  }));
  const summaryPart = text.slice(text.indexOf(L.summary.heading), text.indexOf(L.summary.heading) + 600);
  check(`${tag} hints used are recorded in the saved progress and the summary has no score`, (progressHints.flat?.() ?? []).includes('"hintLevel":1') && !/score|grade|درجة|علامة/i.test(summaryPart), JSON.stringify(progressHints).slice(0, 200));
  await page.screenshot({ path: `${outDir}/${locale}-${width}-summary.png`, fullPage: false });

  // Progress is stored: the list shows the lesson as completed after a reload.
  await page.goto(`${base}/pc?mode=learn`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const after = await page.locator("li", { hasText: lessonTitle }).first().innerText();
  check(`${tag} the lesson list shows it as completed after reload`, after.includes(L.status.completed), after.slice(0, 160));

  // Test Yourself: the challenge withholds the last hint until an attempt is submitted.
  await page.goto(`${base}/pc?mode=test`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const challengeTitle = locale === "ar" ? "اختبر نفسك: من قطع على الطاولة" : "Test yourself: from parts on the workbench";
  await page.getByRole("button", { name: new RegExp(`^${L.start}.*${challengeTitle.slice(0, 14)}`) }).first().click();
  await page.waitForURL(/lesson=/, { timeout: 15000 });
  await page.waitForSelector(".lesson-goal");
  await openHints();
  for (const ask of [tutor.ladder.ask1, tutor.ladder.ask2, tutor.ladder.ask3]) await page.getByRole("button", { name: ask }).first().click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(400);
  hintText = await aside();
  const exampleOffered = (await page.getByRole("button", { name: L.panel.showExample }).count()) > 0;
  check(`${tag} Test Yourself: the last hint and the example are not available before an attempt`, !hintText.includes(tutor.ladder.label3) && !exampleOffered && hintText.includes(tutor.ladder.locked), hintText.slice(0, 260));
  await page.getByRole("button", { name: tutor.launcher.close, exact: true }).click().catch(() => {});
  await page.getByRole("button", { name: L.panel.check, exact: true }).click();
  await page.waitForTimeout(600);
  await openHints();
  await page.getByRole("button", { name: tutor.ladder.ask3 }).first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
  hintText = await aside();
  check(`${tag} Test Yourself: after a submitted attempt the last hint opens`, hintText.includes(tutor.ladder.label3), hintText.slice(0, 260));

  // The fault exercise starts from a computer brought in for repair: a compatible mix of both kits, not a starter.
  await page.goto(`${base}/pc?mode=learn`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const faultTitle = locale === "ar" ? "دوّر على العطل" : "Find the fault";
  await page.getByRole("button", { name: new RegExp(`^${L.start}.*${faultTitle}`) }).first().click();
  await page.waitForURL(/lesson=/, { timeout: 15000 });
  await page.waitForSelector(".pc-card");
  const names = await page.locator(".pc-card-name").allInnerTexts();
  const has = (re) => names.some((n) => re.test(n));
  check(`${tag} the fault exercise opens on the repair build (Core i5 on the DDR5 board with DDR5 memory and the air cooler)`, has(/14600K/) && has(/Z790-PLUS WIFI(?!\s*D4)/) && !has(/Z790-PLUS WIFI\s*D4/) && has(/DDR5/) && has(/Freezer 36/i), names.slice(0, 12).join(" | "));

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${tag} no horizontal overflow`, overflow <= 0, `${overflow}px`);
  check(`${tag} no console errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
  await context.close();
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
