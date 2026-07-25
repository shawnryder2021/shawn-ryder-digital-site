// Request plumbing shared by the form endpoints: CORS, method guard, body
// parsing and the JSON responses the front end expects.

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

/**
 * Origins permitted to POST. Falls back to same-origin-only behaviour when
 * ALLOWED_ORIGINS is unset, which is what local `netlify dev` wants.
 */
function allowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

export function corsHeaders(req) {
  const origin = req.headers.get('origin');
  const allowed = allowedOrigins();

  // No allowlist configured (local dev) → echo the origin back.
  // Allowlist configured → only echo when it matches.
  const ok = allowed.length === 0 || (origin && allowed.includes(origin));

  return {
    ...JSON_HEADERS,
    ...(ok && origin ? { 'access-control-allow-origin': origin } : {}),
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    vary: 'Origin',
  };
}

export function json(req, status, body) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(req) });
}

export function ok(req, body = {}) {
  return json(req, 200, { ok: true, ...body });
}

export function fail(req, status, error, details) {
  return json(req, status, { ok: false, error, ...(details ? { details } : {}) });
}

/**
 * Rejects anything that is not a same-site POST with a JSON body.
 * Returns { error: Response } on rejection, or { body } on success.
 */
export async function readJsonPost(req) {
  if (req.method === 'OPTIONS') {
    return { error: new Response(null, { status: 204, headers: corsHeaders(req) }) };
  }
  if (req.method !== 'POST') {
    return { error: fail(req, 405, 'Method not allowed') };
  }

  const allowed = allowedOrigins();
  const origin = req.headers.get('origin');
  if (allowed.length > 0 && origin && !allowed.includes(origin)) {
    return { error: fail(req, 403, 'Origin not allowed') };
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return { error: fail(req, 400, 'Body must be JSON') };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: fail(req, 400, 'Body must be a JSON object') };
  }

  return { body };
}

export function clientIp(req) {
  return (
    req.headers.get('x-nf-client-connection-ip') ||
    (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    null
  );
}
