'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function rcToCoord(r, c) { return FILES[c] + (8 - r); }
function isDark(r, c) { return ((r + c) & 1) === 1; }

function makeEmptyBoard() {
  const pieces = {};
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (isDark(r, c)) pieces[rcToCoord(r, c)] = 'empty';
    }
  }
  return pieces;
}

const EMPTY_STATE = {
  turn: 'red',
  moveNumber: 1,
  pieces: makeEmptyBoard(),
  counts: { red: 0, black: 0, redK: 0, blackK: 0 },
  lastMove: null,
  legalMoves: [],
  history: [],
  gameOver: false,
  winner: null,
  presence: { redConnected: false, blackConnected: false, observers: 0 },
};

function parseSan(san) {
  const sep = san.includes('x') ? 'x' : '-';
  const parts = san.split(sep);
  if (parts.length < 2) return null;
  return { from: parts[0], to: parts[parts.length - 1] };
}

export default function CheckersClient() {
  const [gameState, setGameState] = useState(EMPTY_STATE);
  const [role, setRole] = useState(null);
  const [selected, setSelected] = useState(null);
  const [lastError, setLastError] = useState(null);
  const [hintMode, setHintMode] = useState('always');
  const [hintN, setHintN] = useState(5);

  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const backoffRef = useRef(500);
  const onChangeListeners = useRef([]);
  const gameStateRef = useRef(gameState);
  const roleRef = useRef(role);
  const pendingMoveResolvers = useRef([]);

  gameStateRef.current = gameState;
  roleRef.current = role;

  const sendWs = useCallback((payload) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }, []);

  const connect = useCallback(() => {
    /* v8 ignore next -- SSR guard; window is always defined in the browser/jsdom context */
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const game = params.get('game') || 'default';
    const as = params.get('as') || '';
    const asParam = as ? `&as=${encodeURIComponent(as)}` : '';
    const wsScheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${wsScheme}//${window.location.host}/ws?game=${encodeURIComponent(game)}${asParam}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      backoffRef.current = 500;
    };

    ws.onmessage = (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }

      if (msg.type === 'hello') {
        setRole(msg.role);
        roleRef.current = msg.role;
        setGameState(msg.state);
        gameStateRef.current = msg.state;
      } else if (msg.type === 'state') {
        setGameState(msg.state);
        gameStateRef.current = msg.state;
        for (const fn of onChangeListeners.current) {
          try { fn(msg.state); } catch (e) { console.error(e); }
        }
        for (const resolve of pendingMoveResolvers.current) {
          resolve({ ok: true, state: msg.state });
        }
        pendingMoveResolvers.current = [];
      } else if (msg.type === 'presence') {
        setGameState(prev => {
          const next = { ...prev, presence: msg.state.presence };
          gameStateRef.current = next;
          return next;
        });
      } else if (msg.type === 'error') {
        setLastError(msg.error);
        for (const resolve of pendingMoveResolvers.current) {
          resolve({ ok: false, error: msg.error });
        }
        pendingMoveResolvers.current = [];
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      const delay = Math.min(backoffRef.current, 5000);
      backoffRef.current = Math.min(backoffRef.current * 2, 5000);
      reconnectTimer.current = setTimeout(connect, delay);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  useEffect(() => {
    if (role) {
      document.body.dataset.role = role;
    } else {
      delete document.body.dataset.role;
    }
    return () => {
      delete document.body.dataset.role;
    };
  }, [role]);

  useEffect(() => {
    const api = {
      getState: () => ({ ...gameStateRef.current, role: roleRef.current }),
      getLegalMoves: () => gameStateRef.current.legalMoves,
      move: (from, to) => {
        return new Promise((resolve) => {
          pendingMoveResolvers.current.push(resolve);
          const sent = sendWs({ type: 'move', from, to });
          if (!sent) {
            pendingMoveResolvers.current = pendingMoveResolvers.current.filter(r => r !== resolve);
            resolve({ ok: false, error: 'not-connected' });
          }
          setTimeout(() => {
            pendingMoveResolvers.current = pendingMoveResolvers.current.filter(r => r !== resolve);
            resolve({ ok: false, error: 'timeout' });
          }, 5000);
        });
      },
      moveSan: (san) => {
        const parsed = parseSan(san);
        if (!parsed) return Promise.resolve({ ok: false, error: 'bad-san' });
        return api.move(parsed.from, parsed.to);
      },
      select: (coord) => {
        setSelected(coord);
      },
      reset: () => sendWs({ type: 'reset' }),
      undo: () => sendWs({ type: 'undo' }),
      onChange: (fn) => {
        if (typeof fn === 'function') onChangeListeners.current.push(fn);
      },
    };
    window.checkers = api;
    return () => {
      delete window.checkers;
    };
  }, [sendWs]);

  function hintsEnabled() {
    if (hintMode === 'off') return false;
    if (hintMode === 'always') return true;
    if (hintMode === 'first') {
      const n = parseInt(hintN, 10);
      if (!Number.isFinite(n) || n < 1) return false;
      return gameState.moveNumber <= n; /* v8 ignore next */
    } /* v8 ignore next */
    return true; /* v8 ignore next */
  }

  function onSquareClick(coord) {
    if (gameState.gameOver) return;
    if (role === 'observer') return;
    if (role !== gameState.turn) return;

    const piece = gameState.pieces[coord];
    if (piece && piece !== 'empty' && piece.startsWith(role)) {
      setSelected(coord);
      return;
    }

    if (selected) {
      const legalMove = gameState.legalMoves.find(
        m => m.from === selected && m.to === coord
      );
      if (legalMove) {
        sendWs({ type: 'move', from: selected, to: coord });
        setSelected(null);
      } else {
        setSelected(null);
      }
    }
  }

  const showHints = hintsEnabled();
  const selectedMoves = selected
    ? gameState.legalMoves.filter(m => m.from === selected)
    : [];

  function headerText() {
    if (!role) return 'CONNECTING…';
    if (role === 'red') return 'YOU ARE RED';
    if (role === 'black') return 'YOU ARE BLACK';
    if (role === 'observer') return 'OBSERVER (READ-ONLY)';
    return role.toUpperCase();
  }

  function statusText() {
    if (gameState.gameOver) {
      return 'GAME OVER · ' + (gameState.winner || 'draw').toUpperCase() + ' WINS';
    }
    return gameState.turn.toUpperCase() + ' TO MOVE';
  }

  function statusClass() {
    if (gameState.gameOver) return 'over';
    return gameState.turn;
  }

  const pres = gameState.presence;

  function renderBoard() {
    const squares = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const coord = rcToCoord(r, c);
        const dark = isDark(r, c);
        const pieceVal = gameState.pieces[coord] || 'empty';

        let classNames = 'square ' + (dark ? 'dark' : 'light');
        if (selected === coord) classNames += ' selected';

        const targetMove = selectedMoves.find(m => m.to === coord);
        if (targetMove && showHints) {
          classNames += targetMove.isCapture ? ' legal-capture' : ' legal-move';
        }

        if (gameState.lastMove) {
          if (gameState.lastMove.from === coord) classNames += ' last-from';
          if (gameState.lastMove.to === coord) classNames += ' last-to';
        }

        const desc = pieceVal !== 'empty'
          ? `${coord} ${pieceVal.replace('-', ' ')}`
          : `${coord} empty`;

        const pieceEl = pieceVal !== 'empty' ? (() => {
          const isKing = pieceVal.includes('king');
          const color = pieceVal.startsWith('red') ? 'red' : 'black';
          return (
            <div
              className={'piece ' + color + (isKing ? ' king' : '')}
              data-color={color}
              data-king={isKing ? '1' : '0'}
            />
          );
        })() : null;

        squares.push(
          <div
            key={coord}
            id={'sq-' + coord}
            className={classNames}
            data-square={coord}
            data-piece={pieceVal}
            aria-label={desc}
            title={desc}
            role="gridcell"
            onClick={dark ? () => onSquareClick(coord) : undefined}
          >
            {c === 0 && <span className="coord rank">{8 - r}</span>}
            {r === 7 && <span className="coord file">{FILES[c]}</span>}
            {pieceEl}
          </div>
        );
      }
    }
    return squares;
  }

  function copyState() {
    const txt = JSON.stringify(window.checkers.getState(), null, 2);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(txt).catch(() => {});
    }
  }

  return (
    <div className="app-root">
      <div className="role-header" data-testid="role-header">
        {headerText()}
      </div>
      <div className="app">
        <div>
          <h1>CUA CHECKERS</h1>
          <div className="sub">Standard American checkers · 8×8 · permissive rules · king promotion</div>
          <div className="board-wrap">
            <div className="board" id="board" role="grid" aria-label="Checkers board">
              {renderBoard()}
            </div>
          </div>
        </div>

        <div>
          <div className="panel">
            <h2>STATUS</h2>
            <div id="status" className={statusClass()} aria-live="polite">
              {statusText()}
            </div>
            <div className="stats" style={{ marginTop: 10 }}>
              <div><span>RED PIECES</span><b id="red-count">{gameState.counts.red}</b></div>
              <div><span>BLACK PIECES</span><b id="black-count">{gameState.counts.black}</b></div>
              <div><span>RED KINGS</span><b id="red-kings">{gameState.counts.redK}</b></div>
              <div><span>BLACK KINGS</span><b id="black-kings">{gameState.counts.blackK}</b></div>
              <div><span>MOVES</span><b id="move-count">{gameState.moveNumber}</b></div>
              <div><span>TURN</span><b id="turn">{gameState.turn.toUpperCase()}</b></div>
            </div>
            <div className="presence-row">
              <span>
                <span className={'presence-dot ' + (pres.redConnected ? 'connected' : 'disconnected')} />
                Red
              </span>
              <span>
                <span className={'presence-dot ' + (pres.blackConnected ? 'connected' : 'disconnected')} />
                Black
              </span>
              <span>Observers: {pres.observers}</span>
            </div>
            <div><span>ROLE</span> <b>{role || '—'}</b></div>
          </div>

          <div className="panel">
            <h2>CONTROLS</h2>
            <div className="btn-row">
              <button id="reset" onClick={() => sendWs({ type: 'reset' })}>New Game</button>
              <button id="undo" onClick={() => sendWs({ type: 'undo' })}>Undo</button>
              <button id="copy-state" onClick={copyState}>Copy State JSON</button>
            </div>
          </div>

          <div className="panel">
            <h2>DISPLAY</h2>
            <label htmlFor="hint-mode">Move hints (green/red dots)</label>
            <select
              id="hint-mode"
              value={hintMode}
              onChange={e => setHintMode(e.target.value)}
            >
              <option value="always">Always show</option>
              <option value="off">Off</option>
              <option value="first">First N moves only</option>
            </select>
            {hintMode === 'first' && (
              <div id="hint-n-wrap" style={{ marginTop: 6 }}>
                <label htmlFor="hint-n">N (full moves)</label>
                <input
                  id="hint-n"
                  type="number"
                  min="1"
                  max="200"
                  value={hintN}
                  onChange={e => setHintN(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="panel">
            <h2>MOVE HISTORY</h2>
            <div id="history">
              {gameState.history && gameState.history.map((h, i) => {
                if (h.color === 'red') {
                  const next = gameState.history[i + 1];
                  return (
                    <div key={i} className="move">
                      <span className="num">{Math.floor(i / 2) + 1}.</span>
                      <span style={{ color: '#ff8a80' }}>{h.san} </span>
                      {next && next.color === 'black' && (
                        <span style={{ color: '#eee' }}>{next.san}</span>
                      )}
                    </div>
                  );
                }
                if (i === 0 || gameState.history[i - 1].color !== 'red') {
                  return (
                    <div key={i} className="move">
                      <span style={{ color: '#eee' }}>{h.san}</span>
                    </div>
                  );
                }
                return null;
              })}
            </div>
          </div>

          {lastError && (
            <div className="error-chip" data-testid="error-chip">
              Error: {lastError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
