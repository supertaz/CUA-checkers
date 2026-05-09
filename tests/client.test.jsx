import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import CheckersClient from '../src/components/CheckersClient';

// MockWS stub
class MockWS {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    MockWS.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }
  send(msg) { this.sent.push(msg); }
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: 'test' });
  }
  receive(payload) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

// Initial board state snapshot
function makeInitialGameState(overrides = {}) {
  const pieces = {};
  const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  function isDark(r, c) { return ((r + c) & 1) === 1; }
  function rcToCoord(r, c) { return FILES[c] + (8 - r); }

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (!isDark(r, c)) continue;
      const coord = rcToCoord(r, c);
      if (r <= 2) pieces[coord] = 'black';
      else if (r >= 5) pieces[coord] = 'red';
      else pieces[coord] = 'empty';
    }
  }

  return {
    id: 'default',
    turn: 'red',
    moveNumber: 1,
    pieces,
    counts: { red: 12, black: 12, redK: 0, blackK: 0 },
    lastMove: null,
    legalMoves: [
      { from: 'a3', to: 'b4', path: ['a3', 'b4'], captured: [], isCapture: false, kinged: false },
      { from: 'c3', to: 'b4', path: ['c3', 'b4'], captured: [], isCapture: false, kinged: false },
      { from: 'c3', to: 'd4', path: ['c3', 'd4'], captured: [], isCapture: false, kinged: false },
    ],
    history: [],
    gameOver: false,
    winner: null,
    presence: { redConnected: true, blackConnected: false, observers: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  MockWS.instances = [];
  global.WebSocket = MockWS;
  // Reset body data-role between tests
  delete document.body.dataset.role;
  // Clean window.checkers
  delete window.checkers;
});

afterEach(() => {
  delete global.WebSocket;
  delete document.body.dataset.role;
  delete window.checkers;
});

// Helper to render and deliver hello message
async function renderWithHello(role = 'red', stateOverrides = {}) {
  const { unmount } = render(<CheckersClient />);
  await act(async () => {
    await new Promise(r => setTimeout(r, 10));
  });
  const ws = MockWS.instances[0];
  await act(async () => {
    ws.receive({ type: 'hello', role, state: makeInitialGameState(stateOverrides) });
  });
  return { ws, unmount };
}

// ---- Board Rendering ----

describe('Board rendering', () => {
  it('renders 64 squares with correct ids', async () => {
    await renderWithHello();
    const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    let count = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const coord = FILES[c] + (8 - r);
        if (((r + c) & 1) === 1) {
          const sq = document.getElementById('sq-' + coord);
          expect(sq).not.toBeNull();
          expect(sq.dataset.square).toBe(coord);
          count++;
        }
      }
    }
    expect(count).toBe(32);
  });

  it('renders 64 total squares', async () => {
    await renderWithHello();
    const squares = document.querySelectorAll('.square');
    expect(squares.length).toBe(64);
  });

  it('sets data-piece correctly for initial board', async () => {
    await renderWithHello();
    // c1 is rank 1 (r=7, c=2) — dark square, red piece
    const c1 = document.getElementById('sq-c1');
    expect(c1.dataset.piece).toBe('red');
    // b6 is rank 6 (r=2, c=1) — dark square, black piece
    const b6 = document.getElementById('sq-b6');
    expect(b6.dataset.piece).toBe('black');
    // b5 is rank 5 (r=3, c=1) — dark square, empty
    const b5 = document.getElementById('sq-b5');
    expect(b5.dataset.piece).toBe('empty');
  });

  it('renders piece elements with correct color classes', async () => {
    await renderWithHello();
    // c1 is dark (r=7,c=2) — red piece
    const c1 = document.getElementById('sq-c1');
    expect(c1.querySelector('.piece.red')).not.toBeNull();
    // b6 is dark (r=2,c=1) — black piece
    const b6 = document.getElementById('sq-b6');
    expect(b6.querySelector('.piece.black')).not.toBeNull();
  });

  it('renders king pieces with king class', async () => {
    const pieces = makeInitialGameState().pieces;
    pieces['c1'] = 'red-king';
    await renderWithHello('red', { pieces });
    const c1 = document.getElementById('sq-c1');
    expect(c1.dataset.piece).toBe('red-king');
    expect(c1.querySelector('.piece.king')).not.toBeNull();
  });

  it('sets aria-label on squares', async () => {
    await renderWithHello();
    const a1 = document.getElementById('sq-a1');
    expect(a1.getAttribute('aria-label')).toContain('a1');
    expect(a1.getAttribute('aria-label')).toContain('red');
  });

  it('shows last-from and last-to classes after state with lastMove', async () => {
    const { ws } = await renderWithHello('red');
    await act(async () => {
      ws.receive({
        type: 'state',
        state: makeInitialGameState({ lastMove: { from: 'a3', to: 'b4', captured: [] } }),
      });
    });
    const a3 = document.getElementById('sq-a3');
    const b4 = document.getElementById('sq-b4');
    expect(a3.classList.contains('last-from')).toBe(true);
    expect(b4.classList.contains('last-to')).toBe(true);
  });
});

// ---- Role Theming ----

describe('Role theming', () => {
  it('sets body data-role="red" after hello with role=red', async () => {
    await renderWithHello('red');
    expect(document.body.dataset.role).toBe('red');
  });

  it('shows YOU ARE RED in header for red role', async () => {
    await renderWithHello('red');
    const header = screen.getByTestId('role-header');
    expect(header.textContent).toBe('YOU ARE RED');
  });

  it('sets body data-role="black" after hello with role=black', async () => {
    await renderWithHello('black');
    expect(document.body.dataset.role).toBe('black');
  });

  it('shows YOU ARE BLACK in header for black role', async () => {
    await renderWithHello('black');
    const header = screen.getByTestId('role-header');
    expect(header.textContent).toBe('YOU ARE BLACK');
  });

  it('sets body data-role="observer" after hello with role=observer', async () => {
    await renderWithHello('observer');
    expect(document.body.dataset.role).toBe('observer');
  });

  it('shows OBSERVER (READ-ONLY) in header for observer role', async () => {
    await renderWithHello('observer');
    const header = screen.getByTestId('role-header');
    expect(header.textContent).toBe('OBSERVER (READ-ONLY)');
  });

  it('shows CONNECTING… before hello is received', async () => {
    render(<CheckersClient />);
    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });
    const header = screen.getByTestId('role-header');
    expect(header.textContent).toBe('CONNECTING…');
  });

  it('cleans up body data-role on unmount', async () => {
    const { unmount } = await renderWithHello('red');
    unmount();
    expect(document.body.dataset.role).toBeUndefined();
  });

  it('shows role.toUpperCase() in header for unexpected role value', async () => {
    await renderWithHello('spectator');
    const header = screen.getByTestId('role-header');
    expect(header.textContent).toBe('SPECTATOR');
  });
});

// ---- Click Handlers ----

describe('Click handlers', () => {
  it('selects own red piece on click (adds selected class)', async () => {
    await renderWithHello('red');
    const a3 = document.getElementById('sq-a3');
    await act(async () => { fireEvent.click(a3); });
    expect(a3.classList.contains('selected')).toBe(true);
  });

  it('sends move WS message on click of legal target after selecting piece', async () => {
    const { ws } = await renderWithHello('red');
    const a3 = document.getElementById('sq-a3');
    const b4 = document.getElementById('sq-b4');
    await act(async () => { fireEvent.click(a3); });
    await act(async () => { fireEvent.click(b4); });
    const moveMsgs = ws.sent.map(s => JSON.parse(s)).filter(m => m.type === 'move');
    expect(moveMsgs.length).toBe(1);
    expect(moveMsgs[0]).toEqual({ type: 'move', from: 'a3', to: 'b4' });
  });

  it('does NOT send move when role !== turn', async () => {
    const { ws } = await renderWithHello('black');
    const a3 = document.getElementById('sq-a3');
    await act(async () => { fireEvent.click(a3); });
    const moveMsgs = ws.sent.map(s => JSON.parse(s)).filter(m => m.type === 'move');
    expect(moveMsgs.length).toBe(0);
  });

  it('does NOT send move when role === observer', async () => {
    const { ws } = await renderWithHello('observer');
    const a3 = document.getElementById('sq-a3');
    await act(async () => { fireEvent.click(a3); });
    const moveMsgs = ws.sent.map(s => JSON.parse(s)).filter(m => m.type === 'move');
    expect(moveMsgs.length).toBe(0);
  });

  it('does NOT send move when gameOver is true', async () => {
    const { ws } = await renderWithHello('red', { gameOver: true, winner: 'black' });
    const a3 = document.getElementById('sq-a3');
    await act(async () => { fireEvent.click(a3); });
    const moveMsgs = ws.sent.map(s => JSON.parse(s)).filter(m => m.type === 'move');
    expect(moveMsgs.length).toBe(0);
  });

  it('deselects when clicking non-legal target', async () => {
    const { ws } = await renderWithHello('red');
    const a3 = document.getElementById('sq-a3');
    const d4 = document.getElementById('sq-d4');
    await act(async () => { fireEvent.click(a3); });
    await act(async () => { fireEvent.click(d4); });
    // d4 is not a legal move from a3 (only b4 is)
    expect(a3.classList.contains('selected')).toBe(false);
    const moveMsgs = ws.sent.map(s => JSON.parse(s)).filter(m => m.type === 'move');
    expect(moveMsgs.length).toBe(0);
  });
});

// ---- Hint Toggle ----

describe('Hint toggle', () => {
  it('shows legal-move hints by default (always mode)', async () => {
    await renderWithHello('red');
    const a3 = document.getElementById('sq-a3');
    await act(async () => { fireEvent.click(a3); });
    const b4 = document.getElementById('sq-b4');
    expect(b4.classList.contains('legal-move')).toBe(true);
  });

  it('shows legal-capture hint class for capture moves', async () => {
    const legalMoves = [
      { from: 'a3', to: 'c5', path: ['a3', 'c5'], captured: ['b4'], isCapture: true, kinged: false },
    ];
    await renderWithHello('red', { legalMoves });
    const a3 = document.getElementById('sq-a3');
    await act(async () => { fireEvent.click(a3); });
    const c5 = document.getElementById('sq-c5');
    expect(c5.classList.contains('legal-capture')).toBe(true);
  });

  it('does not show hints when mode is Off', async () => {
    await renderWithHello('red');
    const select = document.getElementById('hint-mode');
    await act(async () => { fireEvent.change(select, { target: { value: 'off' } }); });
    const a3 = document.getElementById('sq-a3');
    await act(async () => { fireEvent.click(a3); });
    const b4 = document.getElementById('sq-b4');
    expect(b4.classList.contains('legal-move')).toBe(false);
    expect(b4.classList.contains('legal-capture')).toBe(false);
  });

  it('shows hint-n input only when First N is selected', async () => {
    await renderWithHello('red');
    expect(document.getElementById('hint-n-wrap')).toBeNull();
    const select = document.getElementById('hint-mode');
    await act(async () => { fireEvent.change(select, { target: { value: 'first' } }); });
    expect(document.getElementById('hint-n-wrap')).not.toBeNull();
    await act(async () => { fireEvent.change(select, { target: { value: 'always' } }); });
    expect(document.getElementById('hint-n-wrap')).toBeNull();
  });

  it('shows hints when moveNumber <= N in First N mode', async () => {
    // moveNumber: 1, N: 5 → show hints
    await renderWithHello('red', { moveNumber: 1 });
    const select = document.getElementById('hint-mode');
    await act(async () => { fireEvent.change(select, { target: { value: 'first' } }); });
    const hintN = document.getElementById('hint-n');
    await act(async () => { fireEvent.change(hintN, { target: { value: '5' } }); });
    const a3 = document.getElementById('sq-a3');
    await act(async () => { fireEvent.click(a3); });
    const b4 = document.getElementById('sq-b4');
    expect(b4.classList.contains('legal-move')).toBe(true);
  });

  it('does NOT show hints when moveNumber > N in First N mode', async () => {
    // moveNumber: 6, N: 5 → no hints
    await renderWithHello('red', { moveNumber: 6 });
    const select = document.getElementById('hint-mode');
    await act(async () => { fireEvent.change(select, { target: { value: 'first' } }); });
    const hintN = document.getElementById('hint-n');
    await act(async () => { fireEvent.change(hintN, { target: { value: '5' } }); });
    const a3 = document.getElementById('sq-a3');
    await act(async () => { fireEvent.click(a3); });
    const b4 = document.getElementById('sq-b4');
    expect(b4.classList.contains('legal-move')).toBe(false);
  });

  it('does NOT show hints when N < 1 in First N mode', async () => {
    await renderWithHello('red', { moveNumber: 1 });
    const select = document.getElementById('hint-mode');
    await act(async () => { fireEvent.change(select, { target: { value: 'first' } }); });
    const hintN = document.getElementById('hint-n');
    await act(async () => { fireEvent.change(hintN, { target: { value: '0' } }); });
    const a3 = document.getElementById('sq-a3');
    await act(async () => { fireEvent.click(a3); });
    const b4 = document.getElementById('sq-b4');
    expect(b4.classList.contains('legal-move')).toBe(false);
  });
});

// ---- window.checkers API ----

describe('window.checkers API', () => {
  it('exposes window.checkers on mount', async () => {
    await renderWithHello('red');
    expect(window.checkers).toBeDefined();
  });

  it('getState() returns current state and role', async () => {
    await renderWithHello('red');
    const state = window.checkers.getState();
    expect(state.role).toBe('red');
    expect(state.turn).toBe('red');
  });

  it('getLegalMoves() returns legal moves array', async () => {
    await renderWithHello('red');
    const moves = window.checkers.getLegalMoves();
    expect(Array.isArray(moves)).toBe(true);
    expect(moves.length).toBeGreaterThan(0);
  });

  it('move(from, to) sends a WS move message', async () => {
    const { ws } = await renderWithHello('red');
    const promise = window.checkers.move('a3', 'b4');
    // Deliver state response
    await act(async () => {
      ws.receive({ type: 'state', state: makeInitialGameState() });
    });
    const result = await promise;
    expect(result.ok).toBe(true);
    const moveMsgs = ws.sent.map(s => JSON.parse(s)).filter(m => m.type === 'move');
    expect(moveMsgs.length).toBe(1);
    expect(moveMsgs[0]).toEqual({ type: 'move', from: 'a3', to: 'b4' });
  });

  it('move() resolves with error when server returns error', async () => {
    const { ws } = await renderWithHello('red');
    const promise = window.checkers.move('a3', 'b4');
    await act(async () => {
      ws.receive({ type: 'error', error: 'illegal-move' });
    });
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('illegal-move');
  });

  it('moveSan parses a-b notation and sends WS move', async () => {
    const { ws } = await renderWithHello('red');
    const promise = window.checkers.moveSan('a3-b4');
    await act(async () => {
      ws.receive({ type: 'state', state: makeInitialGameState() });
    });
    await promise;
    const moveMsgs = ws.sent.map(s => JSON.parse(s)).filter(m => m.type === 'move');
    expect(moveMsgs.length).toBe(1);
    expect(moveMsgs[0]).toEqual({ type: 'move', from: 'a3', to: 'b4' });
  });

  it('moveSan parses axb capture notation', async () => {
    const { ws } = await renderWithHello('red');
    const promise = window.checkers.moveSan('a3xc5');
    await act(async () => {
      ws.receive({ type: 'state', state: makeInitialGameState() });
    });
    await promise;
    const moveMsgs = ws.sent.map(s => JSON.parse(s)).filter(m => m.type === 'move');
    expect(moveMsgs.some(m => m.from === 'a3' && m.to === 'c5')).toBe(true);
  });

  it('moveSan returns bad-san error for invalid format', async () => {
    await renderWithHello('red');
    const result = await window.checkers.moveSan('badsan');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('bad-san');
  });

  it('select(coord) sets the selected state', async () => {
    await renderWithHello('red');
    await act(async () => {
      window.checkers.select('a3');
    });
    const a3 = document.getElementById('sq-a3');
    expect(a3.classList.contains('selected')).toBe(true);
  });

  it('reset() sends reset WS message', async () => {
    const { ws } = await renderWithHello('red');
    window.checkers.reset();
    const msgs = ws.sent.map(s => JSON.parse(s));
    expect(msgs.some(m => m.type === 'reset')).toBe(true);
  });

  it('undo() sends undo WS message', async () => {
    const { ws } = await renderWithHello('red');
    window.checkers.undo();
    const msgs = ws.sent.map(s => JSON.parse(s));
    expect(msgs.some(m => m.type === 'undo')).toBe(true);
  });

  it('reset() works for observer (server gates, client sends)', async () => {
    const { ws } = await renderWithHello('observer');
    window.checkers.reset();
    const msgs = ws.sent.map(s => JSON.parse(s));
    expect(msgs.some(m => m.type === 'reset')).toBe(true);
  });

  it('undo() works for observer (server gates, client sends)', async () => {
    const { ws } = await renderWithHello('observer');
    window.checkers.undo();
    const msgs = ws.sent.map(s => JSON.parse(s));
    expect(msgs.some(m => m.type === 'undo')).toBe(true);
  });

  it('onChange(fn) is called when state message arrives', async () => {
    const { ws } = await renderWithHello('red');
    const listener = vi.fn();
    window.checkers.onChange(listener);
    await act(async () => {
      ws.receive({ type: 'state', state: makeInitialGameState({ moveNumber: 2 }) });
    });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].moveNumber).toBe(2);
  });

  it('onChange listener that throws is caught silently', async () => {
    const { ws } = await renderWithHello('red');
    const throwing = vi.fn(() => { throw new Error('listener error'); });
    window.checkers.onChange(throwing);
    // Should not throw / crash
    await act(async () => {
      ws.receive({ type: 'state', state: makeInitialGameState({ moveNumber: 3 }) });
    });
    expect(throwing).toHaveBeenCalled();
  });

  it('window.checkers is removed on unmount', async () => {
    const { unmount } = await renderWithHello('red');
    unmount();
    expect(window.checkers).toBeUndefined();
  });

  it('move() returns not-connected if WS is not open', async () => {
    // Use a MockWS that never opens (readyState stays 0)
    class NeverOpenWS {
      static instances = [];
      constructor(url) { this.url = url; this.readyState = 0; this.sent = []; NeverOpenWS.instances.push(this); }
      send(msg) { this.sent.push(msg); }
      close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: 'test' }); }
    }
    global.WebSocket = NeverOpenWS;
    render(<CheckersClient />);
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    const result = await window.checkers.move('a3', 'b4');
    expect(result.ok).toBe(false);
    global.WebSocket = MockWS;
  });
});

// ---- WebSocket protocol ----

describe('WebSocket connection', () => {
  it('opens WS with default game param', async () => {
    render(<CheckersClient />);
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    const ws = MockWS.instances[0];
    expect(ws.url).toContain('/ws');
    expect(ws.url).toContain('game=default');
  });

  it('opens WS with game and as query params from URL', async () => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '?game=testgame&as=red', host: 'localhost:3000' },
      writable: true,
      configurable: true,
    });
    render(<CheckersClient />);
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    const ws = MockWS.instances[MockWS.instances.length - 1];
    expect(ws.url).toContain('game=testgame');
    expect(ws.url).toContain('as=red');
    // Restore location
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '', host: 'localhost' },
      writable: true,
      configurable: true,
    });
  });

  it('uses wss:// scheme when page protocol is https:', async () => {
    const origLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...window.location, protocol: 'https:', host: 'localhost:3000', search: '' },
      writable: true,
      configurable: true,
    });
    render(<CheckersClient />);
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    const ws = MockWS.instances[MockWS.instances.length - 1];
    expect(ws.url.startsWith('wss://')).toBe(true);
    Object.defineProperty(window, 'location', {
      value: origLocation,
      writable: true,
      configurable: true,
    });
  });

  it('uses ws:// scheme when page protocol is http:', async () => {
    render(<CheckersClient />);
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    const ws = MockWS.instances[MockWS.instances.length - 1];
    expect(ws.url.startsWith('ws://')).toBe(true);
  });

  it('updates presence on presence message', async () => {
    const { ws } = await renderWithHello('red');
    await act(async () => {
      ws.receive({
        type: 'presence',
        state: {
          ...makeInitialGameState(),
          presence: { redConnected: true, blackConnected: true, observers: 1 },
        },
      });
    });
    expect(screen.getByText(/Observers: 1/)).toBeInTheDocument();
  });

  it('error message sets lastError and renders error chip', async () => {
    const { ws } = await renderWithHello('red');
    await act(async () => {
      ws.receive({ type: 'error', error: 'not-your-turn' });
    });
    const chip = screen.getByTestId('error-chip');
    expect(chip.textContent).toContain('not-your-turn');
  });

  it('schedules reconnect after WS close', async () => {
    render(<CheckersClient />);
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    const initialCount = MockWS.instances.length;
    const ws = MockWS.instances[initialCount - 1];

    vi.useFakeTimers();
    try {
      await act(async () => { ws.close(); });
      await act(async () => { vi.advanceTimersByTime(600); });
      expect(MockWS.instances.length).toBeGreaterThan(initialCount);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores malformed JSON from WS (silently returns)', async () => {
    const { ws } = await renderWithHello('red');
    await act(async () => {
      ws.onmessage?.({ data: 'not-valid-json{{{' });
    });
    // Component should still be functional
    expect(screen.getByTestId('role-header').textContent).toBe('YOU ARE RED');
  });

  it('move() times out when no server response arrives', async () => {
    // Render with real timers first, then switch
    render(<CheckersClient />);
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    const wsInst = MockWS.instances[MockWS.instances.length - 1];
    await act(async () => {
      wsInst.receive({ type: 'hello', role: 'red', state: makeInitialGameState() });
    });

    vi.useFakeTimers();
    try {
      const promise = window.checkers.move('a3', 'b4');
      await act(async () => { vi.advanceTimersByTime(5001); });
      const result = await promise;
      expect(result.ok).toBe(false);
      expect(result.error).toBe('timeout');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---- Status Panel ----

describe('Status panel', () => {
  it('shows RED TO MOVE initially', async () => {
    await renderWithHello('red');
    expect(document.getElementById('status').textContent).toBe('RED TO MOVE');
  });

  it('shows game over text when gameOver=true with winner', async () => {
    await renderWithHello('red', { gameOver: true, winner: 'black' });
    expect(document.getElementById('status').textContent).toContain('GAME OVER');
    expect(document.getElementById('status').textContent).toContain('BLACK WINS');
  });

  it('shows game over text for draw (no winner)', async () => {
    await renderWithHello('red', { gameOver: true, winner: null });
    expect(document.getElementById('status').textContent).toContain('DRAW WINS');
  });

  it('shows piece counts', async () => {
    await renderWithHello('red');
    expect(document.getElementById('red-count').textContent).toBe('12');
    expect(document.getElementById('black-count').textContent).toBe('12');
  });

  it('renders move history entries', async () => {
    const history = [
      { san: 'a3-b4', color: 'red' },
      { san: 'a6-b5', color: 'black' },
    ];
    await renderWithHello('red', { history });
    expect(screen.getByText(/a3-b4/)).toBeInTheDocument();
    expect(screen.getByText(/a6-b5/)).toBeInTheDocument();
  });

  it('renders history entry starting with black (orphan black move)', async () => {
    const history = [
      { san: 'a6-b5', color: 'black' },
    ];
    await renderWithHello('red', { history });
    expect(screen.getByText(/a6-b5/)).toBeInTheDocument();
  });

  it('shows disconnected presence for unconnected black', async () => {
    await renderWithHello('red');
    const dots = document.querySelectorAll('.presence-dot.disconnected');
    // black is not connected by default in makeInitialGameState
    expect(dots.length).toBeGreaterThanOrEqual(1);
  });
});

// ---- Controls ----

describe('Controls', () => {
  it('New Game button sends reset message', async () => {
    const { ws } = await renderWithHello('red');
    await act(async () => { fireEvent.click(document.getElementById('reset')); });
    const msgs = ws.sent.map(s => JSON.parse(s));
    expect(msgs.some(m => m.type === 'reset')).toBe(true);
  });

  it('Undo button sends undo message', async () => {
    const { ws } = await renderWithHello('red');
    await act(async () => { fireEvent.click(document.getElementById('undo')); });
    const msgs = ws.sent.map(s => JSON.parse(s));
    expect(msgs.some(m => m.type === 'undo')).toBe(true);
  });

  it('Copy State JSON button triggers clipboard write', async () => {
    const writeMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeMock },
      writable: true,
      configurable: true,
    });
    await renderWithHello('red');
    await act(async () => { fireEvent.click(document.getElementById('copy-state')); });
    expect(writeMock).toHaveBeenCalled();
  });

  it('Copy State JSON does not throw when clipboard is absent', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: null,
      writable: true,
      configurable: true,
    });
    await renderWithHello('red');
    await act(async () => {
      expect(() => fireEvent.click(document.getElementById('copy-state'))).not.toThrow();
    });
  });
});
