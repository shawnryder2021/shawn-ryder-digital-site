// Proves an image assigned in the admin actually reaches the built HTML.
//
// Runs a real `astro build` against a stub PostgREST server, so this exercises
// the whole path: content loader → template → dist/*.html. Without it, "images
// work" would rest on the admin preview alone, which proves nothing about what
// a visitor sees.
//
// Run: node tests/images-render.test.mjs

import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);

const IMG = {
  url: 'https://cdn.example.test/media/showroom.webp',
  alt: 'A busy showroom floor',
  width: 2000,
  height: 1500,
};

// Minimal PostgREST stand-in: returns rows for the tables the loader asks for,
// and an empty array for everything else so those fall back to the JSON.
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url);
  const send = (body) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (path.startsWith('/rest/v1/image_slots')) {
    return send([
      { key: 'home_hero', media: IMG },
      { key: 'about_portrait', media: IMG },
      { key: 'ai_hero', media: IMG },
      { key: 'home_dealer', media: null }, // unassigned — must not render
    ]);
  }
  if (path.startsWith('/rest/v1/guides')) {
    return send([{
      slug: 'cover-test', title: 'Cover test', category: 'Local SEO',
      excerpt: 'Checks the cover image renders.', read_time: '4 min read',
      date_label: 'July 2026', takeaways: [], body_markdown: 'Body copy here.',
      published: true, sort_order: 0, cover: IMG,
    }]);
  }
  return send([]);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();

let failures = 0;
const check = (label, pass, detail = '') => {
  if (!pass) failures++;
  console.log(`${pass ? 'pass' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
};

try {
  await run('npx', ['astro', 'build'], {
    env: {
      ...process.env,
      SUPABASE_URL: `http://127.0.0.1:${port}`,
      SUPABASE_SERVICE_ROLE_KEY: 'stub-key',
    },
    maxBuffer: 1024 * 1024 * 20,
  });

  const home = readFileSync('dist/index.html', 'utf8');
  const about = readFileSync('dist/about.html', 'utf8');
  const ai = readFileSync('dist/ai.html', 'utf8');
  const guide = readFileSync('dist/guides/cover-test.html', 'utf8');

  check('homepage renders the hero image', home.includes(IMG.url));
  check('hero carries alt text', home.includes(`alt="${IMG.alt}"`));
  check('hero sets width/height (no layout shift)',
    home.includes(`width="${IMG.width}"`) && home.includes(`height="${IMG.height}"`));
  check('hero switches to the two-column layout', /class="[^"]*has-image/.test(home));

  check('about page renders the portrait', about.includes(IMG.url));
  check('AI page renders its hero', ai.includes(IMG.url));
  check('guide renders its cover', guide.includes(IMG.url));

  // The unassigned slot must leave no empty <img> behind.
  check('no empty img src anywhere', !/<img[^>]*src=""/.test(home + about + ai + guide));

  // And with no image data at all, pages must still build cleanly.
  await run('npx', ['astro', 'build'], {
    env: { ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' },
    maxBuffer: 1024 * 1024 * 20,
  });
  const bare = readFileSync('dist/index.html', 'utf8');
  check('builds fine with no images configured', !bare.includes('has-image'));
  check('bare homepage has no broken img', !/<img[^>]*src=""/.test(bare));
} finally {
  server.close();
}

console.log(failures ? `\n${failures} FAILING` : '\nall image render checks passed');
process.exit(failures ? 1 : 0);
