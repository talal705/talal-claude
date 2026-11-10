// Real-browser check of the PC lab's structured view. Needs the production server running.
// Usage: node scripts/browser-check-pc.mjs [baseUrl] — screenshots in docs/evidence/m3/, exit 1 on failure.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://localhost:3000";
const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = `${root}docs/evidence/m3`;
mkdirSync(outDir, { recursive: true });
const msg = (locale, module) => JSON.parse(readFileSync(`${root}apps/web/messages/${locale}/${module}.json`, "utf8"));

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${String(detail).slice(0, 500)})` : ""}`);
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
const partsOf = (record) => record?.data?.state?.parts ?? [];
// The case's factory-fitted fans are parts of their own, installed in the case from the start (decision 12).
const factoryFitted = (p) => /airguide|aspect-14/.test(p.catalogId);
const mounted = (record, catalogIdPart) => partsOf(record).filter((p) => p.catalogId.includes(catalogIdPart) && p.attachments.length > 0);

const browser = await chromium.launch();
for (const locale of ["en", "ar"]) {
  const t = msg(locale, "labs").pcLab;
  const tutor = msg(locale, "tutor").tutor;
  for (const width of [1280, 375]) {
    const tag = `${locale}@${width}`;
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: "ytl_locale", value: locale, url: base }]);
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    const saved = () => page.waitForSelector('.save-status[data-state="saved"]', { timeout: 8000 }).catch(() => {});

    // Create a build without RGB.
    await page.goto(`${base}/pc?mode=free`, { waitUntil: "networkidle" });
    // Since S3 a starter kit is the default; this flow needs the empty workbench, where the lighting choice is offered.
    await page.locator('input[name="build-start"][value=""]').check();
    await page.locator("label.settings-option", { hasText: t.starter.withoutRgb }).first().locator("input").check();
    await page.getByRole("button", { name: t.starter.create, exact: true }).click();
    await page.waitForURL(/project=/);
    const projectId = new URL(page.url()).searchParams.get("project");
    await page.waitForSelector(".pc-picker");
    await saved();
    const first = await stored(page, projectId);
    check(`${tag} build created as a PC project with the lighting choice recorded`, first?.lab === "pc" && first.data?.state?.rgbPreference !== undefined, JSON.stringify(first?.data?.state?.rgbPreference));

    // Catalog honesty: status in words, no fake picture.
    const add = async (category, text) => {
      await page.selectOption("#pc-category", category);
      const entry = page.locator(".pc-entry", { hasText: text }).first();
      await entry.locator("button.button-primary").click();
      await page.waitForTimeout(150);
    };
    await page.selectOption("#pc-category", "case");
    const entryText = await page.locator(".pc-entry").first().innerText();
    // Since S7 every offered part has a generated drawing; the entry must still state its verification status in words.
    check(`${tag} catalog entry states its verification status in words`, entryText.includes(t.picker.verification.partially_verified) || entryText.includes(t.picker.verification.verified), entryText.slice(0, 160));

    await add("case", "4000D");
    await add("motherboard", /Z790-PLUS WIFI(?!\s*D4)/);
    await add("ram", "LPX");
    await add("ram", "VENGEANCE RGB").catch(() => add("ram", "Vengeance RGB"));
    await saved();
    const afterAdd = await stored(page, projectId);
    check(`${tag} added parts are on the bench in the saved build`, partsOf(afterAdd).length >= 4 && partsOf(afterAdd).every((p) => factoryFitted(p) || p.attachments.length === 0), partsOf(afterAdd).map((p) => p.catalogId).join(","));

    // Match on the card's own name: a host card also mentions the parts it holds.
    const card = (text) => page.locator(".pc-card").filter({ has: page.locator(".pc-card-name", { hasText: text }) }).first();
    const openPlace = async (text) => {
      const button = card(text).locator("button.button-primary").first(); // the Place… button; its accessible name includes the part
      await button.focus();
      await page.keyboard.press("Enter");
      await page.waitForSelector('[role="listbox"]');
    };

    // Keyboard only: place the motherboard in the case.
    await openPlace(/Z790-PLUS WIFI(?!\s*D4)/);
    const focusedOption = await page.evaluate(() => document.activeElement?.getAttribute("role"));
    check(`${tag} destination list takes keyboard focus`, focusedOption === "option" || focusedOption === "listbox", focusedOption);
    await page.keyboard.press("Enter");
    await page.waitForSelector('[role="listbox"]', { state: "detached" }).catch(() => {});
    await saved();
    const afterBoard = await stored(page, projectId);
    check(`${tag} Enter places the motherboard in the case`, mounted(afterBoard, "z790").length === 1, JSON.stringify(partsOf(afterBoard).find((p) => p.catalogId.includes("z790"))?.attachments));

    // A DDR4 module on a DDR5 board: every slot is listed, each rejected with the engine's reason; Enter places nothing.
    await openPlace("LPX");
    const options = await page.$$eval('[role="option"]', (els) => els.map((el) => ({ ok: el.getAttribute("data-ok"), reason: el.querySelector(".pc-option-reason")?.textContent ?? "" })));
    check(`${tag} DDR4 module: every memory slot is listed as not available with a reason`, options.length >= 4 && options.every((o) => o.ok === "false" && o.reason.length > 10) && /DDR/.test(options[0].reason), JSON.stringify(options.slice(0, 1)));
    await page.screenshot({ path: `${outDir}/${locale}-${width}-ddr4-rejected.png` });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    const assertive = await page.evaluate(() => [...document.querySelectorAll('[aria-live="assertive"], [role="alert"]')].map((e) => e.textContent).join(" "));
    const afterReject = await stored(page, projectId);
    check(`${tag} Enter on a rejected slot places nothing and the reason is announced`, mounted(afterReject, "lpx").length === 0 && /DDR/.test(assertive), assertive.slice(0, 160));
    await page.keyboard.press("Escape");
    await page.waitForSelector('[role="listbox"]', { state: "detached" }).catch(() => {});

    // The DDR5 module goes in; then push it in fully.
    await openPlace("VENGEANCE RGB").catch(() => openPlace("Vengeance RGB"));
    await page.keyboard.press("Enter");
    await page.waitForSelector('[role="listbox"]', { state: "detached" }).catch(() => {});
    await saved();
    const ddr5 = (record) => partsOf(record).filter((p) => /ddr5/.test(p.catalogId) && p.attachments.length > 0);
    const afterRam = await stored(page, projectId);
    check(`${tag} DDR5 module is placed in a memory slot`, ddr5(afterRam).length === 1, JSON.stringify(ddr5(afterRam)[0]?.attachments));
    const seatButton = card(/VENGEANCE RGB/i).getByRole("button", { name: t.build.seat, exact: false }).first();
    if (await seatButton.count()) {
      await seatButton.click();
      await saved();
    }
    const afterSeat = await stored(page, projectId);
    check(`${tag} pushing it in fully is recorded as seated`, ddr5(afterSeat)[0]?.attachments[0]?.seating === "seated", JSON.stringify(ddr5(afterSeat)[0]?.attachments));

    // Undo and redo run on the engine history.
    await page.getByRole("button", { name: t.bar.undo, exact: true }).click();
    await saved();
    await page.waitForTimeout(900);
    const afterUndo = await stored(page, projectId);
    await page.getByRole("button", { name: t.bar.redo, exact: true }).click();
    await page.waitForTimeout(1200);
    await saved();
    const afterRedo = await stored(page, projectId);
    check(`${tag} undo reverts the last step and redo restores it`, ddr5(afterUndo)[0]?.attachments[0]?.seating !== "seated" && ddr5(afterRedo)[0]?.attachments[0]?.seating === "seated", `${ddr5(afterUndo)[0]?.attachments[0]?.seating} -> ${ddr5(afterRedo)[0]?.attachments[0]?.seating}`);

    // Power without a power supply: the engine's result, not a decoration.
    await page.locator("label", { hasText: t.power.wall }).first().locator("input").check().catch(() => {});
    await page.locator("label", { hasText: t.power.psuSwitch }).first().locator("input").check().catch(() => {});
    await page.getByRole("button", { name: t.power.press, exact: true }).first().click();
    await page.waitForTimeout(600);
    const powerText = await page.evaluate(() => document.body.innerText);
    // Read the result line itself: other labels on the page can contain the same words.
    const outcomeLine = powerText.split("\n").find((line) => line.includes(t.power.outcomeLabel)) ?? "";
    check(`${tag} pressing power without a power supply reports "No power"`, outcomeLine.includes(t.power.outcome.no_power), outcomeLine);
    check(`${tag} open problems are listed from the engine`, powerText.includes(t.diagnostics.heading) && !powerText.includes(t.diagnostics.none));
    await page.screenshot({ path: `${outDir}/${locale}-${width}-workspace.png`, fullPage: true });

    // The tutor receives the engine's findings and can point at a registered part.
    await page.getByRole("button", { name: tutor.launcher.open, exact: true }).click();
    await page.waitForTimeout(300);
    const panelText = await page.evaluate(() => document.querySelector("aside")?.innerText ?? "");
    check(`${tag} tutor has topics from the build's diagnostics`, !panelText.includes(tutor.panel.noTopic), panelText.slice(0, 120));
    await page.getByRole("button", { name: tutor.ladder.ask1 }).click().catch(() => {});
    await page.getByRole("button", { name: tutor.ladder.ask2 }).click().catch(() => {});
    const show = page.getByRole("button", { name: tutor.point.show });
    if (await show.count()) {
      await show.click();
      await page.waitForTimeout(1500);
      const pointing = await page.evaluate(() => {
        const ring = document.querySelector('[data-testid="tutor-ring"]');
        const r = ring?.getBoundingClientRect();
        return { shown: !!ring && getComputedStyle(ring).opacity !== "0" && r.width > 0, text: document.querySelector("aside")?.innerText ?? "" };
      });
      check(`${tag} "Show me where" marks a part of the build`, pointing.shown && pointing.text.includes(tutor.point.pointing), pointing.text.slice(-160));
      await page.screenshot({ path: `${outDir}/${locale}-${width}-tutor-pointing.png` });
    } else check(`${tag} "Show me where" offered for a build diagnostic`, false, panelText.slice(0, 200));
    await page.getByRole("button", { name: tutor.launcher.close, exact: true }).click().catch(() => {});

    // Layout and recovery.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${tag} no horizontal page overflow`, overflow <= 0, `${overflow}px`);
    const ltrNames = await page.evaluate(() => {
      const name = document.querySelector(".pc-card-name bdi, .pc-card-name [dir='ltr'], .pc-card-name");
      return name ? getComputedStyle(name.querySelector("bdi, [dir='ltr']") ?? name).direction : "none";
    });
    check(`${tag} product names read left-to-right`, locale === "en" || ltrNames === "ltr", ltrNames);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".pc-card");
    const cards = await page.locator(".pc-card").count();
    check(`${tag} the build is back after reload`, cards >= 4, `${cards} cards`);

    // ---- Starter kits (S3): every part loose on the workbench; nothing works until it is built ----
    const outcome = async () => {
      await page.waitForTimeout(700);
      const text = await page.evaluate(() => document.body.innerText);
      return text.split("\n").find((line) => line.includes(t.power.outcomeLabel)) ?? "";
    };
    for (const kitId of ["i7-ddr5-rgb-aio", "i5-ddr4-air"]) {
      await page.goto(`${base}/pc?mode=free`, { waitUntil: "networkidle" });
      await page.locator(`input[name="build-start"][value="${kitId}"]`).check();
      await page.getByRole("button", { name: t.starter.create, exact: true }).click();
      await page.waitForURL((u) => u.searchParams.get("project") && u.searchParams.get("project") !== projectId, { timeout: 10000 });
      await page.waitForSelector(".pc-card");
      await saved();
      const kit = await stored(page, new URL(page.url()).searchParams.get("project"));
      const kitParts = partsOf(kit);
      const plugged = (kit?.data?.state?.cables ?? []).flatMap((c) => Object.values(c.ends ?? {})).filter((e) => e && (e.plugged || e.port)).length;
      check(`${tag} starter ${kitId}: every part is on the workbench, nothing installed or plugged but the case's two factory fans`, kitParts.length >= 9 && kitParts.every((p) => factoryFitted(p) || p.attachments.length === 0) && kitParts.filter(factoryFitted).length === 2 && plugged === 0, `${kitParts.length} parts, ${plugged} plugged ends`);
      await page.getByRole("button", { name: t.power.press, exact: true }).first().click();
      const off = await outcome();
      check(`${tag} starter ${kitId}: pressing power on the unbuilt kit does not report "Working"`, off.length > 0 && !off.includes(t.power.outcome.operational), off);
      const marks = await page.evaluate(() => ({ crosses: document.querySelectorAll('[data-status="failed"], .stage-failed, svg[data-icon="cross"]').length, rows: document.body.innerText.includes("✕") }));
      await page.screenshot({ path: `${outDir}/${locale}-${width}-${kitId}-unbuilt.png`, fullPage: true });
      void marks;
    }

    // ---- Export a build and import it again ----
    await page.getByRole("button", { name: t.power.off, exact: true }).first().click().catch(() => {});
    await saved();
    const exportedFrom = await stored(page, new URL(page.url()).searchParams.get("project"));
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: t.bar.export, exact: true }).click()]);
    const exportPath = `${outDir}/build-export-${locale}-${width}.json`;
    await download.saveAs(exportPath);
    await page.goto(`${base}/pc?mode=free`, { waitUntil: "networkidle" });
    await page.locator('input[type="file"]').first().setInputFiles(exportPath);
    await page.waitForURL((u) => u.searchParams.get("project") && u.searchParams.get("project") !== exportedFrom.id, { timeout: 10000 }).catch(() => {});
    const importedId = new URL(page.url()).searchParams.get("project");
    await page.waitForSelector(".pc-card").catch(() => {});
    await saved();
    const imported = importedId ? await stored(page, importedId) : null;
    const shape = (record) => JSON.stringify(partsOf(record).map((p) => [p.catalogId, p.attachments.map((a) => [a.target?.mountPointId, a.seating])]).sort());
    check(`${tag} an exported build imports as a new project with the same parts and placements`, !!imported && importedId !== exportedFrom.id && shape(imported) === shape(exportedFrom), `${partsOf(imported).length} parts`);

    check(`${tag} no console errors`, consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
    await context.close();
  }
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
