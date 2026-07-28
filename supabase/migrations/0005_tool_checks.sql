-- Ledgers for the two public tools.
--
-- Both tables do double duty: they record what a visitor asked for, and they
-- ARE the rate limiter. A Netlify function has no memory between invocations,
-- so "how many checks has this IP run today" has to be a query.
--
-- visibility_checks is declared here with `if not exists` because it was
-- originally created directly against the database while the checker was being
-- debugged. This migration is what makes a fresh clone reproducible.

create extension if not exists "pgcrypto";

-- ------------------------------------------------- visibility_checks ----
-- /api/visibility-check — asks a model what it knows about a dealership.
create table if not exists public.visibility_checks (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),

  dealership    text not null,
  city          text not null,
  email         text,

  results       jsonb not null default '[]'::jsonb,
  mentioned     boolean not null default false,
  model         text,

  -- Salted-hashed, never raw: this is the rate-limit key, not an identity.
  ip_hash       text,
  user_agent    text,
  referrer      text
);

comment on table public.visibility_checks is
  'AI visibility checks run from /ai-visibility-check. Doubles as the rate-limit ledger.';
comment on column public.visibility_checks.ip_hash is
  'sha256(salt + ip), truncated. Used only to count checks per IP per day.';

create index if not exists visibility_checks_created_at_idx
  on public.visibility_checks (created_at desc);
create index if not exists visibility_checks_ip_idx
  on public.visibility_checks (ip_hash, created_at desc);

alter table public.visibility_checks enable row level security;

-- ---------------------------------------------------- crawler_checks ----
-- /api/crawler-check — reads a dealership's robots.txt and homepage.
create table if not exists public.crawler_checks (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),

  url             text not null,
  final_url       text,
  host            text,

  robots_found    boolean not null default false,
  -- The AI user-agent tokens this site disallows, e.g. ["GPTBot","CCBot"].
  -- Worth keeping as an array rather than inside the JSON blob: it is the one
  -- field worth aggregating across checks.
  blocked_agents  text[] not null default '{}',

  verdict         text,
  findings        jsonb not null default '[]'::jsonb,
  page_summary    jsonb,
  page_error      text,

  ip_hash         text,
  user_agent      text,
  referrer        text,

  constraint crawler_checks_verdict_valid
    check (verdict is null or verdict in ('good', 'warn', 'bad'))
);

comment on table public.crawler_checks is
  'AI crawler access checks run from /ai-crawler-check. Doubles as the rate-limit ledger.';
comment on column public.crawler_checks.blocked_agents is
  'AI crawler user-agent tokens this site disallows from /.';

create index if not exists crawler_checks_created_at_idx
  on public.crawler_checks (created_at desc);
create index if not exists crawler_checks_ip_idx
  on public.crawler_checks (ip_hash, created_at desc);
create index if not exists crawler_checks_host_idx
  on public.crawler_checks (host);

alter table public.crawler_checks enable row level security;

-- Same posture as leads: RLS on, no policies. Anonymous and signed-in requests
-- match nothing and are denied; the functions reach these tables only through
-- the service role key, which bypasses RLS and never leaves the server.
