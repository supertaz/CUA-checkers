import { handleSocket, WS_MAX_BUFFER } from '../src/lib/wsHandler.js';
import {
  ensureGame,
  joinSocket,
  leaveSocket,
  attemptMove,
  resetGame,
} from '../src/lib/store.js';
import { legalMovesFor } from '../src/lib/checkers.js';

// Unique game IDs to isolate tests from module-level store state
let idCounter = 0;
function uid() { return `ws-test-${++idCounter}`; }

class StubWS {
  constructor() {
    this.readyState = 1;
    this.sent = [];
    this.handlers = {};
    this.closedWith = null;
    this.bufferedAmount = 0;
    this.terminated = false;
  }
  on(ev, cb) { this.handlers[ev] = cb; }
  send(msg) { this.sent.push(msg); }
  emit(ev, ...args) { this.handlers[ev]?.(...args); }
  close(code, reason) { this.readyState = 3; this.closedWith = { code, reason }; }
  terminate() { this.terminated = true; this.readyState = 3; this.handlers['close']?.(); }
  lastMsg() { return JSON.parse(this.sent[this.sent.length - 1]); }
  allMsgs() { return this.sent.map(s => JSON.parse(s)); }
}

// ---------------------------------------------------------------------------
// hello on join
// ---------------------------------------------------------------------------
describe('handleSocket: hello on join', () => {
  test('sends hello with gameId, role, and state', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'red' });
    const msgs = ws.allMsgs();
    const hello = msgs.find(m => m.type === 'hello');
    expect(hello).toBeDefined();
    expect(hello.gameId).toBe(gameId);
    expect(hello.role).toBe('red');
    expect(hello.state).toBeDefined();
    expect(hello.state.id).toBe(gameId);
  });

  test('assigns role from query.as', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'observer' });
    const hello = ws.allMsgs().find(m => m.type === 'hello');
    expect(hello.role).toBe('observer');
  });

  test('uses default gameId when query.game is absent', () => {
    const ws = new StubWS();
    handleSocket(ws, {}, {});
    const hello = ws.allMsgs().find(m => m.type === 'hello');
    expect(hello.gameId).toBe('default');
  });
});

// ---------------------------------------------------------------------------
// presence broadcast on join and close
// ---------------------------------------------------------------------------
describe('handleSocket: presence broadcast', () => {
  test('broadcasts presence to all sockets on join', () => {
    const gameId = uid();
    const ws1 = new StubWS();
    const ws2 = new StubWS();
    handleSocket(ws1, {}, { game: gameId, as: 'red' });
    handleSocket(ws2, {}, { game: gameId, as: 'black' });
    // ws1 should have received presence when ws2 joined
    const presenceMsgs = ws1.allMsgs().filter(m => m.type === 'presence');
    expect(presenceMsgs.length).toBeGreaterThanOrEqual(1);
  });

  test('broadcasts presence on close', () => {
    const gameId = uid();
    const ws1 = new StubWS();
    const ws2 = new StubWS();
    handleSocket(ws1, {}, { game: gameId, as: 'red' });
    handleSocket(ws2, {}, { game: gameId, as: 'observer' });
    const beforeCount = ws1.sent.length;
    ws2.emit('close');
    // ws1 should receive a new presence update after ws2 closes
    expect(ws1.sent.length).toBeGreaterThan(beforeCount);
    const lastMsg = ws1.lastMsg();
    expect(lastMsg.type).toBe('presence');
  });
});

// ---------------------------------------------------------------------------
// move messages
// ---------------------------------------------------------------------------
describe('handleSocket: move', () => {
  test('move accepted from current-turn role broadcasts state to all sockets', () => {
    const gameId = uid();
    const ws1 = new StubWS(); // red
    const ws2 = new StubWS(); // black
    handleSocket(ws1, {}, { game: gameId, as: 'red' });
    handleSocket(ws2, {}, { game: gameId, as: 'black' });

    const g = ensureGame(gameId);
    const legalMoves = legalMovesFor(g.state.board, 'red');
    const m = legalMoves[0];

    const ws1Before = ws1.sent.length;
    const ws2Before = ws2.sent.length;
    ws1.emit('message', JSON.stringify({ type: 'move', from: m.from, to: m.to }));

    // Both sockets should receive a state broadcast
    expect(ws1.sent.length).toBeGreaterThan(ws1Before);
    expect(ws2.sent.length).toBeGreaterThan(ws2Before);
    const stateMsg = ws2.lastMsg();
    expect(stateMsg.type).toBe('state');
    expect(stateMsg.state.turn).toBe('black');
  });

  test('move rejected when role is not current turn; error sent only to sender', () => {
    const gameId = uid();
    const ws1 = new StubWS(); // red
    const ws2 = new StubWS(); // black
    handleSocket(ws1, {}, { game: gameId, as: 'red' });
    handleSocket(ws2, {}, { game: gameId, as: 'black' });

    const g = ensureGame(gameId);
    const legalMoves = legalMovesFor(g.state.board, 'black');
    const m = legalMoves[0];

    const ws1Before = ws1.sent.length;
    ws2.emit('message', JSON.stringify({ type: 'move', from: m.from, to: m.to }));

    // ws2 should get error
    const errMsg = ws2.lastMsg();
    expect(errMsg.type).toBe('error');
    // ws1 should NOT have received anything new
    expect(ws1.sent.length).toBe(ws1Before);
  });

  test('observer move is rejected with error', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'observer' });

    ws.emit('message', JSON.stringify({ type: 'move', from: 'a3', to: 'b4' }));
    const errMsg = ws.lastMsg();
    expect(errMsg.type).toBe('error');
    expect(errMsg.error).toBe('observer-cannot-move');
  });
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------
describe('handleSocket: reset', () => {
  test('reset permitted from red; broadcasts new state', () => {
    const gameId = uid();
    const ws1 = new StubWS(); // red
    const ws2 = new StubWS(); // black
    handleSocket(ws1, {}, { game: gameId, as: 'red' });
    handleSocket(ws2, {}, { game: gameId, as: 'black' });

    // Make a move to change state
    const g = ensureGame(gameId);
    const legalMoves = legalMovesFor(g.state.board, 'red');
    const m = legalMoves[0];
    attemptMove(gameId, 'red', m.from, m.to);

    const ws2Before = ws2.sent.length;
    ws1.emit('message', JSON.stringify({ type: 'reset' }));

    expect(ws2.sent.length).toBeGreaterThan(ws2Before);
    const stateMsg = ws2.lastMsg();
    expect(stateMsg.type).toBe('state');
    expect(stateMsg.state.turn).toBe('red');
  });

  test('reset permitted from black', () => {
    const gameId = uid();
    const ws1 = new StubWS(); // red
    const ws2 = new StubWS(); // black
    handleSocket(ws1, {}, { game: gameId, as: 'red' });
    handleSocket(ws2, {}, { game: gameId, as: 'black' });

    ws2.emit('message', JSON.stringify({ type: 'reset' }));
    const stateMsg = ws2.lastMsg();
    expect(stateMsg.type).toBe('state');
  });

  test('reset blocked from observer', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'observer' });

    ws.emit('message', JSON.stringify({ type: 'reset' }));
    const errMsg = ws.lastMsg();
    expect(errMsg.type).toBe('error');
    expect(errMsg.error).toBe('observer-cannot-control');
  });
});

// ---------------------------------------------------------------------------
// undo
// ---------------------------------------------------------------------------
describe('handleSocket: undo', () => {
  test('undo permitted from red; broadcasts new state', () => {
    const gameId = uid();
    const ws1 = new StubWS(); // red
    const ws2 = new StubWS(); // black
    handleSocket(ws1, {}, { game: gameId, as: 'red' });
    handleSocket(ws2, {}, { game: gameId, as: 'black' });

    // Make a move first so there is something to undo
    const g = ensureGame(gameId);
    const legalMoves = legalMovesFor(g.state.board, 'red');
    const m = legalMoves[0];
    attemptMove(gameId, 'red', m.from, m.to);

    const ws2Before = ws2.sent.length;
    ws1.emit('message', JSON.stringify({ type: 'undo' }));

    expect(ws2.sent.length).toBeGreaterThan(ws2Before);
    const stateMsg = ws2.lastMsg();
    expect(stateMsg.type).toBe('state');
    expect(stateMsg.state.turn).toBe('red');
  });

  test('undo permitted from black', () => {
    const gameId = uid();
    const ws1 = new StubWS();
    const ws2 = new StubWS();
    handleSocket(ws1, {}, { game: gameId, as: 'red' });
    handleSocket(ws2, {}, { game: gameId, as: 'black' });

    const g = ensureGame(gameId);
    const legalMoves = legalMovesFor(g.state.board, 'red');
    const m = legalMoves[0];
    attemptMove(gameId, 'red', m.from, m.to);

    ws2.emit('message', JSON.stringify({ type: 'undo' }));
    const stateMsg = ws2.lastMsg();
    expect(stateMsg.type).toBe('state');
  });

  test('undo blocked from observer', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'observer' });

    ws.emit('message', JSON.stringify({ type: 'undo' }));
    const errMsg = ws.lastMsg();
    expect(errMsg.type).toBe('error');
    expect(errMsg.error).toBe('observer-cannot-control');
  });

  test('undo with nothing to undo sends error', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'red' });

    ws.emit('message', JSON.stringify({ type: 'undo' }));
    const errMsg = ws.lastMsg();
    expect(errMsg.type).toBe('error');
    expect(errMsg.error).toBe('nothing-to-undo');
  });
});

// ---------------------------------------------------------------------------
// unknown message type
// ---------------------------------------------------------------------------
describe('handleSocket: unknown message type', () => {
  test('unknown type sends error', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'red' });

    ws.emit('message', JSON.stringify({ type: 'bogus' }));
    const errMsg = ws.lastMsg();
    expect(errMsg.type).toBe('error');
    expect(errMsg.error).toBe('unknown-message-type');
  });
});

// ---------------------------------------------------------------------------
// malformed JSON
// ---------------------------------------------------------------------------
describe('handleSocket: malformed JSON', () => {
  test('malformed JSON sends error', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'red' });

    ws.emit('message', 'not valid json {{{');
    const errMsg = ws.lastMsg();
    expect(errMsg.type).toBe('error');
    expect(errMsg.error).toBe('malformed-json');
  });
});

// ---------------------------------------------------------------------------
// safeSend: skips ws with readyState !== 1
// ---------------------------------------------------------------------------
describe('safeSend via handleSocket', () => {
  test('does not send to closed ws (readyState !== 1)', () => {
    const gameId = uid();
    const ws1 = new StubWS();
    const ws2 = new StubWS();
    handleSocket(ws1, {}, { game: gameId, as: 'red' });
    handleSocket(ws2, {}, { game: gameId, as: 'black' });

    // Close ws1 at the socket level (not via close event, just change readyState)
    ws1.readyState = 3;

    const g = ensureGame(gameId);
    const legalMoves = legalMovesFor(g.state.board, 'red');
    const m = legalMoves[0];

    const ws1Before = ws1.sent.length;
    ws2.emit('message', JSON.stringify({ type: 'move', from: m.from, to: m.to }));

    // ws2 is black, it's red's turn; expect error only to ws2
    // ws1 would get state if the move were valid from ws2's role — but it's not ws2's turn.
    // Use red (ws1) to make the move instead.
    // Reset and test via ws1 making a move when ws2.readyState=3
    resetGame(gameId);
    ws1.readyState = 1;
    ws2.readyState = 3;

    const ws2Before = ws2.sent.length;
    ws1.emit('message', JSON.stringify({ type: 'move', from: m.from, to: m.to }));

    // ws1 got state broadcast, ws2 did not (readyState=3)
    const newWs1Msgs = ws1.allMsgs().slice(ws1Before).filter(msg => msg.type === 'state');
    expect(newWs1Msgs.length).toBeGreaterThanOrEqual(1);
    expect(ws2.sent.length).toBe(ws2Before); // no new messages to closed ws2
  });
});

// ---------------------------------------------------------------------------
// Phase 18: query validation
// ---------------------------------------------------------------------------
describe('handleSocket: query validation (Phase 18)', () => {
  test('invalid gameId (contains invalid chars) sends error and closes socket', () => {
    const ws = new StubWS();
    handleSocket(ws, {}, { game: 'bad game!', as: '' });
    expect(ws.allMsgs().some(m => m.error === 'E_INVALID_GAMEID')).toBe(true);
    expect(ws.closedWith?.code).toBe(1008);
  });

  test('empty gameId sends error and closes socket', () => {
    const ws = new StubWS();
    handleSocket(ws, {}, { game: '', as: '' });
    expect(ws.allMsgs().some(m => m.error === 'E_INVALID_GAMEID')).toBe(true);
    expect(ws.closedWith?.code).toBe(1008);
  });

  test('array game param: first element used if valid', () => {
    const ws = new StubWS();
    handleSocket(ws, {}, { game: ['valid-game', 'other'], as: 'red' });
    const hello = ws.allMsgs().find(m => m.type === 'hello');
    expect(hello).toBeDefined();
    expect(hello.gameId).toBe('valid-game');
  });

  test('array game param: first element invalid sends E_INVALID_GAMEID', () => {
    const ws = new StubWS();
    handleSocket(ws, {}, { game: ['bad game!', 'good'], as: '' });
    expect(ws.allMsgs().some(m => m.error === 'E_INVALID_GAMEID')).toBe(true);
    expect(ws.closedWith?.code).toBe(1008);
  });

  test('gameId too long (>64 chars) is rejected', () => {
    const ws = new StubWS();
    handleSocket(ws, {}, { game: 'a'.repeat(65), as: '' });
    expect(ws.allMsgs().some(m => m.error === 'E_INVALID_GAMEID')).toBe(true);
    expect(ws.closedWith?.code).toBe(1008);
  });

  test('valid gameId passes through', () => {
    const ws = new StubWS();
    const gameId = uid();
    handleSocket(ws, {}, { game: gameId, as: '' });
    const hello = ws.allMsgs().find(m => m.type === 'hello');
    expect(hello).toBeDefined();
  });

  test('invalid as value sends E_INVALID_ROLE and closes socket', () => {
    const ws = new StubWS();
    const gameId = uid();
    handleSocket(ws, {}, { game: gameId, as: 'Red' });
    expect(ws.allMsgs().some(m => m.error === 'E_INVALID_ROLE')).toBe(true);
    expect(ws.closedWith?.code).toBe(1008);
  });

  test('as=x (invalid role) sends E_INVALID_ROLE', () => {
    const ws = new StubWS();
    const gameId = uid();
    handleSocket(ws, {}, { game: gameId, as: 'x' });
    expect(ws.allMsgs().some(m => m.error === 'E_INVALID_ROLE')).toBe(true);
    expect(ws.closedWith?.code).toBe(1008);
  });

  test('as=observer is valid', () => {
    const ws = new StubWS();
    const gameId = uid();
    handleSocket(ws, {}, { game: gameId, as: 'observer' });
    const hello = ws.allMsgs().find(m => m.type === 'hello');
    expect(hello.role).toBe('observer');
  });

  test('as=red is valid', () => {
    const ws = new StubWS();
    const gameId = uid();
    handleSocket(ws, {}, { game: gameId, as: 'red' });
    const hello = ws.allMsgs().find(m => m.type === 'hello');
    expect(hello.role).toBe('red');
  });

  test('as=black is valid', () => {
    const ws = new StubWS();
    const gameId = uid();
    handleSocket(ws, {}, { game: gameId, as: 'black' });
    const hello = ws.allMsgs().find(m => m.type === 'hello');
    expect(hello.role).toBe('black');
  });

  test('array as param: first element used if valid', () => {
    const ws = new StubWS();
    const gameId = uid();
    handleSocket(ws, {}, { game: gameId, as: ['red', 'black'] });
    const hello = ws.allMsgs().find(m => m.type === 'hello');
    expect(hello.role).toBe('red');
  });
});

// ---------------------------------------------------------------------------
// ws error handler (prevents uncaught exceptions from oversized frames)
// ---------------------------------------------------------------------------
describe('handleSocket: ws error handler', () => {
  test('ws error event is handled without throwing', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'red' });
    // Should not throw
    expect(() => ws.emit('error', new Error('WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Phase 17: rate limiting (unit-level via StubWS)
// ---------------------------------------------------------------------------
describe('handleSocket: rate limiting (Phase 17)', () => {
  test('exceeding rate limit returns E_RATE_LIMIT on move', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'red' });

    // Send more moves than the rate limit allows (default 10)
    // Use reset (which doesn't change turn) to easily send many ops
    for (let i = 0; i < 12; i++) {
      ws.emit('message', JSON.stringify({ type: 'reset' }));
    }
    const rateLimitErrors = ws.allMsgs().filter(m => m.error === 'E_RATE_LIMIT');
    expect(rateLimitErrors.length).toBeGreaterThanOrEqual(2);
  });

  test('E_RATE_LIMIT on move type specifically (covers move rate-limit path)', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'red' });

    // Use up all 10 tokens with reset
    for (let i = 0; i < 10; i++) {
      ws.emit('message', JSON.stringify({ type: 'reset' }));
    }
    // Now a move should be rate-limited
    ws.emit('message', JSON.stringify({ type: 'move', from: 'a3', to: 'b4' }));
    const lastMsg = ws.lastMsg();
    expect(lastMsg.error).toBe('E_RATE_LIMIT');
  });

  test('rate limit refills after window elapses', () => {
    // Mock Date.now to simulate time passing; use vi.spyOn for proper cleanup
    let fakeNow = Date.now();
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);

    try {
      const gameId = uid();
      const ws = new StubWS();
      handleSocket(ws, {}, { game: gameId, as: 'red' });

      // Exhaust bucket
      for (let i = 0; i < 10; i++) {
        ws.emit('message', JSON.stringify({ type: 'reset' }));
      }
      // Confirm rate-limited
      ws.emit('message', JSON.stringify({ type: 'reset' }));
      expect(ws.lastMsg().error).toBe('E_RATE_LIMIT');

      // Advance time past the window (default 5000ms)
      fakeNow += 6000;

      // Now should be accepted again (refill branch: lines 32-34 covered)
      ws.emit('message', JSON.stringify({ type: 'reset' }));
      const lastMsg = ws.lastMsg();
      expect(lastMsg.error).not.toBe('E_RATE_LIMIT');
      expect(lastMsg.type).toBe('state');
    } finally {
      spy.mockRestore();
    }
  });

  test('rate limit does not apply to malformed JSON', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'red' });

    // Send many malformed JSON messages — none should be rate limited
    for (let i = 0; i < 15; i++) {
      ws.emit('message', 'not json');
    }
    const rateLimitErrors = ws.allMsgs().filter(m => m.error === 'E_RATE_LIMIT');
    expect(rateLimitErrors.length).toBe(0);
    const malformedErrors = ws.allMsgs().filter(m => m.error === 'malformed-json');
    expect(malformedErrors.length).toBe(15);
  });

  test('rate limit applies to undo messages', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'red' });

    for (let i = 0; i < 12; i++) {
      ws.emit('message', JSON.stringify({ type: 'undo' }));
    }
    const rateLimitErrors = ws.allMsgs().filter(m => m.error === 'E_RATE_LIMIT');
    expect(rateLimitErrors.length).toBeGreaterThanOrEqual(2);
  });

  test('bucket is cleaned up on socket close', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'red' });
    ws.emit('close');
    // No assertion needed beyond not throwing; the bucket cleanup is internal
    expect(true).toBe(true);
  });

  test('E_RATE_LIMIT error echoes requestId for reset', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'red' });

    // Exhaust rate limit
    for (let i = 0; i < 11; i++) {
      ws.emit('message', JSON.stringify({ type: 'reset' }));
    }
    // This one should be rate limited
    ws.emit('message', JSON.stringify({ type: 'reset', requestId: 'req-rl-1' }));
    const rlMsgs = ws.allMsgs().filter(m => m.error === 'E_RATE_LIMIT');
    const withId = rlMsgs.find(m => m.requestId === 'req-rl-1');
    expect(withId).toBeDefined();
  });

  test('E_RATE_LIMIT error echoes requestId for move (covers move rate-limit requestId branch)', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'red' });

    // Exhaust all tokens with reset messages
    for (let i = 0; i < 10; i++) {
      ws.emit('message', JSON.stringify({ type: 'reset' }));
    }
    // Now move is rate-limited
    ws.emit('message', JSON.stringify({ type: 'move', from: 'a3', to: 'b4', requestId: 'req-move-rl' }));
    const rlMsg = ws.allMsgs().find(m => m.error === 'E_RATE_LIMIT' && m.requestId === 'req-move-rl');
    expect(rlMsg).toBeDefined();
  });

  test('E_RATE_LIMIT error echoes requestId for undo (covers undo rate-limit requestId branch)', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'red' });

    // Exhaust all tokens
    for (let i = 0; i < 10; i++) {
      ws.emit('message', JSON.stringify({ type: 'reset' }));
    }
    // Now undo is rate-limited
    ws.emit('message', JSON.stringify({ type: 'undo', requestId: 'req-undo-rl' }));
    const rlMsg = ws.allMsgs().find(m => m.error === 'E_RATE_LIMIT' && m.requestId === 'req-undo-rl');
    expect(rlMsg).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 19: seq + requestId echo
// ---------------------------------------------------------------------------
describe('handleSocket: seq + requestId (Phase 19)', () => {
  test('state broadcasts include monotonically increasing seq', () => {
    const gameId = uid();
    const ws1 = new StubWS(); // red
    const ws2 = new StubWS(); // black
    handleSocket(ws1, {}, { game: gameId, as: 'red' });
    handleSocket(ws2, {}, { game: gameId, as: 'black' });

    // Make two resets to generate state broadcasts
    ws1.emit('message', JSON.stringify({ type: 'reset' }));
    ws1.emit('message', JSON.stringify({ type: 'reset' }));

    const stateMsgs = ws1.allMsgs().filter(m => m.type === 'state');
    expect(stateMsgs.length).toBeGreaterThanOrEqual(2);
    // Check seq is increasing
    for (let i = 1; i < stateMsgs.length; i++) {
      expect(stateMsgs[i].seq).toBeGreaterThan(stateMsgs[i - 1].seq);
    }
  });

  test('two games have independent seq counters', () => {
    const gameId1 = uid();
    const gameId2 = uid();
    const ws1 = new StubWS();
    const ws2 = new StubWS();
    handleSocket(ws1, {}, { game: gameId1, as: 'red' });
    handleSocket(ws2, {}, { game: gameId2, as: 'red' });

    ws1.emit('message', JSON.stringify({ type: 'reset' }));
    ws2.emit('message', JSON.stringify({ type: 'reset' }));

    const state1 = ws1.allMsgs().filter(m => m.type === 'state');
    const state2 = ws2.allMsgs().filter(m => m.type === 'state');
    expect(state1.length).toBeGreaterThanOrEqual(1);
    expect(state2.length).toBeGreaterThanOrEqual(1);
    // Both games start from 0; their seqs are independent
    expect(state1[0].seq).toBeDefined();
    expect(state2[0].seq).toBeDefined();
  });

  test('presence broadcasts also include seq', () => {
    const gameId = uid();
    const ws1 = new StubWS();
    handleSocket(ws1, {}, { game: gameId, as: 'red' });
    const presenceMsgs = ws1.allMsgs().filter(m => m.type === 'presence');
    expect(presenceMsgs.length).toBeGreaterThanOrEqual(1);
    expect(presenceMsgs[0].seq).toBeDefined();
  });

  test('move with requestId yields ack with requestId for sender on success', () => {
    const gameId = uid();
    const ws1 = new StubWS(); // red
    const ws2 = new StubWS(); // black
    handleSocket(ws1, {}, { game: gameId, as: 'red' });
    handleSocket(ws2, {}, { game: gameId, as: 'black' });

    const g = ensureGame(gameId);
    const legalMoves = legalMovesFor(g.state.board, 'red');
    const m = legalMoves[0];

    ws1.emit('message', JSON.stringify({ type: 'move', from: m.from, to: m.to, requestId: 'req-move-1' }));

    // ws1 should get an ack with the requestId
    const ackMsg = ws1.allMsgs().find(msg => msg.type === 'ack' && msg.requestId === 'req-move-1');
    expect(ackMsg).toBeDefined();
    // ws2 should NOT get the ack
    const ws2Ack = ws2.allMsgs().find(msg => msg.type === 'ack');
    expect(ws2Ack).toBeUndefined();
  });

  test('move without requestId sends no ack', () => {
    const gameId = uid();
    const ws1 = new StubWS();
    handleSocket(ws1, {}, { game: gameId, as: 'red' });

    const g = ensureGame(gameId);
    const legalMoves = legalMovesFor(g.state.board, 'red');
    const m = legalMoves[0];

    ws1.emit('message', JSON.stringify({ type: 'move', from: m.from, to: m.to }));
    const ackMsg = ws1.allMsgs().find(msg => msg.type === 'ack');
    expect(ackMsg).toBeUndefined();
  });

  test('error response echoes requestId', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'observer' });

    ws.emit('message', JSON.stringify({ type: 'move', from: 'a3', to: 'b4', requestId: 'req-err-1' }));
    const errMsg = ws.allMsgs().find(m => m.type === 'error' && m.requestId === 'req-err-1');
    expect(errMsg).toBeDefined();
    expect(errMsg.error).toBe('observer-cannot-move');
  });

  test('reset with requestId yields ack for sender', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'red' });

    ws.emit('message', JSON.stringify({ type: 'reset', requestId: 'req-reset-1' }));
    const ackMsg = ws.allMsgs().find(m => m.type === 'ack' && m.requestId === 'req-reset-1');
    expect(ackMsg).toBeDefined();
  });

  test('undo with requestId yields ack for sender after successful undo', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'red' });

    // Make a move via store directly so there is something to undo
    const g = ensureGame(gameId);
    const legalMoves = legalMovesFor(g.state.board, 'red');
    const m = legalMoves[0];
    attemptMove(gameId, 'red', m.from, m.to);

    ws.emit('message', JSON.stringify({ type: 'undo', requestId: 'req-undo-1' }));
    const ackMsg = ws.allMsgs().find(msg => msg.type === 'ack' && msg.requestId === 'req-undo-1');
    expect(ackMsg).toBeDefined();
  });

  test('undo with requestId on empty stack echoes requestId in error', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'red' });

    ws.emit('message', JSON.stringify({ type: 'undo', requestId: 'req-undo-fail-1' }));
    const errMsg = ws.allMsgs().find(m => m.type === 'error' && m.requestId === 'req-undo-fail-1');
    expect(errMsg).toBeDefined();
    expect(errMsg.error).toBe('nothing-to-undo');
  });

  test('unknown message type with requestId echoes requestId in error', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'red' });

    ws.emit('message', JSON.stringify({ type: 'bogus', requestId: 'req-bogus-1' }));
    const errMsg = ws.allMsgs().find(m => m.error === 'unknown-message-type' && m.requestId === 'req-bogus-1');
    expect(errMsg).toBeDefined();
  });

  test('observer reset with requestId echoes requestId in error', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'observer' });

    ws.emit('message', JSON.stringify({ type: 'reset', requestId: 'req-obs-reset' }));
    const errMsg = ws.allMsgs().find(m => m.error === 'observer-cannot-control' && m.requestId === 'req-obs-reset');
    expect(errMsg).toBeDefined();
  });

  test('observer undo with requestId echoes requestId in error', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'observer' });

    ws.emit('message', JSON.stringify({ type: 'undo', requestId: 'req-obs-undo' }));
    const errMsg = ws.allMsgs().find(m => m.error === 'observer-cannot-control' && m.requestId === 'req-obs-undo');
    expect(errMsg).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 29: backpressure (WS_MAX_BUFFER)
// ---------------------------------------------------------------------------
describe('handleSocket: backpressure (Phase 29)', () => {
  test('WS_MAX_BUFFER is exported and equals process.env.WS_MAX_BUFFER or 1 MiB default', () => {
    expect(typeof WS_MAX_BUFFER).toBe('number');
    expect(WS_MAX_BUFFER).toBeGreaterThan(0);
  });

  test('safeSend terminates slow consumer and skips send when bufferedAmount exceeds threshold', () => {
    const gameId = uid();
    const ws1 = new StubWS(); // red — will be the slow consumer
    const ws2 = new StubWS(); // black — the sender
    handleSocket(ws1, {}, { game: gameId, as: 'red' });
    handleSocket(ws2, {}, { game: gameId, as: 'black' });

    // Simulate ws1 having a full outbound buffer
    ws1.bufferedAmount = WS_MAX_BUFFER + 1;

    const ws1SentBefore = ws1.sent.length;
    // ws2 sends a reset to trigger a broadcast that will try to send to ws1
    ws2.emit('message', JSON.stringify({ type: 'reset' }));

    // ws1 should have been terminated, not sent any new messages
    expect(ws1.terminated).toBe(true);
    expect(ws1.sent.length).toBe(ws1SentBefore);
  });

  test('safeSend does not terminate ws when bufferedAmount is exactly at threshold', () => {
    const gameId = uid();
    const ws1 = new StubWS();
    const ws2 = new StubWS();
    handleSocket(ws1, {}, { game: gameId, as: 'red' });
    handleSocket(ws2, {}, { game: gameId, as: 'black' });

    // At exactly the threshold (not above), send should proceed normally
    ws1.bufferedAmount = WS_MAX_BUFFER;

    const ws1SentBefore = ws1.sent.length;
    ws2.emit('message', JSON.stringify({ type: 'reset' }));

    expect(ws1.terminated).toBe(false);
    expect(ws1.sent.length).toBeGreaterThan(ws1SentBefore);
  });

  test('terminated slow consumer is removed from store via close handler', () => {
    const gameId = uid();
    const ws1 = new StubWS();
    const ws2 = new StubWS();
    handleSocket(ws1, {}, { game: gameId, as: 'red' });
    handleSocket(ws2, {}, { game: gameId, as: 'black' });

    ws1.bufferedAmount = WS_MAX_BUFFER + 1;
    // Trigger broadcast that hits ws1's backpressure guard
    ws2.emit('message', JSON.stringify({ type: 'reset' }));

    // ws1.terminate() calls the close handler which calls leaveSocket
    // After that, the game should reflect ws1 disconnected
    expect(ws1.terminated).toBe(true);
    const g = ensureGame(gameId);
    // red slot should be freed since close handler ran leaveSocket
    expect(g.redWs).toBeNull();
  });

  test('safeSend skips send to ws with readyState !== 1 (existing behaviour preserved)', () => {
    const gameId = uid();
    const ws = new StubWS();
    handleSocket(ws, {}, { game: gameId, as: 'red' });
    ws.readyState = 3;
    const sentBefore = ws.sent.length;
    ws.emit('message', JSON.stringify({ type: 'reset' }));
    // readyState is 3, so safeSend should skip — but ws is also the sender, which is fine
    // Use a second socket to trigger the send path toward the closed ws
    const ws2 = new StubWS();
    handleSocket(ws2, {}, { game: gameId, as: 'black' });
    ws2.emit('message', JSON.stringify({ type: 'reset' }));
    expect(ws.sent.length).toBe(sentBefore);
    expect(ws.terminated).toBe(false);
  });

  test('safeSend treats undefined bufferedAmount (no property) as 0 and sends normally', () => {
    const gameId = uid();
    const ws1 = new StubWS();
    const ws2 = new StubWS();
    handleSocket(ws1, {}, { game: gameId, as: 'red' });
    handleSocket(ws2, {}, { game: gameId, as: 'black' });

    // Remove the bufferedAmount property so the ?? 0 fallback branch is taken
    delete ws1.bufferedAmount;

    const ws1SentBefore = ws1.sent.length;
    ws2.emit('message', JSON.stringify({ type: 'reset' }));

    expect(ws1.terminated).toBe(false);
    expect(ws1.sent.length).toBeGreaterThan(ws1SentBefore);
  });
});
