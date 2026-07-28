// One-time (and re-runnable) seed of the CMS tables from src/data/*.json.
//
//   SUPABASE_SERVICE_ROLE_KEY=... npm run seed
//
// Idempotent: every write is an upsert keyed on the natural primary key, so
// running it twice changes nothing. Safe to re-run after editing the JSON if
// you ever need to reset a table to its committed state.
//
// Pass --force to overwrite rows that already exist in the database. Without
// it, tables that already hold rows are left alone so a stray run can never
// clobber content edited in the admin.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Read .env automatically so this is a one-word command rather than a line of
// shell that also leaves the secret in your terminal history.
const envFile = join(root, '.env');
if (existsSync(envFile) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envFile);
}

const url = (process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const force = process.argv.includes('--force');

if (!key) {
  console.error(`
Missing SUPABASE_SERVICE_ROLE_KEY.

  1. Open your Supabase project → Project Settings → API keys
  2. Copy the "service_role" key (the secret one, not "anon"/"publishable")
  3. Paste it into the .env file in this folder, on this line:

       SUPABASE_SERVICE_ROLE_KEY=paste_it_here

  4. Run  npm run seed  again
`);
  process.exit(1);
}
if (!url) {
  console.error('Missing SUPABASE_URL in .env.');
  process.exit(1);
}

const data = (name) => JSON.parse(readFileSync(join(root, 'src/data', `${name}.json`), 'utf8'));

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(prefer ? { prefer } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function count(table) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: key, authorization: `Bearer ${key}`, prefer: 'count=exact' },
  });
  return Number((res.headers.get('content-range') || '*/0').split('/')[1] || 0);
}

/**
 * Inserts rows that are missing and leaves existing ones alone.
 *
 * The old behaviour was all-or-nothing: skip the whole table if it had any
 * rows. That made adding content impossible without --force, which overwrites
 * everything including admin edits. Topping up by key is both safer and what
 * you actually want when new markets or guides are added to the JSON.
 */
async function seed(table, rows, conflict) {
  if (!rows.length) {
    console.log(`  ${table.padEnd(16)} nothing to insert`);
    return;
  }

  // Tables keyed by a generated id cannot be topped up by natural key, so they
  // keep the original all-or-nothing behaviour.
  if (conflict === 'id') {
    const existing = await count(table);
    if (existing > 0 && !force) {
      console.log(`  ${table.padEnd(16)} skipped — ${existing} row(s) present (use --force)`);
      return;
    }
    await rest(table, { method: 'POST', body: rows, prefer: 'return=minimal' });
    console.log(`  ${table.padEnd(16)} ${rows.length} row(s)`);
    return;
  }

  const present = new Set(
    ((await rest(`${table}?select=${conflict}`)) ?? []).map((r) => r[conflict])
  );
  const missing = rows.filter((r) => !present.has(r[conflict]));

  if (force) {
    await rest(`${table}?on_conflict=${conflict}`, {
      method: 'POST',
      body: rows,
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
    console.log(`  ${table.padEnd(16)} ${rows.length} row(s) overwritten (--force)`);
    return;
  }

  if (!missing.length) {
    console.log(`  ${table.padEnd(16)} up to date — ${present.size} row(s), nothing missing`);
    return;
  }

  await rest(table, { method: 'POST', body: missing, prefer: 'return=minimal' });
  console.log(
    `  ${table.padEnd(16)} +${missing.length} added (${present.size} already there): ` +
      missing.map((r) => r[conflict]).slice(0, 6).join(', ') +
      (missing.length > 6 ? ` …+${missing.length - 6}` : '')
  );
}

/** The prototype stored article bodies as block arrays; the admin edits Markdown. */
function blocksToMarkdown(blocks = []) {
  return blocks
    .map((b) => {
      if (b.t === 'h') return `## ${b.x}`;
      if (b.t === 'p') return b.x;
      if (b.t === 'pull') return `> ${b.x}`;
      if (b.t === 'ul') return (b.items || []).map((i) => `- ${i}`).join('\n');
      if (b.t === 'ol') return (b.items || []).map((i, n) => `${n + 1}. ${i}`).join('\n');
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

const guides = data('guides');
const articles = data('articles');
const markets = data('markets');
const reviews = data('reviews');
const faq = data('faq');
const core = data('core');
const copy = data('copy');

console.log('Seeding CMS content…');

// ---------------------------------------------------------------- guides ----
await seed(
  'guides',
  guides.map((g, i) => {
    const body = blocksToMarkdown(articles[g.slug]?.blocks);
    return {
      slug: g.slug,
      title: g.title,
      category: g.category,
      excerpt: g.excerpt,
      read_time: g.read,
      date_label: g.date,
      takeaways: articles[g.slug]?.takeaways ?? [],
      body_markdown: body || null,
      published: Boolean(body),
      sort_order: i,
    };
  }),
  'slug'
);

// --------------------------------------------------------------- markets ----
await seed(
  'markets',
  markets.map((m, i) => ({
    slug: m.slug,
    city: m.city,
    region: m.region,
    country: m.country,
    blurb: m.blurb,
    kicker: m.kicker,
    h1: m.h1,
    lede: m.lede,
    seo_title: m.seoTitle,
    seo_desc: m.seoDesc,
    stats: m.stats ?? [],
    whats: m.whats ?? [],
    seasons: m.seasons ?? [],
    faqs: m.faqs ?? [],
    sort_order: i,
  })),
  'slug'
);

// --------------------------------------------------------------- reviews ----
await seed(
  'reviews',
  reviews.map((r, i) => ({
    quote: r.text, name: r.name, role: r.role, initials: r.initials, sort_order: i,
  })),
  'id'
);

// ------------------------------------------------------------------- faq ----
if ((await count('faq_groups')) === 0 || force) {
  for (const [gi, group] of faq.entries()) {
    const [row] = await rest('faq_groups', {
      method: 'POST',
      body: [{ name: group.name, sort_order: gi }],
      prefer: 'return=representation',
    });
    await rest('faq_items', {
      method: 'POST',
      body: group.items.map((it, i) => ({
        group_id: row.id, question: it.q, answer: it.a, sort_order: i,
      })),
      prefer: 'return=minimal',
    });
  }
  console.log(`  faq              ${faq.length} group(s)`);
} else {
  console.log('  faq              skipped — already present');
}

// -------------------------------------------------------- content_blocks ----
const list = (arr) => arr.map((v) => ({ v }));
const BLOCKS = [
  ['services', 'Services', 'The five service cards. Homepage and /services.', core.services],
  ['steps', 'How it goes', 'Three steps on the homepage.', core.steps],
  ['beliefs', 'What I believe', 'Shown on /about.', core.beliefs],
  ['diffs', 'Why dealers call me', 'Homepage list.', core.diffs.map((v) => ({ v }))],
  ['home_stats', 'Homepage stat band', 'Three stats under the brand strip.', [
    { k: '25 yrs', v: 'In and around the automotive business' },
    { k: 'Retail first', v: 'Sales floor and operations experience behind every campaign' },
    { k: 'One line', v: 'You deal with me directly, every time' },
  ]],
  ['timeline', 'About timeline', 'The path, on /about.', copy.timeline],
  ['personal', 'About facts', 'Practical details on /about.', copy.personal],
  ['roles', 'Roles served', 'On /services.', list(copy.roles)],
  ['brand_types', 'Store types', 'On /services.', copy.brandTypes],
  ['ai_teasers', 'AI page teasers', '', copy.aiTeasers],
  ['ai_shifts', 'AI shifts', '', copy.aiShifts],
  ['ai_yes', 'AI — worth doing now', '', list(copy.aiYes)],
  ['ai_no', "AI — don't automate", '', list(copy.aiNo)],
  ['ai_roadmap', 'AI roadmap', '', copy.aiRoadmap],
  ['ai_faqs', 'AI page FAQ', '', copy.aiFaqs],
  ['aeo_steps', 'AEO steps', 'On /ai-search-visibility.', copy.aeoSteps],
  ['aeo_work', 'AEO engagement', 'On /ai-search-visibility.', copy.aeoWork],
  ['ai_prompts', 'Shopper prompts', 'On /ai-search-visibility.', list(copy.aiPrompts)],
  // Lost when the design prototype exceeded the 256 KiB read cap. Seeded empty
  // rather than invented; each section stays hidden on the site while empty.
  ['tiers', 'Engagement tiers', 'Lost in the truncated prototype — add yours. Hidden while empty.', []],
  ['audiences', 'Who this is for', 'Lost in the truncated prototype. Hidden while empty.', []],
  ['audit_includes', 'What the free audit covers', 'Lost in the truncated prototype. Hidden while empty.', []],
  ['home_faqs', 'Homepage FAQ', 'Lost in the truncated prototype. Hidden while empty.', []],
];
await seed(
  'content_blocks',
  BLOCKS.map(([key, label, help, content]) => ({ key, label, help: help || null, content })),
  'key'
);

// ------------------------------------------------------------- nav_links ----
// Markets is deliberately absent from the header — 51 market pages belong in
// the footer, and the header was already full.
const header = [['Home', '/'], ['Services', '/services'], ['Process', '/process'], ['AI', '/ai'],
  ['Guides', '/guides'], ['FAQ', '/faq'], ['About', '/about'], ['Contact', '/contact']];
const footer = [
  ['Site', 'Services', '/services'], ['Site', 'Process', '/process'],
  ['Site', 'AI search visibility', '/ai-search-visibility'],
  ['Site', 'Guides', '/guides'], ['Site', 'FAQ', '/faq'], ['Site', 'About', '/about'],
  ['Site', 'Contact', '/contact'],
  ['Free tools', 'AI crawler check', '/ai-crawler-check'],
  ['Free tools', 'AI visibility check', '/ai-visibility-check'],
  ['Free tools', 'Review calculator', '/review-calculator'],
  ['Free tools', 'Marketing scorecard', '/scorecard'],
  ['Markets', 'All markets', '/markets'],
  ['Markets', 'Halifax, NS', '/markets/halifax'], ['Markets', 'Moncton, NB', '/markets/moncton'],
  ['Markets', 'Toronto, ON', '/markets/toronto'], ['Markets', 'Boston, MA', '/markets/boston'],
];
await seed('nav_links', [
  ...header.map(([label, href], i) => ({ location: 'header', group_label: null, label, href, sort_order: i })),
  ...footer.map(([group_label, label, href], i) => ({ location: 'footer', group_label, label, href, sort_order: i })),
], 'id');

// --------------------------------------------------------- site_settings ----
await seed('site_settings', [
  { key: 'contact', value: {
      email: 'shawn@shawnryder.com', phone: '902-488-4107',
      phone_href: 'tel:+19024884107', phone_e164: '+1-902-488-4107',
    } },
  { key: 'brands', value: copy.brands },
  // Edited under Code in the admin. Seeded empty so the row exists.
  { key: 'code_injection', value: { head: '', body_start: '', body_end: '' } },
  { key: 'footer_blurb', value: 'Digital marketing for car dealerships — search, social, email, reputation and the follow-up process that closes the loop. Remote across Canada and the United States.' },
  // last_published_at is deliberately not seeded: the column is NOT NULL, and a
  // missing row is what the admin reads as "never published".
], 'key');

console.log('Done.');
