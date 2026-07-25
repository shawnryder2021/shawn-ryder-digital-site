// Exercises the two Netlify functions against a stubbed Supabase + webhook.
// Run: npm test

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-key';
process.env.LEAD_WEBHOOK_URL = 'https://cloud.activepieces.com/api/v1/webhooks/STUB';
process.env.ALLOWED_ORIGINS = 'https://shawnryder.com';

let calls = [];
let webhookShouldFail = false;

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, method: opts.method || 'GET', body: opts.body && JSON.parse(opts.body) });

  if (u.includes('activepieces')) {
    return webhookShouldFail
      ? new Response('upstream boom', { status: 502 })
      : new Response('{}', { status: 200 });
  }
  // Duplicate-check GET
  if (opts.method === 'GET' || !opts.method) {
    return new Response('[]', { status: 200 });
  }
  if (opts.method === 'PATCH') {
    return new Response(null, { status: 204 }); // 204 must have a null body
  }
  // Insert / upsert
  const row = { id: 'row-uuid-1', created_at: '2026-07-25T12:00:00Z', ...JSON.parse(opts.body) };
  return new Response(JSON.stringify([row]), { status: 201 });
};

const audit = (await import('../netlify/functions/audit-request.mjs')).default;
const subscribe = (await import('../netlify/functions/subscribe.mjs')).default;

const post = (body, headers = {}) =>
  new Request('https://shawnryder.com/api/audit-request', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://shawnryder.com', ...headers },
    body: JSON.stringify(body),
  });

let failures = 0;
async function check(label, res, expectStatus, assertBody) {
  const status = res.status;
  const body = status === 204 ? null : await res.json().catch(() => null);
  const okStatus = status === expectStatus;
  const okBody = assertBody ? assertBody(body) : true;
  if (!okStatus || !okBody) {
    failures++;
    console.log(`FAIL  ${label}\n      status ${status} (want ${expectStatus}) body ${JSON.stringify(body)}`);
  } else {
    console.log(`pass  ${label}  → ${status} ${JSON.stringify(body)}`);
  }
}

// ---- audit-request -------------------------------------------------------
calls = [];
await check('valid lead', await audit(post({
  name: 'Shawn Ryder', dealership: 'Test Motors', email: 'Dealer@Example.COM',
  phone: '902-555-0100', message: 'Leads sit too long.',
  checklist: ['Leads sometimes sit for hours before anyone calls'],
  source_page: '/contact',
})), 200, (b) => b.ok && b.id === 'row-uuid-1');

const insert = calls.find((c) => c.url.includes('/rest/v1/leads') && c.method === 'POST');
console.log('      stored email  :', JSON.stringify(insert.body.email), '(lower-cased)');
console.log('      stored checklist:', JSON.stringify(insert.body.checklist));
const patch = calls.find((c) => c.method === 'PATCH');
console.log('      webhook status written back:', JSON.stringify(patch.body));

await check('missing name + bad email', await audit(post({ name: '', email: 'nope' })), 422,
  (b) => !b.ok && b.details.name && b.details.email);

const before = calls.length;
await check('honeypot filled', await audit(post({
  name: 'Bot', email: 'bot@spam.io', company_website: 'http://spam.io',
})), 200, (b) => b.ok && b.received);
console.log('      → outbound calls made:', calls.length - before, '(want 0)');
if (calls.length !== before) failures++;

await check('wrong origin', await audit(post({ name: 'A', email: 'a@b.co' },
  { origin: 'https://evil.example' })), 403, (b) => !b.ok);

await check('GET not allowed', await audit(new Request('https://shawnryder.com/api/audit-request',
  { method: 'GET' })), 405, (b) => !b.ok);

await check('CORS preflight', await audit(new Request('https://shawnryder.com/api/audit-request',
  { method: 'OPTIONS', headers: { origin: 'https://shawnryder.com' } })), 204);

// Webhook down: the lead must still be saved and the caller still gets 200.
webhookShouldFail = true;
calls = [];
await check('webhook failure still saves lead', await audit(post({
  name: 'Resilient', email: 'resilient@dealer.com',
})), 200, (b) => b.ok && b.id);
const failPatch = calls.find((c) => c.method === 'PATCH');
console.log('      recorded failure:', JSON.stringify(failPatch.body));
webhookShouldFail = false;

// ---- subscribe -----------------------------------------------------------
calls = [];
await check('subscribe', await subscribe(post({ email: 'gm@store.ca', source_page: '/guides' })),
  200, (b) => b.ok);
const up = calls.find((c) => c.url.includes('newsletter_subscribers'));
console.log('      on_conflict in URL:', up.url.includes('on_conflict=email'));
console.log('      clears unsubscribed_at:', up.body.unsubscribed_at === null);

await check('subscribe bad email', await subscribe(post({ email: 'x' })), 422, (b) => !b.ok);

// ---- missing config ------------------------------------------------------
delete process.env.SUPABASE_URL;
await check('supabase unconfigured', await audit(post({ name: 'A', email: 'a@b.co' })), 503,
  (b) => !b.ok);

console.log(failures ? `\n${failures} FAILING` : '\nall checks passed');
process.exit(failures ? 1 : 0);
