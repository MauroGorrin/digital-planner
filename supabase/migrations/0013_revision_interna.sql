-- Revisión interna de piezas: un agency_admin aprueba antes de que la pieza llegue al cliente.
-- Mismo patrón que ya usa el panel de ideas (0005_ideas.sql: correccion_interna -> pendiente_cliente),
-- aplicado a content_pieces. No agrega ningún rol -- reutiliza agency_admin/agency_member.
--
-- Repetible a propósito: esta migración se aplica a mano, pegada en el editor SQL del panel de
-- Supabase, y una aplicación que quedó a medias tiene que poder reintentarse. Mismo patrón que
-- 0003 a 0012.

do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'pendiente_revision_interna'
      and enumtypid = 'content_status'::regtype
  ) then
    alter type content_status add value 'pendiente_revision_interna' after 'borrador';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'pieza_enviada_a_revision_interna'
      and enumtypid = 'webhook_event_type'::regtype
  ) then
    alter type webhook_event_type add value 'pieza_enviada_a_revision_interna';
  end if;
end;
$$;

-- ==========================================================================================
-- Las tres funciones. Mismo orden de comprobaciones que ya usa submit_for_review desde 0010:
-- existencia -> rol -> has_client_access(v_client) -> estado de origen. Saltarse ese orden, o esa
-- comprobación, reabre el agujero entre agencias que 0010 cerró -- ver su comentario en
-- 0010_aislamiento_por_agencia.sql:474-486.
-- ==========================================================================================

create or replace function submit_for_internal_review(p_content_piece_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old content_status; v_client uuid;
begin
  select status, client_id into v_old, v_client from content_pieces where id = p_content_piece_id;
  if not is_agency() then raise exception 'No autorizado'; end if;
  if not has_client_access(v_client) then raise exception 'No autorizado'; end if;
  if v_old <> 'borrador' then raise exception 'Solo un borrador se puede enviar a revisión interna'; end if;

  update content_pieces set status = 'pendiente_revision_interna' where id = p_content_piece_id;
  insert into status_history (content_piece_id, from_status, to_status, changed_by)
    values (p_content_piece_id, v_old, 'pendiente_revision_interna', auth.uid());
  -- Solo a quien lleva ESTA marca (client_assignments), no a todos los admins de la agencia.
  insert into notifications (profile_id, content_piece_id, type, title, body)
    select ca.profile_id, p_content_piece_id, 'pendiente_revision_interna', 'Nueva pieza para revisión interna',
           'Tienes una pieza esperando tu revisión antes de mandarla al cliente.'
    from client_assignments ca
    join profiles p on p.id = ca.profile_id
    where ca.client_id = v_client and p.role = 'agency_admin';
end;
$$;

create or replace function approve_internal_review(p_content_piece_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_old content_status; v_client uuid;
begin
  select status, client_id into v_old, v_client from content_pieces where id = p_content_piece_id;
  if not is_agency_admin() then raise exception 'Solo un administrador de agencia puede aprobar la revisión interna'; end if;
  if not has_client_access(v_client) then raise exception 'No autorizado'; end if;
  if v_old <> 'pendiente_revision_interna' then raise exception 'Solo una pieza en revisión interna se puede aprobar'; end if;

  update content_pieces set status = 'pendiente_revision' where id = p_content_piece_id;
  insert into status_history (content_piece_id, from_status, to_status, changed_by)
    values (p_content_piece_id, v_old, 'pendiente_revision', auth.uid());
  -- Mismo evento y mismo destinatario que submit_for_review: es el mismo momento semántico (el
  -- cliente se entera), solo que ahora se llega aquí después del visto bueno interno.
  insert into notifications (profile_id, content_piece_id, type, title, body)
    select profile_id, p_content_piece_id, 'pendiente_revision', 'Nuevo contenido para revisar',
           'Tienes una pieza pendiente de revisión.'
    from client_contacts where client_id = v_client;
end;
$$;

create or replace function request_internal_changes(p_content_piece_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_old content_status; v_client uuid; v_assignee uuid; v_created_by uuid;
begin
  select status, client_id, assignee_id, created_by into v_old, v_client, v_assignee, v_created_by
    from content_pieces where id = p_content_piece_id;
  if not is_agency_admin() then raise exception 'Solo un administrador de agencia puede pedir corrección interna'; end if;
  if not has_client_access(v_client) then raise exception 'No autorizado'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Pedir corrección exige una nota'; end if;
  if v_old <> 'pendiente_revision_interna' then raise exception 'Solo una pieza en revisión interna admite pedir corrección'; end if;

  update content_pieces set status = 'borrador' where id = p_content_piece_id;
  insert into status_history (content_piece_id, from_status, to_status, changed_by, note)
    values (p_content_piece_id, v_old, 'borrador', auth.uid(), p_note);
  -- Al responsable interno si tiene uno asignado; si no, a quien la creó.
  if coalesce(v_assignee, v_created_by) is not null then
    insert into notifications (profile_id, content_piece_id, type, title, body)
      values (coalesce(v_assignee, v_created_by), p_content_piece_id, 'correccion_interna_solicitada',
              'Te pidieron corregir una pieza', p_note);
  end if;
end;
$$;
