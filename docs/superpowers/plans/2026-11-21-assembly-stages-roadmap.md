# Assembly stages 3–11 — roadmap and acceptance checklist

Development milestones (not one mandatory physical order). Each stage gets its own detailed plan
(`docs/superpowers/plans/2026-11-21-stage<N>-*.md`) written when it starts, after reading the exact
models' documents. A stage is "done" only when its verification gate (brief, section P) passes.

| Stage | Plan | Status |
|---|---|---|
| 3 — M.2 storage | `2026-11-21-stage3-m2-storage.md` | implemented;31-case M.2 browser regression passed (EN desktop); see final review |
| 4 — CPU cooling (air, AIO) | `2026-11-22-stage4-cpu-cooling.md` | reviewed current cooling fixes;40 air +16 AIO local browser checks passed; documented hardware approximations remain |
| 5 — Motherboard into case | 2026-11-25 completion scope / review | carried-assembly blocker repaired; independent probe and AIO carried-board browser path pass |
| 6 — Power supply | 2026-11-25 completion scope / review | independent fitting/removal covered by24-case PSU/SATA/fan browser run (EN desktop) |
| 7 — SATA SSD / HDD | 2026-11-25 completion scope / review | selectable bays/fasteners covered by24-case PSU/SATA/fan browser run; duplicate planner removal8 EN + 8 AR passed |
| 8 — Graphics card | 2026-11-27 completion | install, removal and reinstall browser run in en/ar at desktop and 430 px (41 each), including power and side-panel guards; cover/screw counts remain approximations; awaiting Codex review |
| 9 — Case fans | 2026-11-25 completion scope / review | position/orientation/supplied-fan paths covered by PSU/SATA/fan and AIO browser runs; exact device/geometry limits remain documented |
| 10 — Wiring | 2026-11-26 Codex small-fix handoff | per-end disconnect UI, actual/alternate sockets, clickable ends, physical shared-PSU-source save derivation (+ legacy list migration) implemented; unit suite and targeted real-browser runs pass (see `PROJECT_HANDOFF.md` top); Codex reviewed current fixes; remaining manual/visual limits in final review |
| 11 — Final check and startup | 2026-11-25 completion scope / review | readiness steps (panel, mains, PSU switch, power button, power off) as saved `sys:` steps, engine-only startup judgement (no optional-part prerequisite), failure/recovery implemented; browser runs pass (see `PROJECT_HANDOFF.md` top); Codex reviewed current fixes; remaining manual/visual limits in final review |

2026-11-25: the owner authorized continuing through Stage 11 without another stage-approval pause.
Current reviewed branch is `fix/wiring-handoff-2026-11-26`; earlier `feat/assembly-completion` notes are historical. This is not a production release.
See `docs/handoff/2026-11-25/review/IMPLEMENTATION_SCOPE.txt`, `CODEX_REVIEW.md` and `RESUME_CLAUDE.txt`.
The 2026-11-25 carried-board reproduction was subsequently fixed. Continue branch `fix/wiring-handoff-2026-11-26` from
`docs/handoff/2026-11-26/CODEX_SMALL_FIXES_HANDOFF.md`; current results and remaining verification limits are in `docs/handoff/2026-11-26/CODEX_FINAL_REVIEW.md`.

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
