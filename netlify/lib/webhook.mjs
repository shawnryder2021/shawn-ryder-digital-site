// Delivery to the Activepieces webhook.
//
// Notification is best-effort by design: the lead is already committed to the
// database before this runs, so a webhook outage costs a notification, never a
// lead. The outcome is written back onto the row so failures are visible and
// replayable rather than silent.

const TIMEOUT_MS = 8000;

export function isConfigured() {
  return Boolean(process.env.LEAD_WEBHOOK_URL);
}

/**
 * @returns {Promise<{status: 'delivered'|'failed'|'skipped', error?: string}>}
 */
export async function deliver(payload) {
  const url = process.env.LEAD_WEBHOOK_URL;
  if (!url) return { status: 'skipped', error: 'LEAD_WEBHOOK_URL not set' };

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abort.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { status: 'failed', error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    }
    return { status: 'delivered' };
  } catch (err) {
    const reason = err?.name === 'AbortError' ? `timed out after ${TIMEOUT_MS}ms` : String(err);
    return { status: 'failed', error: reason.slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}
