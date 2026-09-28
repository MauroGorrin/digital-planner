-- El aislamiento entre agencias. Es el paso 2 del spec
-- docs/superpowers/specs/2026-09-27-multi-agencia-y-registro.md, y el paso donde vive la seguridad
-- de todo el cambio.
--
-- 0009_agencias.sql metió el modelo (la tabla `agencies` y las columnas `profiles.agency_id` y
-- `clients.agency_id`) sin mover ni un permiso: a propósito, para que el modelo entrara sin cambiar
-- el comportamiento. Este archivo es el que sí lo cambia. A partir de aquí `is_agency()` deja de
-- alcanzar por sí sola para autorizar una fila: sigue respondiendo "soy personal de agencia", que es
-- una pregunta sin marca y por lo tanto sin aislamiento, y toda política que decida sobre una fila
-- la acompaña con una comparación de pertenencia.
--
-- EL MODO DE FALLO QUE ESTE ARCHIVO EXISTE PARA EVITAR no es que algo reviente: es que la agencia A
-- lea las marcas, las piezas, los comentarios o los adjuntos de la agencia B en silencio, con el
-- gate en verde. Por eso cada decisión de abajo dice por qué, y por eso hay una auditoría escrita
-- sitio por sitio en docs/superpowers/auditoria-aislamiento-0010.md. Si cambias algo de aquí,
-- actualiza también esa tabla: es lo que le permite al siguiente revisor comprobar cada decisión en
-- vez de confiar en que alguien miró.
--
-- LO QUE ESTE ARCHIVO NO HACE, Y NO ES UN OLVIDO: no reabre `enable_signup` ni construye la página
-- de registro. Eso es el paso 3 y el 4 del spec, y el 4 no se hace antes que este archivo esté
-- aplicado y auditado -- abrir el registro con el aislamiento a medias es publicar la
-- vulnerabilidad.
--
-- Repetible a propósito: esta migración se aplica a mano, pegada en el editor SQL del panel de
-- Supabase, y una aplicación que quedó a medias tiene que poder reintentarse. Mismo patrón que
-- 0003, 0004, 0005, 0006, 0007, 0008 y 0009.

-- ==========================================================================================
-- 1. EL EMBUDO: mi_agencia() y has_client_access()
-- ==========================================================================================
-- El spec lo mide y es la buena noticia del diseño: 40 de las 44 políticas pasan por una de tres
-- funciones. `has_client_access(uuid)` ya recibe el id de la marca, así que reescribirla aquí aísla
-- sus 23 sitios de llamada sin editar ni una de sus políticas -- incluidas las tres políticas del
-- bucket de adjuntos de 0002_storage.sql, que la llaman con la primera carpeta de la ruta.

-- La agencia del usuario actual. SECURITY DEFINER para leer `profiles` sin chocar con la RLS de la
-- propia tabla `profiles`: si no lo fuera, esta función se llamaría desde la política de `profiles`
-- que a su vez la llama, y Postgres cortaría con recursión infinita.
--
-- Devuelve NULL para un contacto de cliente, y ese NULL es deliberado: un contacto no pertenece a
-- ninguna agencia, se conecta por `client_contacts`. Toda comparación de abajo es de la forma
-- `columna = mi_agencia()`, que con NULL da NULL y por lo tanto NO autoriza. El nulo niega; nunca
-- lo conviertas en un `coalesce(..., algo)`.
create or replace function mi_agencia()
returns uuid language sql stable security definer set search_path = public as $$
  select agency_id from profiles where id = auth.uid();
$$;

-- Antes: "¿soy personal de agencia?" -- una pregunta que no mira la marca y que con dos agencias no
-- aísla nada. Ahora: "¿soy personal de agencia DE ESTA marca, o contacto de esta marca?".
--
-- LO QUE NO CAMBIA, Y ES EL MODELO DEL PRODUCTO: dentro de una misma agencia, cualquier usuario de
-- agencia sigue llegando a todas las marcas de su agencia. Eso está documentado como el modelo y no
-- es lo que este archivo viene a cerrar. Lo único que cambia es el caso entre agencias.
--
-- El contacto de cliente se resuelve por `client_contacts` y NO por `mi_agencia()`, y esa asimetría
-- es el caso de uso 5 del spec: un contacto puede serlo de marcas de dos agencias distintas
-- (`client_contacts` ya es una tabla de unión) y tiene que seguir viendo las dos. Si aquí le
-- pidieras además una agencia, ese contacto dejaría de ver todo: su `agency_id` es nulo por el check
-- de 0009.
create or replace function has_client_access(target_client_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from clients c
    where c.id = target_client_id
      and (
        (is_agency() and c.agency_id = mi_agencia())
        or exists (
          select 1 from client_contacts cc
          where cc.client_id = c.id and cc.profile_id = auth.uid()
        )
      )
  );
$$;

-- ==========================================================================================
-- 2. AYUDANTES DE PERTENENCIA
-- ==========================================================================================
-- Todos son SECURITY DEFINER, y no por comodidad: una política que consulta otra tabla aplica
-- también la RLS de esa otra tabla, así que una subconsulta a `content_pieces` o a
-- `google_calendar_connections` dentro de una política devolvería lo que el usuario puede ver en vez
-- de la verdad. Eso a veces falla cerrado (que es seguro pero confuso) y a veces se enreda con la
-- política que lo llamó. Con SECURITY DEFINER la pregunta se responde contra los datos reales y el
-- filtro lo pone la política, que es donde se lee.

/** La marca dueña de una pieza. NULL si la pieza no existe. */
create or replace function marca_de_pieza(p_content_piece_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select client_id from content_pieces where id = p_content_piece_id;
$$;

/** La marca dueña de una idea. NULL si la idea no existe. */
create or replace function marca_de_idea(p_idea_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select client_id from ideas where id = p_idea_id;
$$;

-- ¿Ese perfil es contacto de alguna marca de MI agencia? Es la otra mitad de quién puede ver un
-- perfil: el personal de agencia necesita ver a sus compañeros de equipo (que comparten
-- `agency_id`) y a los contactos de sus propias marcas (que no tienen agencia y se conectan por
-- `client_contacts`). Sin esta segunda mitad, la ficha de una marca dejaría de mostrar el nombre de
-- sus propios contactos.
create or replace function es_contacto_de_mi_agencia(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from client_contacts cc
    join clients c on c.id = cc.client_id
    where cc.profile_id = p_profile_id
      and c.agency_id = mi_agencia()
  );
$$;

-- Los dos ayudantes que preguntan por `google_calendar_connections.agency_id` y por
-- `webhook_configs.agency_id` NO están aquí: viven en la sección 4, detrás del `alter table` que crea
-- esas dos columnas. Postgres analiza el cuerpo de una función SQL al crearla, así que definirlos
-- antes revienta con "column g.agency_id does not exist".

-- ==========================================================================================
-- 3. `agencies` deja de ser una tabla muda
-- ==========================================================================================
-- 0009 dejó la tabla con RLS encendida y CERO políticas, es decir, denegando todo salvo a
-- `service_role`. Era la opción segura mientras no existiera `mi_agencia()`. Ahora sí existe, y el
-- personal de agencia necesita poder leer su propia fila (el nombre de la agencia sale en pantalla).
--
-- Lee sólo el personal de agencia, y sólo la suya. Un contacto de cliente no lee ninguna: su
-- `mi_agencia()` es nulo, `id = null` da nulo, y nulo no autoriza.
--
-- NO hay política de escritura, y tampoco es un olvido: la fila de la agencia la crea el alta
-- pública del paso 3, que será una función SECURITY DEFINER y por lo tanto no pasa por esta
-- política. Una política de INSERT aquí dejaría a cualquier sesión autenticada fabricar agencias.
drop policy if exists agencies_select on agencies;
create policy agencies_select on agencies for select using (
  is_agency() and id = mi_agencia()
);

-- ==========================================================================================
-- 4. LAS DOS TABLAS QUE NO TENÍAN DE QUIÉN SER
-- ==========================================================================================
-- `google_calendar_connections` y `webhook_configs` no cuelgan de una marca ni de una agencia: son
-- globales del sistema, porque el sistema era de una sola agencia. Sus políticas se resolvían con
-- `is_agency_admin()` a secas, y eso con dos agencias significa que el administrador de A lee el
-- `refresh_token` de Google de B y el `secret` con el que B firma sus webhooks. Son las dos fugas
-- más caras de este archivo, porque no filtran datos: filtran credenciales.
--
-- No hay forma de aislarlas sin darles dueño, así que se les agrega `agency_id`. La columna nace
-- anulable para que el backfill pueda correr, y termina `not null`.

alter table google_calendar_connections add column if not exists agency_id uuid references agencies (id);
alter table webhook_configs            add column if not exists agency_id uuid references agencies (id);

-- El default se fija DESPUÉS del add column porque `add column ... default mi_agencia()` reescribiría
-- la tabla entera evaluando la función una vez, mientras que un default puesto aparte sólo afecta a
-- las filas nuevas, que es lo que se busca.
--
-- Por qué un default y no un cambio en la app: las dos inserciones (app/api/google-calendar/callback
-- y saveWebhookConfig) corren con la sesión del usuario, así que la base puede deducir la agencia
-- sola. Deducirla es además más seguro que recibirla: un default no se puede falsificar desde el
-- navegador. El `with check` de las políticas de abajo rechaza de todos modos cualquier valor ajeno
-- que alguien mande a mano, así que hay dos controles y no uno.
alter table google_calendar_connections alter column agency_id set default mi_agencia();
alter table webhook_configs            alter column agency_id set default mi_agencia();

-- Backfill. La agencia sale de quien conectó o creó la fila; si esa pista no existe (columnas
-- anulables, y `webhook_configs.created_by` puede haber quedado nulo), cae a la única agencia que
-- haya. El `count(*) = 1` es lo que hace segura esa caída: con dos agencias ya no se adivina.
do $$
declare v_unica uuid;
begin
  update google_calendar_connections g
     set agency_id = p.agency_id
    from profiles p
   where p.id = g.connected_by and g.agency_id is null and p.agency_id is not null;

  update webhook_configs w
     set agency_id = p.agency_id
    from profiles p
   where p.id = w.created_by and w.agency_id is null and p.agency_id is not null;

  select id into v_unica from agencies limit 1;
  if v_unica is not null and (select count(*) from agencies) = 1 then
    update google_calendar_connections set agency_id = v_unica where agency_id is null;
    update webhook_configs            set agency_id = v_unica where agency_id is null;
  end if;
end;
$$;

-- El `not null` va detrás de una comprobación explícita para que, si quedaran filas huérfanas, el
-- error diga qué hacer en vez del "column contains null values" de Postgres. Si te salta: no
-- relajes la restricción, asigna a mano la agencia de esas filas. Una conexión de Google o un
-- webhook sin agencia no lo ve nadie (las políticas de abajo comparan contra `mi_agencia()`, y nulo
-- no autoriza), así que dejarlo pasar cambia una fuga por una desaparición silenciosa.
do $$
begin
  if exists (select 1 from google_calendar_connections where agency_id is null)
     or exists (select 1 from webhook_configs where agency_id is null) then
    raise exception 'Hay conexiones de Google o webhooks sin agencia. Asígnales una agencia a mano (update ... set agency_id = ... where agency_id is null) y vuelve a pegar este archivo.';
  end if;
end;
$$;

alter table google_calendar_connections alter column agency_id set not null;
alter table webhook_configs            alter column agency_id set not null;

create index if not exists idx_gcal_conn_agency on google_calendar_connections (agency_id);
create index if not exists idx_webhook_configs_agency on webhook_configs (agency_id);

-- Los dos ayudantes que faltaban de la sección 2. Van aquí y no allá porque Postgres analiza el
-- cuerpo de una función SQL al crearla y las columnas de arriba tienen que existir antes.

/** ¿Esa conexión de Google Calendar es de mi agencia? NULL o inexistente responde falso. */
create or replace function conexion_de_mi_agencia(p_connection_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from google_calendar_connections g
    where g.id = p_connection_id and g.agency_id = mi_agencia()
  );
$$;

/** ¿Ese webhook es de mi agencia? NULL o inexistente responde falso. */
create or replace function webhook_de_mi_agencia(p_webhook_config_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from webhook_configs w
    where w.id = p_webhook_config_id and w.agency_id = mi_agencia()
  );
$$;

-- ==========================================================================================
-- 5. LAS POLÍTICAS, TABLA POR TABLA
-- ==========================================================================================
-- Se reescriben SÓLO las políticas cuya decisión dependía de `is_agency()` o `is_agency_admin()` a
-- secas. Las que ya pasaban por `has_client_access(...)` heredan el aislamiento del punto 1 sin
-- tocarlas, y tocarlas de más sería puro ruido en el diff. Cuáles son unas y cuáles otras está
-- escrito sitio por sitio en docs/superpowers/auditoria-aislamiento-0010.md.

-- --- profiles -------------------------------------------------------------------------------
-- `is_agency()` a secas dejaba que el personal de A leyera el nombre, el correo y el teléfono de
-- todo el personal de B y de todos sus contactos. Ahora: tu propia fila, tus compañeros de agencia,
-- y los contactos de las marcas de tu agencia.
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select using (
  id = auth.uid()
  or (is_agency() and agency_id = mi_agencia())
  or (is_agency() and es_contacto_de_mi_agencia(id))
);

-- Misma cuenta para el administrador: puede gestionar a los suyos, no a los de otra agencia. Sin
-- esto, el administrador de A podía cambiarle el nombre -- o borrar la fila -- a cualquier usuario
-- de B.
drop policy if exists profiles_admin_manage on profiles;
create policy profiles_admin_manage on profiles for all
  using (is_agency_admin() and (agency_id = mi_agencia() or es_contacto_de_mi_agencia(id)))
  with check (is_agency_admin() and (agency_id = mi_agencia() or es_contacto_de_mi_agencia(id)));

-- --- clients --------------------------------------------------------------------------------
-- `clients_select` ya usa `has_client_access(id)` y queda aislada por el punto 1: no se toca.
--
-- `clients_agency_write` sí, y es el caso que el spec señala como el más fácil de hacer mal: un
-- `with check` sobre una fila que se está creando NO puede preguntar `has_client_access(...)` por
-- esa fila, porque la fila todavía no existe y la función la busca en la tabla. Lo que hay que
-- acotar es el `agency_id` que ENTRA. Ese `with check` es además lo que impide que alguien cree una
-- marca directamente dentro de otra agencia -- que sería ponerle un pie dentro sin romper ninguna
-- política de lectura.
drop policy if exists clients_agency_write on clients;
create policy clients_agency_write on clients for all
  using (is_agency() and agency_id = mi_agencia())
  with check (is_agency() and agency_id = mi_agencia());

-- --- client_assignments / client_contacts ---------------------------------------------------
-- El patrón que se repite de aquí en adelante es `is_agency() and has_client_access(client_id)`, y
-- el `is_agency()` NO sobra aunque `has_client_access()` ya lo contenga en una de sus dos ramas:
-- sin él, la otra rama (ser contacto de la marca) abriría estas tablas a los contactos de cliente,
-- que hoy no las ven. Esto es aislamiento, no un ensanche de permisos.
drop policy if exists client_assignments_select on client_assignments;
create policy client_assignments_select on client_assignments for select using (
  is_agency() and has_client_access(client_id)
);

drop policy if exists client_assignments_write on client_assignments;
create policy client_assignments_write on client_assignments for all
  using (is_agency() and has_client_access(client_id))
  with check (is_agency() and has_client_access(client_id));

drop policy if exists client_contacts_select on client_contacts;
create policy client_contacts_select on client_contacts for select using (
  (is_agency() and has_client_access(client_id))
  or profile_id = auth.uid()
);

drop policy if exists client_contacts_write on client_contacts;
create policy client_contacts_write on client_contacts for all
  using (is_agency() and has_client_access(client_id))
  with check (is_agency() and has_client_access(client_id));

-- --- content_pieces --------------------------------------------------------------------------
-- `content_pieces_select` ya pasa por `has_client_access(client_id)`: hereda, no se toca.
--
-- Las tres de escritura no: decidían con `is_agency()` a secas, así que el personal de A podía
-- crear, editar y borrar piezas de cualquier marca de B. Aquí el `with check` del insert SÍ puede
-- usar `has_client_access(client_id)`, y la diferencia con `clients` es concreta: la marca a la que
-- apunta la fila nueva ya existe (`client_id` es una clave ajena), así que hay una fila que mirar.
drop policy if exists content_pieces_agency_write on content_pieces;
create policy content_pieces_agency_write on content_pieces for insert with check (
  is_agency() and has_client_access(client_id)
);

drop policy if exists content_pieces_agency_update on content_pieces;
create policy content_pieces_agency_update on content_pieces for update
  using (is_agency() and has_client_access(client_id))
  with check (is_agency() and has_client_access(client_id));

drop policy if exists content_pieces_agency_delete on content_pieces;
create policy content_pieces_agency_delete on content_pieces for delete using (
  is_agency() and has_client_access(client_id)
);

-- --- attachments -------------------------------------------------------------------------------
-- `attachments_select` y `attachments_agency_write` ya derivan la marca de la pieza y preguntan por
-- `has_client_access(...)`: heredan.
--
-- `attachments_agency_delete` era la excepción y la más dañina de las tres: `is_agency()` a secas
-- dejaba que el personal de A borrara los adjuntos de cualquier pieza de B. 0003 ya le había puesto
-- el `and has_client_access(...)` anotando que ese día no cambiaba la decisión y que estaba ahí
-- "para que un futuro acotamiento de has_client_access() alcance también al borrado". Hoy es ese
-- futuro, así que esta política se deja tal cual 0003 la escribió y sólo se anota por qué ya basta.
--
-- (Se vuelve a crear igual, con `marca_de_pieza()` en vez de la subconsulta, para que el borrado no
-- dependa de la RLS de `content_pieces` al resolver de qué marca es la pieza.)
drop policy if exists attachments_agency_delete on attachments;
create policy attachments_agency_delete on attachments for delete using (
  is_agency() and has_client_access(marca_de_pieza(content_piece_id))
);

-- --- google calendar ---------------------------------------------------------------------------
-- La conexión guarda `access_token` y `refresh_token` de Google. Con `is_agency_admin()` a secas,
-- el administrador de A se los leía a B y podía escribir en su calendario.
drop policy if exists gcal_conn_admin on google_calendar_connections;
create policy gcal_conn_admin on google_calendar_connections for all
  using (is_agency_admin() and agency_id = mi_agencia())
  with check (is_agency_admin() and agency_id = mi_agencia());

-- El mapeo cuelga de una marca, así que se acota por la marca. Y además por la conexión: sin la
-- segunda mitad, la agencia A podría mapear SU marca al calendario de B y terminar escribiendo
-- eventos en el calendario de Google de otra agencia -- una fuga que sale del producto y llega a un
-- servicio de terceros.
drop policy if exists gcal_map_admin on client_calendar_mappings;
create policy gcal_map_admin on client_calendar_mappings for all
  using (is_agency() and has_client_access(client_id))
  with check (
    is_agency() and has_client_access(client_id) and conexion_de_mi_agencia(connection_id)
  );

drop policy if exists gcal_map_select on client_calendar_mappings;
create policy gcal_map_select on client_calendar_mappings for select using (
  is_agency() and has_client_access(client_id)
);

drop policy if exists event_links_agency on calendar_event_links;
create policy event_links_agency on calendar_event_links for select using (
  is_agency() and has_client_access(marca_de_pieza(content_piece_id))
);

-- --- webhooks ----------------------------------------------------------------------------------
-- `webhook_configs.secret` es la clave con la que se firma el payload que sale hacia Make. Leerla es
-- poder falsificar eventos de otra agencia contra su propio receptor.
drop policy if exists webhook_configs_admin on webhook_configs;
create policy webhook_configs_admin on webhook_configs for all
  using (is_agency_admin() and agency_id = mi_agencia())
  with check (is_agency_admin() and agency_id = mi_agencia());

-- El envío guarda el payload completo de la pieza: título, copy, estado y marca. Se acota por el
-- webhook que lo originó. `webhook_config_id` es anulable (la columna no es `not null` en 0001), y
-- una entrega sin webhook no la ve nadie: `webhook_de_mi_agencia(null)` es falso. Es lo correcto --
-- sin webhook no hay agencia de la que deducir el dueño, y en la duda no se enseña.
drop policy if exists webhook_deliveries_admin on webhook_deliveries;
create policy webhook_deliveries_admin on webhook_deliveries for select using (
  is_agency_admin() and webhook_de_mi_agencia(webhook_config_id)
);

-- --- notification_settings ---------------------------------------------------------------------
-- El `select` ya pasa por `has_client_access(client_id)`: hereda. El `for all` no.
drop policy if exists notification_settings_write on notification_settings;
create policy notification_settings_write on notification_settings for all
  using (is_agency() and has_client_access(client_id))
  with check (is_agency() and has_client_access(client_id));

-- --- ideas / idea_status_history ---------------------------------------------------------------
-- `ideas_select` tiene dos ramas y sólo cambia la primera. La segunda -- el contacto de cliente, que
-- sólo ve la idea a partir de 'pendiente_cliente' -- se mantiene palabra por palabra: es el punto
-- central del diseño del panel de ideas (el cliente no ve lo que el equipo descartó) y no tiene nada
-- que ver con las agencias.
--
-- 0005 anotaba que `has_client_access()` "NO sirve acá" porque devolvía verdadero para cualquier
-- usuario de agencia y no distinguía agencia de contacto. Sigue sin servir SOLA por ese motivo --
-- por eso la rama de agencia se escribe `is_agency() and has_client_access(...)` y la rama del
-- contacto conserva su `exists` explícito sobre `client_contacts`. Lo que cambió es que ahora
-- `has_client_access()` sí mira la marca, que es la mitad que faltaba.
drop policy if exists ideas_select on ideas;
create policy ideas_select on ideas for select using (
  (is_agency() and has_client_access(ideas.client_id))
  or (
    exists (
      select 1 from client_contacts
      where client_id = ideas.client_id and profile_id = auth.uid()
    )
    and status in ('pendiente_cliente', 'correccion_cliente', 'aprobada', 'convertida')
  )
);

drop policy if exists ideas_agency_write on ideas;
create policy ideas_agency_write on ideas for insert with check (
  is_agency() and has_client_access(client_id)
);

drop policy if exists ideas_agency_update on ideas;
create policy ideas_agency_update on ideas for update
  using (is_agency() and has_client_access(client_id))
  with check (is_agency() and has_client_access(client_id));

drop policy if exists ideas_agency_delete on ideas;
create policy ideas_agency_delete on ideas for delete using (
  is_agency() and has_client_access(client_id)
);

-- El historial se sigue filtrando por transición y no por idea, por lo que documenta 0005: "puedo
-- ver esta idea" no es la misma pregunta que "esta fila era para mí". Lo único que cambia es la rama
-- de agencia, que ahora pasa por la marca de la idea.
drop policy if exists idea_history_select on idea_status_history;
create policy idea_history_select on idea_status_history for select using (
  (is_agency() and has_client_access(marca_de_idea(idea_status_history.idea_id)))
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

-- --- client_packages ----------------------------------------------------------------------------
-- 0006 dejó escrito "no 'simplifiques' esto de vuelta a has_client_access(): ese cambio haría que un
-- contacto de cualquier marca leyera el paquete de todas". Sigue valiendo y por eso la rama del
-- contacto se queda con su `exists` explícito. La rama de agencia sí se acota.
drop policy if exists client_packages_select on client_packages;
create policy client_packages_select on client_packages for select using (
  (is_agency() and has_client_access(client_packages.client_id))
  or exists (
    select 1 from client_contacts
    where client_id = client_packages.client_id and profile_id = auth.uid()
  )
);

drop policy if exists client_packages_agency_insert on client_packages;
create policy client_packages_agency_insert on client_packages for insert with check (
  is_agency() and has_client_access(client_id)
);

drop policy if exists client_packages_agency_update on client_packages;
create policy client_packages_agency_update on client_packages for update
  using (is_agency() and has_client_access(client_id))
  with check (is_agency() and has_client_access(client_id));

drop policy if exists client_packages_agency_delete on client_packages;
create policy client_packages_agency_delete on client_packages for delete using (
  is_agency() and has_client_access(client_id)
);

-- ==========================================================================================
-- 6. LAS FUNCIONES DE TRANSICIÓN
-- ==========================================================================================
-- Una función SECURITY DEFINER corre con los privilegios de su dueño, así que la RLS de las
-- políticas de arriba NO la frena: lo único que decide es el `if` que la propia función escribe. Una
-- que compruebe "el llamador es personal de agencia" y después escriba una fila concreta tiene que
-- comprobar además que esa fila es de su agencia -- si no, el aislamiento de las políticas se
-- esquiva llamando a la RPC en vez de escribiendo la tabla, que es una llamada HTTP igual de fácil.
--
-- ORDEN DE LAS COMPROBACIONES: la de pertenencia va DESPUÉS de la de existencia y ANTES de las de
-- estado. Ponerla antes cambiaría el mensaje de "la idea no existe" por uno de autorización y
-- rompería pruebas que afirman ese texto; ponerla después de las de estado filtraría, por el mensaje
-- de error, en qué estado está una pieza de otra agencia.

create or replace function submit_for_review(p_content_piece_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old content_status; v_client uuid;
begin
  select status, client_id into v_old, v_client from content_pieces where id = p_content_piece_id;
  if not is_agency() then raise exception 'No autorizado'; end if;
  -- Lo nuevo. `has_client_access(null)` es falso, así que una pieza inexistente también rebota aquí
  -- en vez de romper más abajo con un error de clave ajena.
  if not has_client_access(v_client) then raise exception 'No autorizado'; end if;
  update content_pieces set status = 'pendiente_revision' where id = p_content_piece_id;
  insert into status_history (content_piece_id, from_status, to_status, changed_by)
    values (p_content_piece_id, v_old, 'pendiente_revision', auth.uid());
  insert into notifications (profile_id, content_piece_id, type, title, body)
    select profile_id, p_content_piece_id, 'pendiente_revision', 'Nuevo contenido para revisar',
           'Tienes una pieza pendiente de revisión.'
    from client_contacts where client_id = v_client;
end;
$$;

-- Las cuatro de abajo ni siquiera leían la marca de la pieza: miraban `is_agency()` y escribían. Hay
-- que leerla para poder compararla, así que cada una gana un `client_id` en su `select`.

create or replace function mark_scheduled(p_content_piece_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old content_status; v_client uuid;
begin
  if not is_agency() then raise exception 'No autorizado'; end if;
  select status, client_id into v_old, v_client from content_pieces where id = p_content_piece_id;
  if not has_client_access(v_client) then raise exception 'No autorizado'; end if;
  if v_old <> 'aprobado' then raise exception 'Solo piezas aprobadas pueden programarse'; end if;
  update content_pieces set status = 'programado' where id = p_content_piece_id;
  insert into status_history (content_piece_id, from_status, to_status, changed_by)
    values (p_content_piece_id, v_old, 'programado', auth.uid());
end;
$$;

create or replace function mark_published(p_content_piece_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old content_status; v_client uuid;
begin
  if not is_agency() then raise exception 'No autorizado'; end if;
  select status, client_id into v_old, v_client from content_pieces where id = p_content_piece_id;
  if not has_client_access(v_client) then raise exception 'No autorizado'; end if;
  update content_pieces set status = 'publicado' where id = p_content_piece_id;
  insert into status_history (content_piece_id, from_status, to_status, changed_by)
    values (p_content_piece_id, v_old, 'publicado', auth.uid());
end;
$$;

create or replace function cancel_content_piece(p_content_piece_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old content_status; v_client uuid;
begin
  if not is_agency() then raise exception 'No autorizado'; end if;
  select status, client_id into v_old, v_client from content_pieces where id = p_content_piece_id;
  if not has_client_access(v_client) then raise exception 'No autorizado'; end if;
  update content_pieces set status = 'cancelado', cancelled_reason = p_reason where id = p_content_piece_id;
  insert into status_history (content_piece_id, from_status, to_status, changed_by, note)
    values (p_content_piece_id, v_old, 'cancelado', auth.uid(), p_reason);
end;
$$;

create or replace function reschedule_content_piece(p_content_piece_id uuid, p_new_scheduled_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare v_client uuid;
begin
  if not is_agency() then raise exception 'No autorizado'; end if;
  select client_id into v_client from content_pieces where id = p_content_piece_id;
  if not has_client_access(v_client) then raise exception 'No autorizado'; end if;
  update content_pieces set scheduled_at = p_new_scheduled_at where id = p_content_piece_id;
  insert into status_history (content_piece_id, from_status, to_status, changed_by, note)
    select id, status, status, auth.uid(), 'Fecha reprogramada'
    from content_pieces where id = p_content_piece_id;
end;
$$;

-- `approve_content_piece` y `request_changes` NO se tocan: ya preguntan `has_client_access(v_client)`
-- y encima exigen estar en `client_contacts` de esa marca. Las dos quedan aisladas por el punto 1.

-- --- ideas ----------------------------------------------------------------------------------------

create or replace function submit_idea_to_client(p_idea_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old idea_status; v_client uuid;
begin
  select status, client_id into v_old, v_client from ideas where id = p_idea_id;
  if not is_agency_admin() then raise exception 'Solo un administrador de agencia puede enviarla al cliente'; end if;
  if v_client is null then raise exception 'La idea no existe'; end if;
  if not has_client_access(v_client) then raise exception 'La idea es de otra agencia'; end if;
  if v_old <> 'propuesta' then raise exception 'Solo una idea en propuesta se puede enviar al cliente'; end if;

  update ideas set status = 'pendiente_cliente' where id = p_idea_id;
  insert into idea_status_history (idea_id, from_status, to_status, changed_by)
    values (p_idea_id, v_old, 'pendiente_cliente', auth.uid());
  insert into notifications (profile_id, idea_id, type, title, body)
    select profile_id, p_idea_id, 'idea_pendiente', 'Una idea espera tu revisión', null
    from client_contacts where client_id = v_client;
end;
$$;

-- Esta ganó un `client_id` en el `select`: antes sólo leía el estado y el autor, así que no tenía
-- con qué comparar la agencia.
create or replace function request_idea_internal_changes(p_idea_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old idea_status; v_created_by uuid; v_client uuid;
begin
  select status, created_by, client_id into v_old, v_created_by, v_client from ideas where id = p_idea_id;
  if not is_agency_admin() then raise exception 'Solo un administrador de agencia puede pedir corrección interna'; end if;
  if v_old is null then raise exception 'La idea no existe'; end if;
  if not has_client_access(v_client) then raise exception 'La idea es de otra agencia'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Pedir corrección exige una nota'; end if;
  if v_old <> 'propuesta' then raise exception 'Solo una idea en propuesta se puede devolver al autor'; end if;

  update ideas set status = 'correccion_interna' where id = p_idea_id;
  insert into idea_status_history (idea_id, from_status, to_status, changed_by, note)
    values (p_idea_id, v_old, 'correccion_interna', auth.uid(), p_note);
  -- Igual que en 0005: la contraparte de esta transición es el autor de la idea, no un contacto de
  -- cliente. Sin esto el autor no se entera de que le pidieron corregir.
  if v_created_by is not null then
    insert into notifications (profile_id, idea_id, type, title, body)
      values (v_created_by, p_idea_id, 'idea_correccion_interna', 'La agencia pidió corregir tu idea', p_note);
  end if;
end;
$$;

-- `discard_idea` tenía la forma `is_agency() or (contacto de la marca)`, que es exactamente lo que
-- `has_client_access()` responde ahora -- con la mitad de la agencia ya acotada. Se sustituye la
-- expresión entera por la llamada, que además deja una sola definición de "quién alcanza esta marca"
-- en vez de dos que hay que mantener de acuerdo.
create or replace function discard_idea(p_idea_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old idea_status; v_client uuid; v_created_by uuid;
begin
  select status, client_id, created_by into v_old, v_client, v_created_by from ideas where id = p_idea_id;
  -- El orden de estas dos está al revés que en 0005 a propósito: allí la comprobación de permiso era
  -- `is_agency() or (contacto)`, que para un usuario de agencia pasaba aunque la idea no existiera, y
  -- el mensaje que salía era 'La idea no existe'. Ahora `has_client_access(null)` es falso, así que
  -- si se dejara primero, una idea inexistente respondería 'No autorizado' y se perdería ese mensaje.
  if v_client is null then raise exception 'La idea no existe'; end if;
  if not has_client_access(v_client) then raise exception 'No autorizado'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Descartar exige un motivo'; end if;
  if v_old = 'convertida' then raise exception 'Una idea ya convertida en pieza no se descarta'; end if;

  update ideas set status = 'descartada' where id = p_idea_id;
  insert into idea_status_history (idea_id, from_status, to_status, changed_by, note)
    values (p_idea_id, v_old, 'descartada', auth.uid(), p_reason);

  -- Se notifica sólo al autor de la idea, nunca a los contactos de cliente de la marca, por lo que
  -- documenta 0005: avisar a los contactos revelaría por la puerta de atrás una idea en 'propuesta'
  -- o 'correccion_interna' que el cliente nunca debió saber que existió.
  if v_created_by is not null and v_created_by <> auth.uid() then
    insert into notifications (profile_id, idea_id, type, title, body)
      values (v_created_by, p_idea_id, 'idea_descartada', 'Descartaron tu idea', p_reason);
  end if;
end;
$$;

create or replace function resubmit_idea(p_idea_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old idea_status; v_new idea_status; v_client uuid;
begin
  select status, client_id into v_old, v_client from ideas where id = p_idea_id;
  if not is_agency() then raise exception 'Solo la agencia puede reenviar una idea'; end if;
  if v_client is null then raise exception 'La idea no existe'; end if;
  if not has_client_access(v_client) then raise exception 'La idea es de otra agencia'; end if;

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

-- La que el spec señala con nombre y apellido. Ya comparaba que la idea y la pieza fueran de la
-- misma marca; lo que le faltaba era comprobar que esa marca es tuya. Con la comprobación sobre la
-- idea basta: si la pieza es de la misma marca que la idea, y la marca de la idea es de tu agencia,
-- la pieza también lo es. Dejarlo así -- una sola comprobación y esta frase -- en vez de repetirla
-- sobre la pieza evita que un día alguien "arregle" una de las dos y deje la otra sin tocar.
create or replace function convert_idea_to_piece(p_idea_id uuid, p_content_piece_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old idea_status; v_client_idea uuid; v_client_pieza uuid;
begin
  select status, client_id into v_old, v_client_idea from ideas where id = p_idea_id;
  if not is_agency() then raise exception 'Solo la agencia puede convertir una idea'; end if;
  if v_client_idea is null then raise exception 'La idea no existe'; end if;
  if not has_client_access(v_client_idea) then raise exception 'La idea es de otra agencia'; end if;
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

-- `approve_idea` y `request_idea_client_changes` NO se tocan: exigen estar en `client_contacts` de la
-- marca de la idea, que es una pertenencia por fila y no depende de la agencia. Un contacto de A no
-- está en los contactos de una marca de B, así que ya rebotan.

-- ==========================================================================================
-- 7. PRIVILEGIOS DE COLUMNA: ESTE BLOQUE SUSTITUYE AL DE 0009
-- ==========================================================================================
-- LEE ESTO ANTES DE TOCAR NADA DE AQUÍ, es la misma advertencia que trae 0009 corrida un archivo:
--
--   * El bloque revoca el privilegio de TABLA y lo devuelve columna por columna. Lo de la tabla es
--     necesario: Postgres resuelve el permiso como "privilegio de tabla OR privilegio de columna", y
--     Supabase le da a `authenticated` el de tabla sobre todo el schema public, así que revocar sólo
--     la columna se ejecuta sin error y no quita nada.
--
--   * Como la lista de columnas permitidas se calcula desde `pg_attribute`, una columna NUEVA nace
--     sin privilegio para `authenticated`. Este archivo agrega dos (`google_calendar_connections.
--     agency_id` y `webhook_configs.agency_id`), así que el bloque hay que reejecutarlo -- y este
--     archivo lo reejecuta él mismo. No vuelvas a pegar 0007 ni 0009.
--
--   * Este bloque SUSTITUYE al de 0009, que a su vez sustituía al de 0007. Volver a pegar cualquiera
--     de los dos DESPUÉS de este DESHACE las protecciones nuevas en silencio. Si algún día tienes
--     que reejecutar el endurecimiento de privilegios, reejecuta ESTE archivo. Y si agregas otra
--     columna protegida, agrégala aquí.
do $$
declare
  r record;
  v_columnas text;
begin
  for r in
    select * from (values
      -- Sin cambios respecto a 0009. Están aquí porque este bloque sustituye al de aquel archivo: si
      -- las quitaras de la lista, la reejecución devolvería el privilegio y el endurecimiento se
      -- caería sin que nada lo reportara.
      ('profiles',                     'update', array['role', 'agency_id']),
      ('clients',                      'update', array['agency_id']),
      ('content_pieces',               'insert', array['status']),
      ('content_pieces',               'update', array['status', 'client_id']),
      ('ideas',                        'insert', array['status']),
      ('ideas',                        'update', array['status', 'client_id', 'content_piece_id']),

      -- Nuevas. Mismo razonamiento que `clients.agency_id` en 0009: una conexión de Google o un
      -- webhook que se pueden mudar de agencia con un `update` convierten el aislamiento de la
      -- sección 5 en un trámite -- no hace falta romper la política, basta con llevarse la fila.
      --
      -- Sólo 'update': las dos columnas tienen `default mi_agencia()` y son `not null`, así que la
      -- fila nace con la agencia de quien la crea y el `with check` de su política rechaza cualquier
      -- otro valor que llegue en el insert. Es el mismo criterio con el que 0009 protege
      -- `clients.agency_id` en el update y no en el insert.
      ('google_calendar_connections',  'update', array['agency_id']),
      ('webhook_configs',              'update', array['agency_id'])
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
