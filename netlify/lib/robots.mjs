// robots.txt parsing, to the rules crawlers actually follow (RFC 9309).
//
// This is the part of the crawler checker that has to be right. Telling a
// dealer "you are blocking ChatGPT" when they are not would be worse than not
// having the tool, so the matching follows the spec rather than grepping for
// "Disallow: /":
//
//   - consecutive User-agent lines share the rules that follow them
//   - a named group wins outright; the * group applies only when none matches
//   - groups naming the same agent are merged
//   - longest matching path pattern wins, and Allow beats Disallow on a tie
//   - * and $ are supported inside paths
//   - an empty Disallow means "allow everything"

/** The agents worth reporting on, and why a dealer should care about each. */
export const AI_AGENTS = [
  // --- answer engines: blocked here means invisible in AI answers today ----
  { token: 'OAI-SearchBot', label: 'ChatGPT Search', group: 'answers',
    note: 'Builds the index ChatGPT cites when it answers with live sources.' },
  { token: 'ChatGPT-User', label: 'ChatGPT (browsing)', group: 'answers',
    note: 'Fetches your page when a shopper asks ChatGPT to look you up.' },
  { token: 'PerplexityBot', label: 'Perplexity', group: 'answers',
    note: 'Perplexity indexes and cites sources inline — a real referral source.' },
  { token: 'Claude-User', label: 'Claude (browsing)', group: 'answers',
    note: 'Fetches your page when someone asks Claude about your store.' },
  { token: 'Bingbot', label: 'Bing / Copilot', group: 'answers',
    note: 'Bing feeds Microsoft Copilot as well as Bing search.' },

  // --- training and grounding: blocked here means long-term absence --------
  { token: 'GPTBot', label: 'OpenAI (training)', group: 'training',
    note: 'What OpenAI models learn about your store from the open web.' },
  { token: 'ClaudeBot', label: 'Anthropic (training)', group: 'training',
    note: 'What Claude learns about your store from the open web.' },
  { token: 'Google-Extended', label: 'Google Gemini', group: 'training',
    note: 'Gemini and AI Overviews grounding. Does not affect Google Search ranking.' },
  { token: 'Applebot-Extended', label: 'Apple Intelligence', group: 'training',
    note: 'Apple Intelligence training. Applebot itself still handles Siri and Spotlight.' },
  { token: 'meta-externalagent', label: 'Meta AI', group: 'training',
    note: 'Meta AI across Facebook, Instagram and WhatsApp.' },
  { token: 'CCBot', label: 'Common Crawl', group: 'training',
    note: 'The open dataset behind a large share of every model’s training data.' },
];

/**
 * Splits robots.txt into groups of { agents, rules }.
 * Unknown directives (Sitemap, Crawl-delay, Host) are ignored for matching but
 * Sitemap is pulled out separately because it is worth reporting.
 */
export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let expectingAgents = false;

  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;

    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      // A new agent line after rules starts a new group; after another agent
      // line it extends the current one.
      if (!current || !expectingAgents) {
        current = { agents: [], rules: [] };
        groups.push(current);
        expectingAgents = true;
      }
      if (value) current.agents.push(value.toLowerCase());
      continue;
    }

    if (field === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }

    if (field === 'allow' || field === 'disallow') {
      if (!current) continue; // rules before any user-agent line are ignored
      expectingAgents = false;
      current.rules.push({ allow: field === 'allow', path: value });
    }
  }

  return { groups, sitemaps };
}

/** Rules that apply to one agent: its own groups, or the * groups. */
export function rulesFor({ groups }, agentToken) {
  const token = String(agentToken).toLowerCase();
  const named = groups.filter((g) => g.agents.includes(token));
  if (named.length) return { rules: named.flatMap((g) => g.rules), specific: true };
  const star = groups.filter((g) => g.agents.includes('*'));
  return { rules: star.flatMap((g) => g.rules), specific: false };
}

function patternToRegex(pattern) {
  // Strip the end anchor *before* escaping — escaping first turns "$" into
  // "\$" and there is no longer a single character to remove.
  let source = pattern;
  let anchoredEnd = false;
  if (source.endsWith('$')) {
    source = source.slice(0, -1);
    anchoredEnd = true;
  }
  // Escape everything, then restore the one wildcard robots.txt defines.
  const body = source.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${body}${anchoredEnd ? '$' : ''}`);
}

/**
 * Standard longest-match evaluation. Returns { allowed, rule } where `rule` is
 * the directive that decided it, so the UI can quote the actual line.
 */
export function isAllowed(rules, path = '/') {
  let best = null;
  for (const rule of rules) {
    // "Disallow:" with no value is an explicit allow-all and matches nothing.
    if (!rule.path) continue;
    let re;
    try {
      re = patternToRegex(rule.path);
    } catch {
      continue;
    }
    if (!re.test(path)) continue;

    const length = rule.path.replace(/\$$/, '').length;
    if (
      !best ||
      length > best.length ||
      // Tie goes to Allow, per the spec.
      (length === best.length && rule.allow && !best.allow)
    ) {
      best = { ...rule, length };
    }
  }
  return best ? { allowed: best.allow, rule: best } : { allowed: true, rule: null };
}

/**
 * The whole report for one robots.txt: every agent we care about, whether it
 * can reach the homepage, and whether it is restricted anywhere else.
 */
export function auditAgents(parsed, path = '/') {
  return AI_AGENTS.map((agent) => {
    const { rules, specific } = rulesFor(parsed, agent.token);
    const { allowed, rule } = isAllowed(rules, path);

    // "Allowed on / but disallowed somewhere" is worth flagging separately —
    // plenty of dealer sites let bots see the homepage and block /inventory/.
    const restrictedElsewhere =
      allowed && rules.some((r) => r.path && !r.allow && r.path !== '/');

    return {
      token: agent.token,
      label: agent.label,
      group: agent.group,
      note: agent.note,
      allowed,
      specific,
      restrictedElsewhere,
      rule: rule ? `${rule.allow ? 'Allow' : 'Disallow'}: ${rule.path}` : null,
    };
  });
}
