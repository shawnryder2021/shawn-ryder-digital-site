// Exercises /api/crawler-check and the two libraries behind it.
//
// Two things here matter more than the rest:
//
//   1. The robots.txt matcher. Telling a dealer "you are blocking ChatGPT"
//      when they are not is worse than having no tool at all, so the group
//      selection and longest-match rules are tested against the cases real
//      robots.txt files actually contain.
//
//   2. The SSRF guards. This endpoint fetches a URL an anonymous stranger
//      typed, so every private range has to be refused before a socket opens.
//
// Run: node tests/crawler-check.test.mjs

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-key';
process.env.ALLOWED_ORIGINS = 'https://shawnryder.com';

import {
  parseRobots, rulesFor, isAllowed, auditAgents,
} from '../netlify/lib/robots.mjs';
import {
  isPrivateAddress, normaliseUrl, safeFetch, __setResolver,
} from '../netlify/lib/safe-fetch.mjs';
import { auditHtml, htmlFindings } from '../netlify/lib/page-audit.mjs';

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
let resolvesTo = [{ address: '93.184.216.34', family: 4 }];
__setResolver(async () => resolvesTo);

/* ------------------------------------------------------------- robots ---- */
console.log('\nrobots.txt parsing');

{
  const r = parseRobots(`
User-agent: *
Disallow: /admin/

User-agent: GPTBot
Disallow: /
`);
  ok('named group beats the * group',
    isAllowed(rulesFor(r, 'GPTBot').rules, '/').allowed === false);
  ok('* group applies to an agent with no group of its own',
    isAllowed(rulesFor(r, 'PerplexityBot').rules, '/').allowed === true);
  ok('a rule under * still blocks its own path',
    isAllowed(rulesFor(r, 'PerplexityBot').rules, '/admin/').allowed === false);
}

{
  // Consecutive user-agent lines share the rules beneath them — a very common
  // shape, and the one a naive line-by-line parser gets wrong.
  const r = parseRobots(`
User-agent: GPTBot
User-agent: CCBot
User-agent: ClaudeBot
Disallow: /
`);
  ok('stacked user-agent lines all take the following rules',
    ['GPTBot', 'CCBot', 'ClaudeBot'].every(
      (a) => isAllowed(rulesFor(r, a).rules, '/').allowed === false
    ));
}

{
  const r = parseRobots('User-agent: *\nDisallow:');
  ok('an empty Disallow allows everything',
    isAllowed(rulesFor(r, 'GPTBot').rules, '/').allowed === true);
}

{
  const r = parseRobots('User-agent: *\nDisallow: /\nAllow: /inventory/');
  ok('longest match wins over a shorter Disallow',
    isAllowed(rulesFor(r, 'GPTBot').rules, '/inventory/new').allowed === true);
  ok('the shorter Disallow still applies elsewhere',
    isAllowed(rulesFor(r, 'GPTBot').rules, '/about').allowed === false);
}

{
  const r = parseRobots('User-agent: *\nDisallow: /*.pdf$');
  const rules = rulesFor(r, 'GPTBot').rules;
  ok('$ anchors the end of the path', isAllowed(rules, '/specs/window-sticker.pdf').allowed === false);
  ok('$ does not match past the anchor', isAllowed(rules, '/specs/a.pdf?x=1').allowed === true);
}

{
  const r = parseRobots('User-agent: *\nAllow: /x\nDisallow: /x');
  ok('Allow wins a same-length tie', isAllowed(rulesFor(r, 'GPTBot').rules, '/x').allowed === true);
}

{
  const r = parseRobots(`
# a comment
User-agent: *   # trailing comment
Disallow: /private/
Sitemap: https://example.com/sitemap.xml
Crawl-delay: 10
`);
  ok('comments are stripped and unknown directives ignored',
    isAllowed(rulesFor(r, 'GPTBot').rules, '/').allowed === true);
  ok('sitemaps are collected', r.sitemaps[0] === 'https://example.com/sitemap.xml');
}

{
  const r = parseRobots('user-AGENT: gptBOT\nDISALLOW: /');
  ok('field names and agent tokens are case-insensitive',
    isAllowed(rulesFor(r, 'GPTBot').rules, '/').allowed === false);
}

{
  const agents = auditAgents(parseRobots('User-agent: GPTBot\nDisallow: /'), '/');
  const gpt = agents.find((a) => a.token === 'GPTBot');
  const oai = agents.find((a) => a.token === 'OAI-SearchBot');
  ok('audit reports GPTBot blocked', gpt.allowed === false && /Disallow: \//.test(gpt.rule));
  ok('audit leaves unmentioned agents allowed', oai.allowed === true);
  ok('an empty robots.txt allows every agent',
    auditAgents(parseRobots(''), '/').every((a) => a.allowed));
}

{
  const agents = auditAgents(parseRobots('User-agent: *\nDisallow: /inventory/'), '/');
  ok('homepage-allowed but restricted elsewhere is flagged separately',
    agents.every((a) => a.allowed) && agents.every((a) => a.restrictedElsewhere));
}

/* ----------------------------------------------------------- ssrf ---- */
console.log('\nSSRF guards');

const PRIVATE = [
  '127.0.0.1', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.1',
  '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '198.18.0.1',
  '224.0.0.1', '255.255.255.255', '::1', '::', 'fc00::1', 'fd12:3456::1',
  'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1',
];
ok('every private address is refused',
  PRIVATE.every((ip) => isPrivateAddress(ip) === true),
  PRIVATE.filter((ip) => !isPrivateAddress(ip)).join(', '));

const PUBLIC = ['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111'];
ok('public addresses are allowed',
  PUBLIC.every((ip) => isPrivateAddress(ip) === false),
  PUBLIC.filter((ip) => isPrivateAddress(ip)).join(', '));

ok('garbage is treated as private', isPrivateAddress('not-an-ip') === true);

ok('bare domain gets https://', normaliseUrl('example.com')?.href === 'https://example.com/');
ok('an explicit scheme is kept', normaliseUrl('http://example.com')?.protocol === 'http:');
ok('non-http schemes are refused', normaliseUrl('file:///etc/passwd') === null);
ok('javascript: is refused', normaliseUrl('javascript:alert(1)') === null);
ok('localhost is refused', normaliseUrl('localhost') === null);
ok('http://localhost is refused', normaliseUrl('http://localhost:3000') === null);
ok('.local is refused', normaliseUrl('printer.local') === null);
ok('.internal is refused', normaliseUrl('db.internal') === null);
ok('a dotless host is refused', normaliseUrl('intranet') === null);
ok('credentials in the URL are refused', normaliseUrl('https://user:pass@example.com') === null);
ok('empty input is refused', normaliseUrl('   ') === null);

{
  // The DNS check has to fire before any socket is opened.
  resolvesTo = [{ address: '169.254.169.254', family: 4 }];
  let fetched = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetched = true; return new Response('', { status: 200 }); };
  let threw = null;
  try {
    await safeFetch('https://metadata.example.com');
  } catch (err) {
    threw = err;
  }
  globalThis.fetch = realFetch;
  ok('a hostname resolving to cloud metadata is refused', Boolean(threw));
  ok('and no request is made', fetched === false);
  resolvesTo = [{ address: '93.184.216.34', family: 4 }];
}

{
  // A public host that redirects to a private one must be caught at the hop.
  resolvesTo = [{ address: '93.184.216.34', family: 4 }];
  let hops = 0;
  globalThis.fetch = async (url) => {
    hops++;
    if (hops === 1) {
      resolvesTo = [{ address: '10.0.0.5', family: 4 }];
      return new Response(null, { status: 302, headers: { location: 'https://internal.example.com/' } });
    }
    return new Response('should never get here', { status: 200 });
  };
  let threw = null;
  try {
    await safeFetch('https://example.com');
  } catch (err) {
    threw = err;
  }
  ok('a redirect into a private range is refused', Boolean(threw));
  ok('and the second hop is never fetched', hops === 1, `hops=${hops}`);
  resolvesTo = [{ address: '93.184.216.34', family: 4 }];
}

/* -------------------------------------------------------- page audit ---- */
console.log('\npage audit');

{
  const shell = '<html><head><title>Whitfield Motors</title></head><body><div id="root"></div><script>renderApp()</script></body></html>';
  const a = auditHtml(shell);
  ok('a JavaScript shell is detected as near-empty', a.textLength < 500, `textLength=${a.textLength}`);
  ok('and it produces a "bad" finding',
    htmlFindings(a).some((f) => f.severity === 'bad' && /readable text/i.test(f.title)));
  ok('script contents are not counted as text', !/renderApp/.test(String(a.textLength)));
}

{
  const html = `<html><head>
    <title>Whitfield Motors — New and Used Cars in Halifax</title>
    <meta name="description" content="Family owned since 1994.">
    <meta name="viewport" content="width=device-width">
    <link rel="canonical" href="https://example.com/">
    <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'AutoDealer',
      name: 'Whitfield Motors',
      address: { '@type': 'PostalAddress', streetAddress: '1 Main St' },
      telephone: '+1-902-555-0100',
      openingHours: 'Mo-Fr 09:00-18:00',
      sameAs: ['https://facebook.com/whitfield'],
    })}</script>
    </head><body><h1>Whitfield Motors</h1><p>${'Real sentences about the dealership. '.repeat(60)}</p></body></html>`;
  const a = auditHtml(html);
  ok('AutoDealer schema is found', a.hasDealerType === true);
  ok('its properties are checked', a.dealerHas.address && a.dealerHas.telephone && a.dealerHas.openingHours);
  ok('a complete dealer page has no "bad" findings',
    htmlFindings(a).every((f) => f.severity !== 'bad'),
    htmlFindings(a).filter((f) => f.severity === 'bad').map((f) => f.title).join('; '));
}

{
  const html = `<html><head><title>T</title>
    <script type="application/ld+json">{ "@type": "AutoDealer", "name": "Bad "Quotes" Motors" }</script>
    </head><body>${'x '.repeat(900)}</body></html>`;
  const a = auditHtml(html);
  ok('malformed JSON-LD is counted rather than crashing', a.invalidJsonLd === 1);
  ok('and reported as a "bad" finding',
    htmlFindings(a).some((f) => f.severity === 'bad' && /could not be read/i.test(f.title)));
}

{
  const a = auditHtml('<html><head><meta name="robots" content="noindex, follow"><title>x</title></head><body>y</body></html>');
  ok('noindex is detected', a.noindex === true);
  ok('and reported first', htmlFindings(a)[0].severity === 'bad');
}

{
  const graph = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [{ '@type': 'WebSite' }, { '@type': ['LocalBusiness', 'AutoDealer'], telephone: '1' }],
  });
  const a = auditHtml(`<html><head><script type="application/ld+json">${graph}</script></head><body>x</body></html>`);
  ok('@graph and array @type are both traversed',
    a.hasDealerType && a.schemaTypes.includes('WebSite'));
}

/* ------------------------------------------------------ the endpoint ---- */
console.log('\n/api/crawler-check');

let robotsBody = 'User-agent: GPTBot\nDisallow: /\n';
let robotsStatus = 200;
let existingToday = [];
let inserted = null;
let outboundHosts = [];

const homepage = `<html><head><title>Whitfield Motors — Halifax</title>
  <meta name="description" content="d"><meta name="viewport" content="width=device-width">
  </head><body><h1>Whitfield Motors</h1>${'Words about the store. '.repeat(80)}</body></html>`;

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);

  if (u.includes('stub.supabase.co')) {
    if ((opts.method || 'GET') === 'GET') return new Response(JSON.stringify(existingToday), { status: 200 });
    inserted = JSON.parse(opts.body);
    return new Response(JSON.stringify([{ id: 'row-1', ...inserted }]), { status: 201 });
  }

  outboundHosts.push(new URL(u).host);
  if (u.endsWith('/robots.txt')) {
    return new Response(robotsBody, {
      status: robotsStatus,
      headers: { 'content-type': 'text/plain' },
    });
  }
  return new Response(homepage, { status: 200, headers: { 'content-type': 'text/html' } });
};

const check = (await import('../netlify/functions/crawler-check.mjs')).default;

const post = (body) =>
  new Request('https://shawnryder.com/api/crawler-check', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://shawnryder.com',
      // Netlify always sets this. Without it the per-IP limiter has no key and
      // silently falls through to the global cap only — which is how the
      // rate-limit test caught that the header was missing here.
      'x-nf-client-connection-ip': '198.51.100.7',
    },
    body: JSON.stringify(body),
  });

const run = async (body) => {
  const res = await check(post(body));
  return { status: res.status, body: await res.json() };
};

{
  const { status, body } = await run({ url: 'whitfieldmotors.ca' });
  ok('a blocked GPTBot returns 200 with a verdict', status === 200 && body.ok);
  const gpt = body.robots.agents.find((a) => a.token === 'GPTBot');
  ok('GPTBot is reported blocked', gpt.allowed === false);
  ok('answer engines are still allowed',
    body.robots.agents.filter((a) => a.group === 'answers').every((a) => a.allowed));
  ok('verdict is a warning, not an alarm, when only training is blocked',
    body.verdict.level === 'warn', body.verdict.level);
  ok('the result is stored', inserted && inserted.blocked_agents.includes('GPTBot'));
  ok('both files were fetched', outboundHosts.length === 2);
}

{
  robotsBody = 'User-agent: OAI-SearchBot\nDisallow: /\nUser-agent: PerplexityBot\nDisallow: /\n';
  const { body } = await run({ url: 'https://whitfieldmotors.ca' });
  ok('blocking an answer engine escalates the verdict to bad', body.verdict.level === 'bad');
  ok('and the headline names the count', /2 of the crawlers/.test(body.verdict.headline));
}

{
  robotsStatus = 404;
  robotsBody = '';
  const { body } = await run({ url: 'whitfieldmotors.ca' });
  ok('a missing robots.txt means nothing is blocked',
    body.robots.found === false && body.robots.agents.every((a) => a.allowed));
  robotsStatus = 200;
}

{
  // Servers that answer a missing robots.txt with the styled homepage must not
  // have that HTML parsed as directives.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('stub.supabase.co')) return realFetch(url, opts);
    return new Response('<html><body>404 not found</body></html>', {
      status: 200, headers: { 'content-type': 'text/html' },
    });
  };
  const { body } = await run({ url: 'whitfieldmotors.ca' });
  ok('an HTML "robots.txt" is not parsed as robots.txt', body.robots.found === false);
  globalThis.fetch = realFetch;
}

{
  const { status, body } = await run({ url: 'not a url at all !!' });
  ok('junk input is a 422 with a field error', status === 422 && body.details.url);
}

{
  const { status, body } = await run({ url: 'http://192.168.1.1/' });
  ok('a private IP is refused', status >= 400, `got ${status}`);
  ok('and never fetched', !outboundHosts.includes('192.168.1.1'));
}

{
  const before = outboundHosts.length;
  const { status } = await run({ url: 'whitfieldmotors.ca', company_website: 'spam' });
  ok('the honeypot returns 200 and fetches nothing',
    status === 200 && outboundHosts.length === before);
}

{
  existingToday = Array.from({ length: 10 }, (_, i) => ({ id: i }));
  const before = outboundHosts.length;
  const { status, body } = await run({ url: 'whitfieldmotors.ca' });
  ok('the per-IP daily cap returns 429', status === 429 && /10 checks today/.test(body.error));
  ok('and makes no outbound request', outboundHosts.length === before);
  existingToday = [];
}

console.log(failures ? `\n${failures} FAILING` : '\nall checks passed');
process.exit(failures ? 1 : 0);
