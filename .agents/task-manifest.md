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
- [x] Phase 6: TDD WebSocket protocol (F-013, Q-205) — `ws-tdd@cua-checkers` commit `92dcb9e` (17 integration tests, 100% server.js coverage)
- [x] Phase 7: Next.js client + role-color theming (F-014, F-016, F-017, F-018, Q-206) — commit `b07f4a8` (`client-impl@cua-checkers`) 64 tests, 100% coverage on CheckersClient.jsx
- [♻] Phase 8: per-commit codex adversarial review (R-300) — gpt-5.4-mini xhigh via `codex:codex-rescue` subagent
- [♻] Phase 9: pre-push codex adversarial review (R-301) — gpt-5.5 high via `codex:codex-rescue` subagent
- [⏸] Phase 10: push to origin when all gates green — blocked by Phase 9
- [♻] Phase 11: iterate on findings — perpetual until specs.json fully green
- [x] Phase 12: Fix store.joinSocket idempotency (F-RVW-9d6491e-2) — commit `5e174b0` (`joinsocket-fix@cua-checkers`)
- [x] Phase 13: Audit Next 15.1.6 advisory and upgrade (F-RVW-9d6491e-4) — `security-audit@cua-checkers`
- [x] Phase 14: server.listen error wiring (F-RVW-c98f5ca-1) — `server-bootstrap-hardening@cua-checkers` (tests/server.test.js, 100% coverage)
- [x] Phase 15: Origin allowlist on /ws upgrade — CSWSH (F-RVW-c98f5ca-2) — `ws-protocol-hardening@cua-checkers` commit `a3bffc6`
- [x] Phase 16: Graceful shutdown + .catch on createApp (F-RVW-c98f5ca-3) — `server-bootstrap-hardening@cua-checkers` (tests/server.test.js, 100% coverage)
- [x] Phase 17: WS payload cap + control-message rate limit (F-RVW-c98f5ca-4) — `ws-protocol-hardening@cua-checkers` commit `a3bffc6`
- [x] Phase 18: Validate query.game / query.as (F-RVW-c98f5ca-5) — `ws-protocol-hardening@cua-checkers` commit `a3bffc6`
- [x] Phase 19: Per-game seq + requestId echo on broadcasts (F-RVW-c98f5ca-6) — `ws-protocol-hardening@cua-checkers` commit `a3bffc6`
- [x] Phase 20: Status codes for /moves (F-RVW-3eae194-1) — `rest-hardening-recovery@cua-checkers` 403/409/422 per error code
- [x] Phase 21: REST gameId validation (F-RVW-3eae194-2) — `rest-hardening-recovery@cua-checkers` validateGameId at all entry points
- [x] Phase 22: Spec entries for POST /games + DELETE /games/:id (F-RVW-3eae194-3) — F-020 + F-021 added
- [x] Phase 23: REST DELETE broadcast on reset (F-RVW-3eae194-4) — `rest-hardening-recovery@cua-checkers` broadcast after resetGame
- [x] Phase 24: broadcast spy assertion in api.test.js (F-RVW-3eae194-5) — `rest-hardening-recovery@cua-checkers`
- [x] Phase 25: behavior assertions in api.test.js (F-RVW-3eae194-6) — `rest-hardening-recovery@cua-checkers`
- [x] Phase 26: DELETE non-existent id → 404 (F-RVW-3eae194-7) — `rest-hardening-recovery@cua-checkers`
- [x] Phase 27: Response envelope normalization (F-RVW-3eae194-8) — `phase27-envelope@cua-checkers` {ok,data}/{ok,error} on all 6 REST endpoints
- [x] Phase 28: Async graceful shutdown for SIGINT/SIGTERM (F-RVW-batch1-2)
- [x] Phase 29: WS backpressure + heartbeat (F-RVW-batch1-3) — commit `f644c5b`
- [x] Phase 30: Stabilize test suite — per-file timeout / pool-split for tests/server.test.js (F-INFRA-1) — bumped testTimeout 5000->10000 in tests/server.test.js

## Active workers

- `server-impl@cua-checkers` (sonnet, Phase 4)
- `codex-reviewer-phase23@cua-checkers` (codex plugin, Phase 8 review of `a351afd`+`22654af`)
- `infra@cua-checkers` (sonnet, idle since Phase 1)

## Last landed commit

`f644c5b` — Phase 29 (backpressure+heartbeat): WS_MAX_BUFFER safeSend guard + ping/pong heartbeat in createApp; 6 wsHandler unit tests + 3 ws integration tests; 100% coverage on server.js and wsHandler.js.
