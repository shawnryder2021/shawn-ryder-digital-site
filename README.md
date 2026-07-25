# Shawn Ryder Digital — site

Static Astro site with two Netlify Functions behind the forms. Rebuilt from the
Claude Design prototype (`Shawn Ryder Digital v2.dc.html`), which rendered every
page client-side from a single file — no good for a site whose whole point is
being read by search engines and AI assistants.

**55 pages build to real HTML**: home, services, AI, AI search visibility,
guides index + 15 guide URLs, markets index + 31 market pages, FAQ, about,
contact.

## Running it

```bash
npm install
npm run dev          # http://localhost:4321
```

The forms need the functions running, which `astro dev` does not do:

```bash
npx netlify dev      # serves the site and /api/* together
```

| Command | What it does |
| --- | --- |
| `npm run build` | Static build into `dist/` |
| `npm test` | Exercises both functions against a stubbed Supabase + webhook |
| `npm run audit` | Builds, then checks titles, descriptions, h1s, schema and internal links |

## Architecture

```
src/data/*.json        Content extracted from the prototype — the single source of truth
src/pages/             One file per route; [slug].astro fans out over the data
src/components/        Header, Footer, Faq, AuditForm, SubscribeForm
netlify/functions/     audit-request.mjs, subscribe.mjs
netlify/lib/           Shared http / supabase / validate / webhook helpers
supabase/migrations/   Schema
```

Adding a market is one object in `src/data/markets.json`. Publishing a guide is
one entry in `src/data/articles.json`. Both flow into the pages, the navigation
and `sitemap.xml` with no other edits — the sitemap is generated at build time
from the same data, so it cannot drift.

## Backend

Two endpoints, both POST-only JSON:

- `POST /api/audit-request` — the free-audit form
- `POST /api/subscribe` — guide notifications

Each one validates and length-caps input, drops honeypot submissions silently,
writes to Supabase with the service role key, then POSTs to the Activepieces
webhook. **The order matters**: the row is committed before the webhook is
attempted, so a webhook outage costs a notification, never a lead. Delivery
outcome is written back to `leads.webhook_status` so failures are visible and
replayable instead of silent.

Both tables have RLS enabled with zero policies. Anonymous and authenticated
requests match no policy and are denied; only the service role — which lives in
the function environment and never reaches the browser — can read or write.

### Environment variables

Set in Netlify under **Site configuration → Environment variables**. See
`.env.example`.

| Variable | Notes |
| --- | --- |
| `SUPABASE_URL` | Project API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret. Bypasses RLS — functions only |
| `LEAD_WEBHOOK_URL` | Activepieces webhook |
| `ALLOWED_ORIGINS` | Comma-separated. Leave unset locally |

## Deploying

1. Push to GitHub.
2. Netlify → Add new site → Import an existing project. `netlify.toml` already
   sets the build command, publish directory and functions directory.
3. Add the four environment variables.
4. Apply `supabase/migrations/0001_leads_and_subscribers.sql` to the Supabase
   project.
5. Point the domain, then submit `https://shawnryder.com/sitemap.xml` in Search
   Console.

## Known gaps

The prototype file is 261 KB and the design API caps reads at 256 KB, so it came
back truncated mid-`renderVals()`. Four content arrays were in the lost tail and
are **not** reconstructed here, because inventing them would put words in
Shawn's mouth:

- `tiers` — engagement/pricing tiers on the services page
- `audiences` — "who this is for" on the services page
- `auditIncludes` — what the free audit covers, on the contact page
- `faqs` — the homepage FAQ subset (the full `/faq` page is unaffected — all
  five groups and every question survived)

`services`, `diffs`, `steps` and `beliefs` were also in the lost tail but are
recovered verbatim from the v1 design file; v2 may have revised that wording, so
they are worth a read-through. See `_source` in `src/data/core.json`.

The homepage stat band is reconstructed from surviving copy rather than the
original array.
