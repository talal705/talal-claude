# Performance measurements

Measured values only. Nothing here is a guarantee for other hardware, browsers or displays.

## Robot tutor frame pacing — 2026-10-10

- Command: `node scripts/measure-robot.mjs` against the production build (`npm run build && npm run start`).
- Hardware and software: Apple M5, 10 cores, macOS (Darwin 27.0.0, arm64); headless Chromium 156.0.8078.4 (Playwright 1.64.0); viewport 1280x800; homepage, English.
- Method: the dev-only probe in `apps/web/lib/interaction/frame-probe.ts` records the gaps between `requestAnimationFrame` callbacks in which the robot painted, and the time from a slide command to the first paint at the destination.

| Scenario | Setting | Median frame | p95 frame | Max frame | Slide planned | Slide measured |
|---|---|---|---|---|---|---|
| Idle, 3 s | 60 | 16.7 ms | 16.7 ms | 16.8 ms | — | — |
| Slide to target and point, help panel open | 60 | 16.7 ms | 16.7 ms | 16.8 ms | 900 ms | 910 ms |
| Slide home | 60 | 16.7 ms | 16.7 ms | 16.8 ms | 900 ms | 911 ms |
| Idle, 3 s | 30 | 33.3 ms | 33.4 ms | 33.5 ms | — | — |
| Slide to target and point, help panel open | 30 | 33.3 ms | 33.4 ms | 33.4 ms | 900 ms | 928 ms |
| Slide home | 30 | 33.3 ms | 33.4 ms | 33.4 ms | 900 ms | 929 ms |

The 30 fps option keeps the same planned duration (900 ms); the measured end differs by less than one frame of each setting.

Limits of this measurement:

- It sees callback pacing, not what the compositor presented; frames dropped after the callback are invisible to it.
- Headless Chromium paces frames with a virtual 60 Hz clock, not a real display. A check on a real screen has not been done.
- Only the robot on the homepage was measured. The complete workspace the brief asks for (PC scene, panels open, code execution running) does not exist yet and is not measured.
- The "slide and point" runs reported one unfinished slide each (a slide replaced before it ended); not investigated.

### Re-measurement after the slide-restart fix — 2026-10-10

Same command, hardware and build method.

| Scenario | Setting | Median frame | p95 frame | Slide planned | Slide measured | Unfinished slides |
|---|---|---|---|---|---|---|
| Idle, 3 s | 60 | 16.7 ms | 16.8 ms | — | — | 0 |
| Slide to target and point, help panel open | 60 | 16.7 ms | 16.7 ms | 900 ms | 912 ms | 1 |
| Slide home | 60 | 16.7 ms | 16.7 ms | 900 ms | 909 ms | 0 |
| Idle, 3 s | 30 | 33.3 ms | 33.4 ms | — | — | 0 |
| Slide to target and point, help panel open | 30 | 33.3 ms | 33.4 ms | 900 ms | 912 ms | 1 |
| Slide home | 30 | 33.3 ms | 33.4 ms | 900 ms | 913 ms | 0 |

The fix was expected to bring unfinished slides to 0 when pointing. It did not: one slide is still replaced before it ends on "Show me where" at both settings. Open with `interaction`.

### Cause of the "unfinished slide" — resolved 2026-10-10

The replaced slide was an artifact of the measurement script, not a fault in the robot. The script started the probe immediately after a click that makes the help panel taller; the idle robot then moves clear of the panel, and the pointing request took over that move. With a 1 s settling wait before the measurement (now in `scripts/measure-robot.mjs`), a fresh production build gives:

| Scenario | Setting | Median frame | p95 frame | Slide planned | Slide measured | Unfinished slides |
|---|---|---|---|---|---|---|
| Idle, 3 s | 60 | 16.7 ms | 16.8 ms | — | — | 0 |
| Slide to target and point, help panel open | 60 | 16.7 ms | 16.8 ms | 900 ms | 909 ms | 0 |
| Slide home | 60 | 16.7 ms | 16.8 ms | 900 ms | 911 ms | 0 |
| Idle, 3 s | 30 | 33.3 ms | 33.4 ms | — | — | 0 |
| Slide to target and point, help panel open | 30 | 33.3 ms | 33.4 ms | 900 ms | 910 ms | 0 |
| Slide home | 30 | 33.3 ms | 33.4 ms | 900 ms | 913 ms | 0 |

The earlier statement in this file that the fix "did not" work was wrong about the cause: the fix addressed a different, real restart, and the remaining reading came from the script's timing. The limits listed at the top still apply (headless Chromium, homepage only).
