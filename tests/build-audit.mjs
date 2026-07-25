// Post-build sanity checks on dist/. Run after `npm run build`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full;
  });
}

const pages = walk(DIST).filter((f) => f.endsWith('.html'));
const titles = new Map();
const descriptions = new Map();

// Errors are things that are actually broken. Warnings are SEO advisories on
// hand-written copy — surfaced for review, never auto-"fixed", and they do not
// fail the build.
const problems = [];
const warnings = [];

const pick = (html, re) => html.match(re)?.[1]?.trim() ?? '';

for (const file of pages) {
  const html = readFileSync(file, 'utf8');
  const title = pick(html, /<title>([\s\S]*?)<\/title>/);
  const desc = pick(html, /<meta name="description" content="([^"]*)"/);
  const canonical = pick(html, /<link rel="canonical" href="([^"]*)"/);
  const h1s = html.match(/<h1[\s>]/g)?.length ?? 0;

  if (!title) problems.push(`${file}: no <title>`);
  if (!desc) problems.push(`${file}: no meta description`);
  if (!canonical) problems.push(`${file}: no canonical`);
  if (h1s !== 1) problems.push(`${file}: ${h1s} <h1> tags (want exactly 1)`);
  if (title.length > 70) warnings.push(`${file}: title ${title.length} chars (>70 truncates in SERPs)`);
  if (desc && desc.length > 165) warnings.push(`${file}: description ${desc.length} chars (>165 truncates)`);
  if (!html.includes('"ProfessionalService"')) problems.push(`${file}: missing org schema`);

  titles.set(title, [...(titles.get(title) ?? []), file]);
  descriptions.set(desc, [...(descriptions.get(desc) ?? []), file]);
}

for (const [title, files] of titles) {
  if (files.length > 1) problems.push(`duplicate title across ${files.length} pages: "${title.slice(0, 60)}"`);
}
for (const [desc, files] of descriptions) {
  if (files.length > 1) problems.push(`duplicate description across ${files.length} pages: "${desc.slice(0, 60)}"`);
}

// Internal links must resolve to a built page.
const routes = new Set(
  pages.map((f) => '/' + f.slice(DIST.length + 1).replace(/\.html$/, '').replace(/^index$/, ''))
);
routes.add('/sitemap.xml');
routes.add('/robots.txt');

const broken = new Set();
for (const file of pages) {
  const html = readFileSync(file, 'utf8');
  for (const m of html.matchAll(/href="(\/[^"#?]*)"/g)) {
    const href = m[1] === '/' ? '/' : m[1].replace(/\/$/, '');
    if (!routes.has(href) && !href.startsWith('/_astro') && !href.startsWith('/api')) {
      broken.add(`${href}  (linked from ${file})`);
    }
  }
}
broken.forEach((b) => problems.push(`broken internal link: ${b}`));

console.log(`pages built        ${pages.length}`);
console.log(`unique titles      ${titles.size}`);
console.log(`unique descriptions ${descriptions.size}`);
console.log(`routes             ${routes.size}`);

if (warnings.length) {
  console.log(`\n${warnings.length} SEO advisory/advisories (copy review, not build failures):`);
  warnings.forEach((w) => console.log('  ~ ' + w));
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  problems.forEach((p) => console.log('  - ' + p));
  process.exit(1);
}
console.log('\nno structural problems found');
