# Current handoff — 2026-11-06

## Current owner scope — decision 18 (2026-11-06)
The homepage now restores the name/introduction, guided/self-directed entry, programming, and global small tutor. Compact PC assembly remains the LAST section, unchanged in its one-PC/seven-part scope. This section supersedes historical scope below, including the programming removal and PC-only homepage.
- `components/learning/`: seven editable tracks, four example levels, actual run/output/HTML preview, separate local drafts, error explanations, explicit correction apply/undo and editor-line pointing through the robot.
- Original runtimes/contracts/execution service restored from `59461e0^`; no old browser projects deleted or silently migrated. Generated assets are local under public/runtime and ignored by Git.
- Start app with normal dev/build scripts (copy runtime assets automatically); `npm run runner` starts the loopback compiled-language service with sandbox REQUIRED and detects the existing Homebrew JDK25. The owner preview is on http://localhost:3001/; a separate older production build on3000 was left untouched.
- `/api/code/review`: bounded same-origin, signed-session/rate-limited, schema-validated provider review; code treated as data and never auto-applied/executed. Existing Anthropic/OpenAI-compatible provider seam reused. OpenAI is now selected (decision 19): official endpoint, GPT-6 Luna/low, strict JSON and store=false. A key is still missing, so no live provider call has been made; local error guidance clearly says so. OpenAI Developers was suggested for credential setup but connection is unconfirmed.
- Fresh verification results are recorded at the end of PROGRESS.md. Historical screenshots and prior QA numbers below are not proof of the restored page.


Owner decision 17 supersedes the older multi-kit/multi-mode PC UI targets below. The owner asked for a much simpler one-page site: one PC, a few parts, no electricity details, and a working/not-working result.

- `/` and `/pc` now show `SimplePcLab`: one case and seven installable parts, short category labels and thumbnails, one Fit button, one Start PC button, reset, and EN/AR. No catalog, duplicate additions, entry wizard, cables, manual power settings, long specification/diagnostic lists, or floating tutor in this flow.
- `simple-model.ts` uses the existing PC engine. Seating, fasteners, BIOS preparation, fitted case fans, required cables and power settings are automatic. The motherboard is prepared outside the case first. Success still requires the engine to reach `operational`.
- The centred, non-panning camera remains. `PcScene` has an opt-in compact rendering mode which hides cable ends, switches and screw controls.
- Compact progress is isolated in `localStorage[ytl_simple_pc_v1]`. Existing IndexedDB projects and snapshots were not changed or deleted. The detailed PC page can still be opened explicitly with `advanced=1`; retained networking and advanced code are not current development priorities.
- Fresh verification: 56/56 targeted unit tests (simple model, real PC startup and scene transforms); TypeScript and EN/AR message parity; browser acceptance for incomplete → not working, all seven parts → working, language switching, reload/restoration, and reset to a fresh 0/7 assembly. No provider API called.
- Source changes are uncommitted alongside the earlier camera/board-first work; original evidence-image changes were preserved. Current preview is `http://localhost:3001/`; port 3000 is the older production build.
- Continue only changes that preserve this compact scope. Outstanding premium geometry limitations are not claimed solved by simplifying the UI.

---

## Archived handoff — 2026-10-27

Read with `CLAUDE.md`, `docs/DECISIONS.md` (decisions 8–13 change the scope), `docs/REQUIREMENTS.md` (rows S1–S9) and the last section of `docs/PROGRESS.md`. The previous handoff of 2026-10-10 is in Git history.

## State

- Recoverable state before the scope change: Git tag `checkpoint-before-scope-change-2026-10-27` (commit `ca8e535`, including all work that was uncommitted).
- Labs that exist: PC (list view + 3D scene, engine, startup stages, lessons), network (engine, list view, playback, lessons), Code Studio (to be removed from the active product), tutor robot with hint ladder, configurable AI tutor (never called for real), guest storage in IndexedDB, PostgreSQL schema and repositories.
- Servers: none running at handoff except PostgreSQL. Build and start with `npm run build && npm run start` (lead only); the runner is no longer needed once Code Studio is removed.

## Team (four agents, decision 13)

| Agent | Role |
|---|---|
| lead | Manager and integrator; owns contracts, configs, scripts, docs; builds, runs servers, commits |
| `engineer` | Single writer for all code, content and assets |
| `critical-reviewer` | Read-only; reproduces defects with evidence |
| `preservation-reviewer` | Read-only; guards working behaviour, flags regressions and unnecessary changes |

## Work order

1. Trace Code Studio's shared dependencies, then remove it from the active product (S1) with legacy programming projects archived (S2).
2. Two-per-category catalog with Intel Core i5 and Core i7, DDR4 and DDR5 configurations, real rules only (S5); remove monitor and display-cable requirements everywhere at once (S6).
3. Disassembled workbench as the main PC entry; empty workbench kept; starters not auto-assembled (S3); every operation in 3D (S4).
4. Detailed 3D models for the reduced catalog (S7).
5. Interactive validation of both complete builds and the regression set (S8).
