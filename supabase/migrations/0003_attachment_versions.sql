-- Versionado de adjuntos, limites del bucket y correccion de la politica de borrado.
-- Aditiva: las filas existentes quedan validas con los valores por defecto.

alter table attachments
  add column replaces_id uuid references attachments (id) on delete set null,
  add column review_round int not null default 1;

-- Postgres admite multiples NULL en un unique, y eso es lo buscado: muchos adjuntos
-- originales (replaces_id is null) conviven sin problema. La restriccion solo impide
-- que dos archivos declaren el mismo padre y la cadena se bifurque.
alter table attachments
  add constraint attachments_replaces_id_unique unique (replaces_id);

create index idx_attachments_piece_round on attachments (content_piece_id, review_round);

-- La ronda la decide la base, nunca el navegador: sobrescribe lo que llegue del cliente.
create or replace function set_attachment_round()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select count(*) + 1 into new.review_round
  from status_history
  where content_piece_id = new.content_piece_id
    and to_status = 'cambios_solicitados';
  return new;
end;
$$;

drop trigger if exists attachments_set_round on attachments;
create trigger attachments_set_round
  before insert on attachments
  for each row execute function set_attachment_round();

-- Limites explicitos del bucket. Sin esto hereda el default del proyecto (50 MB).
--
-- ADVERTENCIA PARA QUIEN APLIQUE ESTO EN OTRO ENTORNO: Supabase aplica
-- min(limite global del proyecto, limite del bucket). Este update solo fija el limite del
-- bucket; no valida ni sube el limite global del proyecto. Este proyecto esta en el plan
-- gratuito de Supabase, donde el *Global file size limit* es 50 MB por defecto y NO se puede
-- subir sin cambiar de plan -- por eso el valor de abajo esta alineado con ese tope y no es una
-- cifra arbitraria. Si en el futuro se mejora el plan y se sube el limite global desde el panel
-- (Settings -> Storage -> "Upload file size limit"), hay que subir tambien este valor -- y el de
-- TAMANO_MAXIMO_BYTES en lib/attachments.ts y el de supabase/config.toml -- para que los tres
-- sigan de acuerdo.
update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/quicktime', 'video/webm', 'application/pdf'
    ]
where id = 'attachments';

-- Hoy este "and has_client_access(...)" no cambia la decisión de autorización para rutas bien formadas: esa funcion devuelve
-- verdadero para cualquier usuario de agencia sin mirar la marca (0001_init.sql), y el modelo de
-- permisos del producto es justamente ese (cualquier agencia opera sobre cualquier cliente). Se
-- agrega para que las tres politicas del bucket se lean igual y para que un futuro acotamiento de
-- has_client_access() alcance tambien al borrado. No lo leas como un control de marca.
drop policy if exists "attachments_delete" on storage.objects;
create policy "attachments_delete" on storage.objects for delete
  using (
    bucket_id = 'attachments'
    and is_agency()
    and has_client_access((storage.foldername(name))[1]::uuid)
  );
