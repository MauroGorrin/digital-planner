-- Cambiarle el nombre a la agencia. `agencies.name` se fija en el alta (`crear_mi_agencia()`, 0011)
-- y la única agencia que existía antes nació del backfill de 0009 como 'Agencia', a la espera de
-- "la pantalla para hacerlo" que anunciaba aquel comentario. Esta es esa pantalla, por la base.
--
-- ESTE ARCHIVO NO CAMBIA EL ESQUEMA. Agrega una sola función y sus permisos. No hay columnas nuevas
-- y por lo tanto NO hay que volver a ejecutar el bloque de privilegios de columna de
-- 0010_aislamiento_por_agencia.sql.
--
-- Repetible a propósito: esta migración se aplica a mano, pegada en el editor SQL del panel de
-- Supabase, y una aplicación que quedó a medias tiene que poder reintentarse. Mismo patrón que
-- 0003 a 0011.

-- ==========================================================================================
-- 1. POR QUÉ UNA FUNCIÓN Y NO UNA POLÍTICA DE UPDATE
-- ==========================================================================================
-- `agencies` tiene RLS con una sola política, la de lectura (`agencies_select`, 0010), y NINGUNA de
-- escritura. Eso se queda así, y no por pereza:
--
--   - `agencies` NO está en el bloque de privilegios de columna de 0010. `authenticated` conserva el
--     UPDATE de tabla sobre TODAS sus columnas. Una política `for update using (id = mi_agencia())`
--     acota QUÉ FILA, pero no QUÉ COLUMNA: el administrador podría escribir `id`, `created_at`,
--     `updated_at` o cualquier columna que se le agregue mañana a la tabla, con sólo mandarla en el
--     cuerpo del PATCH. `id` es la clave a la que apuntan `profiles.agency_id`, `clients.agency_id`,
--     las conexiones de Google y los webhooks; tocarla es romper la agencia entera.
--   - Arreglarlo con privilegios de columna obligaría a meter `agencies` en ese bloque, que es
--     justamente el que CLAUDE.md pide no volver a pegar desde una copia vieja. Más superficie para
--     equivocarse que para acertar.
--
-- Esta función escribe UNA columna con nombre (`name`) de UNA fila que ella misma deduce
-- (`mi_agencia()`). Nada de lo que mande el navegador puede ensancharla: no hay columna que elegir y
-- no hay fila que elegir.
--
-- LA AGENCIA NO ES UN PARÁMETRO, y es la decisión que más importa de este archivo. Un
-- `p_agencia uuid` sería un id que el navegador puede cambiar por el de otra agencia, y entonces la
-- función tendría que volver a comprobar que es la suya -- es decir, recalcular `mi_agencia()` y
-- comparar. Sin parámetro, esa comparación no se puede olvidar porque no existe: la fila destino
-- ES `mi_agencia()`.
--
-- LA REGLA 9 DE CLAUDE.md (nunca `is_agency_admin()` a secas): aquí `is_agency_admin()` responde
-- "¿puedes renombrar?" -- un `agency_member` no puede -- y `where id = mi_agencia()` responde
-- "¿cuál?". Las dos mitades están, y la fila está en
-- docs/superpowers/auditoria-aislamiento-0010.md.
--
-- LA VALIDACIÓN ES LA MISMA QUE LA DEL ALTA, a propósito: recortar con `btrim`, no vacío, y como
-- mucho 80 caracteres, con los mismos mensajes que `crear_mi_agencia()` en 0011 y el mismo tope que
-- `LARGO_MAXIMO_DE_AGENCIA` en lib/validacion-registro.ts. Si un día cambia el tope, cambia en los
-- tres sitios: una agencia no puede nacer con un nombre que después no se le deja volver a poner.
-- La Server Action valida antes con `validarNombreDeAgencia()` para que el error salga junto al
-- campo, pero el control es esto: una Server Action es un endpoint HTTP y el navegador no es un
-- control.
--
-- SECURITY DEFINER porque `agencies` no tiene política de escritura: corriendo como quien llama,
-- el update no tocaría ninguna fila. Corre como el dueño, que salta la RLS, y por eso cada
-- comprobación de abajo es la que autoriza, no una comodidad.
create or replace function renombrar_mi_agencia(p_nombre text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agencia uuid := mi_agencia();
  v_nombre  text := nullif(btrim(p_nombre), '');
begin
  -- `v_agencia is null` es redundante con el check `profiles_agency_id_rol_check` de 0009 (un
  -- `agency_admin` siempre tiene agencia), y se comprueba igual: si alguna vez dejara de ser
  -- redundante, `where id = null` no actualizaría nada y la función respondería "listo" sin haber
  -- hecho nada.
  if not is_agency_admin() or v_agencia is null then
    raise exception 'Solo el administrador de la agencia puede cambiarle el nombre.';
  end if;

  if v_nombre is null then
    raise exception 'Falta el nombre de tu agencia.';
  end if;
  if char_length(v_nombre) > 80 then
    raise exception 'El nombre de la agencia no puede pasar de 80 caracteres.';
  end if;

  -- Sólo `name`. `updated_at` lo pone el trigger `trg_agencies_updated` de 0009.
  update agencies set name = v_nombre where id = v_agencia;
end;
$$;

-- ==========================================================================================
-- 2. QUIÉN PUEDE LLAMARLA
-- ==========================================================================================
-- Postgres le da EXECUTE a `public` por omisión en toda función nueva, y `public` incluye a `anon`.
-- La función ya se defiende sola sin sesión (`mi_agencia()` es nulo y `is_agency_admin()` falso),
-- pero dejarla llamable desde `anon` convierte un descuido futuro en un endpoint público. Mismo
-- patrón que `crear_mi_agencia()` en 0011.
revoke all on function renombrar_mi_agencia(text) from public;
revoke all on function renombrar_mi_agencia(text) from anon;
grant execute on function renombrar_mi_agencia(text) to authenticated;
