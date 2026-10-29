// Every free tool on the site, in the order they appear on /tools. The hub page
// and the homepage both read this list, so adding a tool is one entry here plus
// its page — nothing else to keep in sync.
//
// `topic` groups the hub page. `time` is honest: how long a dealer actually
// spends to get an answer, not how long the page takes to load.

export const toolTopics = ['Leads & sales', 'Reputation', 'AI search', 'Ad spend'];

export const tools = [
  {
    href: '/lead-leak-calculator',
    name: 'Lead leak calculator',
    blurb: 'Put in your monthly leads and response time. See how much gross slow follow-up is costing you every month.',
    topic: 'Leads & sales',
    time: '1 min',
    isNew: true,
  },
  {
    href: '/scorecard',
    name: 'Marketing scorecard',
    blurb: 'Six statements. Tick the ones that sound like your store and get a straight read on where deals are leaking.',
    topic: 'Leads & sales',
    time: '2 min',
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
    topic: 'Ad spend',
    time: '1 min',
    isNew: true,
  },
];
