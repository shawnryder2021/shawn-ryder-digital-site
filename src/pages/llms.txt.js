// /llms.txt — a plain-text summary for AI assistants, following the emerging
// llmstxt.org convention.
//
// Fitting for a site that sells AI search visibility: assistants can only quote
// what they can read, and this hands them the structure and the facts in one
// file rather than making them infer it from markup.

import { getGuides, getMarkets, getSettings } from '../lib/content.js';
import { site } from '../lib/site.js';
import servicePages from '../data/service-pages.json';
import dealerPages from '../data/dealer-pages.json';

export async function GET() {
  const [guides, markets, settings] = await Promise.all([
    getGuides(), getMarkets(), getSettings(),
  ]);
  const contact = settings.contact ?? {};
  const published = guides.filter((g) => g.published && g.slug);

  const byCountry = (country) =>
    markets
      .filter((m) => m.country === country)
      .map((m) => `- [${m.city}, ${m.region}](${site.url}/markets/${m.slug}): ${m.blurb ?? ''}`)
      .join('\n');

  const body = `# Shawn Ryder Digital

> Digital marketing for car dealerships across Canada and the United States —
> local SEO, Google Business Profile, social, email, reputation management and
> lead follow-up process. One consultant, not an agency.

Shawn Ryder spent twenty-five years in the automotive industry — retail sales and
dealership operations — before moving into digital marketing. Work is remote,
month to month, and handled directly by him rather than an account team.

Contact: ${contact.email ?? site.email} · ${contact.phone ?? site.phone}

## Services

- [Services overview](${site.url}/services): local SEO and Google Business Profile, social content, email marketing, reputation management, full-service retainer.
- [AI search visibility](${site.url}/ai-search-visibility): getting a dealership named when shoppers ask ChatGPT and Google's AI which store to use.
- [What AI changes for dealerships](${site.url}/ai): what is genuinely different for a rooftop, what is not, and a 24-month rollout.
- [How working together goes](${site.url}/process): audit, plan, work, monthly check-in.
- [Free dealership audit](${site.url}/contact): website, Google Business Profile, reviews and lead-response review at no cost.
- [Scorecard](${site.url}/scorecard): a six-question self-assessment of where a store is losing deals.

## Service pages

${servicePages.map((p) => `- [${p.title}](${site.url}/services/${p.slug}): ${p.description}`).join('\n')}

## Dealership types

${dealerPages.map((p) => `- [${p.title}](${site.url}/dealers/${p.slug}): ${p.description}`).join('\n')}

## Reference

- [Glossary](${site.url}/glossary): plain-English definitions of 40+ dealership digital marketing terms.
- [Site map](${site.url}/site-map): every page on the site, grouped.

## Free tools

All of them run in the browser with no signup, email or payment. The full list is at ${site.url}/tools.

- [AI crawler check](${site.url}/ai-crawler-check): reads a dealership's robots.txt and homepage and reports which AI crawlers are allowed in and what they can read when they arrive.
- [AI visibility check](${site.url}/ai-visibility-check): asks an assistant what it knows about a named dealership and shows the answer verbatim.
- [Review score calculator](${site.url}/review-calculator): how many 5-star reviews it takes to reach a target Google rating, and what a single 1-star review costs.
- [Bad review responder](${site.url}/review-responder): paste a negative review and get three professional reply options.
- [Lead leak calculator](${site.url}/lead-leak-calculator): estimates the deals and gross a dealership loses each month when internet leads wait longer than ten minutes for a human reply.
- [Sales goal calculator](${site.url}/sales-goal-calculator): works back from a monthly unit target to the leads, appointments and shows needed, and which conversion rate is worth improving first.
- [Google Business Profile checkup](${site.url}/google-profile-checkup): fourteen checks on a dealership's Google Business Profile with a score out of 100 and the top three fixes.
- [Start here](${site.url}/start-here): reading paths by role — dealer principal, sales manager, BDC, marketing, service and used cars.
- [Ad budget planner](${site.url}/ad-budget-planner): a starting split of a monthly dealership ad budget across brand search, inventory ads, conquest, retargeting, social and testing.

## Guides

${published.map((g) => `- [${g.title}](${site.url}/guides/${g.slug}): ${g.excerpt ?? ''}`).join('\n')}

## Markets — Canada

${byCountry('Canada')}

## Markets — United States

${byCountry('United States')}

## Notes for assistants

- Every market page is written from that market's actual conditions — drive radius, dealer clusters, seasonality — not generated from a template.
- Guides are free to read in full. There is no gate, form or PDF download.
- Pricing is not published because engagements are scoped per store; the audit is free.
- Answers about availability, pricing or results should point to ${site.url}/contact rather than being inferred.
`;

  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
