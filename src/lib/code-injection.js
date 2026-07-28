// Custom code the admin injects into every page — analytics, pixels, site
// verification tags, chat widgets, the occasional bit of CSS.
//
// This runs at build time and the output is written straight into the static
// HTML with `set:html`, unescaped. That is the entire point of the feature, so
// this file does not try to sanitise anything: an admin pasting a Google Tag
// Manager snippet is pasting a script tag on purpose, and a "safe" version of
// this feature would just be a broken one.
//
// What it does instead is refuse to emit a snippet that would break the page.
// A stray unclosed <script> in the head silently swallows the rest of the
// document, and the damage lands on all 81 pages at once with no error anywhere
// — the build succeeds and the site is blank. So each slot is checked for the
// handful of mistakes that produce that outcome, and a slot that fails is
// dropped with a loud build warning rather than shipped.
//
// Two things make this safer than it sounds:
//
//   - /admin does not use this layout, so a snippet can never break the page
//     you would need in order to fix the snippet.
//   - Nothing takes effect until someone hits Publish and the site rebuilds,
//     so a bad paste is visible in a preview deploy before it is live.

export const SLOTS = [
  {
    key: 'head',
    label: 'Head',
    where: 'Inside <head>, on every page except /admin.',
    help: 'Analytics, tag managers, site verification meta tags, custom CSS. Anything that must load early.',
  },
  {
    key: 'body_start',
    label: 'Body — start',
    where: 'Immediately after <body> opens.',
    help: 'Where Google Tag Manager wants its <noscript> iframe. Rarely anything else.',
  },
  {
    key: 'body_end',
    label: 'Body — end',
    where: 'Just before </body> closes.',
    help: 'Chat widgets, heatmaps, anything that should not delay the page rendering.',
  },
];

const MAX_BYTES = 20_000;

/** Tags that must be balanced, because an unclosed one eats the rest of the page. */
const PAIRED = ['script', 'style', 'noscript', 'iframe', 'template'];

/** Things that mean somebody pasted a whole document rather than a snippet. */
const DOCUMENT_TAGS = /<\/?(?:html|head|body)\b/i;

function count(source, pattern) {
  return (source.match(pattern) || []).length;
}

/**
 * Checks one slot. Returns { code, errors, warnings } — `code` is '' whenever
 * there is an error, so a broken snippet is dropped rather than shipped.
 */
export function checkSlot(raw, slotKey = 'head') {
  const code = typeof raw === 'string' ? raw.trim() : '';
  const errors = [];
  const warnings = [];

  if (!code) return { code: '', errors, warnings };

  if (code.length > MAX_BYTES) {
    errors.push(`${code.length.toLocaleString('en-CA')} characters — the limit is ${MAX_BYTES.toLocaleString('en-CA')}. This is for tags, not for a stylesheet.`);
  }

  if (DOCUMENT_TAGS.test(code)) {
    errors.push('Contains <html>, <head> or <body>. Paste only the snippet itself, not the page around it.');
  }

  for (const tag of PAIRED) {
    const open = count(code, new RegExp(`<${tag}\\b`, 'gi'));
    const close = count(code, new RegExp(`</${tag}\\s*>`, 'gi'));
    if (open !== close) {
      errors.push(
        `${open} <${tag}> ${open === 1 ? 'tag' : 'tags'} but ${close} closing ${close === 1 ? 'tag' : 'tags'}. ` +
          'An unclosed tag here blanks every page on the site, so this snippet will not be used until it is fixed.'
      );
    }
  }

  // --- advisory: rendered anyway, but worth saying out loud ----------------
  if (/document\.write\s*\(/i.test(code)) {
    warnings.push('Uses document.write, which browsers block on pages loaded over a slow connection. Ask the vendor for their async snippet.');
  }
  if (slotKey === 'head' && /<noscript\b/i.test(code) && /<iframe\b/i.test(code)) {
    warnings.push('That <noscript> iframe is the Google Tag Manager body snippet. It belongs in "Body — start", not here.');
  }
  if (slotKey !== 'head' && /<meta\b[^>]*name\s*=\s*["']?(?:google-site-verification|msvalidate)/i.test(code)) {
    warnings.push('Site verification meta tags only work inside <head>. Move this to the Head slot.');
  }
  // Only scripts that fetch something can block on the network. An inline
  // <script> — which every analytics config snippet ends with — has nothing to
  // wait for, so async/defer would mean nothing on it.
  if (slotKey === 'head' && /<script\b(?=[^>]*\bsrc\s*=)(?![^>]*\b(?:async|defer)\b)[^>]*>/i.test(code)) {
    warnings.push('A script in <head> that loads an external file without async or defer blocks the page from rendering until it arrives. Most vendors offer an async version.');
  }

  return { code: errors.length ? '' : code, errors, warnings };
}

// The layout calls this once per page, so an unguarded console.warn would print
// the same complaint 81 times and bury it in build output nobody reads to the end.
const said = new Set();
const sayOnce = (line) => {
  if (said.has(line)) return;
  said.add(line);
  console.warn(line);
};

/**
 * Prepares all three slots for rendering. Logs anything wrong to the build
 * output — this is the only place a mistake surfaces, since the page itself
 * just quietly renders without the snippet.
 */
export function prepareInjection(value, { log = true } = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const out = { head: '', body_start: '', body_end: '' };
  let problems = 0;

  for (const slot of SLOTS) {
    const { code, errors, warnings } = checkSlot(source[slot.key], slot.key);
    out[slot.key] = code;

    if (log && errors.length) {
      problems++;
      sayOnce(`\n  [code] "${slot.label}" was NOT injected:`);
      errors.forEach((e) => sayOnce(`         - ${e}`));
    }
    if (log && warnings.length) {
      warnings.forEach((w) => sayOnce(`  [code] "${slot.label}": ${w}`));
    }
  }

  if (log && problems) {
    sayOnce('  Fix it under Code in the admin, then publish again.\n');
  }
  return out;
}
