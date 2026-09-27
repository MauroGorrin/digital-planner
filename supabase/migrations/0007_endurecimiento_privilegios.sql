-- Endurecimiento de privilegios: cierra CN-001, CN-002, CN-004, CN-008 (mitad de base de datos),
-- CN-015 y CN-016 de la auditoria de seguridad del 2026-09-27.
--
-- Repetible a proposito: esta migracion se aplica a mano, pegada en el editor SQL del panel de
-- Supabase, y una aplicacion que quedo a medias tiene que poder reintentarse. Mismo patron que
-- 0003, 0004, 0005 y 0006.
--
-- ==========================================================================================
-- EL MECANISMO, Y POR QUE ES ESTE Y NO UN TRIGGER
-- ==========================================================================================
-- Las 20 funciones de transicion de 0001 y 0005 son SECURITY DEFINER y pertenecen a `postgres`,
-- asi que corren con los privilegios de su dueno. Una escritura directa desde la app corre como
-- `authenticated` y solo tiene los privilegios de ese rol. Si le quitas a `authenticated` el
-- privilegio sobre una columna, queda exactamente la semantica que este producto necesita -- "esta
-- columna solo la mueven las RPC" -- sin tocar ni una linea de esas 20 funciones.
--
-- NO uses un trigger con `pg_trigger_depth() = 0` para conseguir lo mismo. Esa funcion mide el
-- anidamiento de triggers, no si la sentencia vino de una funcion: dentro de una funcion SECURITY
-- DEFINER tambien vale 0, asi que ese guard bloquearia las transiciones legitimas y romperia el
-- producto entero.
--
-- ==========================================================================================
-- POR QUE HAY QUE REVOCAR LA TABLA Y VOLVER A OTORGAR COLUMNA POR COLUMNA
-- ==========================================================================================
-- `revoke update (role) on profiles from authenticated` NO HACE NADA en este proyecto. Postgres
-- resuelve el permiso de columna como "privilegio de tabla OR privilegio de columna", y Supabase le
-- otorga a `authenticated` y `anon` el privilegio a nivel de TABLA sobre todo el schema public (lo
-- ves en pg_class.relacl: `authenticated=arwdDxt/postgres`). Mientras ese privilegio de tabla siga
-- ahi, revocar la columna se ejecuta sin error y no quita nada -- compruebalo tu mismo:
--
--   revoke update (role) on profiles from authenticated;
--   select has_column_privilege('authenticated','profiles','role','UPDATE');  --> sigue en true
--
-- Por eso el bloque de abajo quita el privilegio de la tabla y lo devuelve enseguida sobre todas
-- las columnas menos las protegidas. Es el mismo mecanismo y la misma intencion; lo unico que
-- cambia es que asi si surte efecto.
--
-- SI AGREGAS UNA COLUMNA NUEVA a profiles, content_pieces o ideas, vuelve a correr esta migracion:
-- la columna nueva nace sin el privilegio de columna y la app no podra escribirla hasta que el
-- bloque se reejecute y la incluya. Se calcula desde pg_attribute en vez de listarla a mano
-- justamente para que reejecutarlo alcance y nadie tenga que mantener una lista en dos sitios.
do $$
declare
  r record;
  v_columnas text;
begin
  for r in
    select * from (values
      -- CN-001: nadie se asciende a si mismo. `profiles.role` es la raiz de todo el modelo de
      -- autorizacion -- is_agency(), is_agency_admin() y has_client_access() se resuelven contra
      -- ella -- asi que una sola escritura a esta columna convierte a un contacto de cliente en
      -- administrador de agencia con acceso a todas las marcas. Lo pone `crearUsuario` con el cliente
      -- de servicio, que conserva el privilegio porque `service_role` no aparece en el revoke.
      ('profiles',       'update', array['role']),

      -- CN-004: el insert importa TANTO como el update. Sin revocar el insert, un miembro de
      -- agencia crea la pieza ya marcada 'aprobado' y es la misma falsificacion de la aprobacion
      -- del cliente con otro verbo, sin fila en status_history ni en approvals que la delate. Las
      -- dos columnas tienen default not null, asi que la app simplemente deja de mandarlas.
      ('content_pieces', 'insert', array['status']),
      -- `client_id` va aqui y no en el insert por lo obvio: una pieza tiene que nacer en una marca,
      -- lo que no puede es mudarse a otra despues (eso llevaria el contenido de una marca al panel
      -- de un cliente ajeno).
      ('content_pieces', 'update', array['status', 'client_id']),

      ('ideas',          'insert', array['status']),
      -- `content_piece_id` es el vinculo idea -> pieza que escribe convert_idea_to_piece(), y esa
      -- funcion es la que comprueba que idea y pieza sean de la misma marca. Escribirlo a mano
      -- saltaria esa comprobacion.
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

-- ==========================================================================================
-- CN-001 (segunda y tercera capa): trigger de guarda y politica explicita
-- ==========================================================================================
-- El privilegio de columna de arriba ya cierra el agujero. Esto es defensa en profundidad para el
-- dia en que alguien corra un `grant all on all tables in schema public to authenticated` -- una
-- linea que se copia de cualquier tutorial de Supabase -- y devuelva el privilegio sin darse
-- cuenta. Ese dia el trigger sigue en pie.
--
-- OJO, ESTO NO ES SECURITY DEFINER, Y ES A PROPOSITO: dentro de una funcion SECURITY DEFINER
-- `current_user` devuelve el DUENO de la funcion (`postgres`), nunca quien la llamo. Con
-- `security definer` esta comparacion valdria siempre 'postgres', 'postgres' esta en la lista de
-- exentos, y el guard no rechazaria nada jamas: seria un adorno. Sin `security definer`,
-- `current_user` es el rol real de la sesion (`authenticated`, `service_role`, `postgres`), que es
-- lo que hay que mirar. No le agregues `security definer` "por consistencia" con el resto del
-- archivo: lo convertirias en un no-op silencioso.
--
-- is_agency_admin() si es SECURITY DEFINER (0001_init.sql), asi que sigue pudiendo leer profiles
-- desde aqui sin que la RLS del llamador se interponga.
create or replace function guard_profile_role()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.role is distinct from old.role
     -- `crearUsuario` fija el rol con el cliente de servicio, donde auth.uid() es null y por lo tanto
     -- is_agency_admin() es false. Sin esta lista de roles exentos, invitar a un miembro de agencia
     -- fallaria.
     and current_user not in ('service_role', 'postgres', 'supabase_admin')
     and not is_agency_admin() then
    raise exception 'Solo un administrador de agencia puede cambiar el rol';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_guard_role on profiles;
create trigger trg_profiles_guard_role before update on profiles
  for each row execute function guard_profile_role();

-- La politica se ajusta para que la intencion se lea donde alguien lee las politicas. Sin
-- `with check`, Postgres reutiliza el `using` -- la fila actualizada solo tiene que seguir siendo
-- la tuya -- y eso no restringe ninguna columna. El `with check` no es el control que cierra el
-- agujero (lo cierra el privilegio de columna); esta para que quien lea esta linea no concluya que
-- cambiar tu propio rol estaba permitido.
drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select p.role from profiles p where p.id = auth.uid()));

-- ==========================================================================================
-- CN-002: la metadata de registro no decide un rol
-- ==========================================================================================
-- `raw_user_meta_data` se rellena verbatim desde el objeto `data` del endpoint PUBLICO de signup
-- (/auth/v1/signup, con la clave anon). Leer el rol de ahi significaba que una sola peticion HTTP
-- sin autenticar creaba un administrador de agencia. El rol se fija despues, desde `crearUsuario`,
-- que ya paso por requireAgencyAdmin() y escribe con el cliente de servicio.
--
-- Este cambio y el de app/admin-actions.ts:crearUsuario van juntos y no se pueden separar: si
-- cambias solo esta funcion, la invitacion deja de mandar el rol a ningun sitio y cada miembro de
-- agencia invitado se convierte en cliente sin que nadie lo note.
--
-- `full_name` se sigue leyendo de la metadata a proposito: es un dato de presentacion que el propio
-- usuario elige, no decide ningun permiso, y no hay otro sitio de donde sacarlo en ese momento.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.email, 'client');
  return new;
end;
$$;

-- ==========================================================================================
-- CN-015: las notificaciones de comentario dejan de perderse en silencio
-- ==========================================================================================
-- `notifications` no tiene politica de INSERT, asi que la RLS denegaba el insert que hacia
-- addComment, y como nadie comprobaba el error la notificacion nunca llegaba y nada lo reportaba.
--
-- La solucion NO es agregar una politica de INSERT: eso dejaria a cualquier usuario fabricar
-- notificaciones a nombre de quien quisiera. Los destinatarios se derivan aqui, en el servidor,
-- como ya hacen las demas transiciones. La app pasa solo la pieza y el texto; no elige a quien
-- notificar, porque si lo eligiera podria elegir a cualquiera.
create or replace function notify_comment(p_content_piece_id uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_autor text; v_es_cliente boolean;
begin
  select cp.client_id into v_client from content_pieces cp where cp.id = p_content_piece_id;
  if v_client is null then raise exception 'La pieza no existe'; end if;
  if not has_client_access(v_client) then raise exception 'No autorizado'; end if;

  select full_name, role = 'client' into v_autor, v_es_cliente from profiles where id = auth.uid();

  -- La contraparte, no todo el mundo: si comenta el cliente se avisa al equipo asignado a la marca
  -- (client_assignments); si comenta la agencia se avisa a los contactos de esa marca
  -- (client_contacts). Cada rama excluye a la otra con el mismo booleano, asi que nunca se avisa a
  -- los dos lados de un comentario.
  insert into notifications (profile_id, content_piece_id, type, title, body)
  select t.profile_id, p_content_piece_id, 'comentario',
         'Nuevo comentario de ' || coalesce(v_autor, 'alguien del equipo'), left(p_body, 140)
  from (
    select profile_id from client_assignments where client_id = v_client and v_es_cliente
    union
    select profile_id from client_contacts where client_id = v_client and not v_es_cliente
  ) t
  -- Nadie recibe la notificacion de su propio comentario. Pasa de verdad: un miembro de agencia
  -- puede estar en client_assignments de la marca sobre la que comenta.
  where t.profile_id <> auth.uid();
end;
$$;

-- ==========================================================================================
-- CN-016: la ruta de un adjunto pertenece a la marca de su pieza
-- ==========================================================================================
-- Los adjuntos viven en storage bajo `<client_id>/…` y las politicas del bucket autorizan por esa
-- primera carpeta. Si la fila de `attachments` puede declarar una carpeta que no es la de su pieza,
-- un usuario de agencia registra un adjunto apuntando a la carpeta de OTRA marca y el contacto de
-- la marca de la pieza termina con permiso de lectura sobre un archivo ajeno.
create or replace function guard_attachment_path()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_carpeta text; v_marca_de_la_pieza uuid;
begin
  v_carpeta := split_part(new.file_path, '/', 1);

  -- Se valida la forma ANTES de castear. Con el cast a pelo, una ruta como 'foto.jpg' reventaria
  -- con el 22P02 de Postgres ("invalid input syntax for type uuid"), un mensaje en ingles sobre
  -- sintaxis que no le dice a nadie cual es la regla que incumplio.
  if v_carpeta !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'La ruta del adjunto tiene que empezar con el uuid de la marca de la pieza';
  end if;

  select client_id into v_marca_de_la_pieza from content_pieces where id = new.content_piece_id;
  if v_marca_de_la_pieza is null then
    raise exception 'La pieza del adjunto no existe';
  end if;
  if v_carpeta::uuid <> v_marca_de_la_pieza then
    raise exception 'El adjunto apunta a la carpeta de otra marca';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_attachments_guard_path on attachments;
create trigger trg_attachments_guard_path before insert or update on attachments
  for each row execute function guard_attachment_path();

-- ==========================================================================================
-- CN-008 (mitad de base de datos): reference_link tiene que ser http(s)
-- ==========================================================================================
-- El enlace se pinta en un href. React escapa el texto, asi que no hay XSS por interpolacion, pero
-- un href 'javascript:…' ejecuta al hacer clic y ningun escape lo evita. La validacion vive aqui,
-- en la base, porque el enlace entra por tres caminos distintos (el formulario de pieza, el de idea
-- y las Server Actions, que son endpoints HTTP) y un control por camino se olvida en el cuarto.
--
-- SE AGREGA `not valid` A PROPOSITO: asi restringe toda escritura nueva sin validar las filas que
-- ya estan. Esta migracion se pega a mano en el editor SQL del panel de Supabase, y una que
-- reventara a mitad del pegado por un enlace legado deja el resto del archivo sin aplicar -- que es
-- peor que una restriccion que solo mira hacia adelante. Si algun dia quieres validar el historico,
-- corre `alter table … validate constraint …` aparte y arregla lo que salte.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'content_pieces_reference_link_http_check'
  ) then
    alter table content_pieces
      add constraint content_pieces_reference_link_http_check
      check (reference_link is null or reference_link ~* '^https?://') not valid;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ideas_reference_link_http_check'
  ) then
    alter table ideas
      add constraint ideas_reference_link_http_check
      check (reference_link is null or reference_link ~* '^https?://') not valid;
  end if;
end;
$$;
