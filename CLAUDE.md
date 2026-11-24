# Virtual Training Environment (VTE)

Read `PROJECT_HANDOFF.md` and `docs/DECISIONS.md` for current context; older handoffs are historical. Follow the user's current instructions.

## Concise code
- Prefer the simplest complete, readable implementation. Reuse existing helpers and consolidate real duplication.
- Remove verified dead code; avoid speculative abstractions, unused options, and unnecessary layers.
- Do not minify, join statements, delete useful comments, or move code to another file merely to claim fewer lines.
- Preserve behaviour, UI, routes, saved-data keys/formats, validation, security, accessibility, translations, and test coverage.
- Keep every educational assembly step, the stable camera, click/tap controls, 3D quality, planner/assembly loading isolation, and the advanced lab.
- Long domain data and genuinely distinct rules need not be compressed. Count reductions across all affected production files, including new helpers.

## Verification and delivery
- Keep refactoring separate from feature changes. Run relevant tests, `npm run type-check`, `npm run check:messages`, and `npm run build` as appropriate.
- Report what actually passed, failed, skipped, or was not checked. Visual and deployed-preview claims require actual verification.
- Preserve unrelated work. Do not merge into `main` or deploy to production without the owner's approval.
