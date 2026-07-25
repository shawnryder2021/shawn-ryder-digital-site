// Thin PostgREST client. The functions only ever insert two row shapes, so a
// dependency-free fetch wrapper keeps the bundle small and avoids pinning the
// supabase-js major version in the deploy path.
//
// SUPABASE_SERVICE_ROLE_KEY bypasses RLS. It is read here and nowhere else —
// never import this module from anything under src/.

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
  }
  return { url: url.replace(/\/+$/, ''), key };
}

export function isConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function request(path, { method = 'POST', body, prefer, query = '' } = {}) {
  const { url, key } = config();

  const res = await fetch(`${url}/rest/v1/${path}${query}`, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(prefer ? { prefer } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase ${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

/** Read rows. `query` is a PostgREST query string starting with '?'. */
export async function select(table, query) {
  return request(table, { method: 'GET', query });
}

/** Insert one row and return it. */
export async function insert(table, row) {
  const rows = await request(table, {
    body: row,
    prefer: 'return=representation',
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

/** Insert, or update the existing row when `conflictColumn` collides. */
export async function upsert(table, row, conflictColumn) {
  const rows = await request(table, {
    body: row,
    prefer: 'return=representation,resolution=merge-duplicates',
    query: `?on_conflict=${encodeURIComponent(conflictColumn)}`,
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

/** Patch a row by id. Used to record webhook delivery after the fact. */
export async function updateById(table, id, patch) {
  return request(table, {
    method: 'PATCH',
    body: patch,
    query: `?id=eq.${encodeURIComponent(id)}`,
    prefer: 'return=minimal',
  });
}

/**
 * True when `email` already submitted to `table` within the last `seconds`.
 * Cheap double-submit guard — a lambda has no memory between invocations, so
 * the check has to live in the database.
 */
export async function submittedRecently(table, email, seconds) {
  const since = new Date(Date.now() - seconds * 1000).toISOString();
  const rows = await request(table, {
    method: 'GET',
    query:
      `?select=id&email=eq.${encodeURIComponent(email)}` +
      `&created_at=gte.${encodeURIComponent(since)}&limit=1`,
  });
  return Array.isArray(rows) && rows.length > 0;
}
