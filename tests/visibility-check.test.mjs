// Exercises /api/visibility-check against a stubbed OpenRouter + Supabase.
// The rate limiting matters most here: this is a public endpoint that spends
// real money per call, so a broken limiter is a billing incident.
//
// Run: node tests/visibility-check.test.mjs

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';
process.env.OPENROUTER_API_KEY = 'stub-openrouter-key';
process.env.ALLOWED_ORIGINS = 'https://shawnryder.com';

let modelCalls = 0;
let existingToday = [];   // rows the stubbed rate-limit query returns
let modelShouldFail = false;
let failFirstN = 0;
let inserted = null;

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);

  if (u.includes('openrouter.ai')) {
    modelCalls++;
    if (modelShouldFail) return new Response('upstream boom', { status: 500 });
    if (failFirstN > 0) { failFirstN--; return new Response('{"error":{"message":"rate limited"}}', { status: 429 }); }
    const body = JSON.parse(opts.body);
    const prompt = body.messages[1].content;
    // Mention the dealership only in the first prompt, to exercise both branches.
    const answer = prompt.includes('What can you tell me about')
      ? 'Whitfield Motors is a dealership in Halifax with generally positive reviews.'
      : 'I do not have reliable information about specific dealerships in that area.';
    return new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }), { status: 200 });
  }

  if (u.includes('/rest/v1/visibility_checks')) {
    if ((opts.method || 'GET') === 'GET') {
      return new Response(JSON.stringify(existingToday), { status: 200 });
    }
    inserted = JSON.parse(opts.body);
    return new Response(JSON.stringify([{ id: 'row-1', ...inserted }]), { status: 201 });
  }
  return new Response('[]', { status: 200 });
};

const handler = (await import('../netlify/functions/visibility-check.mjs')).default;

const post = (body, headers = {}) =>
  new Request('https://shawnryder.com/api/visibility-check', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://shawnryder.com',
      'x-nf-client-connection-ip': '203.0.113.9',
      ...headers,
    },
    body: JSON.stringify(body),
  });

let failures = 0;
async function check(label, res, expectStatus, assert) {
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  const okStatus = res.status === expectStatus;
  const okBody = assert ? assert(body) : true;
  if (!okStatus || !okBody) {
    failures++;
    console.log(`FAIL  ${label}\n      status ${res.status} (want ${expectStatus}) body ${JSON.stringify(body)?.slice(0, 200)}`);
  } else {
    console.log(`pass  ${label}  → ${res.status}`);
  }
  return body;
}

const VALID = { dealership: 'Whitfield Motors', city: 'Halifax' };

// ---- happy path -----------------------------------------------------------
modelCalls = 0;
const okBody = await check('valid check runs', await handler(post(VALID)), 200,
  (b) => b.ok && Array.isArray(b.results) && b.results.length === 3);
console.log(`      model calls: ${modelCalls} (one per prompt)`);
console.log(`      mentioned: ${okBody.mentioned} (true — first answer names the store)`);
console.log(`      per-answer flags: ${JSON.stringify(okBody.results.map((r) => r.mentioned))}`);
console.log(`      stored ip is hashed: ${inserted.ip_hash?.length === 40 && !String(inserted.ip_hash).includes('203.0.113')}`);

// ---- validation -----------------------------------------------------------
await check('missing fields', await handler(post({ dealership: '', city: '' })), 422,
  (b) => b.details.dealership && b.details.city);

await check('honeypot silently dropped', await handler(post({ ...VALID, company_website: 'x' })), 200,
  (b) => b.ok && b.received);

// ---- rate limiting --------------------------------------------------------
modelCalls = 0;
existingToday = [{ id: 1 }, { id: 2 }, { id: 3 }];   // this IP already ran 3
await check('per-IP limit blocks a 4th run', await handler(post(VALID)), 429, (b) => !b.ok);
console.log(`      model calls while blocked: ${modelCalls} (want 0 — no spend)`);
if (modelCalls !== 0) failures++;

modelCalls = 0;
existingToday = Array.from({ length: 150 }, (_, i) => ({ id: i }));  // global cap
await check('global daily cap blocks everyone', await handler(post(VALID)), 429, (b) => !b.ok);
console.log(`      model calls while capped: ${modelCalls} (want 0)`);
if (modelCalls !== 0) failures++;
existingToday = [];

// ---- failure modes --------------------------------------------------------
modelShouldFail = true;
modelCalls = 0;
await check('model failure returns a clear error', await handler(post(VALID)), 502, (b) => !b.ok);
modelShouldFail = false;

delete process.env.OPENROUTER_API_KEY;
modelCalls = 0;
await check('no API key → helpful message, no call', await handler(post(VALID)), 503,
  (b) => !b.ok && /not switched on/i.test(b.error));
console.log(`      model calls without a key: ${modelCalls} (want 0)`);
if (modelCalls !== 0) failures++;
process.env.OPENROUTER_API_KEY = 'stub-openrouter-key';

await check('wrong origin rejected', await handler(post(VALID, { origin: 'https://evil.test' })), 403,
  (b) => !b.ok);


// ---- partial failure ------------------------------------------------------
// A flaky free model that answers some prompts should still produce a result
// rather than an error page.
existingToday = [];
failFirstN = 1;
modelCalls = 0;
const partial = await check('one prompt fails, the rest still return', await handler(post(VALID)), 200,
  (b) => b.ok && b.results.length === 2);
console.log(`      answers returned: ${partial.results.length} of 3`);
failFirstN = 0;

// All three failing gives an actionable message, not a generic one.
failFirstN = 3;
const allFailed = await check('all prompts fail → specific reason', await handler(post(VALID)), 502,
  (b) => !b.ok && /rate-limited/i.test(b.error));
console.log(`      error: ${allFailed.error.slice(0, 70)}`);
console.log(`      upstream surfaced: ${JSON.stringify(allFailed.details)?.slice(0, 90)}`);
failFirstN = 0;

console.log(failures ? `\n${failures} FAILING` : '\nall visibility-check tests passed');
process.exit(failures ? 1 : 0);
