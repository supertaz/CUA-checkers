# CUA-checkers task manifest

**Canonical source: `.agents/task-manifest.json`.** This file mirrors its `phases` array as a status-marked checklist for the Stop hook. Edit the JSON; this file's status markers are derived.

## Rules

- Agents MUST NOT delete items from the manifest. Only the `status` field of an item may be updated. New items may be appended.
- See `rules` block in `task-manifest.json` for the full status enum and allowed transitions.

## Status legend

- `[x]` = phase fully closed (specs.json items flipped to `done`; landing commit recorded)
- `[~]` = phase actively in progress on the orchestrator's main thread
- `[>]` = phase delegated; in flight on a teammate (track via TaskList)
- `[⏸]` = phase deferred; blocked on an upstream phase (auto-activates when dependencies clear)
- `[♻]` = phase is a recurring quality gate (per-commit / pre-push); never reaches terminal `done`

## Phases (mirror of `task-manifest.json.phases`)

- [x] Phase 0: scaffold seeds — commit `f1e1aae`
- [x] Phase 1: dev infra (vitest + 100% coverage thresholds) — commit `9d6491e` (`infra@cua-checkers`)
- [x] Phase 2: TDD rules engine (Q-201, Q-202) — commit `a351afd` (`rules-tdd@cua-checkers`)
- [x] Phase 3: TDD store (Q-203) — commit `22654af`
- [x] Phase 4: server.js + src/lib/wsHandler.js — `server-impl@cua-checkers` (commit c98f5ca)
- [x] Phase 5: TDD REST API routes (F-012, Q-204) — `api-tdd@cua-checkers` (commit 3eae194)
- [⏸] Phase 6: TDD WebSocket protocol (F-013, F-015, Q-205) — blocked by Phase 4
- [⏸] Phase 7: Next.js client + role-color theming (F-014, F-016, F-017, F-018, Q-206) — blocked by Phase 6
- [♻] Phase 8: per-commit codex adversarial review (R-300) — gpt-5.4-mini xhigh via `codex:codex-rescue` subagent
- [♻] Phase 9: pre-push codex adversarial review (R-301) — gpt-5.5 high via `codex:codex-rescue` subagent
- [⏸] Phase 10: push to origin when all gates green — blocked by Phase 9
- [♻] Phase 11: iterate on findings — perpetual until specs.json fully green
- [x] Phase 12: Fix store.joinSocket idempotency (F-RVW-9d6491e-2) — commit `5e174b0` (`joinsocket-fix@cua-checkers`)
- [x] Phase 13: Audit Next 15.1.6 advisory and upgrade (F-RVW-9d6491e-4) — `security-audit@cua-checkers`
- [>] Phase 14: server.listen error wiring (F-RVW-c98f5ca-1) — `server-bootstrap-hardening@cua-checkers`
- [⏸] Phase 15: Origin allowlist on /ws upgrade — CSWSH (F-RVW-c98f5ca-2) — awaiting Phase 6 landing then `ws-protocol-hardening` teammate
- [>] Phase 16: Graceful shutdown + .catch on createApp (F-RVW-c98f5ca-3) — `server-bootstrap-hardening@cua-checkers`
- [⏸] Phase 17: WS payload cap + control-message rate limit (F-RVW-c98f5ca-4) — awaiting Phase 6 landing then `ws-protocol-hardening` teammate
- [⏸] Phase 18: Validate query.game / query.as (F-RVW-c98f5ca-5) — awaiting Phase 6 landing then `ws-protocol-hardening` teammate
- [⏸] Phase 19: Per-game seq + requestId echo on broadcasts (F-RVW-c98f5ca-6) — awaiting Phase 6 landing then `ws-protocol-hardening` teammate

## Active workers

- `server-impl@cua-checkers` (sonnet, Phase 4)
- `codex-reviewer-phase23@cua-checkers` (codex plugin, Phase 8 review of `a351afd`+`22654af`)
- `infra@cua-checkers` (sonnet, idle since Phase 1)

## Last landed commit

`5e174b0` — joinSocket idempotency fix (Phase 12): 5 new tests (38 total in store.test.js), store.js 100% coverage, F-RVW-9d6491e-2 done.
