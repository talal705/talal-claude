# Assembly stages 3–11 — roadmap and acceptance checklist

Development milestones (not one mandatory physical order). Each stage gets its own detailed plan
(`docs/superpowers/plans/2026-11-21-stage<N>-*.md`) written when it starts, after reading the exact
models' documents. A stage is "done" only when its verification gate (brief, section P) passes.

| Stage | Plan | Status |
|---|---|---|
| 3 — M.2 storage | `2026-11-21-stage3-m2-storage.md` | implemented and verified locally; awaiting review |
| 4 — CPU cooling (air, AIO) | `2026-11-22-stage4-cpu-cooling.md` | implemented, awaiting Codex review (`feat/stage4-cooling`) |
| 5 — Motherboard into case | 2026-11-25 completion scope / review | existing fitting + new removal under review; carried-assembly cable blocker confirmed |
| 6 — Power supply | 2026-11-25 completion scope / review | independent fitting and per-screw removal implemented; final acceptance pending |
| 7 — SATA SSD / HDD | 2026-11-25 completion scope / review | selectable bay + staged fasteners implemented; scene/robot targets and final acceptance pending |
| 8 — Graphics card | 2026-11-25 completion scope / review | individual slot covers (`slot-covers:N`) and per-screw bracket steps implemented and unit-tested; browser acceptance pending |
| 9 — Case fans | 2026-11-25 completion scope / review | position choices, orientation advice, the case's own fans as selectable parts (`sfan`), no automatic fan moves for a radiator, rear-fan/I/O clearance implemented and unit-tested; browser and visual acceptance pending |
| 10 — Wiring | 2026-11-25 completion scope / review | existing per-end flow retained; remaining review and final acceptance pending |
| 11 — Final check and startup | 2026-11-25 completion scope / review | existing engine startup retained; final readiness actions and full acceptance pending |

2026-11-25: the owner authorized continuing through Stage 11 without another stage-approval pause.
The isolated branch is `feat/assembly-completion`. This is a **partial checkpoint**, not a release.
See `docs/handoff/2026-11-25/review/IMPLEMENTATION_SCOPE.txt`, `CODEX_REVIEW.md` and `RESUME_CLAUDE.txt`.
Claude is temporarily quota-limited; the independent review reproduction for internal carried-board cables still fails.

## Already present before Stage 3 (to audit, not rebuild)

Q-Latch M.2, cooler prep (paste, film), I/O shield and standoff prep, PSU fan orientation, fan airflow,
GPU slot covers, latch and bracket screws, cable ends and ports, startup stages. Each later stage starts
by checking these against the brief and the exact model's manual.

## Acceptance checklist applied to every stage

- [ ] Correct installation and removal by click/tap; keyboard follows the same rules.
- [ ] Wrong sequence, wrong orientation, incompatible and occupied targets refused with a short reason and the next useful action.
- [ ] Required vs optional steps distinguished; duplicate instances tracked separately.
- [ ] Undo reverses exactly one meaningful step; physical removal is a separate path.
- [ ] Save/reload mid-step; existing-save migration tested; plan change keeps unrelated progress.
- [ ] No camera movement except explicit view/zoom; a camera drag never acts on a part.
- [ ] Robot: one short state-specific line, EN and AR, names the actual part/slot/connector.
- [ ] CPU and RAM regressions re-run.
- [ ] Tests, type check, translation parity, production build; browser check incl. 430 px width.
- [ ] Handoff updated: behaviour, files, commits, sources with pages, commands and results, skipped checks, approximations.
