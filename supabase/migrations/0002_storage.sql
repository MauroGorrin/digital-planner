-- Bucket de almacenamiento para adjuntos (imágenes, videos, documentos)
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- Solo usuarios con acceso al cliente dueño de la pieza pueden leer/escribir.
-- Convención de ruta: <client_id>/<content_piece_id>/<archivo>
create policy "attachments_read" on storage.objects for select
  using (
    bucket_id = 'attachments'
    and has_client_access((storage.foldername(name))[1]::uuid)
  );

create policy "attachments_write" on storage.objects for insert
  with check (
    bucket_id = 'attachments'
    and is_agency()
    and has_client_access((storage.foldername(name))[1]::uuid)
  );

create policy "attachments_delete" on storage.objects for delete
  using (bucket_id = 'attachments' and is_agency());
