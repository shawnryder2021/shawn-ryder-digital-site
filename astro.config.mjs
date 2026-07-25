// @ts-check
import { defineConfig } from 'astro/config';

// Static output: every route below becomes a real HTML file at build time.
// That is the whole point of this rebuild — the sitemap promises 40+ URLs and
// search engines (and AI crawlers) need to read each one without running JS.
export default defineConfig({
  site: 'https://shawnryder.com',
  output: 'static',
  trailingSlash: 'never',
  build: {
    format: 'file',
  },
  devToolbar: { enabled: false },
});
