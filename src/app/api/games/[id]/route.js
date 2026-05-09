export const dynamic = 'force-dynamic';

import { ensureGame, fullPayload, resetGame, broadcast, gameExists, validateGameId } from '../../../../lib/store.js';

export async function GET(_, { params }) {
  const { id } = await params;
  if (!validateGameId(id)) {
    return Response.json({ ok: false, error: { code: 'E_INVALID_ID', message: 'Invalid game id' } }, { status: 400 });
  }
  const g = ensureGame(id);
  return Response.json(fullPayload(g));
}

export async function DELETE(_, { params }) {
  const { id } = await params;
  if (!validateGameId(id)) {
    return Response.json({ ok: false, error: { code: 'E_INVALID_ID', message: 'Invalid game id' } }, { status: 400 });
  }
  if (!gameExists(id)) {
    return Response.json({ ok: false, error: { code: 'E_NOT_FOUND', message: 'Game not found' } }, { status: 404 });
  }
  resetGame(id);
  const state = fullPayload(ensureGame(id));
  broadcast(id, { type: 'state', state });
  return Response.json({ ok: true });
}
