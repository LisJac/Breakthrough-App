-- Images on inspiration entries, stored in a public Storage bucket.
-- Members upload into a folder named after their own user id and can only remove their own files.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inspiration', 'inspiration', true, 3145728, array['image/jpeg', 'image/png', 'image/webp']);

create policy "members upload own inspiration images" on storage.objects for insert to authenticated
  with check (bucket_id = 'inspiration' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "members see own inspiration files" on storage.objects for select to authenticated
  using (bucket_id = 'inspiration' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "members remove own inspiration images" on storage.objects for delete to authenticated
  using (bucket_id = 'inspiration' and (storage.foldername(name))[1] = (select auth.uid())::text);

alter table public.inspiration
  add column image_url text not null default ''
  check (char_length(image_url) <= 500 and (image_url = '' or image_url ~* '^https://'));
