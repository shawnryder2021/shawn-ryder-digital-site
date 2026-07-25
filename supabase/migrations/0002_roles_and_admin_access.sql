-- Role-based access for the admin area.
--
-- Migration 0001 left leads and newsletter_subscribers with RLS on and zero
-- policies, so only the service role (inside the Netlify functions) could touch
-- them. That is still true for writes from the public site. This adds a second,
-- narrower door: signed-in staff reading their own data through the browser.
--
--   admin — read leads and subscribers, update lead status, manage roles
--   user  — read-only on leads and subscribers
--
-- Anonymous visitors still match no policy on any table and see nothing.

create type public.user_role as enum ('admin', 'user');

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  role       public.user_role not null default 'user',
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'Staff accounts. One row per auth user, created automatically on signup.';
comment on column public.profiles.role is 'admin = read/write, user = read-only. New accounts default to user.';

alter table public.profiles enable row level security;

-- Every auth user gets a profile automatically, defaulting to the least
-- privileged role. Promoting someone is a deliberate act, never the default.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- SECURITY DEFINER so the function reads profiles with RLS bypassed. Without
-- that, a policy on profiles that calls this would recurse into itself.
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid()
  );
$$;

revoke execute on function public.is_admin() from anon;
revoke execute on function public.is_staff() from anon;

-- ------------------------------------------------------------- profiles ----
create policy "read own profile"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

create policy "admins read all profiles"
  on public.profiles for select
  to authenticated
  using (public.is_admin());

create policy "admins manage roles"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------- leads ----
create policy "staff read leads"
  on public.leads for select
  to authenticated
  using (public.is_staff());

create policy "admins update leads"
  on public.leads for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins delete leads"
  on public.leads for delete
  to authenticated
  using (public.is_admin());

-- --------------------------------------------- newsletter_subscribers ----
create policy "staff read subscribers"
  on public.newsletter_subscribers for select
  to authenticated
  using (public.is_staff());

create policy "admins update subscribers"
  on public.newsletter_subscribers for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins delete subscribers"
  on public.newsletter_subscribers for delete
  to authenticated
  using (public.is_admin());

-- Note: no INSERT policy anywhere on purpose. The public site writes only
-- through the Netlify functions with the service role key, so a compromised
-- browser session cannot forge leads.
