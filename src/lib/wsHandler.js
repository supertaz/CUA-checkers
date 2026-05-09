import {
  ensureGame,
  joinSocket,
  leaveSocket,
  fullPayload,
  attemptMove,
  resetGame,
  undoMove,
  validateGameId,
} from './store.js';

// Rate limit: 10 ops per 5 seconds per socket
const RATE_LIMIT_OPS = Number(process.env.WS_RATE_LIMIT_OPS ?? 10);
const RATE_LIMIT_WINDOW_MS = Number(process.env.WS_RATE_LIMIT_WINDOW_MS ?? 5000);

// Backpressure: terminate slow consumers when their outbound buffer exceeds 1 MiB
export const WS_MAX_BUFFER = Number(process.env.WS_MAX_BUFFER ?? 1048576);

const VALID_ROLES = new Set(['', 'red', 'black', 'observer']);

const rateBuckets = new Map();

function getBucket(ws) {
  if (!rateBuckets.has(ws)) {
    rateBuckets.set(ws, { tokens: RATE_LIMIT_OPS, lastRefill: Date.now() });
  }
  return rateBuckets.get(ws);
}

function consumeToken(ws) {
  const bucket = getBucket(ws);
  const now = Date.now();
  const elapsed = now - bucket.lastRefill;
  if (elapsed >= RATE_LIMIT_WINDOW_MS) {
    bucket.tokens = RATE_LIMIT_OPS;
    bucket.lastRefill = now;
  }
  if (bucket.tokens <= 0) return false;
  bucket.tokens -= 1;
  return true;
}

function safeSend(ws, payload) {
  if (ws.readyState !== 1) return;
  if ((ws.bufferedAmount ?? 0) > WS_MAX_BUFFER) {
    ws.terminate();
    return;
  }
  ws.send(JSON.stringify(payload));
}

function broadcastAll(g, payload) {
  const msg = { ...payload, seq: g.seq++ };
  for (const sock of g.sockets) {
    safeSend(sock, msg);
  }
}

export function handleSocket(ws, req, query) {
  // Phase 18: validate query.game (coerce array to first element, then validate)
  let rawGame = Array.isArray(query.game) ? query.game[0] : (query.game ?? 'default');
  rawGame = String(rawGame);
  if (!validateGameId(rawGame)) {
    safeSend(ws, { type: 'error', error: 'E_INVALID_GAMEID' });
    ws.close(1008, 'invalid-game');
    return;
  }
  const gameId = rawGame;

  // Phase 18: validate query.as
  let rawAs = Array.isArray(query.as) ? query.as[0] : (query.as ?? '');
  rawAs = String(rawAs);
  if (!VALID_ROLES.has(rawAs)) {
    safeSend(ws, { type: 'error', error: 'E_INVALID_ROLE' });
    ws.close(1008, 'invalid-role');
    return;
  }
  const wanted = rawAs;

  const role = joinSocket(gameId, ws, wanted);
  const g = ensureGame(gameId);

  safeSend(ws, { type: 'hello', gameId, role, state: fullPayload(g) });
  // Notify other sockets of the new presence; joiner already has state embedded in hello.
  const presenceMsg = { type: 'presence', state: fullPayload(g), seq: g.seq++ };
  for (const s of g.sockets) {
    if (s !== ws) safeSend(s, presenceMsg);
  }

  // Prevent uncaught exceptions from ws-level errors (e.g. WS_ERR_UNSUPPORTED_MESSAGE_LENGTH)
  ws.on('error', () => {});

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      safeSend(ws, { type: 'error', error: 'malformed-json' });
      return;
    }

    const requestId = msg.requestId;

    if (msg.type === 'move') {
      // Phase 17: rate limit on control messages
      if (!consumeToken(ws)) {
        safeSend(ws, { type: 'error', error: 'E_RATE_LIMIT', ...(requestId !== undefined && { requestId }) });
        return;
      }
      const result = attemptMove(gameId, role, msg.from, msg.to);
      const g2 = ensureGame(gameId);
      if (result.ok) {
        broadcastAll(g2, { type: 'state', state: fullPayload(g2) });
        // Phase 19: echo requestId to sender on success
        if (requestId !== undefined) {
          safeSend(ws, { type: 'ack', requestId });
        }
      } else {
        safeSend(ws, { type: 'error', error: result.error, ...(requestId !== undefined && { requestId }) });
      }
    } else if (msg.type === 'reset') {
      if (role === 'observer') {
        safeSend(ws, { type: 'error', error: 'observer-cannot-control', ...(requestId !== undefined && { requestId }) });
      } else {
        // Phase 17: rate limit
        if (!consumeToken(ws)) {
          safeSend(ws, { type: 'error', error: 'E_RATE_LIMIT', ...(requestId !== undefined && { requestId }) });
          return;
        }
        resetGame(gameId);
        const g2 = ensureGame(gameId);
        broadcastAll(g2, { type: 'state', state: fullPayload(g2) });
        if (requestId !== undefined) {
          safeSend(ws, { type: 'ack', requestId });
        }
      }
    } else if (msg.type === 'undo') {
      if (role === 'observer') {
        safeSend(ws, { type: 'error', error: 'observer-cannot-control', ...(requestId !== undefined && { requestId }) });
      } else {
        // Phase 17: rate limit
        if (!consumeToken(ws)) {
          safeSend(ws, { type: 'error', error: 'E_RATE_LIMIT', ...(requestId !== undefined && { requestId }) });
          return;
        }
        const ok = undoMove(gameId);
        if (ok) {
          const g2 = ensureGame(gameId);
          broadcastAll(g2, { type: 'state', state: fullPayload(g2) });
          if (requestId !== undefined) {
            safeSend(ws, { type: 'ack', requestId });
          }
        } else {
          safeSend(ws, { type: 'error', error: 'nothing-to-undo', ...(requestId !== undefined && { requestId }) });
        }
      }
    } else {
      safeSend(ws, { type: 'error', error: 'unknown-message-type', ...(requestId !== undefined && { requestId }) });
    }
  });

  ws.on('close', () => {
    rateBuckets.delete(ws);
    leaveSocket(gameId, ws);
    const g2 = ensureGame(gameId);
    broadcastAll(g2, { type: 'presence', state: fullPayload(g2) });
  });
}
