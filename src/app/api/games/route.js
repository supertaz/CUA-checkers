export const dynamic = 'force-dynamic';

import { listGames, ensureGame, fullPayload, validateGameId } from '../../../lib/store.js';

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

export async function GET() {
  return Response.json({ games: listGames() });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const id = body.id || generateId();
  if (!validateGameId(id)) {
    return Response.json({ ok: false, error: { code: 'E_INVALID_ID', message: 'Invalid game id' } }, { status: 400 });
  }
  const existed = listGames().some((g) => g.id === id);
  const g = ensureGame(id);
  const status = existed ? 200 : 201;
  return Response.json({ id, state: fullPayload(g) }, { status });
}
