# Project handoff — Virtual Training Environment (VTE), 2026-11-20

Current site brand: **بيئة التدريب الافتراضية (VTE)** in Arabic and
**Virtual Training Environment (VTE)** in English. Older references below use the former name.
The repository and hosting identifiers remain `talal-claude`; saved-data keys are unchanged.

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

**Verification (local production build, Chrome with SwiftShader, 2026-11-21).**
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

**Next.** Owner/Codex review; then Stage 4 (cooling) per the roadmap.

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
