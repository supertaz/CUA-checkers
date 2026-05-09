import {
  makeInitialState,
  tryMove,
  getStatePayload,
  RED, BLACK,
} from "./checkers.js";

const games = new Map();

function freshGame(id) {
  return {
    id,
    state: makeInitialState(),
    snapshots: [],
    sockets: new Set(),
    rolesByWs: new Map(),
    redWs: null,
    blackWs: null,
    observers: new Set(),
    createdAt: Date.now(),
  };
}

export function ensureGame(id = "default") {
  if (!games.has(id)) games.set(id, freshGame(id));
  return games.get(id);
}

export function listGames() {
  return Array.from(games.values()).map(g => ({
    id: g.id,
    turn: g.state.turn,
    moveNumber: g.state.moveNumber,
    moves: g.state.history.length,
    over: g.state.over,
    winner: g.state.winner,
    redConnected: !!g.redWs,
    blackConnected: !!g.blackWs,
    observers: g.observers.size,
    createdAt: g.createdAt,
  }));
}

export function presence(g) {
  return {
    redConnected: !!g.redWs,
    blackConnected: !!g.blackWs,
    observers: g.observers.size,
  };
}

export function fullPayload(g) {
  return { id: g.id, ...getStatePayload(g.state), presence: presence(g) };
}

export function joinSocket(gameId, ws, wanted) {
  const g = ensureGame(gameId);
  if (g.rolesByWs.has(ws)) return g.rolesByWs.get(ws);
  let role;
  if (wanted === "observer") {
    g.observers.add(ws); role = "observer";
  } else if (wanted === "red" && !g.redWs) {
    g.redWs = ws; role = "red";
  } else if (wanted === "black" && !g.blackWs) {
    g.blackWs = ws; role = "black";
  } else if (!g.redWs) {
    g.redWs = ws; role = "red";
  } else if (!g.blackWs) {
    g.blackWs = ws; role = "black";
  } else {
    g.observers.add(ws); role = "observer";
  }
  g.sockets.add(ws);
  g.rolesByWs.set(ws, role);
  return role;
}

export function leaveSocket(gameId, ws) {
  const g = games.get(gameId);
  if (!g) return;
  if (g.redWs === ws) g.redWs = null;
  if (g.blackWs === ws) g.blackWs = null;
  g.observers.delete(ws);
  g.sockets.delete(ws);
  g.rolesByWs.delete(ws);
}

export function broadcast(gameId, payload) {
  const g = games.get(gameId);
  if (!g) return;
  const data = JSON.stringify(payload);
  for (const ws of g.sockets) {
    if (ws.readyState === 1) ws.send(data);
  }
}

export function attemptMove(gameId, role, from, to) {
  const g = ensureGame(gameId);
  if (role !== RED && role !== BLACK) {
    return { ok: false, error: "observer-cannot-move" };
  }
  if (role !== g.state.turn) {
    return { ok: false, error: `not-your-turn (current: ${g.state.turn}, you: ${role})` };
  }
  const result = tryMove(g.state, from, to);
  if (!result.ok) return result;
  g.snapshots.push(g.state);
  g.state = result.newState;
  return { ok: true, move: result.move };
}

export function resetGame(gameId) {
  const g = ensureGame(gameId);
  g.state = makeInitialState();
  g.snapshots = [];
}

export function undoMove(gameId) {
  const g = ensureGame(gameId);
  const prev = g.snapshots.pop();
  if (!prev) return false;
  g.state = prev;
  return true;
}
