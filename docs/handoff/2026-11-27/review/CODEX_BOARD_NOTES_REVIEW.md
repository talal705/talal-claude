# Codex review: CPU and M.2 board notes

Review date: 2026-11-27. Base commit: `3af4dda` on `fix/wiring-handoff-2026-11-26`.

## Scope and result

The six pending product files were reviewed without editing them. No confirmed product defect was found in the pending board-specific source-note changes. This is a local review, not deployed-preview approval.

The product-file SHA-256 fingerprints in `/private/tmp/vte-review-source-fingerprint-2026-11-27.json` still matched on recheck. The local production build ID is **`C-ppCM5hTjcfNxr1cNd47`** (no trailing `6`).

Independent checks passed:

- TypeScript and EN/AR message-key parity.
- 88 Vitest files: 1127 passed, 21 skipped; skipped checks are not passes.
- Board-source and GPU-source targeted tests: 7 passed (included in the preceding total).
- Earlier independent preservation configurations: 1 and 3 passed.

## Browser review is incomplete

Claude's original `acceptance/board-notes.mjs` EN1440 and AR430 runs each ended with 8 passes and 3 failures. The M.2 slot chooser is outside `details`; the locator `details button` cannot find it. These failed runs must remain recorded as failures.

Codex preserved that harness and created `board-notes.review.mjs` in this directory. Only the slot locator and bounded default timeout differ. The corrected locator scopes to `[class*=toolbar] button` and matches `M.2_1`.

The independent EN1440 run ended with **9 passed, 1 failed**. Z790 and Z790 D4 passed their CPU, pre-selection M.2, and selected-slot notes. B760 passed its CPU note, then `page.screenshot` timed out before its M.2 assertions. H81's CPU note and the no-page-error check passed. Thus B760's M.2 checks and the complete AR430 run remain unverified in this independent run. A screenshot timeout must not be reported as a product failure or as successful browser acceptance.

Log: `/private/tmp/vte-codex-board-en-2026-11-27.log`. Screenshots: `/private/tmp/vte-codex-board-review-2026-11-27/`.

## Required completion by Claude

1. Fix the original harness's slot-button locator; do not alter assembly rules to satisfy a test.
2. Keep screenshot capture bounded and report any missing screenshot separately; preserve all actual DOM/state assertions and run every board. Do not allow capture timeout to silently omit later assertions.
3. Complete EN1440 and AR430 on the same identified production build. Inspect available screenshots; report unsupported captures honestly.
4. Preserve source-note scope: a board's exact manual only when verified; generic guidance otherwise; the actual selected M.2 slot determines screw versus Q-Latch wording. Do not change engine state, saves, geometry, camera or click steps.
5. Update `PROJECT_HANDOFF.md` with exact build, commit, successful/failed/skipped/not-run checks and remaining limitations. Preserve relevant logs and screenshots. Commit and push the feature branch after these checks; do not merge `main`, deploy production, or disable preview protection.

## Primary-source references checked

- Z790 DDR5, E21279: https://dlcdnets.asus.com/pub/ASUS/mb/LGA1700/TUF_GAMING_Z790-PLUS_WIFI/E21279_TUF_GAMING_Z790-PLUS_WIFI_UM_WEB.pdf
- Z790 D4, E20581: https://dlcdnets.asus.com/pub/ASUS/mb/LGA1700/TUF%20GAMING%20Z790-PLUS%20WIFI%20D4/E20581_TUF_GAMING_Z790-PLUS_WIFI_D4_UM_WEB_082622.pdf
- B760, E21693: https://dlcdnets.asus.com/pub/ASUS/mb/LGA1700/PRIME_B760M-A_WIFI/E21693_PRIME_B760M-A_WIFI_UM_WEB.pdf?model=PRIME+B760M-A+WIFI-CSM

For the offered 2280 drive, Z790/D4 pages are 2-8 (slots 1/3), 2-10 (slot 2), 2-11 (slot 4); B760's M.2 installation section is 1-14. This does not verify every other drive length or every board mechanism. Physical-touch hardware, true collision physics, manufacturer-exact geometry, and protected deployed-preview behavior are not established by these checks.
