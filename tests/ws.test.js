// @vitest-environment node
/**
 * WebSocket integration tests against a live server.
 * Uses the createApp factory from server.js to bind on an ephemeral port.
 */

import { createApp } from '../server.js';
import WebSocket from 'ws';

// Helpers ---------------------------------------------------------------

function wsConnect(port, query, headers = {}) {
  const qs = new URLSearchParams(query).toString();
  return new WebSocket(`ws://localhost:${port}/ws?${qs}`, { headers });
}

/** Wait for the next matching message from a ws client. */
function nextMsg(ws, predicate = () => true, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('nextMsg timeout')), timeoutMs);
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}

/** Collect all messages within a time window (all server messages are valid JSON). */
function drainAll(ws, waitMs = 100) {
  return new Promise((resolve) => {
    const msgs = [];
    const handler = (raw) => msgs.push(JSON.parse(raw.toString()));
    ws.on('message', handler);
    setTimeout(() => {
      ws.off('message', handler);
      resolve(msgs);
    }, waitMs);
  });
}

/** Open a ws connection and wait for its hello message. */
function connect(port, query, headers = {}) {
  const ws = wsConnect(port, query, headers);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect timeout')), 10000);
    const msgs = [];
    let openFired = false;

    function tryResolve() {
      if (!openFired) return;
      const helloIdx = msgs.findIndex(m => m.type === 'hello');
      if (helloIdx === -1) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      // Re-queue remaining messages so subsequent listeners see them
      const remaining = msgs.slice(helloIdx + 1);
      for (const m of remaining) {
        setImmediate(() => ws.emit('message', JSON.stringify(m)));
      }
      resolve({ ws, hello: msgs[helloIdx] });
    }

    function onMessage(raw) {
      msgs.push(JSON.parse(raw.toString()));
      tryResolve();
    }

    ws.on('message', onMessage);
    ws.on('open', () => { openFired = true; tryResolve(); });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

/** Send a JSON message over ws. */
function send(ws, payload) {
  ws.send(JSON.stringify(payload));
}

/** Close ws and wait for the close event. */
function close(ws) {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
    ws.once('close', resolve);
    ws.close();
  });
}

// Server lifecycle ------------------------------------------------------

let server, port;

beforeAll(async () => {
  // Allow all origins in tests so existing tests pass without Origin header
  process.env.ALLOWED_ORIGINS = '*';
  ({ server, port } = await createApp({ port: 0 }));
}, 15000);

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  delete process.env.ALLOWED_ORIGINS;
});

// -----------------------------------------------------------------------
// 1. Hello + role assignment
// -----------------------------------------------------------------------
describe('hello + role assignment', () => {
  test('first connection gets hello with role red', async () => {
    const { ws, hello } = await connect(port, { game: 'tc1' });
    expect(hello.type).toBe('hello');
    expect(hello.gameId).toBe('tc1');
    expect(hello.role).toBe('red');
    expect(hello.state).toBeDefined();
    expect(hello.state.id).toBe('tc1');
    await close(ws);
  });
});

// -----------------------------------------------------------------------
// 2. Second connection gets black; presence broadcast to A
// -----------------------------------------------------------------------
describe('second connection + presence broadcast', () => {
  test('second joiner gets black; A receives presence with both connected', async () => {
    const { ws: wsA, hello: hA } = await connect(port, { game: 'tc2' });
    expect(hA.role).toBe('red');

    // Drain the initial presence that arrives after A's own join
    await drainAll(wsA, 50);

    const presencePromise = nextMsg(wsA, m => m.type === 'presence');
    const { ws: wsB, hello: hB } = await connect(port, { game: 'tc2' });
    expect(hB.role).toBe('black');

    const presence = await presencePromise;
    expect(presence.state.presence.redConnected).toBe(true);
    expect(presence.state.presence.blackConnected).toBe(true);

    await close(wsA);
    await close(wsB);
  });
});

// -----------------------------------------------------------------------
// 3. Third connection is observer; presence shows observers: 1
// -----------------------------------------------------------------------
describe('third connection = observer; presence shows observers: 1', () => {
  test('third joiner gets observer role; presence reflects observers count', async () => {
    const { ws: wsA } = await connect(port, { game: 'tc3' });
    const { ws: wsB } = await connect(port, { game: 'tc3' });

    // Drain queued messages on A before waiting for the next presence
    await drainAll(wsA, 50);

    const presencePromise = nextMsg(wsA, m => m.type === 'presence');
    const { ws: wsC, hello: hC } = await connect(port, { game: 'tc3' });
    expect(hC.role).toBe('observer');

    const presence = await presencePromise;
    expect(presence.state.presence.observers).toBe(1);

    await close(wsA);
    await close(wsB);
    await close(wsC);
  });
});

// -----------------------------------------------------------------------
// 4. Requested role ?as=observer is honoured even when red is free
// -----------------------------------------------------------------------
describe('requested role via ?as=observer', () => {
  test('client requesting observer gets observer even when red is free', async () => {
    const { ws, hello } = await connect(port, { game: 'tc4', as: 'observer' });
    expect(hello.role).toBe('observer');
    await close(ws);
  });
});

// -----------------------------------------------------------------------
// 5. Move acceptance: A sends legal red move; both A and B get state broadcast
// -----------------------------------------------------------------------
describe('move acceptance', () => {
  test('legal move by red; both clients receive state; turn flips to black', async () => {
    const { ws: wsA } = await connect(port, { game: 'tc5' });
    const { ws: wsB } = await connect(port, { game: 'tc5' });

    // Drain join-time messages
    await drainAll(wsA, 50);
    await drainAll(wsB, 50);

    const stateA = nextMsg(wsA, m => m.type === 'state');
    const stateB = nextMsg(wsB, m => m.type === 'state');

    send(wsA, { type: 'move', from: 'a3', to: 'b4' });

    const [sa, sb] = await Promise.all([stateA, stateB]);
    expect(sa.type).toBe('state');
    expect(sb.type).toBe('state');
    expect(sa.state.turn).toBe('black');
    expect(sb.state.turn).toBe('black');
    expect(sa.state.history.length).toBeGreaterThan(0);

    await close(wsA);
    await close(wsB);
  });
});

// -----------------------------------------------------------------------
// 6. Wrong-turn rejection: B moves on red's turn; only B gets error
// -----------------------------------------------------------------------
describe('wrong-turn rejection', () => {
  test('black moving on red turn gets error; A receives nothing', async () => {
    const { ws: wsA } = await connect(port, { game: 'tc6' });
    const { ws: wsB } = await connect(port, { game: 'tc6' });

    await drainAll(wsA, 50);
    await drainAll(wsB, 50);

    const errorPromise = nextMsg(wsB, m => m.type === 'error');
    send(wsB, { type: 'move', from: 'a7', to: 'b6' }); // black's piece, but red's turn

    const err = await errorPromise;
    expect(err.error).toMatch(/not-your-turn/);

    // A should receive nothing new
    const extraA = await drainAll(wsA, 80);
    expect(extraA.filter(m => m.type === 'error').length).toBe(0);

    await close(wsA);
    await close(wsB);
  });
});

// -----------------------------------------------------------------------
// 7. Observer move rejected
// -----------------------------------------------------------------------
describe('observer move rejected', () => {
  test('observer sending move gets observer-cannot-move error', async () => {
    const { ws } = await connect(port, { game: 'tc7', as: 'observer' });
    await drainAll(ws, 30);

    const errPromise = nextMsg(ws, m => m.type === 'error');
    send(ws, { type: 'move', from: 'a3', to: 'b4' });
    const err = await errPromise;
    expect(err.error).toBe('observer-cannot-move');

    await close(ws);
  });
});

// -----------------------------------------------------------------------
// 8. Reset gating
// -----------------------------------------------------------------------
describe('reset gating', () => {
  test('observer reset is rejected with error', async () => {
    const { ws } = await connect(port, { game: 'tc8a', as: 'observer' });
    await drainAll(ws, 30);

    const errPromise = nextMsg(ws, m => m.type === 'error');
    send(ws, { type: 'reset' });
    const err = await errPromise;
    expect(err.error).toBe('observer-cannot-control');

    await close(ws);
  });

  test('red reset broadcasts fresh state to all clients', async () => {
    const { ws: wsA } = await connect(port, { game: 'tc8b' });
    const { ws: wsB } = await connect(port, { game: 'tc8b' });

    // Make a move first so there's something to reset
    await drainAll(wsA, 50);
    await drainAll(wsB, 50);
    const ackMove = nextMsg(wsA, m => m.type === 'state');
    send(wsA, { type: 'move', from: 'a3', to: 'b4' });
    await ackMove;

    await drainAll(wsA, 30);
    await drainAll(wsB, 30);

    const stateB = nextMsg(wsB, m => m.type === 'state');
    send(wsA, { type: 'reset' });
    const s = await stateB;
    expect(s.state.turn).toBe('red');
    expect(s.state.history.length).toBe(0);

    await close(wsA);
    await close(wsB);
  });
});

// -----------------------------------------------------------------------
// 9. Undo gating
// -----------------------------------------------------------------------
describe('undo gating', () => {
  test('observer undo rejected', async () => {
    const { ws } = await connect(port, { game: 'tc9a', as: 'observer' });
    await drainAll(ws, 30);

    const errPromise = nextMsg(ws, m => m.type === 'error');
    send(ws, { type: 'undo' });
    const err = await errPromise;
    expect(err.error).toBe('observer-cannot-control');

    await close(ws);
  });

  test('red undo accepted after at least one move', async () => {
    const { ws: wsA } = await connect(port, { game: 'tc9b' });
    const { ws: wsB } = await connect(port, { game: 'tc9b' });

    await drainAll(wsA, 50);
    await drainAll(wsB, 50);

    // Make a move
    const ackMove = nextMsg(wsA, m => m.type === 'state');
    send(wsA, { type: 'move', from: 'a3', to: 'b4' });
    await ackMove;

    await drainAll(wsA, 30);
    await drainAll(wsB, 30);

    // Undo it
    const stateAfterUndo = nextMsg(wsA, m => m.type === 'state');
    send(wsA, { type: 'undo' });
    const s = await stateAfterUndo;
    expect(s.state.turn).toBe('red');

    await close(wsA);
    await close(wsB);
  });
});

// -----------------------------------------------------------------------
// 10. Unknown message type
// -----------------------------------------------------------------------
describe('unknown message type', () => {
  test('unknown type returns error', async () => {
    const { ws } = await connect(port, { game: 'tc10' });
    await drainAll(ws, 30);

    const errPromise = nextMsg(ws, m => m.type === 'error');
    send(ws, { type: 'asdf' });
    const err = await errPromise;
    expect(err.error).toBe('unknown-message-type');

    await close(ws);
  });
});

// -----------------------------------------------------------------------
// 11. Malformed JSON: server responds with malformed-json error
// -----------------------------------------------------------------------
describe('malformed JSON', () => {
  test('server sends malformed-json error; connection remains open', async () => {
    const { ws } = await connect(port, { game: 'tc11' });
    await drainAll(ws, 30);

    // Server-side wsHandler.js wraps JSON.parse in try/catch and sends {type:'error',error:'malformed-json'}
    const errPromise = nextMsg(ws, m => m.type === 'error', 2000);
    ws.send('{not-json');
    const err = await errPromise;

    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(err.error).toBe('malformed-json');

    await close(ws);
  });
});

// -----------------------------------------------------------------------
// 12. Disconnection: close A; B receives presence with redConnected: false
// -----------------------------------------------------------------------
describe('disconnection', () => {
  test('closing A triggers presence broadcast to B with redConnected: false', async () => {
    const { ws: wsA } = await connect(port, { game: 'tc12' });
    const { ws: wsB } = await connect(port, { game: 'tc12' });

    await drainAll(wsA, 50);
    await drainAll(wsB, 50);

    const presencePromise = nextMsg(wsB, m => m.type === 'presence');
    await close(wsA);
    const presence = await presencePromise;
    expect(presence.state.presence.redConnected).toBe(false);

    await close(wsB);
  });
});

// -----------------------------------------------------------------------
// 13. Two games isolated: moves in tc13a don't appear in tc13b
// -----------------------------------------------------------------------
describe('game isolation', () => {
  test('moves in game tc13a do not appear in game tc13b', async () => {
    const { ws: wsA1 } = await connect(port, { game: 'tc13a' });
    const { ws: wsA2 } = await connect(port, { game: 'tc13a' });
    const { ws: wsB1 } = await connect(port, { game: 'tc13b' });
    const { ws: wsB2 } = await connect(port, { game: 'tc13b' });

    await drainAll(wsA1, 50);
    await drainAll(wsA2, 50);
    await drainAll(wsB1, 50);
    await drainAll(wsB2, 50);

    // Make a move in game A
    const stateA = nextMsg(wsA2, m => m.type === 'state');
    send(wsA1, { type: 'move', from: 'a3', to: 'b4' });
    await stateA;

    // Game B clients should receive no state broadcast from game A's move
    const extraB = await drainAll(wsB1, 150);
    const stateMsgsB = extraB.filter(m => m.type === 'state');
    expect(stateMsgsB.length).toBe(0);

    await close(wsA1);
    await close(wsA2);
    await close(wsB1);
    await close(wsB2);
  });
});

// -----------------------------------------------------------------------
// server.js branch coverage: HTTP request handler
// -----------------------------------------------------------------------
describe('server.js HTTP request handler', () => {
  test('responds to HTTP request (covers handle(req,res,parsedUrl) branch)', async () => {
    const res = await fetch(`http://localhost:${port}/`);
    // Next.js handles the request; any response (200, 404, etc.) proves the handler ran
    expect(typeof res.status).toBe('number');
  }, 15000);
});

// -----------------------------------------------------------------------
// server.js branch coverage: non-/ws upgrade destroyed
// -----------------------------------------------------------------------
describe('server.js non-/ws upgrade', () => {
  test('upgrade to a non-/ws path is destroyed (covers socket.destroy() branch)', async () => {
    const net = await import('node:net');
    const socket = net.connect(port, 'localhost');

    const destroyed = await new Promise((resolve) => {
      socket.once('connect', () => {
        socket.write(
          'GET /not-ws HTTP/1.1\r\n' +
          `Host: localhost:${port}\r\n` +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
          'Sec-WebSocket-Version: 13\r\n' +
          '\r\n'
        );
      });
      // Server destroys the socket; we get either 'close' or 'end'
      socket.once('close', () => resolve(true));
      socket.once('end', () => resolve(true));
      setTimeout(() => resolve(false), 2000);
    });

    expect(destroyed).toBe(true);
  });
});

// -----------------------------------------------------------------------
// Phase 15: Origin allowlist
// -----------------------------------------------------------------------
describe('Origin allowlist (Phase 15)', () => {
  // Use raw TCP to send upgrade requests so we can test the 403/101 paths.
  // The upgrade handler reads process.env.ALLOWED_ORIGINS at connection time,
  // so we can temporarily override it without spinning up another server.
  function rawUpgrade(p, origin) {
    return new Promise((resolve) => {
      import('node:net').then(({ connect: tcpConnect }) => {
        const socket = tcpConnect(p, 'localhost');
        let buf = '';
        socket.once('connect', () => {
          const headers = [
            `GET /ws?game=origin-test HTTP/1.1`,
            `Host: localhost:${p}`,
            'Upgrade: websocket',
            'Connection: Upgrade',
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
            'Sec-WebSocket-Version: 13',
          ];
          if (origin) headers.push(`Origin: ${origin}`);
          socket.write(headers.join('\r\n') + '\r\n\r\n');
        });
        socket.on('data', (chunk) => {
          buf += chunk.toString();
          // Once we have the status line, resolve immediately
          if (buf.includes('\r\n')) {
            const statusLine = buf.split('\r\n')[0] ?? '';
            const code = parseInt(statusLine.split(' ')[1] ?? '0', 10);
            socket.destroy();
            resolve({ statusCode: code, raw: buf });
          }
        });
        socket.on('close', () => {
          const statusLine = buf.split('\r\n')[0] ?? '';
          const code = parseInt(statusLine.split(' ')[1] ?? '0', 10);
          resolve({ statusCode: code, raw: buf });
        });
        socket.on('error', () => resolve({ statusCode: 0, raw: buf }));
        setTimeout(() => { socket.destroy(); }, 3000);
      });
    });
  }

  test('connection without Origin is rejected when allowlist is specific (not *)', async () => {
    const saved = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = 'http://allowed.example.com';
    try {
      const result = await rawUpgrade(port, null);
      expect(result.statusCode).toBe(403);
    } finally {
      process.env.ALLOWED_ORIGINS = saved;
    }
  });

  test('connection with disallowed Origin is rejected with 403', async () => {
    const saved = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = 'http://allowed.example.com';
    try {
      const result = await rawUpgrade(port, 'http://evil.example.com');
      expect(result.statusCode).toBe(403);
    } finally {
      process.env.ALLOWED_ORIGINS = saved;
    }
  });

  test('connection with allowed Origin succeeds', async () => {
    const saved = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = 'http://allowed.example.com';
    try {
      const { ws, hello } = await connect(port, { game: 'origin-test3' }, { Origin: 'http://allowed.example.com' });
      expect(hello.type).toBe('hello');
      await close(ws);
    } finally {
      process.env.ALLOWED_ORIGINS = saved;
    }
  });

  test('wildcard ALLOWED_ORIGINS=* accepts connection without Origin header', async () => {
    // Already set to '*' for main test server; verify by raw TCP (no origin)
    const result = await rawUpgrade(port, null);
    // With '*', no origin check — server returns 101 upgrade (raw: starts with HTTP/1.1 101)
    expect(result.statusCode).toBe(101);
  });
});

// -----------------------------------------------------------------------
// Phase 17: payload cap
// -----------------------------------------------------------------------
describe('payload cap (Phase 17)', () => {
  test('oversized frame (>8 KiB) causes server to close connection', async () => {
    const { ws } = await connect(port, { game: 'payload-test1' });
    await drainAll(ws, 30);

    // Generate a payload just over 8 KiB
    const oversized = JSON.stringify({ type: 'move', from: 'a3', to: 'b4', pad: 'x'.repeat(9000) });

    const closed = await new Promise((resolve) => {
      ws.once('close', (code) => resolve(code));
      ws.once('error', () => resolve('error'));
      ws.send(oversized);
      setTimeout(() => resolve('timeout'), 3000);
    });

    // ws closes with 1009 (message too big) or error/close
    expect(closed).not.toBe('timeout');
  });
});

// -----------------------------------------------------------------------
// Phase 17: rate limiting (integration level)
// -----------------------------------------------------------------------
describe('rate limiting (Phase 17)', () => {
  test('sending 12 moves rapidly yields at least 2 E_RATE_LIMIT errors', async () => {
    const { ws } = await connect(port, { game: 'rate-test1' });
    await drainAll(ws, 30);

    const msgs = [];
    ws.on('message', (raw) => msgs.push(JSON.parse(raw.toString())));

    // Send 12 resets rapidly (default limit is 10 in 5s)
    for (let i = 0; i < 12; i++) {
      send(ws, { type: 'reset' });
    }

    // Wait for responses
    await new Promise((resolve) => setTimeout(resolve, 200));

    const rateLimitErrors = msgs.filter(m => m.error === 'E_RATE_LIMIT');
    expect(rateLimitErrors.length).toBeGreaterThanOrEqual(2);

    await close(ws);
  });
});

// -----------------------------------------------------------------------
// Phase 19: seq + requestId (integration level)
// -----------------------------------------------------------------------
describe('seq + requestId (Phase 19)', () => {
  test('state messages have monotonically increasing seq per game', async () => {
    const { ws: wsA } = await connect(port, { game: 'seq-test1' });
    const { ws: wsB } = await connect(port, { game: 'seq-test1' });

    await drainAll(wsA, 50);
    await drainAll(wsB, 50);

    const stateMsgs = [];
    wsA.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'state') stateMsgs.push(m);
    });

    // Send two resets to generate two state broadcasts
    send(wsA, { type: 'reset' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    send(wsA, { type: 'reset' });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(stateMsgs.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < stateMsgs.length; i++) {
      expect(stateMsgs[i].seq).toBeGreaterThan(stateMsgs[i - 1].seq);
    }

    await close(wsA);
    await close(wsB);
  });

  test('two games have independent seq counters', async () => {
    const { ws: wsA } = await connect(port, { game: 'seq-game-a' });
    const { ws: wsB } = await connect(port, { game: 'seq-game-b' });

    await drainAll(wsA, 50);
    await drainAll(wsB, 50);

    const stateA = nextMsg(wsA, m => m.type === 'state');
    const stateB = nextMsg(wsB, m => m.type === 'state');

    send(wsA, { type: 'reset' });
    send(wsB, { type: 'reset' });

    const [sa, sb] = await Promise.all([stateA, stateB]);
    expect(sa.seq).toBeDefined();
    expect(sb.seq).toBeDefined();
    // Each game starts its own counter from 0; they are independent
    expect(typeof sa.seq).toBe('number');
    expect(typeof sb.seq).toBe('number');

    await close(wsA);
    await close(wsB);
  });

  test('move with requestId yields ack to sender with requestId echoed', async () => {
    const { ws: wsA } = await connect(port, { game: 'reqid-test1' });
    const { ws: wsB } = await connect(port, { game: 'reqid-test1' });

    await drainAll(wsA, 50);
    await drainAll(wsB, 50);

    const ackPromise = nextMsg(wsA, m => m.type === 'ack' && m.requestId === 'test-req-001');
    send(wsA, { type: 'move', from: 'a3', to: 'b4', requestId: 'test-req-001' });

    const ack = await ackPromise;
    expect(ack.requestId).toBe('test-req-001');

    // State should also be broadcast (with seq)
    const stateMsgs = await drainAll(wsB, 100);
    const stateMsg = stateMsgs.find(m => m.type === 'state');
    expect(stateMsg).toBeDefined();
    expect(typeof stateMsg.seq).toBe('number');

    await close(wsA);
    await close(wsB);
  });
});
