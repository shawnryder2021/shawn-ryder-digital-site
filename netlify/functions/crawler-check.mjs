// POST /api/crawler-check — reads a dealership's robots.txt and homepage and
// reports what an AI crawler can actually reach and understand.
//
// The companion to /api/visibility-check. That one shows a dealer *what* an
// assistant says about them; this one shows *why*. Where the visibility check
// spends money on a model and is capped tightly because of it, this is two HTTP
// requests and a parse — so the limits here exist to stop the endpoint being
// used as a scanner, not to protect a bill.
//
// Everything outbound goes through safe-fetch, which is where the SSRF guards
// live. Read that file before changing anything about how URLs are handled.

import { readJsonPost, ok, fail, clientIp } from '../lib/http.mjs';
import * as db from '../lib/supabase.mjs';
import { str, isBot } from '../lib/validate.mjs';
import { safeFetch, normaliseUrl } from '../lib/safe-fetch.mjs';
import { parseRobots, auditAgents } from '../lib/robots.mjs';
import { auditHtml, htmlFindings } from '../lib/page-audit.mjs';
import { createHash } from 'node:crypto';

const PER_IP_PER_DAY = 10;
const GLOBAL_PER_DAY = 1000;

// Netlify kills a synchronous function at 10s. robots.txt is small and fast;
// the homepage is the one that can hang.
const ROBOTS_TIMEOUT_MS = 3500;
const PAGE_TIMEOUT_MS = 5500;

const hashIp = (ip) =>
  ip ? createHash('sha256').update(`srd:${ip}`).digest('hex').slice(0, 40) : null;

/**
 * robots.txt is "missing" if it 404s — which means everything is allowed, and
 * is good news. But plenty of servers answer a missing file with the homepage
 * or a styled 404 page, and parsing that as robots.txt produces nonsense.
 */
function looksLikeRobots(body, contentType) {
  if (/text\/html/i.test(contentType || '')) return false;
  if (/<html[\s>]/i.test(body.slice(0, 2000))) return false;
  return true;
}

export default async (req) => {
  const { error, body } = await readJsonPost(req);
  if (error) return error;
  if (isBot(body)) return ok(req, { received: true });

  const input = str(body.url, 300);
  if (!input) return fail(req, 422, 'Please check the form', { url: 'Enter your website address.' });

  const target = normaliseUrl(input);
  if (!target) {
    return fail(req, 422, 'Please check the form', {
      url: 'That does not look like a website address. Try something like yourdealership.com',
    });
  }

  if (!db.isConfigured()) return fail(req, 503, 'The checker is temporarily unavailable.');

  // ---- rate limiting -------------------------------------------------------
  // Cheap to run, but it fetches arbitrary URLs on request, so it stays capped.
  const ipHash = hashIp(clientIp(req));
  const since = new Date(Date.now() - 86400000).toISOString();
  try {
    if (ipHash) {
      const mine = await db.select(
        'crawler_checks',
        `?select=id&ip_hash=eq.${ipHash}&created_at=gte.${encodeURIComponent(since)}`
      );
      if ((mine?.length ?? 0) >= PER_IP_PER_DAY) {
        return fail(req, 429,
          `You've run ${PER_IP_PER_DAY} checks today. Email shawn@shawnryder.com if you need more — happy to run them.`);
      }
    }
    const all = await db.select(
      'crawler_checks',
      `?select=id&created_at=gte.${encodeURIComponent(since)}`
    );
    if ((all?.length ?? 0) >= GLOBAL_PER_DAY) {
      return fail(req, 429, "The checker has hit today's limit. Try again tomorrow.");
    }
  } catch (err) {
    console.error('crawler-check: rate-limit check failed', err);
    return fail(req, 503, 'The checker is temporarily unavailable.');
  }

  // ---- robots.txt ----------------------------------------------------------
  const robotsUrl = new URL('/robots.txt', target);
  let robots = { found: false, agents: [], sitemaps: [], raw: '' };

  try {
    const res = await safeFetch(robotsUrl, { timeoutMs: ROBOTS_TIMEOUT_MS, maxBytes: 300_000 });
    if (res.ok && looksLikeRobots(res.body, res.contentType)) {
      const parsed = parseRobots(res.body);
      robots = {
        found: true,
        agents: auditAgents(parsed, '/'),
        sitemaps: parsed.sitemaps.slice(0, 10),
        raw: res.body.slice(0, 4000),
      };
    } else {
      // No robots.txt at all means nothing is blocked. Report it as such.
      robots = { found: false, status: res.status, agents: auditAgents({ groups: [] }, '/'), sitemaps: [], raw: '' };
    }
  } catch (err) {
    // A failure here is usually the same failure the homepage fetch is about to
    // hit, so let that one produce the error message.
    console.warn('crawler-check: robots.txt fetch failed', err.message);
    robots = { found: false, unreachable: true, agents: [], sitemaps: [], raw: '' };
  }

  // ---- the homepage --------------------------------------------------------
  let page = null;
  let pageError = null;
  let finalUrl = target.href;

  try {
    const res = await safeFetch(target, { timeoutMs: PAGE_TIMEOUT_MS });
    finalUrl = res.finalUrl;
    if (!res.ok) {
      pageError = `The site answered ${res.status} for its homepage.`;
    } else if (!/text\/html/i.test(res.contentType || '') && !/<html[\s>]/i.test(res.body.slice(0, 2000))) {
      pageError = 'That address did not return a web page.';
    } else {
      page = auditHtml(res.body);
      page.redirects = res.redirects;
    }
  } catch (err) {
    pageError = err.message || 'Could not reach that site.';
  }

  if (!page && !robots.found && robots.unreachable) {
    return fail(req, 502, pageError || 'Could not reach that site. Check the address and try again.');
  }

  // ---- verdict -------------------------------------------------------------
  const blocked = robots.agents.filter((a) => !a.allowed);
  const blockedAnswers = blocked.filter((a) => a.group === 'answers');
  const findings = page ? htmlFindings(page) : [];

  const verdict = (() => {
    if (blockedAnswers.length) {
      return {
        level: 'bad',
        headline: `Your site is blocking ${blockedAnswers.length} of the crawlers that answer shopper questions.`,
        detail: 'This is not a ranking problem or a content problem. Your robots.txt is telling these services not to read your site, so they cannot describe you to a shopper even if everything else is perfect.',
      };
    }
    if (blocked.length) {
      return {
        level: 'warn',
        headline: `Answer engines can read you, but ${blocked.length} AI ${blocked.length === 1 ? 'crawler is' : 'crawlers are'} blocked.`,
        detail: 'The crawlers that cite live sources can reach you. The ones blocked here feed model training, so the effect is slower — assistants will keep knowing less about you than about stores that allow them.',
      };
    }
    const bad = findings.filter((f) => f.severity === 'bad');
    if (bad.length) {
      return {
        level: 'warn',
        headline: 'Nothing is blocked — but there is not much for a crawler to read.',
        detail: 'Access is not your problem. What they find when they arrive is. The findings below are ordered worst first.',
      };
    }
    return {
      level: 'good',
      headline: 'AI crawlers can reach your site, and there is something there for them to read.',
      detail: 'That puts you ahead of most dealer sites. The remaining items below are the difference between being readable and being quotable.',
    };
  })();

  // ---- store ---------------------------------------------------------------
  try {
    await db.insert('crawler_checks', {
      url: target.href,
      final_url: finalUrl,
      host: target.hostname,
      robots_found: robots.found,
      blocked_agents: blocked.map((a) => a.token),
      verdict: verdict.level,
      findings,
      page_summary: page
        ? {
            title: page.title,
            textLength: page.textLength,
            schemaTypes: page.schemaTypes,
            hasDealerType: page.hasDealerType,
            hasFaqSchema: page.hasFaqSchema,
            noindex: page.noindex,
          }
        : null,
      page_error: pageError,
      ip_hash: ipHash,
      user_agent: (req.headers.get('user-agent') || '').slice(0, 500) || null,
      referrer: req.headers.get('referer') || null,
    });
  } catch (err) {
    console.warn('crawler-check: could not store result', err);
  }

  return ok(req, {
    url: target.href,
    finalUrl,
    host: target.hostname,
    verdict,
    robots: {
      found: robots.found,
      unreachable: Boolean(robots.unreachable),
      sitemaps: robots.sitemaps,
      agents: robots.agents,
    },
    page,
    pageError,
    findings,
  });
};

export const config = { path: '/api/crawler-check' };
