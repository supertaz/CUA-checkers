export const dynamic = 'force-dynamic';

import { ensureGame, fullPayload, resetGame } from '../../../../lib/store.js';

export async function GET(_, { params }) {
  const { id } = await params;
  const g = ensureGame(id);
  return Response.json(fullPayload(g));
}

export async function DELETE(_, { params }) {
  const { id } = await params;
  resetGame(id);
  return Response.json({ ok: true });
}
