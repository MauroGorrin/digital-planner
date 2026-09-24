-- Digital Planner - esquema inicial
-- Ejecutar en un proyecto Supabase (Postgres 15+). Habilita RLS en todas las tablas.

create extension if not exists "pgcrypto";

-- ==========================================================================
-- ENUMS
-- ==========================================================================
create type user_role as enum ('agency_admin', 'agency_member', 'client');
create type platform_type as enum ('instagram', 'facebook', 'tiktok', 'linkedin', 'twitter_x', 'youtube', 'pinterest', 'otra');
create type content_format as enum ('post', 'reel', 'historia', 'carrusel', 'video', 'otro');
create type content_status as enum (
  'borrador',
  'pendiente_revision',
  'cambios_solicitados',
  'aprobado',
  'programado',
  'publicado',
  'cancelado'
);
create type approval_decision as enum ('aprobado', 'cambios_solicitados');
create type webhook_event_type as enum (
  'pieza_creada_revision',
  'pieza_aprobada',
  'cambios_solicitados',
  'comentario_agregado',
  'fecha_cambiada',
  'pieza_programada',
  'pieza_publicada'
);

-- ==========================================================================
-- PROFILES (extiende auth.users)
-- ==========================================================================
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null,
  role user_role not null default 'client',
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ==========================================================================
-- CLIENTS / BRANDS
-- ==========================================================================
create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand_name text not null,
  timezone text not null default 'America/Mexico_City',
  logo_url text,
  notes text,
  archived boolean not null default false,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Miembros del equipo de agencia asignados a un cliente (responsables)
create table client_assignments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (client_id, profile_id)
);

-- Contactos del cliente con acceso de solo su marca
create table client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (client_id, profile_id)
);

-- ==========================================================================
-- CONTENT PIECES
-- ==========================================================================
create table content_pieces (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  platform platform_type not null,
  format content_format not null,
  title text not null,
  copy_text text default '',
  reference_link text,
  scheduled_at timestamptz not null,
  status content_status not null default 'borrador',
  assignee_id uuid references profiles (id),
  created_by uuid references profiles (id),
  duplicated_from uuid references content_pieces (id),
  cancelled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_content_pieces_client on content_pieces (client_id);
create index idx_content_pieces_scheduled on content_pieces (scheduled_at);
create index idx_content_pieces_status on content_pieces (status);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  content_piece_id uuid not null references content_pieces (id) on delete cascade,
  file_path text not null,
  file_name text not null,
  file_type text,
  file_size bigint,
  uploaded_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  content_piece_id uuid not null references content_pieces (id) on delete cascade,
  author_id uuid references profiles (id),
  body text not null,
  parent_comment_id uuid references comments (id),
  created_at timestamptz not null default now()
);

create table status_history (
  id uuid primary key default gen_random_uuid(),
  content_piece_id uuid not null references content_pieces (id) on delete cascade,
  from_status content_status,
  to_status content_status not null,
  changed_by uuid references profiles (id),
  note text,
  created_at timestamptz not null default now()
);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  content_piece_id uuid not null references content_pieces (id) on delete cascade,
  decided_by uuid references profiles (id),
  decision approval_decision not null,
  note text,
  created_at timestamptz not null default now()
);

-- ==========================================================================
-- GOOGLE CALENDAR
-- ==========================================================================
create table google_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  calendar_id text not null,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  connected_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create table client_calendar_mappings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade unique,
  connection_id uuid not null references google_calendar_connections (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table calendar_event_links (
  id uuid primary key default gen_random_uuid(),
  content_piece_id uuid not null references content_pieces (id) on delete cascade unique,
  google_event_id text not null,
  calendar_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ==========================================================================
-- WEBHOOKS (Make.com) - la clave secreta nunca se expone al navegador
-- ==========================================================================
create table webhook_configs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null,
  secret text not null,
  active boolean not null default true,
  events webhook_event_type[] not null default array[
    'pieza_creada_revision','pieza_aprobada','cambios_solicitados',
    'comentario_agregado','fecha_cambiada','pieza_programada','pieza_publicada'
  ]::webhook_event_type[],
  created_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_config_id uuid references webhook_configs (id) on delete cascade,
  event_type webhook_event_type not null,
  payload jsonb not null,
  response_status int,
  error text,
  created_at timestamptz not null default now()
);

-- ==========================================================================
-- NOTIFICATIONS
-- ==========================================================================
create table notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  content_piece_id uuid references content_pieces (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_notifications_profile on notifications (profile_id, read_at);

create table notification_settings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  email_on_pending_review boolean not null default true,
  email_on_client_response boolean not null default true,
  reminder_after_days int not null default 2,
  updated_at timestamptz not null default now(),
  unique (client_id)
);

-- ==========================================================================
-- HELPER FUNCTIONS
-- ==========================================================================
create or replace function current_role_is(role_name user_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = role_name);
$$;

create or replace function is_agency()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('agency_admin','agency_member'));
$$;

create or replace function is_agency_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'agency_admin');
$$;

create or replace function has_client_access(target_client_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_agency() or exists (
    select 1 from client_contacts where client_id = target_client_id and profile_id = auth.uid()
  );
$$;

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated before update on profiles for each row execute function touch_updated_at();
create trigger trg_clients_updated before update on clients for each row execute function touch_updated_at();
create trigger trg_content_pieces_updated before update on content_pieces for each row execute function touch_updated_at();

-- Crea perfil automáticamente cuando se registra un usuario
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'client')
  );
  return new;
end;
$$;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ==========================================================================
-- RLS
-- ==========================================================================
alter table profiles enable row level security;
alter table clients enable row level security;
alter table client_assignments enable row level security;
alter table client_contacts enable row level security;
alter table content_pieces enable row level security;
alter table attachments enable row level security;
alter table comments enable row level security;
alter table status_history enable row level security;
alter table approvals enable row level security;
alter table google_calendar_connections enable row level security;
alter table client_calendar_mappings enable row level security;
alter table calendar_event_links enable row level security;
alter table webhook_configs enable row level security;
alter table webhook_deliveries enable row level security;
alter table notifications enable row level security;
alter table notification_settings enable row level security;

-- profiles
create policy profiles_select on profiles for select using (id = auth.uid() or is_agency());
create policy profiles_update_self on profiles for update using (id = auth.uid());
create policy profiles_admin_manage on profiles for all using (is_agency_admin()) with check (is_agency_admin());

-- clients
create policy clients_select on clients for select using (has_client_access(id));
create policy clients_agency_write on clients for all using (is_agency()) with check (is_agency());

-- client_assignments / client_contacts
create policy client_assignments_select on client_assignments for select using (is_agency());
create policy client_assignments_write on client_assignments for all using (is_agency()) with check (is_agency());
create policy client_contacts_select on client_contacts for select using (is_agency() or profile_id = auth.uid());
create policy client_contacts_write on client_contacts for all using (is_agency()) with check (is_agency());

-- content_pieces: clientes solo ven su marca; solo agencia escribe directamente
create policy content_pieces_select on content_pieces for select using (has_client_access(client_id));
create policy content_pieces_agency_write on content_pieces for insert with check (is_agency());
create policy content_pieces_agency_update on content_pieces for update using (is_agency()) with check (is_agency());
create policy content_pieces_agency_delete on content_pieces for delete using (is_agency());

-- attachments
create policy attachments_select on attachments for select using (
  has_client_access((select client_id from content_pieces where id = content_piece_id))
);
create policy attachments_agency_write on attachments for insert with check (
  is_agency() and has_client_access((select client_id from content_pieces where id = content_piece_id))
);
create policy attachments_agency_delete on attachments for delete using (is_agency());

-- comments: cliente y agencia pueden comentar sobre piezas visibles
create policy comments_select on comments for select using (
  has_client_access((select client_id from content_pieces where id = content_piece_id))
);
create policy comments_insert on comments for insert with check (
  author_id = auth.uid()
  and has_client_access((select client_id from content_pieces where id = content_piece_id))
);

-- status_history / approvals: solo lectura para cliente, escritura vía RPC (security definer)
create policy status_history_select on status_history for select using (
  has_client_access((select client_id from content_pieces where id = content_piece_id))
);
create policy approvals_select on approvals for select using (
  has_client_access((select client_id from content_pieces where id = content_piece_id))
);

-- google calendar + webhooks: solo agencia admin
create policy gcal_conn_admin on google_calendar_connections for all using (is_agency_admin()) with check (is_agency_admin());
create policy gcal_map_admin on client_calendar_mappings for all using (is_agency()) with check (is_agency());
create policy gcal_map_select on client_calendar_mappings for select using (is_agency());
create policy event_links_agency on calendar_event_links for select using (is_agency());
create policy webhook_configs_admin on webhook_configs for all using (is_agency_admin()) with check (is_agency_admin());
create policy webhook_deliveries_admin on webhook_deliveries for select using (is_agency_admin());

-- notifications
create policy notifications_select on notifications for select using (profile_id = auth.uid());
create policy notifications_update on notifications for update using (profile_id = auth.uid());
create policy notification_settings_select on notification_settings for select using (has_client_access(client_id));
create policy notification_settings_write on notification_settings for all using (is_agency()) with check (is_agency());

-- ==========================================================================
-- RPC: transiciones de estado (mantienen historial y disparan notificaciones)
-- ==========================================================================
create or replace function submit_for_review(p_content_piece_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old content_status; v_client uuid;
begin
  select status, client_id into v_old, v_client from content_pieces where id = p_content_piece_id;
  if not is_agency() then raise exception 'No autorizado'; end if;
  update content_pieces set status = 'pendiente_revision' where id = p_content_piece_id;
  insert into status_history (content_piece_id, from_status, to_status, changed_by)
    values (p_content_piece_id, v_old, 'pendiente_revision', auth.uid());
  insert into notifications (profile_id, content_piece_id, type, title, body)
    select profile_id, p_content_piece_id, 'pendiente_revision', 'Nuevo contenido para revisar',
           'Tienes una pieza pendiente de revisión.'
    from client_contacts where client_id = v_client;
end;
$$;

create or replace function approve_content_piece(p_content_piece_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_old content_status; v_client uuid;
begin
  select status, client_id into v_old, v_client from content_pieces where id = p_content_piece_id;
  if not has_client_access(v_client) then raise exception 'No autorizado'; end if;
  if not exists (select 1 from client_contacts where client_id = v_client and profile_id = auth.uid()) then
    raise exception 'Solo el cliente puede aprobar';
  end if;
  update content_pieces set status = 'aprobado' where id = p_content_piece_id;
  insert into status_history (content_piece_id, from_status, to_status, changed_by, note)
    values (p_content_piece_id, v_old, 'aprobado', auth.uid(), p_note);
  insert into approvals (content_piece_id, decided_by, decision, note)
    values (p_content_piece_id, auth.uid(), 'aprobado', p_note);
  insert into notifications (profile_id, content_piece_id, type, title, body)
    select profile_id, p_content_piece_id, 'aprobado', 'Pieza aprobada por el cliente', p_note
    from client_assignments where client_id = v_client;
end;
$$;

create or replace function request_changes(p_content_piece_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old content_status; v_client uuid;
begin
  select status, client_id into v_old, v_client from content_pieces where id = p_content_piece_id;
  if not has_client_access(v_client) then raise exception 'No autorizado'; end if;
  if not exists (select 1 from client_contacts where client_id = v_client and profile_id = auth.uid()) then
    raise exception 'Solo el cliente puede solicitar cambios';
  end if;
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'Debes explicar qué quieres modificar';
  end if;
  update content_pieces set status = 'cambios_solicitados' where id = p_content_piece_id;
  insert into status_history (content_piece_id, from_status, to_status, changed_by, note)
    values (p_content_piece_id, v_old, 'cambios_solicitados', auth.uid(), p_note);
  insert into approvals (content_piece_id, decided_by, decision, note)
    values (p_content_piece_id, auth.uid(), 'cambios_solicitados', p_note);
  insert into comments (content_piece_id, author_id, body)
    values (p_content_piece_id, auth.uid(), '[Solicitud de cambios] ' || p_note);
  insert into notifications (profile_id, content_piece_id, type, title, body)
    select profile_id, p_content_piece_id, 'cambios_solicitados', 'El cliente solicitó cambios', p_note
    from client_assignments where client_id = v_client;
end;
$$;

create or replace function mark_scheduled(p_content_piece_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old content_status;
begin
  if not is_agency() then raise exception 'No autorizado'; end if;
  select status into v_old from content_pieces where id = p_content_piece_id;
  if v_old <> 'aprobado' then raise exception 'Solo piezas aprobadas pueden programarse'; end if;
  update content_pieces set status = 'programado' where id = p_content_piece_id;
  insert into status_history (content_piece_id, from_status, to_status, changed_by)
    values (p_content_piece_id, v_old, 'programado', auth.uid());
end;
$$;

create or replace function mark_published(p_content_piece_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old content_status;
begin
  if not is_agency() then raise exception 'No autorizado'; end if;
  select status into v_old from content_pieces where id = p_content_piece_id;
  update content_pieces set status = 'publicado' where id = p_content_piece_id;
  insert into status_history (content_piece_id, from_status, to_status, changed_by)
    values (p_content_piece_id, v_old, 'publicado', auth.uid());
end;
$$;

create or replace function cancel_content_piece(p_content_piece_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old content_status;
begin
  if not is_agency() then raise exception 'No autorizado'; end if;
  select status into v_old from content_pieces where id = p_content_piece_id;
  update content_pieces set status = 'cancelado', cancelled_reason = p_reason where id = p_content_piece_id;
  insert into status_history (content_piece_id, from_status, to_status, changed_by, note)
    values (p_content_piece_id, v_old, 'cancelado', auth.uid(), p_reason);
end;
$$;

create or replace function reschedule_content_piece(p_content_piece_id uuid, p_new_scheduled_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_agency() then raise exception 'No autorizado'; end if;
  update content_pieces set scheduled_at = p_new_scheduled_at where id = p_content_piece_id;
  insert into status_history (content_piece_id, from_status, to_status, changed_by, note)
    select id, status, status, auth.uid(), 'Fecha reprogramada'
    from content_pieces where id = p_content_piece_id;
end;
$$;
