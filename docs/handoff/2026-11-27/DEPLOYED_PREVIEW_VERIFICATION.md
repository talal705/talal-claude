# Deployed preview verification — 2026-11-27

Observed around 23:40 Asia/Riyadh using native Chrome through the newly available computer-use interface. This is a bounded deployed smoke check, separate from the 436 local assertions in `RELEASE_VERIFICATION.md`.

## Deployment identity actually observed

- Application opened: https://talal-claude-git-fix-wiring-handoff-2026-11-26-talal705.vercel.app/pc
- Dashboard opened: https://vercel.com/talal705/talal-claude/2AA65o7WXvGM15sngJfgmGoa3yQK
- The dashboard visibly showed **Ready / Latest**, **Preview**, branch **fix/wiring-handoff-2026-11-26**, source **4d28127 — Verify complete PC learner journeys and record remaining release gates**.
- Listed domains: the tested branch domain and `talal-claude-39fixkmzi-talal705.vercel.app`. The immutable domain was observed, not separately tested.
- The application's visible toolbar iframe identified deployment `dpl_EZeNtWDFERPJ48JYyE6r8wqp72TG`.

The earlier unauthenticated request really showed **Login – Vercel**. The owner's existing authorized Chrome session later opened the app and dashboard successfully. No credentials were extracted, protection/sharing setting changed, upgrade purchased, or production deployment performed.

## Actions performed and results observed

1. Selected Gaming → Help me choose in the English planner. The suggested i5-14600K, Z790, DDR5, 990 PRO, Freezer 36, RTX 5060 and RM650e appeared.
2. Added an 870 EVO, then used its own **Remove from my build** button. It disappeared while the original 990 PRO and other choices remained. Reload retained the plan and removal.
3. Started assembly. The actual 3D scene, models, dark wood, robot and upper toolbar rendered.
4. Selected the CPU and clicked the lever, plate and aiming steps. Lowering at 90 degrees did not install it. Turning left to 0 degrees allowed lowering; closing the plate and locking the lever advanced progress to 1/9.
5. Undid the lever lock: progress returned to 0/9. Reload retained the seated CPU and unlocked lever. Selecting the CPU offered **Push the lever down and lock it under its tab**, rather than restarting. Locking restored 1/9.
6. Switched to Arabic. Brand/title, controls and RTL layout changed while progress remained 1/9.
7. Selected RAM and DIMM_A2, then opened its clip. Lowering reversed RAM was refused: **اقلب الشريحة: الشق لازم يطابق بروز الفتحة.** Flipping, lowering and pressing home advanced progress to 2/9.
8. Enabled RGB. Selected the 990 PRO and explicitly chose M.2_1. Expanded controls showed the Z790 Q-Latch note citing **E21279, p. 2-8**, heatsink controls and the educational-force limitation.
9. Reload retained 2/9, RGB enabled, the drive held at 180 degrees over M.2_1, and the next action to loosen the heatsink screws. The Arabic resume message named M.2_1 and those screws.

Representative final visible text:

> ركّبت 2 من 9 قطع
>
> هلا بعودتك! نكمل من مكاننا. الدسك في يدك فوق M.2_1. M.2_1 تحت المشتّت. فك برغيين المشتّت أول.

Native accessibility state and screenshots were observed in the Codex interaction trace. This record excludes cookies, credentials and unrelated browser content. The test began from an empty planner at this branch origin; no existing learner progress was cleared. The newly created test build remains in that tab for review.

## Limits and continuation

- This is desktop Chrome on the actual protected deployment, **not a remote rerun of all 436 local assertions**. No claim is made here about deployed full-build startup, every hardware variant, mobile viewport, console monitoring or performance measurement.
- A physical phone/tablet is still pending. Desktop Chrome and touch emulation do not satisfy that gate.
- No confirmed product defect required a code edit. No main merge or production release is approved by this check.
- Complete `PHYSICAL_TOUCH_CHECKLIST.md`, repair any genuine issue found, then obtain owner approval before merging `main` or publishing production.
