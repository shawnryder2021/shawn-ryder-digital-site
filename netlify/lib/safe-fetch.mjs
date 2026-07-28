// Outbound fetch for URLs a stranger typed into a form.
//
// /api/crawler-check takes a dealership URL from an anonymous visitor and
// fetches it. That is a server-side request forgery surface: without guards,
// anyone could point it at http://169.254.169.254/ and read cloud metadata, or
// walk an internal network by watching which hostnames respond.
//
// So: scheme allowlist, DNS resolution checked against every private range,
// redirects followed manually and re-validated at each hop, hard timeout, hard
// size cap.
//
// Residual risk, stated plainly: a hostname could resolve to a public address
// during the check and a private one at connect time (DNS rebinding). Closing
// that properly means connecting by IP with a pinned Host header, which breaks
// TLS certificate validation. The trade is acceptable here because the endpoint
// returns a small fixed summary — title, meta tags, schema type names — and
// never the response body, so a successful rebind leaks very little.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;

/** Blocks loopback, link-local, RFC1918, CGNAT, multicast, test and reserved. */
export function ipv4IsPrivate(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // unparseable → treat as unsafe
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;             // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;               // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true;   // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51) return true;              // TEST-NET-2
  if (a === 203 && b === 0) return true;               // TEST-NET-3
  if (a >= 224) return true;                           // multicast + reserved
  return false;
}

export function ipv6IsPrivate(ip) {
  const s = String(ip).toLowerCase().split('%')[0];
  if (s === '::' || s === '::1') return true;

  // IPv4-mapped (::ffff:10.0.0.1) and IPv4-compatible addresses reach the same
  // hosts as their v4 form, so they have to be judged as v4.
  const mapped = s.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/) || s.match(/^::(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return ipv4IsPrivate(mapped[1]);

  const head = parseInt(s.split(':')[0] || '0', 16);
  if (Number.isNaN(head)) return true;
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7  unique local
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

export function isPrivateAddress(ip) {
  const family = isIP(ip);
  if (family === 4) return ipv4IsPrivate(ip);
  if (family === 6) return ipv6IsPrivate(ip);
  return true;
}

/**
 * Accepts what people actually type — "example.com", "www.example.com/",
 * "HTTPS://Example.com" — and returns a URL, or null if it cannot be one.
 */
export function normaliseUrl(input) {
  let raw = String(input ?? '').trim();
  if (!raw) return null;
  if (raw.length > 300) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null; // credentials-in-URL confusion
  if (!url.hostname) return null;

  // A hostname with no dot is either a bare internal name ("intranet") or
  // localhost. Neither belongs here.
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return null;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) return null;
  if (!host.includes('.') && !isIP(host)) return null;

  return url;
}

// Swappable so the test suite can run offline. Production never calls this;
// see tests/crawler-check.test.mjs.
let resolve = (host) => lookup(host, { all: true });
export function __setResolver(fn) {
  resolve = fn;
}

/** Throws unless every address the hostname resolves to is publicly routable. */
export async function assertPublicHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '');

  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('That address is not publicly reachable.');
    return;
  }

  let addresses;
  try {
    addresses = await resolve(host);
  } catch {
    throw new Error(`Could not find a site at ${hostname}. Check the address and try again.`);
  }
  if (!addresses.length) throw new Error(`Could not find a site at ${hostname}.`);
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) throw new Error('That address is not publicly reachable.');
  }
}

async function readCapped(res, maxBytes) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(0, maxBytes));
}

/**
 * Fetches `target`, following redirects by hand so each hop is re-validated.
 * Resolves to { ok, status, finalUrl, body, redirects } — a non-2xx is a
 * result, not an exception, because "your robots.txt 404s" is useful news.
 */
export async function safeFetch(target, { timeoutMs = 5000, maxBytes = MAX_BYTES } = {}) {
  let url = target instanceof URL ? target : normaliseUrl(target);
  if (!url) throw new Error('That does not look like a web address.');

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const redirects = [];

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicHost(url.hostname);

      const res = await fetch(url.href, {
        redirect: 'manual',
        signal: abort.signal,
        headers: {
          // Identify honestly. A dealer looking at their own logs should be
          // able to tell what hit them and why.
          'user-agent':
            'ShawnRyderDigital-SiteCheck/1.0 (+https://shawnryder.com/ai-crawler-check)',
          accept: 'text/html,text/plain;q=0.9,*/*;q=0.8',
          'accept-language': 'en',
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) return { ok: false, status: res.status, finalUrl: url.href, body: '', redirects };
        let next;
        try {
          next = new URL(location, url);
        } catch {
          return { ok: false, status: res.status, finalUrl: url.href, body: '', redirects };
        }
        if (next.protocol !== 'http:' && next.protocol !== 'https:') {
          throw new Error('That site redirects somewhere this checker will not follow.');
        }
        redirects.push({ from: url.href, to: next.href, status: res.status });
        url = next;
        continue;
      }

      const body = await readCapped(res, maxBytes);
      return {
        ok: res.ok,
        status: res.status,
        finalUrl: url.href,
        contentType: res.headers.get('content-type') || '',
        headers: res.headers,
        body,
        redirects,
      };
    }
    throw new Error('That site redirects too many times.');
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('The site took too long to respond.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
