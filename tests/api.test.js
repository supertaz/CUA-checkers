import { describe, it, expect, beforeEach } from 'vitest';
import { resetGame, ensureGame } from '../src/lib/store.js';

// Import route handlers directly — no Next server spin-up needed.
import { GET as gamesGET, POST as gamesPOST } from '../src/app/api/games/route.js';
import {
  GET as gameGET,
  DELETE as gameDELETE,
} from '../src/app/api/games/[id]/route.js';
import {
  GET as movesGET,
  POST as movesPOST,
} from '../src/app/api/games/[id]/moves/route.js';

// Helper: build a params Promise as Next 15 App Router provides.
const p = (id) => ({ params: Promise.resolve({ id }) });

// Helper: build a Request with a JSON body.
function jsonReq(body) {
  return new Request('http://localhost', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/games', () => {
  it('returns a list (possibly empty)', async () => {
    const res = await gamesGET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('games');
    expect(Array.isArray(data.games)).toBe(true);
  });
});

describe('POST /api/games', () => {
  it('creates a game with explicit id and returns 201 + state', async () => {
    const id = 'test-post-explicit';
    const req = jsonReq({ id });
    const res = await gamesPOST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe(id);
    expect(data).toHaveProperty('state');
    expect(data.state).toHaveProperty('turn');
  });

  it('returns 200 when game already exists', async () => {
    const id = 'test-post-existing';
    ensureGame(id);
    const req = jsonReq({ id });
    const res = await gamesPOST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(id);
  });

  it('generates an id when body is empty (no id field)', async () => {
    const req = jsonReq({});
    const res = await gamesPOST(req);
    const data = await res.json();
    expect(typeof data.id).toBe('string');
    expect(data.id.length).toBeGreaterThan(0);
  });

  it('subsequent GET /api/games returns created game', async () => {
    const id = 'test-list-after-create';
    await gamesPOST(jsonReq({ id }));
    const res = await gamesGET();
    const data = await res.json();
    const ids = data.games.map((g) => g.id);
    expect(ids).toContain(id);
  });
});

describe('GET /api/games/[id]', () => {
  it('returns full payload for existing game', async () => {
    const id = 'test-get-id';
    ensureGame(id);
    const res = await gameGET(null, p(id));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(id);
    expect(data).toHaveProperty('turn');
    expect(data).toHaveProperty('pieces');
  });
});

describe('DELETE /api/games/[id]', () => {
  it('resets game state and returns {ok:true}', async () => {
    const id = 'test-delete-id';
    ensureGame(id);
    const res = await gameDELETE(null, p(id));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true });
    // Verify the game still exists (ensureGame was called by DELETE via resetGame)
    const getRes = await gameGET(null, p(id));
    const getData = await getRes.json();
    expect(getData.moveNumber).toBe(1);
  });
});

describe('GET /api/games/[id]/moves', () => {
  it('returns empty history initially', async () => {
    const id = 'test-moves-get';
    ensureGame(id);
    const res = await movesGET(null, p(id));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('history');
    expect(Array.isArray(data.history)).toBe(true);
    expect(data.history).toHaveLength(0);
  });
});

describe('POST /api/games/[id]/moves', () => {
  const id = 'test-moves-post';

  beforeEach(() => {
    resetGame(id);
  });

  it('valid red opening move returns ok and flips turn to black', async () => {
    const req = jsonReq({ role: 'red', from: 'a3', to: 'b4' });
    const res = await movesPOST(req, p(id));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data).toHaveProperty('move');
    expect(data.state.turn).toBe('black');
  });

  it('wrong turn (black on red\'s turn) → 400 not-your-turn', async () => {
    const req = jsonReq({ role: 'black', from: 'b6', to: 'a5' });
    const res = await movesPOST(req, p(id));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/not-your-turn/);
  });

  it('observer cannot move → 400 observer-cannot-move', async () => {
    const req = jsonReq({ role: 'observer', from: 'a3', to: 'b4' });
    const res = await movesPOST(req, p(id));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toBe('observer-cannot-move');
  });

  it('missing fields → 400', async () => {
    const req = jsonReq({ role: 'red' }); // missing from and to
    const res = await movesPOST(req, p(id));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });

  it('illegal coords → 400', async () => {
    const req = jsonReq({ role: 'red', from: 'z9', to: 'z8' });
    const res = await movesPOST(req, p(id));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.ok).toBe(false);
  });
});
