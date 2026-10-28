insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'f1-assets',
  'f1-assets',
  true,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif', 'image/x-icon']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read f1 assets" on storage.objects;
create policy "Public can read f1 assets"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'f1-assets');

drop policy if exists "Authenticated can upload f1 assets" on storage.objects;
create policy "Authenticated can upload f1 assets"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'f1-assets');
