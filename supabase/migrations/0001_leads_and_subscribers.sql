-- Shawn Ryder Digital — site backend schema
--
-- Two tables, both write-only from the public internet: the Netlify functions
-- insert with the service role key, and nothing else can read them. RLS is
-- enabled with zero policies, so anon/authenticated requests match no policy
-- and are denied. service_role bypasses RLS, which is exactly the access the
-- functions need and the browser never has.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- leads ----
create table if not exists public.leads (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),

  -- what the dealer typed
  name              text not null,
  dealership        text,
  email             text not null,
  phone             text,
  message           text,

  -- the six-box "where are you losing deals" checklist on the contact page
  checklist         jsonb not null default '[]'::jsonb,

  -- context we capture rather than ask for
  source_page       text,
  market_slug       text,
  referrer          text,
  user_agent        text,

  -- pipeline state, for when this feeds the CRM
  status            text not null default 'new',
  webhook_status    text,
  webhook_error     text,

  constraint leads_email_format check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint leads_status_valid check (status in ('new', 'contacted', 'qualified', 'closed', 'spam'))
);

comment on table public.leads is 'Free-audit requests submitted from the contact form.';
comment on column public.leads.checklist is 'Array of the checklist statements the dealer ticked.';
comment on column public.leads.webhook_status is 'Result of the Activepieces webhook POST: delivered | failed | skipped.';

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_email_idx on public.leads (lower(email));

alter table public.leads enable row level security;

-- --------------------------------------------- newsletter_subscribers ----
create table if not exists public.newsletter_subscribers (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  -- Stored already lower-cased by the function, so a plain unique constraint
  -- works here and PostgREST can upsert with on_conflict=email.
  email             text not null unique,
  source_page       text,
  referrer          text,
  unsubscribed_at   timestamptz,

  constraint subscribers_email_format check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint subscribers_email_lowercase check (email = lower(email))
);

comment on table public.newsletter_subscribers is 'Guide-notification signups from the /guides page.';

create index if not exists subscribers_created_at_idx
  on public.newsletter_subscribers (created_at desc);

alter table public.newsletter_subscribers enable row level security;
