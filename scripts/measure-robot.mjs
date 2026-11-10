// Measures the robot's frame pacing with the dev-only probe (lib/interaction/frame-probe.ts).
// Needs the production server running. Usage: node scripts/measure-robot.mjs [baseUrl]
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";

const base = process.argv[2] ?? "http://localhost:3000";
const root = fileURLToPath(new URL("..", import.meta.url));
const tutor = JSON.parse(readFileSync(`${root}apps/web/messages/en/tutor.json`, "utf8")).tutor;
const core = JSON.parse(readFileSync(`${root}apps/web/messages/en/core.json`, "utf8"));
const browser = await chromium.launch();
console.log(JSON.stringify({ cpu: os.cpus()[0].model, cores: os.cpus().length, platform: `${os.platform()} ${os.release()} ${os.arch()}`, browser: `headless Chromium ${browser.version()}`, viewport: "1280x800" }));
for (const rate of [60, 30]) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
  const page = await context.newPage();
  await page.addInitScript(() => { window.__YTL_PROBE__ = true; });
  await page.goto(base + "/", { waitUntil: "networkidle" });
  if (rate === 30) {
    // The frame-rate preference has no settings control yet; write it through the same store the app reads.
    await page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open("ytl-guest");
      open.onsuccess = () => {
        const tx = open.result.transaction("preferences", "readwrite");
        const store = tx.objectStore("preferences");
        const keys = store.getAllKeys();
        keys.onsuccess = () => {
          const get = store.getAll();
          get.onsuccess = () => {
            const value = { version: 1, reducedMotion: "off", soundEnabled: false, avatar: "none", robotVisible: true, robotFrameRate: 60, skipWorkstation: false, ...(get.result[0] ?? {}), robotFrameRate: 30 };
            store.put(value, keys.result[0] ?? "current");
          };
        };
        tx.oncomplete = () => (open.result.close(), resolve());
        tx.onerror = () => reject(tx.error);
      };
    }));
    await page.reload({ waitUntil: "networkidle" });
  }
  await page.waitForFunction(() => !!window.__ytlRobotProbe, null, { timeout: 8000 });
  const measure = async (label, action, ms) => {
    await page.evaluate((l) => window.__ytlRobotProbe.start(l), label);
    if (action) await action();
    await page.waitForTimeout(ms);
    const r = await page.evaluate(() => window.__ytlRobotProbe.stop());
    console.log(JSON.stringify({ label: r.label, setting: r.frameRateSetting, paints: r.paints, ...r.intervals, slides: r.slides, unfinished: r.unfinishedSlides }));
  };
  await measure(`idle ${rate}`, null, 3000);
  await page.getByRole("button", { name: tutor.launcher.open, exact: true }).click();
  await page.getByRole("button", { name: tutor.ladder.ask1 }).click();
  await page.getByRole("button", { name: tutor.ladder.ask2 }).click();
  // Let the idle robot finish moving clear of the taller panel, so that move is not counted as a replaced slide.
  await page.waitForTimeout(1000);
  await measure(`slide+point, panel open ${rate}`, () => page.getByRole("button", { name: tutor.point.show }).click(), 2500);
  await measure(`slide home ${rate}`, () => page.getByRole("button", { name: tutor.point.stop }).click(), 2000);
  await context.close();
}
await browser.close();
