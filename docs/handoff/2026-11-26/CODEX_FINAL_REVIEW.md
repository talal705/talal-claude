# Codex final review — 2026-11-27

Continue branch `fix/wiring-handoff-2026-11-26` in `/Users/most/Documents/Codex/VTE-completion-2026-11-25`.
Product checkpoint: **cfa731c**, after **d510856**. Claude implemented; Codex reviewed, reproduced defects independently and checked their repairs.
No main merge or production release is approved by this review.

## Completed and reviewed

- Individual cable endpoint selection, plugging and removal; actual/equivalent socket recording; wrong/occupied/reversed refusals; matching robot/scene targets and per-end undo/reload.
- Shared modular PSU sources now use physical cable/end identity. Device plugs remain independent; reconnecting the source through either logical lead works.
- Valid saves written by the earlier logical-end derivation migrate to the physical connected list. History, real sockets and progress remain intact. Unrelated mismatched/invalid lists remain rejected.
- Separate panel, mains, PSU-switch, power-on and power-off actions, recorded in existing history. The engine judges startup; optional fans do not invent a boot requirement. Failure leaves wiring editable.
- Fixed a real complete-plan crash when querying a liquid cooler absent from that plan; corrected optional-lead and one-end-disconnect wording; reset orientation when choosing another plug.
- Removed unreachable code in ad5eed3 (eight net production lines). New requested features necessarily add code; no claim that total production lines decreased across this feature packet. Concise-code preferences already exist in project and global Claude instructions.

## Evidence and exact limits

Codex independently reran types, EN/AR parity, both review configs (1 + 3 tests), and `npx vitest run apps/web packages` at cfa731c: **84 files, 1114 passed, 21 skipped** (unconfigured DB/provider integrations). Diff whitespace check passes.
Claude's production build after the final parser change passed. Own local server remains on port3002.

Browser matrix immediately before the parser-only migration: **346 passing checks**, all 12 logs exit0, preserved in `evidence/f-*.log`:
- Wiring/startup EN 1440, EN 430, AR 1440, AR 430:50 each.
- GPU installation:10; planner storage/duplicate removal EN 1440 and AR 430:8 each.
- Cooling:40; AIO:16; PSU/SATA/fans:24; M.2:31; CPU/RAM:9 (EN desktop).
After the final parser-only delta, targeted legacy-two-SATA browser checks passed **8 EN 1440 + 8 AR 430**, including reload and one-end undo, no page errors. Other UI/scene behavior did not change in that delta; the346 matrix was not repeated. This is not a claim that all 362 browser checks ran against one identical build.
Codex inspected actual readiness controls and narrow EN/AR wiring screenshots. Selected screenshots and prior matrix logs are preserved alongside this review.

Remaining verification limits: no physical touch device; GPU removal/narrow/Arabic-specific browser cases not rerun; robot pointer pixel placement on alternate sockets checked through state rather than pixel targeting; precise occupied-port wording not independently assessed. GPU rear-cover/bracket counts and some collision tolerances remain documented educational approximations. Videos remain deferred. Deployed preview not inspected; local verification is not production verification.

## Continuation

The known reproduced blockers are resolved. No further product edits are requested by this review. Read this file and the current PROJECT_HANDOFF.md first; older negative review notes are historical. Preserve reviewed tests and saves. Main merge/production deployment still require the owner's approval.
