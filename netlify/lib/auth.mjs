// Verifies a caller is a signed-in admin. Used by every function that must not
// trust the browser's word for it — the UI hides admin-only controls from a
// `user` account as a courtesy, not as the security boundary; this is.

import { fail } from './http.mjs';
import * as db from './supabase.mjs';

/** Resolves the bearer token to a user and checks their role is 'admin'. */
export async function requireAdmin(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return { error: fail(req, 401, 'Not signed in') };

  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: fail(req, 503, 'Server is not configured') };

  // Resolve the token to a user through Supabase itself — no local JWT parsing.
  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return { error: fail(req, 401, 'Session expired — sign in again') };
  const user = await userRes.json();

  const rows = await db.select(
    'profiles',
    `?select=id,email,role&id=eq.${encodeURIComponent(user.id)}&limit=1`
  );
  const profile = rows?.[0];
  if (!profile) return { error: fail(req, 403, 'No access') };
  if (profile.role !== 'admin') {
    return { error: fail(req, 403, 'This requires an admin account') };
  }
  return { profile };
}
