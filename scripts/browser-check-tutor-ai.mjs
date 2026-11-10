// End-to-end check of the AI tutor's ask path, with the gated fake provider (no real provider is contacted).
// Start the production server with: AI_PROVIDER=fake YTL_DEV_PAGES=1 AI_TIMEOUT_MS=2000 npm run start
// Usage: node scripts/browser-check-tutor-ai.mjs [baseUrl] — screenshots in docs/evidence/tutor-ai/, exit 1 on failure.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://localhost:3000";
const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = `${root}docs/evidence/tutor-ai`;
mkdirSync(outDir, { recursive: true });
const msg = (locale, module) => JSON.parse(readFileSync(`${root}apps/web/messages/${locale}/${module}.json`, "utf8"));

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${String(detail).replace(/\s+/g, " ").slice(0, 420)})` : ""}`);
};

const status = await (await fetch(`${base}/api/tutor/status`)).json();
if (status.provider !== "fake") {
  console.log(`SKIPPED: the server is not running with the fake provider (status: ${JSON.stringify(status)}).`);
  process.exit(2);
}

const browser = await chromium.launch();
for (const locale of ["en", "ar"]) {
  const tutor = msg(locale, "tutor").tutor;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: "ytl_locale", value: locale, url: base }]);
  const page = await context.newPage();
  const sent = [];
  page.on("request", (r) => r.url().includes("/api/tutor/ask") && sent.push(r.postDataJSON()));
  const foreign = [];
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith(base) && !u.startsWith("data:") && !u.startsWith("blob:")) foreign.push(u);
  });
  const tag = (s) => `${locale} ${s}`;
  const panelText = () => page.evaluate(() => document.querySelector("aside")?.innerText ?? "");
  const ask = async (question, waitFor, timeout = 8000) => {
    await page.getByLabel(tutor.ask.label).fill(question);
    await page.getByRole("button", { name: tutor.ask.send, exact: true }).click();
    await page.waitForFunction((needle) => (document.querySelector("aside")?.innerText ?? "").includes(needle), waitFor, { timeout }).catch(() => {});
    return panelText();
  };

  // The homepage has rule-based hints; with a provider configured the ask field appears beside them.
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: tutor.launcher.open, exact: true }).click();
  await page.getByRole("button", { name: tutor.ladder.ask1 }).click();
  await page.getByRole("button", { name: tutor.ladder.ask2 }).click();
  await page.waitForTimeout(600);
  let text = await panelText();
  check(tag("with a provider configured the ask field is offered and the not-configured line is gone"), (await page.getByLabel(tutor.ask.label).count()) === 1 && !text.includes(tutor.aiUnavailable), text.slice(-200));

  const question = locale === "ar" ? "ليش البطاقة الأولى؟" : "Why the first card?";
  text = await ask(question, "FAKE TUTOR");
  const expected = `FAKE TUTOR lab=`;
  check(tag("a typed question is answered by the provider and shown as plain text with the caution"), text.includes(expected) && text.includes(`locale=${locale}`) && text.includes(`question_length=${question.length}`) && text.includes(tutor.ask.caution) && text.includes(tutor.ask.possible), text.slice(text.indexOf("FAKE"), text.indexOf("FAKE") + 160));
  const body = sent.at(-1) ?? {};
  check(tag("the request carries only the question, the hints on screen as text, the context and allowed targets"), body.question === question && Array.isArray(body.topics) && body.topics.length >= 1 && Array.isArray(body.allowedTargets) && !("files" in body && body.files?.length) && Object.keys(body).every((k) => ["version", "lab", "locale", "context", "question", "topics", "allowedTargets", "diagnostics", "files"].includes(k)), JSON.stringify(Object.keys(body)));
  await page.screenshot({ path: `${outDir}/${locale}-answer.png` });

  // The answer may point only at a target that was in the hints: "Show me what it means" marks it.
  const showTarget = page.getByRole("button", { name: tutor.ask.showTarget });
  if (await showTarget.count()) {
    await showTarget.click();
    await page.waitForTimeout(1500);
    const marked = await page.evaluate(() => {
      const ring = document.querySelector('[data-testid="tutor-ring"]');
      const card = document.querySelector(".lab-grid li a")?.getBoundingClientRect();
      const b = ring?.getBoundingClientRect();
      return !!ring && !!card && getComputedStyle(ring).opacity !== "0" && Math.abs(b.x + b.width / 2 - (card.x + card.width / 2)) < 10;
    });
    check(tag("the answer's target is one from the hints and is marked on the page"), marked);
  } else check(tag("the answer offers its target"), false, text.slice(-200));

  text = await ask("please fake-bad-target now", "FAKE TUTOR");
  await page.waitForTimeout(400);
  check(tag("a target the hints did not supply is dropped, and extra fields never reach the page"), text.includes("FAKE TUTOR") && (await page.getByRole("button", { name: tutor.ask.showTarget }).count()) === 0 && !/success|<html|shell:ui:fake-not-allowed/.test(text), text.slice(-220));

  text = await ask("fake-refusal", tutor.ask.error);
  check(tag("a provider refusal shows the error line and the built-in hints stay"), text.includes(tutor.ask.error) && text.includes(tutor.ladder.label2.split("·")[0].trim()), text.slice(-200));

  text = await ask("fake-out-of-contract", tutor.ask.error);
  check(tag("an out-of-contract provider answer is rejected, not shown"), text.includes(tutor.ask.error) && !text.includes("FAKE TUTOR lab"), text.slice(-160));

  text = await ask("fake-timeout", tutor.ask.error, 12000);
  check(tag("a provider that hangs is cut off by the timeout and reported as an error"), text.includes(tutor.ask.error), text.slice(-160));

  // Rate limit: 10 questions a minute per session.
  let busy = false;
  for (let i = 0; i < 9 && !busy; i++) {
    text = await ask(`again ${i}`, i < 4 ? "FAKE TUTOR" : tutor.ask.busy.slice(0, 20), 4000);
    busy = text.includes(tutor.ask.busy);
  }
  check(tag("too many questions in a minute gives the busy message, not an answer"), busy, text.slice(-200));
  await page.screenshot({ path: `${outDir}/${locale}-busy.png` });

  check(tag("no request left our origin"), foreign.length === 0, foreign.slice(0, 2).join(" "));
  await context.close();
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
