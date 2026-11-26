# Codex review / continuation — 2026-11-26

Claude implements; Codex reviews. The full agreed roadmap remains authorized. No production/main changes.

## Reviewed work saved through Stage 9

- `0fa7056`: carried-board cable-boundary fix, independent fault-removal history/baseline, selected bay/fan target consistency,
  rebase from actual specs, and earlier fan-clearance work. The unmodified carried-board reproduction independently passes;
  Codex also verified types/messages and 60 relevant tests. Claude's broad suite: 1074 passed, 21 skipped.
- `9276afa`: independent GPU cover and bracket-screw actions; old bulk steps retained for migration/tests only.
- `72330d6`: optional selectable supplied fans, manual individual removal/repositioning, raw old cover-state fallback,
  per-phase GPU robot targets, rear-fan/I/O geometry fix and regenerated case assets. Codex independently verified 95 relevant
  tests (six files), type-check and message parity. Claude's broad suite: 1089 passed, 21 skipped.
- Neither these packets nor the source below have final browser/visual acceptance or a final production build. GPU cover and
  bracket counts remain explicitly schematic (two openings/two screws), not exact manufacturer-verified data.

## Interrupted Stage 10 — not ready to build/release

Claude hit the five-hour usage limit again; its CLI reported reset at 20:40 Asia/Riyadh on 2026-11-26.
The partial changes are isolated on `wip/wiring-2026-11-26`; `feat/assembly-completion` stays at the reviewed Stage9 checkpoint.

Confirmed current state:

- Equivalent unused SATA destination: Codex's independent probe first failed (engine accepted, wrapper refused). The model
  change now makes that probe pass. This is not evidence that the UI saves the actual selected destination.
- **Type-check FAILS**: `apps/web/components/pc/companion.ts(201,51): TS2304 Cannot find name 'parseEndStep'`.
  The helper exists in simple-model, but its companion import was not completed when quota interrupted implementation.
- UI `takePlug` still uses `withPlug(sn, key, endIndex)` without the actual selected port. Finish that wiring so replay does not
  silently return to a preferred port. Per-end disconnection UI and Stage11 readiness/startup remain unfinished.
- Independent current checks: message parity passes; 85 relevant tests pass; carried-board probe passes; equivalent-port
  model probe passes. These passes DO NOT cancel the type failure or establish complete Stage10 behavior.
- No final build/browser run was attempted on this interrupted partial source. Do not publish it as complete.

## Required next work

Use `NEXT_CLAUDE_PROMPT.txt` in this directory. It specifies the remaining wiring, power/readiness, compatibility, persistence,
regression, build, browser and screenshot gates. Finish on the WIP branch, preserving the reviewed feature branch, then Codex
can integrate and publish a feature preview. Production and the original workspace remain unchanged.
