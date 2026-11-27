# PC release verification — Codex, 2026-11-27

The owner asked Codex to carry out the four final verification tasks directly. This packet tests the current PC experience; it does not certify unrelated website sections, every hardware variant, or manufacturer-exact geometry.

## Deployed follow-up — authentication obstacle resolved

After the local packet, native computer use became available. Codex opened the protected preview through the owner's existing authorized Chrome session and verified its actual dashboard source **4d28127**, Ready/Latest. A bounded live smoke check passed for storage add/removal/reload, CPU click steps and orientation refusal, undo/reload/resume, Arabic/RTL, RAM clip/orientation/seating, RGB and M.2 slot/source-note/resume state. Exact observations and limits: `DEPLOYED_PREVIEW_VERIFICATION.md`. The 436 local assertions were **not** rerun remotely. No protection setting or product code changed. The physical phone/tablet gate remains pending.

## Source and build

- Branch: `fix/wiring-handoff-2026-11-26`.
- Source checkout: `1b15b24`; last product change: `0619a3b`.
- Fresh production build: **`-f6Q4maBozU16L9dULuXh`**.
- Own local production server: `http://127.0.0.1:3027/pc`. Earlier servers were not used or stopped.
- The six product-file fingerprints still match the previously reviewed product code. No product edit was needed in this verification packet. New work consists of an acceptance script, evidence and documentation.

## Four requested tasks

| Task | Actual result |
|---|---|
| Verify deployed preview | **Bounded deployed smoke check passed later**, through authorized native Chrome, on source 4d28127. The original unauthenticated request showed Login – Vercel; that obstacle is preserved as history. See the follow-up above; full remote acceptance is not claimed. |
| Complete learner journey | **Passed locally:** 49/49 EN1440 and 49/49 AR430, from fresh isolated browser storage, with no assembly-state seed or engine mutation. |
| Real touch device | **Pending.** Touch emulation passed 12/12 EN1440 and 12/12 AR430; no physical-device control connection is available. Emulation is not a physical-device pass. |
| Repair and prepare release | No confirmed product defect was found in this packet. Harness assumptions were corrected, affected runs completed, engineering gates passed, evidence preserved and handoff updated. Main merge/production release remain unapproved. |

## Browser evidence on this one build

All final runs below completed with exit 0. **436 assertions passed, 0 failed**: 98 in the fresh learner journeys and 338 in 14 targeted runs.

| Scenario | EN1440 | AR430 |
|---|---:|---:|
| Fresh planner → complete assembly → wiring → startup | 49 | 49 |
| GPU fitting, removal, reinstall, closed-panel guards | 42 | 42 |
| Wiring, refusals, startup, undo/reload | 50 | 50 |
| Robot pointer visibility and placement | 9 | 9 |
| Legacy shared-SATA save migration | 8 | 8 |
| Chromium touch emulation | 12 | 12 |
| Liquid cooler fitting/removal | 16 | 16 |
| Air cooler/contact-frame fitting/removal | Not repeated in EN | 40 |
| PSU/SATA/fan preparation, individual screws and removal | Not repeated in EN | 24 |

The fresh journey exercises all three planner suggestions, the robot's DDR4/DDR5 incompatibility explanation, duplicate-drive removal, the catalog's **Remove from my build** control, fan removal/addition, planner reload, CPU/RAM/M.2/cooler preparation before mounting the board, PSU, SATA, GPU, case fan, all selected cable ends, readiness refusal, successful startup, powered reload, power-off undo, optional RGB and horizontal overflow. Actions use real browser clicks, never a direct engine call. Camera stability is checked through fitting and wiring.

The targeted runs add deeper removal, invalid-action, old-save, occlusion, hardware-state and touch-gesture coverage. They use isolated synthetic fixtures where their scripts specify them. They do not access the owner's browser storage.

Screenshots inspected include Arabic GPU reinstallation, Arabic touch controls and English running/readiness controls. Saved screenshots are evidence of the local build only. Rendering used software GL; no physical-device or production-performance measurement is claimed.

## Engineering gates

- `npm run type-check`: passed.
- `npm run check:messages`: passed.
- `npx vitest run apps/web packages content`: **88 files, 1127 passed, 21 skipped**. Unconfigured database/provider checks are not passes.
- Independent preservation configs for 2026-11-25 and 2026-11-26: **1 and 3 passed**.
- Acceptance-fixture generation: 1 passed; fixtures are for targeted scripts, not the fresh learner journeys.
- `npm run build`: passed; build ID recorded above.
- New acceptance-script syntax and diff whitespace checks: passed.

## Failed attempts preserved separately

- Initial sandboxed Vitest execution could not bind the local runner (`listen EPERM`). Rerunning with loopback permission passed; no product repair was made for that environment error.
- First fresh-journey harness assumed RM850x, but the actual 1080p gaming suggestion uses RM650e: 22 passed / 1 failed.
- Second harness added another fan but only fitted one, then correctly encountered a disabled lead for the unfitted fan: 39 passed / 1 failed. The final scenario tests removal/addition and selects exactly one fan.
- First Arabic journey used `٢` in a RAM selector, while the actual interface displays `2`: 15 passed / 1 failed. The corrected selector uses the translated role and the actual label. The EN journey ran before this Arabic-selector correction; both final journeys used identical product code and build.
- Failed-run screenshot timeouts are not successful visual checks. None of these failed runs is included in the 436 successful assertions.

Evidence, exact commands, build fingerprints and final/failed logs: `evidence/release-build-f6Q4maBozU16L9dULuXh/`. Reproducible fresh journey: `acceptance/release-journey.mjs`.

## Remaining gates and continuation

1. **Resolved for the bounded smoke check:** authorized native Chrome opened the app, and its actual Vercel dashboard confirmed source 4d28127. The earlier unauthenticated blocker is historical; use `DEPLOYED_PREVIEW_VERIFICATION.md` for the latest deployed evidence.
2. Perform `PHYSICAL_TOUCH_CHECKLIST.md` on an actual phone/tablet and record results.
3. Repair any genuine issue found in those gates, then review the concrete final result with the owner before merging `main` or publishing production.

Do not disable protection, invent a preview URL, use paid services, overwrite saves, or restart unrelated servers. No videos or new features were added. Existing schematic geometry and hardware approximations remain documented limitations.
