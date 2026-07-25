// Markdown → HTML for guide bodies written in the admin.
//
// Runs at build time only, and the only authors are signed-in admins, so this
// is not a sanitiser boundary. Raw HTML is still disabled because a stray
// angle bracket in prose should render as text, not markup.

import { marked } from 'marked';

marked.setOptions({
  gfm: true,
  breaks: false,
});

export function renderMarkdown(source) {
  if (!source || typeof source !== 'string') return '';
  return marked.parse(source.trim(), { async: false });
}

/**
 * The prototype stored bodies as block arrays. Guides seeded before the CMS
 * migration may still arrive in that shape, so keep a converter rather than
 * losing four written articles to a format change.
 */
export function blocksToMarkdown(blocks = []) {
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
