# Project handoff — Virtual Training Environment (VTE), 2026-11-20

Current site brand: **بيئة التدريب الافتراضية (VTE)** in Arabic and
**Virtual Training Environment (VTE)** in English. Older references below use the former name.
The repository and hosting identifiers remain `talal-claude`; saved-data keys are unchanged.

## Current status — 2026-11-26 continuation

Reviewed feature checkpoint: `feat/assembly-completion` at `72330d6` (repair packet `0fa7056`, Stage8 `9276afa`, Stage9 `72330d6`).
The latest interrupted wiring work is preserved separately on **`wip/wiring-2026-11-26`** in this same isolated worktree.
Claude reached its five-hour limit while implementing Stage10 (reported reset20:40 Asia/Riyadh, 2026-11-26).

The saved Stage9 checkpoint passes relevant independent tests/types/messages; final browser/production-build gates remain.
The partial Stage10 source **fails type checking** because companion.ts lacks the `parseEndStep` import, and its actual-port
selection is not yet wired into the UI save callback. Model probes and 85 relevant tests pass, but that is not full acceptance.
Stage11 readiness/startup work remains. No `main` merge or production deployment was made.

Read `docs/handoff/2026-11-26/CODEX_REVIEW.md` and **`NEXT_CLAUDE_PROMPT.txt`** for the exact remaining commands and gates.
Continue that WIP branch without reverting reviewed work; integrate it back only after fixing the listed issues and final checks.

## Current work — assembly completion checkpoint (2026-11-25)

The owner authorized continuing the full agreed PC-assembly roadmap through Stage 11, with Claude implementing and
Codex reviewing. Older stage-by-stage stop instructions no longer block this authorized work. Other site sections stay intact.
Work is isolated in `/Users/most/Documents/Codex/VTE-completion-2026-11-25`, branch `feat/assembly-completion`.
The original workspace remains on the working cooling-fix branch; no `main` merge or production deployment was made.

- Based on `4c1b333`; local WIP checkpoint `d58ef7b` adds staged SATA/PSU/fan placement, position choices, per-screw removal,
  scene fastener visibility and tests. Cooling repair `afd162e` was cherry-picked as `3dce2b5`.
- A second pass adds preliminary fan-bank constraints and corrected supplied-fan positions, and changes physically valid
  PSU/fan orientations from forced choices to advice. These are partial implementation changes, **not accepted release work**.
- Claude hit its five-hour usage limit while implementing; the CLI reports reset at **20:40 Asia/Riyadh on 2026-11-25**.
  Per the owner's established role split and previous preference to wait for Claude, Codex completed review/checkpoint work
  rather than silently taking over product implementation.
- Independent checks on the saved product source: `npm run type-check`, `npm run check:messages`, `npm run build` passed;
  `npx vitest run apps/web packages`: **83 files, 1064 passed, 21 skipped** (unconfigured database/provider integration).
- **Additional review reproduction FAILED:** a motherboard with its own cooler lead connected internally is refused for
  lifting even after all its screws are removed (`unplugFirst`). Both ends travel with the board. This defect is not covered by
  the green broad suite. Run `npx vitest run --config docs/handoff/2026-11-25/review/vitest.config.mjs` to reproduce.
- Remaining work includes that confirmed blocker, actual alternate mount targets/robot consistency, fault-mode removal
  intent, save/rebase migrations, verifying fan-bank claims, individual GPU covers/bracket screws, wiring/final-readiness
  completion and the final EN/AR desktop/430px browser/visual checks. Earlier/interrupted browser runs do not verify this source.

Read `docs/handoff/2026-11-25/review/CODEX_REVIEW.md` for findings and evidence, `IMPLEMENTATION_SCOPE.txt` for the full
authorized scope, and `RESUME_CLAUDE.txt` for a ready continuation instruction. The broad checks passing do not mean this
checkpoint is ready to release. Preserve all current work and complete review findings before publishing a final preview.

## Assembly completion — first repair packet (2026-11-26, branch `feat/assembly-completion`)

Not a completion claim; stages 8 (per-screw GPU bracket, per-cover slot covers), 10, 11 and the full browser/visual gates are still open.
- **Carried-board lead blocker (confirmed, fixed).** `simpleLiftBlock` rejected lifting a board whose own cooler lead was plugged into that same board. Now only a lead *crossing* the carried assembly (board + the parts it carries) blocks (`leadCrosses`): the CPU_FAN lead stays attached; an external PSU/case lead still blocks. Regression in `screwed-parts.test.ts` (internal lead lifts, replays after reload; ATX to a PSU blocks; undoing the PSU-side plug unblocks) and Codex's saved reproduction (`npx vitest run --config docs/handoff/2026-11-25/review/vitest.config.mjs`) both pass.
- **Fault mode (note 1, confirmed by reading the code, fixed).** The removal-direction helper read `saved.history`; a fault build now keeps its own `trail` and the frame-screw baseline it started from (`boardFrameScrews`, a finished build starts "2222"), so the first loosening is read as removal. Regression in `faults.test.ts`. The React wiring itself has no component test; it is covered by the types and the helper, and needs the browser pass.
- **Rebase (note 5).** `rebaseProgress` now decides "only the suggested place moved" from the from/to `PartSpec`s (`isPositionSpec`), not the page's active model. Tests: adding a fan keeps everything; removing the last drive undoes only it; another fan model undoes only that fan.
- **Chosen bay/fan place (note 9).** One value (`chosenPosition`) drives the controls, the scene targets (`pick:` clicks, only the chosen place glows, none implied before a choice), the robot pointer (`guideFocus`), the toolbar (it now places / screws like the panel) and the saved `place:<key>@<place>` step. The pre-placement choice itself is not persisted (a reload puts the part down; the placed step is). Unit tests for targets/guide/saved step; browser run still to do.
- **Radiator and fans (notes 10, 16).** `placeRadiator` no longer moves any fan by itself: fans in the way are refused (`fanInTheWay`); the case's own fans move through the learner's own saved step `fans:<cooler>` (`clearRadiatorFans`, a new `clearFans` cooler step with robot line, EN/AR); a fan the learner fitted is never moved. Only replaying an old `rad:` step still moves the case's own fans, explicitly (`migrate`). The practice build's second case fan is now the rear one (Corsair 4000D AIRFLOW), so only the front fan moves. Old plan saves: a `place:fanN` without a chosen place replays at the plan's default, now front 2 rather than front 3 (documented, tested, nothing dropped).
- **Fan banks (note 12).** Documented capacity (3 x 120 or 2 x 140 mm at the front; Corsair QSG, Fractal North page) is what the model offers; the mixed row is described as an unmodelled layout, not a manufacturer prohibition. The rear fan of the 4000D overlaps the board's I/O cover in the schematic geometry (pre-existing approximation, visible now that a case fan is supplied there); the liquid-cooler scene test no longer includes it.
- **Orientation (notes 8, 14).** Both PSU fan directions and both fan airflows fit; the engine only requires a choice; `simpleOrientationAdvice` gives the usual direction. `screwed.mjs` updated accordingly (not re-run in this packet).
- `aio.mjs` still assumes the radiator step moves the fans: it needs the new `clearFans` click before its radiator step (not yet updated; browser matrix deferred to the final gates).
- Verified this packet: `npm run type-check` and `check:messages` pass; `npx vitest run apps/web packages`: 83 files, 1074 passed, 21 skipped (database/provider integration, unconfigured), final run. No browser or build run in this packet.

## Assembly completion — Stage 8 and Stage 9 packet (2026-11-26, branch `feat/assembly-completion`)

Not a completion claim; Stage 10–11 and every browser/visual gate (EN/AR, desktop and 430 px, production build) are still open.
- **Slot covers one at a time (Stage 8).** The case's covers are separate engine mechanisms `slot-covers:1`, `slot-covers:2` (counted from the first x16 slot; `RetentionSpec.openings`, `slotCoverIds` in `@ytl/contracts`). The card is refused until every cover its bracket needs is out (the message names the cover); a cover cannot go back while a card is in. The bare `slot-covers` step (every cover at once) and `fasten:`/`unfasten:` stay only to replay old saves and for `installSimplePart`; no control reaches them. The scene (`scene/mechanisms.ts`) draws each cover's gap; `slot-covers.test.ts` pins it.
- **Old raw builds (review note 6).** A raw `PCBuildState` with only the old `mechanisms['slot-covers']='open'` is read as both covers out; a cover's own state wins over it (`slotCoverOpen` in `@ytl/contracts`, used by the engine, adapter and scene). Regressions start from such a raw state (`hands.test.ts`, `slot-covers.test.ts`).
- **Robot targets per phase (review note 7).** `guideFocus` points at the actual rear cover (`solid` target with `slice`, no camera move), then the slot's own latch solid, the slot while aligning, and the card for its bracket screws (`gpuTargets`; `hands.test.ts`). The scene's screenshot of this is not taken yet.
- **Bracket screws one at a time.** The GPU panel, toolbar and robot use the same `screwSimplePart`/`unscrewSimplePart` as the board, PSU and fans (`screw:gpu:<n>`, `unscrew:gpu`), through the existing double-click gate; the card is installed only when every screw is in, and cannot be lifted while one remains. Undo takes back one screw. Tests: `hands.test.ts` (covers, rejection order, screws, replay, old whole-card save, toolbar sequence).
- **Sources and approximation (honest).** ASUS's pages for the catalog cards give slot thickness (2 to 3.6) but, in what was searched this packet (ROG Strix RTX 4090 and Dual RTX 4060 pages and ASUS's installation FAQ 1047391), not the number of rear bracket openings or bracket screws; the cases' manuals do not say how each cover is fixed. The lab therefore keeps its earlier schematic of **two covers** per card (`SLOT_COVERS.openings`) and the existing two bracket screws, and labels it so. Slot thickness is **not** used to derive either count. Unknown: real opening/screw count per card model and how each case fixes its covers (one release-and-remove step per cover is modelled; no per-cover fastener).
- **Case's own fans are selectable parts (Stage 9).** `suppliedFanSpecs` makes `sfan1`, `sfan2` (instance IDs unchanged, e.g. `fan-9`) in the legacy and planned models (`alternatives`, so they are never required: removing one does not change progress or startup; their leads need the fan fitted). They are listed beside the other parts, labelled "supplied", can be picked by chip or by clicking the fan in the scene, and take the same steps as a fan the learner chose: unplug the lead, one screw per click, lift, choose another valid place (engine bank/size rules apply), airflow, place, screws.
- **No automatic fan moves.** A radiator in the way is refused (`fanInTheWay`); the cooler's next step is `clearFans` for the first fan in the way, which only selects that fan and names it in the robot line. `clearRadiatorFans` / `fans:<key>` / `rad:` (which move the case's fans) remain only for old-save replay and whole-fit (`installCoolerWhole`); `aio.mjs` now takes the fan out first (not run).
- **Rear fan and I/O.** Cause: the generator centred the rear fan in the chamber, so its frame began 4 mm (4000D) to 12 mm (Fractal) inside the board's rear I/O stack. `caseGeometry` now starts the rear fan beyond tray + 48 mm (dimensions unchanged; assets regenerated). `liquid-cooler.test.ts` now includes the rear fan in the clearance check (no blanket exclusion) and `visual.test.ts` pins the rule for every case. A representative screenshot is still to be saved in the final gates.
- Verified this packet: `npm run type-check`, `npm run check:messages`, `npx vitest run apps/web packages` (84 files, 1089 passed, 21 skipped: database/provider integration; Codex's saved carried-board probe also passes). **Not run:** production build, any browser acceptance (`aio.mjs`, `screwed.mjs`), screenshots.

## Concise-code refactor — locally reviewed and checked (2026-11-25)

Owner requests concise, readable code for the current project and future projects. Claude implements;
Codex supervises and reviews. Branch `refactor/concise-code` starts at `2f9ba78`.

**Status as of 2026-11-25.** The second pass (below) is complete locally: Codex's independent review found no
actionable issue. Checks: `npm run type-check`, `npm run check:messages` and the focused Vitest command below
(72 files, 948 passed, 21 skipped for the unconfigured database/provider) passed, and the production `npm run build`
passed. Codex confirmed the total against `2f9ba78`: 21 production TS/TSX files, +125/−227 = net 102 fewer lines
(helpers included); `SimplePcLab.tsx` went from 1791 to 1725 lines. A local production server was restarted on port 3001.
**Verification of `606dc4e` (2026-11-25, production build `npm run build`, local server port 3001, software-GL Chrome, fresh
test-browser storage).** `npm run type-check`, `npm run check:messages` and `npm run build` exit 0. Vitest `apps/web packages`:
82 files, 1051 passed, 21 skipped (database/provider integration, unconfigured). Browser acceptance, all passed with no page
errors: `cooling.mjs` 27/27 in en, ar, en at 430 px and ar at 430 px (frame, screws, undo, reload, double click, cooler removal,
then the optional contact-frame removal and original-ILM refit, camera unchanged); `aio.mjs` 13/13 en and ar (old-format save
migrates); `cpu-ram-click.mjs` 9/9; `m2.mjs` 31/31. The earlier interrupted run was a harness defect: the script's locator matched
the cooler's own "Tighten frame screw" refit step as well as the optional removal button; the committed locator targets only
the optional removal buttons (the optional step is by design not the cooler's next step). **Not verified:** the deployed preview
(Vercel status `success` for `606dc4e`, dashboard link only; the dashboard needs a Vercel login, so no hostname was obtained or
opened); looks of the 3D scene beyond one canvas-pixel comparison (the picture changes when the socket frame comes off, 4 runs; no screenshots were saved or reviewed);
touch hardware; planner Add/Remove and storage-device removal were covered by unit tests only, not re-run in the browser this
pass; retention-ring/AMD coolers are engine-only (not reachable in the planner). The branch is committed and pushed
(`origin/refactor/concise-code` = `606dc4e` at the start of this pass). No merge into `main` and no production deploy
without the owner's approval.

**Contact-frame removal repair (2026-11-25, on top of `4c1b333`).** *Root cause: product and harness, both.* Product: after
the first frame screw was loosened the cooler's own next fitting step ("Tighten frame screw 1") became the primary toolbar action,
the panel's main button and the robot's line, while removal stayed a side button; so the learner who had chosen removal was
steered back to tightening (evidence: a diagnostic run printed the "Tighten" button twice beside "Loosen frame screw 3 of 4").
Engine states cannot tell loosening from fitting (both are "1"), so the direction is read from the saved steps:
`mountingDismantling(history)` (`cooler-assembly.ts`) is true when the last saved step on the board's frame/ILM removed something
(fewer screw turns than before, frame lifted, original ILM back). While it is true and `nextMountingRemoval` has a step, the toolbar,
the cooler panel and the robot (select and welcome-back lines, through `companionSay(..., dismantling)`) lead with that removal
step; the fitting step stays as a separate, labelled alternative ("Fit a cooler instead"). Any fitting step flips it back; Undo
and reload recompute it from the saved steps. No new mode, no second state machine, no engine change. Both groups are `role="group"`
with accessible names (`hands.mountingGroup`, `hands.refitGroup`, en/ar) so browser tests find them semantically. Harness: the
earlier locator matched by words; the committed script now scopes to those groups and asserts that the primary action equals the
removal button, the robot line, the fitting alternative, undo and reload part-way, that the frame is offered only when every frame
screw is out, and one history step per click. A first rewrite asserted "no frame-screw marks in the scene" for removed screws, but
the scene draws a removed screw as an empty hole; it now asserts all four are "empty" (assertion corrected, not weakened).
Regression test: `cooler.test.ts` "once the learner chooses removal…" (red first: `mountingDismantling is not a function`, then green).
**Results on the final production build:** `npm run type-check`, `npm run check:messages`, `npm run build` exit 0; Vitest
`apps/web packages` 82 files, 1052 passed, 21 skipped; `cooling.mjs` 40/40 in en, ar, en 430 px and ar 430 px; `aio.mjs` 13/13 en and
ar; `cpu-ram-click.mjs` 9/9; `m2.mjs` 31/31 (run with an unrecognised locale argument, so in English). Planner Add/Remove was
not re-run in the browser this pass. The deployed preview is still unverified (Vercel status only; dashboard needs a login).

### History — first checkpoint (`81bfb14`)

- Claude's partial changes reuse part/cable/first-attachment lookups and storage validation/errors,
  and remove verified unused imports/constants. Net production change so far: 58 added, 75 removed
  across 17 TypeScript files (17 fewer lines); this is not the completed refactor.
- Codex verified this checkpoint: 68 test files, 905 tests passed, no failures/skips; type checking,
  translation parity, and production build passed. No browser/visual verification was performed.
- Future guidance is in project `CLAUDE.md` and user-level `~/.claude/CLAUDE.md` on this machine.
  Reduce real duplication; preserve behavior, educational steps, validation, security, data, and tests.
- Second pass (Claude, uncommitted on top of `81bfb14`; since reviewed by Codex and built — see status above):
  - `SimplePcLab`: removed the unreachable `HandsPanel` tail (the four `handKind` branches keep their plain-function
    calls); `GpuHands` now uses `holdKeys` (identical key map for a GPU: Q/E flip, arrows nudge, Enter lowers);
    the existing `handsOff()` replaces the repeated `lockedOn || (mode === "fault" && …)` guards and `disabled`
    expressions; one `commit(state, step)` helper replaces nine copies of "fault state, else saved step" (`keepHand`
    uses it; order of state updates, null-fault handling and one saved step per action are unchanged).
  - Removed unused exports `withHardware`/`withRadiator`/`withRadiatorScrews` (no users) and the provider
    compatibility re-export in `tutor/anthropic.ts`; the root layout now imports `providers` directly.
  - `lib/storage/validation.ts` now holds the shared `notFound`, `conflict` and `toStoreError(error, "project" | "progress")`
    next to `corruptRecord`/`invalid`; both guest and account stores use them. Codes and message strings are identical
    (the progress repository's corrupt-record message is built by `corruptRecord` with the same text). Not in
    `packages/contracts`; no schema, migration, SQL or sandbox change. New `lib/storage/store-errors.test.ts` pins the
    messages, error identity pass-through, SQLSTATE 22/23 mapping, the "unavailable" wording per database and non-Error inputs.
  - Left unchanged on purpose: role-specific attachment `.find` (not `firstAttachment`), `attachmentOf`'s lenient
    unknown-key lookup, non-equivalent validators, and the distinct `"the saved progress did not read back…"` message.
  - Measured against `2f9ba78` (`git diff --numstat`, production TypeScript, 21 files incl. the shared helpers in
    `validation.ts`): 125 added, 227 removed = 102 fewer lines. Tests: +57 (new file). Docs: this section plus `CLAUDE.md`.
  - Checks run: `npm run type-check`, `npm run check:messages` passed; vitest on packages, `apps/web/components`,
    `lib/targets`, `lib/interaction`, `lib/storage`, `lib/server/tutor`, `lib/server/db`: 72 files, 948 passed, 21 skipped
    (PostgreSQL integration needs `TEST_DATABASE_URL`; the real AI call needs a provider) — so the database error
    mapping is covered by the new unit test, not by a live database. At the time of writing the build, browser/visual
    checks and preview deployment had not been run (the build has since passed; the other two still have not been).

## Latest work: Stage 4 — CPU cooling + PC-section isolation (branch `feat/stage4-cooling`, 2026-11-23)

Started from `feat/stage3-m2-storage` at `f2f78af`. Not merged, not deployed to production. Plan:
`docs/superpowers/plans/2026-11-22-stage4-cpu-cooling.md`; ledger (git-ignored) `.superpowers/sdd/2026-11-22-stage4-cpu-cooling/progress.md`.
Superpowers skills actually invoked: writing-plans, executing-plans, test-driven-development,
systematic-debugging, verification-before-completion. Final review: self-review (no subagents were requested).

**Behaviour.** A cooler is fitted and removed one documented step per click (toolbar, cooler panel, robot and
resume all read the same `nextCoolerStep` / `nextCoolerRemoval`; there is no "install the whole cooler" button or
one-click cooler swap — taking the other cooler off first is required). Contact-frame coolers (Freezer 36, Liquid
Freezer III 240/280, LGA1700): backplate support (padding board-outside-case / tape, the learner's choice) → socket
lever up → load plate open → the board's own frame (ILM) taken off → contact frame placed → 4 frame screws engaged by
hand, then tightened across the frame → paste/film (film only where the catalog says one exists; pre-applied paste
respected) → cooler body placed → its two screws engaged then tightened → (AIO) small VRM fan; the radiator needs the
board in the case, then 8 radiator screws, one per click. Retention-ring coolers (Freezer 7 X): ring, mounting
position matching the socket, 4 push pins. Removal is the reverse (AIO radiator first, then the body's screws loosened
and out, then lift). Electrical connections stay a separate stage (robot: "its cables come later"). Undo is distinct
from physical removal. Old saves migrate in place (`migrateCoolerSteps`): documented prerequisite steps are inserted before
`place:<cooler>`; version-3 whole-part saves still load (checked in a browser).

**3D scene (reads engine state only).** `scene/cooler-hardware.ts` (`coolerHardwareDraw`) + `SocketMechanism.tsx`:
with the board's frame removed the plate, lever and tab disappear and four empty screw holes appear at the corners;
the contact frame appears when placed; each frame/body screw is drawn empty / engaged (standing up) / tight (flat);
retention ring and pins; the backplate support under the board. Screw 0 and 2 are opposite corners — the same
indices the controls and the robot use. Reload and undo draw the same picture (checked in a browser through the scene's
read-only `window.__ytlHardware`). The AIO radiator and its fans use the existing scene; the radiator's own screws
use the existing fastener markers.

**Hardware references (ARCTIC support pages and spec sheets, read into the catalog's `sources`).**
support.arctic.de/freezer-36; support.arctic.de/liquid-freezer-III-240-A-RGB and /liquid-freezer-III-280 (manuals and
spec sheets); support.arctic.de/freezer7xr3 + Spec_Sheet_Freezer_7X_EN.pdf. No compound name or paste quantity is
asserted; the unverified fields are listed in each entry's `unverifiedFields`; those entries are `partially_verified`.

**Isolation (`PcBuilder.tsx`).** `SimplePcLab` is loaded with `next/dynamic` (`ssr:false`) only when assembly starts or
resumes; the planner needs only the catalog, plan and saved-state code. The 3D scene was already a separate
dynamic chunk. Same origin, same storage keys, same `/pc` URL and `?practice=1`/`?advanced=1`. Measured with
`docs/handoff/2026-11-23/acceptance/perf.mjs` (production build, Chrome with software GL, fresh context per page):
| | before | after |
|---|---|---|
| home JS | 901 KB | 901 KB (unchanged) |
| /pc planner JS | 1429 KB | 1227 KB (−202 KB) |
| assembly started JS | 2451 KB | 2455 KB (+4 KB) |
| WebGL chunk on home / planner | none / none | none / none |
| enter/exit assembly ×3 | 1 canvas each, 0 new requests | same |
| rAF callbacks per 3 s idle in assembly | 180 | 181 |
Not measured: CPU/GPU/memory use. The idle frame rate is the scene's own attention pulses and spinning fans
(`frameloop="demand"` is already used and re-requests frames while those animate); nothing was changed or reduced there.

**Verification actually run on the final code.**
- `npx vitest run packages apps/web/components apps/web/lib/targets apps/web/lib/interaction` → 66 files, 852 tests passed, 0 skipped.
- `npx tsc --noEmit -p apps/web` → 0 errors. `npm run check:messages` → en/ar keys match.
- `npm run build` → compiled (Next 16.4.6 Turbopack); `apps/web/next-env.d.ts` reverted.
- Browser (Playwright + Chrome, production build on 127.0.0.1:3001, **software GL**, mouse clicks):
  `acceptance/cooling.mjs` (Freezer 36 on TUF Z790, planned gaming build) EN 1440 22/22, AR 1440 22/22, EN 430 22/22;
  `acceptance/aio.mjs` (Liquid Freezer III 280, practice build seeded from a version-3 save) EN 13/13, AR 13/13;
  Stage 3 regressions on the final build: `cpu-ram-click.mjs` EN 9/9, `m2.mjs` EN 31/31.
  They cover: scene hardware per step, one step per click, double click, wrong order never auto-corrected, reload mid-frame
  and mid-flow, undo, removal, camera unchanged, no page errors. The pixel comparison of the canvas is skipped (printed
  as SKIP, not counted) when the software-GL canvas cannot be captured.
- Defects found and fixed during verification: robot said "tap the highlighted place" when a cooler was selected
  (now names the cooler step); the scene looked for a cooler by `hardware` and so drew no body screws until the first screw;
  the cooler panel's script assumptions (several were my test's, not the page's).

**Not verified / limits.** Touch hardware, a physical device and the protected Vercel preview were not tested by me.
Arabic was checked for the air cooler and the AIO at desktop width; the 430 px run was English only and covered the air cooler only. Mid-air
radiator/fan scene states use the existing meshes (no new radiator-screw 3D markers beyond the existing fastener
markers). Positions of the frame screws, ring, pins and backplate are schematic (educational approximation, not the
manufacturers' drawings). AMD sockets are not modelled for these coolers. ~~ILM refit/frame removal exist in the
engine but no page control offers them.~~ (fixed in the review corrections below). Repeated enter/exit was counted for canvases and requests only; heap and GPU
memory across cycles were not measured. ~~The practice-build tile still says the liquid cooler goes "after the board is in
the case"~~ (fixed below). The full `npm test` run hangs in this environment on
the execution-runner tests (also on the base worktree); the targeted gate above is what was run.

### Stage 4 review corrections (Codex review of `5fe68ca`, 2026-11-23)

**1. CPU removal dead end after a contact-frame cooler came off.** The body's removal leaves the board's contact frame
tight over the CPU (the engine refuses `unmount_part` on the CPU while `frame === "placed"`), and no page control
offered the frame's screws, the frame itself or the original ILM, so the CPU could not be lifted from the UI. Fix:
- `cooler-assembly.ts`: `nextMountingRemoval(state)` / `applyMountingStep` / `mountingStepHistory`. Order: frame screws
  loosened across (each the opposite of the last, as the engine's `screwStep` requires), then taken out, then the frame
  off (`hw:motherboard:frame:`), then the original ILM back (`hw:motherboard:ilm:`). Each is one existing engine
  `set_hardware` action with the engine's own guards; nothing bypasses retention. Null while any cooler body is on the
  socket, so radiator/body removal stays separate and first.
- **Optional, never forced:** it is not part of `nextCoolerRemoval` and never the toolbar's next step. With the body
  off the cooler's own next step is still a refit on the tight frame (clean → paste …); the frame is reusable for
  either cooler. The page shows it as a secondary button under "Optional: the contact frame can stay for the next cooler…"
  in the cooler panel, and in the CPU panel ("The cooler's contact frame holds the CPU…") when the frame is on, or
  ("The original socket frame is off…") when only the ILM is still off.
- The CPU is never lifted for the learner: after the frame is off the CPU panel's existing "Lift out" appears (it is
  hidden while the frame is on); after the ILM is back the existing "Close plate" / lock lever retain it again.
- `click-assembly.ts` `nextHandStep`: with the ILM off on an LGA socket it no longer offers "close the plate" for a
  seated CPU (the engine always refused it); toolbar, scene click and robot share this.
- Same click-only step gate (`takeStep`), saved steps (undo pops them; reload replays them), no camera call, backplate
  support untouched (the engine still refuses removing it before the frame is tight).
- Spoken lines (en/ar): `companion.cooler.frameScrewLoosen|frameScrewOut|frameOff|cpuFree|ilmRefit|ilmBack`; panel
  text: `hands.mountingOptional|frameHoldsCpu|ilmOff`.
- Retention ring (Freezer 7 X): checked, no equivalent dead end. The ring and pins are the cooler's own hardware and
  the engine does not hold the CPU by them; with the body off the CPU's plate/lever open and the CPU lifts. Unchanged.

**2. `simplePc.partNotes.aio`** (en/ar) now reads "280 mm · block on the bench, radiator once the board is in the
case" / «280 مم · البلوك على الطاولة، والرادياتير بعد ما اللوحة تدخل الكيس», matching `simpleBlock` (owner decision 15).
README's cooling bullets were then corrected in the documentation closeout (below): no one-click swap; fitting and
removal are step by step; the AIO block may be prepared on the bench while the radiator waits for mounting in the case.

**Tests (`apps/web/components/pc/cooler.test.ts`).** New block "the contact frame after its cooler is off": frame blocks
CPU lift before; optional (cooler's next step still a refit); exact loosen-across/out/frame/ILM order and saved
strings; CPU stays until lifted and lifts only with the frame off; plate/lever close and retain after ILM refit; plate
refused and not offered by `nextHandStep` while ILM off; recovery from partial loosening and from frame-off/CPU-lifted;
undo step by step and JSON reload replay of the whole flow and of a half-dismantled frame; en/ar lines exist; ring
cooler has no dead end. Plus a part-note test. Watched failing first (missing functions; `nextHandStep` offering the
plate). Fixed a tautological assertion (`c.key !== "cpuFan" || true`) in "nothing about wiring changes": it now
compares the build's cables with the CPU-only build and checks no lead is connected.

**Verification actually run.** `npx vitest run` (whole suite, completed this time): first run 84 files, 1103 passed,
34 skipped (Java runner and PostgreSQL integration tests, environment-gated), 0 failed. After a final one-line type fix
in `SimplePcLab.tsx` the whole suite ran again: 1102 passed, 1 failed — `services/runner/src/runner.test.ts` "stops an
infinite loop at the time limit" (timing; untouched by this work), which then passed alone (26/26); `npx vitest run
apps/web/components packages` → 51 files, 602 passed. **Not run in that pass:** `tsc --noEmit` and
`scripts/check-messages.mjs` — both were blocked by this session's command-approval layer (run later in the separate
Codex pass below).
**Browser verification of the new controls is pending:** no browser automation was run in that session, and nothing
here claims live UI verification (panel layout, en/ar wording on screen, the scene drawing the frame/ILM states after
these steps).

**Final Codex review pass (separate, independent; run after the fixes above).** These results are additional to, and do
not replace, the results above (including the original 852-test targeted run and the timing-test failure history).
- `npx vitest run packages apps/web/components apps/web/lib/targets apps/web/lib/interaction` → 66 files, 864 tests
  passed, 0 failed, 0 skipped.
- `npm run type-check` → passed.
- `npm run check:messages` → passed.
- Production build with `SWC_NATIVE_BINDING_CACHE=/private/tmp/talal-review-swc` → passed.
- **No browser verification was performed by Codex.** Browser verification of the new contact-frame/ILM controls
  (panel layout, en/ar wording on screen, scene drawing of the frame/ILM states) remains pending; the earlier
  `acceptance/cooling.mjs` and `acceptance/aio.mjs` results predate these controls.
- **Updated acceptance scenario not browser-run by Codex.** `docs/handoff/2026-11-23/acceptance/cooling.mjs` gained a
  mounting-removal block (frame screws loosened, out, frame off, original ILM back: exactly 10 one-step clicks). Its
  `mount` locator was first matched by button label, which after the frame is off can match both the primary
  "Place contact frame" and the secondary "Refit original ILM" button (count 2, loop stops at 9). It is now scoped to
  the optional secondary button in the cooler panel (`[class*=partOptions] [class*=hands] button[class*=cancel]`); the
  assertions are unchanged. Codex did not run this script or any browser automation after the edit, so neither the
  scoped locator nor the 10-step result is verified.

**Documentation closeout.** `PROJECT_HANDOFF.md` updated with the Codex pass; `README.md` cooling bullets corrected
(no one-click swap; step-by-step fitting and removal; AIO block prepared on the bench, radiator mounted once the board is
in the case). No code, test or acceptance-script changes in this closeout.

## Latest work: Stage 3 — M.2 storage (branch `feat/stage3-m2-storage`, 2026-11-21)

Started from `feat/click-assembly-toolbar` at `2ecd636`. Not merged, not deployed to production.
Plan: `docs/superpowers/plans/2026-11-21-stage3-m2-storage.md`; roadmap for stages 3–11:
`docs/superpowers/plans/2026-11-21-assembly-stages-roadmap.md`.

**Behaviour.** The learner picks the drive, chooses an M.2 slot by clicking it (in the view or with
the slot buttons above it; no slot is suggested), then takes one documented step per click: loosen
the heatsink's screws, lift it off, fit the screw stand or turn the Q-Latch open, turn the drive if it
is reversed (refused, never corrected), tilt it up, insert it at an angle, press it flat, turn the
Q-Latch or screw it down, peel the pad film, refit the heatsink, tighten its screws. A bare slot skips
the heatsink. The drive counts as installed only when held down and its heatsink is back and screwed.
Removal is the reverse in the M.2 panel (heatsink off, latch open or screw out — the drive rises —
lift it out). The robot's line comes from the same next step (naming the slot), on every action and
after a reload. Double clicks take one step. Enter = next step, T = tilt. Old saves migrate in place.

**Hardware (verified from each board's own documents).**
| Board | Heatsinks | Retention | Source |
|---|---|---|---|
| TUF GAMING Z790-PLUS WIFI | over M.2_1; over M.2_3 + M.2_4 (2 screws each); M.2_2 bare | Q-Latch (pre-installed at 2280); M.2_4 short drives: screw stand + screw | E21279 p. 1-11, pp. 2-7 to 2-12; official top photo |
| TUF GAMING Z790-PLUS WIFI D4 | same, checked on its own photo | same | E20581 pp. 2-7 to 2-12; official top photo |
| PRIME B760M-A WIFI | over M.2_1 (2 screws); M.2_2 bare | screw stand + one screw (the entry no longer borrows the TUF Q-Latch) | E21693 pp. 1-2, 1-14 |
All three: pad film peeled before refitting; a screw package for M.2 is in the box. No M.2 slot-sharing
rule is documented in these manuals, so none is applied.

**Approximations.** Insertion angle 15–35° (manuals draw it without a number; the lab tilts to 25°).
Rubber pad (single/double-sided drives) is optional and not modelled. The M.2_4 short-drive screw stand
is catalog data only (the only M.2 drive offered, the 990 PRO 1TB, is 2280). Proportions are schematic.

**Verification of `9866a99` (local production build, Chrome with SwiftShader, 2026-11-21).**
These are the original results for the code at `9866a99`; they predate the review corrections below.
- `npm test`: 1015 passed, 0 failed, 34 skipped (no AI provider, no JDK, no `TEST_DATABASE_URL`; not counted).
- `npm run type-check`, `npm run check:messages`, `npm run build`: passed.
- `docs/handoff/2026-11-21/acceptance/m2.mjs`: EN 1440 31/31, AR 1440 31/31, EN 430 31/31 (slot clicked
  in the 3D view, double click, wrong turn refused, reload in hand and resting, undo, removal, camera
  unchanged, no page errors).
- `docs/handoff/2026-11-21/acceptance/cpu-ram-click.mjs` (CPU and RAM through the new toolbar): EN 9/9, AR 9/9.
- The Phase 2 scripts in `docs/handoff/2026-11-20/acceptance/` drive the old drag UI and stop early
  (close-up button and drag handle moved by the click-toolbar change). They fail identically on a build
  of the base `2ecd636`, so this is not a Stage 3 regression; they need rewriting for the click UI.
- Not verified: the Vercel preview of this branch (login required), physical touch devices.

**Review corrections after `9866a99` (2026-11-21).** Made after the verification above and committed
in the commit that follows `9866a99` on this branch; the browser results above do not cover them.
1. *One step at a time from every input.* A shared step gate (`createStepGate` in `click-assembly.ts`)
   now guards every hand step — view clicks, toolbar, panel buttons, Enter and T — not only the toolbar.
   Calls nested inside the same input count as one step. Selecting, turning/nudging and the camera are
   never held back.
2. *Clicking another M.2 slot moves the hand, it does not take a step.* All M.2 slots aim to the
   connector centre `[0, 0]`, so the old "same offset = same place" test treated a click on M.2_2 while
   over M.2_1 as the next step on M.2_1. `aimClick`/`sameAim` now compare the slot too: a click on another
   slot only moves the drive there (turn and tilt kept, build unchanged); a click on the slot it is over
   is the next step there. A move arms the gate so a double click on a slot is not also a step.
3. *Taking an installed M.2 out keeps it over its own slot.* `handLift` used the generic pickup pose for
   M.2 (180°, `[4, 0]`, no slot, no tilt), so the scene fell back to the plan's default slot and the drive
   jumped and reversed (e.g. out of M.2_3/M.2_4 it appeared at M.2_1). `m2LiftPose` now reads the source
   slot from the drive's attachment *before* removal and holds it over that same connector, at the
   installed turn (0°, the only one its key accepts) and the 25° insertion tilt. No other slot is chosen
   and nothing is turned for the learner. The pose is saved with the progress and restored on reload.
   CPU and RAM removal are unchanged.
4. *Guidance names the source slot.* After an M.2 removal the robot said "Out and back on the bench",
   which was wrong. New line `hands.m2Lifted` (EN/AR): "Out of {slot} and in your hand, still at its
   angle over that slot." After a reload, `resume.m2Over` names the same slot (tested for M.2_3/M.2_4).

Checks for these corrections (local, no browser), in order:
- Codex review pass on corrections 1–2: 91 focused tests and the type check passed.
- Claude pass on corrections 3–4: `npx vitest run apps/web/components/pc` — 23 files, 230 passed,
  0 failed, 0 skipped (includes the new M.2_3/M.2_4 removal and save/reload tests in
  `click-assembly.test.ts`, 32 tests). `npm run type-check` and `npm run check:messages` passed.
  The full `npm test` and `npm run build` were not run in that pass.
- Codex final check of the final code, after all removal fixes: `npm test` (run with escalated
  permission so the suite could start its local test server) — 80 files passed, 1031 tests passed,
  0 failed, 34 skipped (skipped tests are not counted as passes). Production build
  (`npm run build` with `SWC_NATIVE_BINDING_CACHE=/private/tmp/talal-review-swc`) passed. Earlier in
  the Codex review, `npm run type-check` and `npm run check:messages` also passed.
- **Not browser-tested.** No browser automation or visual check was used for these corrections, in any
  pass; the acceptance scripts above were not re-run. The removal pose in the 3D view, the new robot
  line and the step gate in a real browser still need checking.

**Next.** Owner review of these corrections and a browser check of them; then Stage 4 (cooling) per
the roadmap.

## Earlier: click-based assembly and top controls

The owner's latest instruction replaces mandatory part dragging with click/tap placement, and moves
assembly controls, guide switches and RGB above the 3D scene. Current work is on
`feat/click-assembly-toolbar`, based on `4096981` (the resume-message fix). The older status sections
below describe the earlier Phase 2 handoff; this section records the subsequent UI change.

- Select a keyed part, click its real mounting target (or a named RAM slot button), turn it if needed,
  and perform the validated next action. Aiming preserves rotation; each action still advances only
  one mechanical step. Occupied slots, closed mechanisms and incorrect orientation remain checked.
- Part dragging is no longer enabled on the single-PC page. Camera dragging remains available;
  camera drags do not count as part/target/mechanism clicks. Keyboard controls remain available.
- Undo, rotation, next action, slot choices and guide/RGB switches are above the scene. Detailed part
  and cable controls are in an above-scene disclosure, automatically open for preparation/cables;
  selection lists remain beside the scene. There is no duplicate action panel below the lists.
- Target selection no longer automatically focuses or restores the camera in the single-PC lab.
  Explicit Centre, Zoom and Close-up remain available. Materials and 3D assets were not changed.
- Final focused checks run by Codex: 57 tests passed across click assembly, tap discrimination,
  companion, RAM and hands; TypeScript and message parity passed; production build passed.
  The earlier implementation pass also ran the full suite (979 passed, 34 skipped), before the final
  disclosure/layout review corrections. Skipped tests are not counted as passes.
- Browser/visual acceptance of this UI change is pending: the supported computer-use tools were
  unavailable. Do not describe the new click flow or responsive layout as browser-verified yet.
- Keep existing saves and the old cloud conversation. Browser progress has not been exported.
  Do not merge to main, deploy production, or begin a new hardware phase without owner approval.

This file is the starting point for continuing the work in a local Claude Code session.
Read it together with `docs/DECISIONS.md`, `docs/REQUIREMENTS.md`, `docs/PC_GUIDE.md`,
`docs/PC_PLANNER.md` and `docs/CATALOG.md`. (`docs/HANDOFF.md` is older, from 2026-11-06.)

## 1. Project

A bilingual (English/Arabic) learning website ("Your Tech Lab"). It has a learning homepage, a
programming area, and a 3D PC assembly lab: plan a build, then assemble it in a 3D scene with a
guide robot. The current development track is **realistic, direct in-scene part handling**, done
in phases:

- Phase 1: CPU.
- Phase 2: RAM.
- Later phases, not started: the next part types.

**Repository:** `github.com/talal705/talal-claude`.

**Monorepo layout:**
- `apps/web`: Next.js 16 (Turbopack), next-intl, React Three Fiber.
- `packages/simulation`: PC engine, reducer, visual geometry generator.
- `packages/contracts`: types.
- `content/catalog`: parts catalog with sources.
- `assets/pc`: generated geometry and thumbnails.

**Hosting:** Vercel, existing project, free plan.

## 2. Standing requirements and decisions (summary)

The full list is in `docs/DECISIONS.md`.

**Owner instructions for this work:**
- Do not merge into `main` or deploy to production before the owner reviews.
- Do not force-push.
- Do not disable Vercel preview protection.
- Do not count skipped tests as passed.
- Do not claim local testing proves the deployed preview works.
- Do not purchase, upgrade plans or activate paid services.
- Do not create a separate website or use Netlify.
- Do not add payments.
- Built-in guidance must work without a paid AI provider. Optional AI integration stays server-side; no keys in the browser.
- Do not fabricate specifications. Hardware details come from the exact model's official manufacturer documents. Unverified details are marked as unverified.
- Never claim "everything is complete" while a part is incomplete or unverified.
- No automatic camera moves (decision 14). The robot never moves the camera.
- Motherboard-first assembly (decision 15).
- Keep old saves working.

**Phase-specific rules (CPU, RAM):**
- Interaction happens primarily in the 3D scene: pick up, turn, align, lower, seat, lock.
- Keyboard and panel buttons go through the same checked steps.
- No auto-orient, auto-install or snapping.
- A part that is only resting does not count as installed.
- Undo restores the exact held pose and target.
- The robot stays small, out of the way, and points at the exact feature.

## 3. Branches, commits, URLs

| What | Value |
|---|---|
| Production branch | `main` at `7354c3e` (CPU Phase 1 + fixes; merged and verified on 2026-11-20) |
| Production URL | https://talal-claude.vercel.app/ (PC lab at `/pc`) |
| Current work branch | `phase2-ram-direct` (RAM Phase 2; **awaiting owner review, not merged**) |
| Phase 2 commits | `f041ab1`, `cb7b442`, `335f102` (review fixes), then the handoff commit that adds this file |
| Branch preview | https://talal-claude-git-phase2-ram-direct-talal705.vercel.app/pc (Vercel login required) |
| Backup branch | `backup/2026-11-20-phase2-ram-handoff`, the same commit as the handoff commit |
| Other remote branches | `phase1-cpu-direct` (merged history), `preview/cpu-aio-280` (older preview) |

## 4. Status

### Phase 1: CPU (done, in production)

Implemented:
- Intel LGA load plate: lever, then plate.
- AMD ZIF lever.
- Pick-up, turn and drag in the scene.
- Triangle keying: 90°, 180° and 270° are rejected.
- Lower, seat, lock.
- The protective cover pops off.
- Removal.
- The cooler blocks the lever.
- Undo restores the exact pose.
- Robot lines.
- Reload restores the state.

Verified on production with the built-in browser on 2026-11-20. Logs are in `docs/handoff/2026-11-20/`.

### Phase 2: RAM (implemented, awaiting review)

Implemented:
- Real DIMM slots with keys, and modules with a real notch gap and end cut-outs.
- Clips operated in the scene, per board.
- A module is chosen by where it is held; no default slot.
- Checks: closed clips, reversed notch, misalignment (1.5 mm, educational), occupied slot, wrong generation (engine message names both generations).
- Resting is not installed. "Press home" closes the clips.
- Removal: open the clip(s), lift straight out.
- Saving: pose and slot, undo, reload.
- The manual's recommendation is shown separately and explained, not enforced.
- The robot is placed on screen, clear of features, and points only at visible targets.

Review fixes in `335f102`:
- **Slot identity:** heading, status, clip buttons, highlight, robot and close-up all use the actual slot.
- **Robot:** visible in the RAM close-up, including at 430 px width.
- **Clips:** verified from official documents (see section 6).

### What remains (not started)

- Owner review of Phase 2 on the preview.
- After approval: merge `phase2-ram-direct` into `main` through the normal workflow (no force-push), let Vercel deploy, verify production.
- Phase 3, defined by the owner later.

## 5. Known issues and limits

- **Vercel preview protection:** branch previews need a Vercel login. The automation browser is not logged in, so no preview has been verified by automation. Local production builds were used instead. This is stated wherever relevant.
- **Software rendering:** all browser tests ran in Chrome with swiftshader at about 1 frame per second. No real touch device was tested.
- **Tolerances:** the RAM tolerance of 1.5 mm and the collision limits are educational approximations, not physics.
- **Robot occlusion:** while a held module hides the target clip, the robot stops pointing on purpose.
- **Wrong-generation RAM:** the planner blocks it, so it is not reachable in the UI. It is tested at engine level only.
- **TUF GAMING B550-PLUS:** archived and not offered. Its DIMM clips are unverified.
- **H81M-K:** the manual gives no recommended population, so none is modelled.
- **AI tutor:** OpenAI is the selected provider (decision 19), but no key is configured and no live call has been made.
- **`apps/web/AGENTS.md`:** written by `next dev`. Do not commit it.
- **`apps/web/next-env.d.ts`:** a build may modify it. Revert it before committing.

## 6. Hardware references (RAM)

The moving-clip end is taken from ASUS's official top-view product photo of each exact board,
together with the manual drawing.

| Board | Clips | Manual pages | Recommended population |
|---|---|---|---|
| TUF GAMING Z790-PLUS WIFI | One moving clip at the top end; the bottom end is fixed | E21279: p. viii (Q-DIMM), p. 1-5, p. 2-6 | 1 module: A2. 2 modules: A2 + B2. 4 modules: all |
| TUF GAMING Z790-PLUS WIFI D4 | One moving clip at the top end | E20581: p. 1-5, p. 2-6 | 1 module: A2. 2 modules: A2 + B2. 4 modules: all |
| PRIME B760M-A WIFI | One moving clip at the top end | E21693: p. viii, p. 1-12, p. 1-13 | 1 module: A2. 2 modules: A2 + B2. 4 modules: all |
| H81M-K (DDR3, A1 and B1) | One clip at each end | E8601: pp. 1-7 to 1-9 | None given |

The source URLs are in the catalog entries (`content/catalog/motherboards.ts`, `expansion.ts`).
Evidence images: `docs/handoff/2026-11-20/evidence/7-hardware-evidence.png`.

## 7. Setup, run, test

Requires Node.js 22.12 or newer and npm (the repository's lockfile). PostgreSQL is only needed for
the database tests and features (decision 3).

```sh
git clone https://github.com/talal705/talal-claude.git && cd talal-claude
git checkout phase2-ram-direct
npm install
cp .env.example .env.local      # then fill in values locally (never commit)
npm run dev                     # development server
npm run build && npm run start  # production build and server
npm test                        # vitest (unit and integration)
npm run type-check
npm run check:messages          # English and Arabic message keys match
UPDATE_ASSETS=1 npx vitest run packages/simulation/src/pc/visual   # regenerate PC geometry and thumbnails after geometry changes
```

**Browser acceptance scripts** used in this phase are in `docs/handoff/2026-11-20/acceptance/`:
- `ram2.mjs`: RAM on the TUF board.
- `ram-h81.mjs`: the two-clip board.
- `ram-en.mjs`: English checks.
- `ram-narrow.mjs`: 430 px width.
- `cpu-direct.mjs`, `cpu-fixes.mjs`, `cpu-remove.mjs`: CPU regression.

They use Playwright with a local Chrome and take the base URL and locale as arguments, e.g.
`node docs/handoff/2026-11-20/acceptance/ram2.mjs http://127.0.0.1:3001 ar`. They expect a
production build served on that port. `build-local.sh` was specific to the cloud sandbox: it
stubbed Google Fonts, which were blocked there. On a normal machine use `npm run build` and
`npx next start -p 3001` in `apps/web`. Adjust the Chrome path (`/usr/bin/google-chrome`) in the
scripts if needed.

## 8. Environment variable names (no values)

**Database:**
- `DATABASE_URL`
- `TEST_DATABASE_URL`

**App:**
- `NEXT_PUBLIC_APP_URL`
- `SESSION_SECRET`
- `YTL_DEV_PAGES`

**Compiled-language runner:**
- `RUNNER_URL`
- `RUNNER_TOKEN`
- `RUNNER_JAVA_HOME`
- `RUNNER_DOTNET_ROOT`

**AI tutor (optional):**
- `AI_PROVIDER`
- `AI_API_KEY`
- `OPENAI_API_KEY`
- `AI_MODEL`
- `AI_BASE_URL`
- `AI_EFFORT`
- `AI_OPENAI_REASONING_EFFORT`
- `AI_MAX_OUTPUT_TOKENS`
- `AI_MAX_TOKENS_FIELD`
- `AI_RESPONSE_FORMAT`
- `AI_TIMEOUT_MS`
- `AI_REFUSAL_FALLBACK`

**Tooling:**
- `UPDATE_ASSETS`

See `.env.example` for comments. Which of these are set in the Vercel project was **not verified**
from this session.

## 9. Where user data lives

- **PC lab progress** is kept in the learner's browser `localStorage`, per site origin. It is not in Git and not in a database. Keys:
  - `ytl_pc_plan_v1`: the planned build and phase.
  - `ytl_pc_plan_progress_v1`: assembly history and held pose.
  - `ytl_simple_pc_view_v1`: view preferences.
  - `ytl_simple_pc_v1`: older practice build.
  - `ytl_pc_3d` and `ytl_pc_3d_quality`.
  - `ytl_locale` is a cookie.
- **Programming drafts** are also in `localStorage`: `ytl_learning_code_v1`, `ytl_local_challenges` and draft keys.
- **Older guest projects** are in IndexedDB.
- **PostgreSQL** (local, if set up) holds `users`, `projects`, `project_snapshots`, `lesson_progress` and `preferences`.
- **None of this moves with Git.** Browser data is tied to the exact site address: progress made on `talal-claude.vercel.app` will not appear on `localhost`. To carry it, copy those `localStorage` values in the browser's developer tools, then paste them on the new origin.
- This session cannot read the owner's browser or database, so no user data was exported.

## 10. Tests actually run for the final Phase 2 commit (`335f102`)

All on a local production build in Chrome with swiftshader, on 2026-11-20.

| Check | Result |
|---|---|
| Unit tests (vitest) | 897 passed, 0 failed, 94 skipped (not counted as passed) |
| TypeScript (`npm run type-check`) | Passed |
| Messages (`npm run check:messages`) | Passed |
| Production build | Passed |
| Browser, Arabic, TUF board | `ram2.mjs`: 40 of 40 |
| Browser, English, H81M-K | `ram-h81.mjs`: 14 of 14 |
| Browser, English quick check | `ram-en.mjs`: 4 of 4 |
| Browser, 430 px width | `ram-narrow.mjs`: 5 of 5 |
| Browser, CPU regression | `cpu-direct`: 14 of 14. `cpu-fixes`: 13 of 13. `cpu-remove`, including cooler blocking: 7 of 7 |

**Not verified:**
- The deployed branch preview (Vercel login required).
- Real touch devices.
- Vercel environment variables.

## 11. Exact next step (do not start without the owner)

1. Wait for the owner's review of Phase 2 on the preview.
2. If the owner approves, merge `phase2-ram-direct` into `main` through the normal workflow (no force-push).
3. Let Vercel deploy production.
4. Verify `/pc` on https://talal-claude.vercel.app/ for both RAM designs (single clip and two clips) and the CPU regression.
5. Report the URL, commit, results and screenshots.
6. Do not begin Phase 3 until the owner defines it.
