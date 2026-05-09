// @vitest-environment node
/**
 * WebSocket integration tests against a live server.
 * Uses the createApp factory from server.js to bind on an ephemeral port.
 */

import { createApp } from '../server.js';
import WebSocket from 'ws';

// Helpers ---------------------------------------------------------------

function wsConnect(port, query) {
  const qs = new URLSearchParams(query).toString();
  return new WebSocket(`ws://localhost:${port}/ws?${qs}`);
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
function connect(port, query) {
  const ws = wsConnect(port, query);
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
  ({ server, port } = await createApp({ port: 0 }));
}, 15000);

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
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
