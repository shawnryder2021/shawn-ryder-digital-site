// What an AI crawler can actually understand from a homepage.
//
// Regex rather than a DOM parser, deliberately: the checks are coarse (does a
// title exist, is there LocalBusiness markup, is there any text at all) and a
// parser dependency would be the largest thing in the function bundle for no
// gain in answer quality.

const DEALER_TYPES = ['AutoDealer', 'AutomotiveBusiness', 'CarDealer', 'LocalBusiness', 'Store', 'Organization'];

const strip = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<template[\s\S]*?<\/template>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '').trim() : '';
}

function metaContent(html, { name, property } = {}) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (name && attr(tag, 'name').toLowerCase() === name) return attr(tag, 'content');
    if (property && attr(tag, 'property').toLowerCase() === property) return attr(tag, 'content');
  }
  return '';
}

/** Every @type in a JSON-LD value, however deeply nested or wrapped in @graph. */
function collectTypes(node, into = new Set()) {
  if (Array.isArray(node)) {
    node.forEach((n) => collectTypes(n, into));
    return into;
  }
  if (!node || typeof node !== 'object') return into;
  const t = node['@type'];
  if (typeof t === 'string') into.add(t);
  else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && into.add(x));
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') collectTypes(value, into);
  }
  return into;
}

/** Finds the first node of one of `types`, so we can check its properties. */
function findNode(node, types) {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findNode(n, types);
      if (hit) return hit;
    }
    return null;
  }
  if (!node || typeof node !== 'object') return null;
  const t = node['@type'];
  const list = Array.isArray(t) ? t : [t];
  if (list.some((x) => types.includes(x))) return node;
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      const hit = findNode(value, types);
      if (hit) return hit;
    }
  }
  return null;
}

export function auditHtml(html) {
  const head = html.slice(0, 200_000);

  const titleMatch = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? strip(titleMatch[1]) : '';
  const description = metaContent(head, { name: 'description' });
  const robots = metaContent(head, { name: 'robots' }).toLowerCase();
  const viewport = metaContent(head, { name: 'viewport' });
  const ogTitle = metaContent(head, { property: 'og:title' });

  const canonical = (head.match(/<link\b[^>]*>/gi) || []).some(
    (tag) => attr(tag, 'rel').toLowerCase() === 'canonical' && attr(tag, 'href')
  );

  const h1s = (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi) || []).map((h) => strip(h));

  // ---- structured data ------------------------------------------------------
  const ldBlocks = [...html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )].map((m) => m[1]);

  const types = new Set();
  let invalidJsonLd = 0;
  let dealerNode = null;

  for (const block of ldBlocks) {
    let parsed;
    try {
      parsed = JSON.parse(block.trim());
    } catch {
      invalidJsonLd++;   // very common, and silently fatal — worth reporting
      continue;
    }
    collectTypes(parsed, types);
    dealerNode ||= findNode(parsed, DEALER_TYPES);
  }

  // Microdata as a fallback — older dealer platforms still emit it.
  const microdata = [...html.matchAll(/itemtype\s*=\s*["']https?:\/\/schema\.org\/([A-Za-z]+)["']/gi)]
    .map((m) => m[1]);
  microdata.forEach((t) => types.add(t));

  const typeList = [...types];
  const hasDealerType = typeList.some((t) => DEALER_TYPES.includes(t));

  const text = strip(html);

  return {
    title,
    titleLength: title.length,
    description,
    descriptionLength: description.length,
    ogTitle,
    canonical,
    viewport: Boolean(viewport),
    noindex: /\bnoindex\b/.test(robots),
    nofollowAi: /\bnoai\b|\bnoimageai\b/.test(robots),
    h1Count: h1s.length,
    h1: h1s[0] || '',
    schemaTypes: typeList.sort(),
    hasDealerType,
    hasFaqSchema: typeList.includes('FAQPage'),
    hasBreadcrumbs: typeList.includes('BreadcrumbList'),
    invalidJsonLd,
    dealerHas: dealerNode
      ? {
          address: Boolean(dealerNode.address),
          telephone: Boolean(dealerNode.telephone),
          openingHours: Boolean(dealerNode.openingHours || dealerNode.openingHoursSpecification),
          sameAs: Boolean(dealerNode.sameAs),
        }
      : null,
    textLength: text.length,
  };
}

/**
 * Turns the raw audit into ranked findings. Severity drives both the colour in
 * the UI and the order, so the worst thing a dealer has is the first thing
 * they read.
 */
export function htmlFindings(a) {
  const out = [];
  const bad = (title, detail) => out.push({ severity: 'bad', title, detail });
  const warn = (title, detail) => out.push({ severity: 'warn', title, detail });
  const good = (title, detail) => out.push({ severity: 'good', title, detail });

  if (a.noindex) {
    bad('Your homepage tells search engines not to index it',
      'A robots meta tag on this page contains "noindex". Nothing else on this list matters until that is removed.');
  }

  if (a.textLength < 500) {
    bad('There is almost no readable text in the page source',
      `We found ${a.textLength} characters of text before any JavaScript ran. Most AI crawlers do not execute JavaScript, so they see roughly this much — which is close to a blank page. This is the single most common reason an assistant knows nothing about a dealership.`);
  } else if (a.textLength < 1200) {
    warn('The page source is thin',
      `${a.textLength} characters of text before JavaScript runs. Some of your content is probably being assembled in the browser, where crawlers will not see it.`);
  } else {
    good('The page has real text in its source',
      `${a.textLength.toLocaleString('en-CA')} characters are readable without running JavaScript.`);
  }

  if (!a.hasDealerType) {
    bad('No dealership markup on the homepage',
      'There is no AutoDealer or LocalBusiness structured data. This is the machine-readable version of your name, address, phone and hours — without it an assistant has to infer those from prose, and it often gets them wrong or gives up.');
  } else {
    const missing = Object.entries(a.dealerHas || {})
      .filter(([, present]) => !present)
      .map(([k]) => ({ address: 'address', telephone: 'phone number', openingHours: 'opening hours', sameAs: 'links to your social profiles' }[k]));
    if (missing.length) {
      warn('Dealership markup is present but incomplete',
        `Found ${a.schemaTypes.filter((t) => DEALER_TYPES.includes(t)).join(', ')}, but it is missing ${missing.join(', ')}. Those are the fields assistants quote most.`);
    } else {
      good('Dealership markup is present and complete',
        'Name, address, phone and hours are all in machine-readable form.');
    }
  }

  if (a.invalidJsonLd > 0) {
    bad(`${a.invalidJsonLd} structured data block${a.invalidJsonLd > 1 ? 's' : ''} could not be read`,
      'The JSON-LD on this page is malformed, so crawlers discard it entirely. Someone built it and it is doing nothing — usually a template with an unescaped quote in a business name or address.');
  }

  if (!a.hasFaqSchema) {
    warn('No FAQ markup',
      'FAQPage markup is the most direct way to hand an assistant question-and-answer pairs in your own words. Dealer sites almost never have it, which makes it cheap ground to take.');
  } else {
    good('FAQ markup is present', 'Assistants can lift question-and-answer pairs straight from this page.');
  }

  if (!a.title) {
    bad('No page title', 'The homepage has no <title>. It is the first thing every crawler reads.');
  } else if (a.titleLength > 65) {
    warn('The page title is long', `${a.titleLength} characters — Google truncates around 60 to 65.`);
  } else if (a.titleLength < 20) {
    warn('The page title is very short', `"${a.title}" — ${a.titleLength} characters. There is room to say what you sell and where.`);
  } else {
    good('Page title looks reasonable', `"${a.title}"`);
  }

  if (!a.description) {
    warn('No meta description',
      'Not a ranking factor, but it is often what gets quoted back in a summary. Leaving it blank means something else gets quoted instead.');
  }

  if (a.h1Count === 0) {
    warn('No H1 heading', 'Nothing on the page is marked as its main heading.');
  } else if (a.h1Count > 1) {
    warn(`${a.h1Count} H1 headings`, 'More than one main heading makes the page’s subject ambiguous. One is the rule.');
  }

  if (!a.viewport) {
    warn('No mobile viewport tag', 'The page is not declaring mobile behaviour, which affects mobile ranking.');
  }
  if (!a.canonical) {
    warn('No canonical link', 'Without one, duplicate URLs of the same page compete with each other.');
  }

  return out;
}

export { DEALER_TYPES };
