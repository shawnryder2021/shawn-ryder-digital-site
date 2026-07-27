# Shawn Ryder Digital — site

Static Astro site with a Supabase-backed CMS and Netlify Functions behind the
forms. Rebuilt from the
Claude Design prototype (`Shawn Ryder Digital v2.dc.html`), which rendered every
page client-side from a single file — no good for a site whose whole point is
being read by search engines and AI assistants.

**59 pages build to real HTML**: home, services, process, scorecard, AI, AI
search visibility, AI visibility checker, guides index + 15 guide URLs, markets
index + 31 market pages, FAQ, about, contact. Plus `/sitemap.xml`, `/rss.xml`
and `/llms.txt`, all generated from the same content.

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
| `npm run seed` | Seeds the CMS tables from `src/data/*.json` (idempotent) |
| `npm run test:images` | Builds against a stub API and asserts images reach the HTML |
| `npm run test:visibility` | Tests the AI checker, including its rate limits |

## Architecture

```
src/lib/content.js     Build-time loader: Supabase first, src/data/*.json as fallback
src/data/*.json        Seed + fallback content (not the live source once seeded)
src/pages/             One file per route; [slug].astro fans out over the data
src/components/        Header, Footer, Faq, AuditForm, SubscribeForm
src/lib/admin-schema.js  Field definitions driving every admin editor
src/scripts/           Admin app + generic form renderer
netlify/functions/     audit-request.mjs, subscribe.mjs, publish.mjs
netlify/lib/           Shared http / supabase / validate / webhook helpers
scripts/seed.mjs       One-time seed of the CMS tables
supabase/migrations/   Schema
```

Adding a market or publishing a guide is done in the admin. Both flow into the
pages, the navigation and `sitemap.xml` with no code change — the sitemap is
generated at build time from the same data, so it cannot drift.

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

Both tables have RLS enabled. Anonymous requests match no policy and are denied
outright; signed-in staff get read access (and admins write access) through the
policies in migration `0002`. The service role — which lives in the function
environment and never reaches the browser — bypasses RLS so the public forms can
insert.

### Environment variables

Set in Netlify under **Site configuration → Environment variables**. See
`.env.example`.

| Variable | Notes |
| --- | --- |
| `SUPABASE_URL` | Project API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret. Bypasses RLS — functions only |
| `LEAD_WEBHOOK_URL` | Activepieces webhook |
| `ALLOWED_ORIGINS` | Comma-separated. Leave unset locally |
| `PUBLIC_SUPABASE_URL` | Same URL, exposed to the browser for `/admin` |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key. Public by design |
| `NETLIFY_BUILD_HOOK_URL` | Build hook the Publish button calls |
| `OPENROUTER_API_KEY` | Secret. Powers the AI visibility checker |
| `OPENROUTER_MODEL` | Optional. Defaults to `anthropic/claude-haiku-4.5` |
| `PUBLIC_PLAUSIBLE_DOMAIN` | Optional. Enables Plausible analytics |
| `PUBLIC_UMAMI_SRC` / `PUBLIC_UMAMI_ID` | Optional. Enables Umami instead |

The two `PUBLIC_` values are embedded in the client bundle at build time. That
is intended — they grant nothing on their own, and RLS decides what a signed-in
user can actually see. `npm run audit` fails the build if a service role key or
any JWT ever ends up in `dist/`.

## Content management

Content lives in Supabase and is read **at build time**. The JSON in
`src/data/` is seed data and a fallback: if Supabase is unreachable during a
deploy, the build logs a warning and ships the last committed content rather
than an empty site.

Seed a fresh database once. Put your `service_role` key in `.env` (the file is
gitignored), then:

```bash
npm run seed
```

It upserts on natural keys and skips any table that already has rows, so a
stray run can never clobber content edited in the admin. Pass `--force` to
overwrite deliberately.

### How publishing works

Saving writes to the database immediately, but the live site is static — it
only changes when someone hits **Publish**, which POSTs a Netlify build hook and
rebuilds. That gives drafts for free: "unpublished changes" is simply the count
of rows edited since `site_settings.last_published_at`, shown in the admin
header. Changes go live a minute or two after publishing.

Editable from the admin: guides (Markdown), all 31 market pages, page copy
(including the scorecard and process steps), FAQ, reviews, images,
header/footer menus, and site settings. The editors are generated
from field schemas in `src/lib/admin-schema.js` — adding a new editable section
is a schema entry, not a new UI.

The four sections lost when the design prototype was truncated (`tiers`,
`audiences`, `audit_includes`, `home_faqs`) exist as empty blocks under **Page
copy**. Every template hides its section while the list is empty, so they can be
filled in whenever without a code change.

### Images

Uploads go to a public Supabase Storage bucket (`media`); the `media` table
tracks alt text and dimensions, and `image_slots` maps named template positions
(homepage hero, about portrait, AI hero, homepage feature) onto them. Guides
additionally carry their own cover image.

**Uploads are downscaled in the browser before they are sent** — longest edge
capped at 2000px, re-encoded to WebP (PNG keeps its transparency, GIF is passed
through so animation survives). A 4000x3000 phone photo lands around 90%
smaller. Supabase's free tier has no server-side image transforms, so doing it
client-side is what keeps page weight sane.

Every `<img>` is rendered with `width`/`height` so pages do not shift while
images load, and an unassigned slot renders no markup at all rather than an
empty box — the homepage hero, for instance, drops back to a single-column
layout when no image is set.

### AI visibility checker

`/ai-visibility-check` asks a model what it knows about a visitor's dealership
and shows them the answer. It is the site's own pitch demonstrated on their
store — and the most common result, the assistant not knowing the store exists,
*is* the sales argument.

It is a public endpoint that spends money per call, so the order is strictly
validate → rate-limit → call the model → store → respond:

- **3 checks per IP per day**, and a **150/day global cap** as a hard ceiling on
  the bill. Both are enforced from `visibility_checks`, which doubles as the
  ledger. If the limiter itself errors the endpoint refuses rather than falling
  open.
- IPs are stored **salted-hashed**, never raw.
- Without `OPENROUTER_API_KEY` it returns a helpful "not switched on" message
  and makes no API call at all.
- The whole run shares an **8.5s budget**, because Netlify kills a synchronous
  function at 10s. Prompts run in order and whatever finished is returned — a
  slow model yields fewer answers rather than an error. Free models typically
  manage one of three; `anthropic/claude-haiku-4.5` fits all three.
- Header values are ASCII-filtered. An em dash in `X-Title` once made `fetch`
  throw before sending, so every call failed with no status and no body.

`npm run test:visibility` covers all of that, asserting **zero model calls**
whenever a request is rate-limited or unconfigured.

## Admin area

`/admin` is a static shell; all data is fetched in the browser under the
signed-in user's RLS context, so the served HTML contains no lead data at all.
It is `noindex` and disallowed in `robots.txt`.

Two roles, defined in `supabase/migrations/0002`:

| Role | Leads and subscribers | Profiles |
| --- | --- | --- |
| `admin` | Read, change status, delete | Read all, change roles |
| `user` | Read only | Own row only |

New accounts default to `user` — promoting someone is a deliberate `update
public.profiles set role = 'admin'`. There is **no INSERT policy on any table**:
the public site writes only through the Netlify functions with the service role
key, so a compromised browser session cannot forge a lead.

Adding staff: create the user in Supabase → Authentication → Users. A trigger
creates their profile at `user` automatically.

## Deploying

1. Push to GitHub.
2. Netlify → Add new site → Import an existing project. `netlify.toml` already
   sets the build command, publish directory and functions directory.
3. Add the environment variables from the table above.
4. Apply the migrations in `supabase/migrations/` in order, then run
   `npm run seed` once to populate the CMS tables.
5. Create a build hook (Build & deploy → Build hooks) and set
   `NETLIFY_BUILD_HOOK_URL` so the admin's Publish button works.
6. Point the domain, then submit `https://shawnryder.com/sitemap.xml` in Search
   Console.

**Before pointing the domain**: the existing WordPress site has ~20,800 URLs in
its sitemap. Switching DNS without a redirect map turns all of them into 404s.
Decide deliberately what to 301, what to 410, and what to migrate.

## Known gaps

**Missing copy.** The prototype file is 261 KB and the design API caps reads at
256 KB, so it came back truncated mid-`renderVals()`. Four content arrays were in
the lost tail and were **not** invented: `tiers`, `audiences`, `audit_includes`
and the homepage `home_faqs`. They exist as empty blocks under **Page copy** in
the admin, and each section stays hidden on the site until filled in.

`services`, `diffs`, `steps` and `beliefs` were also in the lost tail but are
recovered verbatim from the v1 design file; v2 may have revised that wording, so
they are worth a read-through. The homepage stat band is reconstructed from
surviving copy rather than the original array.

**No photography yet.** The prototype's 8 image slots held no real files, so
nothing carried across. The plumbing now exists — upload under **Images** in the
admin and assign to a slot — but until real photos are added the site renders
without them (by design, not as a broken state).
