import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Corre contra la Supabase LOCAL de `npm run test:integration`, nunca contra un proyecto remoto.
//
// Archivo autocontenido: monta sus DOS agencias propias (no reutiliza la del backfill ni la de
// otras suites) porque el criterio 5 del spec exige probar que el personal de una agencia no puede
// tocar una pieza de otra, y eso necesita una segunda agencia real, no una marca sin dueño.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SERVICE) {
  throw new Error(
    'Faltan credenciales de Supabase local. Corre `npm run test:integration`, que ejecuta ' +
      'scripts/write-supabase-test-env.mjs antes de Vitest.'
  );
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const PASSWORD = 'contrasena-de-prueba-1234';
const sufijo = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function crearUsuario(email: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  return data.user.id;
}

async function sesionDe(email: string): Promise<SupabaseClient> {
  const cliente = createClient(URL!, ANON!, { auth: { persistSession: false } });
  const { error } = await cliente.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return cliente;
}

async function insertar(tabla: string, fila: Record<string, unknown>): Promise<string> {
  const { data, error } = await admin.from(tabla).insert(fila).select('id').single();
  if (error) throw new Error(`No se pudo insertar en ${tabla}: ${error.message}`);
  return (data as { id: string }).id;
}

function enUnDia() {
  return new Date(Date.now() + 86_400_000).toISOString();
}

async function crearPieza(clientId: string, status: string, overrides: Record<string, unknown> = {}) {
  return insertar('content_pieces', {
    client_id: clientId,
    platform: 'instagram',
    format: 'post',
    title: `Pieza ${status} ${Math.random().toString(36).slice(2)}`,
    copy_text: '',
    scheduled_at: enUnDia(),
    status,
    ...overrides,
  });
}

async function estadoDeLaPieza(id: string) {
  const { data } = await admin.from('content_pieces').select('status').eq('id', id).single();
  return data?.status as string;
}

async function historial(pieceId: string, to: string) {
  const { data } = await admin
    .from('status_history')
    .select('id, note')
    .eq('content_piece_id', pieceId)
    .eq('to_status', to);
  return data ?? [];
}

async function notificacionesDe(profileId: string, type: string) {
  const { data } = await admin
    .from('notifications')
    .select('id, content_piece_id, body')
    .eq('profile_id', profileId)
    .eq('type', type);
  return data ?? [];
}

const ids = {
  agenciaA: '',
  agenciaB: '',
  adminA: '',
  adminA2: '',
  miembroA: '',
  adminB: '',
  // Contacto de marcaA. Existe para las pruebas de 0014_endurecer_revision_interna.sql: la RLS de
  // content_pieces_select/status_history_select y la comprobación de estado de
  // approve_content_piece necesitan un cliente real, no solo personal de agencia.
  contactoA: '',
  marcaA: '',
};
const correos = {
  adminA: `revint-adminA-${sufijo}@prueba.local`,
  adminA2: `revint-adminA2-${sufijo}@prueba.local`,
  miembroA: `revint-miembroA-${sufijo}@prueba.local`,
  adminB: `revint-adminB-${sufijo}@prueba.local`,
  contactoA: `revint-contactoA-${sufijo}@prueba.local`,
};

beforeAll(async () => {
  ids.agenciaA = await insertar('agencies', { name: `Revisión interna A ${sufijo}` });
  ids.agenciaB = await insertar('agencies', { name: `Revisión interna B ${sufijo}` });

  ids.adminA = await crearUsuario(correos.adminA);
  // adminA2 existe SOLO para la prueba 9: es admin de la MISMA agencia que adminA, pero no está
  // asignado a marcaA, y no debe recibir la notificación de "nueva pieza para revisión interna".
  ids.adminA2 = await crearUsuario(correos.adminA2);
  ids.miembroA = await crearUsuario(correos.miembroA);
  ids.adminB = await crearUsuario(correos.adminB);
  ids.contactoA = await crearUsuario(correos.contactoA);

  for (const [id, role, agencyId] of [
    [ids.adminA, 'agency_admin', ids.agenciaA],
    [ids.adminA2, 'agency_admin', ids.agenciaA],
    [ids.miembroA, 'agency_member', ids.agenciaA],
    [ids.adminB, 'agency_admin', ids.agenciaB],
  ] as const) {
    const { error } = await admin.from('profiles').update({ role, agency_id: agencyId }).eq('id', id);
    if (error) throw error;
  }
  // contactoA se queda con el rol por defecto que le da handle_new_user() ('client', sin agencia):
  // es justo el perfil que necesita has_client_access() para resolver la rama de contacto y no la
  // de agencia.

  ids.marcaA = await insertar('clients', {
    name: `Marca A ${sufijo}`,
    brand_name: 'Marca A',
    timezone: 'America/Mexico_City',
    agency_id: ids.agenciaA,
    created_by: ids.adminA,
  });

  // adminA queda asignado a marcaA; adminA2 NO -- es justo la asimetría que prueba el caso 9 (un
  // agency_admin no necesita estar en client_assignments: 0016 le da acceso a toda su agencia
  // igual). miembroA SÍ necesita la fila -- a diferencia de un admin, un agency_member solo
  // accede a las marcas que tiene asignadas, y este archivo lo usa para enviar a revisión interna,
  // aprobarla y pedir cambios sobre marcaA de principio a fin.
  await insertar('client_assignments', { client_id: ids.marcaA, profile_id: ids.adminA });
  await insertar('client_assignments', { client_id: ids.marcaA, profile_id: ids.miembroA });
  await insertar('client_contacts', { client_id: ids.marcaA, profile_id: ids.contactoA });
});

afterAll(async () => {
  if (ids.marcaA) await admin.from('clients').delete().eq('id', ids.marcaA);
  for (const id of [ids.adminA, ids.adminA2, ids.miembroA, ids.adminB, ids.contactoA]) {
    if (id) await admin.auth.admin.deleteUser(id);
  }
  const agencias = [ids.agenciaA, ids.agenciaB].filter(Boolean);
  if (agencias.length > 0) await admin.from('agencies').delete().in('id', agencias);
});

describe('submit_for_internal_review', () => {
  it('un agency_member puede enviar un borrador a revisión interna', async () => {
    const pieza = await crearPieza(ids.marcaA, 'borrador');
    const miembro = await sesionDe(correos.miembroA);

    const { error } = await miembro.rpc('submit_for_internal_review', { p_content_piece_id: pieza });

    expect(error).toBeNull();
    expect(await estadoDeLaPieza(pieza)).toBe('pendiente_revision_interna');
    expect(await historial(pieza, 'pendiente_revision_interna')).toHaveLength(1);
  });

  it('rechaza si la pieza no está en borrador', async () => {
    const pieza = await crearPieza(ids.marcaA, 'pendiente_revision');
    const miembro = await sesionDe(correos.miembroA);

    const { error } = await miembro.rpc('submit_for_internal_review', { p_content_piece_id: pieza });

    expect(error?.message).toMatch(/borrador/i);
    expect(await estadoDeLaPieza(pieza)).toBe('pendiente_revision');
  });

  it('notifica solo a los agency_admin ASIGNADOS a esa marca, no a todos los admins de la agencia', async () => {
    const pieza = await crearPieza(ids.marcaA, 'borrador');
    const miembro = await sesionDe(correos.miembroA);

    const { error } = await miembro.rpc('submit_for_internal_review', { p_content_piece_id: pieza });
    expect(error).toBeNull();

    const notisAdminA = await notificacionesDe(ids.adminA, 'pendiente_revision_interna');
    const notisAdminA2 = await notificacionesDe(ids.adminA2, 'pendiente_revision_interna');
    expect(notisAdminA.some((n) => n.content_piece_id === pieza)).toBe(true);
    expect(notisAdminA2.some((n) => n.content_piece_id === pieza)).toBe(false);
  });

  it('el personal de OTRA agencia no puede enviarla a revisión interna, acierte o no el UUID', async () => {
    const pieza = await crearPieza(ids.marcaA, 'borrador');
    const adminDeB = await sesionDe(correos.adminB);

    const { error } = await adminDeB.rpc('submit_for_internal_review', { p_content_piece_id: pieza });

    expect(error).not.toBeNull();
    expect(await estadoDeLaPieza(pieza)).toBe('borrador');
  });
});

describe('approve_internal_review', () => {
  it('un agency_member NO puede aprobar', async () => {
    const pieza = await crearPieza(ids.marcaA, 'pendiente_revision_interna');
    const miembro = await sesionDe(correos.miembroA);

    const { error } = await miembro.rpc('approve_internal_review', { p_content_piece_id: pieza });

    expect(error?.message).toMatch(/administrador/i);
    expect(await estadoDeLaPieza(pieza)).toBe('pendiente_revision_interna');
  });

  it('un agency_admin sí puede aprobar, y la pieza pasa a pendiente_revision', async () => {
    const pieza = await crearPieza(ids.marcaA, 'pendiente_revision_interna');
    const admin_ = await sesionDe(correos.adminA);

    const { error } = await admin_.rpc('approve_internal_review', { p_content_piece_id: pieza });

    expect(error).toBeNull();
    expect(await estadoDeLaPieza(pieza)).toBe('pendiente_revision');
    expect(await historial(pieza, 'pendiente_revision')).toHaveLength(1);
  });

  it('rechaza si la pieza no está en pendiente_revision_interna', async () => {
    const pieza = await crearPieza(ids.marcaA, 'borrador');
    const admin_ = await sesionDe(correos.adminA);

    const { error } = await admin_.rpc('approve_internal_review', { p_content_piece_id: pieza });

    expect(error?.message).toMatch(/revisión interna/i);
  });

  it('el admin de OTRA agencia no puede aprobar, aunque sea agency_admin', async () => {
    const pieza = await crearPieza(ids.marcaA, 'pendiente_revision_interna');
    const adminDeB = await sesionDe(correos.adminB);

    const { error } = await adminDeB.rpc('approve_internal_review', { p_content_piece_id: pieza });

    expect(error).not.toBeNull();
    expect(await estadoDeLaPieza(pieza)).toBe('pendiente_revision_interna');
  });
});

describe('request_internal_changes', () => {
  it('un agency_member NO puede pedir corrección interna', async () => {
    const pieza = await crearPieza(ids.marcaA, 'pendiente_revision_interna');
    const miembro = await sesionDe(correos.miembroA);

    const { error } = await miembro.rpc('request_internal_changes', { p_content_piece_id: pieza, p_note: 'Cambia esto' });

    expect(error?.message).toMatch(/administrador/i);
  });

  it('un agency_admin puede pedir corrección con nota, y la pieza vuelve a borrador', async () => {
    const pieza = await crearPieza(ids.marcaA, 'pendiente_revision_interna', { assignee_id: ids.miembroA });
    const admin_ = await sesionDe(correos.adminA);

    const { error } = await admin_.rpc('request_internal_changes', { p_content_piece_id: pieza, p_note: 'Cambia la fecha' });

    expect(error).toBeNull();
    expect(await estadoDeLaPieza(pieza)).toBe('borrador');
    const filas = await historial(pieza, 'borrador');
    expect(filas).toHaveLength(1);
    expect(filas[0].note).toBe('Cambia la fecha');
  });

  it('sin nota (vacía o solo espacios) rechaza', async () => {
    const pieza = await crearPieza(ids.marcaA, 'pendiente_revision_interna');
    const admin_ = await sesionDe(correos.adminA);

    const vacia = await admin_.rpc('request_internal_changes', { p_content_piece_id: pieza, p_note: '' });
    expect(vacia.error?.message).toMatch(/nota/i);

    const espacios = await admin_.rpc('request_internal_changes', { p_content_piece_id: pieza, p_note: '   ' });
    expect(espacios.error?.message).toMatch(/nota/i);
  });

  it('rechaza si la pieza no está en pendiente_revision_interna', async () => {
    const pieza = await crearPieza(ids.marcaA, 'borrador');
    const admin_ = await sesionDe(correos.adminA);

    const { error } = await admin_.rpc('request_internal_changes', { p_content_piece_id: pieza, p_note: 'Algo' });

    expect(error?.message).toMatch(/revisión interna/i);
  });

  it('notifica al responsable interno (assignee_id) si tiene uno', async () => {
    const pieza = await crearPieza(ids.marcaA, 'pendiente_revision_interna', { assignee_id: ids.miembroA, created_by: ids.adminA });
    const admin_ = await sesionDe(correos.adminA);

    const { error } = await admin_.rpc('request_internal_changes', { p_content_piece_id: pieza, p_note: 'Corrige el copy' });
    expect(error).toBeNull();

    const notis = await notificacionesDe(ids.miembroA, 'correccion_interna_solicitada');
    expect(notis.some((n) => n.content_piece_id === pieza && n.body === 'Corrige el copy')).toBe(true);
  });

  it('sin responsable interno, notifica a quien creó la pieza', async () => {
    const pieza = await crearPieza(ids.marcaA, 'pendiente_revision_interna', { assignee_id: null, created_by: ids.miembroA });
    const admin_ = await sesionDe(correos.adminA);

    const { error } = await admin_.rpc('request_internal_changes', { p_content_piece_id: pieza, p_note: 'Falta el link' });
    expect(error).toBeNull();

    const notis = await notificacionesDe(ids.miembroA, 'correccion_interna_solicitada');
    expect(notis.some((n) => n.content_piece_id === pieza && n.body === 'Falta el link')).toBe(true);
  });

  it('el admin de OTRA agencia no puede pedir corrección', async () => {
    const pieza = await crearPieza(ids.marcaA, 'pendiente_revision_interna');
    const adminDeB = await sesionDe(correos.adminB);

    const { error } = await adminDeB.rpc('request_internal_changes', { p_content_piece_id: pieza, p_note: 'Algo' });

    expect(error).not.toBeNull();
    expect(await estadoDeLaPieza(pieza)).toBe('pendiente_revision_interna');
  });
});

describe('submit_for_review (sin cambios) tras un rechazo del cliente', () => {
  it('un agency_member reenvía sin pasar de nuevo por un agency_admin', async () => {
    const pieza = await crearPieza(ids.marcaA, 'cambios_solicitados');
    const miembro = await sesionDe(correos.miembroA);

    const { error } = await miembro.rpc('submit_for_review', { p_content_piece_id: pieza });

    expect(error).toBeNull();
    expect(await estadoDeLaPieza(pieza)).toBe('pendiente_revision');
  });
});

// ==================================================================================================
// 0014_endurecer_revision_interna.sql -- lo que encontró la revisión final cruzada de las 5 tareas:
// el gate se podía esquivar por completo. Las pruebas de abajo son las que faltaban.
// ==================================================================================================

describe('submit_for_review ya NO es un bypass del gate (0014, hallazgo 2)', () => {
  it('rechaza si la pieza está en borrador -- ya no manda al cliente sin pasar por revisión interna', async () => {
    const pieza = await crearPieza(ids.marcaA, 'borrador');
    const miembro = await sesionDe(correos.miembroA);

    const { error } = await miembro.rpc('submit_for_review', { p_content_piece_id: pieza });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/cambios solicitados/i);
    expect(await estadoDeLaPieza(pieza)).toBe('borrador');
  });

  it('rechaza si la pieza está en pendiente_revision_interna', async () => {
    const pieza = await crearPieza(ids.marcaA, 'pendiente_revision_interna');
    const miembro = await sesionDe(correos.miembroA);

    const { error } = await miembro.rpc('submit_for_review', { p_content_piece_id: pieza });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/cambios solicitados/i);
    expect(await estadoDeLaPieza(pieza)).toBe('pendiente_revision_interna');
  });
});

describe('RLS: un contacto de cliente no ve la revisión interna (0014, hallazgo 3)', () => {
  it('un select normal sobre content_pieces no devuelve una pieza en pendiente_revision_interna', async () => {
    const pieza = await crearPieza(ids.marcaA, 'pendiente_revision_interna');
    const contacto = await sesionDe(correos.contactoA);

    const { data, error } = await contacto.from('content_pieces').select('id').eq('id', pieza);

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it('no ve ninguna fila de status_history hacia o desde pendiente_revision_interna', async () => {
    const pieza = await crearPieza(ids.marcaA, 'borrador');
    const miembro = await sesionDe(correos.miembroA);
    const adminSesion = await sesionDe(correos.adminA);

    // borrador -> pendiente_revision_interna -> borrador (con nota de corrección interna): las dos
    // filas de historial que un contacto de cliente nunca debería poder leer.
    const { error: errorEnvio } = await miembro.rpc('submit_for_internal_review', { p_content_piece_id: pieza });
    expect(errorEnvio).toBeNull();
    const { error: errorCorreccion } = await adminSesion.rpc('request_internal_changes', {
      p_content_piece_id: pieza,
      p_note: 'Corrige el tono antes de mandarla',
    });
    expect(errorCorreccion).toBeNull();

    const contacto = await sesionDe(correos.contactoA);
    const { data, error } = await contacto
      .from('status_history')
      .select('id, from_status, to_status')
      .eq('content_piece_id', pieza);

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it('sigue viendo la pieza en cuanto pasa a pendiente_revision -- el arreglo no se pasó de amplio', async () => {
    const pieza = await crearPieza(ids.marcaA, 'pendiente_revision');
    const contacto = await sesionDe(correos.contactoA);

    const { data, error } = await contacto.from('content_pieces').select('id, status').eq('id', pieza);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0].status).toBe('pendiente_revision');
  });
});

describe('approve_content_piece exige pendiente_revision (0014, hallazgo 4)', () => {
  it('un contacto de cliente no puede aprobar una pieza todavía en revisión interna, aunque acierte el UUID', async () => {
    const pieza = await crearPieza(ids.marcaA, 'pendiente_revision_interna');
    const contacto = await sesionDe(correos.contactoA);

    // Esta prueba importa aparte de las de RLS de arriba: una función SECURITY DEFINER no pasa por
    // las políticas de SELECT, así que "no la ve en una lista" y "no puede aprobarla por RPC" son
    // dos capas distintas, y las dos tienen que estar cerradas.
    const { error } = await contacto.rpc('approve_content_piece', { p_content_piece_id: pieza, p_note: 'ok' });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/pendiente de revisión/i);
    expect(await estadoDeLaPieza(pieza)).toBe('pendiente_revision_interna');
  });
});

describe('secuencia completa borrador -> revisión interna -> revisión de cliente -> aprobado (0014, hallazgo 5)', () => {
  it('recorre las tres transiciones reales contra Postgres y termina aprobada por el cliente', async () => {
    const pieza = await crearPieza(ids.marcaA, 'borrador');
    const miembro = await sesionDe(correos.miembroA);
    const adminSesion = await sesionDe(correos.adminA);
    const contacto = await sesionDe(correos.contactoA);

    const { error: errorEnvio } = await miembro.rpc('submit_for_internal_review', { p_content_piece_id: pieza });
    expect(errorEnvio).toBeNull();
    expect(await estadoDeLaPieza(pieza)).toBe('pendiente_revision_interna');

    const { error: errorAprobacionInterna } = await adminSesion.rpc('approve_internal_review', {
      p_content_piece_id: pieza,
    });
    expect(errorAprobacionInterna).toBeNull();
    expect(await estadoDeLaPieza(pieza)).toBe('pendiente_revision');

    // Criterio de aceptación 3 del spec: approve_internal_review notifica a los contactos del
    // cliente con el mismo evento "nuevo contenido para revisar" que usa submit_for_review -- hasta
    // ahora solo se afirmaba indirectamente vía estado/historial, nunca vía la notificación misma.
    const notisCliente = await notificacionesDe(ids.contactoA, 'pendiente_revision');
    expect(notisCliente.some((n) => n.content_piece_id === pieza)).toBe(true);

    const { error: errorAprobacionCliente } = await contacto.rpc('approve_content_piece', {
      p_content_piece_id: pieza,
      p_note: 'Se ve bien',
    });
    expect(errorAprobacionCliente).toBeNull();
    expect(await estadoDeLaPieza(pieza)).toBe('aprobado');
  });
});
