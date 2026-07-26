-- Image handling.
--
-- Files live in a public Storage bucket; the database tracks them so the admin
-- has a library with alt text and dimensions. Dimensions matter: rendering
-- <img> without width/height causes layout shift, which Core Web Vitals
-- penalises — on a site whose whole pitch is search visibility.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Anyone may read (the site serves these to the public); only admins write.
create policy "public read media"
  on storage.objects for select
  to public
  using (bucket_id = 'media');

create policy "admins upload media"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'media' and public.is_admin());

create policy "admins update media"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'media' and public.is_admin());

create policy "admins delete media"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'media' and public.is_admin());

-- ------------------------------------------------------------- library ----
create table public.media (
  id         uuid primary key default gen_random_uuid(),
  path       text not null unique,
  url        text not null,
  alt        text not null default '',
  width      integer,
  height     integer,
  bytes      integer,
  mime       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.media is 'Uploaded images. path is the object key inside the "media" storage bucket.';
comment on column public.media.alt is 'Alt text. Empty is allowed but flagged in the admin — it is an accessibility and SEO signal.';

create index media_created_at_idx on public.media (created_at desc);

-- --------------------------------------------------------- image slots ----
-- Named positions in the page templates. Seeded from the prototype's slots so
-- the admin lists exactly the images the design expects, rather than a blank
-- library the user has to guess at.
create table public.image_slots (
  key        text primary key,
  label      text not null,
  help       text,
  media_id   uuid references public.media (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.image_slots is 'Fixed image positions in the templates. Empty slot = section renders without an image.';

insert into public.image_slots (key, label, help) values
  ('home_hero',    'Homepage hero',   'Beside the main headline. A showroom or lot photo. Landscape, at least 1200px wide.'),
  ('home_dealer',  'Homepage feature', 'A dealership or delivery photo used further down the homepage.'),
  ('about_portrait', 'About portrait', 'Your photo on the About page. Portrait orientation works best.'),
  ('ai_hero',      'AI page hero',    'Shown on /ai. A showroom, tablet or customer photo.');

-- ------------------------------------------------------- guide covers ----
alter table public.guides
  add column cover_media_id uuid references public.media (id) on delete set null;

-- ------------------------------------------------------------ triggers ----
create trigger media_touch before update on public.media
  for each row execute function public.touch_updated_at();
create trigger image_slots_touch before update on public.image_slots
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------- RLS ----
alter table public.media enable row level security;
alter table public.image_slots enable row level security;

create policy "staff read media" on public.media for select
  to authenticated using (public.is_staff());
create policy "admins write media" on public.media for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "staff read image_slots" on public.image_slots for select
  to authenticated using (public.is_staff());
create policy "admins write image_slots" on public.image_slots for all
  to authenticated using (public.is_admin()) with check (public.is_admin());
