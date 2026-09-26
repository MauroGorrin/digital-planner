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

-- El historial se lee si se puede leer la idea; se escribe solo desde las funciones de transicion,
-- que son security definer y por lo tanto no pasan por estas politicas.
drop policy if exists idea_history_select on idea_status_history;
create policy idea_history_select on idea_status_history for select using (
  exists (select 1 from ideas where id = idea_status_history.idea_id)
);
