// RSS feed for published guides. Cheap distribution, and it gives readers and
// aggregators something to subscribe to without an email address — consistent
// with the site's promise that nothing is gated.

import { getGuides } from '../lib/content.js';
import { renderMarkdown, blocksToMarkdown } from '../lib/markdown.js';
import { site } from '../lib/site.js';

const escape = (s = '') =>
  String(s).replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

/** "July 2026" is all the CMS stores; RSS wants RFC-822. */
function pubDate(label) {
  const d = label ? new Date(`1 ${label}`) : null;
  return (d && !Number.isNaN(d.valueOf()) ? d : new Date()).toUTCString();
}

export async function GET() {
  const guides = (await getGuides()).filter((g) => g.published && g.slug);

  const items = guides
    .map((g) => {
      const html = renderMarkdown(g.body || blocksToMarkdown(g.blocks ?? []));
      return `    <item>
      <title>${escape(g.title)}</title>
      <link>${site.url}/guides/${g.slug}</link>
      <guid isPermaLink="true">${site.url}/guides/${g.slug}</guid>
      <description>${escape(g.excerpt)}</description>
      <category>${escape(g.category)}</category>
      <pubDate>${pubDate(g.date)}</pubDate>
      <content:encoded><![CDATA[${html}]]></content:encoded>
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Shawn Ryder Digital — Dealership Marketing Guides</title>
    <link>${site.url}/guides</link>
    <description>Practical playbooks for dealer principals, GSMs and internet managers. No gated PDFs.</description>
    <language>en</language>
    <atom:link href="${site.url}/rss.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
  });
}
