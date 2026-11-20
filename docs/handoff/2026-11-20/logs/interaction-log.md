# PC simulator — interaction log (2026-11-19)

## Production (https://talal-claude.vercel.app/pc, commit a8cfceb, built-in browser, Arabic)

CPU, guided mode:
- Selecting the CPU → «ارفع ذراع المقبس أول، وبعدها نركّب المعالج.» (no install button)
- Lowering with the plate closed → refused, same line
- Open the plate → recorded as `mech:cpu-socket-plate:open`
- Lowering at 90° → «لفّ المعالج لين تتطابق علامة المثلث مع علامة المقبس.»
- Turned to 0° but still off centre → «المعالج مائل شوي؛ وسّطه فوق المقبس قبل تنزّله.»
- Nudged to «ملفوف 0° · متطابق» → recorded as `lower:cpu`
- Closed the plate → `mech:cpu-socket-plate:closed`, «تثبّت. غطا الحماية طاح: احتفظ فيه.»

Find-the-fault mode (each fault fails at power-on, then is fixed by hand, then starts):
- frontPanelWrong: plug moved to PWRSW through the cable panel → solved
- ramUnseated: module pressed home → solved
- coolerLeadMissing: lead into CPU_FAN through the cable panel → solved
- biosTooOld: BIOS flashed → solved

Other checks on production:
- Card panel: latch-first line shown; covers state shows "after the board is in the case"
- Cooler panel: placing without paste refused

## Local (Playwright, dev server; English and Arabic as noted)

- GPU (ar and en, 15/15 PASS):
  - Covers named first.
  - Latch opened.
  - Pushing with the covers in is refused.
  - Covers removed.
  - A reversed card is refused (bracket); an off-slot card is refused.
  - Lined up → `lower:gpu`, then `fasten:gpu`.
  - Unscrewed, latch released.
  - Undo works; reload restores the steps.
  - No page errors.
- M.2 (ar, 7/7 PASS):
  - The Q-Latch is asked for first and unlocked.
  - A reversed drive is refused (notch).
  - The drive goes in at an angle → `lower:storage`.
  - The latch locks and the drive counts as installed.
- Cooler (en, 8/8 PASS):
  - Placing without paste is refused.
  - Film refused (not recorded for this cooler).
  - Paste is applied, then the cooler placed.
  - An adjacent corner is refused with the diagonal hint.
  - Corners 0, 2, 1, 3 → installed.
- Cables (en, 9/9 PASS):
  - No one-click Connect; picking a socket is required.
  - A reversed plug is refused (latch).
  - The PSU end goes in → `plug:cpuPower:0`.
  - EPS into the 24-pin is refused with the engine's reason.
  - EPS into its socket → connected.
  - Undo removes the device end only.

Unit tests: 877 pass (94 skipped). This includes the engine gates (prep, keying, latches, PCIe removal order) and the replay, undo and reload of every new step kind.
