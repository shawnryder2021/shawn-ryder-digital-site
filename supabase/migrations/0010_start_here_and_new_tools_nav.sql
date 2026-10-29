-- Adds "Start here" to the footer's Site column (just before Guides) and the
-- two newest tools to the Free tools column, on an existing database. A fresh
-- database gets the same links from scripts/seed.mjs.
--
-- Same approach as 0009: positions are found from the rows that exist now,
-- and every insert is skipped if a link with that href is already there.

do $$
declare
  anchor integer;
begin
  if not exists (select 1 from public.nav_links where location = 'footer' and href = '/start-here') then
    select sort_order into anchor
      from public.nav_links where location = 'footer' and href = '/guides'
      order by sort_order limit 1;
    if anchor is null then
      select coalesce(max(sort_order), -1) + 1 into anchor from public.nav_links where location = 'footer';
    end if;

    update public.nav_links set sort_order = sort_order + 1
      where location = 'footer' and sort_order >= anchor;
    insert into public.nav_links (location, group_label, label, href, sort_order)
      values ('footer', 'Site', 'Start here', '/start-here', anchor);
  end if;

  -- New tools go straight after "Ad budget planner" (added in 0009), or at
  -- the end of the footer if that link is gone.
  if not exists (select 1 from public.nav_links where location = 'footer' and href = '/sales-goal-calculator') then
    select sort_order into anchor
      from public.nav_links where location = 'footer' and href = '/ad-budget-planner'
      order by sort_order limit 1;
    if anchor is null then
      select coalesce(max(sort_order), -1) into anchor from public.nav_links where location = 'footer';
    end if;

    update public.nav_links set sort_order = sort_order + 2
      where location = 'footer' and sort_order > anchor;
    insert into public.nav_links (location, group_label, label, href, sort_order) values
      ('footer', 'Free tools', 'Sales goal calculator', '/sales-goal-calculator', anchor + 1),
      ('footer', 'Free tools', 'Google profile checkup', '/google-profile-checkup', anchor + 2);
  end if;
end
$$;
