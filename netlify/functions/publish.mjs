// POST /api/publish — triggers a Netlify rebuild so CMS edits go live.
//
// Admin-only. The caller's Supabase access token is verified server-side and
// their role is read from the database; the browser saying "I'm an admin" is
// never trusted. A `user` role gets 403 here even though the button is hidden
// from them in the UI.

import { readJsonPost, ok, fail } from '../lib/http.mjs';
import * as db from '../lib/supabase.mjs';

async function requireAdmin(req) {
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
    return { error: fail(req, 403, 'Publishing requires an admin account') };
  }
  return { profile };
}

export default async (req) => {
  const { error, body } = await readJsonPost(req);
  if (error) return error;

  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const hook = process.env.NETLIFY_BUILD_HOOK_URL;
  if (!hook) {
    return fail(
      req,
      503,
      'No build hook configured. Add NETLIFY_BUILD_HOOK_URL in Netlify → Build & deploy → Build hooks.'
    );
  }

  let buildStarted = false;
  try {
    const res = await fetch(hook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trigger_title: `Publish by ${auth.profile.email}` }),
    });
    buildStarted = res.ok;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('publish: build hook failed', res.status, text.slice(0, 200));
      return fail(req, 502, `Netlify rejected the build request (HTTP ${res.status}).`);
    }
  } catch (err) {
    console.error('publish: build hook unreachable', err);
    return fail(req, 502, 'Could not reach Netlify to start the build.');
  }

  // Stamp the publish time so the admin can compute "unpublished changes".
  // Recorded only after Netlify accepted the build.
  const publishedAt = new Date().toISOString();
  try {
    await db.upsert('site_settings', { key: 'last_published_at', value: publishedAt }, 'key');
  } catch (err) {
    console.warn('publish: could not record last_published_at', err);
  }

  return ok(req, { buildStarted, publishedAt });
};

export const config = { path: '/api/publish' };
