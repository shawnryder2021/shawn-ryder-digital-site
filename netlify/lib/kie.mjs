// Thin client for Kie.ai's image generation API (docs.kie.ai).
//
// Generation is async and slow — GPT Image 2 typically takes 30-90 seconds,
// far past Netlify's 10s synchronous function limit. So this library only ever
// does two fast things: start a task, and check one. The waiting happens as
// the browser polling image-task-status.mjs every few seconds, never as a
// function sitting in a loop.

const API_BASE = 'https://api.kie.ai/api/v1/jobs';

// The model users mean when they say "use ChatGPT to make images" — it's
// OpenAI's GPT Image 2 via Kie.ai's proxy. Kept as a constant rather than a
// caller-supplied value: this endpoint is admin-only already, and pinning the
// model keeps the billing predictable.
export const MODEL = 'gpt-image-2-text-to-image';

// Kie.ai serves finished images from this domain. generate-image-fetch.mjs
// refuses to fetch from anywhere else — see that file for why.
export const RESULT_HOST_SUFFIX = '.aiquickdraw.com';

function apiKey() {
  const key = (process.env.KIE_API_KEY || '').trim();
  if (!key) throw new Error('KIE_API_KEY is not set.');
  return key;
}

/** Starts a generation task. Returns the taskId immediately — does not wait. */
export async function startImageTask(prompt, aspectRatio) {
  const res = await fetch(`${API_BASE}/createTask`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      input: { prompt, aspect_ratio: aspectRatio || 'auto' },
    }),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.code !== 200) {
    const msg = body?.msg || `Kie.ai returned HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  const taskId = body.data?.taskId;
  if (!taskId) throw new Error('Kie.ai did not return a task id.');
  return taskId;
}

/**
 * Checks one task. Returns one of:
 *   { state: 'pending' }
 *   { state: 'done', resultUrls: string[] }
 *   { state: 'failed', message: string }
 */
export async function checkImageTask(taskId) {
  const res = await fetch(`${API_BASE}/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
    headers: { authorization: `Bearer ${apiKey()}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.code !== 200) {
    return { state: 'failed', message: body?.msg || `Kie.ai returned HTTP ${res.status}` };
  }

  const data = body.data || {};
  if (data.state === 'success') {
    let resultUrls = [];
    try {
      resultUrls = JSON.parse(data.resultJson || '{}').resultUrls || [];
    } catch {
      /* fall through with an empty result — handled below */
    }
    if (!resultUrls.length) return { state: 'failed', message: 'Kie.ai reported success with no image.' };
    return { state: 'done', resultUrls };
  }
  if (data.state === 'fail') {
    return { state: 'failed', message: data.failMsg || 'Generation failed.' };
  }
  // waiting | queuing | generating
  return { state: 'pending' };
}
