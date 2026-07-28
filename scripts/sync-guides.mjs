// Publishes guide bodies from src/data/articles.json into the CMS.
//
//   npm run sync:guides          # fill in guides with no body in the database
//   npm run sync:guides -- --force   # overwrite bodies already in the database
//   npm run sync:guides -- --dry     # show what would change, write nothing
//
// Why this exists separately from `npm run seed`: seed tops up *missing rows*
// by natural key, so it cannot help a guide whose row already exists with an
// empty body — which is every guide seeded before it was written. The obvious
// workaround, `seed --force`, overwrites every table including anything edited
// in the admin. This script does the narrow thing instead: it only touches
// guides whose body is empty, so a guide rewritten in the admin is never
// clobbered by a stale copy in the repo.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const envFile = join(root, '.env');
if (existsSync(envFile) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envFile);
}

const url = (process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const force = process.argv.includes('--force');
const dry = process.argv.includes('--dry');

if (!key || !url) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Put both in .env.');
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

/** The prototype stored bodies as block arrays; the admin edits Markdown. */
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

const rows = await rest('guides?select=slug,body_markdown,published');
const bySlug = new Map(rows.map((r) => [r.slug, r]));

let updated = 0;
let skipped = 0;
let missing = 0;

console.log(dry ? 'Dry run — nothing will be written.\n' : 'Syncing guide bodies…\n');

for (const guide of guides) {
  const article = articles[guide.slug];
  const markdown = blocksToMarkdown(article?.blocks);
  const row = bySlug.get(guide.slug);

  if (!row) {
    console.log(`  ?     ${guide.slug} — no row in the database; run \`npm run seed\` first`);
    missing++;
    continue;
  }
  if (!markdown) {
    console.log(`  --    ${guide.slug} — nothing written in articles.json`);
    skipped++;
    continue;
  }
  if (row.body_markdown && !force) {
    console.log(`  keep  ${guide.slug} — already has a body (use --force to replace)`);
    skipped++;
    continue;
  }

  const words = markdown.split(/\s+/).length;
  if (dry) {
    console.log(`  would ${guide.slug} — ${words} words`);
    updated++;
    continue;
  }

  await rest(`guides?slug=eq.${encodeURIComponent(guide.slug)}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: {
      body_markdown: markdown,
      takeaways: article.takeaways ?? [],
      published: true,
    },
  });
  console.log(`  ok    ${guide.slug} — ${words} words, published`);
  updated++;
}

console.log(
  `\n${updated} updated, ${skipped} left alone${missing ? `, ${missing} missing from the database` : ''}.`
);
if (updated && !dry) {
  console.log('Hit Publish in the admin to rebuild the site with these live.');
}
