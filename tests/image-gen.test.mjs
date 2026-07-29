// Exercises the four functions behind "Generate with AI": draft-image-prompt,
// generate-image, image-task-status, fetch-generated-image.
//
// The one with real security stakes is fetch-generated-image: it is an
// admin-only proxy, but an admin session token could still be replayed
// against it with an arbitrary URL, so it has to refuse anything that is not
// Kie.ai's own result CDN — same class of guard as /api/crawler-check's SSRF
// protection, just a one-vendor allowlist instead of "reject private ranges".
//
// Run: node tests/image-gen.test.mjs

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-key';
process.env.ALLOWED_ORIGINS = 'https://shawnryder.com';
process.env.OPENROUTER_API_KEY = 'stub-openrouter-key';
process.env.KIE_API_KEY = 'stub-kie-key';

import { __setResolver } from '../netlify/lib/safe-fetch.mjs';

let failures = 0;
const ok = (name, condition, detail = '') => {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

// Every hostname resolves to one public address unless a test says otherwise.
__setResolver(async () => [{ address: '93.184.216.34', family: 4 }]);

// ---- stubbed network -------------------------------------------------------
// One switchboard for every outbound fetch: Supabase auth/profiles (for
// requireAdmin), OpenRouter (draft-image-prompt), Kie.ai (generate-image,
// image-task-status), and the pretend result image (fetch-generated-image).

let profileRole = 'admin';       // what /rest/v1/profiles returns
let userResolves = true;         // whether /auth/v1/user succeeds
let openRouterReply = 'A documentary photograph of an empty dealership service bay at dawn.';
let kieTaskState = 'success';    // 'success' | 'fail' | 'waiting'
let kieResultUrl = 'https://tempfile.aiquickdraw.com/images/chatgpt/test.png';
let imageBytes = new Uint8Array([137, 80, 78, 71]); // fake PNG magic bytes
let imageContentType = 'image/png';

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);

  if (u.includes('/auth/v1/user')) {
    return userResolves
      ? new Response(JSON.stringify({ id: 'user-1' }), { status: 200 })
      : new Response('{}', { status: 401 });
  }
  if (u.includes('/rest/v1/profiles')) {
    return new Response(
      JSON.stringify(profileRole ? [{ id: 'user-1', email: 'shawn@shawnryder.com', role: profileRole }] : []),
      { status: 200 }
    );
  }
  if (u.includes('openrouter.ai')) {
    return new Response(JSON.stringify({ choices: [{ message: { content: openRouterReply } }] }), { status: 200 });
  }
  if (u.includes('api.kie.ai/api/v1/jobs/createTask')) {
    return new Response(JSON.stringify({ code: 200, msg: 'success', data: { taskId: 'task-123' } }), { status: 200 });
  }
  if (u.includes('api.kie.ai/api/v1/jobs/recordInfo')) {
    if (kieTaskState === 'success') {
      return new Response(JSON.stringify({
        code: 200, data: { state: 'success', resultJson: JSON.stringify({ resultUrls: [kieResultUrl] }) },
      }), { status: 200 });
    }
    if (kieTaskState === 'fail') {
      return new Response(JSON.stringify({ code: 200, data: { state: 'fail', failMsg: 'moderation blocked' } }), { status: 200 });
    }
    return new Response(JSON.stringify({ code: 200, data: { state: 'generating' } }), { status: 200 });
  }
  if (u.startsWith('https://tempfile.aiquickdraw.com/') || u.includes('.aiquickdraw.com/')) {
    return new Response(imageBytes, {
      status: 200,
      headers: { 'content-type': imageContentType, 'content-length': String(imageBytes.length) },
    });
  }
  throw new Error(`Unstubbed fetch: ${u}`);
};

const draftPrompt = (await import('../netlify/functions/draft-image-prompt.mjs')).default;
const generateImage = (await import('../netlify/functions/generate-image.mjs')).default;
const imageTaskStatus = (await import('../netlify/functions/image-task-status.mjs')).default;
const fetchGeneratedImage = (await import('../netlify/functions/fetch-generated-image.mjs')).default;

const post = (path, body, { auth = true } = {}) =>
  new Request(`https://shawnryder.com${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://shawnryder.com',
      ...(auth ? { authorization: 'Bearer stub-token' } : {}),
    },
    body: JSON.stringify(body),
  });

async function check(label, res, expectStatus, assertBody) {
  const status = res.status;
  const body = res.headers.get('content-type')?.includes('application/json')
    ? await res.json().catch(() => null)
    : await res.arrayBuffer().catch(() => null);
  const okStatus = status === expectStatus;
  const okBody = assertBody ? assertBody(body, res) : true;
  if (!okStatus || !okBody) {
    failures++;
    console.log(`FAIL  ${label}\n      status ${status} (want ${expectStatus}) body ${JSON.stringify(body)?.slice(0, 200)}`);
  } else {
    console.log(`pass  ${label}`);
  }
}

/* --------------------------------------------------- admin gate, shared --- */
console.log('\nevery endpoint requires a signed-in admin');

for (const [label, fn, path, body] of [
  ['draft-image-prompt', draftPrompt, '/api/draft-image-prompt', { subject: 'x', aspectRatio: '16:9' }],
  ['generate-image', generateImage, '/api/generate-image', { prompt: 'x', aspectRatio: '16:9' }],
  ['image-task-status', imageTaskStatus, '/api/image-task-status', { taskId: 't1' }],
  ['fetch-generated-image', fetchGeneratedImage, '/api/fetch-generated-image', { url: kieResultUrl }],
]) {
  await check(`${label}: no token → 401`, await fn(post(path, body, { auth: false })), 401);
}

userResolves = false;
await check('draft-image-prompt: expired session → 401', await draftPrompt(post('/api/draft-image-prompt', { subject: 'x' })), 401);
userResolves = true;

profileRole = 'user';
await check('generate-image: signed in but not admin → 403',
  await generateImage(post('/api/generate-image', { prompt: 'x', aspectRatio: '16:9' })), 403);
profileRole = 'admin';

/* --------------------------------------------------------- draft-prompt --- */
console.log('\ndraft-image-prompt');

await check('drafts a prompt from the subject', await draftPrompt(post('/api/draft-image-prompt', {
  subject: 'Cover image for a guide about review scores', aspectRatio: '16:9',
})), 200, (b) => b.ok && b.prompt === openRouterReply);

await check('empty subject is rejected', await draftPrompt(post('/api/draft-image-prompt', { subject: '' })), 422);

delete process.env.OPENROUTER_API_KEY;
await check('missing OPENROUTER_API_KEY → 503',
  await draftPrompt(post('/api/draft-image-prompt', { subject: 'x' })), 503);
process.env.OPENROUTER_API_KEY = 'stub-openrouter-key';

/* -------------------------------------------------------- generate-image --- */
console.log('\ngenerate-image');

await check('starts a task and returns its id', await generateImage(post('/api/generate-image', {
  prompt: 'An empty dealership lot at dawn', aspectRatio: '4:5',
})), 200, (b) => b.ok && b.taskId === 'task-123');

await check('empty prompt is rejected', await generateImage(post('/api/generate-image', { prompt: '', aspectRatio: '4:5' })), 422);

await check('unsupported aspect ratio is rejected', await generateImage(post('/api/generate-image', {
  prompt: 'x', aspectRatio: '7:3',
})), 422);

delete process.env.KIE_API_KEY;
await check('missing KIE_API_KEY → 503', await generateImage(post('/api/generate-image', { prompt: 'x', aspectRatio: '4:5' })), 503);
process.env.KIE_API_KEY = 'stub-kie-key';

/* ----------------------------------------------------- image-task-status --- */
console.log('\nimage-task-status');

kieTaskState = 'waiting';
await check('still generating → pending, no urls', await imageTaskStatus(post('/api/image-task-status', { taskId: 't1' })),
  200, (b) => b.ok && b.state === 'pending' && !b.resultUrls);

kieTaskState = 'success';
await check('finished → done with a result url', await imageTaskStatus(post('/api/image-task-status', { taskId: 't1' })),
  200, (b) => b.ok && b.state === 'done' && b.resultUrls?.[0] === kieResultUrl);

kieTaskState = 'fail';
await check('failed → failed with a message', await imageTaskStatus(post('/api/image-task-status', { taskId: 't1' })),
  200, (b) => b.ok && b.state === 'failed' && /moderation/.test(b.message));
kieTaskState = 'success';

await check('missing taskId is rejected', await imageTaskStatus(post('/api/image-task-status', {})), 422);

/* -------------------------------------------------- fetch-generated-image --- */
console.log('\nfetch-generated-image — the SSRF-relevant one');

await check('a real Kie.ai result url is fetched and streamed back',
  await fetchGeneratedImage(post('/api/fetch-generated-image', { url: kieResultUrl })),
  200, (_body, res) => res.headers.get('content-type') === 'image/png');

for (const bad of [
  'http://tempfile.aiquickdraw.com/x.png',        // http, not https
  'https://evil.com/x.png',                       // wrong host entirely
  'https://aiquickdraw.com.evil.com/x.png',       // suffix-matching trick
  'https://169.254.169.254/x.png',                // cloud metadata, direct IP
  'not a url',
  '',
]) {
  await check(`rejects: ${bad || '(empty)'}`,
    await fetchGeneratedImage(post('/api/fetch-generated-image', { url: bad })), 422);
}

// A hostname that resolves to a private address must be refused even though
// its name ends in the allowed suffix — DNS is attacker-controlled up to the
// name itself, so the allowlist alone is not the whole guard.
__setResolver(async () => [{ address: '10.0.0.5', family: 4 }]);
await check('an aiquickdraw.com host that resolves privately is refused',
  await fetchGeneratedImage(post('/api/fetch-generated-image', { url: kieResultUrl })), 422);
__setResolver(async () => [{ address: '93.184.216.34', family: 4 }]);

imageContentType = 'text/html';
await check('a non-image content-type is refused',
  await fetchGeneratedImage(post('/api/fetch-generated-image', { url: kieResultUrl })), 502);
imageContentType = 'image/png';

imageBytes = new Uint8Array(16_000_000); // over the 15MB cap
await check('an oversized image is refused',
  await fetchGeneratedImage(post('/api/fetch-generated-image', { url: kieResultUrl })), 502);
imageBytes = new Uint8Array([137, 80, 78, 71]);

console.log(failures ? `\n${failures} FAILING` : '\nall checks passed');
process.exit(failures ? 1 : 0);
