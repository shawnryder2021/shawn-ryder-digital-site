// POST /api/audit-request — the free dealership audit form.
//
// Order matters: validate → store → notify. The lead is durable in Postgres
// before the webhook is attempted, so Shawn never loses a dealer's request to
// a third-party outage.

import { readJsonPost, ok, fail, clientIp } from '../lib/http.mjs';
import * as db from '../lib/supabase.mjs';
import * as hook from '../lib/webhook.mjs';
import { auditRequest, isBot } from '../lib/validate.mjs';

const DUPLICATE_WINDOW_SECONDS = 60;

export default async (req) => {
  const { error, body } = await readJsonPost(req);
  if (error) return error;

  // Caught bots get a success response — no feedback signal to tune against.
  if (isBot(body)) return ok(req, { received: true });

  const { errors, values } = auditRequest(body);
  if (errors) return fail(req, 422, 'Please check the form', errors);

  if (!db.isConfigured()) {
    console.error('audit-request: Supabase env vars missing, cannot store lead');
    return fail(req, 503, 'The form is temporarily unavailable. Please email shawn@shawnryder.com.');
  }

  // Double-click and impatient-resubmit guard.
  try {
    if (await db.submittedRecently('leads', values.email, DUPLICATE_WINDOW_SECONDS)) {
      return ok(req, { duplicate: true });
    }
  } catch (err) {
    // A failed check must not block a real lead.
    console.warn('audit-request: duplicate check failed', err);
  }

  let lead;
  try {
    lead = await db.insert('leads', {
      ...values,
      referrer: req.headers.get('referer') || null,
      user_agent: (req.headers.get('user-agent') || '').slice(0, 500) || null,
    });
  } catch (err) {
    console.error('audit-request: insert failed', err);
    return fail(req, 500, 'Something went wrong saving that. Please email shawn@shawnryder.com.');
  }

  const result = await hook.deliver({
    type: 'audit_request',
    lead_id: lead.id,
    submitted_at: lead.created_at,
    name: values.name,
    dealership: values.dealership || null,
    email: values.email,
    phone: values.phone || null,
    message: values.message || null,
    checklist: values.checklist,
    source_page: values.source_page || null,
    market_slug: values.market_slug || null,
    ip: clientIp(req),
  });

  if (result.status !== 'delivered') {
    console.error(`audit-request: webhook ${result.status}`, result.error);
  }

  try {
    await db.updateById('leads', lead.id, {
      webhook_status: result.status,
      webhook_error: result.error || null,
    });
  } catch (err) {
    console.warn('audit-request: could not record webhook status', err);
  }

  return ok(req, { id: lead.id });
};

export const config = { path: '/api/audit-request' };
