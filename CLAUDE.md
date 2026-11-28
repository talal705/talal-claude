# Virtual Training Environment (VTE)

Read `PROJECT_HANDOFF.md` and `docs/DECISIONS.md` for current context; older handoffs are historical. Follow the user's current instructions.

## Concise code
- Prefer the simplest complete, readable implementation. Reuse existing helpers and consolidate real duplication.
- Remove verified dead code; avoid speculative abstractions, unused options, and unnecessary layers.
- Do not minify, join statements, delete useful comments, or move code to another file merely to claim fewer lines.
- Preserve behaviour, UI, routes, saved-data keys/formats, validation, security, accessibility, translations, and test coverage.
- One click installs the selected part completely (owner decision 23, 2026-11-28): orientation, place, latches, clips and screws through the engine's own steps, saved as one Undo-able action; a refusal changes nothing. Manual mechanical steps stay available as secondary controls but are never mandatory. This supersedes the earlier rule that every educational assembly step needed its own click.
- Keep the educational explanations of those steps, click/tap controls, 3D quality, planner/assembly loading isolation, and the advanced lab.
- The camera is the learner's: free orbit, vertical angle, pan and zoom; only their own "Focus selected part" and "Reset view" move it otherwise. Installing, selecting and re-rendering never do.
- Long domain data and genuinely distinct rules need not be compressed. Count reductions across all affected production files, including new helpers.

## Verification and delivery
- Keep refactoring separate from feature changes. Run relevant tests, `npm run type-check`, `npm run check:messages`, and `npm run build` as appropriate.
- Report what actually passed, failed, skipped, or was not checked. Visual and deployed-preview claims require actual verification.
- Preserve unrelated work. Do not merge into `main` or deploy to production without the owner's approval.
