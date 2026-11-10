// End-to-end check (S8): both starter kits built from the workbench to a working computer, by a
// learner's own controls, in English and Arabic; a missing connection is reported with a red X and
// then fixed; no monitor is involved; the finished build survives a reload.
// Needs the production server running. Usage: node scripts/browser-check-build.mjs [baseUrl]
// Every step comes from the kit's own solution in content/catalog, so the check follows the catalog;
// each step is done through the list view's buttons and destination lists, never by calling the store.
import { chromium } from "@playwright/test";
import { createJiti } from "jiti";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { listDriver } from "./lib/pc-list-steps.mjs";

const base = process.argv[2] ?? "http://localhost:3000";
const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = `${root}docs/evidence/s8`;
mkdirSync(outDir, { recursive: true });
const msg = (locale, module) => JSON.parse(readFileSync(`${root}apps/web/messages/${locale}/${module}.json`, "utf8"));

const jiti = createJiti(root);
const { pcStarterKits, pcPresets, pcCatalog } = await jiti.import("./content/catalog/index.ts");
const { replay } = await jiti.import("./packages/simulation/src/pc/index.ts");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${String(detail).replace(/\s+/g, " ").slice(0, 400)})` : ""}`);
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

// What a finished build is: where every part sits and how far it is seated and fastened, and where
// every cable end is plugged. Instance and cable IDs are assigned in the same order in both.
const shape = (state) =>
  JSON.stringify({
    parts: (state?.parts ?? [])
      .map((p) => [p.instanceId, p.catalogId, p.attachments.map((a) => [a.role ?? "", a.target.hostInstanceId, a.target.mountPointId, a.seating, a.fastenersSecured]).sort()])
      .sort(),
    cables: (state?.cables ?? []).map((c) => [c.id, Object.entries(c.ends).map(([end, to]) => [end, to ? JSON.stringify(to) : null]).sort(), !!c.tidied]).sort(),
  });

const browser = await chromium.launch();
for (const [locale, width] of [["en", 1280], ["ar", 1280], ["ar", 375]]) {
  const t = msg(locale, "labs").pcLab;
  for (const kit of pcStarterKits) {
    const tag = `${locale}@${width} ${kit.id}`;
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: "ytl_locale", value: locale, url: base }]);
    const page = await context.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    const saved = () => page.waitForSelector('.save-status[data-state="saved"]', { timeout: 8000 }).catch(() => {});
    const outcome = async () => {
      await page.waitForTimeout(600);
      const text = await page.locator(".pc-power").innerText();
      return text.split("\n").find((line) => line.includes(t.power.outcomeLabel)) ?? "";
    };
    const doStep = listDriver(page, t);

    // Open the kit: every part on the workbench.
    await page.goto(`${base}/pc?mode=free`, { waitUntil: "networkidle" });
    await page.locator(`input[name="build-start"][value="${kit.id}"]`).check();
    await page.getByRole("button", { name: t.starter.create, exact: true }).click();
    await page.waitForURL(/project=/);
    const projectId = new URL(page.url()).searchParams.get("project");
    await page.waitForSelector(".pc-card");

    // Hold one power cable back to see the red X and the progressive hint, then plug it in.
    const heldBack = kit.solution.find((a) => a.type === "connect_cable_end" && a.to.kind === "part" && /^eps/.test(a.to.portId));
    const steps = kit.solution.filter((a) => a !== heldBack);
    let failedAt = null;
    for (const [index, action] of steps.entries()) {
      try {
        await doStep(action);
        await page.waitForTimeout(120);
      } catch (error) {
        failedAt = `step ${index + 1} ${JSON.stringify(action)}: ${String(error).split("\n")[0]}`;
        console.log(String(error).split("\n").filter((line) => /waiting|resolved|intercept|visible|enabled|stable|retrying/.test(line)).slice(-6).join("\n"));
        break;
      }
    }
    check(`${tag} every step but one cable done through the list controls (${steps.length} steps)`, failedAt === null, failedAt ?? "");
    await page.getByRole("button", { name: t.power.press, exact: true }).first().click();
    const missing = await outcome();
    const failedStage = await page.locator('.pc-stage-list li[data-status="failed"]').count();
    check(`${tag} with the CPU power cable missing the build does not report "Working" and one stage shows the red X`, missing.length > 0 && !missing.includes(t.power.outcome.operational) && failedStage === 1, `${missing} / failed rows ${failedStage}`);
    await page.screenshot({ path: `${outDir}/${locale}-${width}-${kit.id}-missing-cable.png`, fullPage: true });
    await page.getByRole("button", { name: t.power.off, exact: true }).first().click().catch(() => {});

    if (heldBack) await doStep(heldBack).catch((error) => check(`${tag} the held-back cable connects`, false, String(error)));
    await page.getByRole("button", { name: t.power.press, exact: true }).first().click();
    const working = await outcome();
    const passedStages = await page.locator('.pc-stage-list li[data-status="passed"]').count();
    check(`${tag} after the last cable the computer reports "Working" with every stage passed, and no monitor is involved`, working.includes(t.power.outcome.operational) && passedStages === 5, `${working} / passed rows ${passedStages}`);
    await page.screenshot({ path: `${outDir}/${locale}-${width}-${kit.id}-working.png`, fullPage: true });

    // The learner's build matches the kit's finished build in the engine.
    await saved();
    const record = await stored(page, projectId);
    const preset = pcPresets.find((p) => p.id === kit.id);
    const expected = replay(preset.actions, pcCatalog).state;
    check(`${tag} the saved build is the kit's finished build`, shape(record?.data?.state) === shape(expected), "");

    // Reload: the build and its result come back.
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".pc-card");
    const reloaded = await stored(page, projectId);
    // The pressed state is saved with the build: switch off, then start it again.
    const off = page.getByRole("button", { name: t.power.off, exact: true }).first();
    if (await off.isEnabled()) await off.click();
    await page.getByRole("button", { name: t.power.press, exact: true }).first().click();
    const again = await outcome();
    check(`${tag} after reload the build is unchanged and still starts`, shape(reloaded?.data?.state) === shape(expected) && again.includes(t.power.outcome.operational), again);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${tag} no horizontal overflow`, overflow <= 0, `${overflow}px`);
    check(`${tag} no console errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
    await context.close();
  }
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
