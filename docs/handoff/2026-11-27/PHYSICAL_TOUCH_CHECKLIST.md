# Physical-touch acceptance — still pending

No physical phone/tablet has been tested in this review. Chromium touch emulation is recorded separately and is not evidence of a real device. No physical-device control connector is available in this Codex session; Android/iOS device-control CLIs are unavailable on this host.

Use the exact reviewed preview on a real phone or tablet. Record device, OS/browser version, locale, deployment commit and date. Preserve the learner's saved progress; use a private browser session for a fresh build.

1. In the planner, choose a suggested build, add a storage drive, then remove that drive with its own **Remove from my build** button. Confirm the other components remain.
2. Start assembly. Tap the CPU and perform socket/rotation/placement actions with taps. Each tap must take only one valid step. No dragging is required to install a part.
3. Drag one finger across the 3D view. The camera should rotate; no assembly step should be recorded. Pinch to zoom; cancel a gesture and confirm the camera remains usable.
4. Switch portrait/landscape and try Arabic RTL. Confirm the toolbar, robot guidance and selected-part options remain readable, reachable and free of page-wide horizontal overflow.
5. Undo one step, reload, and confirm the remaining assembly history and held/placed component state survive. Verify optional RGB can be toggled without changing the build.

Record PASS/FAIL and reproduction steps for each item. A failure must be repaired and retested on the resulting build before physical-touch acceptance. Completing this checklist does not by itself certify every hardware variant or deployment.

## Access to the protected preview

GitHub's Vercel check links to the correct branch preview, but an unauthenticated request currently opens **Login – Vercel**, not VTE. If an authorized reviewer needs access, the owner can use the deployment's **Share** dialog and choose **Anyone with the link**, then send that generated link. Do not disable project-wide protection or put access tokens in Git.

Official instructions and current plan limits: https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/sharable-links
