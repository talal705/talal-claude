# Assembly stages 3–11 — roadmap and acceptance checklist

Development milestones (not one mandatory physical order). Each stage gets its own detailed plan
(`docs/superpowers/plans/2026-11-21-stage<N>-*.md`) written when it starts, after reading the exact
models' documents. A stage is "done" only when its verification gate (brief, section P) passes.

| Stage | Plan | Status |
|---|---|---|
| 3 — M.2 storage | `2026-11-21-stage3-m2-storage.md` | implemented and verified locally; awaiting review |
| 4 — CPU cooling (air, AIO) | not written | not started |
| 5 — Motherboard into case | not written | not started |
| 6 — Power supply | not written | not started |
| 7 — SATA SSD / HDD | not written | not started |
| 8 — Graphics card | not written | not started |
| 9 — Case fans | not written | not started |
| 10 — Wiring | not written | not started |
| 11 — Final check and startup | not written | not started |

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
