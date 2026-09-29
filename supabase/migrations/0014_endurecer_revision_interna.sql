-- Endurecer la revisión interna: cierra el bypass del gate y la fuga de RLS que encontró la
-- revisión final cruzada de las 5 tareas de 0013_revision_interna.sql. Cada tarea individual se
-- aprobó por separado; esta revisión de todo el sub-proyecto junto encontró que el gate completo se
-- podía esquivar.
--
-- Hallazgos que cierra este archivo:
--
--   1. `submit_for_review` no comprobaba el estado de origen (`v_old`): funcionaba desde
--      CUALQUIER estado. La interfaz ya no ofrece el botón desde 'borrador', pero la RPC en sí no
--      imponía esa restricción -- una llamada directa (Server Action o RPC) desde 'borrador', o
--      incluso desde 'pendiente_revision_interna', mandaba la pieza al cliente sin que ningún
--      agency_admin la hubiera visto: el bypass completo del gate que 0013 vino a construir. Gana
--      la misma comprobación de estado que ya tienen las tres funciones nuevas de 0013, en la misma
--      posición del orden que documenta 0010 (existencia -> rol -> has_client_access(v_client) ->
--      estado): después de `has_client_access`, antes del `update`. A partir de aquí solo sirve
--      para el reenvío desde 'cambios_solicitados' -- que siempre fue la intención real del spec
--      (`2026-09-29-revision-interna-de-piezas-design.md`, sección "Diseño"). La frase "no se toca
--      submit_for_review" del plan de 0013 hablaba de no tocar su SQL sin motivo mientras se
--      construían las tres funciones nuevas, no de dejarla para siempre sin la comprobación de
--      estado que todas sus hermanas (`mark_scheduled`, las tres de 0013) sí tienen. Esa lectura
--      literal es la que reabre el agujero, y es la que este archivo cierra.
--
--   2. `content_pieces_select` y `status_history_select` no filtraban por estado en la rama del
--      CONTACTO de cliente -- a diferencia de `ideas_select`/`idea_history_select`, que sí
--      restringen al contacto por `status`. Un contacto de cliente podía ver una pieza en
--      'pendiente_revision_interna' (badge incluido) en su calendario, y leer en "Historial de
--      cambios" la nota de corrección interna que un admin le dejó a su equipo. Las dos políticas
--      se restructuran con la misma forma de dos ramas que ya usan `ideas_select`/
--      `idea_history_select`: la rama de agencia no cambia (sigue viendo todo, sin filtrar por
--      estado); la rama del contacto de cliente ahora excluye 'pendiente_revision_interna'. No se
--      toca la visibilidad de 'borrador' para el cliente -- es un comportamiento previo a este
--      sub-proyecto, fuera de alcance de este arreglo.
--
--   3. `approve_content_piece` y `request_changes` tampoco comprobaban el estado de origen. Aunque
--      el arreglo de RLS de arriba ya oculta una pieza en 'pendiente_revision_interna' de una
--      lista normal, un contacto de cliente que supiera o adivinara el UUID exacto (un enlace
--      viejo, por ejemplo) podía llamar la RPC directo y aprobarla o pedirle cambios sin que
--      pasara por revisión interna -- una función SECURITY DEFINER no pasa por las políticas de
--      SELECT, así que RLS sola no alcanza. Ganan la comprobación de que `v_old = 'pendiente_revision'`,
--      en la posición que ya usa `request_internal_changes` de 0013 para su propia comprobación de
--      estado: después de la comprobación de nota (cuando la hay), antes del `update`.
--
-- Igual que 0013, este archivo es repetible a propósito: `create or replace function` y
-- `drop policy if exists ...; create policy ...` son idempotentes, así que una aplicación a medias
-- se puede volver a pegar entera sin problema. Se aplica a mano en el panel de Supabase de
-- producción, pegando el archivo completo -- igual que las anteriores.

-- ==========================================================================================
-- 1. submit_for_review gana la comprobación de estado. Mismo cuerpo que 0010, con un `if` nuevo.
-- ==========================================================================================

create or replace function submit_for_review(p_content_piece_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old content_status; v_client uuid;
begin
  select status, client_id into v_old, v_client from content_pieces where id = p_content_piece_id;
  if not is_agency() then raise exception 'No autorizado'; end if;
  -- Lo nuevo. `has_client_access(null)` es falso, así que una pieza inexistente también rebota aquí
  -- en vez de romper más abajo con un error de clave ajena.
  if not has_client_access(v_client) then raise exception 'No autorizado'; end if;
  -- Lo nuevo de este archivo: a partir de aquí solo el reenvío tras cambios del cliente. Mandar una
  -- pieza al cliente desde 'borrador' (o desde 'pendiente_revision_interna') ahora solo es posible
  -- por el camino de dos pasos submit_for_internal_review -> approve_internal_review.
  if v_old <> 'cambios_solicitados' then
    raise exception 'Solo una pieza con cambios solicitados se puede reenviar a revisión.';
  end if;
  update content_pieces set status = 'pendiente_revision' where id = p_content_piece_id;
  insert into status_history (content_piece_id, from_status, to_status, changed_by)
    values (p_content_piece_id, v_old, 'pendiente_revision', auth.uid());
  insert into notifications (profile_id, content_piece_id, type, title, body)
    select profile_id, p_content_piece_id, 'pendiente_revision', 'Nuevo contenido para revisar',
           'Tienes una pieza pendiente de revisión.'
    from client_contacts where client_id = v_client;
end;
$$;

-- ==========================================================================================
-- 2. content_pieces_select / status_history_select: la rama del contacto de cliente deja de ver
-- 'pendiente_revision_interna'. Misma forma que ideas_select / idea_history_select
-- (0010_aislamiento_por_agencia.sql:399-409 y 429-444).
-- ==========================================================================================

drop policy if exists content_pieces_select on content_pieces;
create policy content_pieces_select on content_pieces for select using (
  (is_agency() and has_client_access(content_pieces.client_id))
  or (
    exists (
      select 1 from client_contacts
      where client_id = content_pieces.client_id and profile_id = auth.uid()
    )
    and status <> 'pendiente_revision_interna'
  )
);

drop policy if exists status_history_select on status_history;
create policy status_history_select on status_history for select using (
  (is_agency() and has_client_access(marca_de_pieza(status_history.content_piece_id)))
  or (
    exists (
      select 1 from content_pieces
      where content_pieces.id = status_history.content_piece_id
        and exists (
          select 1 from client_contacts
          where client_contacts.client_id = content_pieces.client_id
            and client_contacts.profile_id = auth.uid()
        )
    )
    and not (to_status = 'pendiente_revision_interna' or from_status = 'pendiente_revision_interna')
  )
);

-- ==========================================================================================
-- 3. approve_content_piece / request_changes ganan la comprobación de estado. Mismos cuerpos que
-- 0001_init.sql, con un `if` nuevo cada una, en la posición que ya usa request_internal_changes de
-- 0013: después de la comprobación de nota (cuando la hay), antes del update.
-- ==========================================================================================

create or replace function approve_content_piece(p_content_piece_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_old content_status; v_client uuid;
begin
  select status, client_id into v_old, v_client from content_pieces where id = p_content_piece_id;
  if not has_client_access(v_client) then raise exception 'No autorizado'; end if;
  if not exists (select 1 from client_contacts where client_id = v_client and profile_id = auth.uid()) then
    raise exception 'Solo el cliente puede aprobar';
  end if;
  -- Lo nuevo: sin esto, un contacto que adivinara o guardara el UUID de una pieza todavía en
  -- 'pendiente_revision_interna' (o en 'borrador') podía aprobarla directo por RPC, esquivando la
  -- revisión interna por completo -- RLS no protege dentro de una función SECURITY DEFINER.
  if v_old <> 'pendiente_revision' then raise exception 'Solo una pieza pendiente de revisión se puede aprobar.'; end if;
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
  -- Lo nuevo, misma razón que en approve_content_piece.
  if v_old <> 'pendiente_revision' then raise exception 'Solo una pieza pendiente de revisión admite pedir cambios.'; end if;
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
