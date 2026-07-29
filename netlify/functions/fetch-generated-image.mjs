// POST /api/fetch-generated-image — admin-only. Proxies the finished image
// back through our own domain so the browser can turn it into a Blob and feed
// it straight into the existing upload pipeline (downscale, re-encode, insert
// media row) — the same code path a manual upload uses, so a generated image
// gets identical treatment rather than a second, divergent one.
//
// The browser could try fetching the Kie.ai URL directly, but that depends on
// Kie.ai's CORS headers being permissive — not guaranteed, and not ours to
// promise. Proxying through our own function makes it certain.
//
// This is also a narrow SSRF surface worth guarding properly even though the
// URL comes from our own prior Kie.ai call, not directly from a stranger: an
// admin session token could be replayed against this endpoint with any URL.
// So the host is allowlisted to Kie.ai's own result CDN — nothing else is
// fetchable through this proxy, full stop.

import { readJsonPost, fail } from '../lib/http.mjs';
import { requireAdmin } from '../lib/auth.mjs';
import { RESULT_HOST_SUFFIX } from '../lib/kie.mjs';
import { assertPublicHost } from '../lib/safe-fetch.mjs';

const MAX_BYTES = 15_000_000; // Kie.ai can return 4K PNGs; generous but bounded.
const TIMEOUT_MS = 15_000;

export default async (req) => {
  const { error, body } = await readJsonPost(req);
  if (error) return error;

  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  let url;
  try {
    url = new URL(String(body?.url || ''));
  } catch {
    return fail(req, 422, 'Not a valid URL.');
  }
  if (url.protocol !== 'https:') return fail(req, 422, 'Only https URLs are accepted.');
  if (!url.hostname.endsWith(RESULT_HOST_SUFFIX)) {
    return fail(req, 422, `This proxy only fetches Kie.ai result images (*${RESULT_HOST_SUFFIX}).`);
  }

  try {
    await assertPublicHost(url.hostname);
  } catch (err) {
    return fail(req, 422, err.message);
  }

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(url.href, { signal: abort.signal, redirect: 'error' });
    if (!upstream.ok) {
      return fail(req, 502, `Kie.ai returned HTTP ${upstream.status} for the image.`);
    }
    const contentType = upstream.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      return fail(req, 502, `Expected an image, got "${contentType || 'unknown'}".`);
    }
    const contentLength = Number(upstream.headers.get('content-length') || 0);
    if (contentLength > MAX_BYTES) {
      return fail(req, 502, `Image is ${(contentLength / 1e6).toFixed(1)} MB — larger than expected.`);
    }

    // Buffer with a hard cap regardless of what content-length claimed.
    const reader = upstream.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) {
        reader.cancel().catch(() => {});
        return fail(req, 502, 'Image exceeded the size limit while downloading.');
      }
      chunks.push(value);
    }
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { buf.set(c, offset); offset += c.length; }

    return new Response(buf, {
      status: 200,
      headers: { 'content-type': contentType, 'cache-control': 'no-store' },
    });
  } catch (err) {
    if (err.name === 'AbortError') return fail(req, 504, 'The image took too long to download.');
    console.error('fetch-generated-image: failed', err);
    return fail(req, 502, 'Could not download the generated image.');
  } finally {
    clearTimeout(timer);
  }
};

export const config = { path: '/api/fetch-generated-image' };
