export const dynamic = 'force-dynamic';

import { ensureGame, fullPayload, attemptMove, broadcast, validateGameId } from '../../../../../lib/store.js';

const STATUS_FOR_CODE = {
  E_OBSERVER: 403,
  E_NOT_YOUR_TURN: 409,
  E_ILLEGAL_MOVE: 422,
};

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
  return okResponse({ history: g.state.history });
}

export async function POST(request, { params }) {
  const { id } = await params;
  if (!validateGameId(id)) {
    return errorResponse('E_INVALID_ID', 'Invalid game id', 400);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('E_MALFORMED_JSON', 'Request body is not valid JSON', 400);
  }

  const { role, from, to } = body;
  if (!role || !from || !to) {
    return errorResponse('E_MISSING_FIELDS', 'missing fields: role, from, to required', 400);
  }

  const result = attemptMove(id, role, from, to);

  if (!result.ok) {
    return errorResponse(result.code, result.error, STATUS_FOR_CODE[result.code]);
  }

  const g = ensureGame(id);
  const state = fullPayload(g);
  broadcast(id, { type: 'state', state });

  return okResponse({ move: result.move, state });
}
