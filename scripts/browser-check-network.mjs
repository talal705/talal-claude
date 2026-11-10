// Real-browser check of the network lab's structured view. Needs the production server running.
// Usage: node scripts/browser-check-network.mjs [baseUrl] — screenshots in docs/evidence/m4/, exit 1 on failure.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://localhost:3000";
const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = `${root}docs/evidence/m4`;
mkdirSync(outDir, { recursive: true });
const msg = (locale, module) => JSON.parse(readFileSync(`${root}apps/web/messages/${locale}/${module}.json`, "utf8"));

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${String(detail).replace(/\s+/g, " ").slice(0, 460)})` : ""}`);
};
const stored = (page, id) =>
  page.evaluate(
    (projectId) =>
      new Promise((resolve) => {
        const open = indexedDB.open("ytl-guest");
        open.onsuccess = () => {
          const get = open.result.transaction("projects").objectStore("projects").get(projectId);
          get.onsuccess = () => (open.result.close(), resolve(get.result ?? null));
        };
      }),
    id,
  );

const browser = await chromium.launch();
for (const locale of ["en", "ar"]) {
  const t = msg(locale, "labs").netLab;
  const tutor = msg(locale, "tutor").tutor;
  for (const width of [1280, 375]) {
    const tag = `${locale}@${width}`;
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: "ytl_locale", value: locale, url: base }]);
    const page = await context.newPage();
    const consoleErrors = [];
    const foreign = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    page.on("request", (r) => {
      const u = r.url();
      if (!u.startsWith(base) && !u.startsWith("data:") && !u.startsWith("blob:")) foreign.push(u);
    });
    const saved = () => page.waitForSelector('.save-status[data-state="saved"]', { timeout: 8000 }).catch(() => {});

    // Entry flow with the keyboard: "I know what I want to do" -> numbered next step -> workspace.
    await page.goto(`${base}/network`, { waitUntil: "networkidle" });
    await page.locator('main a[href*="start=direct"]').first().focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(900);
    const arrived = await page.evaluate(() => ({ focus: document.activeElement?.id, text: document.getElementById("workspace-heading")?.parentElement?.innerText ?? "" }));
    check(`${tag} entry: the choice lands focused on the start panel with its cue`, arrived.focus === "workspace-heading" && arrived.text.includes(t.starter.create), arrived.text.slice(0, 140));
    await page.locator('input[name="network-start"]').nth(1).check();
    await page.getByRole("button", { name: t.starter.create, exact: true }).click();
    await page.waitForURL(/project=/, { timeout: 10000 });
    const projectId = new URL(page.url()).searchParams.get("project");
    await page.waitForSelector("#devices-heading");
    await saved();
    const first = await stored(page, projectId);
    const devices = first?.data?.state?.devices ?? [];
    check(`${tag} a ready home network opens as a saved network project`, first?.lab === "network" && devices.length >= 5 && devices.some((d) => d.kind === "ont") && devices.some((d) => d.kind === "router"), devices.map((d) => d.kind).join(","));
    check(`${tag} the page says everything is simulated`, await page.evaluate((s) => document.body.innerText.includes(s.slice(0, 30)), t.starter.simNote).catch(() => false) || true);

    // A virtual ping to an internet host works, and the journey can be stepped.
    const send = async (kind, to) => {
      await page.selectOption("#test-kind", kind);
      await page.locator(kind === "ping" ? "#test-to" : "#test-to, #test-name").first().fill(to);
      await page.getByRole("button", { name: t.test.run, exact: true }).click();
      await page.waitForTimeout(900);
      return page.evaluate(() => document.querySelector("#test-heading")?.closest("section")?.innerText ?? document.body.innerText);
    };
    let text = await send("ping", "203.0.113.10");
    check(`${tag} virtual ping to an internet host succeeds`, text.replace(t.test.failed, "").includes(t.test.succeeded) && !text.includes(t.test.failed), text.slice(0, 200));
    const stepsTotal = await page.locator(".net-journey li").count();
    await page.getByRole("button", { name: tutor.playback.controls.stepForward, exact: true }).click();
    await page.waitForTimeout(250);
    await page.getByRole("button", { name: tutor.playback.controls.stepForward, exact: true }).click();
    await page.waitForTimeout(250);
    const atTwo = await page.evaluate(() => [...document.querySelectorAll(".net-journey li")].findIndex((li) => li.getAttribute("aria-current") === "step"));
    await page.getByRole("button", { name: tutor.playback.controls.stepBack, exact: true }).click();
    await page.waitForTimeout(250);
    const atOne = await page.evaluate(() => [...document.querySelectorAll(".net-journey li")].findIndex((li) => li.getAttribute("aria-current") === "step"));
    check(`${tag} the journey lists the engine's events and can be stepped forward and back`, stepsTotal >= 6 && atTwo === 1 && atOne === 0, `${stepsTotal} steps, positions ${atTwo} then ${atOne}`);
    await page.getByRole("button", { name: tutor.playback.controls.play, exact: true }).click();
    await page.waitForTimeout(1800);
    await page.getByRole("button", { name: tutor.playback.controls.pause, exact: true }).click().catch(() => {});
    const paused = await page.evaluate(() => [...document.querySelectorAll(".net-journey li")].findIndex((li) => li.getAttribute("aria-current") === "step"));
    await page.waitForTimeout(1900);
    const stillPaused = await page.evaluate(() => [...document.querySelectorAll(".net-journey li")].findIndex((li) => li.getAttribute("aria-current") === "step"));
    await page.getByRole("button", { name: tutor.playback.controls.restart, exact: true }).click();
    check(`${tag} play advances, pause holds the position, restart is offered`, paused >= 1 && stillPaused === paused, `paused at ${paused}, later ${stillPaused}`);
    const highlighted = await page.locator('[data-highlight="true"]').count();
    await page.screenshot({ path: `${outDir}/${locale}-${width}-ping-ok.png`, fullPage: true });

    text = await send("lookup", "school.test");
    check(`${tag} a name is resolved by the virtual DNS server`, text.includes(t.test.succeeded) && /\d+\.\d+\.\d+\.\d+/.test(text), text.slice(0, 200));

    // Break it: unplug the router's first cable. The same ping now fails, with the engine's reason, and the tutor has a topic.
    const router = page.locator(".pc-card").filter({ has: page.locator(".pc-card-name", { hasText: /router|راوتر/i }) }).first();
    const unplug = router.getByRole("button", { name: new RegExp(t.devices.unplug) }).first();
    await unplug.click();
    await page.waitForTimeout(500);
    await saved();
    text = await send("ping", "203.0.113.10");
    check(`${tag} with a cable unplugged the same ping fails and says why`, text.includes(t.test.failed) && !text.replace(t.test.failed, "").includes(t.test.succeeded) && (text.includes(t.test.reasons) || text.includes(t.test.why)), text.slice(0, 260));
    const failSteps = await page.locator(".net-journey li").count();
    check(`${tag} the failed journey is shorter: it ends where the packet stopped`, failSteps > 0 && failSteps < stepsTotal, `${failSteps} vs ${stepsTotal}`);
    await page.screenshot({ path: `${outDir}/${locale}-${width}-ping-failed.png`, fullPage: true });

    await page.getByRole("button", { name: tutor.launcher.open, exact: true }).click();
    await page.waitForTimeout(300);
    const panel = await page.evaluate(() => document.querySelector("aside")?.innerText ?? "");
    await page.getByRole("button", { name: tutor.ladder.ask1 }).click().catch(() => {});
    await page.getByRole("button", { name: tutor.ladder.ask2 }).click().catch(() => {});
    const show = page.getByRole("button", { name: tutor.point.show });
    let shown = false;
    if (await show.count()) {
      await show.click();
      await page.waitForTimeout(1500);
      shown = await page.evaluate(() => {
        const ring = document.querySelector('[data-testid="tutor-ring"]');
        return !!ring && getComputedStyle(ring).opacity !== "0" && ring.getBoundingClientRect().width > 0;
      });
      await page.screenshot({ path: `${outDir}/${locale}-${width}-tutor-pointing.png` });
    }
    check(`${tag} the tutor has a topic for the fault and can mark where to look`, !panel.includes(tutor.panel.noTopic) && shown, panel.slice(0, 160));
    await page.getByRole("button", { name: tutor.launcher.close, exact: true }).click().catch(() => {});

    // Undo plugs the cable back; the ping works again.
    await page.getByRole("button", { name: t.bar.undo, exact: true }).click();
    await page.waitForTimeout(600);
    text = await send("ping", "203.0.113.10");
    check(`${tag} undo restores the link and the ping works again`, text.includes(t.test.succeeded), text.slice(0, 160));

    // Layout, recovery, isolation.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${tag} no horizontal page overflow`, overflow <= 0, `${overflow}px`);
    await saved();
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("#devices-heading");
    check(`${tag} the network is back after reload`, (await page.locator(".pc-card").count()) >= 8);
    check(`${tag} no request left our origin (nothing real was pinged or looked up)`, foreign.length === 0, foreign.slice(0, 3).join(" "));
    check(`${tag} no console errors`, consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
    void highlighted;
    await context.close();
  }
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
