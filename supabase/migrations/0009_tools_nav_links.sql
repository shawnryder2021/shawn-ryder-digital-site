-- Adds the /tools hub and the two new calculators to the menus of an existing
-- database. A fresh database gets the same links from scripts/seed.mjs.
--
-- Menus can be reordered in the admin, so positions are found relative to the
-- rows that are there now rather than assumed. Every insert is skipped when a
-- link with that href already exists, so running this twice changes nothing.

do $$
declare
  anchor integer;
begin
  -- Header: "Tools" goes straight after "Guides", or at the end if Guides is gone.
  if not exists (select 1 from public.nav_links where location = 'header' and href = '/tools') then
    select sort_order into anchor
      from public.nav_links where location = 'header' and href = '/guides'
      order by sort_order limit 1;
    if anchor is null then
      select coalesce(max(sort_order), -1) into anchor from public.nav_links where location = 'header';
    end if;

    update public.nav_links set sort_order = sort_order + 1
      where location = 'header' and sort_order > anchor;
    insert into public.nav_links (location, group_label, label, href, sort_order)
      values ('header', null, 'Tools', '/tools', anchor + 1);
  end if;

  -- Footer: three links at the top of the "Free tools" column, or at the end
  -- of the footer under that heading if the column no longer exists.
  if not exists (select 1 from public.nav_links where location = 'footer' and href = '/tools') then
    select min(sort_order) into anchor
      from public.nav_links where location = 'footer' and group_label = 'Free tools';
    if anchor is null then
      select coalesce(max(sort_order), -1) + 1 into anchor from public.nav_links where location = 'footer';
    end if;

    update public.nav_links set sort_order = sort_order + 3
      where location = 'footer' and sort_order >= anchor;
    insert into public.nav_links (location, group_label, label, href, sort_order) values
      ('footer', 'Free tools', 'All free tools', '/tools', anchor),
      ('footer', 'Free tools', 'Lead leak calculator', '/lead-leak-calculator', anchor + 1),
      ('footer', 'Free tools', 'Ad budget planner', '/ad-budget-planner', anchor + 2);
  end if;
end
$$;
