import {
  ensureGame,
  listGames,
  presence,
  fullPayload,
  joinSocket,
  leaveSocket,
  broadcast,
  attemptMove,
  resetGame,
  undoMove,
} from '../src/lib/store.js';
import { legalMovesFor } from '../src/lib/checkers.js';

// store.js uses a module-level Map. We need to isolate tests from each other
// by using unique game IDs per test.

let idCounter = 0;
function uid() { return `test-game-${++idCounter}`; }

function mockWs(readyState = 1) {
  return { readyState, send: vi.fn() };
}

// ---------------------------------------------------------------------------
// ensureGame
// ---------------------------------------------------------------------------
describe('ensureGame', () => {
  test('creates a new game with correct shape', () => {
    const id = uid();
    const g = ensureGame(id);
    expect(g.id).toBe(id);
    expect(g.state).toBeDefined();
    expect(g.state.turn).toBe('red');
    expect(g.sockets).toBeInstanceOf(Set);
    expect(g.redWs).toBeNull();
    expect(g.blackWs).toBeNull();
    expect(g.observers).toBeInstanceOf(Set);
  });

  test('is idempotent — returns same game on repeated calls', () => {
    const id = uid();
    const g1 = ensureGame(id);
    const g2 = ensureGame(id);
    expect(g1).toBe(g2);
  });

  test('default id is "default"', () => {
    // Calling without an argument uses id="default"
    const g = ensureGame();
    expect(g.id).toBe('default');
  });
});

// ---------------------------------------------------------------------------
// listGames
// ---------------------------------------------------------------------------
describe('listGames', () => {
  test('includes created game with presence flags', () => {
    const id = uid();
    ensureGame(id);
    const list = listGames();
    const entry = list.find(g => g.id === id);
    expect(entry).toBeDefined();
    expect(entry.redConnected).toBe(false);
    expect(entry.blackConnected).toBe(false);
    expect(entry.observers).toBe(0);
    expect(entry.turn).toBe('red');
    expect(entry.moveNumber).toBe(1);
    expect(entry.moves).toBe(0);
    expect(entry.over).toBe(false);
    expect(entry.winner).toBeNull();
    expect(entry.createdAt).toBeTypeOf('number');
  });

  test('presence flags reflect connected sockets', () => {
    const id = uid();
    const ws1 = mockWs();
    joinSocket(id, ws1, 'red');
    const list = listGames();
    const entry = list.find(g => g.id === id);
    expect(entry.redConnected).toBe(true);
    expect(entry.blackConnected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// presence
// ---------------------------------------------------------------------------
describe('presence', () => {
  test('returns correct presence shape', () => {
    const id = uid();
    const g = ensureGame(id);
    expect(presence(g)).toEqual({ redConnected: false, blackConnected: false, observers: 0 });
  });
});

// ---------------------------------------------------------------------------
// fullPayload
// ---------------------------------------------------------------------------
describe('fullPayload', () => {
  test('includes id, state payload, and presence', () => {
    const id = uid();
    const g = ensureGame(id);
    const p = fullPayload(g);
    expect(p.id).toBe(id);
    expect(p.turn).toBe('red');
    expect(p.presence).toMatchObject({ redConnected: false, blackConnected: false, observers: 0 });
  });
});

// ---------------------------------------------------------------------------
// joinSocket — role assignment ordering
// ---------------------------------------------------------------------------
describe('joinSocket role assignment', () => {
  test('first joiner (no wanted) gets red', () => {
    const id = uid();
    const ws = mockWs();
    const role = joinSocket(id, ws);
    expect(role).toBe('red');
  });

  test('second joiner (no wanted) gets black', () => {
    const id = uid();
    joinSocket(id, mockWs());
    const role = joinSocket(id, mockWs());
    expect(role).toBe('black');
  });

  test('third+ joiner (no wanted) gets observer', () => {
    const id = uid();
    joinSocket(id, mockWs());
    joinSocket(id, mockWs());
    const role = joinSocket(id, mockWs());
    expect(role).toBe('observer');
  });

  test('wanted=red honored when red is free', () => {
    const id = uid();
    const role = joinSocket(id, mockWs(), 'red');
    expect(role).toBe('red');
  });

  test('wanted=black honored when black is free', () => {
    const id = uid();
    const role = joinSocket(id, mockWs(), 'black');
    expect(role).toBe('black');
  });

  test('wanted=observer always gets observer', () => {
    const id = uid();
    const role = joinSocket(id, mockWs(), 'observer');
    expect(role).toBe('observer');
  });

  test('wanted=red falls through to black when red is taken', () => {
    const id = uid();
    joinSocket(id, mockWs(), 'red'); // takes red
    const role = joinSocket(id, mockWs(), 'red'); // red taken, should fall through
    expect(role).toBe('black');
  });

  test('wanted=black falls through to observer when black is taken and red is also taken', () => {
    const id = uid();
    joinSocket(id, mockWs(), 'red');
    joinSocket(id, mockWs(), 'black');
    const role = joinSocket(id, mockWs(), 'black');
    expect(role).toBe('observer');
  });

  test('wanted=red falls through to observer when both red and black are taken', () => {
    const id = uid();
    joinSocket(id, mockWs(), 'red');
    joinSocket(id, mockWs(), 'black');
    const role = joinSocket(id, mockWs(), 'red');
    expect(role).toBe('observer');
  });

  test('socket added to sockets set and rolesByWs map', () => {
    const id = uid();
    const ws = mockWs();
    joinSocket(id, ws);
    const g = ensureGame(id);
    expect(g.sockets.has(ws)).toBe(true);
    expect(g.rolesByWs.get(ws)).toBe('red');
  });
});

// ---------------------------------------------------------------------------
// leaveSocket
// ---------------------------------------------------------------------------
describe('leaveSocket', () => {
  test('frees red slot on disconnect', () => {
    const id = uid();
    const ws = mockWs();
    joinSocket(id, ws, 'red');
    leaveSocket(id, ws);
    const g = ensureGame(id);
    expect(g.redWs).toBeNull();
  });

  test('frees black slot on disconnect', () => {
    const id = uid();
    const ws = mockWs();
    joinSocket(id, ws, 'black');
    leaveSocket(id, ws);
    const g = ensureGame(id);
    expect(g.blackWs).toBeNull();
  });

  test('removes observer from observers set', () => {
    const id = uid();
    const ws = mockWs();
    joinSocket(id, ws, 'observer');
    leaveSocket(id, ws);
    const g = ensureGame(id);
    expect(g.observers.has(ws)).toBe(false);
  });

  test('removes socket from sockets set and rolesByWs', () => {
    const id = uid();
    const ws = mockWs();
    joinSocket(id, ws);
    leaveSocket(id, ws);
    const g = ensureGame(id);
    expect(g.sockets.has(ws)).toBe(false);
    expect(g.rolesByWs.has(ws)).toBe(false);
  });

  test('is a no-op for unknown gameId', () => {
    expect(() => leaveSocket('nonexistent-game-id-xyz', mockWs())).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// broadcast
// ---------------------------------------------------------------------------
describe('broadcast', () => {
  test('sends JSON payload to all readyState===1 sockets', () => {
    const id = uid();
    const ws1 = mockWs(1);
    const ws2 = mockWs(1);
    joinSocket(id, ws1);
    joinSocket(id, ws2);
    broadcast(id, { type: 'test' });
    expect(ws1.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test' }));
    expect(ws2.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test' }));
  });

  test('skips sockets that are not readyState===1', () => {
    const id = uid();
    const wsOpen = mockWs(1);
    const wsClosed = mockWs(3); // CLOSED
    joinSocket(id, wsOpen);
    joinSocket(id, wsClosed);
    broadcast(id, { type: 'test' });
    expect(wsOpen.send).toHaveBeenCalledTimes(1);
    expect(wsClosed.send).not.toHaveBeenCalled();
  });

  test('is a no-op for unknown gameId', () => {
    expect(() => broadcast('nonexistent-broadcast-id-xyz', { type: 'test' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// attemptMove
// ---------------------------------------------------------------------------
describe('attemptMove', () => {
  test('rejects observer role', () => {
    const id = uid();
    const result = attemptMove(id, 'observer', 'a3', 'b4');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('observer-cannot-move');
  });

  test('rejects move when it is not the player\'s turn', () => {
    const id = uid();
    // red's turn at start; black tries to move
    const result = attemptMove(id, 'black', 'a6', 'b5');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not-your-turn');
  });

  test('rejects illegal move (invalid from/to)', () => {
    const id = uid();
    const result = attemptMove(id, 'red', 'a1', 'a2');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('illegal-move');
  });

  test('accepts valid move, advances turn, returns move', () => {
    const id = uid();
    const g = ensureGame(id);
    // Find a legal red move from the initial board

    const legalMoves = legalMovesFor(g.state.board, 'red');
    const m = legalMoves[0];
    const result = attemptMove(id, 'red', m.from, m.to);
    expect(result.ok).toBe(true);
    expect(result.move).toBeDefined();
    expect(g.state.turn).toBe('black');
  });

  test('snapshots old state before applying move', () => {
    const id = uid();
    const g = ensureGame(id);

    const legalMoves = legalMovesFor(g.state.board, 'red');
    const m = legalMoves[0];
    const prevState = g.state;
    attemptMove(id, 'red', m.from, m.to);
    expect(g.snapshots).toHaveLength(1);
    expect(g.snapshots[0]).toBe(prevState);
  });
});

// ---------------------------------------------------------------------------
// resetGame
// ---------------------------------------------------------------------------
describe('resetGame', () => {
  test('restores initial state and clears snapshots', () => {
    const id = uid();
    const g = ensureGame(id);

    const legalMoves = legalMovesFor(g.state.board, 'red');
    const m = legalMoves[0];
    attemptMove(id, 'red', m.from, m.to);
    expect(g.state.turn).toBe('black');
    resetGame(id);
    expect(g.state.turn).toBe('red');
    expect(g.state.history).toHaveLength(0);
    expect(g.snapshots).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// undoMove
// ---------------------------------------------------------------------------
describe('undoMove', () => {
  test('returns false when history is empty', () => {
    const id = uid();
    const result = undoMove(id);
    expect(result).toBe(false);
  });

  test('restores previous state and returns true', () => {
    const id = uid();
    const g = ensureGame(id);

    const legalMoves = legalMovesFor(g.state.board, 'red');
    const m = legalMoves[0];
    const originalState = g.state;
    attemptMove(id, 'red', m.from, m.to);
    expect(g.state.turn).toBe('black');
    const result = undoMove(id);
    expect(result).toBe(true);
    expect(g.state).toBe(originalState);
    expect(g.snapshots).toHaveLength(0);
  });
});
