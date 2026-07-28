// Build-time content loader.
//
// Runs on the server during `astro build` only — never in the browser. Reads
// the CMS tables with the service role key, and falls back to the committed
// JSON in src/data/ if the database is unreachable or a table is empty.
//
// That fallback is deliberate: a Supabase outage during a deploy should ship
// the last known-good content, not an empty site.

import guidesJson from '../data/guides.json';
import articlesJson from '../data/articles.json';
import marketsJson from '../data/markets.json';
import reviewsJson from '../data/reviews.json';
import faqJson from '../data/faq.json';
import coreJson from '../data/core.json';
import copyJson from '../data/copy.json';

const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

let warned = false;
function warnOnce(reason) {
  if (warned) return;
  warned = true;
  console.warn(
    `\n  [content] Falling back to src/data/*.json — ${reason}\n` +
      '  The build will succeed with the last committed content.\n'
  );
}

async function table(path) {
  if (!url || !key) {
    warnOnce('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
    return null;
  }
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      warnOnce(`${path} → HTTP ${res.status}`);
      return null;
    }
    const rows = await res.json();
    return Array.isArray(rows) && rows.length ? rows : null;
  } catch (err) {
    warnOnce(`${path} → ${err.message}`);
    return null;
  }
}

/* ------------------------------------------------------------- markets ---- */

export async function getMarkets() {
  const rows = await table('markets?published=is.true&order=sort_order.asc&select=*');
  if (!rows) return marketsJson;

  return rows.map((m) => ({
    slug: m.slug,
    city: m.city,
    region: m.region,
    country: m.country,
    blurb: m.blurb,
    kicker: m.kicker,
    h1: m.h1,
    lede: m.lede,
    seoTitle: m.seo_title,
    seoDesc: m.seo_desc,
    stats: m.stats ?? [],
    whats: m.whats ?? [],
    seasons: m.seasons ?? [],
    faqs: m.faqs ?? [],
  }));
}

/* -------------------------------------------------------------- guides ---- */

export async function getGuides() {
  const rows = await table(
    'guides?order=sort_order.asc&select=*,cover:cover_media_id(url,alt,width,height)'
  );
  if (!rows) {
    // JSON fallback: body lives in articles.json keyed by slug.
    return guidesJson.map((g) => ({
      ...g,
      read: g.read,
      body: null,
      cover: null,
      blocks: articlesJson[g.slug]?.blocks ?? [],
      takeaways: articlesJson[g.slug]?.takeaways ?? [],
    }));
  }

  return rows.map((g) => ({
    slug: g.slug,
    title: g.title,
    category: g.category,
    excerpt: g.excerpt,
    read: g.read_time,
    date: g.date_label,
    takeaways: g.takeaways ?? [],
    body: g.body_markdown || null,
    blocks: [],
    cover: g.cover?.url ? g.cover : null,
    published: g.published && Boolean(g.body_markdown),
  }));
}

/* -------------------------------------------------------------- images ---- */

/**
 * Named image positions, keyed by slot. Returns {} when unset or unreachable —
 * every template treats a missing image as "render the section without one".
 */
export async function getImageSlots() {
  const rows = await table('image_slots?select=key,media:media_id(url,alt,width,height)');
  if (!rows) return {};
  return Object.fromEntries(
    rows.filter((r) => r.media?.url).map((r) => [r.key, r.media])
  );
}

/* ------------------------------------------------------------- reviews ---- */

export async function getReviews() {
  const rows = await table('reviews?order=sort_order.asc&select=*');
  if (!rows) return reviewsJson;
  return rows.map((r) => ({
    text: r.quote, name: r.name, role: r.role, initials: r.initials,
  }));
}

/* ----------------------------------------------------------------- faq ---- */

export async function getFaq() {
  const groups = await table('faq_groups?order=sort_order.asc&select=id,name');
  if (!groups) return faqJson;

  const items = await table('faq_items?order=sort_order.asc&select=group_id,question,answer');
  if (!items) return faqJson;

  return groups.map((g) => ({
    name: g.name,
    items: items
      .filter((i) => i.group_id === g.id)
      .map((i) => ({ q: i.question, a: i.answer })),
  }));
}

/* -------------------------------------------------------------- blocks ---- */

/**
 * Editable page copy, keyed by slug. Falls back to the shapes the templates
 * were originally built against.
 */
export async function getBlocks() {
  const rows = await table('content_blocks?select=key,content');
  const fallback = {
    services: coreJson.services,
    steps: coreJson.steps,
    beliefs: coreJson.beliefs,
    diffs: coreJson.diffs.map((v) => ({ v })),
    home_stats: [
      { k: '25 yrs', v: 'In and around the automotive business' },
      { k: 'Retail first', v: 'Sales floor and operations experience behind every campaign' },
      { k: 'One line', v: 'You deal with me directly, every time' },
    ],
    timeline: copyJson.timeline,
    personal: copyJson.personal,
    roles: copyJson.roles.map((v) => ({ v })),
    brand_types: copyJson.brandTypes,
    ai_teasers: copyJson.aiTeasers,
    ai_shifts: copyJson.aiShifts,
    ai_yes: copyJson.aiYes.map((v) => ({ v })),
    ai_no: copyJson.aiNo.map((v) => ({ v })),
    ai_roadmap: copyJson.aiRoadmap,
    ai_faqs: copyJson.aiFaqs,
    aeo_steps: copyJson.aeoSteps,
    aeo_work: copyJson.aeoWork,
    ai_prompts: copyJson.aiPrompts.map((v) => ({ v })),
    // Never existed in the prototype we could read — empty until Shawn fills
    // them in, and every template hides its section when the list is empty.
    tiers: [],
    audiences: [],
    audit_includes: [],
    home_faqs: [],

    // /scorecard and /process are driven entirely by these, so unlike the
    // sections above they must have real defaults — an empty fallback would
    // render a scorecard with no questions if the database were unreachable
    // during a build.
    scorecard_checks: [
      { v: 'Leads sometimes sit for hours before anyone calls' },
      { v: 'Nobody owns our Google Business Profile posts' },
      { v: 'Our review score doesn’t match how we treat people' },
      { v: 'Social is whatever someone remembers to post' },
      { v: 'We never market to our own customer database' },
      { v: 'We pay several vendors and can’t tell what works' },
    ],
    scorecard_verdicts: [
      { v: 'Nothing ticked yet — start ticking, or just ask for the audit and I’ll find the gaps myself.' },
      { v: 'One gap. Usually the cheapest kind to fix, and often the fastest payback.' },
      { v: 'Two gaps. That’s typically a process problem, not a spend problem.' },
      { v: 'Three gaps. There are deals in your market you’re currently handing to the store down the road.' },
      { v: 'Four gaps. Your traffic is probably fine — the handling of it isn’t.' },
      { v: 'Five gaps. Worth a call this week, honestly.' },
      { v: 'Six of six. Nothing here is unfixable, but it needs one person owning all of it.' },
    ],
    process_steps: [
      { n: '01', title: 'The audit',
        body: 'I go through your website, Google Business Profile, reviews and lead response the way a shopper would — then tell you the honest version of what I find. I also submit a lead to your own store and time the response.',
        yours: 'Your store name and permission to poke around. Nothing else.',
        mine: 'A one-page write-up of what is costing you deals, ranked by what I would fix first.' },
      { n: '02', title: 'The plan',
        body: 'One page. What we fix first, what it should produce, what it costs, and how long before you can judge it. No 40-slide deck, no jargon, no retainer you cannot leave.',
        yours: 'Half an hour on the phone to tell me what you actually care about this quarter.',
        mine: 'A written plan with a start, a finish and a number attached.' },
      { n: '03', title: 'The work',
        body: 'I execute. Search, profile, reviews, email, social, follow-up process — whichever pieces we agreed on. You sell cars. I do not need managing.',
        yours: 'A single point of contact at the store and access to the accounts.',
        mine: 'The work, done, on the schedule we set.' },
      { n: '04', title: 'The check-in',
        body: 'Monthly, in plain language: what moved, what did not, what I am changing next. Measured on appointments and deliveries, not impressions.',
        yours: 'Twenty minutes a month and your sales numbers so we can tie the two together.',
        mine: 'A report you can read in five minutes and repeat to your GM.' },
    ],
  };

  if (!rows) return fallback;

  const fromDb = Object.fromEntries(rows.map((r) => [r.key, r.content ?? []]));
  return { ...fallback, ...fromDb };
}

/* ------------------------------------------------------------ settings ---- */

export async function getSettings() {
  const rows = await table('site_settings?select=key,value');
  const fallback = {
    contact: {
      email: 'shawn@shawnryder.com',
      phone: '902-488-4107',
      phone_href: 'tel:+19024884107',
      phone_e164: '+1-902-488-4107',
    },
    brands: copyJson.brands,
    footer_blurb:
      'Digital marketing for car dealerships — search, social, email, reputation and the follow-up process that closes the loop. Remote across Canada and the United States.',
  };
  if (!rows) return fallback;
  return { ...fallback, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

/* ----------------------------------------------------------------- nav ---- */

export async function getNav() {
  const rows = await table('nav_links?order=sort_order.asc&select=location,group_label,label,href');
  const fallback = {
    header: [
      { label: 'Home', href: '/' }, { label: 'Services', href: '/services' },
      { label: 'Process', href: '/process' }, { label: 'AI', href: '/ai' },
      { label: 'Guides', href: '/guides' }, { label: 'FAQ', href: '/faq' },
      { label: 'About', href: '/about' }, { label: 'Contact', href: '/contact' },
      // Markets is deliberately not here — it lives in the footer only.
    ],
    // Mirrors what scripts/seed.mjs writes, so a build that cannot reach
    // Supabase still ships a usable footer rather than an empty one.
    footer: [
      { group_label: 'Site', label: 'Services', href: '/services' },
      { group_label: 'Site', label: 'Process', href: '/process' },
      { group_label: 'Site', label: 'AI search visibility', href: '/ai-search-visibility' },
      { group_label: 'Site', label: 'Guides', href: '/guides' },
      { group_label: 'Site', label: 'FAQ', href: '/faq' },
      { group_label: 'Site', label: 'About', href: '/about' },
      { group_label: 'Site', label: 'Contact', href: '/contact' },
      { group_label: 'Free tools', label: 'AI crawler check', href: '/ai-crawler-check' },
      { group_label: 'Free tools', label: 'AI visibility check', href: '/ai-visibility-check' },
      { group_label: 'Free tools', label: 'Review calculator', href: '/review-calculator' },
      { group_label: 'Free tools', label: 'Marketing scorecard', href: '/scorecard' },
      { group_label: 'Markets', label: 'All markets', href: '/markets' },
      { group_label: 'Markets', label: 'Halifax, NS', href: '/markets/halifax' },
      { group_label: 'Markets', label: 'Moncton, NB', href: '/markets/moncton' },
      { group_label: 'Markets', label: 'Toronto, ON', href: '/markets/toronto' },
      { group_label: 'Markets', label: 'Boston, MA', href: '/markets/boston' },
    ],
  };
  if (!rows) return fallback;

  return {
    header: rows.filter((r) => r.location === 'header').map(({ label, href }) => ({ label, href })),
    footer: rows.filter((r) => r.location === 'footer'),
  };
}
