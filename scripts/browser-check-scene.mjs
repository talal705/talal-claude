// Real-browser check of the 3D PC scene's interactions. Needs the production server running.
// Uses the scene's read-only probe window.__ytlScene (partRect, mountRect, frames, camera).
// Usage: node scripts/browser-check-scene.mjs [baseUrl] — screenshots in docs/evidence/m3-3d/, exit 1 on failure.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://localhost:3000";
const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = `${root}docs/evidence/m3-3d`;
mkdirSync(outDir, { recursive: true });
const msg = (locale, module) => JSON.parse(readFileSync(`${root}apps/web/messages/${locale}/${module}.json`, "utf8"));

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${String(detail).replace(/\s+/g, " ").slice(0, 440)})` : ""}`);
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
const parts = (record) => record?.data?.state?.parts ?? [];
const find = (record, needle) => parts(record).find((p) => p.catalogId.includes(needle));
const gl = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

const browser = await chromium.launch({ args: gl });
for (const [locale, width] of [["en", 1280], ["ar", 1280], ["ar", 375]]) {
  const t = msg(locale, "labs").pcLab;
  const tutor = msg(locale, "tutor").tutor;
  const tag = `${locale}@${width}`;
  const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: "no-preference" });
  await context.addCookies([{ name: "ytl_locale", value: locale, url: base }]);
  const page = await context.newPage();
  const consoleErrors = [];
  const sceneRequests = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  page.on("request", (r) => /\/assets\/pc\//.test(r.url()) && sceneRequests.push(r.url()));
  const saved = () => page.waitForSelector('.save-status[data-state="saved"]', { timeout: 8000 }).catch(() => {});
  const probe = (fn, ...args) => page.evaluate(([f, a]) => window.__ytlScene?.[f]?.(...a) ?? null, [fn, args]);
  const canvasInView = () => page.evaluate(() => { const r = document.querySelector("canvas")?.getBoundingClientRect(); return !!r && r.top < window.innerHeight && r.bottom > 0; });
  const backToCanvas = async () => { await page.locator("canvas").scrollIntoViewIfNeeded(); await page.waitForTimeout(500); };
  const scrollAway = [];
  // Before picking up a part on the bench, show everything ("Fit all"), as a learner would after placing something.
  const fitAll = async () => {
    await page.getByRole("button", { name: msg(locale, "labs").pcLab.scene.views.fit, exact: true }).first().click().catch(() => {});
    await page.waitForTimeout(600);
    // The view buttons sit under the canvas; pressing one scrolls the page to it. Back to the canvas, as a learner would.
    await backToCanvas();
  };
  const clickRect = async (rect) => {
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.waitForTimeout(500);
  };

  // An empty bench, then a case, a board and two memory kits from the list.
  await page.goto(`${base}/pc?mode=free`, { waitUntil: "networkidle" });
  const assetsBefore = sceneRequests.length;
  // Since S3 a starter kit is the default; this flow adds its own parts to an empty workbench.
  await page.locator('input[name="build-start"][value=""]').check();
  await page.getByRole("button", { name: t.starter.create, exact: true }).click();
  await page.waitForURL(/project=/);
  const projectId = new URL(page.url()).searchParams.get("project");
  await page.waitForSelector(".pc-picker");
  const add = async (category, text) => {
    await page.selectOption("#pc-category", category);
    await page.locator(".pc-entry", { hasText: text }).first().locator("button.button-primary").click();
    await page.waitForTimeout(200);
  };
  await add("case", "4000D");
  await add("motherboard", /Z790-PLUS WIFI(?!\s*D4)/);
  await add("ram", "LPX");
  await add("ram", "VENGEANCE RGB");
  await saved();

  const toggle = page.locator("label", { hasText: /3D|ثلاثي/ }).first().locator('input[type="checkbox"]');
  if ((await toggle.count()) && !(await toggle.isChecked())) await toggle.check();
  await page.waitForFunction(() => !!window.__ytlScene && !!document.querySelector("canvas"), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  check(`${tag} the 3D view mounts with a canvas and its probe`, (await page.locator("canvas").count()) === 1 && (await page.evaluate(() => !!window.__ytlScene)));
  check(`${tag} geometry is fetched from our own origin only when the scene is shown`, assetsBefore === 0 && sceneRequests.length > 0 && sceneRequests.every((u) => u.startsWith(base)), `${sceneRequests.length} requests`);
  await page.locator("canvas").scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);

  // On-demand rendering: with nothing moving, no frames are drawn.
  const f1 = await probe("frames");
  await page.waitForTimeout(2000);
  const f2 = await probe("frames");
  check(`${tag} the scene idles: no frames drawn while nothing changes`, typeof f1 === "number" && f2 === f1, `${f1} -> ${f2}`);

  let record = await stored(page, projectId);
  const board = find(record, "z790");
  const pcCase = find(record, "4000d");
  const ddr4 = find(record, "lpx");
  const ddr5 = parts(record).find((p) => /ddr5/.test(p.catalogId));

  // Click the board in 3D, then the case's tray: the same action as the list performs.
  const boardRect = await probe("partRect", board.instanceId);
  check(`${tag} the board has a rectangle inside the canvas`, !!boardRect && boardRect.x >= 0 && boardRect.width > 4, JSON.stringify(boardRect));
  if (boardRect && boardRect.x >= 0) await clickRect(boardRect);
  const listOpen = (await page.locator('[role="listbox"]').count()) === 1;
  scrollAway.push(!(await canvasInView()));
  await backToCanvas();
  check(`${tag} clicking a part in 3D opens the same destination list`, listOpen);
  const trayRect = await probe("markerRect", pcCase.instanceId, "motherboard-tray");
  if (trayRect && trayRect.x >= 0) await clickRect(trayRect);
  else if (listOpen) await page.keyboard.press("Enter");
  await saved();
  record = await stored(page, projectId);
  check(`${tag} clicking the highlighted tray in 3D mounts the board`, (find(record, "z790")?.attachments?.length ?? 0) === 1 && !!trayRect && trayRect.x >= 0, JSON.stringify({ trayRect, attachments: find(record, "z790")?.attachments }));
  await page.waitForTimeout(800);
  await page.locator("canvas").screenshot({ path: `${outDir}/${locale}-${width}-board-mounted.png` });

  // DDR4 module on a DDR5 slot, clicked in 3D: refused with the engine's reason, nothing placed.
  await fitAll();
  const ddr4Rect = await probe("partRect", ddr4.instanceId);
  if (ddr4Rect && ddr4Rect.x >= 0) await clickRect(ddr4Rect);
  const candidatesShown = (await page.locator('[role="listbox"] [role="option"]').count()) >= 4;
  scrollAway.push(!(await canvasInView()));
  await backToCanvas();
  const slotRect = await probe("markerRect", board.instanceId, "dimm-a2");
  await page.locator("canvas").screenshot({ path: `${outDir}/${locale}-${width}-ddr4-candidates.png` });
  if (slotRect && slotRect.x >= 0) await clickRect(slotRect);
  await page.waitForTimeout(500);
  const announced = await page.evaluate(() => [...document.querySelectorAll('[aria-live="assertive"], [role="alert"]')].map((e) => e.textContent).join(" "));
  record = await stored(page, projectId);
  check(`${tag} a DDR4 module clicked onto a DDR5 slot in 3D is refused with the engine's reason`, candidatesShown && !!slotRect && slotRect.x >= 0 && (find(record, "lpx")?.attachments?.length ?? 0) === 0 && /DDR4/.test(announced) && /DDR5/.test(announced), JSON.stringify({ slotRect, announced: announced.slice(0, 120) }));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // The DDR5 module goes in by clicking in 3D; the list shows the same state.
  await fitAll();
  const ddr5Rect = await probe("partRect", ddr5.instanceId);
  if (ddr5Rect && ddr5Rect.x >= 0) await clickRect(ddr5Rect);
  await backToCanvas();
  const slot2 = await probe("markerRect", board.instanceId, "dimm-a2");
  if (slot2 && slot2.x >= 0) await clickRect(slot2);
  await saved();
  record = await stored(page, projectId);
  const placed = parts(record).find((p) => /ddr5/.test(p.catalogId) && p.attachments.length > 0);
  const listSays = await page.evaluate(() => document.body.innerText.includes("DIMM_A2"));
  check(`${tag} a DDR5 module clicked onto its slot in 3D is placed, and the list agrees`, placed?.attachments?.[0]?.target?.mountPointId === "dimm-a2" && listSays, JSON.stringify({ ddr5Rect, slot2, attachments: placed?.attachments, listSays }));

  // A loose cable end of the case's own leads, clicked in 3D, opens the port list like "Connect…".
  record = await stored(page, projectId);
  const cables = record?.data?.state?.cables ?? [];
  const loose = cables.flatMap((c) => Object.entries(c.ends ?? {}).filter(([, e]) => !e?.plugged && !e?.port).map(([endId]) => ({ cableId: c.id ?? c.instanceId, endId }))).slice(0, 1)[0];
  await fitAll();
  let endRect = loose ? await probe("cableEndRect", loose.cableId, loose.endId) : null;
  if (endRect && endRect.x >= 0) await clickRect(endRect);
  const portList = (await page.locator('[role="listbox"] [role="option"]').count()) > 0;
  check(`${tag} clicking a loose cable end in 3D offers the ports, like "Connect…"`, !!loose && portList, JSON.stringify({ loose, endRect }));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // Camera: a view button and the keyboard both move it; then it idles again.
  const cam0 = await probe("camera");
  check(`${tag} picking a part in the 3D view keeps the 3D view on screen`, !scrollAway.some(Boolean), JSON.stringify(scrollAway));
  await backToCanvas();
  await page.getByLabel(t.scene?.canvasLabel ?? "", { exact: true }).first().focus().catch(() => page.locator("canvas").focus());
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(500);
  const cam1 = await probe("camera");
  await page.keyboard.press("+");
  await page.waitForTimeout(400);
  const cam2 = await probe("camera");
  const moved = (a, b) => !!a && !!b && a.position.some((v, i) => Math.abs(v - b.position[i]) > 1);
  check(`${tag} arrow keys turn the camera and + zooms when the picture is focused`, moved(cam0, cam1) && moved(cam1, cam2), JSON.stringify({ cam0: cam0?.position?.map(Math.round), cam1: cam1?.position?.map(Math.round), cam2: cam2?.position?.map(Math.round) }));
  await page.waitForTimeout(1200);
  const f3 = await probe("frames");
  await page.waitForTimeout(1500);
  const f4 = await probe("frames");
  check(`${tag} after the camera stops, rendering idles again`, f4 === f3, `${f3} -> ${f4}`);

  // Tutor: a diagnostic (no power supply) can be pointed at inside the 3D view.
  await page.getByRole("button", { name: tutor.launcher.open, exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: tutor.ladder.ask1 }).click().catch(() => {});
  await page.getByRole("button", { name: tutor.ladder.ask2 }).click().catch(() => {});
  const show = page.getByRole("button", { name: tutor.point.show });
  let pointed = { shown: false };
  if (await show.count()) {
    await show.click();
    await page.waitForTimeout(2200);
    pointed = await page.evaluate(() => {
      const ring = document.querySelector('[data-testid="tutor-ring"]')?.getBoundingClientRect();
      const canvas = document.querySelector("canvas")?.getBoundingClientRect();
      const shown = !!ring && ring.width > 0 && getComputedStyle(document.querySelector('[data-testid="tutor-ring"]')).opacity !== "0";
      const inCanvas = !!ring && !!canvas && ring.x + ring.width / 2 >= canvas.x && ring.x + ring.width / 2 <= canvas.right && ring.y + ring.height / 2 >= canvas.y && ring.y + ring.height / 2 <= canvas.bottom;
      return { shown, inCanvas, text: (document.querySelector("aside")?.innerText ?? "").slice(0, 200) };
    });
    await page.screenshot({ path: `${outDir}/${locale}-${width}-tutor-in-scene.png` });
  }
  check(`${tag} the tutor marks its target while the 3D view is shown`, pointed.shown, JSON.stringify(pointed));
  console.log(`INFO  ${tag} tutor marker ${pointed.inCanvas ? "is inside the 3D picture" : "is on the list, not inside the 3D picture"}`);
  await page.getByRole("button", { name: tutor.launcher.close, exact: true }).click().catch(() => {});

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${tag} no horizontal page overflow with the scene shown`, overflow <= 0, `${overflow}px`);
  check(`${tag} no console errors`, consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  await context.close();
}
await browser.close();

// Without WebGL the workspace must still work through the list, with a plain message instead of the picture.
const noGl = await chromium.launch({ args: ["--disable-gpu", "--disable-3d-apis", "--disable-webgl", "--disable-webgl2"] });
{
  const t = msg("en", "labs").pcLab;
  const page = await noGl.newPage({ viewport: { width: 1280, height: 950 } });
  await page.goto(`${base}/pc?mode=free`, { waitUntil: "networkidle" });
  const hasGl = await page.evaluate(() => { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); });
  await page.locator('input[name="build-start"][value="i5-ddr4-air"]').check();
  await page.getByRole("button", { name: t.starter.create, exact: true }).click();
  await page.waitForSelector(".pc-card");
  const toggle = page.locator("label", { hasText: /3D/ }).first().locator('input[type="checkbox"]');
  if ((await toggle.count()) && !(await toggle.isChecked())) await toggle.check();
  await page.waitForTimeout(2500);
  const state = await page.evaluate(() => ({ canvas: document.querySelectorAll("canvas").length, cards: document.querySelectorAll(".pc-card").length, text: document.querySelector("#workspace-heading, main")?.innerText?.slice(0, 0) ?? "" }));
  const sectionText = await page.locator("section", { hasText: /3D view/ }).first().innerText().catch(() => "");
  await page.getByRole("button", { name: t.power.press, exact: true }).click();
  await page.waitForTimeout(700);
  // Since S3 the kit is unbuilt; the list must still work: it shows every part and evaluates the build.
  const works = (await page.evaluate(() => document.body.innerText)).includes(t.power.outcomeLabel);
  check(`no WebGL: this browser really has no WebGL`, hasGl === false);
  check(`no WebGL: a plain message replaces the picture and the list still lists the kit and evaluates it`, state.cards > 5 && works && sectionText.length > 20, sectionText.slice(0, 260));
  await page.screenshot({ path: `${outDir}/en-1280-no-webgl.png` });
}
await noGl.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
