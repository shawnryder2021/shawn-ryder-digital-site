-- CMS content tables.
--
-- These become the source of truth for everything the site renders. The JSON
-- files under src/data/ are kept as seed data so a fresh project can be
-- rebuilt, and as a build-time fallback if the database is ever unreachable —
-- a DB outage should never deploy an empty site.
--
-- The build reads these with the service role at deploy time, so there is no
-- anon policy anywhere. Staff read through the admin; only admins write.

-- Every content table carries updated_at. "Unpublished changes" is simply
-- any row updated after site_settings.last_published_at, which gives drafts
-- without a revision system.
create function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------- site_settings ----
create table public.site_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
comment on table public.site_settings is 'Global key/value settings: contact details, brand list, last_published_at.';

-- ----------------------------------------------------------- nav_links ----
create table public.nav_links (
  id          uuid primary key default gen_random_uuid(),
  location    text not null check (location in ('header', 'footer')),
  group_label text,
  label       text not null,
  href        text not null,
  sort_order  integer not null default 0,
  updated_at  timestamptz not null default now()
);
comment on column public.nav_links.group_label is 'Footer column heading. Ignored for header links.';
create index nav_links_location_idx on public.nav_links (location, sort_order);

-- ------------------------------------------------------ content_blocks ----
-- Repeating page copy that is really a list of objects: services, steps,
-- beliefs, home stats, pricing tiers, and the sections lost when the design
-- prototype was truncated (tiers, audiences, audit_includes, home_faqs).
create table public.content_blocks (
  key        text primary key,
  label      text not null,
  help       text,
  content    jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
comment on table public.content_blocks is 'Editable page copy, keyed by a stable slug the templates reference.';

-- ------------------------------------------------------------- guides ----
create table public.guides (
  slug          text primary key,
  title         text not null,
  category      text not null default 'Local SEO',
  excerpt       text,
  read_time     text,
  date_label    text,
  takeaways     jsonb not null default '[]'::jsonb,
  body_markdown text,
  published     boolean not null default false,
  sort_order    integer not null default 0,
  updated_at    timestamptz not null default now(),
  constraint guides_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
comment on column public.guides.body_markdown is 'Article body. Empty means the guide renders its "not written yet" state.';
create index guides_published_idx on public.guides (published, sort_order);

-- ------------------------------------------------------------ markets ----
create table public.markets (
  slug       text primary key,
  city       text not null,
  region     text not null,
  country    text not null,
  blurb      text,
  kicker     text,
  h1         text,
  lede       text,
  seo_title  text,
  seo_desc   text,
  stats      jsonb not null default '[]'::jsonb,
  whats      jsonb not null default '[]'::jsonb,
  seasons    jsonb not null default '[]'::jsonb,
  faqs       jsonb not null default '[]'::jsonb,
  published  boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint markets_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
create index markets_country_idx on public.markets (country, sort_order);

-- ------------------------------------------------------------ reviews ----
create table public.reviews (
  id         uuid primary key default gen_random_uuid(),
  quote      text not null,
  name       text not null,
  role       text,
  initials   text,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- faq ----
create table public.faq_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create table public.faq_items (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.faq_groups (id) on delete cascade,
  question   text not null,
  answer     text not null,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);
create index faq_items_group_idx on public.faq_items (group_id, sort_order);

-- ------------------------------------------------------------ triggers ----
do $$
declare t text;
begin
  foreach t in array array[
    'site_settings', 'nav_links', 'content_blocks', 'guides',
    'markets', 'reviews', 'faq_groups', 'faq_items'
  ] loop
    execute format(
      'create trigger %I_touch before update on public.%I
       for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- ----------------------------------------------------------------- RLS ----
-- Same shape as migration 0002: staff read, admins write, anon sees nothing.
-- The build process uses the service role, which bypasses all of this.
do $$
declare t text;
begin
  foreach t in array array[
    'site_settings', 'nav_links', 'content_blocks', 'guides',
    'markets', 'reviews', 'faq_groups', 'faq_items'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    execute format(
      'create policy "staff read %s" on public.%I for select
       to authenticated using (public.is_staff())', t, t);

    execute format(
      'create policy "admins write %s" on public.%I for all
       to authenticated using (public.is_admin()) with check (public.is_admin())', t, t);
  end loop;
end $$;
