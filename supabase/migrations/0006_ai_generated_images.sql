-- Tracks which media rows came from the AI image generator, and with what
-- prompt, so a generated photo's origin is never ambiguous later.
--
-- All nullable: every existing row and every future manual upload has none of
-- this, and that is the correct value for a real photograph.

alter table public.media
  add column prompt text,
  add column source text,
  add column model text;

comment on column public.media.prompt is 'The exact prompt used, when this image was AI-generated.';
comment on column public.media.source is 'e.g. "kie-ai". Null for a manual upload.';
comment on column public.media.model is 'e.g. "gpt-image-2-text-to-image". Null for a manual upload.';
