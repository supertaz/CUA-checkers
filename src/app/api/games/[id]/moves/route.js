export const dynamic = 'force-dynamic';

import { ensureGame, fullPayload, attemptMove, broadcast } from '../../../../../lib/store.js';

export async function GET(_, { params }) {
  const { id } = await params;
  const g = ensureGame(id);
  return Response.json({ history: g.state.history });
}

export async function POST(request, { params }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const { role, from, to } = body;

  if (!role || !from || !to) {
    return Response.json({ ok: false, error: 'missing fields: role, from, to required' }, { status: 400 });
  }

  const result = attemptMove(id, role, from, to);

  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: 400 });
  }

  const g = ensureGame(id);
  const state = fullPayload(g);
  broadcast(id, { type: 'state', state });

  return Response.json({ ok: true, move: result.move, state });
}
