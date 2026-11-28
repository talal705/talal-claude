# One-click installation — browser evidence, 2026-11-28

Script: `../acceptance/one-click.mjs` (`node one-click.mjs <en|ar> <width> http://127.0.0.1:3031`), real browser input, isolated storage, software GL.

- `build-i6E_cFaNPaGOtAjWTUkmk/` — the tested production build. Final runs with the final script: `en-1440.log` 199/0, `ar-1440.log` 199/0, `en-430.log` 196/0, `ar-430.log` 196/0. The 430 px runs use Chromium touch emulation, not a physical phone.
  - `chunks-i6E_cFaNPaGOtAjWTUkmk.txt` and `chunks-mMoCDm0tpIYeBiGmvFA7Z.txt`: SHA-256 of every client static chunk of the tested build and of the final rebuild (comments and docs changed only); the lists are identical.
  - `earlier-script-same-build/`: the same build's 1440 px runs before a harness-only change to the camera-drag coordinates (also 199/0).
  - `harness-failed/`: runs stopped by harness faults (the locale button selector, a "Settings" button sharing its class, a view rectangle measured before the page scrolled). Not counted as passes.
  - `screenshots/`: start (layout) and practice build in EN/AR at 1440 and 430, plus the finished assembly.
- `earlier-builds/`: superseded builds. `oP-ZFLvYPpLDicEZ9pYD5`: two harness-stopped runs (105 and 106 passed, 1 failed each). `qwk4gMTGMDVKoGM5dSw5g`: EN 1440 138/0 before Codex's later findings.
