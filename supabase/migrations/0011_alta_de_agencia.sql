-- El alta de agencia. Es el paso 3 del spec
-- docs/superpowers/specs/2026-09-27-multi-agencia-y-registro.md: quien se registra por su cuenta
-- crea su agencia y queda como su administrador.
--
-- ESTE ARCHIVO NO CAMBIA EL ESQUEMA. Agrega una sola función y sus permisos. No hay columnas
-- nuevas y por lo tanto NO hay que volver a ejecutar el bloque de privilegios de columna de
-- 0010_aislamiento_por_agencia.sql -- que es justamente el bloque que nunca hay que re-pegar desde
-- una copia vieja. Si algún día este camino necesitara una columna nueva en `profiles`, el arreglo
-- es EXTENDER la lista del bloque de 0010 dentro de la migración nueva, nunca volver a pegar la de
-- 0009 ni la de 0007: cada una conoce menos columnas protegidas que la siguiente y re-pegarla
-- devuelve en silencio un privilegio que alguien quitó a propósito.
--
-- POR QUÉ NO SE AGREGARON `profiles.first_name` / `profiles.last_name`: el formulario pide nombre y
-- apellido por separado (es más fácil de llenar y de validar que un "nombre completo"), pero la app
-- no tiene ni una pantalla que los lea por separado -- las ~20 que muestran a una persona leen
-- `full_name`. Además `crearUsuario` (el alta por invitación, que seguirá siendo la mayoría de las
-- cuentas) sólo recoge un nombre completo, así que las dos columnas nacerían nulas en casi todas
-- las filas: una columna a medio llenar que nadie lee, a cambio de una tercera copia del bloque de
-- privilegios. `full_name` se compone en el alta ("nombre apellido") y se guarda ahí.
-- Lo que se pierde, dicho para que nadie lo descubra después: la frontera entre nombre y apellido
-- no se puede recuperar de `full_name` sin adivinar. El día que una pantalla necesite el apellido
-- suelto, las columnas se agregan y se vuelve a pedir el dato; hoy serían datos muertos.
--
-- Repetible a propósito: esta migración se aplica a mano, pegada en el editor SQL del panel de
-- Supabase, y una aplicación que quedó a medias tiene que poder reintentarse. Mismo patrón que
-- 0003 a 0010.

-- ==========================================================================================
-- 1. LA PROMOCIÓN: crear_mi_agencia()
-- ==========================================================================================
-- EL AGUJERO QUE ESTA FUNCIÓN EXISTE PARA NO REABRIR. `0007_endurecimiento_privilegios.sql` cerró
-- una vulnerabilidad crítica: `handle_new_user()` leía el rol de `raw_user_meta_data`, que el
-- endpoint PÚBLICO `/auth/v1/signup` rellena verbatim con lo que le manden. Una sola petición HTTP
-- sin autenticar te convertía en administrador de agencia DE TODO EL SISTEMA.
--
-- `handle_new_user()` sigue fijando 'client' a mano y NO SE TOCA en este archivo. Todo usuario nace
-- como cliente sin agencia, y la promoción a administrador pasa por aquí, donde sí se puede
-- comprobar quién la pide.
--
-- SOBRE LEER EL NOMBRE DE LA AGENCIA DE `raw_user_meta_data`, que es lo que hará dudar a quien lea
-- esto después de 0007: no es el mismo caso y la diferencia es exacta. Lo que hacía peligrosa
-- aquella lectura no era el campo, era QUÉ decidía el valor leído: un rol es la raíz del modelo de
-- autorización. Un NOMBRE no decide ningún permiso. Si alguien manda por ahí el nombre que quiera,
-- lo único que consigue es que su propia agencia recién creada -- vacía, sin marcas, sin piezas y
-- sin nadie más dentro -- se llame de otra forma. El rol y la agencia de esta función NO salen de
-- la metadata: el rol es una constante escrita abajo y la agencia es la fila que esta misma función
-- acaba de crear.
--
-- LAS PRECONDICIONES SE VUELVEN A COMPROBAR AQUÍ, y no es redundancia. La Server Action
-- `completarAltaDeAgencia` comprueba lo mismo antes de llamar, pero una Server Action es un
-- endpoint HTTP y sus comprobaciones son una comodidad de UX: el control es esto. Son tres, y cada
-- una responde a un caso distinto:
--
--   1. `role = 'client'`  -- quien ya es personal de agencia no se fabrica una segunda agencia.
--   2. `agency_id is null` -- lo mismo por la otra mitad del check `profiles_agency_id_rol_check`.
--   3. NO ser contacto de ninguna marca (`client_contacts`) -- ÉSTA ES LA QUE IMPORTA Y LA QUE NO
--      SE VE. Un contacto de cliente invitado por su agencia llega con EXACTAMENTE el mismo perfil
--      que alguien recién registrado: `role = 'client'` y `agency_id` nulo. La ÚNICA diferencia
--      entre los dos es que el invitado tiene fila en `client_contacts` y el recién registrado no.
--      Sin esta comprobación, el responsable de marketing de una marca podría llamar a esta función
--      y salir convertido en administrador de una agencia propia -- dejando de ser cliente de la
--      suya. No es una fuga de datos (la agencia nueva nace vacía), pero tampoco es suyo: se
--      llevaría por delante el acceso que su agencia le dio y las dos partes verían un cambio que
--      ninguna pidió. Si borras esta línea, todo sigue compilando y las demás pruebas siguen en
--      verde: por eso hay una prueba dedicada en tests/integration/alta-de-agencia.test.ts.
--
-- IDEMPOTENTE POR RECHAZO, no por reintento silencioso: llamarla dos veces falla la segunda, porque
-- después de la primera el rol ya no es 'client'. Eso es deliberado. Una función que "no hiciera
-- nada" la segunda vez tendría que decidir si devolver la agencia vieja o crear una nueva, y la
-- respuesta equivocada crea agencias vacías huérfanas que nadie vuelve a mirar.
--
-- TODO O NADA: el cuerpo de una función plpgsql corre dentro de una sola transacción, así que el
-- insert en `agencies` y el update de `profiles` se confirman juntos o no se confirma ninguno. Es
-- el criterio de aceptación 4 del spec.
--
-- EL ROL Y LA AGENCIA VAN EN EL MISMO UPDATE, y tampoco es estilo: el check
-- `profiles_agency_id_rol_check` de 0009 rechaza el estado intermedio "ya soy agency_admin pero
-- todavía no tengo agencia". Partirlo en dos escrituras rebota con 23514.
--
-- SECURITY DEFINER y el trigger `guard_profile_role()` de 0007: ese trigger NO es SECURITY DEFINER
-- a propósito, así que dentro de esta función `current_user` vale `postgres` (el dueño), que está
-- en su lista de roles exentos. Por eso el cambio de rol de abajo pasa. Es el mismo mecanismo por
-- el que `crearUsuario` puede fijar el rol con el cliente de servicio.
create or replace function crear_mi_agencia(p_nombre_agencia text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_rol       user_role;
  v_agencia   uuid;
  v_existe    boolean;
  v_meta      jsonb;
  v_nombre    text;
  v_telefono  text;
begin
  if v_uid is null then
    raise exception 'Necesitas haber iniciado sesión para crear tu agencia.';
  end if;

  select true, p.role, p.agency_id
    into v_existe, v_rol, v_agencia
    from profiles p
   where p.id = v_uid
     -- for update: bloquea la fila del perfil hasta el final de la transaccion. Sin esto, dos
     -- llamadas simultaneas (un doble clic, dos pestanas) pasan las dos las comprobaciones de abajo
     -- antes de que ninguna escriba, cada una crea su agencia, y queda una agencia huerfana sin
     -- nadie dentro. Con el bloqueo la segunda espera, relee el perfil ya promovido y rebota con
     -- "Tu cuenta ya pertenece a una agencia".
     for update;

  -- El perfil lo crea el trigger `handle_new_user()` en el mismo momento del alta, así que esto no
  -- debería pasar nunca. Se comprueba igual para que el fallo diga qué mirar en vez de salir como
  -- un "0 rows updated" que no reporta nada.
  if v_existe is not true then
    raise exception 'Tu perfil todavía no existe. Vuelve a entrar y reinténtalo.';
  end if;

  if v_rol <> 'client' or v_agencia is not null then
    raise exception 'Tu cuenta ya pertenece a una agencia.';
  end if;

  select exists (select 1 from client_contacts cc where cc.profile_id = v_uid) into v_existe;
  if v_existe then
    raise exception 'Tu cuenta es un contacto de cliente y no puede crear una agencia. Pídele a tu agencia que te dé de alta, o regístrate con otro correo.';
  end if;

  -- El nombre: primero el parámetro, después la metadata del alta. El parámetro NO es un permiso
  -- que se pueda pedir, es el mismo dato por otra vía -- existe para el alta a medio terminar
  -- (correo confirmado pero promoción nunca hecha, por ejemplo porque el alta se hizo con una
  -- versión vieja de la app), donde /bienvenida vuelve a preguntarlo en vez de dejar la cuenta en
  -- un callejón sin salida.
  select u.raw_user_meta_data into v_meta from auth.users u where u.id = v_uid;
  v_nombre := coalesce(
    nullif(btrim(p_nombre_agencia), ''),
    nullif(btrim(v_meta ->> 'agency_name'), '')
  );

  if v_nombre is null then
    raise exception 'Falta el nombre de tu agencia.';
  end if;
  if char_length(v_nombre) > 80 then
    raise exception 'El nombre de la agencia no puede pasar de 80 caracteres.';
  end if;

  -- El teléfono también viaja en la metadata y también es un dato de presentación: no decide
  -- ningún permiso. Se vuelve a comprobar su forma E.164 aquí porque el navegador no es un control
  -- y la Server Action tampoco es la última palabra. Si no la cumple se guarda nulo EN VEZ DE
  -- rechazar el alta entera: el teléfono es opcional en `profiles` y tirar abajo la promoción por
  -- él dejaría una cuenta con el correo ya confirmado y sin forma de avanzar, que es exactamente el
  -- callejón sin salida que este paso viene a evitar. La agencia sí se rechaza si falta el nombre,
  -- porque sin nombre no hay fila que crear.
  v_telefono := nullif(btrim(v_meta ->> 'phone'), '');
  if v_telefono is not null and v_telefono !~ '^\+[0-9]{8,15}$' then
    v_telefono := null;
  end if;

  insert into agencies (name) values (v_nombre) returning id into v_agencia;

  update profiles
     set role      = 'agency_admin',
         agency_id = v_agencia,
         phone     = coalesce(v_telefono, phone)
   where id = v_uid;

  return v_agencia;
end;
$$;

-- ==========================================================================================
-- 2. QUIÉN PUEDE LLAMARLA
-- ==========================================================================================
-- Postgres le da EXECUTE a `public` por omisión en toda función nueva, y `public` incluye a `anon`
-- -- el rol de una petición SIN sesión. La función ya se defiende sola (`auth.uid()` es nulo sin
-- sesión y aborta en la primera línea), pero dejarla llamable desde `anon` convierte un descuido
-- futuro en un endpoint público. Se revoca y se otorga sólo a `authenticated`.
--
-- `service_role` queda fuera a propósito: llamarla con el cliente de servicio no tendría sentido
-- (`auth.uid()` es nulo y aborta), y no darle el permiso evita que alguien lo intente y concluya
-- que la función está rota.
revoke all on function crear_mi_agencia(text) from public;
revoke all on function crear_mi_agencia(text) from anon;
grant execute on function crear_mi_agencia(text) to authenticated;
