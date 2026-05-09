export const dynamic = 'force-dynamic';

import { ensureGame, fullPayload, attemptMove, broadcast, validateGameId } from '../../../../../lib/store.js';

const STATUS_FOR_CODE = {
  E_OBSERVER: 403,
  E_NOT_YOUR_TURN: 409,
  E_ILLEGAL_MOVE: 422,
};

export async function GET(_, { params }) {
  const { id } = await params;
  if (!validateGameId(id)) {
    return Response.json({ ok: false, error: { code: 'E_INVALID_ID', message: 'Invalid game id' } }, { status: 400 });
  }
  const g = ensureGame(id);
  return Response.json({ history: g.state.history });
}

export async function POST(request, { params }) {
  const { id } = await params;
  if (!validateGameId(id)) {
    return Response.json({ ok: false, error: { code: 'E_INVALID_ID', message: 'Invalid game id' } }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: { code: 'E_MALFORMED_JSON', message: 'Request body is not valid JSON' } },
      { status: 400 }
    );
  }

  const { role, from, to } = body;
  if (!role || !from || !to) {
    return Response.json(
      { ok: false, error: { code: 'E_MISSING_FIELDS', message: 'missing fields: role, from, to required' } },
      { status: 400 }
    );
  }

  const result = attemptMove(id, role, from, to);

  if (!result.ok) {
    return Response.json(
      { ok: false, error: { code: result.code, message: result.error } },
      { status: STATUS_FOR_CODE[result.code] }
    );
  }

  const g = ensureGame(id);
  const state = fullPayload(g);
  broadcast(id, { type: 'state', state });

  return Response.json({ ok: true, move: result.move, state });
}
