// Real-browser check of the shell (Milestone 2). Needs the app running: `npm run build && npm run start`.
// Usage: node scripts/browser-check.mjs [baseUrl] — writes screenshots to docs/evidence/m2/ and exits 1 on any failure.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://localhost:3000";
const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = `${root}docs/evidence/m2`;
mkdirSync(outDir, { recursive: true });
const msg = (locale, module) => JSON.parse(readFileSync(`${root}apps/web/messages/${locale}/${module}.json`, "utf8"));

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const overlap = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const routes = ["/", "/pc", "/network", "/projects", "/pc?start=guided&mode=free"];

const browser = await chromium.launch();
for (const locale of ["en", "ar"]) {
  const core = msg(locale, "core");
  const tutor = msg(locale, "tutor").tutor;
  for (const width of [1280, 375]) {
    const tag = `${locale}@${width}`;
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    await context.addCookies([{ name: "ytl_locale", value: locale, url: base }]);
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => consoleErrors.push(String(e)));

    // Every route: status, lang/dir, no horizontal overflow.
    for (const route of routes) {
      const response = await page.goto(base + route, { waitUntil: "networkidle" });
      const info = await page.evaluate(() => ({
        lang: document.documentElement.lang,
        dir: document.documentElement.dir,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        h1: document.querySelector("h1")?.textContent ?? "",
      }));
      check(`${tag} ${route} loads`, response.status() === 200 && info.h1.length > 0, `h1="${info.h1}"`);
      check(`${tag} ${route} lang/dir`, info.lang === locale && info.dir === (locale === "ar" ? "rtl" : "ltr"));
      check(`${tag} ${route} no horizontal overflow`, info.overflow <= 0, `overflow=${info.overflow}px`);
      // Idle robot: inside the Help button on narrow screens, never over page content on wide ones.
      await page.waitForTimeout(1100);
      const idle = await page.evaluate(() => {
        const box = (el) => el.getBoundingClientRect();
        const robotEl = document.querySelector('[data-testid="tutor-robot"]');
        if (!robotEl) return { missing: true };
        const robot = box(robotEl);
        const home = document.querySelector("aside[data-robot-home]")?.dataset.robotHome;
        const launcher = [...document.querySelectorAll("aside button")].map(box).find((b) => robot.left >= b.left - 2 && robot.right <= b.right + 2 && robot.top >= b.top - 2 && robot.bottom <= b.bottom + 2);
        const covered = [...document.querySelectorAll("header a, header button, main a, main button, main input, main label, main p, main h1, main h2, main h3, main li")]
          .filter((el) => { const b = box(el); return b.width > 0 && robot.left < b.right && b.left < robot.right && robot.top < b.bottom && b.top < robot.bottom; })
          .map((el) => el.tagName + ":" + (el.textContent ?? "").trim().slice(0, 30));
        return { home, inLauncher: !!launcher, covered, robot: { x: robot.x, y: robot.y, w: robot.width, h: robot.height } };
      });
      if (width < 600) check(`${tag} ${route} idle robot rests inside the Help button`, idle.home === "in-launcher" && idle.inLauncher, JSON.stringify(idle));
      else check(`${tag} ${route} idle robot covers no page content`, !idle.missing && (idle.inLauncher || idle.covered.length === 0), JSON.stringify(idle));
      // At the end of the page nothing may be left under the fixed Help button.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(250);
      const under = await page.evaluate(() => {
        const launcher = [...document.querySelectorAll("aside button")].pop()?.getBoundingClientRect();
        if (!launcher) return ["no launcher"];
        return [...document.querySelectorAll("main a, main button, main input, main label, main p, main li")]
          .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && launcher.left < b.right && b.left < launcher.right && launcher.top < b.bottom && b.top < launcher.bottom; })
          .map((el) => el.tagName + ":" + (el.textContent ?? "").trim().slice(0, 30));
      });
      check(`${tag} ${route} nothing under the Help button at the end of the page`, under.length === 0, under.join(" | "));
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${outDir}/${locale}-${width}${route.replace(/[/?&=]/g, "_")}.png`, fullPage: true });
    }

    // Header links: none leads to a 404, current page is marked.
    await page.goto(base + "/", { waitUntil: "networkidle" });
    const hrefs = await page.$$eval("header a[href]", (as) => as.map((a) => a.getAttribute("href")));
    for (const href of [...new Set(hrefs)]) {
      const r = await page.request.get(base + href);
      check(`${tag} header link ${href} is not a 404`, r.status() === 200);
    }
    await page.goto(base + "/network", { waitUntil: "networkidle" });
    check(`${tag} current nav link marked`, (await page.$$eval('header a[aria-current="page"]', (a) => a.map((x) => x.getAttribute("href")))).join() === "/network");

    // Keyboard only: reach a mode choice with Tab, activate with Enter, focus stays, URL and state change.
    await page.goto(base + "/pc", { waitUntil: "networkidle" });
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() => (document.activeElement?.getAttribute("href") ?? "").includes("mode=free"));
    }
    check(`${tag} keyboard reaches the Free Lab choice`, reached);
    const focusVisible = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement);
      return s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2;
    });
    check(`${tag} focus indicator visible`, focusVisible);
    await page.keyboard.press("Enter");
    await page.waitForURL(/mode=free/);
    await page.waitForSelector('a[aria-current="true"][href*="mode=free"], a[aria-current="true"]');
    await page.waitForTimeout(700);
    const afterChoice = await page.evaluate(() => {
      const heading = document.getElementById("workspace-heading");
      const box = heading?.getBoundingClientRect();
      return {
        focusHref: document.activeElement?.getAttribute("href") ?? document.activeElement?.tagName,
        focusOnNextStep: document.activeElement === heading,
        nextStepInView: !!box && box.top >= 0 && box.top < window.innerHeight,
        current: [...document.querySelectorAll('main a[aria-current="true"]')].length,
        cue: heading?.parentElement?.innerText ?? "",
      };
    });
    const steps = msg(locale, "labs").labPage.steps;
    check(`${tag} choice reflected in URL and selected state`, afterChoice.current >= 1);
    check(`${tag} after the choice, focus and scroll are on the next step, which is numbered and says what to do`, afterChoice.focusOnNextStep && afterChoice.nextStepInView && Object.values(steps).some((label) => typeof label === "string" && afterChoice.cue.includes(label.replace(/\{[^}]+\}/g, "").trim().split(" ")[0])), afterChoice.cue.slice(0, 120));
    check(`${tag} focus stays on the page after choosing`, typeof afterChoice.focusHref === "string" && afterChoice.focusHref !== "BODY", `focus=${afterChoice.focusHref}`);

    // Language switch keeps the URL and client state (no full reload).
    await page.evaluate(() => (window.__noReloadMarker = 42));
    await page.click("button.locale-switch[lang]");
    const other = locale === "ar" ? "en" : "ar";
    await page.waitForFunction((l) => document.documentElement.lang === l, other);
    const kept = await page.evaluate(() => ({ marker: window.__noReloadMarker, url: location.search, dir: document.documentElement.dir }));
    check(`${tag} language switch keeps client state and URL`, kept.marker === 42 && kept.url.includes("mode=free"), JSON.stringify(kept));
    await page.click("button.locale-switch[lang]");
    await page.waitForFunction((l) => document.documentElement.lang === l, locale);

    // Settings dialog: opens, Escape closes, focus returns, preference persists across reload.
    const settingsButton = page.getByRole("button", { name: core.settings.title });
    await settingsButton.focus();
    await page.keyboard.press("Enter");
    await page.waitForSelector("dialog[open]");
    await page.locator('dialog[open] input[name="reduced-motion"]').nth(1).check();
    await page.waitForFunction(() => document.documentElement.dataset.reducedMotion === "on");
    const dialogOverflow = await page.evaluate(() => {
      const r = document.querySelector("dialog[open]").getBoundingClientRect();
      return r.left < 0 || r.right > window.innerWidth;
    });
    check(`${tag} settings dialog fits the viewport`, !dialogOverflow);
    await page.screenshot({ path: `${outDir}/${locale}-${width}-settings.png` });
    await page.keyboard.press("Escape");
    await page.waitForSelector("dialog[open]", { state: "detached" }).catch(() => {});
    const focusBack = await page.evaluate((name) => document.activeElement?.textContent?.includes(name) || document.activeElement?.getAttribute("aria-label") === name, core.settings.title);
    check(`${tag} Escape closes settings and focus returns`, (await page.$("dialog[open]")) === null && focusBack);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => document.documentElement.dataset.reducedMotion === "on", null, { timeout: 5000 }).catch(() => {});
    check(`${tag} reduced-motion preference survives reload`, (await page.evaluate(() => document.documentElement.dataset.reducedMotion)) === "on");

    // Tutor with reduced motion ON: pointing jumps, still lands beside the card.
    const pointAtCard = async (label) => {
      await page.goto(base + "/", { waitUntil: "networkidle" });
      await page.getByRole("button", { name: tutor.launcher.open, exact: true }).click();
      await page.getByRole("button", { name: tutor.ladder.ask1 }).click();
      const beforeTwo = await page.evaluate((t) => document.body.innerText.includes(t), tutor.hints.home.level3);
      await page.getByRole("button", { name: tutor.ladder.ask2 }).click();
      check(`${tag} ${label}: hint ladder gives one level at a time`, !beforeTwo && (await page.evaluate(([a, b]) => document.body.innerText.includes(a) && !document.body.innerText.includes(b), [tutor.hints.home.level2, tutor.hints.home.level3])));
      await page.getByRole("button", { name: tutor.point.show }).click();
      await page.waitForTimeout(1600);
    };
    const geometry = () =>
      page.evaluate(() => {
        const rect = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        };
        const card = document.querySelector(".lab-grid li a");
        const ring = document.querySelector('[data-testid="tutor-ring"]');
        const robot = document.querySelector('[data-testid="tutor-robot"]');
        return {
          card: rect(card),
          ring: rect(ring),
          robot: rect(robot),
          // Whole boxes for the other cards; actual text lines for the hero heading and paragraph.
          others: [
            ...[...document.querySelectorAll(".lab-grid li a")].filter((el) => el !== card).map(rect),
            ...[...document.querySelectorAll(".hero-sub, .hero-heading")].flatMap((el) => {
              const range = document.createRange();
              range.selectNodeContents(el);
              return [...range.getClientRects()].map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
            }),
          ],
          panel: rect(document.querySelector("aside [role], aside > div")),
          ringShown: ring ? getComputedStyle(ring).opacity !== "0" && getComputedStyle(ring).display !== "none" && getComputedStyle(ring).visibility !== "hidden" : false,
          rule: ring?.dataset.robotRule,
          vw: window.innerWidth,
          vh: window.innerHeight,
        };
      });
    const assertPointing = async (label) => {
      const g = await geometry();
      const ringOnCard = g.ring && g.card && g.ringShown && Math.abs(g.ring.x + g.ring.width / 2 - (g.card.x + g.card.width / 2)) < 8 && Math.abs(g.ring.y + g.ring.height / 2 - (g.card.y + g.card.height / 2)) < 8;
      check(`${tag} ${label}: marker is on the first lab card`, !!ringOnCard, JSON.stringify({ ring: g.ring, card: g.card, shown: g.ringShown }));
      if (g.robot && g.robot.width > 0) {
        check(`${tag} ${label}: robot does not cover the card`, !overlap(g.robot, g.card), JSON.stringify(g.robot));
        check(`${tag} ${label}: robot covers no other card or hero text`, !g.others.some((o) => overlap(g.robot, o)), JSON.stringify({ robot: g.robot, hit: g.others.filter((o) => overlap(g.robot, o)), rule: g.rule }));
        check(`${tag} ${label}: robot inside the viewport`, g.robot.x >= -1 && g.robot.y >= -1 && g.robot.x + g.robot.width <= g.vw + 1 && g.robot.y + g.robot.height <= g.vh + 1, JSON.stringify(g.robot));
      } else check(`${tag} ${label}: robot rendered`, false);
    };
    await pointAtCard("reduced motion");
    await assertPointing("reduced motion");

    // Full motion: point, then scroll, resize and switch language.
    await page.getByRole("button", { name: core.settings.title }).click();
    await page.locator('dialog[open] input[name="reduced-motion"]').nth(2).check();
    await page.waitForFunction(() => document.documentElement.dataset.reducedMotion === "off");
    await page.keyboard.press("Escape");
    await pointAtCard("full motion");
    await assertPointing("after pointing");
    await page.screenshot({ path: `${outDir}/${locale}-${width}-pointing.png` });
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(900);
    await assertPointing("after scroll");
    await page.setViewportSize({ width: width === 1280 ? 1100 : 414, height: 760 });
    await page.waitForTimeout(1200);
    await assertPointing("after resize");
    await page.click("button.locale-switch[lang]");
    await page.waitForFunction((l) => document.documentElement.lang === l, other);
    await page.waitForTimeout(1600);
    await assertPointing("after language switch");
    await page.screenshot({ path: `${outDir}/${locale}-${width}-pointing-switched.png` });
    await page.click("button.locale-switch[lang]");
    await page.waitForFunction((l) => document.documentElement.lang === l, locale);
    await page.setViewportSize({ width, height: 800 });

    // Hide the robot: help text stays, choice persists.
    await page.getByRole("button", { name: tutor.robot.hide }).click();
    await page.waitForTimeout(700);
    const hidden = await page.evaluate(([note, hint]) => {
      const robot = document.querySelector('[data-testid="tutor-robot"]');
      const gone = !robot || getComputedStyle(robot).opacity === "0" || getComputedStyle(robot).visibility === "hidden" || getComputedStyle(robot).display === "none";
      return { gone, text: document.body.innerText.includes(note) && document.body.innerText.includes(hint) };
    }, [tutor.robot.hiddenNote, tutor.hints.home.level2]);
    check(`${tag} robot can be hidden and the help text stays`, hidden.gone && hidden.text, JSON.stringify(hidden));
    check(`${tag} AI shown as not configured`, await page.evaluate((t) => document.body.innerText.includes(t), tutor.aiUnavailable));

    // /projects: empty state, then real records written through IndexedDB (one valid, one damaged).
    await page.goto(base + "/projects", { waitUntil: "networkidle" });
    await page.waitForFunction((t) => document.body.innerText.includes(t), core.projects.empty.heading, { timeout: 5000 }).catch(() => {});
    check(`${tag} /projects shows the empty state`, await page.evaluate((t) => document.body.innerText.includes(t), core.projects.empty.heading));
    await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open("ytl-guest");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction("projects", "readwrite");
            const now = new Date().toISOString();
            tx.objectStore("projects").put({ id: "11111111-1111-4111-8111-111111111111", ownerId: null, lab: "pc", mode: "free", title: "جهازي الأول — My first PC", data: { parts: [] }, dataVersion: 1, revision: 3, createdAt: now, updatedAt: now });
            tx.objectStore("projects").put({ id: "22222222-2222-4222-8222-222222222222", lab: "nowhere", revision: "x" });
            tx.oncomplete = () => (open.result.close(), resolve());
            tx.onerror = () => reject(tx.error);
          };
        }),
    );
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => document.body.innerText.includes("My first PC"), null, { timeout: 5000 }).catch(() => {});
    const listed = await page.evaluate(() => ({
      title: document.body.innerText.includes("جهازي الأول — My first PC"),
      corrupt: document.body.innerText.includes("22222222-2222-4222-8222-222222222222"),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }));
    check(`${tag} /projects lists a saved project after reload`, listed.title);
    check(`${tag} /projects reports the damaged record instead of hiding it`, listed.corrupt);
    check(`${tag} /projects list has no horizontal overflow`, listed.overflow <= 0);
    await page.screenshot({ path: `${outDir}/${locale}-${width}-projects-list.png`, fullPage: true });
    await page.getByRole("button", { name: core.projects.item.deleteNamed.replace("{title}", "جهازي الأول — My first PC"), exact: true }).click();
    await page.waitForSelector("dialog[open]");
    await page.locator("dialog[open]").getByRole("button", { name: core.projects.confirm.confirm, exact: true }).click();
    await page.waitForFunction(() => !document.body.innerText.includes("My first PC"), null, { timeout: 5000 }).catch(() => {});
    const stillStored = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const open = indexedDB.open("ytl-guest");
          open.onsuccess = () => {
            const req = open.result.transaction("projects").objectStore("projects").getAllKeys();
            req.onsuccess = () => (open.result.close(), resolve(req.result));
          };
        }),
    );
    check(`${tag} delete with confirmation removes only that project`, stillStored.length === 1 && stillStored[0].startsWith("2222"), JSON.stringify(stillStored));

    // Code Studio was removed from the active product on 2026-10-27 (decision 8): its route is gone.
    const codeRoute = await page.request.get(base + "/code");
    check(`${tag} /code is no longer a page`, codeRoute.status() === 404, String(codeRoute.status()));

    // Not-found page is localized.
    await page.goto(base + "/no-such-page", { waitUntil: "networkidle" });
    check(`${tag} not-found page localized`, await page.evaluate((t) => document.body.innerText.includes(t), core.states.notFound.heading));

    const realErrors = consoleErrors.filter((e) => !/no-such-page|404/.test(e));
    check(`${tag} no console errors`, realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
    await context.close();
  }
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
