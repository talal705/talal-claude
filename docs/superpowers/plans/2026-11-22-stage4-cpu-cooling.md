# Stage 4 — CPU Cooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install and remove every selectable CPU cooler by click, one documented mechanical step at a time, per that cooler's own manual (backplate, ILM and contact frame or retention ring, paste, film, alternating screws, AIO block / radiator / fans tracked separately), with wiring left to Stage 10.

**Architecture:** Catalog gains each cooler's verified mounting kind, kit and fastener plan. The engine gains a small `hardware` string-state map (installed parts) and one new action `set_hardware`, validated in a new `hardware.ts`, enforced only in detailed builds. The single-PC adapter adds `hw:` steps, a `nextCoolerStep` (toolbar, robot and resume read the same step), explicit migration, and a documented whole-fit helper kept only for old saves/tests (never wired to a button). The scene draws state from the engine.

**Tech Stack:** TypeScript, Next.js 16, React Three Fiber, next-intl, Vitest, Playwright (browser scripts).

**Spec:** the owner's Stage 4 brief of 2026-11-22 (pasted in conversation) and Stage 3 brief sections A–D, O–Q. Roadmap: `docs/superpowers/plans/2026-11-21-assembly-stages-roadmap.md`.

## Global Constraints

- Branch `feat/stage4-cooling` from `feat/stage3-m2-storage` at `f2f78af`. No merge to `main`, no production deploy, no force-push, no account/security changes. Stop after Stage 4.
- Click/tap only; one action = one mechanical step; no user-facing "install everything" shortcut for a cooler; never auto-orient; never move the camera; reuse the shared step gate (`createStepGate`/`takeStep`) for scene clicks, toolbar, panel buttons and keys.
- Storage keys unchanged; old saves migrate explicitly; never clear localStorage.
- Hardware facts only from the exact model's official documents; unverifiable details are stated as such, never asserted.
- English and Arabic for every new line; `npm run check:messages` passes; no raw keys shown.
- Skipped tests are never passes; local build is never reported as the Vercel preview; earlier browser results are not evidence for later code (Stage 3 review corrections were never browser-tested).
- New rules apply only when `mechanics === "detailed"` (basic builds keep today's behaviour).

## Verified hardware facts (read from ARCTIC's official manual pages and spec sheets, 2026-11-22)

| Cooler | Intel mounting | Kit (packaging image) | Thermal / film | Notes |
|---|---|---|---|---|
| Freezer 36 (`arctic-freezer-36`) — support.arctic.de/freezer-36 | Board's own socket backplate kept and supported (padding if board outside case, painter's tape if in case); open ILM, place CPU; **remove ILM** (T20, keep it, reinstall for service/warranty); CPU Contact Frame (LGA1700: CPU at the top edge of the cutout, gap below); "loosely engage all 4 screws by 2 turns before tightening them in a cross pattern"; tape/padding removed after | CPU Contact Frame ×1, T20 driver ×1, shoulder screws ×4; heatsink + 2 fans (P12 PWM PST) | syringe (0.8 g; manual labels it MX-6, spec sheet PDF says MX-7); **blue film on heatsink base**; paste drawn as an "X" | airflow: back exhaust / back intake; fan leads to CPU_FAN, or CPU_FAN + CPU_OPT. Heatsink bar fixing count is **not stated in text** (drawing shows 2 captive screws) |
| Liquid Freezer III 240 A-RGB / 280 — support.arctic.de/liquid-freezer-III-240-A-RGB, …-280 | same backplate + contact-frame procedure as above | + VRM fan module (A-RGB on 240), 2 PWM cables (all-in-one, individual), 8 washers, 8+8 screws, MX-6 syringe | **film on pump block**; pump block fixed with **2 screws: "gently until both engage, then fully tighten alternately"**; "only install the mounting modules in this orientation" | radiator **below the pump** risks bubbling noise (top / front above the pump line are fine); "connect the PWM control cable before mounting the cooler" (recommendation; wiring stays Stage 10); pump reported speed is 150 % of real; which of the two 8-screw bags goes where is not stated |
| Freezer 7 X — support.arctic.de/freezer7xr3, Spec_Sheet_Freezer_7X_EN.pdf | **Intel Retention Ring ×1 + Retention Pins ×4**, no backplate or frame; mounting-clip position must match socket: "LGA1851/1700" vs "LGA1200/LGA115x" | heatsink + 100 mm fan, ring, 4 pins | **pre-applied** (spec sheet names MX-2; catalog's older source says MX-4: the lab names none); film on plate (catalog, earlier source) | interference lists exist for 1151 v1/v2 only; LGA1150 H81M-K is not on them. Pin order not stated |

Not verified and not modelled: Freezer 36 RAM clearance (no ARCTIC figure); radiator screw/washer assignment; AMD kits (Freezer 36 / LF III: 4 screws, 4 spacers, mounting clips) — only the archived TUF B550-PLUS is AM4, so AMD is unreachable and keeps today's generic behaviour; manufacturer cleaning procedure after removal (none in the manuals read — the lab's "wipe off old compound, apply again" step is educational and says so).

## Review Focus

1. Old save with a cooler fitted over a **closed** ILM (any pre-Stage-4 save) — loads, CPU and cooler still in, history rewritten with the documented steps; nothing cleared.
2. Reload mid-frame: ILM removed, 2 of 4 frame screws engaged — restores exactly, robot names the next screw, nothing re-applied.
3. Undo after "tighten screw" or after lifting the cooler — only that step reverses; paste/film/contact state is exactly as before (undo never consumes paste).
4. Double click / held Enter on a screw or "remove ILM" — one step.
5. Changing the plan's cooler (air ↔ AIO) with the frame fitted — CPU, RAM, M.2 progress kept; the frame and ILM state survive; no impossible state.

---

### Task 1: Catalog and contracts — verified mounting data

**Files:**
- Modify: `packages/contracts/src/pc.ts` (`CoolingEntry` spec, `InstalledPart`, `PrepKind`, `PCAction`, `PCDiagnosticCode`)
- Modify: `content/catalog/cooling.ts`, `content/catalog/expansion.ts` (Freezer 7 X), `content/catalog/helpers.ts`
- Test: `packages/simulation/src/pc/catalog.test.ts`

**Interfaces — Produces:**
- `InstalledPart.hardware?: Record<string, string>`; `PrepKind` adds `"backplate"`; `PCAction` adds `{ type: "set_hardware"; instanceId: InstanceId; key: string; value: string }`; `PCDiagnosticCode` adds `"mounting_missing" | "hardware_order_wrong"`.
- `CoolerMountingSpec = { kind: "contact_frame" | "retention_ring" | "generic"; sockets: CpuSocket[]; backplate: "retained" | "none"; kit: { id: string; count: number; label: Localized }[]; frame?: { screws: number }; ring?: { pins: number; positions: { id: string; sockets: CpuSocket[]; label: Localized }[] }; bodyScrews: { count: number; order: "alternate" | "any"; verified: boolean }; source: string }`; `CoolingSpec.mounting?: CoolerMountingSpec[]` (first entry whose `sockets` includes the board's socket applies; none → generic legacy path).
- `CoolingSpec.connections?: { cableId: string; requirement: "required" | "optional" | "recommended"; note: Localized }[]` (metadata for Stage 10).

- [ ] **Step 1: Failing test** `each offered cooler states its mounting from its own manual`: Freezer 36 and both LF III on `lga1700` → `kind "contact_frame"`, `backplate "retained"`, `frame.screws 4`, kit ids `["contact-frame","shoulder-screw","t20-driver"]` (counts 1, 4, 1); Freezer 36 `bodyScrews {count 2, order "alternate", verified false}`; LF III `bodyScrews {count 2, order "alternate", verified true}` and kit includes `vrm-fan-module`; Freezer 7 X on `lga1150` → `kind "retention_ring"`, `ring.pins 4`, positions `["1700","1200"]` with `1200` listing `lga1150`; generic cooler and AMD sockets have no `mounting`. Film/paste: Freezer 36 and both LF III `paste.film === true`, `supplied "tube"`; Freezer 7 X `supplied "pre_applied"`, `film true`; no entry text names MX-6/MX-7/MX-4/MX-2. Sources include the support.arctic.de pages and spec-sheet URLs above. `unverifiedFields` of each lists the "Not verified" items that apply.
- [ ] **Step 2:** Run `npx vitest run packages/simulation/src/pc/catalog.test.ts` → FAIL.
- [ ] **Step 3:** Add the contract types; fill `mounting`, `connections`, paste/film and sources in the catalog; reword catalog notes so no compound name is asserted.
- [ ] **Step 4:** Same command → PASS; `npm run type-check` exit 0; `npx vitest run packages/simulation` all pass.
- [ ] **Step 5:** Commit `Stage 4: verified cooler mounting data from ARCTIC's manuals`.

### Task 2: Engine — backplate, ILM removal, contact frame, CPU retained by the frame

**Files:**
- Create: `packages/simulation/src/pc/hardware.ts`; Test: `packages/simulation/src/pc/hardware.test.ts`
- Modify: `packages/simulation/src/pc/reducer.ts` (dispatch `set_hardware`; `set_prep` accepts `backplate`; plate/lever blocked while ILM removed), `messages.ts`, `startup.ts` only if a test requires.

**Interfaces — Produces** (`hardware.ts`): `applyHardware(v: View, state: PCBuildState, action: Extract<PCAction, {type: "set_hardware"}>, ctx): PCActionResult | undefined`; keys on the **board**: `ilm` (`"removed"`; absent = fitted), `frame` (`"placed"`; absent = off), `frame_screws` (4 chars, each `0` out, `1` engaged 2 turns, `2` tight; set only while frame placed); `backplate` prep on the board (`"padding"` | `"tape"`). Rules: backplate `padding` only if the board is not in the case, `tape` only if it is (else `prep_wrong` with the reason); `ilm removed` needs backplate set, lever up and plate open, no frame; `ilm ""` (refit) needs no frame; `frame placed` needs ILM removed, CPU seated in the socket and a cooler of mounting kind `contact_frame` in the build (kit owner); `frame_screws` changes one character per action: `0→1` any order, `1→2` only when all four ≥ 1, first tight any, second its opposite (`i+2 mod 4`), third any remaining, fourth its opposite; loosening mirrors that; frame removal needs `0000` and no cooler on the socket; `2222` sets the CPU attachment `fastenersSecured` to 1 (retained), any lower value sets it to 0; with the ILM removed `set_mechanism` on the plate or lever is `retention_blocked` ("The ILM is off; the contact frame holds the CPU").

- [ ] **Step 1: Failing tests** (engine level, TUF Z790 + i5-14600K + Freezer 36, detailed): backplate padding refused with the board in the case, tape refused outside it; `remove ILM` refused until backplate set, lever up, plate open; refused with a frame on; frame refused before ILM removed, before the CPU is seated, and with no contact-frame cooler in the build; screw sequence: tightening before all engaged → `hardware_order_wrong`; tight order `0,2,1,3` accepted, `0,1` refused; `2222` → CPU `fastenersSecured 1` and `startup` CPU stage satisfied; one screw loosened → CPU `fastenersSecured 0`; plate/lever refused while ILM removed; refit ILM refused with the frame on, accepted after removal; basic (non-detailed) build ignores all of it.
- [ ] **Step 2:** `npx vitest run packages/simulation/src/pc/hardware.test.ts` → FAIL.
- [ ] **Step 3:** Implement `applyHardware` in `hardware.ts` (pure helpers `crossNext(prevTight: number[]): number[]`, `withChar(s, i, c)`), dispatch from the reducer's `set_hardware` case and the `set_prep` allow-list.
- [ ] **Step 4:** Same command → PASS; `npx vitest run packages/simulation` all pass; `npm run type-check`.
- [ ] **Step 5:** Commit `Stage 4: engine models backplate, ILM removal and the contact frame`.

### Task 3: Engine — cooler fixing, retention ring, AIO parts, used plate

**Files:** Modify `hardware.ts`, `reducer.ts` (`mount_part` gate, `set_fasteners` rejection, `unmount_part` contact), `placement.ts` (radiator below the pump), `messages.ts`; Test `packages/simulation/src/pc/cooling.test.ts`.

**Interfaces — Produces:** keys on the **cooler**: `screws` (one char per body screw, same `0/1/2`; sequencing: all engaged before any tight; for `order "alternate"` tight screws alternate — with 2 screws any order of the two; with 4 the cross rule); `position` (ring id), `ring` (`"placed"`), `pins` (4 chars `0/1`), `vrm_fan` (`"attached"`), `contact` (`"used"` set when the cooler body is lifted after being in contact), `clean` (`"done"`). `mount_part` on `cpu_cooler_mount` (role `main` or `block`) is refused with `mounting_missing` until: contact-frame kind → frame tight; retention-ring kind → position matches the socket (`1700` for lga1700/1851, `1200` for lga1200/115x), ring placed, all 4 pins; plus today's film/paste gates; a cooler with `contact "used"` also needs `clean` and paste applied again (the lab lets a pre-applied cooler take new paste only when `contact` is `used`). `screws` sets `fastenersSecured` to the number of `2`s on that role; `set_fasteners` on a cooler with `mounting.kind !== "generic"` in a detailed build → `invalid_action` ("one screw at a time"). A radiator mount whose `location` is `bottom` → `radiator_below_pump` rejection (engine test only if no case offers it). AIO complete mechanically = block placed + block screws tight + radiator placed + its fasteners + `vrm_fan attached`; `startup` keeps its existing radiator/pump faults and adds `part_not_mounted` for a missing VRM module only when a test needs it. `unmount_part` of the cooler body sets `contact "used"` and clears `prep.paste`/`prep.film` and `screws`; not allowed while screws are `2`.

- [ ] **Step 1: Failing tests:** Freezer 36 on Z790: place refused until frame tight, until paste applied, until film peeled (`prep_missing`), accepted when ready; body screws `00→11→20→22`; tightening before both engaged refused; `set_fasteners` refused; LF III 280: block 2 screws alternate, radiator in `front`/`top` accepted, `bottom` refused, AIO not "complete" until radiator, its fasteners and `vrm_fan`; Freezer 7 X on H81M-K: wrong position (`1700`) refused with the socket in the reason, right position then ring then 4 pins then place; pre-applied cooler refuses extra paste; lift → `contact used`, re-place refused until `clean` and paste re-applied; generic cooler and basic mode unchanged; an unsupported socket is still refused (`cooler_socket_unsupported`) and a 159 mm cooler in a case with a lower limit still `cooler_too_tall` (RAM clearance is not modelled: no ARCTIC figure); an AIO's two radiator fans never add to the selected case-fan count (planner build with an AIO and `fans: []` keeps `fanCount` unchanged).
- [ ] **Step 2–4:** fail → implement → pass (`npx vitest run packages/simulation`), type-check.
- [ ] **Step 5:** Commit `Stage 4: engine enforces cooler fixing, retention ring and AIO parts`.

### Task 4: Adapter — steps, next step, migration, documented whole-fit

**Files:** Create `apps/web/components/pc/cooler-assembly.ts` (+ `.test.ts`); Modify `simple-model.ts` (+ tests in `cooler.test.ts`, create).

**Interfaces — Produces:**
- Steps `hw:<board|partKey>:<key>:<value>` (e.g. `hw:board:ilm:removed`, `hw:cooler:screws:1x0`… value = full new string); `isStep`, `applySimpleStep`, `deriveSimpleLists` accept them; `withHardware(snapshot, who, key, value)`; `setSimpleHardware(state, who, key, value): Engine`.
- `type CoolerStep = { kind: "backplate"; value: "padding" | "tape" } | { kind: "lever" | "plate"; desired: "open" } | { kind: "ilm"; desired: "removed" } | { kind: "frame" } | { kind: "frameScrew"; index: number; to: "engaged" | "tight" } | { kind: "ringPosition"; id: string } | { kind: "ring" } | { kind: "pin"; index: number } | { kind: "clean" } | { kind: "paste" } | { kind: "film" } | { kind: "place"; role: "main" | "block" | "radiator" } | { kind: "screw"; role: "main" | "block"; index: number; to: "engaged" | "tight" } | { kind: "vrmFan" } | { kind: "radiatorScrew" } | null`; `nextCoolerStep(state: PCBuildState, key: SimplePartKey): CoolerStep` (the single source for toolbar, robot, resume).
- `simpleCoolerProgress(state, key): { placed: boolean; secured: number; total: number; mechanicallyComplete: boolean; connected: boolean }`.
- `installCoolerWhole(state, key)` — the documented sequence in one call, for `part:` steps, old saves and tests only; exported from `simple-model.ts` as part of `installSimplePart`, **not imported by any component**.
- `migrateCoolerSteps(history: readonly string[]): string[]` — for a history with a cooler `place:`/`part:`/`screw:` step and no `hw:` step: before the first cooler step insert the documented prerequisites (reopen lever and plate if the history had closed them, backplate by whether the board was in the case, ILM removed, frame placed, engage then cross-tighten), and rewrite the four old `screw:cooler:*` steps into the new screw steps. Wired into `parseSimpleSnapshot` after `migrateM2Steps`; failure returns the history untouched.

- [ ] **Step 1: Failing tests:** walking `nextCoolerStep` from a bare board reproduces the documented order for each of the three mechanisms (Freezer 36; LF III 280 incl. block, radiator, VRM module; Freezer 7 X on H81M-K) and ends `null` with `simpleCoolerProgress.mechanicallyComplete`; each returned step applied as one `setSimpleHardware`/mechanism/prep call advances exactly one step; undo of each step restores the previous state exactly (build equality) incl. after lifting the cooler; save round-trip; old v3/v4 saves from `git show 2ecd636` shapes (`part:cooler`; `prep` + `place` + 4 `screw:`) load with CPU + cooler installed and the migrated steps replay; wiring state untouched (`connected` empty, `simpleCoolerProgress.connected false`). Changing the plan's cooler (air ↔ AIO) keeps CPU, RAM and M.2 progress and the ILM/frame state, with no impossible state (Review Focus 5).
- [ ] **Step 2–4:** fail → implement → pass (`npx vitest run apps/web/components/pc`), type-check.
- [ ] **Step 5:** Commit `Stage 4: cooler steps, next-step logic and save migration`.

### Task 5: Page, toolbar, robot, translations — no one-click cooler

**Files:** Modify `SimplePcLab.tsx`, `companion.ts` (+ `companion.test.ts`), `click-assembly.ts` (only to route the cooler's toolbar step), `substeps.ts`, `messages/{en,ar}/labs.json`.

**Interfaces — Consumes:** `nextCoolerStep`, `setSimpleHardware`, `simpleCoolerProgress`, `takeStep`. **Produces:** `coolerStepLine(state, key): CompanionLine | null` (same step as the toolbar; names the screw/frame/position, e.g. "Frame screw 2 of 4"); `resume.cooler*` lines.

- [ ] **Step 1: Failing tests** (`companion.test.ts`): one line per `CoolerStep` kind in EN and AR (`expectSpoken`), welcome back mid-frame (ILM off, 2 screws engaged) names the next screw, installed-but-unwired shows `cooler.notWired`; no line contains a raw key or id.
- [ ] **Step 2–4:** implement: remove `handFitLiquid` and the "place/liquid" button; `PrepPanel` cooler branch becomes `CoolerPanel` (checklist of the steps with state, explicit backplate/orientation choices, per-screw buttons that show 0/1/2, removal path); toolbar's one action = `nextCoolerStep`; every cooler action goes through `takeStep()`; Enter takes the same step. Tests pass, `npm run check:messages`, type-check.
- [ ] **Step 5:** Commit `Stage 4: cooler steps on the page, the toolbar and the robot`.

### Task 6: Scene — frame, ILM off, ring, pins, block, radiator, VRM module

**Files:** Modify `scene/mechanisms.ts` (state-driven extras, like the M.2 heatsinks), `scene/PcScene.tsx` only for hooks; Test `scene/cooler-hardware.test.ts`.

- [ ] **Step 1: Failing test:** with `ilm removed` the plate/lever solids are gone and four screw-hole markers show; `frame placed` draws the frame with screws standing up (`1`) or down (`2`); retention ring + pins; VRM module on the block when attached.
- [ ] **Step 2–4:** implement from engine states only; no change to other parts' materials; schematic proportions stated. Tests pass.
- [ ] **Step 5:** Commit `Stage 4: the 3D view draws the cooling hardware`.

### Task 7: Verification gate and handoff

- [ ] `npm test` (passed and skipped counted separately), `npm run type-check`, `npm run check:messages`, `npm run build` (revert `apps/web/next-env.d.ts`).
- [ ] `docs/handoff/2026-11-22/acceptance/cooling.mjs`: EN 1440, AR 1440, EN 430 — Freezer 36 on the TUF board and LF III 280 (practice build), each full install and removal by click; double click; wrong backplate and wrong order refused; reload mid-frame and mid-AIO; undo; camera unchanged (`__ytlCamera`); no page errors. Re-run `m2.mjs`, `cpu-ram-click.mjs` and the Stage 3 review corrections (never browser-tested before).
- [ ] Update `PROJECT_HANDOFF.md` (behaviour, files, commits, sources with pages, commands and results, skipped checks, approximations, gaps); roadmap row; push `feat/stage4-cooling` (normal push); report Vercel status for that SHA.
