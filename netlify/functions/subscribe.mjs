// POST /api/subscribe — "notify me when a new guide goes up".
//
// Upsert rather than insert: someone signing up twice is a no-op, and someone
// who previously unsubscribed is resurrected by clearing unsubscribed_at.

import { readJsonPost, ok, fail } from '../lib/http.mjs';
import * as db from '../lib/supabase.mjs';
import * as hook from '../lib/webhook.mjs';
import { subscription, isBot } from '../lib/validate.mjs';

export default async (req) => {
  const { error, body } = await readJsonPost(req);
  if (error) return error;

  if (isBot(body)) return ok(req, { received: true });

  const { errors, values } = subscription(body);
  if (errors) return fail(req, 422, 'Please check the form', errors);

  if (!db.isConfigured()) {
    console.error('subscribe: Supabase env vars missing');
    return fail(req, 503, 'Signup is temporarily unavailable.');
  }

  let row;
  try {
    row = await db.upsert(
      'newsletter_subscribers',
      {
        email: values.email,
        source_page: values.source_page || null,
        referrer: req.headers.get('referer') || null,
        unsubscribed_at: null,
      },
      'email'
    );
  } catch (err) {
    console.error('subscribe: upsert failed', err);
    return fail(req, 500, 'Something went wrong. Please try again.');
  }

  // Non-blocking: a subscriber is worth less than an audit request, so a
  // webhook failure is logged and forgotten rather than written back.
  const result = await hook.deliver({
    type: 'newsletter_subscribe',
    subscriber_id: row.id,
    email: values.email,
    source_page: values.source_page || null,
    submitted_at: row.created_at,
  });

  if (result.status !== 'delivered') {
    console.error(`subscribe: webhook ${result.status}`, result.error);
  }

  return ok(req);
};

export const config = { path: '/api/subscribe' };
