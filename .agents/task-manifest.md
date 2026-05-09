# CUA-checkers task manifest

Source of truth: `specs.json`. This manifest tracks phase-level progress for the orchestrator.

## Process

- Orchestrator (opus) delegates all implementation to sonnet team agents.
- TDD Red-Green-Refactor; 100% line+branch coverage of `src/` before any push.
- Per-commit review: codex-rescue with `gpt-5.4-mini xhigh` reasoning. Findings → new specs.
- Pre-push review: codex-rescue with `gpt-5.5 high` reasoning. Findings → new specs.
- Loop continues until `specs.json` has zero `todo|in_progress|review` entries.

## Phased plan

- [x] Phase 0: scaffold seeds (package.json, next.config.mjs, jsconfig.json, src/lib/checkers.js, src/lib/store.js, .gitignore, legacy/ move)
- [ ] Phase 1: dev infra (vitest + @vitest/coverage-v8 + jsdom + testing-library + supertest; coverage thresholds 100%)
- [ ] Phase 2: TDD rules engine (Q-202)
- [ ] Phase 3: TDD store (Q-203)
- [ ] Phase 4: server.js custom server with ws upgrade; src/lib/wsHandler.js
- [ ] Phase 5: TDD REST API routes (F-012, Q-204)
- [ ] Phase 6: TDD WebSocket protocol (F-013, F-015, Q-205)
- [ ] Phase 7: Next.js client component (F-014 header-color theming, F-016 hints, F-017 window API, F-018 DOM parity); Q-206 component tests
- [ ] Phase 8: per-commit gpt-5.4-mini xhigh review of latest commit; absorb findings as new specs (R-300)
- [ ] Phase 9: pre-push gpt-5.5 high review of unpushed commits (R-301); absorb findings
- [ ] Phase 10: push when specs.json has no open items
- [ ] Phase 11: iterate (re-enter at earliest open spec)

## Rules

- Mark `[x]` only when the corresponding `specs.json` items are flipped to `done` AND verified.
- Never delete incomplete items.
- Findings (test failures, review hits) get appended as new spec entries with status `todo`.
