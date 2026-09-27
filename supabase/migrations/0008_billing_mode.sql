-- Modo de facturacion por marca: "paquete" (cuota mensual por formato, la agencia la define en
-- client_packages) o "libre" (sin cuota, la marca monta las piezas que quiera).
--
-- Antes de esto, "sin filas en client_packages" era ambiguo: podia significar "la agencia todavia
-- no definio el paquete" (spec original de 0006) o "esta marca no trabaja por paquetes" -- y
-- PanelDeMetricas no podia distinguir los dos casos, asi que a una marca sin paquete SIEMPRE le
-- mostraba el aviso "todavia no tiene un paquete mensual definido", aunque la agencia la hubiera
-- marcado a proposito como libre.
--
-- Repetible a proposito: esta migracion se aplica a mano, pegada en el editor SQL del panel de
-- Supabase, y una aplicacion que quedo a medias tiene que poder reintentarse. Mismo patron que
-- 0003, 0004, 0005, 0006 y 0007.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'client_billing_mode') then
    create type client_billing_mode as enum ('paquete', 'libre');
  end if;
end;
$$;

-- Default 'paquete': preserva el comportamiento de hoy para toda marca existente (que ya asume
-- paquete, con o sin cuotas definidas). El formulario de alta de marca es el unico lugar que a
-- partir de ahora elige 'libre' explicitamente.
alter table clients add column if not exists billing_mode client_billing_mode not null default 'paquete';

-- No hace falta tocar RLS ni privilegios de columna: `clients` no esta en la lista de tablas que
-- 0007_endurecimiento_privilegios.sql restringe columna por columna (esa migracion cubre
-- profiles, content_pieces e ideas por las razones que documenta), y `clients_agency_write` ya
-- autoriza a la agencia a escribir cualquier columna de `clients` via `for all`.
