// POST /api/visibility-check — asks an assistant what it knows about a
// dealership, and shows the visitor the answer.
//
// This is the site's own product demonstrated on the visitor's own store. It is
// also a public endpoint that spends money per call, so the order is:
// validate → rate-limit → call the model → store → respond.
//
// Deliberately honest about what it is: a single model answering cold, with no
// browsing. That is precisely the point — it shows what an assistant says when
// it has only its training data and whatever it absorbed about the store.

import { readJsonPost, ok, fail, clientIp } from '../lib/http.mjs';
import * as db from '../lib/supabase.mjs';
import { str, email as validEmail, isBot } from '../lib/validate.mjs';
import { createHash } from 'node:crypto';

const MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-haiku';
const PER_IP_PER_DAY = 3;
const GLOBAL_PER_DAY = 150;      // hard ceiling on the API bill
// Free OpenRouter models are slow and tightly concurrency-limited, so prompts
// run one at a time with a gap between them rather than all at once.
const TIMEOUT_MS = 45000;
const MAX_TOKENS = 400;
const GAP_MS = 600;

/** Real shopper phrasing, not marketing questions. */
const PROMPTS = [
  (d, c) => `I'm buying a used car in ${c}. What can you tell me about ${d}? Are they reputable?`,
  (d, c) => `Which car dealerships in ${c} have the best reputation for customer service?`,
  (d, c) => `Is ${d} in ${c} a good place to buy a vehicle? What do reviews say?`,
];

const hashIp = (ip) =>
  ip ? createHash('sha256').update(`srd:${ip}`).digest('hex').slice(0, 40) : null;

async function askModel(prompt) {
  // Trimmed: a key pasted into a dashboard often carries a trailing newline or
  // stray whitespace, which makes the Authorization header invalid and causes
  // fetch to throw before any request is made — no status, no response body.
  const apiKey = (process.env.OPENROUTER_API_KEY || '').trim();

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'HTTP-Referer': 'https://shawnryder.com',
        'X-Title': 'Shawn Ryder Digital — AI visibility check',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful assistant answering a car shopper. Answer from what you ' +
              'actually know. If you have no reliable information about a specific business, ' +
              'say so plainly rather than inventing details. Keep it under 120 words.',
          },
          { role: 'user', content: prompt },
        ],
      }),
      signal: abort.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status;
      err.upstream = text.slice(0, 300);
      throw err;
    }
    const body = await res.json();

    // OpenRouter can return 200 with an error payload, particularly on free
    // models that are rate-limited or temporarily unavailable.
    if (body.error) {
      const err = new Error(`OpenRouter payload error: ${JSON.stringify(body.error).slice(0, 300)}`);
      err.status = body.error.code || 200;
      err.upstream = body.error.message || JSON.stringify(body.error);
      throw err;
    }
    return body.choices?.[0]?.message?.content?.trim() || '';
  } finally {
    clearTimeout(timer);
  }
}

export default async (req) => {
  const { error, body } = await readJsonPost(req);
  if (error) return error;
  if (isBot(body)) return ok(req, { received: true });

  const dealership = str(body.dealership, 120);
  const city = str(body.city, 80);
  const contactEmail = body.email ? validEmail(body.email) : '';

  const errors = {};
  if (!dealership) errors.dealership = 'Enter your dealership name.';
  if (!city) errors.city = 'Enter your city.';
  if (Object.keys(errors).length) return fail(req, 422, 'Please check the form', errors);

  if (!process.env.OPENROUTER_API_KEY) {
    console.error('visibility-check: OPENROUTER_API_KEY not set');
    return fail(req, 503,
      'The checker is not switched on yet. Ask Shawn to run it for you — shawn@shawnryder.com.');
  }
  if (!db.isConfigured()) return fail(req, 503, 'The checker is temporarily unavailable.');

  // ---- rate limiting -------------------------------------------------------
  const ipHash = hashIp(clientIp(req));
  const since = new Date(Date.now() - 86400000).toISOString();
  try {
    if (ipHash) {
      const mine = await db.select(
        'visibility_checks',
        `?select=id&ip_hash=eq.${ipHash}&created_at=gte.${encodeURIComponent(since)}`
      );
      if ((mine?.length ?? 0) >= PER_IP_PER_DAY) {
        return fail(req, 429,
          `You've run ${PER_IP_PER_DAY} checks today. Email shawn@shawnryder.com and he'll run a full baseline across every major assistant.`);
      }
    }
    const all = await db.select(
      'visibility_checks',
      `?select=id&created_at=gte.${encodeURIComponent(since)}`
    );
    if ((all?.length ?? 0) >= GLOBAL_PER_DAY) {
      return fail(req, 429,
        "The checker has hit today's limit. Email shawn@shawnryder.com and he'll run it manually.");
    }
  } catch (err) {
    // A broken limiter must not become an open tap on a paid API.
    console.error('visibility-check: rate-limit check failed', err);
    return fail(req, 503, 'The checker is temporarily unavailable.');
  }

  // ---- ask the model -------------------------------------------------------
  // Sequential, and tolerant of individual failures: a flaky free model that
  // answers two prompts out of three should still show the visitor something
  // useful rather than an error page.
  const results = [];
  let lastError = null;

  for (const [i, build] of PROMPTS.entries()) {
    const prompt = build(dealership, city);
    try {
      if (i > 0) await new Promise((r) => setTimeout(r, GAP_MS));
      const answer = await askModel(prompt);
      results.push({
        prompt,
        answer,
        mentioned: answer.toLowerCase().includes(dealership.toLowerCase()),
      });
    } catch (err) {
      console.error(`visibility-check: prompt ${i + 1} failed`, err);
      lastError = err;
    }
  }

  if (!results.length) {
    const err = lastError ?? new Error('no answers');

    // Say what actually went wrong. "The assistant did not answer" is useless
    // when the real cause is a wrong model id or an empty OpenRouter balance,
    // and this endpoint is configured by one person who needs to fix it.
    const reason = {
      401: 'OpenRouter rejected the API key. Check OPENROUTER_API_KEY in Netlify.',
      403: 'OpenRouter refused the request for this key or model.',
      402: 'The OpenRouter account is out of credit.',
      404: `OpenRouter does not recognise the model "${MODEL}". Check OPENROUTER_MODEL.`,
      429: 'OpenRouter rate-limited the request. Free models have tight limits — try again shortly or switch model.',
    }[err.status] ||
      (err.name === 'AbortError'
        ? `The model did not respond within ${TIMEOUT_MS / 1000}s. Free models are often slow — try again, or set OPENROUTER_MODEL to a faster one.`
        : null);

    return fail(
      req,
      502,
      reason || 'The assistant did not answer. Please try again in a minute.',
      // Surfaced so the cause is visible without digging through Netlify logs.
      // Contains no key material — only OpenRouter's message, or the local
      // error when the request never left the building.
      {
        model: MODEL,
        ...(err.upstream ? { upstream: String(err.upstream).slice(0, 300) } : {}),
        ...(err.upstream ? {} : { cause: `${err.name}: ${err.message}`.slice(0, 200) }),
      }
    );
  }

  const mentioned = results.some((r) => r.mentioned);

  try {
    await db.insert('visibility_checks', {
      dealership, city,
      email: contactEmail || null,
      results, mentioned, model: MODEL,
      ip_hash: ipHash,
      user_agent: (req.headers.get('user-agent') || '').slice(0, 500) || null,
      referrer: req.headers.get('referer') || null,
    });
  } catch (err) {
    // The visitor already has their answer; losing the record is not their problem.
    console.warn('visibility-check: could not store result', err);
  }

  return ok(req, { dealership, city, mentioned, model: MODEL, results });
};

export const config = { path: '/api/visibility-check' };
