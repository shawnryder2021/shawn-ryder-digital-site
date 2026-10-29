// Every public page on the site, grouped the way a visitor would look for it.
// Both /sitemap.xml (for search engines) and /site-map (for people) are built
// from this one list, and the build audit fails if a built page is missing
// from it — so a new page can't quietly be left out of either.

import { getMarkets, getGuides } from './content.js';
import { tools } from './tools.js';
import servicePages from '../data/service-pages.json';
import dealerPages from '../data/dealer-pages.json';

// Atlantic Canada is home ground and converts best — weight it above the rest.
const PRIORITY_MARKETS = new Set([
  'halifax', 'moncton', 'saint-john', 'fredericton', 'charlottetown', 'st-johns',
]);

const page = (path, label, changefreq = 'monthly', priority = '0.8') => ({ path, label, changefreq, priority });

export async function getSitePages() {
  const markets = await getMarkets();
  const guides = (await getGuides()).filter((g) => g.published && g.slug);

  return [
    {
      name: 'Main pages',
      pages: [
        page('/', 'Home', 'monthly', '1.0'),
        page('/contact', 'Free dealership audit', 'yearly', '0.9'),
        page('/about', 'About Shawn Ryder', 'yearly', '0.7'),
        page('/process', 'How working together goes', 'yearly', '0.8'),
        page('/faq', 'FAQ'),
      ],
    },
    {
      name: 'Services',
      pages: [
        page('/services', 'All services', 'monthly', '0.9'),
        ...servicePages.map((s) => page(`/services/${s.slug}`, s.title.replace(/ for (Car )?Dealerships$/, ''), 'monthly', '0.9')),
        page('/ai-search-visibility', 'AI search visibility', 'monthly', '0.9'),
      ],
    },
    {
      name: 'Dealers I work with',
      pages: [
        page('/dealers', 'All dealership types'),
        ...dealerPages.map((d) => page(`/dealers/${d.slug}`, d.brand === 'Independent used' ? 'Independent used car dealers' : `${d.brand} dealers`)),
      ],
    },
    {
      name: 'Free tools',
      pages: [
        page('/tools', 'All free tools', 'monthly', '0.9'),
        ...tools.map((t) => page(t.href, t.name, 'monthly', '0.9')),
      ],
    },
    {
      name: 'Learn',
      pages: [
        page('/start-here', 'Start here — reading paths by role', 'monthly', '0.9'),
        page('/guides', 'All guides', 'weekly', '0.9'),
        page('/glossary', 'Glossary'),
        page('/ai', 'What AI changes for dealerships'),
      ],
    },
    {
      name: 'Guides',
      pages: guides.map((g) => page(`/guides/${g.slug}`, g.title, 'yearly', '0.7')),
    },
    {
      name: 'Markets',
      pages: [
        page('/markets', 'All markets'),
        ...markets.map((m) =>
          page(`/markets/${m.slug}`, `${m.city}${m.region ? `, ${m.region}` : ''}`, 'monthly', PRIORITY_MARKETS.has(m.slug) ? '0.8' : '0.7')
        ),
      ],
    },
    {
      name: 'Site information',
      pages: [page('/site-map', 'Site map', 'monthly', '0.3'), page('/privacy', 'Privacy policy', 'yearly', '0.3')],
    },
  ].filter((g) => g.pages.length);
}
