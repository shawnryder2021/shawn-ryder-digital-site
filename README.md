# Shawn Ryder Digital — site

Static Astro site with a Supabase-backed CMS and Netlify Functions behind the
forms. Rebuilt from the
Claude Design prototype (`Shawn Ryder Digital v2.dc.html`), which rendered every
page client-side from a single file — no good for a site whose whole point is
being read by search engines and AI assistants.

**81 pages build to real HTML**: home, services, process, scorecard, AI, AI
search visibility, three free tools, guides index + 15 written guides, markets
index + 51 market pages, FAQ, about, contact. Plus `/sitemap.xml`, `/rss.xml`
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
| `npm run seed` | Tops up the CMS tables from `src/data/*.json` (never overwrites) |
| `npm run sync:guides` | Publishes guide bodies from `articles.json` into the CMS |
| `npm run test:images` | Builds against a stub API and asserts images reach the HTML |
| `npm run test:visibility` | Tests the AI visibility checker, including its rate limits |
| `npm run test:crawler` | Tests the crawler checker: robots.txt matching and SSRF guards |
| `npm run test:code` | Tests the custom-code validator against real vendor snippets |
| `npm run test:all` | All four suites, then the build audit |

## Architecture

```
src/lib/content.js     Build-time loader: Supabase first, src/data/*.json as fallback
src/data/*.json        Seed + fallback content (not the live source once seeded)
src/pages/             One file per route; [slug].astro fans out over the data
src/components/        Header, Footer, Faq, AuditForm, SubscribeForm
src/lib/admin-schema.js  Field definitions driving every admin editor
src/scripts/           Admin app + generic form renderer
netlify/functions/     audit-request, subscribe, publish, visibility-check, crawler-check
netlify/lib/           http / supabase / validate / webhook / safe-fetch / robots / page-audit
scripts/seed.mjs       Tops up the CMS tables from src/data/
scripts/sync-guides.mjs  Publishes written guide bodies into the CMS
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

It **tops up**: rows missing from the database get inserted, rows already there
are left exactly as they are. So adding a market or guide to `src/data/` and
re-running is the normal way to publish new content, and a stray run can never
clobber something edited in the admin. Pass `--force` to overwrite deliberately.

Guide *bodies* are a separate command, because a guide row can exist with an
empty body — which was true of eleven of them until they were written:

```bash
npm run sync:guides
```

That fills in only the guides whose body is empty in the database, so a guide
rewritten in the admin is never overwritten by a stale copy in the repo. Add
`--dry` to preview, `--force` to replace bodies deliberately.

### How publishing works

Saving writes to the database immediately, but the live site is static — it
only changes when someone hits **Publish**, which POSTs a Netlify build hook and
rebuilds. That gives drafts for free: "unpublished changes" is simply the count
of rows edited since `site_settings.last_published_at`, shown in the admin
header. Changes go live a minute or two after publishing.

Editable from the admin: guides (Markdown), all 51 market pages, page copy
(including the scorecard and process steps), FAQ, reviews, images,
header/footer menus, site settings, and custom head/body code. The editors are
generated from field schemas in `src/lib/admin-schema.js` — adding a new
editable section is a schema entry, not a new UI.

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

### Custom code (head and body)

**Code** in the admin injects snippets into every page — analytics, tag
managers, pixels, site verification tags, chat widgets, the occasional bit of
CSS. Three slots: `<head>`, immediately after `<body>` opens (where Google Tag
Manager wants its `noscript` iframe), and just before `</body>` closes.

It is stored in `site_settings.code_injection` and written into the static HTML
at build time, unescaped. No sanitising happens, and that is deliberate: an
admin pasting a script tag is doing it on purpose, and a "safe" version of this
feature would be a broken one. Three things make it safe to hand over anyway:

- **`/admin` never receives it.** `admin.astro` does not use `Base.astro`, so a
  snippet that breaks every page cannot break the one page you would use to
  remove it. That is currently true by accident of structure, so
  `npm run audit` fails if `admin.astro` ever starts using the shared layout.
- **Page-breaking snippets are refused, not shipped.** An unclosed `<script>` in
  the head swallows the rest of the document — every page renders blank, the
  build succeeds, and nothing errors anywhere. So `src/lib/code-injection.js`
  checks each slot for unbalanced `script`/`style`/`noscript`/`iframe`/`template`
  tags, for a whole HTML document pasted by mistake, and for absurd length. A
  slot that fails is dropped with a build warning; the other slots still ship.
- **Nothing is live until Publish.** The site is static, so a bad paste sits in
  the database until someone rebuilds.

The admin panel runs the same `checkSlot()` the build runs, so the verdict you
see while typing and the verdict at build time cannot disagree. Advisory
warnings — `document.write`, a GTM body snippet pasted into the head slot, a
verification meta tag outside `<head>`, a render-blocking external script — are
shown but do not block, because those are wrong rather than broken.

`npm run test:code` covers it against real GA4, GTM and verification snippets.

The `PUBLIC_PLAUSIBLE_DOMAIN` / `PUBLIC_UMAMI_*` environment variables still
work and are the tidier route for those two specific tools; this section is for
everything else.

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

### AI crawler check

`/ai-crawler-check` is the companion to the above. The visibility checker shows
a dealer *what* an assistant says about them; this one shows *why*. It reads
their `robots.txt` and homepage and reports which AI crawlers are allowed in and
what they can read once they arrive. Two HTTP requests and a parse — no model,
no per-call cost.

The report separates **answer engines** (`OAI-SearchBot`, `ChatGPT-User`,
`PerplexityBot`, `Claude-User`, `Bingbot`) from **training and grounding**
crawlers (`GPTBot`, `ClaudeBot`, `Google-Extended`, `Applebot-Extended`,
`meta-externalagent`, `CCBot`). Blocking the first group makes a store invisible
today; blocking the second only slows what models learn. Blocking
`Google-Extended` in particular does nothing to Google Search ranking, and
saying otherwise would discredit the whole tool.

Three things needed care:

- **SSRF.** The endpoint fetches a URL an anonymous stranger typed.
  `netlify/lib/safe-fetch.mjs` enforces a scheme allowlist, resolves DNS and
  rejects every private range, follows redirects by hand so each hop is
  re-validated, and caps time and response size. The residual DNS-rebinding risk
  is documented in that file rather than left implied.
- **robots.txt matching.** Telling a dealer they block ChatGPT when they do not
  is worse than having no tool, so `netlify/lib/robots.mjs` implements RFC 9309
  properly: stacked user-agent lines, named groups beating the `*` group,
  longest-match with Allow winning ties, `$` anchors.
- **Client-side rendering.** Most AI crawlers do not run JavaScript, so the page
  audit counts text present *before* any script runs. A homepage that looks full
  in a browser and is empty in source is the most common reason an assistant
  knows nothing about a store.

`npm run test:crawler` covers all of it — including every private IP range and a
public host that redirects into one.

### Review calculator

`/review-calculator` is pure client-side arithmetic, no backend at all: how many
5-star reviews to reach a target rating, and what one 1-star costs. The second
number is `(R−1)/(5−R)` and does not depend on review count — 4 five-stars to
undo a 1-star at 4.2, but 19 at 4.8. The page states plainly that Google's
one-decimal rounding makes all of it an estimate.

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

**Reviews are placeholders.** All three entries under **Reviews** still read
"Google review to be added here." They render as written, so these should be
replaced with real quotes or removed before the domain is pointed.

**Guides are written but unreviewed.** All 15 now have bodies. The eleven added
in July 2026 are drafted in Shawn's voice from his own material and stated
positions, but he has not read them — they are opinionated documents published
under his name, so they warrant a pass before they earn links. Nothing in them
is a fabricated statistic; where a number appears it is arithmetic (the review
calculator formulas) or a stated range presented as a range.
