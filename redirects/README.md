# Old WordPress URL redirects

`legacy-wordpress.csv` maps old shawnryder.com WordPress URLs to pages on this
site. It opens in Excel or Google Sheets. The build turns it into Netlify
redirects (`dist/_redirects`) — see `scripts/build-redirects.mjs`.

| Column | Meaning |
| --- | --- |
| `from` | The old path, e.g. `/local-seo` (trailing slash not needed) |
| `to` | The page on this site it should send people to |
| `referring_domains` | How many other websites link to the old URL (DataForSEO, Oct 2026) |
| `reason` | Why it maps there |

## How it was built

- **2,999 old URLs** known from backlink data and the previous redirect list.
- **83 have links from other websites.** Every one of those was checked by hand.
- **843 are redirected** (301) to the closest guide, tool or service page by topic.
- **The rest return a 404** — off-topic posts (car reviews, cover letters, RC
  cars), thin auto-generated location pages, and junk URLs. Pointing those at
  an unrelated page passes no value and can look like a soft 404 to Google.
- Whole old sections (`/category/*`, `/blog/*`, `/tag/*`, `/automation/*`,
  `/feed`) are caught by patterns in the build script.

## Changing it

Edit a row, commit, deploy. The build **fails** (and tells you why) if a row
points at a page that doesn't exist, or if it would redirect a live page — so a
typo can't quietly break anything.

## After deploying

In Google Search Console → Pages, check "Not found (404)" over the next few
weeks. Any old URL that still gets impressions or clicks is worth adding here.
