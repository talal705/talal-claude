# Codex final review — one-click installation, 2026-11-28

Review completed for product commit `fc9738f732a1108ecbe28d87178fbeea213d247a`, branch `feat/one-click-install`, based on production commit `1d744a3`.
Claude implemented the product changes; Codex reviewed source and evidence, reproduced defects, requested repairs, independently ran checks, and tested the deployed preview. No confirmed blocker remains in the reviewed scope. This review does not approve a production release.

## Result and corrected findings

- One button fits the selected part completely through existing engine steps, including orientation, placement, clips and screws. A refusal changes nothing. Other parts and cables are not installed automatically.
- AIO installation requires the complete cooler to fit: pump-only progress is not reported as success. A blocking case fan is named and must be removed through its own controls.
- Desktop controls and parts stay physically left of the scene in both languages. The mobile grid regression is fixed; the sidebar scrolls independently on desktop so lower parts can be reached while the scene stays visible.
- Robot selection, resume, next-step and help messages follow the one-click action. Place identifiers are translated in the current language.
- Each whole installation remains one Undo action after reload and after editing the plan if all its steps survive. Partially removed actions fall back to individual steps. Malformed optional grouping metadata is dropped without losing valid progress or preventing assembly from starting.
- Camera orbit, vertical view, pan and zoom remain user controlled. Explicit focus/reset controls move it; selection, installation and Undo do not request a new view.

## Verification and evidence boundaries

| Check | Source/build | Observed result |
| --- | --- | --- |
| Independent type check, translation parity, whitespace | Final product `fc9738f` | Exit 0 |
| Independent Vitest, `apps/web packages content` | Final product `fc9738f` | 89 files; 1152 passed, 21 skipped, 0 failed |
| Independent preservation review configs, 2026-11-25 and 2026-11-26 | Final product `fc9738f` | 1 + 3 passed |
| Claude production build and targeted browser acceptance | `esMaE-ShynIKrPgKJVkBf` | Build passed; EN1440 10/0, AR430 10/0 |
| Claude complete browser matrix; logs/counts inspected by Codex | `XUNzlQUOqHsdqY-cc2WY5` | EN1440 202/0, AR1440 202/0, EN430 199/0, AR430 199/0; 802 total |
| Codex deployed browser smoke | Exact product commit `fc9738f` | Successful journey below |

The final build differs from the complete-matrix build only by validation of stored optional group metadata. The final targeted checks cover valid grouped Start/Undo/reload and malformed metadata. The full matrix was not repeated on that guard build or on Vercel. Browser emulation is not a physical-device result. Skips are not passes.

Local acceptance scripts, logs, screenshots and superseded/failed harness attempts are indexed in `evidence/README.md`. Harness mistakes and environment failures remain separate from successful runs. An initial independent Vitest attempt lacked permission to listen on localhost; the permitted rerun passed. No product fix was needed for that environment error.

## Actual deployed preview

- URL: <https://talal-claude-git-feat-one-click-install-talal705.vercel.app/pc>
- Vercel dashboard: <https://vercel.com/talal705/talal-claude/GjveCrReXr1cKK2hPDcQSWzCsXNu>
- Dashboard visibly confirmed **Ready / Latest**, **Preview**, branch `feat/one-click-install`, source `fc9738f732a1108ecbe28d87178fbeea213d247a`; GitHub also reported Vercel success.
- Codex used the owner's existing authorized Chrome session. Preview authentication/protection was unchanged; anonymous access is not claimed.
- Fresh Gaming plan → one-click CPU (1/9) → one-click RAM (2/9) → Edit my build → Start assembly → one Undo removes the whole RAM (1/9) → reload → one Undo removes the whole CPU (0/9).
- The Arabic whole-action Undo messages, selected part, resumed progress, physical-left sidebar and rendered 3D scene were checked. This resolves the earlier final-preview verification gap and directly exercises the repaired planner/grouping path.

The private native screenshot is not committed: its original capture contains unrelated owner browser tabs. A cropped app-only copy is available to the owner in the Codex chat. Existing repository screenshots are local-build evidence, not claimed as deployed captures.

## Limits and release handoff

- A physical phone/tablet has not been tested; 430px runs use Chromium touch emulation. Existing quoted engine refusals can remain in the language in which they were emitted after a locale switch. The existing floating Help button overlaps the lower-left sidebar corner in Arabic, and the list scrolls past it. The 400-step save limit is unchanged.
- Public production <https://talal-claude.vercel.app/pc> has not been updated with this feature. No `main` merge or production publication was performed during this review. The approved workflow in `CLAUDE.md` reserves that final step for the owner.
- Prepare the pull request with these verification boundaries. After approval, merge normally, wait for the production deployment, confirm its source commit, and check the public URL before reporting it updated.
- Claude has received the final review and acknowledged that it will not change files or Git state while Codex finishes the review documentation and PR.
