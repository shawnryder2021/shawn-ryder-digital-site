// Guards the custom-code injection.
//
// The failure this exists to prevent: an unclosed <script> in the head slot
// swallows the rest of the document, every page on the site renders blank, and
// nothing errors — the build succeeds and the deploy goes out. So the rule is
// that a slot which cannot be trusted is dropped rather than shipped, and these
// checks pin that behaviour down.
//
// Run: node tests/code-injection.test.mjs

import { checkSlot, prepareInjection, SLOTS } from '../src/lib/code-injection.js';

let failures = 0;
const ok = (name, condition, detail = '') => {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const GA4 = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-ABC123');
</script>`;

const GTM_HEAD = `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s);j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i;
f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-XXXX');</script>`;

const GTM_BODY = `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXX"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`;

console.log('\nreal-world snippets are accepted');
{
  const r = checkSlot(GA4, 'head');
  ok('Google Analytics 4', r.code === GA4.trim() && !r.errors.length);
  ok('and raises no warning — it uses async', !r.warnings.length, r.warnings.join('; '));
}
{
  const r = checkSlot(GTM_HEAD, 'head');
  ok('Google Tag Manager head snippet', r.code && !r.errors.length, r.errors.join('; '));
}
{
  const r = checkSlot(GTM_BODY, 'body_start');
  ok('Google Tag Manager body snippet', r.code && !r.errors.length, r.errors.join('; '));
}
{
  const meta = '<meta name="google-site-verification" content="abc123" />';
  const r = checkSlot(meta, 'head');
  ok('a verification meta tag', r.code === meta && !r.errors.length && !r.warnings.length);
}
{
  const r = checkSlot('<style>.promo-banner{display:none}</style>', 'head');
  ok('a block of custom CSS', r.code && !r.errors.length);
}
{
  const r = checkSlot('<link rel="stylesheet" href="https://example.com/x.css">', 'head');
  ok('a self-closing tag needs no closing partner', r.code && !r.errors.length, r.errors.join('; '));
}

console.log('\npage-breaking snippets are refused');
{
  const r = checkSlot('<script>alert(1)', 'head');
  ok('an unclosed <script> is refused', r.code === '' && r.errors.length === 1);
  ok('and the reason names the tag', /1 <script> tag but 0 closing/.test(r.errors[0]), r.errors[0]);
  ok('and warns what it would have done', /blanks every page/.test(r.errors[0]));
}
{
  ok('an unclosed <style> is refused', checkSlot('<style>.a{}', 'head').code === '');
  ok('an unclosed <noscript> is refused', checkSlot('<noscript><iframe src="x"></iframe>', 'body_start').code === '');
  ok('an unclosed <iframe> is refused', checkSlot('<iframe src="x">', 'body_end').code === '');
}
{
  const r = checkSlot('<html><head><script src="x"></script></head></html>', 'head');
  ok('a whole HTML document is refused', r.code === '');
  ok('and says to paste only the snippet', r.errors.some((e) => /only the snippet/.test(e)));
}
{
  const r = checkSlot(`<script>${'x'.repeat(25000)}</script>`, 'head');
  ok('an oversized paste is refused', r.code === '' && r.errors.some((e) => /limit is/.test(e)));
}
{
  // A stray closing tag is just as capable of breaking the page as a stray
  // opening one, so the check is equality, not "enough closers".
  ok('an extra closing tag is refused', checkSlot('</script>', 'head').code === '');
}

console.log('\nadvisories are raised but do not block');
{
  const r = checkSlot('<script>document.write("<b>hi</b>")</script>', 'head');
  ok('document.write warns', r.warnings.some((w) => /document\.write/.test(w)));
  ok('but the code still ships', r.code !== '');
}
{
  const r = checkSlot(GTM_BODY, 'head');
  ok('the GTM body snippet in the head slot is caught',
    r.warnings.some((w) => /belongs in "Body — start"/.test(w)));
  ok('and is still injected — it is wrong, not broken', r.code !== '');
}
{
  const r = checkSlot('<meta name="google-site-verification" content="x">', 'body_end');
  ok('a verification tag outside the head is caught',
    r.warnings.some((w) => /only work inside <head>/.test(w)));
}
{
  const r = checkSlot('<script src="https://cdn.example.com/x.js"></script>', 'head');
  ok('a blocking script in the head warns', r.warnings.some((w) => /async or defer/.test(w)));
  const async = checkSlot('<script async src="https://cdn.example.com/x.js"></script>', 'head');
  ok('an async one does not', !async.warnings.length, async.warnings.join('; '));
  const ld = checkSlot('<script type="application/ld+json">{"a":1}</script>', 'head');
  ok('and neither does JSON-LD', !ld.warnings.length, ld.warnings.join('; '));
}

console.log('\nprepareInjection');
{
  const out = prepareInjection({ head: GA4, body_start: GTM_BODY, body_end: '' }, { log: false });
  ok('passes all three slots through', out.head && out.body_start && out.body_end === '');
  ok('returns exactly the three slot keys',
    Object.keys(out).join(',') === SLOTS.map((s) => s.key).join(','), Object.keys(out).join(','));
}
{
  const out = prepareInjection({ head: '<script>oops', body_end: GA4 }, { log: false });
  ok('drops only the broken slot', out.head === '' && out.body_end !== '');
}
{
  ok('undefined is safe', prepareInjection(undefined, { log: false }).head === '');
  ok('null is safe', prepareInjection(null, { log: false }).head === '');
  ok('a string instead of an object is safe', prepareInjection('nope', { log: false }).head === '');
  ok('a missing slot is empty, not undefined', prepareInjection({}, { log: false }).body_end === '');
}
{
  // Whitespace-only should read as "off", not as an active empty injection.
  ok('whitespace is treated as empty', checkSlot('   \n\t ', 'head').code === '');
}

console.log(failures ? `\n${failures} FAILING` : '\nall checks passed');
process.exit(failures ? 1 : 0);
