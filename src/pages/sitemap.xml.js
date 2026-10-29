// Generated at build time from src/lib/site-pages.js — the same list the
// /site-map page uses. Unpublished guides are excluded automatically, and the
// build audit fails if a built page is missing, so it cannot drift.

import { getSitePages } from '../lib/site-pages.js';
import { site } from '../lib/site.js';

export async function GET() {
  const lastmod = new Date().toISOString().slice(0, 10);
  const seen = new Set();
  const urls = (await getSitePages())
    .flatMap((g) => g.pages)
    .filter((p) => !seen.has(p.path) && seen.add(p.path));

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    ({ path, changefreq, priority }) =>
      `  <url><loc>${site.url}${path}</loc><lastmod>${lastmod}</lastmod>` +
      `<changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`
  )
  .join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
}
