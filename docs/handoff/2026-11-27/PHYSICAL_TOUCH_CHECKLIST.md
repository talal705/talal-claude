# Physical-touch acceptance — still pending

No physical phone/tablet has been tested. Chromium touch emulation is recorded separately and is not evidence of a real device. Neither Codex (2026-11-27) nor Claude (2026-11-28) could reach a real device from this Mac: no USB-attached phone/tablet, no Xcode device tools or `adb`, and Claude's computer-use request (needed even to see whether iPhone Mirroring has a paired iPhone) was refused because macOS Screen Recording permission is not granted to the Claude app.

Use the reviewed preview on a real phone or tablet. Preserve the learner's saved progress: use a private browser tab for a fresh build.

## Record first

| Field | Value |
|---|---|
| Device and model | |
| OS version | |
| Browser and version | |
| Language(s) tested | English / Arabic |
| URL | https://talal-claude-git-fix-wiring-handoff-2026-11-26-talal705.vercel.app/pc |
| Commit shown as Ready / Latest in Vercel | |
| Date and time | |

Every commit on this branch from `0619a3b` onwards has the same product source (later commits change only documentation), so any of them tests the same app. Record the one Vercel actually shows.

## Checks

Write PASS or FAIL in each cell; for a FAIL, add the steps that reproduce it.

| # | Check | EN | AR |
|---|---|---|---|
| 1 | Planner: choose a suggested build, add a storage drive, then remove it with its own **Remove from my build** button. The other parts stay. | | |
| 2 | Start assembly. Tap the CPU and do the socket, rotation and placement steps by tapping. Each tap takes exactly one valid step; no part needs dragging to install. | | |
| 3 | Drag one finger across the 3D view: the camera turns and the "N of M parts installed" count (Arabic "ركّبت N من M قطع") does not change. | | |
| 4 | Pinch to zoom. Start a drag or pinch and stop it part-way (lift off, or add a second finger): the scene stays usable and nothing is installed. | | |
| 5 | Portrait and landscape: the toolbar, robot guidance and selected-part options are readable and reachable, and the page does not scroll sideways. | | |
| 6 | Undo one step, then reload: the remaining history and the held/placed part survive. | | |
| 7 | Turn optional RGB on and off: the "N of M parts installed" count (Arabic "ركّبت N من M قطع") does not change. | | |

A failure must be repaired and retested on the resulting build before physical-touch acceptance. Completing this checklist does not by itself certify every hardware variant or deployment.

## Access to the protected preview

GitHub's Vercel check links to the correct branch preview, but an unauthenticated request currently opens **Login – Vercel**, not VTE. On the phone, either sign in to Vercel or, from the deployment's **Share** dialog, choose **Anyone with the link** and open that generated link. Do not disable project-wide protection or put access tokens in Git.

Official instructions and current plan limits: https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/sharable-links
