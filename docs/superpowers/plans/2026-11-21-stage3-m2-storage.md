# Stage 3 — M.2 Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install and remove an M.2 drive by click/tap in the 3D lab, one documented mechanical step at a time, per the exact board's manual (heatsink, latch or screw, angle, press flat, secure, film, refit).

**Architecture:** Catalog data (`content/catalog`) gains each board's verified M.2 heatsinks and retention; the engine (`packages/simulation` reducer) enforces heatsink/latch/screw/tilt rules as host mechanisms; the single-PC adapter (`apps/web/components/pc/simple-model.ts`) adds slot choice (as memory does), steps, save migration; `click-assembly.ts` adds the next M.2 step; the page, robot and scene render it.

**Tech Stack:** TypeScript, Next.js 16, React Three Fiber, next-intl, Vitest, Playwright (browser checks).

**Spec:** The owner's assembly brief of 2026-11-21 (sections A–Q; this plan covers A–E plus the P gate for Stage 3). Roadmap for the later stages: `docs/superpowers/plans/2026-11-21-assembly-stages-roadmap.md`.

## Global Constraints

- Branch `feat/stage3-m2-storage` from `feat/click-assembly-toolbar` (`2ecd636`). No merge to `main`, no production deploy, no force-push.
- Click/tap only for parts; no dragging. One action = one mechanical step. Never auto-orient, never auto-tilt, never move the camera.
- Keyboard follows the same validated steps. Repeated input during a transition is ignored.
- Storage keys unchanged (`ytl_pc_plan_progress_v1`, `ytl_simple_pc_v1`, …). Old saves must load; migrations are explicit and tested.
- Hardware facts only from the exact board's documents; anything else is labelled an educational approximation.
- English and Arabic for every new line; `npm run check:messages` must pass. No raw keys or ids shown to the learner.
- Skipped tests are never counted as passed. A local build is never reported as the deployed preview.

## Verified hardware facts (sources)

| Board | Heatsinks (2 screws each, Phillips) | Retention | Source |
|---|---|---|---|
| TUF GAMING Z790-PLUS WIFI | `m2-hs-1` over M.2_1; `m2-hs-2` over M.2_3 + M.2_4; M.2_2 bare | M.2_1/2/3: Q-Latch (pre-installed at 2280; moved for 2242/2260/22110). M.2_4: Q-Latch for 2280; screw stand + screw for 2242/2260 | E21279 pp. 1-11, 2-7 to 2-12; official top photo |
| TUF GAMING Z790-PLUS WIFI D4 | same layout as above (checked on its own photo) | same as above | E20581 pp. 2-7 to 2-12; official top photo |
| PRIME B760M-A WIFI | `m2-hs-1` over M.2_1; M.2_2 bare | Screw stand at the length hole + one screw (no Q-Latch) | E21693 pp. 1-2, 1-14 |
| H81M-K | no M.2 slot | — | E8601 |

All three manuals: remove the plastic film from the heatsink thermal pads before refitting (E21279/E20581 step 4; E21693 step 6). Rubber pad steps are optional (single- vs double-sided drives) and are explained, not required: the catalog does not record the 990 PRO 1TB's sidedness. Insertion angle: the manuals show an angled insertion without a number; the lab accepts 15–35° and says it is an approximation.

## Review Focus

1. A drive in a heatsink-covered slot after reload with the heatsink lifted — the heatsink stays lifted, the film state stays, the robot names the next step (not "install the drive").
2. A pre-Stage-3 save with `mech:m2-1-qlatch:*` steps on a covered slot (TUF) or on the B760M-A — loads, same parts in, heatsink refitted; nothing cleared.
3. Two drives sharing one heatsink (M.2_3 + M.2_4) — refitting is refused until both drives are secured or their slots empty; removing one drive leaves the other secured.
4. Double-click on "Insert" — only one step is recorded.
5. Undo after "Refit heatsink" — heatsink lifted again; film stays peeled (undo never re-applies a film or consumes anything).

---

### Task 1: Contracts and catalog — verified heatsinks and retention

**Files:**
- Modify: `packages/contracts/src/pc.ts` (`RetentionSpec.kind`, `m2_slot` mount point, `KeyingSpec`)
- Modify: `content/catalog/helpers.ts` (`m2QLatch`, new `m2ScrewStand`, `m2Heatsink`)
- Modify: `content/catalog/motherboards.ts` (TUF, D4), `content/catalog/expansion.ts` (B760M-A)
- Test: `packages/simulation/src/pc/catalog.test.ts` (or the existing catalog test file)

**Interfaces — Produces:**
- `RetentionSpec.kind` adds `"m2_screw"` (screw stand + screw; ids `${slot}-screw`, stand mechanism `${slot}-screw:stand`).
- `m2_slot` adds `heatsink?: { id: string; screws: number; padFilm: boolean; note: string }` (same `id` on every slot it covers).
- `m2_slot` adds `shortRetention?: "m2_screw"` (TUF/D4 M.2_4: lengths 2242/2260 use the screw stand).
- `KeyingSpec` adds `insertTiltDeg?: [number, number]` (M.2: `[15, 35]`, approximation note in `retention.note`).

- [ ] Step 1: Failing test `every offered M.2 slot names its retention and heatsink from its own manual`: TUF and D4 → `m2-1.heatsink.id === "m2-hs-1"`, `m2-3`/`m2-4` → `"m2-hs-2"`, `m2-2.heatsink === undefined`, every heatsink `screws === 2 && padFilm === true`; `m2-4.shortRetention === "m2_screw"`; B760M-A `m2-1`/`m2-2` `retention.kind === "m2_screw"`, `m2-1.heatsink.id === "m2-hs-1"`, `m2-2.heatsink === undefined`; every M.2 keying `insertTiltDeg` equals `[15, 35]`; each board's `sources` include the page strings above.
- [ ] Step 2: Run `npx vitest run packages/simulation/src/pc` → FAIL on the new test.
- [ ] Step 3: Add the types and data; B760M-A `fastener: { kind: "m2_screw", count: 1 }`; move the board notes to cite pages; keep `verification` honest (`unverifiedFields` gains "M.2 rubber pad / drive sidedness").
- [ ] Step 4: Run the same command → PASS; `npm run type-check` → exit 0.
- [ ] Step 5: Commit `Stage 3: M.2 heatsinks and retention from each board's manual`.

### Task 2: Engine — heatsink, screw stand, tilt

**Files:**
- Modify: `packages/simulation/src/pc/reducer.ts` (`set_mechanism`, `mount_part`, `set_seating`)
- Test: `packages/simulation/src/pc/m2.test.ts` (create)

**Interfaces — Consumes:** Task 1 types. **Produces:** host mechanisms (all `"open" | "closed"`, default `"closed"`): `${hs}:screws` (open = loosened), `${hs}` (open = lifted off), `${hs}:film` (open = peeled); `${slot}-screw:stand` (closed = stand fitted at the drive's length hole — default open on B760M-A); `${slot}-screw` (closed = screw in). Alignment gains optional `tiltDeg`.

- [ ] Step 1: Failing tests (engine level, detailed mechanics, TUF + 990 PRO):
  - `mount into M.2_1 is refused while its heatsink is on` → rejection code `retention_closed` naming the heatsink; after `${hs}:screws` open and `${hs}` open it proceeds to the Q-Latch check.
  - `lifting a heatsink needs its screws loosened first`; `screws can only be tightened on a fitted heatsink`.
  - `flat insertion is refused` (`tiltDeg` 0 → `alignment_off` with an angle reason); `tiltDeg` 25 → seating `placed`; `set_seating seated` → seated; Q-Latch closed → `fastenersSecured 1`.
  - `refitting is refused until the pad film is peeled` and `until every covered slot is empty or its drive secured` (M.2_3 secured, M.2_4 placed → refused).
  - `opening the Q-Latch lets the drive rise to placed; unmount only from placed` (removal path).
  - B760M-A: `drive needs the screw stand first`, `screw secures it`, no `qlatch` mechanism exists.
  - M.2_2 (bare) needs no heatsink step.
- [ ] Step 2: Run `npx vitest run packages/simulation/src/pc/m2.test.ts` → FAIL.
- [ ] Step 3: Implement in the reducer; heatsink rules only when `mechanics: "detailed"` (basic builds unchanged).
- [ ] Step 4: Run it → PASS; run `npx vitest run packages/simulation` → all pass (record counts).
- [ ] Step 5: Commit `Stage 3: engine enforces M.2 heatsink, screw stand and insertion angle`.

### Task 3: Single-PC adapter — slot choice, steps, migration

**Files:**
- Modify: `apps/web/components/pc/simple-model.ts`, `apps/web/components/pc/plan-model.ts`
- Test: `apps/web/components/pc/m2.test.ts` (create, mirrors `ram.test.ts`)

**Interfaces — Produces:**
- `isM2Key(key)`; `simpleM2Slots(state): { id; label; heatsinkId: string | null; occupant: SimplePartKey | null; fits: boolean }[]` for the held drive.
- `simpleM2TargetFor(state, key, slotId): { ok: true } | { ok: false; reason: "length" | "interface" | "occupied" }`.
- `SimpleHeld` adds optional `tiltDeg?: 0 | 25` and `slotId?: string` (M.2 only); `parseHeld` accepts old shapes.
- Steps: `hs:<hsId>:screws|lift|film|fit|tighten` (one each, undoable), `lower:<key>:<rot>:<x>:<z>:t<tilt>:s<slot>` (old `lower:` forms still parse).
- `installSimplePart` (used by `part:` steps, tests and old saves) performs the full documented sequence and ends with the heatsink refitted and tightened.
- `migrateM2Steps(history, model)`: for saves without `hs:` steps, inserts heatsink lift before the first step that touches a covered slot and refit/tighten after its last securing step; on the B760M-A maps `mech:m2-N-qlatch:open` → nothing, `…:closed` → stand + screw steps.

- [ ] Step 1: Failing tests: full TUF M.2_1 sequence by steps; same on M.2_2 (no heatsink); B760M-A sequence; `simplePartInstalled` false until secured; stage incomplete until heatsink tightened (`simpleM2Done`); two drives on M.2_3/M.2_4 keep separate progress after removing one; undo of each step restores the previous state exactly; old v3 save `["mech:m2-1-qlatch:open","lower:storage","seat:storage","mech:m2-1-qlatch:closed"]` parses to the same parts and a refitted heatsink; v4 B760M-A save with Q-Latch steps parses; a save whose steps do not replay is still rejected as before (not cleared); `simpleCablesFor` lists no SATA data or SATA power lead for an NVMe M.2 drive; no slot-sharing rule is applied (none of E21279, E20581, E21693 documents one for these slots — recorded as a catalog note, not invented).
- [ ] Step 2: Run `npx vitest run apps/web/components/pc/m2.test.ts` → FAIL.
- [ ] Step 3: Implement. Drive's slot is chosen by click (no default slot, as memory); the planner no longer fixes an M.2 slot but checks at least one compatible slot exists per drive.
- [ ] Step 4: Run → PASS; `npx vitest run apps/web/components/pc` → all pass.
- [ ] Step 5: Commit `Stage 3: M.2 slot choice, heatsink steps and save migration`.

### Task 4: Click assembly — the next M.2 step

**Files:** Modify `apps/web/components/pc/click-assembly.ts`; Test `apps/web/components/pc/click-assembly.test.ts`.

**Interfaces — Produces:** `HandStep` adds `{ kind: "heatsink"; hsId: string; step: "screws" | "lift" | "film" | "fit" | "tighten" }`, `{ kind: "stand" }`, `{ kind: "tilt" }` (needs angling before insert). `aimTargets` for an M.2 drive: every M.2 slot (incompatible ones answer with the reason).

- [ ] Step 1: Failing tests: next step sequence for TUF M.2_1 equals `[heatsink screws, heatsink lift, mechanism open, aim, tilt, lower, seat, mechanism closed, heatsink film, heatsink fit, heatsink tighten]`; M.2_2 skips the heatsink items; B760M-A uses `stand` and `fasten`; `aimHeld` on an occupied slot → `slotTaken`.
- [ ] Step 2–4: fail, implement, pass (`npx vitest run apps/web/components/pc/click-assembly.test.ts`).
- [ ] Step 5: Commit.

### Task 5: Page, toolbar, robot, translations

**Files:** Modify `SimplePcLab.tsx`, `companion.ts`, `messages/{en,ar}/labs.json`; Test `companion.test.ts`.

- [ ] Step 1: Failing companion tests: `pickupLine` for a drive whose slot heatsink is on → `hands.m2HeatsinkScrews` with `{ slot: "M.2_1" }`; resume with a drive held over M.2_1 tilted 0 → `[welcomeBack, resume.m2Over{slot}, hands.m2Tilt]`; every new key exists in EN and AR.
- [ ] Step 2–4: fail, implement (toolbar buttons: Loosen heatsink screws, Lift heatsink, Peel pad film, Refit heatsink, Tighten heatsink screws, Tilt up/flat, Fit screw stand, Insert, Press flat, Turn Q-Latch / Screw in; keyboard `T` tilt; busy guard), pass.
- [ ] Step 5: Commit.

### Task 6: Scene — heatsinks, film, tilt

**Files:** Modify `apps/web/components/pc/scene/mechanisms.ts`, `PcScene.tsx`; Test `scene/visual-details.test.ts`.

- [ ] Step 1: Failing test: mechanism extras for TUF include `m2-hs-1` box over `m2-1` when fitted and none when lifted (lifted copy beside the board); film tab only while not peeled; screw markers `m2-hs-1-screw-0/1` up when loosened.
- [ ] Step 2–4: fail, implement (colours from the existing palette, no change to other parts' materials), pass.
- [ ] Step 5: Commit.

### Task 7: Verification gate and handoff

- [ ] `npm test` (record passed / skipped separately), `npm run type-check`, `npm run check:messages`, `npm run build` (revert `apps/web/next-env.d.ts`).
- [ ] Browser script `docs/handoff/2026-11-21/acceptance/m2.mjs` (EN + AR, 1440 and 430 widths, keyboard path): TUF M.2_1 full install and removal, M.2_2, wrong angle refused, occupied slot refused, double-click ignored, reload mid-step, undo, no camera change (`window.__ytlCamera` unchanged across all steps), no page errors. Re-run `ram2`, `ram-h81`, `ram-resume`, `cpu-*`.
- [ ] Update `PROJECT_HANDOFF.md` (Stage 3 section: behaviour, files, commits, sources, commands and results, skipped checks, approximations).
- [ ] Commit; push `feat/stage3-m2-storage` (normal push); report Vercel status for that SHA.
