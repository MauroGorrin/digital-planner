-- Anclaje de comentarios a un momento de un video.
-- Aditiva: un comentario con ambas columnas vacias es un comentario normal.

alter table comments
  add column if not exists attachment_id uuid references attachments (id) on delete set null,
  add column if not exists video_segundo int;

-- La Server Action addComment es un endpoint publico y hoy acepta el ancla tal cual llega; la
-- cota vive donde vive el resto del modelo, no solo en la interfaz.
alter table comments
  add constraint comments_video_segundo_check check (video_segundo is null or video_segundo >= 0);

create index if not exists idx_comments_attachment on comments (attachment_id);

-- on delete set null, no cascade: si borrar un archivo se llevara sus comentarios, se perderia
-- parte del registro de por que una pieza se aprobo o se rechazo. El comentario sobrevive y lo
-- que se pierde es el ancla. Consecuencia buscada: puede existir una fila con video_segundo y
-- sin attachment_id, y la interfaz lo dice en vez de disimularlo.

-- Un comentario solo puede anclarse a un adjunto de su propia pieza. Lo impone la base, no la
-- interfaz: attachments.replaces_id ya tiene ese mismo hueco sin cerrar y quedo anotado como
-- deuda; repetirlo en una tabla nueva seria un error conocido cometido dos veces.
create or replace function check_comment_attachment_piece()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.attachment_id is not null then
    if not exists (
      select 1 from attachments
      where id = new.attachment_id
        and content_piece_id = new.content_piece_id
    ) then
      raise exception 'El adjunto % no pertenece a la pieza %', new.attachment_id, new.content_piece_id;
    end if;
  end if;

  -- Solo en INSERT: el on delete set null de arriba crea a propósito un comentario con
  -- video_segundo y sin attachment_id cuando el archivo se borra, y ese estado llega por UPDATE
  -- y debe seguir permitido. Lo que no debe poder pasar es crear ese mismo estado desde el
  -- principio, porque entonces la interfaz diria que un archivo fue eliminado cuando nunca
  -- existio.
  if tg_op = 'INSERT' and new.video_segundo is not null and new.attachment_id is null then
    raise exception 'Un comentario no puede tener video_segundo sin attachment_id';
  end if;

  return new;
end;
$$;

drop trigger if exists comments_check_attachment on comments;
create trigger comments_check_attachment
  before insert or update on comments
  for each row execute function check_comment_attachment_piece();
