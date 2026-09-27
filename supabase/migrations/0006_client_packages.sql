-- Paquete mensual contratado por marca y formato: cuanto se vendio ("12 posts, 8 reels, 30
-- historias al mes"), para compararlo despues contra lo planificado y lo entregado.
--
-- Repetible a proposito: esta migracion se aplica a mano, pegada en el editor SQL del panel de
-- Supabase, y una aplicacion que quedo a medias tiene que poder reintentarse. Mismo patron que
-- 0003, 0004 y 0005.

create table if not exists client_packages (
  client_id uuid not null references clients (id) on delete cascade,
  format content_format not null,
  monthly_quota int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (client_id, format)
);

-- Una fila ausente significa "este formato no esta en el paquete". La cuota 0 no existe: si
-- existiera, un formato fuera del paquete y un formato contratado en cero se verian identicos, y
-- son dos situaciones distintas (ver el spec, seccion "El paquete: una cuota mensual por
-- formato"). El check tambien descarta negativos, que no representan nada valido.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'client_packages_monthly_quota_check'
  ) then
    alter table client_packages
      add constraint client_packages_monthly_quota_check check (monthly_quota > 0);
  end if;
end;
$$;

create index if not exists idx_client_packages_client on client_packages (client_id);

drop trigger if exists trg_client_packages_updated on client_packages;
create trigger trg_client_packages_updated before update on client_packages
  for each row execute function touch_updated_at();

alter table client_packages enable row level security;

-- has_client_access() NO sirve aca: devuelve verdadero para cualquier usuario de agencia sin
-- mirar la marca, asi que no distingue el caso agencia (que puede leer cualquier paquete) del
-- caso contacto de cliente (que solo debe leer el de su propia marca). Se usa la misma
-- construccion explicita de client_contacts + auth.uid() que ideas_select en 0005_ideas.sql, y
-- por el mismo motivo documentado ahi. No "simplificar" esto de vuelta a has_client_access(): ese
-- cambio haria que un contacto de cualquier marca leyera el paquete de todas.
drop policy if exists client_packages_select on client_packages;
create policy client_packages_select on client_packages for select using (
  is_agency()
  or exists (
    select 1 from client_contacts
    where client_id = client_packages.client_id and profile_id = auth.uid()
  )
);

-- El cliente paga el paquete, no lo edita: solo la agencia escribe. Insert, update y delete
-- quedan reservados a is_agency(); sin una politica de escritura para el cliente, RLS deniega por
-- defecto.
drop policy if exists client_packages_agency_insert on client_packages;
create policy client_packages_agency_insert on client_packages for insert with check (is_agency());

drop policy if exists client_packages_agency_update on client_packages;
create policy client_packages_agency_update on client_packages for update
  using (is_agency()) with check (is_agency());

drop policy if exists client_packages_agency_delete on client_packages;
create policy client_packages_agency_delete on client_packages for delete using (is_agency());
