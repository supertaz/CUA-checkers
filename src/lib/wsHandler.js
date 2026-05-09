import {
  ensureGame,
  joinSocket,
  leaveSocket,
  fullPayload,
  attemptMove,
  resetGame,
  undoMove,
} from './store.js';

function safeSend(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function broadcastAll(g, payload) {
  for (const sock of g.sockets) {
    safeSend(sock, payload);
  }
}

export function handleSocket(ws, req, query) {
  const gameId = String(query.game ?? 'default');
  const wanted = String(query.as ?? '');
  const role = joinSocket(gameId, ws, wanted);
  const g = ensureGame(gameId);

  safeSend(ws, { type: 'hello', gameId, role, state: fullPayload(g) });
  broadcastAll(g, { type: 'presence', state: fullPayload(g) });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      safeSend(ws, { type: 'error', error: 'malformed-json' });
      return;
    }

    if (msg.type === 'move') {
      const result = attemptMove(gameId, role, msg.from, msg.to);
      const g2 = ensureGame(gameId);
      if (result.ok) {
        broadcastAll(g2, { type: 'state', state: fullPayload(g2) });
      } else {
        safeSend(ws, { type: 'error', error: result.error });
      }
    } else if (msg.type === 'reset') {
      if (role === 'observer') {
        safeSend(ws, { type: 'error', error: 'observer-cannot-control' });
      } else {
        resetGame(gameId);
        const g2 = ensureGame(gameId);
        broadcastAll(g2, { type: 'state', state: fullPayload(g2) });
      }
    } else if (msg.type === 'undo') {
      if (role === 'observer') {
        safeSend(ws, { type: 'error', error: 'observer-cannot-control' });
      } else {
        const ok = undoMove(gameId);
        if (ok) {
          const g2 = ensureGame(gameId);
          broadcastAll(g2, { type: 'state', state: fullPayload(g2) });
        } else {
          safeSend(ws, { type: 'error', error: 'nothing-to-undo' });
        }
      }
    } else {
      safeSend(ws, { type: 'error', error: 'unknown-message-type' });
    }
  });

  ws.on('close', () => {
    leaveSocket(gameId, ws);
    const g2 = ensureGame(gameId);
    broadcastAll(g2, { type: 'presence', state: fullPayload(g2) });
  });
}
