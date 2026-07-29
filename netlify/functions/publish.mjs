// POST /api/publish — triggers a Netlify rebuild so CMS edits go live.
//
// Admin-only. The caller's Supabase access token is verified server-side and
// their role is read from the database; the browser saying "I'm an admin" is
// never trusted. A `user` role gets 403 here even though the button is hidden
// from them in the UI.

import { readJsonPost, ok, fail } from '../lib/http.mjs';
import * as db from '../lib/supabase.mjs';
import { requireAdmin } from '../lib/auth.mjs';

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
