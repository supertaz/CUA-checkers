export const dynamic = 'force-dynamic';

import { listGames, ensureGame, fullPayload, validateGameId } from '../../../lib/store.js';

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function okResponse(data, status = 200) {
  return Response.json({ ok: true, data }, { status });
}

function errorResponse(code, message, status) {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

export async function GET() {
  return okResponse({ games: listGames() });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const id = body.id || generateId();
  if (!validateGameId(id)) {
    return errorResponse('E_INVALID_ID', 'Invalid game id', 400);
  }
  const existed = listGames().some((g) => g.id === id);
  const g = ensureGame(id);
  const status = existed ? 200 : 201;
  return okResponse({ id, state: fullPayload(g) }, status);
}
