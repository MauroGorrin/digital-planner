-- Panel de ideas: la etapa anterior al calendario.
-- Las ideas no tienen fecha; la fecha se elige al convertirlas en pieza.
--
-- Repetible a proposito: estas migraciones se aplican a mano, pegadas en el editor SQL del panel
-- de Supabase, y una aplicacion que quedo a medias tiene que poder reintentarse.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'idea_status') then
    create type idea_status as enum (
      'propuesta',
      'correccion_interna',
      'pendiente_cliente',
      'correccion_cliente',
      'aprobada',
      'descartada',
      'convertida'
    );
  end if;
end;
$$;

create table if not exists ideas (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  title text not null,
  description text not null default '',
  reference_link text,
  suggested_platform platform_type,
  suggested_format content_format,
  status idea_status not null default 'propuesta',
  created_by uuid references profiles (id),
  -- on delete set null, no cascade: borrar la pieza no debe borrar la idea que la origino ni el
  -- registro de por que se aprobo.
  content_piece_id uuid references content_pieces (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ideas_client_status on ideas (client_id, status);

create table if not exists idea_status_history (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid not null references ideas (id) on delete cascade,
  from_status idea_status,
  to_status idea_status not null,
  changed_by uuid references profiles (id),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_idea_history_idea on idea_status_history (idea_id);

-- notifications.content_piece_id apunta a piezas, asi que una notificacion de idea no tendria
-- adonde llevar al usuario sin esta columna.
alter table notifications
  add column if not exists idea_id uuid references ideas (id) on delete cascade;

drop trigger if exists trg_ideas_updated on ideas;
create trigger trg_ideas_updated before update on ideas
  for each row execute function touch_updated_at();

alter table ideas enable row level security;
alter table idea_status_history enable row level security;

-- El cliente no ve lo que el equipo descarto. Es el punto central del diseno: si esto dependiera
-- de un filtro en la interfaz, una consulta directa a la API mostraria las ideas internas.
--
-- has_client_access() NO sirve aca: devuelve verdadero para cualquier usuario de agencia sin
-- mirar la marca, asi que no distingue el caso agencia del caso contacto de cliente.
drop policy if exists ideas_select on ideas;
create policy ideas_select on ideas for select using (
  is_agency()
  or (
    exists (
      select 1 from client_contacts
      where client_id = ideas.client_id and profile_id = auth.uid()
    )
    and status in ('pendiente_cliente', 'correccion_cliente', 'aprobada', 'convertida')
  )
);

drop policy if exists ideas_agency_write on ideas;
create policy ideas_agency_write on ideas for insert with check (is_agency());

drop policy if exists ideas_agency_update on ideas;
create policy ideas_agency_update on ideas for update using (is_agency()) with check (is_agency());

drop policy if exists ideas_agency_delete on ideas;
create policy ideas_agency_delete on ideas for delete using (is_agency());

-- El historial se filtra por transicion, no por idea: "puedo ver esta idea" no es la misma
-- pregunta que "esta fila era para mi". Una idea que paso por correccion_interna y luego llego al
-- cliente sigue teniendo esa fila en la tabla -- si el filtro solo mirara la idea, la nota interna
-- de esa ronda se volveria legible para el cliente en cuanto la idea avanzara. Se escribe solo
-- desde las funciones de transicion, que son security definer y por lo tanto no pasan por esta
-- politica.
--
-- has_client_access() NO sirve aca por el mismo motivo que en ideas_select: devuelve verdadero
-- para cualquier usuario de agencia sin mirar la marca, asi que no distingue agencia de contacto.
drop policy if exists idea_history_select on idea_status_history;
create policy idea_history_select on idea_status_history for select using (
  is_agency()
  or (
    exists (
      select 1 from ideas
      where ideas.id = idea_status_history.idea_id
        and exists (
          select 1 from client_contacts
          where client_contacts.client_id = ideas.client_id
            and client_contacts.profile_id = auth.uid()
        )
    )
    and to_status in ('pendiente_cliente', 'correccion_cliente', 'aprobada', 'convertida')
  )
);

-- Las transiciones viven aca, no en la interfaz: una llamada directa a la API tiene que fallar
-- igual que un clic. Mismo patron que las funciones de content_pieces en 0001_init.sql.

create or replace function submit_idea_to_client(p_idea_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old idea_status; v_client uuid;
begin
  select status, client_id into v_old, v_client from ideas where id = p_idea_id;
  if not is_agency_admin() then raise exception 'Solo un administrador de agencia puede enviarla al cliente'; end if;
  if v_client is null then raise exception 'La idea no existe'; end if;
  if v_old <> 'propuesta' then raise exception 'Solo una idea en propuesta se puede enviar al cliente'; end if;

  update ideas set status = 'pendiente_cliente' where id = p_idea_id;
  insert into idea_status_history (idea_id, from_status, to_status, changed_by)
    values (p_idea_id, v_old, 'pendiente_cliente', auth.uid());
  insert into notifications (profile_id, idea_id, type, title, body)
    select profile_id, p_idea_id, 'idea_pendiente', 'Una idea espera tu revisión', null
    from client_contacts where client_id = v_client;
end;
$$;

create or replace function request_idea_internal_changes(p_idea_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old idea_status; v_created_by uuid;
begin
  select status, created_by into v_old, v_created_by from ideas where id = p_idea_id;
  if not is_agency_admin() then raise exception 'Solo un administrador de agencia puede pedir corrección interna'; end if;
  if v_old is null then raise exception 'La idea no existe'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Pedir corrección exige una nota'; end if;
  if v_old <> 'propuesta' then raise exception 'Solo una idea en propuesta se puede devolver al autor'; end if;

  update ideas set status = 'correccion_interna' where id = p_idea_id;
  insert into idea_status_history (idea_id, from_status, to_status, changed_by, note)
    values (p_idea_id, v_old, 'correccion_interna', auth.uid(), p_note);
  -- La contraparte de esta transicion es el autor de la idea (ideas.created_by), no un contacto
  -- de cliente: es la unica funcion de este archivo donde ambos lados son de agencia. Sin esto el
  -- autor no se entera de que le pidieron corregir y la idea puede quedar parada indefinidamente.
  if v_created_by is not null then
    insert into notifications (profile_id, idea_id, type, title, body)
      values (v_created_by, p_idea_id, 'idea_correccion_interna', 'La agencia pidió corregir tu idea', p_note);
  end if;
end;
$$;

create or replace function approve_idea(p_idea_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_old idea_status; v_client uuid;
begin
  select status, client_id into v_old, v_client from ideas where id = p_idea_id;
  if not exists (select 1 from client_contacts where client_id = v_client and profile_id = auth.uid()) then
    raise exception 'Solo el cliente puede aprobar una idea';
  end if;
  if v_client is null then raise exception 'La idea no existe'; end if;
  if v_old <> 'pendiente_cliente' then raise exception 'Solo una idea pendiente se puede aprobar'; end if;

  update ideas set status = 'aprobada' where id = p_idea_id;
  insert into idea_status_history (idea_id, from_status, to_status, changed_by, note)
    values (p_idea_id, v_old, 'aprobada', auth.uid(), p_note);
  insert into notifications (profile_id, idea_id, type, title, body)
    select profile_id, p_idea_id, 'idea_aprobada', 'El cliente aprobó una idea', p_note
    from client_assignments where client_id = v_client;
end;
$$;

create or replace function request_idea_client_changes(p_idea_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old idea_status; v_client uuid;
begin
  select status, client_id into v_old, v_client from ideas where id = p_idea_id;
  if not exists (select 1 from client_contacts where client_id = v_client and profile_id = auth.uid()) then
    raise exception 'Solo el cliente puede pedir cambios en una idea';
  end if;
  if v_client is null then raise exception 'La idea no existe'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Pedir corrección exige una nota'; end if;
  if v_old <> 'pendiente_cliente' then raise exception 'Solo una idea pendiente admite pedir cambios'; end if;

  update ideas set status = 'correccion_cliente' where id = p_idea_id;
  insert into idea_status_history (idea_id, from_status, to_status, changed_by, note)
    values (p_idea_id, v_old, 'correccion_cliente', auth.uid(), p_note);
  insert into notifications (profile_id, idea_id, type, title, body)
    select profile_id, p_idea_id, 'idea_cambios', 'El cliente pidió cambios en una idea', p_note
    from client_assignments where client_id = v_client;
end;
$$;

create or replace function discard_idea(p_idea_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old idea_status; v_client uuid; v_created_by uuid;
begin
  select status, client_id, created_by into v_old, v_client, v_created_by from ideas where id = p_idea_id;
  if not (
    is_agency()
    or exists (select 1 from client_contacts where client_id = v_client and profile_id = auth.uid())
  ) then
    raise exception 'No autorizado';
  end if;
  if v_client is null then raise exception 'La idea no existe'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Descartar exige un motivo'; end if;
  if v_old = 'convertida' then raise exception 'Una idea ya convertida en pieza no se descarta'; end if;

  update ideas set status = 'descartada' where id = p_idea_id;
  insert into idea_status_history (idea_id, from_status, to_status, changed_by, note)
    values (p_idea_id, v_old, 'descartada', auth.uid(), p_reason);

  -- Se notifica solo al autor de la idea (ideas.created_by), nunca a los contactos de cliente de
  -- la marca. Cualquiera de los dos lados puede descartar, y un contacto de cliente solo llega a
  -- ver una idea desde 'pendiente_cliente' en adelante (ver ideas_select mas arriba): si esta
  -- notificacion tambien avisara a esos contactos, descartar una idea todavia en 'propuesta' o
  -- 'correccion_interna' -- que el cliente nunca debio saber que existio -- se lo revelaria por la
  -- puerta de atras, deshaciendo exactamente el filtro que esa politica existe para sostener. El
  -- autor si es seguro: ya sabe que la idea existe porque el la propuso.
  if v_created_by is not null and v_created_by <> auth.uid() then
    insert into notifications (profile_id, idea_id, type, title, body)
      values (v_created_by, p_idea_id, 'idea_descartada', 'Descartaron tu idea', p_reason);
  end if;
end;
$$;

-- No necesita saber quien pidio el cambio: lo deduce del estado. Si viene de correccion interna
-- vuelve al filtro interno; si viene del cliente vuelve directo al cliente, sin repetir el filtro.
-- Repetirlo haria que cada ida y vuelta con el cliente pasara dos veces por el equipo.
create or replace function resubmit_idea(p_idea_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old idea_status; v_new idea_status; v_client uuid;
begin
  select status, client_id into v_old, v_client from ideas where id = p_idea_id;
  if not is_agency() then raise exception 'Solo la agencia puede reenviar una idea'; end if;
  if v_client is null then raise exception 'La idea no existe'; end if;

  if v_old = 'correccion_interna' then
    v_new := 'propuesta';
  elsif v_old = 'correccion_cliente' then
    v_new := 'pendiente_cliente';
  else
    raise exception 'Solo una idea en corrección se puede reenviar';
  end if;

  update ideas set status = v_new where id = p_idea_id;
  insert into idea_status_history (idea_id, from_status, to_status, changed_by)
    values (p_idea_id, v_old, v_new, auth.uid());

  if v_new = 'pendiente_cliente' then
    insert into notifications (profile_id, idea_id, type, title, body)
      select profile_id, p_idea_id, 'idea_pendiente', 'Una idea corregida espera tu revisión', null
      from client_contacts where client_id = v_client;
  end if;
end;
$$;

-- La pieza se crea por el camino normal y despues se vincula. Asi la creacion sigue teniendo un
-- solo lugar donde vive su validacion, y esta funcion solo se ocupa del vinculo y del estado.
create or replace function convert_idea_to_piece(p_idea_id uuid, p_content_piece_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old idea_status; v_client_idea uuid; v_client_pieza uuid;
begin
  select status, client_id into v_old, v_client_idea from ideas where id = p_idea_id;
  if not is_agency() then raise exception 'Solo la agencia puede convertir una idea'; end if;
  if v_client_idea is null then raise exception 'La idea no existe'; end if;
  if v_old <> 'aprobada' then raise exception 'Solo una idea aprobada se puede convertir'; end if;

  select client_id into v_client_pieza from content_pieces where id = p_content_piece_id;
  if v_client_pieza is null then raise exception 'La pieza no existe'; end if;
  if v_client_pieza <> v_client_idea then
    raise exception 'La pieza pertenece a una marca distinta a la de la idea';
  end if;

  update ideas
    set status = 'convertida', content_piece_id = p_content_piece_id
    where id = p_idea_id;
  insert into idea_status_history (idea_id, from_status, to_status, changed_by)
    values (p_idea_id, v_old, 'convertida', auth.uid());
end;
$$;
