-- 0016: un agency_member solo accede a las marcas que tiene asignadas (client_assignments).
-- Un agency_admin sigue viendo todas las de su agencia, igual que hoy.
--
-- Hasta aquí, `client_assignments` solo decidía a quién le llegaba una notificación
-- (0001/0005/0007/0013/0014): la visibilidad real la daba `has_client_access()`, que para
-- cualquier personal de agencia (admin o miembro) comparaba únicamente `agency_id = mi_agencia()`
-- -- cualquiera del equipo veía todas las marcas de su agencia, estuviera o no asignado. 0003 ya
-- dejó anotado, en `attachments_agency_delete`, que ese `and has_client_access(...)` estaba puesto
-- "para que un futuro acotamiento de has_client_access() alcance también al borrado". Este es ese
-- futuro: el cambio vive en un solo sitio porque el propio diseño de 0010 lo dejó así a propósito
-- -- 40 de sus 44 usos de `is_agency()` ya pasan por `has_client_access(client_id)`, en lectura y
-- en escritura (content_pieces, attachments, comments, ideas, client_packages, notification_settings,
-- client_calendar_mappings, client_assignments, client_contacts) -- así que tocar esta única función
-- los endurece a todos a la vez, sin tocar ni una de esas políticas.
create or replace function has_client_access(target_client_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from clients c
    where c.id = target_client_id
      and (
        (is_agency_admin() and c.agency_id = mi_agencia())
        or (
          is_agency() and not is_agency_admin() and c.agency_id = mi_agencia()
          and exists (
            select 1 from client_assignments ca
            where ca.client_id = c.id and ca.profile_id = auth.uid()
          )
        )
        or exists (
          select 1 from client_contacts cc
          where cc.client_id = c.id and cc.profile_id = auth.uid()
        )
      )
  );
$$;

-- `clients_agency_write` es la única excepción documentada en 0010 a "todo pasa por
-- has_client_access()": el `with check` de un INSERT no puede preguntar por una fila que todavía
-- no existe, así que se comparaba solo `agency_id = mi_agencia()` -- y por ser una sola política
-- `for all`, esa comparación suelta regía TAMBIÉN el update y el delete de una marca ya existente,
-- dejando que cualquier miembro de agencia archivara o editara una marca que no tiene asignada. Se
-- parte en tres, igual que ya está partido content_pieces: el insert se queda con la comparación de
-- agencia (crear una marca nueva no es una acción que haya que asignar antes de hacerla -- por eso
-- además pasa a ser solo de administrador, ver el código de la app), y el update/delete sí preguntan
-- por la marca concreta.
drop policy if exists clients_agency_write on clients;

create policy clients_agency_insert on clients for insert
  with check (is_agency_admin() and agency_id = mi_agencia());

create policy clients_agency_update on clients for update
  using (is_agency() and has_client_access(id))
  with check (is_agency() and agency_id = mi_agencia());

create policy clients_agency_delete on clients for delete using (
  is_agency() and has_client_access(id)
);
