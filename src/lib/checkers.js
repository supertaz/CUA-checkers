// Pure checkers rules engine.
// Coordinate system: files a-h left→right, ranks 1-8 bottom→top.
// Internal grid: row 0 = rank 8 (top), row 7 = rank 1 (bottom).
// Red starts ranks 1-3, Black starts ranks 6-8.
// Red moves up the board (toward rank 8). Black moves down (toward rank 1).
// Permissive rules: captures are NOT forced; multi-jump chains may halt at any
// reachable landing square (each prefix of a chain is recorded as legal).

export const FILES = ["a","b","c","d","e","f","g","h"];
export const RED = "red";
export const BLACK = "black";

export function rcToCoord(r, c) { return FILES[c] + (8 - r); }
export function coordToRC(coord) {
  const f = coord.charCodeAt(0) - 97;
  const rank = parseInt(coord.slice(1), 10);
  return [8 - rank, f];
}
function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function isDark(r, c) { return ((r + c) & 1) === 1; }
function cloneBoard(b) { return b.map(row => row.slice()); }

export function makeInitialBoard() {
  const b = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (!isDark(r, c)) continue;
      if (r <= 2) b[r][c] = { color: BLACK, king: false };
      else if (r >= 5) b[r][c] = { color: RED, king: false };
    }
  }
  return b;
}

export function makeInitialState() {
  return {
    board: makeInitialBoard(),
    turn: RED,
    moveNumber: 1,
    history: [],
    lastMove: null,
    over: false,
    winner: null,
  };
}

function pieceDirs(piece) {
  if (piece.king) return [[-1,-1],[-1,1],[1,-1],[1,1]];
  return piece.color === RED ? [[-1,-1],[-1,1]] : [[1,-1],[1,1]];
}

function findCaptureSequences(board, r, c, piece) {
  const results = [];
  const dirs = pieceDirs(piece);
  function recurse(curR, curC, curPiece, captured, path, workBoard) {
    for (const [dr, dc] of dirs) {
      const mr = curR + dr, mc = curC + dc;
      const lr = curR + 2*dr, lc = curC + 2*dc;
      if (!inBounds(lr, lc)) continue;
      const mid = workBoard[mr][mc];
      if (!mid || mid.color === curPiece.color) continue;
      if (workBoard[lr][lc]) continue;
      const capCoord = rcToCoord(mr, mc);
      /* v8 ignore next -- pieces are nulled on nextBoard before recursing, so mid===null fires first */
      if (captured.includes(capCoord)) continue;
      const nextBoard = cloneBoard(workBoard);
      nextBoard[mr][mc] = null;
      nextBoard[curR][curC] = null;
      let promotedNow = false;
      const landed = { color: curPiece.color, king: curPiece.king };
      if (!landed.king) {
        if (curPiece.color === RED && lr === 0) { landed.king = true; promotedNow = true; }
        if (curPiece.color === BLACK && lr === 7) { landed.king = true; promotedNow = true; }
      }
      nextBoard[lr][lc] = landed;
      const newPath = path.concat([rcToCoord(lr, lc)]);
      const newCaps = captured.concat([capCoord]);
      results.push({
        from: path[0],
        to: rcToCoord(lr, lc),
        path: newPath,
        captured: newCaps,
        kinged: promotedNow,
        isCapture: true,
      });
      if (!promotedNow) {
        recurse(lr, lc, landed, newCaps, newPath, nextBoard);
      }
    }
  }
  recurse(r, c, piece, [], [rcToCoord(r, c)], board);
  return results;
}

function findSimpleMoves(board, r, c, piece) {
  const moves = [];
  for (const [dr, dc] of pieceDirs(piece)) {
    const nr = r + dr, nc = c + dc;
    if (!inBounds(nr, nc)) continue;
    if (board[nr][nc]) continue;
    let kinged = false;
    if (!piece.king) {
      if (piece.color === RED && nr === 0) kinged = true;
      if (piece.color === BLACK && nr === 7) kinged = true;
    }
    moves.push({
      from: rcToCoord(r, c),
      to: rcToCoord(nr, nc),
      path: [rcToCoord(r, c), rcToCoord(nr, nc)],
      captured: [],
      kinged,
      isCapture: false,
    });
  }
  return moves;
}

export function legalMovesFor(board, color) {
  const moves = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || p.color !== color) continue;
      moves.push(...findCaptureSequences(board, r, c, p));
      moves.push(...findSimpleMoves(board, r, c, p));
    }
  }
  return moves;
}

export function pieceCounts(board) {
  let red = 0, black = 0, redK = 0, blackK = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (!p) continue;
    if (p.color === RED) { red++; if (p.king) redK++; }
    else { black++; if (p.king) blackK++; }
  }
  return { red, black, redK, blackK };
}

export function flatPieces(board) {
  const flat = {};
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (p) flat[rcToCoord(r, c)] = p.king ? p.color + "-king" : p.color;
  }
  return flat;
}

export function applyMoveToState(state, move) {
  const board = cloneBoard(state.board);
  const [fr, fc] = coordToRC(move.from);
  const [tr, tc] = coordToRC(move.to);
  const piece = board[fr][fc];
  board[fr][fc] = null;
  for (const cap of move.captured) {
    const [cr, cc] = coordToRC(cap);
    board[cr][cc] = null;
  }
  const landed = { color: piece.color, king: piece.king };
  if (!landed.king) {
    if (landed.color === RED && tr === 0) landed.king = true;
    if (landed.color === BLACK && tr === 7) landed.king = true;
  }
  board[tr][tc] = landed;
  const sep = move.isCapture ? "x" : "-";
  const san = move.path.join(sep);
  const newTurn = state.turn === RED ? BLACK : RED;
  const history = state.history.concat([{ san, color: state.turn, move }]);
  const moveNumber = newTurn === RED ? state.moveNumber + 1 : state.moveNumber;
  const next = {
    board,
    turn: newTurn,
    moveNumber,
    history,
    lastMove: { from: move.from, to: move.to, captured: move.captured },
    over: false,
    winner: null,
  };
  const oppMoves = legalMovesFor(board, newTurn);
  if (oppMoves.length === 0) {
    next.over = true;
    next.winner = state.turn;
  }
  return next;
}

export function tryMove(state, from, to) {
  if (state.over) return { ok: false, error: "game-over" };
  const moves = legalMovesFor(state.board, state.turn);
  const candidates = moves.filter(m => m.from === from && m.to === to);
  if (candidates.length === 0) return { ok: false, error: "illegal-move" };
  candidates.sort((a, b) => b.captured.length - a.captured.length);
  const move = candidates[0];
  return { ok: true, move, newState: applyMoveToState(state, move) };
}

export function getStatePayload(state) {
  return {
    turn: state.turn,
    moveNumber: state.moveNumber,
    pieces: flatPieces(state.board),
    counts: pieceCounts(state.board),
    legalMoves: state.over ? [] : legalMovesFor(state.board, state.turn).map(m => ({
      from: m.from, to: m.to, path: m.path,
      captured: m.captured, isCapture: m.isCapture, kinged: m.kinged,
    })),
    history: state.history.map(h => ({ san: h.san, color: h.color })),
    lastMove: state.lastMove,
    gameOver: state.over,
    winner: state.winner,
  };
}
