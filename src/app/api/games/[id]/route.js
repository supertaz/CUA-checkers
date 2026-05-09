export const dynamic = 'force-dynamic';

import { ensureGame, fullPayload, resetGame, broadcast, gameExists, validateGameId } from '../../../../lib/store.js';

function okResponse(data, status = 200) {
  return Response.json({ ok: true, data }, { status });
}

function errorResponse(code, message, status) {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

export async function GET(_, { params }) {
  const { id } = await params;
  if (!validateGameId(id)) {
    return errorResponse('E_INVALID_ID', 'Invalid game id', 400);
  }
  const g = ensureGame(id);
  return okResponse(fullPayload(g));
}

export async function DELETE(_, { params }) {
  const { id } = await params;
  if (!validateGameId(id)) {
    return errorResponse('E_INVALID_ID', 'Invalid game id', 400);
  }
  if (!gameExists(id)) {
    return errorResponse('E_NOT_FOUND', 'Game not found', 404);
  }
  resetGame(id);
  const state = fullPayload(ensureGame(id));
  broadcast(id, { type: 'state', state });
  return okResponse({});
}
