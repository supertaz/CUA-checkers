# CUA-checkers task manifest

Source of truth: `specs.json`. This manifest tracks phase-level progress for the orchestrator.

## Process

- Orchestrator (opus) delegates all implementation to sonnet team agents.
- TDD Red-Green-Refactor; 100% line+branch coverage of `src/` before any push.
- Per-commit review: codex-rescue with `gpt-5.4-mini xhigh` reasoning. Findings → new specs.
- Pre-push review: codex-rescue with `gpt-5.5 high` reasoning. Findings → new specs.
- Loop continues until `specs.json` has zero `todo|in_progress|review` entries.

## Status legend

- `[x]` = phase fully closed (specs.json items flipped to `done` and committed)
- `[~]` = phase actively in progress on the orchestrator's main thread
- `[>]` = phase delegated, in flight on a teammate (track via TaskList)
- `[⏸]` = phase deferred-by-design, blocked on an upstream phase. Hook will not treat these as incomplete; they re-activate automatically when their dependencies clear.
- `[♻]` = phase is a recurring quality gate (fires per-commit / pre-push), not a one-shot.

## Phased plan

- [x] Phase 0: scaffold seeds (package.json, next.config.mjs, jsconfig.json, src/lib/checkers.js, src/lib/store.js, .gitignore, legacy/ move) — commit `f1e1aae`
- [>] Phase 1: dev infra (vitest + @vitest/coverage-v8 + jsdom + testing-library + supertest; coverage thresholds 100%) — sonnet teammate `infra@cua-checkers` (Task #1, in_progress). vitest.config.js, tests/setup.js, tests/smoke.test.js created; npm install / npm test pending.
- [⏸] Phase 2: TDD rules engine (Q-202) — auto-spawn after Task #1 closes
- [⏸] Phase 3: TDD store (Q-203) — auto-spawn after Task #1 closes (parallel with Phase 2)
- [⏸] Phase 4: server.js custom server with ws upgrade; src/lib/wsHandler.js — auto-spawn after Task #3 closes
- [⏸] Phase 5: TDD REST API routes (F-012, Q-204) — auto-spawn after Task #4 closes
- [⏸] Phase 6: TDD WebSocket protocol (F-013, F-015, Q-205) — auto-spawn after Task #4 closes (parallel with Phase 5)
- [⏸] Phase 7: Next.js client component (F-014 header-color theming, F-016 hints, F-017 window API, F-018 DOM parity); Q-206 component tests — auto-spawn after Task #6 closes
- [♻] Phase 8: per-commit gpt-5.4-mini xhigh adversarial review via codex plugin (R-300) — fires after each implementation commit
- [♻] Phase 9: pre-push gpt-5.5 high adversarial review via codex plugin (R-301) — gates each push
- [⏸] Phase 10: push when specs.json has no open items — gated by Phase 9 clean report
- [♻] Phase 11: absorb review findings as new specs and re-enter the loop — perpetual until specs ledger fully green

## Current orchestration state

- **Active teammates:** `infra@cua-checkers` (sonnet) — Task #1.
- **Blocked-by-design:** Tasks #2–#7 are gated through `blockedBy` chains on the team TaskList. They will be claimed (or have new teammates spawned) once dependency tasks flip to `completed`. This is intentional; do not interpret pending status as orchestrator inactivity.
- **Adversarial review gating:** Phases 8 and 9 are not single-shot tasks but recurring quality gates that fire per commit / pre push.
- **Loop termination:** All phases close only when `specs.json` has zero open entries and both review gates have passed.

## Rules

- Mark `[x]` only when the corresponding `specs.json` items are flipped to `done` AND verified.
- Never delete incomplete items.
- Findings (test failures, review hits) get appended as new spec entries with status `todo`.
