-- Adds "Glossary" and "Dealers I work with" to the footer's Site column, just
-- after Guides, on an existing database. A fresh database gets the same links
-- from scripts/seed.mjs. Skipped if the links already exist; positions are
-- found from the rows there now, as in 0009 and 0010.

do $$
declare
  anchor integer;
begin
  if not exists (select 1 from public.nav_links where location = 'footer' and href = '/glossary') then
    select sort_order into anchor
      from public.nav_links where location = 'footer' and href = '/guides'
      order by sort_order limit 1;
    if anchor is null then
      select coalesce(max(sort_order), -1) into anchor from public.nav_links where location = 'footer';
    end if;

    update public.nav_links set sort_order = sort_order + 2
      where location = 'footer' and sort_order > anchor;
    insert into public.nav_links (location, group_label, label, href, sort_order) values
      ('footer', 'Site', 'Glossary', '/glossary', anchor + 1),
      ('footer', 'Site', 'Dealers I work with', '/dealers', anchor + 2);
  end if;
end
$$;
