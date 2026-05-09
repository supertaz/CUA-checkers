import { handleSocket } from '../src/lib/wsHandler.js';
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
  constructor() { this.readyState = 1; this.sent = []; this.handlers = {}; }
  on(ev, cb) { this.handlers[ev] = cb; }
  send(msg) { this.sent.push(msg); }
  emit(ev, ...args) { this.handlers[ev]?.(...args); }
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
