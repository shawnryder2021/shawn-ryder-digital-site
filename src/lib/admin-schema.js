// Field definitions that drive every editor in the admin.
//
// One generic form renderer reads these, so adding a new editable section is a
// schema entry rather than a new UI. Field types:
//   text | textarea | markdown | number | checkbox | select
//   list     — array of plain strings, stored as [{ v }] or ["…"]
//   repeater — array of objects, with its own `fields`

/** Page copy stored in content_blocks, keyed by the slug the templates use. */
export const BLOCK_SCHEMAS = {
  services: {
    itemLabel: 'service',
    fields: [
      { name: 'num', label: 'Number', type: 'text', width: 'xs' },
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'blurb', label: 'Short blurb (homepage card)', type: 'textarea' },
      { name: 'long', label: 'Full description (/services)', type: 'textarea' },
      { name: 'items', label: 'Bullet points', type: 'list' },
    ],
  },
  steps: {
    itemLabel: 'step',
    fields: [
      { name: 'n', label: 'Number', type: 'text', width: 'xs' },
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'body', label: 'Body', type: 'textarea' },
    ],
  },
  beliefs: {
    itemLabel: 'belief',
    fields: [
      { name: 'h', label: 'Heading', type: 'text' },
      { name: 'p', label: 'Body', type: 'textarea' },
    ],
  },
  diffs: { itemLabel: 'point', simpleList: true },
  home_stats: {
    itemLabel: 'stat',
    fields: [
      { name: 'k', label: 'Big number', type: 'text', width: 'sm' },
      { name: 'v', label: 'Caption', type: 'textarea' },
    ],
  },
  timeline: {
    itemLabel: 'entry',
    fields: [
      { name: 'when', label: 'When', type: 'text', width: 'sm' },
      { name: 'h', label: 'Heading', type: 'text' },
      { name: 'p', label: 'Body', type: 'textarea' },
    ],
  },
  personal: {
    itemLabel: 'fact',
    fields: [
      { name: 'k', label: 'Label', type: 'text', width: 'sm' },
      { name: 'v', label: 'Value', type: 'textarea' },
    ],
  },
  roles: { itemLabel: 'role', simpleList: true },
  brand_types: {
    itemLabel: 'store type',
    fields: [
      { name: 'h', label: 'Name', type: 'text' },
      { name: 'p', label: 'Note', type: 'text' },
    ],
  },
  ai_teasers: {
    itemLabel: 'teaser',
    fields: [
      { name: 'h', label: 'Heading', type: 'text' },
      { name: 'p', label: 'Body', type: 'textarea' },
    ],
  },
  ai_shifts: {
    itemLabel: 'shift',
    fields: [
      { name: 'n', label: 'Label', type: 'text', width: 'sm' },
      { name: 'h', label: 'Heading', type: 'text' },
      { name: 'p', label: 'Body', type: 'textarea' },
    ],
  },
  ai_yes: { itemLabel: 'item', simpleList: true },
  ai_no: { itemLabel: 'item', simpleList: true },
  ai_roadmap: {
    itemLabel: 'phase',
    fields: [
      { name: 'when', label: 'When', type: 'text', width: 'sm' },
      { name: 'h', label: 'Heading', type: 'text' },
      { name: 'p', label: 'Body', type: 'textarea' },
    ],
  },
  ai_faqs: {
    itemLabel: 'question',
    fields: [
      { name: 'q', label: 'Question', type: 'text' },
      { name: 'a', label: 'Answer', type: 'textarea' },
    ],
  },
  aeo_steps: {
    itemLabel: 'step',
    fields: [
      { name: 'n', label: 'Number', type: 'text', width: 'xs' },
      { name: 'h', label: 'Heading', type: 'text' },
      { name: 'p', label: 'Body', type: 'textarea' },
    ],
  },
  aeo_work: {
    itemLabel: 'item',
    fields: [
      { name: 'h', label: 'Heading', type: 'text' },
      { name: 'p', label: 'Body', type: 'textarea' },
    ],
  },
  ai_prompts: { itemLabel: 'prompt', simpleList: true },
  tiers: {
    itemLabel: 'tier',
    fields: [
      { name: 'name', label: 'Tier name', type: 'text' },
      { name: 'price', label: 'Price / range', type: 'text', width: 'sm' },
      { name: 'blurb', label: 'Who it suits', type: 'textarea' },
      { name: 'items', label: "What's included", type: 'list' },
    ],
  },
  audiences: {
    itemLabel: 'audience',
    fields: [
      { name: 'h', label: 'Heading', type: 'text' },
      { name: 'p', label: 'Body', type: 'textarea' },
    ],
  },
  audit_includes: { itemLabel: 'item', simpleList: true },
  home_faqs: {
    itemLabel: 'question',
    fields: [
      { name: 'q', label: 'Question', type: 'text' },
      { name: 'a', label: 'Answer', type: 'textarea' },
    ],
  },
};

export const GUIDE_FIELDS = [
  { name: 'title', label: 'Title', type: 'text' },
  { name: 'slug', label: 'URL slug', type: 'text', help: 'Lives at /guides/<slug>. Changing this breaks existing links.' },
  { name: 'category', label: 'Category', type: 'select',
    options: ['AI', 'Local SEO', 'Follow-up', 'Reputation', 'Email', 'Social'] },
  { name: 'read_time', label: 'Read time', type: 'text', width: 'sm' },
  { name: 'date_label', label: 'Date label', type: 'text', width: 'sm' },
  { name: 'excerpt', label: 'Excerpt', type: 'textarea',
    help: 'Shown on cards and used as the meta description.' },
  { name: 'takeaways', label: "What you'll walk away with", type: 'list' },
  { name: 'body_markdown', label: 'Body', type: 'markdown',
    help: 'Markdown. ## for headings, - for bullets, 1. for numbered, > for a pull quote.' },
  { name: 'published', label: 'Published', type: 'checkbox',
    help: 'Unpublished guides still have a URL but show a "not written yet" state and stay out of the sitemap.' },
];

export const MARKET_FIELDS = [
  { name: 'city', label: 'City', type: 'text' },
  { name: 'region', label: 'Region / province / state', type: 'text' },
  { name: 'country', label: 'Country', type: 'select', options: ['Canada', 'United States'] },
  { name: 'slug', label: 'URL slug', type: 'text', help: 'Lives at /markets/<slug>.' },
  { name: 'kicker', label: 'Kicker', type: 'text', width: 'sm' },
  { name: 'h1', label: 'Page heading', type: 'text' },
  { name: 'lede', label: 'Intro paragraph', type: 'textarea' },
  { name: 'blurb', label: 'Card blurb (markets index)', type: 'textarea' },
  { name: 'seo_title', label: 'SEO title', type: 'text', help: 'Aim for under 70 characters.' },
  { name: 'seo_desc', label: 'SEO description', type: 'textarea', help: 'Aim for under 165 characters.' },
  { name: 'stats', label: 'Stats', type: 'repeater', itemLabel: 'stat', fields: [
    { name: 'k', label: 'Label', type: 'text', width: 'sm' },
    { name: 'v', label: 'Value', type: 'text', width: 'sm' },
    { name: 'n', label: 'Note', type: 'text' },
  ]},
  { name: 'whats', label: 'What this market is like', type: 'repeater', itemLabel: 'note', fields: [
    { name: 'h', label: 'Heading', type: 'text' },
    { name: 'p', label: 'Body', type: 'textarea' },
  ]},
  { name: 'seasons', label: 'The calendar', type: 'repeater', itemLabel: 'season', fields: [
    { name: 'when', label: 'When', type: 'text', width: 'sm' },
    { name: 'h', label: 'Heading', type: 'text' },
    { name: 'p', label: 'Body', type: 'textarea' },
  ]},
  { name: 'faqs', label: 'FAQs (emitted as FAQPage schema)', type: 'repeater', itemLabel: 'question', fields: [
    { name: 'q', label: 'Question', type: 'text' },
    { name: 'a', label: 'Answer', type: 'textarea' },
  ]},
  { name: 'published', label: 'Published', type: 'checkbox' },
];

export const REVIEW_FIELDS = [
  { name: 'quote', label: 'Review text', type: 'textarea' },
  { name: 'name', label: 'Name', type: 'text' },
  { name: 'role', label: 'Role', type: 'text' },
  { name: 'initials', label: 'Initials', type: 'text', width: 'xs' },
];

export const NAV_FIELDS = [
  { name: 'label', label: 'Label', type: 'text' },
  { name: 'href', label: 'Link', type: 'text' },
  { name: 'group_label', label: 'Footer column', type: 'text', width: 'sm',
    help: 'Footer only — links sharing a column heading group together.' },
];

/** Tables whose updated_at feeds the "unpublished changes" count. */
export const CONTENT_TABLES = [
  'site_settings', 'nav_links', 'content_blocks',
  'guides', 'markets', 'reviews', 'faq_groups', 'faq_items',
  'media', 'image_slots',
];
