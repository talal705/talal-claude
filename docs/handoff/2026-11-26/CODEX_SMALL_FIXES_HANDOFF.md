CURRENT NOTE (2026-11-27): Historical review/packet; reproduced findings below are resolved through cfa731c. Read CODEX_FINAL_REVIEW.md for the current status and exact verification limits.

# Codex small-fixes handoff — 2026-11-26

The owner explicitly authorized Codex to implement a bounded small-fix/test/handoff packet to reduce Claude's work.
Claude continues the larger wiring/readiness work. No main merge or production deployment.

## Starting point

- Workspace: `/Users/most/Documents/Codex/VTE-completion-2026-11-25`.
- Continue branch **`fix/wiring-handoff-2026-11-26`**, product-fix commit **`ad15c71`** (later documentation commits may follow).
- This includes `ab410c2`'s interrupted wiring model plus all reviewed Stage8/9 and cooling repairs. Do not reset to
  `72330d6`, `afd162e`, or copy old files over these changes. Verify current Git status/history first.

## Completed by Codex

1. Restored compilation: imported the existing `parseEndStep` used by the robot's endpoint-undo messages.
2. Fixed saved-data validation: old `plug:key:index` saves still load, and the new `plug:key:index@port` / `unplug:key:index`
   forms now load too. They use the shared parser, known cable/endpoint bounds and engine replay; unknown cables/sockets,
   invalid indices and malformed forms are rejected. Before this fix, valid alternate-port saves returned `null` on reload.
3. Fixed the actual UI save callback: `handPlug` captures the selected `portId` and records that same port with `withPlug`.
   Previously the model accepted an alternate port but the UI recorded only the preferred-port legacy form.
4. Added EN/AR `undo.unplug` text so undoing a disconnection produces a proper translated line. Updated cable instructions
   to describe compatible destinations rather than claiming only the planned socket works. The wording is shorter and gentle.
5. Marked occupied port choices with the existing translated label and disabled selection/turn controls under the same
   readiness/power guard as the plug action. Engine validation still decides refusal; no compatibility checks were removed.
6. Added seven meaningful regressions in the existing `plan-model.test.ts`, reusing its fixture: actual-port JSON reload,
   invalid saves, independent endpoint removal/undo, legacy endpoint saves and unrelated-plan rebase, occupied/reversed
   rejection, powered disconnection guard, and translated undo in both languages.

Production edits: `SimplePcLab.tsx`, `companion.ts`, `simple-model.ts`, EN/AR `labs.json`.
Test edits: `plan-model.test.ts`. No component geometry, power/readiness flow, route, save-key or unrelated-site change.

## Verification actually performed

- The new targeted tests initially had three real failures: alternate-port save rejection, unplug-save rejection and the
  undefined parser in undo. They pass after the fixes; a seventh case covers malformed/bad saves.
- `npm run type-check`: passed.
- `npm run check:messages`: passed.
- `npx vitest run apps/web packages`: **84 files, 1096 passed, 21 skipped** (unconfigured DB/provider integration).
- `SWC_NATIVE_BINDING_CACHE=/private/tmp/talal-review-swc npm run build`: passed.
- `git diff --check`: passed.
- **Not performed:** browser/visual/device checks or inspection of the deployed preview. Unit save/replay checks and review
  of the UI callback are not a claim of final browser acceptance.

## Claude's remaining work — do not repeat the completed repairs

1. Finish per-end selection/disconnection UI (including partially connected/shared leads) using the existing
   `unplugSimpleEnd` / `withUnplug`. This packet adds no new disconnect button. Preserve the other endpoint and actual socket.
2. Make cable scene/guide/robot targets follow the selected/actual endpoint and socket consistently. Add normal-suite and
   browser regressions for valid alternate ports, wrong/occupied/reversed ports, modular/captive PSUs, multiple SATA drives,
   shared power leads, plan edits and optional versus essential cables.
3. Complete Stage11 individual readiness/power controls and safe off/failure recovery using engine state, without auto-fitting
   missing internal parts or fake boot requirements. Distinguish boot success from finishing optional items.
4. Finish the exact final-build browser matrix: planner add/remove (storage/duplicates), CPU/RAM/M.2/cooling/GPU/fans/wiring/
   startup, EN/AR desktop/430px, save/undo/reload, stable camera and double-click gating. Save and inspect screenshots.
5. Preserve documented approximations (GPU cover/bracket counts remain schematic), list genuine unverified hardware/device
   details, and update the current roadmap/handoff accurately. Do not mark skips or interrupted runs as passes.

Use `NEXT_CLAUDE_PROMPT.txt` alongside this file for the ready continuation instruction. Commit task changes locally for Codex
review; no force-push/main merge/production deployment or Vercel-protection changes.
