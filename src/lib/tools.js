// Every free tool on the site, in the order they appear on /tools. The hub page
// and the homepage both read this list, so adding a tool is one entry here plus
// its page — nothing else to keep in sync.
//
// `topic` groups the hub page. `time` is honest: how long a dealer actually
// spends to get an answer, not how long the page takes to load.

export const toolTopics = ['Leads & sales', 'Local search & SEO', 'Reputation', 'AI search', 'Ad spend & tracking'];

export const tools = [
  {
    href: '/lead-leak-calculator',
    name: 'Lead leak calculator',
    blurb: 'Put in your monthly leads and response time. See how much gross slow follow-up is costing you every month.',
    topic: 'Leads & sales',
    time: '1 min',
  },
  {
    href: '/sales-goal-calculator',
    name: 'Sales goal calculator',
    blurb: 'Work back from your unit target to the leads, appointments and shows it takes — and which rate to fix first.',
    topic: 'Leads & sales',
    time: '1 min',
  },
  {
    href: '/scorecard',
    name: 'Marketing scorecard',
    blurb: 'Six statements. Tick the ones that sound like your store and get a straight read on where deals are leaking.',
    topic: 'Leads & sales',
    time: '2 min',
  },
  {
    href: '/google-profile-checkup',
    name: 'Google profile checkup',
    blurb: 'Fourteen quick checks on your Google Business Profile. Get a score out of 100 and the three fixes to do first.',
    topic: 'Local search & SEO',
    time: '3 min',
  },
  {
    href: '/local-keyword-planner',
    name: 'Local keyword planner',
    blurb: 'Enter your brand, models, city and nearby towns. Get the search phrases to target and the page each belongs on.',
    topic: 'Local search & SEO',
    time: '2 min',
    isNew: true,
  },
  {
    href: '/search-preview-checker',
    name: 'Search preview checker',
    blurb: 'See how a page title and description look in Google, and catch the length and local-keyword misses.',
    topic: 'Local search & SEO',
    time: '1 min',
    isNew: true,
  },
  {
    href: '/dealer-schema-generator',
    name: 'Dealer schema generator',
    blurb: 'Fill in your store details and get copy-paste structured data so Google and AI read your hours and brands right.',
    topic: 'Local search & SEO',
    time: '3 min',
    isNew: true,
  },
  {
    href: '/review-calculator',
    name: 'Review score calculator',
    blurb: 'How many 5-star reviews it takes to reach 4.5 — and what one 1-star review really costs you.',
    topic: 'Reputation',
    time: '1 min',
  },
  {
    href: '/review-responder',
    name: 'Bad review responder',
    blurb: 'Paste a negative review and get three calm, professional replies you can post or adapt.',
    topic: 'Reputation',
    time: '2 min',
  },
  {
    href: '/ai-visibility-check',
    name: 'AI visibility check',
    blurb: 'See what an AI assistant tells a shopper about your store — including whether it knows you exist.',
    topic: 'AI search',
    time: '30 sec',
  },
  {
    href: '/ai-crawler-check',
    name: 'AI crawler check',
    blurb: 'Find out if your website lets AI crawlers in, and what they can actually read when they get there.',
    topic: 'AI search',
    time: '10 sec',
  },
  {
    href: '/ad-budget-planner',
    name: 'Ad budget planner',
    blurb: 'Enter your monthly spend and store type. Get a starting split across search, conquest, retargeting and social.',
    topic: 'Ad spend & tracking',
    time: '1 min',
  },
  {
    href: '/tracking-link-builder',
    name: 'Tracking link builder',
    blurb: 'Tag links from your Google profile, Facebook, email and texts so analytics shows where each lead came from.',
    topic: 'Ad spend & tracking',
    time: '1 min',
    isNew: true,
  },
];
