// Generated at build time from the same data the pages render from, so it can
// never drift the way a hand-maintained sitemap.xml does. Unpublished guides
// are excluded automatically — publishing one adds it here with no extra step.

import { getMarkets, getGuides } from '../lib/content.js';
import { site } from '../lib/site.js';

const STATIC_PAGES = [
  { path: '/', changefreq: 'monthly', priority: '1.0' },
  { path: '/services', changefreq: 'monthly', priority: '0.9' },
  { path: '/process', changefreq: 'yearly', priority: '0.8' },
  { path: '/scorecard', changefreq: 'yearly', priority: '0.8' },
  { path: '/contact', changefreq: 'yearly', priority: '0.9' },
  { path: '/ai-search-visibility', changefreq: 'monthly', priority: '0.9' },
  { path: '/guides', changefreq: 'weekly', priority: '0.9' },
  { path: '/faq', changefreq: 'monthly', priority: '0.8' },
  { path: '/ai', changefreq: 'monthly', priority: '0.8' },
  { path: '/markets', changefreq: 'monthly', priority: '0.8' },
  { path: '/about', changefreq: 'yearly', priority: '0.7' },
];

// Atlantic Canada is home ground and converts best — weight it above the rest.
const PRIORITY_MARKETS = new Set([
  'halifax',
  'moncton',
  'saint-john',
  'fredericton',
  'charlottetown',
  'st-johns',
]);

export async function GET() {
  const markets = await getMarkets();
  const guides = await getGuides();
  const lastmod = new Date().toISOString().slice(0, 10);

  const urls = [
    ...STATIC_PAGES,
    ...markets.map((m) => ({
      path: `/markets/${m.slug}`,
      changefreq: 'monthly',
      priority: PRIORITY_MARKETS.has(m.slug) ? '0.8' : '0.7',
    })),
    ...guides
      .filter((g) => g.published && g.slug)
      .map((g) => ({ path: `/guides/${g.slug}`, changefreq: 'yearly', priority: '0.7' })),
  ];

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
