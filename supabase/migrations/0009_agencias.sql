-- La agencia como entidad, y las marcas y los perfiles colgados de ella. Es el paso 1 del spec
-- docs/superpowers/specs/2026-09-27-multi-agencia-y-registro.md: el modelo de datos y el backfill.
--
-- Este archivo NO aisla nada todavia. `is_agency()` sigue respondiendo "soy personal de agencia"
-- sin mirar de que agencia, y las 44 politicas siguen como estaban. El aislamiento es el paso 2 y
-- lleva su propia auditoria. Si aplicas solo este archivo, el producto se comporta exactamente
-- igual que antes -- eso es lo que se busca: que el modelo entre sin mover el comportamiento.
--
-- Repetible a proposito: esta migracion se aplica a mano, pegada en el editor SQL del panel de
-- Supabase, y una aplicacion que quedo a medias tiene que poder reintentarse. Mismo patron que
-- 0003, 0004, 0005, 0006, 0007 y 0008.

-- ==========================================================================================
-- 1. AGENCIES
-- ==========================================================================================
-- El nombre nace como 'Agencia' en el backfill y lo cambia su dueno cuando exista la pantalla para
-- hacerlo. No inventes aqui un nombre "de verdad": este archivo no sabe como se llama tu agencia y
-- adivinarlo dejaria un dato falso que nadie revisa.
create table if not exists agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Se reusa touch_updated_at() de 0001_init.sql. No escribas otra funcion igual: serian dos sitios
-- que hay que mantener sincronizados para conseguir exactamente el mismo efecto.
drop trigger if exists trg_agencies_updated on agencies;
create trigger trg_agencies_updated before update on agencies
  for each row execute function touch_updated_at();

-- RLS encendida y SIN politicas, a proposito. Supabase le otorga a `authenticated` y `anon` el
-- privilegio de tabla sobre todo el schema public, asi que una tabla nueva sin RLS queda legible y
-- escribible por cualquier sesion -- y esta tabla es justamente la que va a decidir quien ve que.
-- Sin politicas, RLS deniega por defecto y solo `service_role` (que la salta) puede tocarla. Las
-- politicas de lectura las agrega el paso 2 junto con mi_agencia(); mientras no existan, el
-- silencio es la opcion segura y no un olvido.
alter table agencies enable row level security;

-- ==========================================================================================
-- 2. LAS DOS COLUMNAS, ANULABLES PRIMERO
-- ==========================================================================================
-- Nacen anulables las dos porque el backfill de la seccion 3 tiene que correr antes de que
-- cualquiera de ellas pueda exigir un valor. El `not null` de clients.agency_id se aplica al final
-- del backfill, no aqui.
alter table profiles add column if not exists agency_id uuid references agencies (id);
alter table clients  add column if not exists agency_id uuid references agencies (id);

-- Toda politica del paso 2 va a filtrar por estas dos columnas, y una comparacion de pertenencia
-- que haga seq scan sobre profiles en cada fila de cada consulta se nota enseguida.
create index if not exists idx_profiles_agency on profiles (agency_id);
create index if not exists idx_clients_agency on clients (agency_id);

-- ==========================================================================================
-- 3. BACKFILL: tus datos de hoy quedan en una sola agencia
-- ==========================================================================================
-- El guard `not exists (select 1 from agencies)` es lo que hace este bloque idempotente: sin el,
-- pegar el archivo dos veces (algo que pasa de verdad cuando la primera aplicacion se corta a
-- mitad) crearia una segunda agencia vacia y dejaria la mitad de tus datos apuntando a una y la
-- mitad a otra. Al mirar si ya existe ALGUNA agencia -- no si existe una llamada 'Agencia' -- el
-- bloque tampoco vuelve a actuar cuando ya se registraron agencias reales por el alta publica.
do $$
declare v_agencia uuid;
begin
  if not exists (select 1 from agencies) then
    insert into agencies (name) values ('Agencia') returning id into v_agencia;

    -- Solo el personal de agencia. Un contacto de cliente se conecta por client_contacts y su
    -- agency_id tiene que quedar nulo (lo exige el check de la seccion 4).
    update profiles set agency_id = v_agencia
     where role in ('agency_admin', 'agency_member') and agency_id is null;

    update clients set agency_id = v_agencia where agency_id is null;
  end if;
end;
$$;

-- Recien ahora, con el backfill hecho, la columna puede exigir valor: una marca siempre pertenece a
-- una agencia. `alter column ... set not null` ya es idempotente por si mismo (aplicarlo sobre una
-- columna que ya es not null no hace nada ni falla), asi que no necesita guard.
alter table clients alter column agency_id set not null;

-- ==========================================================================================
-- 4. EL CHECK DE profiles.agency_id
-- ==========================================================================================
-- profiles.agency_id se queda ANULABLE porque un contacto de cliente no pertenece a ninguna
-- agencia: pertenece a una o varias marcas, por client_contacts. Pero "anulable" no puede
-- significar "da igual": un miembro de agencia sin agencia no tendria con que compararse en
-- ninguna politica del paso 2, y ahi un nulo no niega el acceso, lo vuelve indefinido.
--
-- El check se agrega DESPUES del backfill, asi que valida contra datos que ya cumplen la regla. Si
-- te fallara al aplicarlo, no lo pases a `not valid` sin mirar: significa que hay perfiles de
-- agencia sin agencia, o contactos de cliente con una, y eso es un dato roto que hay que arreglar
-- antes, no una restriccion que haya que relajar.
--
-- OJO al probarlo a mano: el estado intermedio "ya soy agency_admin pero todavia no tengo agencia"
-- no existe en ningun camino de la app. El alta del paso 3 escribe `role` y `agency_id` en el MISMO
-- update, y los fixtures de prueba hacen lo mismo. Si lo partes en dos updates, el primero rebota
-- con 23514 y no es un bug del check.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_agency_id_rol_check'
  ) then
    alter table profiles
      add constraint profiles_agency_id_rol_check
      check (
        (role = 'client' and agency_id is null)
        or (role <> 'client' and agency_id is not null)
      );
  end if;
end;
$$;

-- ==========================================================================================
-- 5. PRIVILEGIOS DE COLUMNA: ESTE BLOQUE SUSTITUYE AL DE 0007
-- ==========================================================================================
-- LEE ESTO ANTES DE TOCAR NADA DE AQUI:
--
--   * `0007_endurecimiento_privilegios.sql` revoca el privilegio de tabla y lo devuelve columna por
--     columna, excluyendo las protegidas. Como la lista de columnas se calcula desde pg_attribute,
--     una columna NUEVA nace sin privilegio para `authenticated` y la app no puede escribirla hasta
--     que el bloque se reejecute. `profiles.agency_id` es una columna nueva, asi que hay que
--     reejecutarlo -- y este archivo lo reejecuta el mismo. No hace falta que vuelvas a pegar 0007.
--
--   * Este bloque SUSTITUYE al de 0007: es el mismo mecanismo con el conjunto protegido ampliado.
--     Volver a pegar 0007 DESPUES de 0009 DESHACE las protecciones nuevas -- devolveria el
--     privilegio de update sobre `profiles.agency_id` y sobre `clients.agency_id`, porque 0007 no
--     los conoce. Si algun dia tienes que reejecutar el endurecimiento de privilegios, reejecuta
--     ESTE archivo, no aquel. Y si agregas otra columna protegida, agregala aqui.
--
-- Por que se calculan las columnas permitidas desde pg_attribute y no se listan a mano: es la razon
-- que da 0007 y sigue valiendo -- para que reejecutar el bloque alcance y nadie tenga que mantener
-- la misma lista en dos sitios. No la conviertas en un array literal.
do $$
declare
  r record;
  v_columnas text;
begin
  for r in
    select * from (values
      -- `role` sigue protegida por lo que documenta 0007 (CN-001): es la raiz del modelo de
      -- autorizacion y una sola escritura convierte a un contacto en administrador de agencia.
      --
      -- `agency_id` se suma por la MISMA razon, y es el criterio de aceptacion 5 del spec: si un
      -- usuario puede moverse a otra agencia, el aislamiento del paso 2 no sirve de nada -- no
      -- necesita romper ninguna politica, le basta con cambiarse de inquilino y que las politicas
      -- lo dejen ver lo que hay ahi. Es el mismo agujero que cambiarse el rol, con otro nombre.
      -- La pone el alta de agencia, que sera SECURITY DEFINER, y `crearUsuario` con el cliente de
      -- servicio: `service_role` no aparece en el revoke y conserva el privilegio.
      ('profiles',       'update', array['role', 'agency_id']),

      -- `clients` NO estaba en la lista de 0007 (aquella migracion cubria profiles, content_pieces
      -- e ideas, y 0008 lo dice explicitamente). Entra ahora: una marca no puede mudarse de
      -- agencia. Mudarla se llevaria todas sus piezas, ideas, comentarios y adjuntos al panel de
      -- otra agencia de una sola escritura, que es la fuga entre inquilinos completa.
      --
      -- Solo 'update': una marca TIENE que nacer con su agencia (agency_id es not null), asi que el
      -- insert se deja abierto. Es el mismo criterio con el que 0007 protege content_pieces.client_id
      -- en el update y no en el insert.
      ('clients',        'update', array['agency_id']),

      -- Sin cambios respecto a 0007. Estan aqui porque este bloque sustituye al de aquel archivo:
      -- si las quitaras de esta lista, la reejecucion devolveria el privilegio y el endurecimiento
      -- de 0007 se caeria en silencio.
      ('content_pieces', 'insert', array['status']),
      ('content_pieces', 'update', array['status', 'client_id']),
      ('ideas',          'insert', array['status']),
      ('ideas',          'update', array['status', 'client_id', 'content_piece_id'])
    ) as t(tabla, privilegio, protegidas)
  loop
    execute format('revoke %s on public.%I from authenticated, anon', r.privilegio, r.tabla);

    select string_agg(quote_ident(attname), ', ' order by attnum)
      into v_columnas
      from pg_attribute
     where attrelid = format('public.%I', r.tabla)::regclass
       and attnum > 0
       and not attisdropped
       and attname <> all (r.protegidas);

    execute format('grant %s (%s) on public.%I to authenticated, anon', r.privilegio, v_columnas, r.tabla);
  end loop;
end;
$$;
