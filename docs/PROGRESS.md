# Progress — Your Tech Lab

Status per requirement is in `docs/REQUIREMENTS.md`. This file says what is verified, what is open, and what comes next.

## Team (native Claude Code agent team)

Verified 2026-10-10 in the CLI session: `~/.claude/teams/session-f8064dbe/config.json` lists `team-lead`, `backend`, `frontend`, `interaction`. Teammates messaged each other directly (target IDs, `TutorRoot` mount, preferences API, storage import path) without going through the lead. After `/resume` teammates are not restored: check membership and respawn.

## Verified

Commands, all run by the lead on 2026-10-10:

- `npm run build` — passes; routes `/`, `/pc`, `/network`, `/code`, `/projects`.
- `npm run type-check` — passes.
- `npm test` — 8 files, 113 tests pass (guest store 26, database 16, registry and tutor logic 66, lab config 5).
- `npm run check:messages` — EN/AR keys match.
- `npm run check:browser` (Playwright 1.64.0, headless Chromium, production server) — 232 checks pass in EN and AR at 1280px and 375px. Screenshots in `docs/evidence/m2/`.

What that covers:

- PostgreSQL 18.6 installed with Homebrew and running as a service. Role `ytl_app` owns `yourtechlab` and `yourtechlab_test`; the pre-existing databases (`postgres`, `template0`, `template1`) were not changed. Migration `0001_initial.sql` applied to `yourtechlab`.
- Contracts v1 frozen: project record with revision and snapshots, preferences, tutor targets.
- Guest store on IndexedDB and an owner-scoped PostgreSQL project repository with the same revision-conflict behaviour.
- Lab routes with entry choices and modes kept in the URL, `/projects` with empty, list, damaged-record and delete states, settings dialog, localized not-found page.
- Target registry and the 2D robot tutor with a three-level hint ladder on the homepage; pointing stays on its target after scroll, resize and language switch; robot hideable with text help kept; reduced motion honoured. AI chat is shown as not configured.

## Open faults

See the latest update section at the end of this file.

## Not verified

- Robot frame rate (60 fps target) is not measured.
- Colour contrast is not measured; no screen-reader pass.
- `error.tsx`, `loading.tsx` and the storage-unavailable state were not exercised in the browser.
- The lab pages are shells: no PC, network or code workspace exists behind the modes.

## In progress

- `backend`: test-isolation fix, then the code-runner core with the C++ adapter (`services/runner/**`).
- `frontend`: title alignment, `global-error.tsx`, then the workstation scene and avatar choice (M2.10).
- `interaction`: placement fix.

## External dependencies

- Java and C# execution (M5.08, M5.09) need a JDK and the .NET SDK; neither is installed. C++ uses the Apple clang already present.
- Isolated execution suitable for public use needs a container or microVM runtime; Docker is not installed.
- The real AI tutor (M7.10) needs a provider and an API key chosen by the owner.
- The Claude in Chrome extension is not connected; browser checks use Playwright instead.

## Next tasks

1. Close the three open faults and re-run `npm run check:browser` with an added assertion that the robot covers no lab card or hero text.
2. Milestone 3: the lead assigns `packages/simulation/**` and revises `packages/contracts/src/pc.ts` against verified manufacturer data before any catalog entry is written.

## Session log

- 2026-10-10 — Desktop-app session, single agent: foundation and homepage, commit `7d3f93d`. No agent team.
- 2026-10-10 — CLI session with the native team: PostgreSQL, contracts v1, Milestone 2 shell, storage, registry and robot. Commits `9470928`, `c7bea24`, `d940f34`, `8ace41a`.

## Update after the usage limit reset (2026-10-10)

- `npm run check:browser`: 280 passed, 0 failed. The 8 earlier failures were false positives of the lead's assertion (it used the whole box of the hero text; on the screenshots the robot stood in empty space beside the text). The assertion now uses text lines for hero text and whole boxes for cards.
- `npm test`: 162 passed. Type-check clean (web + runner). Commit `fad23d5` plus this one.
- Closed faults: robot placement while pointing, `/projects` title alignment, database test collisions, runner test timing.
- Verified in the browser: workstation scene on `/code` (monitor link, five avatar choices, choice and skip survive reload, scene unmounted when skipped).
- Still open: idle robot floats over page content above the Help button (`interaction`); `global-error.tsx` never exercised; one placement unit test failed once in a full run (`interaction` investigating).
- In progress: `backend` execution API (`/api/execute`); `frontend` Code Studio workspace UI; `pcsim` PC contracts v1 (proposal committed, not frozen), then catalog and engine; `interaction` idle docking.
- Waiting on the owner: install a JDK and the .NET SDK (Java and C# runners), Docker or equivalent for public-grade isolation, AI provider and key.

## Update 2026-10-10, after the second usage-limit pause

Verified by the lead:

- Execution API through the production site (curl): multi-file C++ with stdin printed `49`; compile error returned main.cpp 2:26; another session 404; foreign Origin 403; Java `toolchain_not_installed`; runner stopped gives `runner_unavailable` with empty output.
- `npm run check:browser`: 328 passed (adds idle-robot and Help-button clearance checks on every route).
- `node scripts/browser-check-code.mjs`: 78 passed. Code Studio workspace with Monaco served from our own origin, autosave, reload recovery, files, snapshots, export/import. Screenshots in `docs/evidence/m5/`.
- Robot frame pacing measured: `docs/PERFORMANCE.md`.
- Contracts frozen: code execution v1, PC v1, shared file-name rule.

Not verified, committed as work in progress in `baafb7b`:

- `apps/web/lib/runtime/**` (browser adapters for JavaScript, TypeScript, HTML/CSS, Python). Nothing runs in the browser yet; Run in the workspace reports "nothing was executed".
- `packages/simulation/src/pc/**` and `content/catalog/**` (PC engine and catalog). Not reviewed; catalog sources not checked by the lead.
- Packet-journey playback controller (`interaction`).

Known failing or unstable tests (owner `backend`):

- `ts-check.test.ts > checks types across files and reports the error in the importing file` fails on every run.
- Pyodide and runner tests timed out on different tests in two runs; `npx vitest run services/runner apps/web/lib/runtime` took more than 5 minutes. Cause not established.

In progress: `backend` fixes those, then finishes the adapters; `frontend` editor markers, code-line targets, tutor wiring, 30 fps setting, dev harness page; `interaction` playback controller; `pcsim` catalog, engine, startup validator.

Tooling note: after `typescript-js` (TypeScript 6.0.3, the in-browser checker) was installed, `npx tsc` resolves to 6.0.3. `npm run type-check` calls the 7.0.2 compiler explicitly.

## Catalog sourcing ruling (lead, 2026-10-10)

`pcsim` reported how catalog pages were fetched: with curl, sending browser-style headers, because WebFetch was unavailable to it. No challenge page was solved. One request was retried with fuller browser headers after intel.com answered 403, and the Core i5-14600K entry rested on that second response.

- Ruling: retrying with different headers after a refusal is not acceptable and is not to be repeated. No further catalog fetching with curl; use WebFetch, or leave the entry out and list it for the owner.
- The Intel entry was re-checked by the lead through WebFetch on 2026-10-10 against the same Intel specifications URL: socket FCLGA1700, 14 cores, 20 threads, 125 W base, 181 W turbo, UHD Graphics 770, 192 GB, DDR5 5600 / DDR4 3200, package 45.0 x 37.5 mm — all match the entry. It stays.
- The other commercial entries (Corsair, Fractal, ASUS, AMD, Samsung, ARCTIC) were fetched once each with a browser User-Agent and not re-checked by the lead yet. They remain `partially_verified`; each needs a WebFetch re-check before it is counted as verified.
- No catalog entry has a visual asset, so none counts as a finished entry (0 of 180).
- Brands the brief names that could not be fetched: Kingston, be quiet!, Seasonic, Noctua, MSI and Gigabyte support lists, ASRock. Not attempted: HYTE, Lian Li specification table. The owner may need to supply specification sheets for these.

Network contract: `JourneyEvent` and `Journey` are frozen in `packages/contracts/src/network.ts`; the rest of that file is still a draft.

Lead re-checks through WebFetch on 2026-10-10 (same URLs as recorded in the entries):

| Entry | Values compared | Result |
|---|---|---|
| Intel Core i5-14600K | socket, cores/threads, base/turbo power, graphics, memory, package size | all match |
| Corsair 4000D Airflow | 453 x 230 x 466, GPU 360 mm, PSU 220 mm, cooler 170 mm | match (the page gives no unit for the case dimensions) |
| ASUS ROG Strix RTX 4090 OC | 357.6 x 149.3 x 70.1 mm, 3.5 slot, 1 x 16-pin, 1000 W | all match |
| Samsung 990 PRO 1TB | M.2 2280, PCIe Gen 4.0 x4 NVMe 2.0, 80 x 22 x 2.3 mm, MZ-V9P1T0BW | all match |
| ARCTIC Freezer 36 | height 159 mm, sockets | NOT confirmed: the fetched page text stopped before the technical data |

| Fractal North Charcoal Black | 447 x 215 x 469 mm, GPU 355, cooler 145, PSU 255, front radiators 120-360, top 120/240, SKU FD-C-NOR1C-01 | all match |
| ASUS TUF GAMING Z790-PLUS WIFI (spec page only) | LGA1700, Z790, 4 x DDR5, ATX 30.5 x 24.4 cm, four M.2 slots and their lengths, 4 SATA, 2 x 8-pin CPU power, 4 chassis fan, 3 ARGB + 1 RGB, HDMI + DisplayPort | all match. The page states the maximum memory as both 192 GB and 128 GB; the entry uses 128 GB |
| Corsair RM850x (CP-9020270-NA) | 850 W, Cybenetics Gold, ATX 3.1, fully modular, 160 x 150 x 86, Type 4 cables | all match |
| Corsair Vengeance RGB DDR5-6000 2x16 | DDR5, 2 x 16 GB, 6000 MT/s, addressable lighting, Intel XMP | match, except the entry says XMP 3.0 and the page text I got says only "Intel XMP" |

Not yet re-checked: both ASUS manuals and support lists, the B550 board, AMD Ryzen 5 5600, Corsair DDR4 kit, ASUS Dual RTX 4060, ASUS TUF RTX 4070 Ti SUPER, Corsair RM850x SHIFT and CX550 and the cable-compatibility page, Samsung 870 EVO, ARCTIC fans, Freezer 36 and Liquid Freezer III.

## Update 2026-10-11

- Owner approved installing the toolchains. Installed with Homebrew: `openjdk@25` 25.0.4.1 (keg-only, at `/opt/homebrew/opt/openjdk@25`; `javac -version` and `java -version` run from that path) and `dotnet` 10.0.401 (`dotnet --version` runs, on PATH). No administrator password was needed; the system Java symlink that Homebrew suggests (it needs sudo) was not made. `RUNNER_JAVA_HOME` and `RUNNER_DOTNET_ROOT` are in `.env.local` and `.env.example`.
- Consequence: 2 runner tests now fail because they assert that Java and C# are not installed (`http.test.ts > GET /health reports which toolchains are available`, `runner.test.ts > reports Java and C# as not installed…`). The Java and C# adapters themselves are not written yet. Owner: `backend`.
- Cause of the very long test runs: established. `pmset -g log` shows the machine in maintenance sleep on battery in blocks of about 965–974 s on 2026-10-11 between 18:00 and 19:15, which matches the stuck test durations (about 960 s) and the 483 s and 1056 s suite runs. With the machine awake the same suite takes 16.5 s. A compile and first launch of a C++ program outside the suite take 0.26 s and 0.25 s. The earlier guess about security assessment of new binaries was wrong. Test results from runs that overlapped a sleep period are not evidence of a fault.
- PC engine complete for Milestone 3 logic (73 tests); PC lab view in progress (`frontend`); network engine in progress (`interaction`, no tests yet); browser adapters written but not connected or seen in a browser (`backend`).

## Update 2026-10-12

- Owner's instructions on resuming: fix the entry flow first ("I know what I want to do" must show the next step and lead into a usable lab); the final product must include interactive 3D PC assembly and a real AI tutor through a configurable provider.
- Entry flow reproduced by the lead on the production build: on /pc and /network the click only sets `?start=direct`; the only feedback is a status line below the fold telling the learner to "pick a mode above"; scroll and focus do not move; /network has no workspace behind any choice. Assigned to `frontend` as first priority, followed by the network lab view.
- Real execution verified in the browser: `npm run check:browser:run` 34 passed, 2 failed. Passing: JavaScript, TypeScript (with real type checking), Python (Pyodide, stdin), C++ (runner), HTML/CSS preview; type error, runtime error and compile error reported with file and line; Stop on an infinite loop; output limit; a learner program cannot call the platform API or read its storage or cookies; no request left our origin.
- Failing (both languages): the tutor does not mark the code line for a type error. The hint topic and its three levels are right, but "Show me where" answers that the line is off screen and no marker appears. Owners: `frontend` (line target and reveal) with `interaction`.
- `/dev/runtime` answered 200 on the production server without `YTL_DEV_PAGES`; it should be 404. Open with `frontend`.
- An `AGENTS.md` file appeared in the repository root, a copy of `CLAUDE.md`, not created by this session or its teammates as far as the lead can tell. Left untracked and untouched.
- In progress: AI tutor provider adapter (`backend`), PC engine text rewrite and visual assets with geometry for the 3D scene (`pcsim`), tutor topics for the network lab and accessibility review (`interaction`).

## State when the session hit its usage limit (2026-10-12)

Verified by the lead on a fresh production build:

- Entry flow fixed for /pc and /code: "I know what I want to do" selects Free Lab, moves focus and scroll to the start panel marked "Step 2 of 2" with its cue, and one more press opens the workspace. Checked with the keyboard in English at 1280 and Arabic at 375; screenshots in `docs/evidence/entry/`.
- /network: the same click lands on a panel that says the workspace is still being built. Still a dead end until the network view exists (`frontend`, in progress).
- All seven code tracks execute through the workspace: `npm run check:browser:run` 42 of 44. Java and C# verified. The 2 failures are the tutor not marking the code line for a type error (`frontend` with `interaction`).
- `npm run check:browser:code` 78/78 and `npm run check:browser:pc` 76/76 on the new build.
- `npm run check:browser` 324 of 328: the 4 failures are "mode choice reflected in URL and state", which reads a status region the entry fix removed. The lead's script needs updating; not a known product fault.

Not verified:

- PC engine text rewrite (reasons that state the cause, conversational Arabic) — `pcsim` reports 148 tests green; not re-run or seen on screen by the lead.
- New PC list-view controls, ready builds, PC export/import (`frontend`) — type-checked only.
- AI tutor adapter (`backend`) — being written; `@anthropic-ai/sdk` 0.131.0 installed and pinned. No API key exists yet, so no real call has been made.
- `/dev/runtime` answering 200 in production without its flag — cause not found.

Waiting on the owner: an API key for the AI tutor and the choice of model (cost); a look at two example part drawings and the licence line for generated assets.

Servers left running: web on port 3000 (production build), runner on port 4000, PostgreSQL. Check with `lsof -nP -iTCP -sTCP:LISTEN` before starting any.

### Later on 2026-10-12

- Checks on a fresh production build: `check:browser` 332/332 (script updated for the new entry flow), `check:browser:code` 78/78, `check:browser:pc` 76/76; `npm test` 684 passed, 1 skipped (the opt-in real AI call, which needs a key); type-check clean.
- PC rejection reasons now state the cause and the Arabic is conversational; seen on screen by the lead.
- `/dev/runtime` in production without the flag: the response body is the localized not-found page and the harness is not installed (`window.__ytlRuntime` undefined); only the HTTP status is 200, because the page streams behind the loading boundary. Not an exposure; a correct 404 status is a minor open item for `frontend`.
- The lead made a one-token type fix in `apps/web/lib/server/tutor/tutor.test.ts` to unblock the build while its owner was unavailable; recorded in `CLAUDE.md`.
- AI tutor: server adapter (`apps/web/lib/server/tutor/`, fake-provider tests pass) and the browser seam (`apps/web/lib/interaction/ai-advisor.ts`, 20 tests) exist but were designed separately: the server exposes `POST /api/tutor/hints`, the browser side expects `POST /api/tutor/ask`. They are not connected, nothing in the UI calls the server, and no real provider call has been made (no key). Lead decision pending delivery to both owners: see next tasks.
- Accessibility review by `interaction` (markup reading and contrast arithmetic only): faults listed in the requirements matrix under M2.11, sent to `frontend`.

Next tasks, in order: (1) `backend` and `interaction` agree one tutor route and connect it; (2) `frontend` network lab view, then the accessibility faults and code-line pointing; (3) `pcsim` geometry schema, generator, two example drawings for the owner; (4) the 3D PC scene on that geometry; (5) lessons and checked challenges for Learn and Test Yourself in all three labs.

## Update 2026-10-13

Verified by the lead on fresh production builds:

- `check:browser` 332/332, `check:browser:code` 78/78, `check:browser:pc` 100/100, `check:browser:network` 60/60, `check:browser:run` 44/44 (the tutor now marks the reported code line, asserted against the editor's own line rectangle). `npm test`: 765 passed, 1 failed, 1 skipped — the failure is the catalog count test, mid-change while `pcsim` generates more assets.
- Network lab: /network now leads into a workspace. Ready home network, ping and DNS lookup, journey stepping, a disconnected-link fault explained, tutor pointing, undo, reload recovery. Not exercised in the browser: settings forms, the plug exercise, cable wiremap, the other six faults.
- 3D PC scene: renders for the first time. Faults sent to `frontend`: too dark to read, unfinished parts look solid, raycaster console errors.
- AI tutor, first end-to-end exchange (fake provider only): works for a plain question; two faults sent to `interaction` (no hints sent as evidence; a failed question removes the ask field). Timeout and rate-limit paths not reached yet.
- Two part drawings generated by `pcsim` (Z790 board, RTX 4070 Ti SUPER), rendered to docs/evidence/assets/ for the owner to judge.
- Lesson runner, checkers and progress storage exist with tests; there is still no lesson content and no lesson panel, so Learn and Test Yourself still open the free workspace.

Waiting on the owner:

1. AI tutor: an API key and the model (default is the most capable and most expensive; a cheaper one can be set).
2. Whether the two part drawings are detailed enough to count as finished educational visuals, and the licence line for generated assets.
3. Accounts (proposal by `backend`, nothing built): username or email as the account name; scrypt or argon2id; recovery codes for forgotten passwords without email; registration open by default or not; session length; whether accounts may ship before lesson progress can be re-checked on the server.

Servers: web on 3000 (normal configuration, AI not configured), runner on 4000, PostgreSQL. For the AI check the web server is started instead with `AI_PROVIDER=fake YTL_DEV_PAGES=1 AI_TIMEOUT_MS=2000`.

## Update 2026-10-14 (resume point)

How to resume safely after an interruption:

1. `lsof -nP -iTCP -sTCP:LISTEN | grep -E ":(3000|4000|5432) "` — reuse running servers; never start a second web server. Web: `npm run start` after `npm run build` (lead only). Runner: `set -a; . ./.env.local; set +a; RUNNER_PORT=4000 npm run runner`.
2. Team: `ListAgents` and `~/.claude/teams/session-f8064dbe/config.json`. Teammates stop at their session limits and do not continue by themselves: read their last message, then send each the next task.
3. `git status --short` (ignore `AGENTS.md`, which this session did not create), `npm run type-check`, `npm test`. Test or build results taken while the machine slept are not evidence: check `pmset -g log | grep -E "Sleep|Wake" | tail` if a run took minutes. The lead now runs `caffeinate -is` in the background while working.
4. Browser checks against the production server: `check:browser` 332, `check:browser:code` 78, `check:browser:run` 44, `check:browser:pc` 100, `check:browser:network` 60, and `check:browser:tutor-ai` 20 (server restarted with `AI_PROVIDER=fake YTL_DEV_PAGES=1 AI_TIMEOUT_MS=2000`, then restarted normally).

State: `npm test` 779 passed, 1 skipped (awake). All 26 catalog entries have generated geometry and thumbnails. README.md written by `backend`. AI tutor setup and provider options: `docs/AI_TUTOR_SETUP.md`.

Open work, by owner:

- `frontend`: lesson panel for the three labs (Learn and Test Yourself still open the free workspace); cables in the 3D scene. Lead still owes the interaction check of the 3D scene using `window.__ytlScene`.
- `interaction`: network and code lessons, challenges and fault exercises (PC ones written, not seen by the lead); docs/CURRICULUM.md; `revealedLevels` in AI questions.
- `backend`: server re-validation of lesson attempts; accounts wait for the owner's decisions.
- `pcsim`: readable thumbnails for cases, power supplies and the SATA drive; rear-panel ports; catalog expansion (22 of 180).
- Not started by anyone: varied router models and cutaway view; Fault Detective, Inside View, Create a Challenge, Visible Coding, goal-based builds, the integrated mission; the frontend/API/backend/database course; baseline check; the final acceptance review.

## Update 2026-10-15

- Browser checks on the latest build: `check:browser:lesson` 33/33 (PC lesson completed end to end, hints through the tutor), `check:browser:lessons-labs` 20/20 (network and code lessons: list, start, not-yet with rubric, first hint through the tutor, Test Yourself lock, EN and AR), `check:browser:scene` 44 of 47 (only fault: clicking a loose cable end in 3D no longer offers the ports; it did in the previous build). `npm test` 876 passed, 1 skipped.
- Curriculum: 12 Beginner items (PC, network, JavaScript, Python) with checkers on real engines and runtimes; baseline check written, not yet rendered; docs/CURRICULUM.md has honest counts.
- Catalog: 22 entries, all with generated visuals (author's judgement, pending the owner); back panels drawn; catalog version 2026.10.15-1; expansion batch 1 starting.
- AI tutor: two providers (Anthropic, OpenAI-compatible), configurable; never called for real.
- Still not started: website-works track lessons (waiting on `backend`'s broker), Fault Detective / Inside View / Create a Challenge / Visible Coding / goal-based builds / integrated mission, varied router models, accounts (owner decisions), final acceptance review.

## Note 2026-10-15 evening

- The machine keeps entering maintenance sleep (log at 21:15) even with `caffeinate -is` running; `-s` only holds while on AC power, and a closed lid sleeps regardless. Work by the team pauses during sleep and long test runs then look like hangs. Keeping the Mac on the charger with the lid open avoids this.
- Verified: `check:browser:scene` 47/47, `check:browser:lessons-labs` 24/24 (now including the optional starting check). Commit `155130b`.
- Assigned: `frontend` section 15 (Create a Challenge, Fault Detective, history compare), plan first.

## 2026-10-27 — Scope change and new team (owner decisions 8–13)

Resume state found by the lead:

- The previous Claude Code process had exited: none of the four earlier teammates (`frontend`, `interaction`, `backend`, `pcsim`) was reachable, and no web or runner server was running; PostgreSQL was running. The current team is `session-e4ab45c4`.
- Uncommitted work at that moment (Create a Challenge: `apps/web/components/challenge/local-challenges.ts`, `apps/web/components/lesson/lesson-catalog.ts`) type-checked and was committed as `ca8e535`, tagged `checkpoint-before-scope-change-2026-10-27`. That tag is the full recoverable state before the scope change. `AGENTS.md` (not created by this team) stays untracked and untouched.
- Last handoffs from the retired teammates, as reported before they stopped: `frontend` was building Create a Challenge (plan approved: challenge from a working build, Fault Detective, history compare); `interaction` was starting lessons for the other programming tracks (now out of scope); `backend` was starting the websites-track broker (now out of scope) and had added `ProjectStore.getSnapshot`; `pcsim` was starting catalog expansion batch 1 (now replaced by the two-per-category catalog).

Last verified evidence before the change (all against production builds): `check:browser` 332, `check:browser:pc` 100, `check:browser:network` 60, `check:browser:scene` 47, `check:browser:lesson` 33, `check:browser:lessons-labs` 24, `check:browser:tutor-ai` 20 (fake provider), `npm test` 881 passed. The code-related checks (`check:browser:code`, `check:browser:run`) become historical with decision 8.

What changes (see `docs/DECISIONS.md` 8–13 and requirement rows S1–S9):

1. Code Studio leaves the active product; programming projects in browsers are archived, not deleted or shown as corrupt.
2. PC assembly from a fully disassembled workbench is the main experience; every operation in 3D, list as the accessible alternative; empty workbench kept; starter configurations not auto-assembled.
3. Catalog of exactly two per main category: Intel Core i5 and Core i7 on suitable boards, one DDR4 and one DDR5 configuration, real rules only, compatible mixes allowed.
4. No monitor or display cable in the PC lab; startup succeeds without them.
5. Detailed 3D models for the smaller catalog; limitations stated.
6. Team of four: lead, `critical-reviewer`, `preservation-reviewer` (read-only), `engineer` (single writer).

Waiting on the owner (unchanged): AI provider, model and key (`docs/AI_TUTOR_SETUP.md`); licence line for generated assets; the account decisions.

### Baseline before the scope change (preservation-reviewer, commit `72bb1df`, 2026-10-27)

- `npm test` 881 passed, 1 skipped; type-check and message parity pass.
- `check:browser` 332/332, `check:browser:network` 60/60, `check:browser:scene` 47/47, `check:browser:lessons-labs` 24/24.
- `check:browser:pc` 92 of 100: two checks fail in all four locale/width runs, both outdated checks rather than product faults — the Corsair 4000D entry now has a drawing, so "no picture" is no longer shown; and the tutor's "Show me where" target is off screen in that script's flow (the tutor correctly says so). Both flows change with S3/S5/S7.
- `check:browser:tutor-ai` was skipped (server not started with the fake provider); the lead runs it per step.
- Any failure beyond those expected from decisions 8–13 counts as a regression: network, lessons-labs, tutor ladder/pointing/hide/reduced motion, /projects and guest storage, locale switch keeping state, PC engine unit tests other than catalog and monitor cases.

## Status on 2026-10-30 (after reconciling the matrix with decisions 8–13)

### Implemented and verified
- S1 Code Studio removed; S2 legacy programming projects archived (both reviewers).
- S5 two-per-category catalog with Core i5-14600K / Core i7-14700K, DDR5 and DDR4 Z790 boards, checked against manufacturer pages; only real rules decide; a too-tall cooler (Freezer 36 in the North) is refused at placement as an impossible fit (critical-reviewer).
- S6 monitor-free startup: both starters reach "Operating system running" without a monitor; no-graphics still fails at stage 3; pre-change saved builds with a monitor open (both reviewers).
- S9 four-agent team.
- Network lab (60/60), network lessons (12/12), tutor and pointing ("Show me where" fixed and confirmed 2026-10-29), guest storage, language switching: no regressions through S1–S3 (preservation-reviewer).

### Implemented, not yet verified
- S3 disassembled workbench entry (commit `268c06b`): preservation review done (no regressions); the critical reviewer's assembly probe was cut off by its session limit and is owed.
- Green check / red X stage rows with progressive hints (part of S6/S3): built, not reviewed.
- The home robot overlap fix at en 375→414 (engineer, uncommitted): its new placement test fails in the working tree ("old 16 px gap" assertion), so it is not deliverable yet.

### Unfinished
- S4 every operation in the 3D scene (engineer, in progress: `part-controls.tsx`, `SceneActions.tsx` uncommitted).
- S7 detailed 3D models (not started; current drawings and geometry are generated schematic models; parts look small at the default bench camera).
- S8 end-to-end acceptance from the disassembled start (needs S4; the lead rewrites `browser-check-pc`, `browser-check-scene` and `browser-check-lesson` for the bench flow, selecting the empty workbench explicitly where needed).
- Tutor server cleanup of the code lab, then removal of `packages/contracts/src/code.ts`.
- Networking: varied router models and cutaway (M4.02), plug exercise and settings forms not browser-checked (M4.03, M4.04), fault challenges offered as challenges (M4.08), drawn map (M4.07).
- Curriculum beyond Beginner; docs/CURRICULUM.md counts out of date.
- Section 15: Create a Challenge (started), Fault Detective (planned), history compare, Inside View, goal-based builds, integrated mission.
- Accessibility pass with a screen reader; performance measurement of the full workspace; README rewrite.

### Blocked on the owner (labs are not blocked by these)
- A real AI provider call: provider, model and key (`docs/AI_TUTOR_SETUP.md`); the tutor works with built-in hints meanwhile.
- Accounts: the five decisions in the accounts proposal; guest storage works meanwhile.
- Licence line for the generated part drawings and geometry.

### Next concrete action
The engineer fixes the failing placement test and finishes S4; the critical reviewer completes the S3 assembly probe; the lead rewrites the PC, scene and lesson browser checks for the bench flow and runs S8 when S4 lands.

### Lead ruling 2026-10-30: the PC fault exercise

The critical reviewer noted that the fault exercise "Find the fault: power, but the self-test stops" starts from the finished Starter B. Decision 9 says the two starter configurations are not assembled automatically. Ruling: a fault exercise needs a computer that is already built, so it stays pre-assembled, but it must not be one of the two starter configurations. It uses a genuinely compatible cross-kit build (for example the Core i5-14600K on the DDR5 board with the DDR5 kit), presented as "a computer brought in for repair". This also shows that compatible mixes work (decision 10). If the owner prefers that the learner first builds the computer and then gets the fault, that is a small change.

### 2026-10-30, S4 review (preservation-reviewer, build `f0e9938`)
- Home robot overlap at en 375→414: fixed and confirmed, `check:browser` 284/284. Closed.
- S4: no regressions in networking, the tutor, storage, language switching or the list path (`npm test` 666 passed; network 60/60; lessons-labs 12/12; pc 92/92). BuildView's controls moved into the shared `part-controls.tsx` with unchanged behaviour.
- Open, with the engineer: picking a second part (or a loose cable end) in the 3D view scrolls the page away from it (12 scene-check failures, all with that signature); the SATA "Show me where" in 3D; duplicate accessible names (power button, side panel, cable ends).

## Status on 2026-10-31

### Verified today (lead, build `407a74f`)
- S8, list path: new `npm run check:browser:build` (scripts/browser-check-build.mjs) 42/42. Both kits built from the workbench through the list's own controls in EN@1280, AR@1280 and AR@375, with the steps taken from the kit solutions in `content/catalog` (loaded with jiti, pinned 2.7.0). A held-back CPU power cable gives "Power, but no startup check (POST)" with one red X; once it is plugged in, "Working" with five passed stages and no monitor. The saved build equals the engine replay of the kit's finished build, and it survives a reload. The engineer added the `data-candidate`, `data-target` and `data-cable` attributes the script uses.
- Scene: the S4 "scroll-away" failures were an artefact of the scene script. "Fit all" sits under the tall canvas, and Playwright centres the button, which pushes the canvas off the page. A probe showed the 3D clicks themselves do not move the page (scrollY constant). With the script fixed, scene passes 47/47. The engineer's defensive page hold is therefore unneeded and was removed (working tree, to be confirmed by the next scene run).
- Engineer fixes 2–6 committed in `407a74f`, with unit tests: a hidden 3D target hands "Show me where" to its list row; distinct accessible names; the fault exercise starts from a cross-kit "brought in for repair" build (i5 on the DDR5 board, Freezer 36, RTX 4060, RM850x); the case's factory fans are parts; bench contrast. pc 92/92 (script updated for the factory fans), shell 284/284, network 60/60, lessons-labs 12/12, npm test 674 passed / 1 skipped.
- Preservation review of S7 first pass and the README (`f0e9938..5e053ea`, `c66a52f`): no regressions, no unneeded changes. Its three small findings in lead files are fixed (`.env.example` provider line, CLAUDE.md runner line, README check list).
- CURRICULUM.md reconciled: 6 published items in two labs.

### Open
- critical-reviewer: S4 3D-only build of Starter B; browser re-check of fixes 2, 3, 5 and 6; visual judgement of S7.
- preservation-reviewer: regression review of `c66a52f..407a74f`.
- Lead: S8 3D path (script that builds a kit using only the 3D probe and the 3D panel); rewrite `browser-check-lesson.mjs` for the 8-step workbench lesson and the new fault start; tutor server code-lab cleanup, then remove `packages/contracts/src/code.ts`.
- Then networking (router models, plug exercise, fault challenges, map), curriculum beyond Beginner, section 15 features, accessibility pass.

### Owner-blocked (labs are not blocked)
AI provider, model and key (setup in docs/AI_TUTOR_SETUP.md, key goes only into `.env.local`); accounts; asset licence line; the owner's opinion of the drawings.

### Next concrete action
When the teammates' limit resets (22:20 Riyadh): confirm the scene check without the page hold, commit; collect the two reviewer reports; the lead writes the lesson check and the S8 3D path.

### 2026-11-03 (lead, overnight)
- `scripts/browser-check-lesson.mjs` rewritten for the workbench lesson: 33/33 (EN@1280, AR@1280, AR@375). All 8 steps of `pc.beginner.first-build` are done in the lab through the list controls (worked example loaded from `content/lessons/examples.ts`), checked and continued; summary with one next step, hints recorded without a score, completed after reload; Test Yourself withholds the last hint until an attempt; the fault exercise opens on the cross-kit repair build (i5-14600K, Z790 DDR5 board, DDR5 kit, Freezer 36). The list-control driver is shared in `scripts/lib/pc-list-steps.mjs`.
- `npm run check:browser:build` reruns overnight were unreliable: clicks and even a `page.screenshot` time out at random steps (different steps each run, both kits, with and without the 3D view), while the page's main thread is idle (CDP: about 4 s of task time over 21 steps; heap 12–50 MB; event listeners are collected). The machine was on battery with the display asleep. The same check passed 42/42 on `407a74f` on 2026-10-31 with the display on. Correction 2026-11-05: a later full run stalled again on a fresh server. The power log (`pmset -g log`) shows the machine entering sleep repeatedly during the runs ("Maintenance Sleep", woken by opening the lid) despite `caffeinate -is`; a closed lid on battery sleeps the machine regardless. The stalls are environment, not product code. Browser checks are only conclusive with the lid open and the machine awake; the passing runs (42/42 on 2026-10-31 and 2026-11-04) were taken that way.
- Page hold removed (`76e5caf`), scene 47/47 without it.

### 2026-11-03, preservation review of `c66a52f..fe556c7`
One regression, from fix 5 (factory case fans as parts); everything else is preserved, and nothing changed beyond what the six fixes need.
- Exported build files made before the change are refused on import with `step_refused` ("That part, cable or position is not in this build"), because their log connects `case-1.fan-1` / `case-1.fan-2`. Reproduced on the real export `docs/evidence/m3/build-export-en-1280.json`; the same file imported at `95bfe59`.
- Stored old projects open (the two leads are dropped; startup stays operational, all five stages passed), but the catalog-drift replay shows the drift panel with the same generic refusal on every complete old build, which misleads the learner.
- The fix-5 unit test checks parsing only. Engineer task (first after the limit reset): migrate old logs (drop or rewrite the `case-1.fan-*` steps) for both import and the drift replay, with tests on the real old export.

### 2026-11-04, critical-reviewer S4 report (product code `76e5caf`; screenshots docs/evidence/s4/)
Starter B built with only the 3D view and its "Work on the selection" panel, EN and AR at 1280: 41 of 65 steps work in 3D (the same steps in both languages); the rest were finished in the list, and the build ends "Working" with five green checks. The list stayed in sync after every 3D action.
- Works in 3D: BIOS through the panel; picking every part and clicking its place marker; seating; 16 of 20 cable ends; the case power button.
- Does not work in 3D:
  1. Fasteners, 0 of 8 parts. Clicking a visible fastener marker selects the case instead, and the part's markers then disappear. The board draws 7 markers for 9 screws, and two markers float outside the case.
  2. The AIO radiator: once the pump block is mounted, the cooler cannot be picked again.
  3. Cable ends with no hit area: AIO pump-fan and ARGB, a mounted fan's lead, and the factory fan's lead.
  4. Tidy routing is reached only by selecting the cable's part; the AIO, the case and the factory fans cannot be selected in 3D (10 cables).
  5. Hotspots: the side-panel hotspot selects the rear fan; the mains socket and PSU rocker select the case or PSU instead of switching.
- Fix 2 passes. Fix 6 passes by eye (the white cable-end dots are low contrast on the light bench).
- Fix 3 is partial. Duplicate names remain: 5× each of the lighting controls, 23× "Routed tidily", and the two RAM kits' and two factory fans' Place, Remove, Take out, Pull back and Loosen buttons.
- Fix 5: passes in the list; in 3D the factory fans and their leads have no hit area.
- S7 judgement: the GPU, board, radiator and PSU grille are readable. The case, pump block, PSU body and NVMe are still box-like, and the North's wooden front is not shown. At 1280 in Fit all the CPU is 21×15 px, the NVMe 35×16 and the RAM 55×27; at 375 the CPU is 10×7. All are below the 24×24 target size. Cable ends are bare dots with no plug type.

### 2026-11-05, team change
The engineer used three usage windows in a row without producing a change: its context, several days long, was being reloaded on every resume. The lead stopped it and started a fresh `engineer` with a short brief (the seven S4 gaps, in order). The team is still exactly four agents in the same roles (decision 13); all earlier work is in Git.


### 2026-11-06, owner-requested camera and assembly change (Codex)
The owner directly requested implementation of decisions 14–15 in Codex. Scoped implementation ownership for this change: PcScene.tsx, use-geometry.ts, Scene3D.tsx, EN/AR labs messages, catalog/presets.ts, lessons/pc/build.ts and reducer.test.ts; no other engineer files changed. No tracked source modifications were present before this edit. Existing evidence image modifications are untouched. Selection auto-framing is removed; initial framing waits for loaded geometry; the 9-step lesson prepares the board on the bench before case installation. Verification is in progress; this does not close the outstanding S4/S7 work.

Verification for decisions 14–15: 93/93 targeted tests passed (PC reducer, startup, curriculum lesson runner, scene transforms and camera-fit arithmetic); type-check and EN/AR message parity passed. In the browser on the updated local preview (port 3001), prepared Starter B CPU, A2/B2 memory, M.2 and pump block with the board still on the bench, then seated and secured the board in the case (9/9 screws). All five child cards retained exactly the same attachments/seating/fastener text after the board moved. The case remained at the same on-screen position during selection/mounting; manual Fit all is still available. These browser operations used the accessible list controls with the 3D view visible, not a claim that all outstanding S4 hit-area bugs are fixed. The existing production server on 3000 was left running; the dev preview uses the same source on 3001. Next.js regenerated next-env.d.ts during preview startup; restored that generated file to its original tracked form.

The owner then requested a centred camera (decision 16). Disabled orbit panning and cursor-centred zoom; angle buttons keep a stable pivot and Fit all explicitly recentres it. Keyed camera setup by project ID so a newly opened project receives its own initial fit instead of inheriting the previous build's camera. Updated the bilingual control instructions. The updated preview is open in the owner's browser; the owner is actively assembling there, so no further project-state resets were made. Type-check and message parity pass after this change.


### 2026-11-06, single-page simplification (Codex, owner decision 17)
Owner requested a much simpler site: one PC, no electricity or large catalog, one page and working/not-working only. Scoped ownership extended to the compact model/component/styles/tests, home and PC entry pages, SiteHeader/SiteTutor/root layout, and an opt-in compact rendering mode in PcScene. Previous detailed PC code, networking code and IndexedDB projects are retained; compact saves use a separate localStorage key. Implementation applied; fresh checks and browser acceptance pending.

Compact acceptance completed: 56/56 targeted tests; type-check, message parity and diff whitespace checks pass. In the browser, Start at 0/7 showed not working; all seven Fit actions advanced 1/7 through 7/7, then Start showed working. EN switching, reload and return to AR kept the finished build and success result. Reset returned to 0/7; the live page is left ready for the owner. Screenshot evidence: /private/tmp/your-tech-lab-simple-success.png. Current primary handoff and requirements now point to compact scope C1–C4 rather than the older detailed-workspace backlog. No production rebuild or deployment performed; the updated local dev preview on 3001 is running.

Reset follow-up: the first reset exposed a WebGL lifetime bug (the retired canvas reported intentional context disposal to the new view). Fixed with scoped context-event cleanup and by keeping the renderer alive during a healthy reset; only the camera setup resets. The temporary WebGL capability probe now releases its context. Browser re-check: three consecutive resets kept exactly one live canvas at 0/7, and the actual models remained visible afterward. Type-check and message parity pass after the repair. Final ready screenshot: /private/tmp/your-tech-lab-simple-ready.png.

### 2026-11-06, learning homepage restoration (Codex, owner decision 18)
Owner explicitly restored help/guided/self-directed entry and programming, with the compact PC builder last. Scoped single-writer ownership extends to learning components/styles/content, home/shell/tutor integration, restored runtime/contracts/execution/runner, public runtime setup, bounded code-review endpoint and its tests, and scope documents. No Claude account or team messaged. Existing old project data and evidence preserved. Initial implementation applied; browser and endpoint verification underway.

Learning-home acceptance (fresh, 2026-11-06): TypeScript, EN/AR message parity and whitespace checks pass. Endpoint/runtime/simple-PC unit selection: 69/69. Full isolated runner/execution/provider boundary tests with the existing JDK and required macOS sandbox: 126 passed, 1 skipped (real AI provider call skipped because no provider/key configured). Browser: all seven beginner tracks run real Hello output or HTML/CSS preview; TypeScript sample initially exposed a global-name collision and was corrected to learnerName. Python initially exposed missing public-runtime CORS headers; restoring headers for public runtime assets only fixed it. Intentional console.lg error produced a real runtime diagnostic; helper highlighted the editor line, explicit Apply changed it to console.log, and rerun succeeded. Guided and self-directed start options reveal the correct next choices; EN switch updates all new content; edited JavaScript draft survived reload and ran afterward. DOM width596 equals scrollWidth596, one live PC canvas, PC section after programming. No production rebuild/deployment or paid AI call. Hero evidence: /private/tmp/your-tech-lab-learning-home-ar.png.

Final follow-up: added a provider-format regression check for code-review JSON on non-strict OpenAI-compatible endpoints; all6 code-review tests pass. Final type-check/message/diff checks pass. Native viewport screenshots saved under docs/evidence/learning-home/{ready-ar,guided-ar,pc-last-ar}.png. Current preview left at the Arabic homepage with compact PC0/7 and the coding draft preserved. AI-provider setup remains the only activation dependency for general model-assisted code correction; no real model call was performed.

### 2026-11-06, owner selected OpenAI
Owner chose OpenAI for the real tutor. Scoped single-writer ownership: provider factory/OpenAI adapter and tests, code-review redaction boundary/tests, local AI settings, setup docs. First-party AI_PROVIDER=openai uses the official endpoint, standard server-side OPENAI_API_KEY (AI_API_KEY compatibility), GPT-6 Luna default and low reasoning, strict JSON output, store=false. Provider choice/model were saved in git-ignored .env.local while preserving every non-AI setting; file remains mode600. No key exists in project or current OPENAI_API_KEY environment; no paid call has been made. OpenAI Developers was suggested to the owner for key setup, not confirmed installed or connected.

OpenAI setup verification: type-check and diff whitespace checks pass. Provider factory, existing tutor adapters and code-review boundary tests:43 passed,1 skipped (live call skipped because key missing). New checks verify official endpoint, store=false, reasoning/model settings, no client key return, secret redaction and prevention of applying a redacted copy. Latest plugin discovery still reports OpenAI Developers not installed; await owner installation/connection before credential creation and the live activation check.
