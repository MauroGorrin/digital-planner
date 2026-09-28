import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Corre contra la Supabase LOCAL de `npm run test:integration`, nunca contra un proyecto remoto.
//
// Esta suite cubre `0010_aislamiento_por_agencia.sql`, que es el paso 2 del spec
// docs/superpowers/specs/2026-09-27-multi-agencia-y-registro.md. El modo de fallo que persigue no es
// un error: es que la agencia A lea una fila de la agencia B en silencio, con el gate en verde. Por
// eso hay UNA PRUEBA POR TABLA con RLS y no un muestreo -- es la única forma de saber que no quedó
// una política sin convertir, y es repetitivo a propósito.
//
// CÓMO SE AFIRMA, Y POR QUÉ ASÍ: cada prueba de tabla comprueba dos cosas sobre las filas que
// DEVUELVE la consulta, nunca sobre un conteo. Que la fila de B no esté, que es el aislamiento; y
// que la fila propia de A sí esté, que es lo que impide que la prueba pase en verde contra una
// política que simplemente esconde todo. Una prueba que sólo contara filas no distinguiría
// "aislado" de "roto".
//
// LAS DOS AGENCIAS SON NUEVAS, ninguna es la del backfill de 0009. Así las afirmaciones pueden ser
// exactas ("el contacto doble ve exactamente estas dos marcas") sin que las marcas que crean las
// otras suites -- todas en la agencia del backfill -- se cuelen en el resultado.
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

/** insufficient_privilege / "new row violates row-level security policy". */
const RLS_RECHAZA = '42501';
/** raise_exception: el código de cualquier `raise exception` de plpgsql (los guards en español). */
const REGLA_DE_NEGOCIO = 'P0001';

interface Agencia {
  nombre: string;
  agencia: string;
  admin: string;
  miembro: string;
  contacto: string;
  correoAdmin: string;
  correoMiembro: string;
  correoContacto: string;
  marca: string;
  /** Segunda marca de la agencia, SIN nadie asignado. Sirve para la parte "dentro de una agencia
   *  sigue funcionando todo": un miembro tiene que llegar a ella igual. */
  marcaSinAsignar: string;
  pieza: string;
  adjunto: string;
  rutaAdjunto: string;
  comentario: string;
  historial: string;
  aprobacion: string;
  idea: string;
  historialIdea: string;
  notificacion: string;
  paquete: string;
  asignacion: string;
  contactoFila: string;
  conexion: string;
  mapeo: string;
  eventoCalendario: string;
  webhook: string;
  entrega: string;
  ajustesNotificacion: string;
}

const A = { nombre: 'A' } as Agencia;
const B = { nombre: 'B' } as Agencia;

/** Contacto de una marca de A y de una marca de B a la vez. El caso 5 del spec. */
const correoContactoDoble = `aisl-doble-${sufijo}@prueba.local`;
let idContactoDoble = '';

const sesiones: Record<string, SupabaseClient> = {};

async function crearUsuario(email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user.id;
}

async function sesionDe(email: string): Promise<SupabaseClient> {
  const cliente = createClient(URL!, ANON!, { auth: { persistSession: false } });
  const { error } = await cliente.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return cliente;
}

function enUnDia() {
  return new Date(Date.now() + 86_400_000).toISOString();
}

/** Inserta con el cliente de servicio, que salta la RLS, y devuelve el id de la fila. */
async function insertar(tabla: string, fila: Record<string, unknown>, clave = 'id'): Promise<string> {
  const { data, error } = await admin.from(tabla).insert(fila).select(clave).single();
  if (error) throw new Error(`No se pudo insertar en ${tabla}: ${error.message}`);
  // `from(tabla)` con un nombre de tabla dinámico deja a supabase-js sin tipo de fila, así que el
  // acceso por clave hay que declararlo a mano. Es el precio de recorrer las 19 tablas en una lista.
  return (data as unknown as Record<string, unknown>)[clave] as string;
}

async function subirObjeto(ruta: string) {
  const { error } = await admin.storage
    .from('attachments')
    .upload(ruta, new Blob(['contenido de prueba'], { type: 'image/png' }), { contentType: 'image/png' });
  if (error) throw error;
}

/**
 * Crea una agencia COMPLETA: administrador, miembro, contacto, dos marcas y una fila real en cada
 * una de las tablas con RLS. Se llama dos veces, para A y para B, con exactamente el mismo cuerpo:
 * las dos agencias tienen que ser simétricas o la prueba "A no ve a B" podría estar pasando porque
 * a B le falta la fila, no porque esté aislada.
 */
async function montarAgencia(f: Agencia) {
  const n = f.nombre;

  f.agencia = await insertar('agencies', { name: `Agencia ${n} ${sufijo}` });

  f.correoAdmin = `aisl-${n}-admin-${sufijo}@prueba.local`;
  f.correoMiembro = `aisl-${n}-miembro-${sufijo}@prueba.local`;
  f.correoContacto = `aisl-${n}-contacto-${sufijo}@prueba.local`;

  f.admin = await crearUsuario(f.correoAdmin);
  f.miembro = await crearUsuario(f.correoMiembro);
  f.contacto = await crearUsuario(f.correoContacto);

  // El rol y la agencia en el MISMO update: el check `profiles_agency_id_rol_check` de 0009 exige
  // que un rol de agencia traiga agencia, así que partirlo en dos escrituras rebota con 23514.
  for (const [id, role] of [
    [f.admin, 'agency_admin'],
    [f.miembro, 'agency_member'],
  ] as const) {
    const { error } = await admin.from('profiles').update({ role, agency_id: f.agencia }).eq('id', id);
    if (error) throw error;
  }

  f.marca = await insertar('clients', {
    name: `Marca ${n} ${sufijo}`,
    brand_name: `Marca ${n}`,
    timezone: 'America/Mexico_City',
    agency_id: f.agencia,
    created_by: f.admin,
  });
  f.marcaSinAsignar = await insertar('clients', {
    name: `Marca ${n} sin asignar ${sufijo}`,
    brand_name: `Marca ${n} bis`,
    timezone: 'America/Mexico_City',
    agency_id: f.agencia,
    created_by: f.admin,
  });

  f.contactoFila = await insertar('client_contacts', { client_id: f.marca, profile_id: f.contacto });
  f.asignacion = await insertar('client_assignments', { client_id: f.marca, profile_id: f.miembro });

  f.pieza = await insertar('content_pieces', {
    client_id: f.marca,
    platform: 'instagram',
    format: 'post',
    title: `Pieza de ${n}`,
    copy_text: `Texto confidencial de la agencia ${n}`,
    scheduled_at: enUnDia(),
    status: 'pendiente_revision',
    created_by: f.admin,
  });

  f.rutaAdjunto = `${f.marca}/${f.pieza}/archivo-${n}.png`;
  await subirObjeto(f.rutaAdjunto);
  f.adjunto = await insertar('attachments', {
    content_piece_id: f.pieza,
    file_path: f.rutaAdjunto,
    file_name: `archivo-${n}.png`,
    file_type: 'image/png',
    file_size: 20,
    uploaded_by: f.admin,
  });

  f.comentario = await insertar('comments', {
    content_piece_id: f.pieza,
    author_id: f.admin,
    body: `Comentario interno de ${n}`,
  });

  f.historial = await insertar('status_history', {
    content_piece_id: f.pieza,
    from_status: 'borrador',
    to_status: 'pendiente_revision',
    changed_by: f.admin,
  });

  f.aprobacion = await insertar('approvals', {
    content_piece_id: f.pieza,
    decided_by: f.contacto,
    decision: 'aprobado',
    note: `Aprobación de ${n}`,
  });

  f.idea = await insertar('ideas', {
    client_id: f.marca,
    title: `Idea de ${n}`,
    description: `Idea todavía interna de ${n}`,
    status: 'propuesta',
    created_by: f.admin,
  });
  f.historialIdea = await insertar('idea_status_history', {
    idea_id: f.idea,
    from_status: 'propuesta',
    to_status: 'propuesta',
    changed_by: f.admin,
    note: `Nota interna de ${n}`,
  });

  // La notificación va dirigida al ADMINISTRADOR de la agencia a propósito: `notifications_select`
  // filtra por `profile_id = auth.uid()`, así que es la única forma de que la prueba de esa tabla
  // pueda afirmar las dos mitades (la fila propia sí, la ajena no).
  f.notificacion = await insertar('notifications', {
    profile_id: f.admin,
    content_piece_id: f.pieza,
    type: 'comentario',
    title: `Notificación de ${n}`,
    body: 'cuerpo',
  });

  f.paquete = await insertar(
    'client_packages',
    { client_id: f.marca, format: 'post', monthly_quota: 12 },
    'client_id'
  );

  f.ajustesNotificacion = await insertar('notification_settings', { client_id: f.marca });

  f.conexion = await insertar('google_calendar_connections', {
    label: `Calendario de ${n}`,
    calendar_id: `calendario-${n}@group.calendar.google.com`,
    access_token: `token-de-acceso-de-${n}`,
    refresh_token: `token-de-refresco-de-${n}`,
    connected_by: f.admin,
    agency_id: f.agencia,
  });
  f.mapeo = await insertar('client_calendar_mappings', { client_id: f.marca, connection_id: f.conexion });
  f.eventoCalendario = await insertar('calendar_event_links', {
    content_piece_id: f.pieza,
    google_event_id: `evento-${n}`,
    calendar_id: `calendario-${n}@group.calendar.google.com`,
  });

  f.webhook = await insertar('webhook_configs', {
    name: `Webhook de ${n}`,
    url: `https://ejemplo-${n}.test/hook`,
    secret: `secreto-de-${n}`,
    created_by: f.admin,
    agency_id: f.agencia,
  });
  f.entrega = await insertar('webhook_deliveries', {
    webhook_config_id: f.webhook,
    event_type: 'pieza_aprobada',
    payload: { agencia: n },
    response_status: 200,
  });
}

beforeAll(async () => {
  await montarAgencia(A);
  await montarAgencia(B);

  idContactoDoble = await crearUsuario(correoContactoDoble);
  await admin.from('client_contacts').insert([
    { client_id: A.marca, profile_id: idContactoDoble },
    { client_id: B.marca, profile_id: idContactoDoble },
  ]);

  sesiones.adminA = await sesionDe(A.correoAdmin);
  sesiones.miembroA = await sesionDe(A.correoMiembro);
  sesiones.contactoA = await sesionDe(A.correoContacto);
  sesiones.adminB = await sesionDe(B.correoAdmin);
  sesiones.doble = await sesionDe(correoContactoDoble);
}, 60_000);

afterAll(async () => {
  for (const f of [A, B]) {
    if (f.rutaAdjunto) await admin.storage.from('attachments').remove([f.rutaAdjunto]);
    // Las marcas caen en cascada y se llevan piezas, ideas, comentarios, paquetes y mapeos.
    for (const marca of [f.marca, f.marcaSinAsignar]) {
      if (marca) await admin.from('clients').delete().eq('id', marca);
    }
    if (f.webhook) await admin.from('webhook_configs').delete().eq('id', f.webhook);
    if (f.conexion) await admin.from('google_calendar_connections').delete().eq('id', f.conexion);
  }
  for (const id of [A.admin, A.miembro, A.contacto, B.admin, B.miembro, B.contacto, idContactoDoble]) {
    if (id) await admin.auth.admin.deleteUser(id);
  }
  // Las agencias al final: si alguna prueba hubiera logrado mudar una fila a la agencia ajena, este
  // delete fallaría por la clave ajena en vez de borrar en silencio la evidencia.
  for (const f of [A, B]) {
    if (f.agencia) await admin.from('agencies').delete().eq('id', f.agencia);
  }
});

// ============================================================================================
// UNA PRUEBA POR TABLA CON RLS. Son las 19 que enumera el spec más `agencies`, que 0009 dejó con
// RLS encendida y cero políticas y que 0010 abre para que cada agencia lea la suya.
// ============================================================================================
interface TablaAislada {
  tabla: string;
  /** Columna con la que se identifica la fila. `id` salvo donde la tabla no tenga una. */
  clave: string;
  deA: () => string;
  deB: () => string;
}

const TABLAS: TablaAislada[] = [
  { tabla: 'agencies', clave: 'id', deA: () => A.agencia, deB: () => B.agencia },
  { tabla: 'profiles', clave: 'id', deA: () => A.miembro, deB: () => B.miembro },
  { tabla: 'clients', clave: 'id', deA: () => A.marca, deB: () => B.marca },
  { tabla: 'client_assignments', clave: 'id', deA: () => A.asignacion, deB: () => B.asignacion },
  { tabla: 'client_contacts', clave: 'id', deA: () => A.contactoFila, deB: () => B.contactoFila },
  { tabla: 'content_pieces', clave: 'id', deA: () => A.pieza, deB: () => B.pieza },
  { tabla: 'attachments', clave: 'id', deA: () => A.adjunto, deB: () => B.adjunto },
  { tabla: 'comments', clave: 'id', deA: () => A.comentario, deB: () => B.comentario },
  { tabla: 'status_history', clave: 'id', deA: () => A.historial, deB: () => B.historial },
  { tabla: 'approvals', clave: 'id', deA: () => A.aprobacion, deB: () => B.aprobacion },
  { tabla: 'ideas', clave: 'id', deA: () => A.idea, deB: () => B.idea },
  { tabla: 'idea_status_history', clave: 'id', deA: () => A.historialIdea, deB: () => B.historialIdea },
  { tabla: 'notifications', clave: 'id', deA: () => A.notificacion, deB: () => B.notificacion },
  { tabla: 'notification_settings', clave: 'id', deA: () => A.ajustesNotificacion, deB: () => B.ajustesNotificacion },
  // `client_packages` no tiene columna `id`: su clave primaria es (client_id, format).
  { tabla: 'client_packages', clave: 'client_id', deA: () => A.paquete, deB: () => B.paquete },
  { tabla: 'google_calendar_connections', clave: 'id', deA: () => A.conexion, deB: () => B.conexion },
  { tabla: 'client_calendar_mappings', clave: 'id', deA: () => A.mapeo, deB: () => B.mapeo },
  { tabla: 'calendar_event_links', clave: 'id', deA: () => A.eventoCalendario, deB: () => B.eventoCalendario },
  { tabla: 'webhook_configs', clave: 'id', deA: () => A.webhook, deB: () => B.webhook },
  { tabla: 'webhook_deliveries', clave: 'id', deA: () => A.entrega, deB: () => B.entrega },
];

describe('cada tabla con RLS aísla la agencia B de la agencia A', () => {
  it.each(TABLAS)('$tabla: el administrador de A no ve la fila de B, y sí la suya', async (t) => {
    const { data, error } = await sesiones.adminA.from(t.tabla).select(t.clave);

    expect(error).toBeNull();
    const valores = ((data ?? []) as unknown as Array<Record<string, unknown>>).map(
      (fila) => fila[t.clave]
    );

    // El aislamiento.
    expect(valores).not.toContain(t.deB());
    // Y la otra mitad, que es la que impide que esta prueba pase en verde contra una política que
    // esconda todo: la fila propia tiene que seguir viéndose.
    expect(valores).toContain(t.deA());
  });
});

// ============================================================================================
// ESCRITURAS
// ============================================================================================
describe('el administrador de A no escribe nada de B', () => {
  // El INSERT sí devuelve código: el `with check` de la política lo rechaza con 42501. Es el único
  // verbo donde la RLS levanta un error en vez de filtrar.
  it('no puede crear una pieza dentro de una marca de B (42501)', async () => {
    const { error } = await sesiones.adminA.from('content_pieces').insert({
      client_id: B.marca,
      platform: 'instagram',
      format: 'post',
      title: 'Pieza infiltrada',
      scheduled_at: enUnDia(),
    });

    expect(error?.code).toBe(RLS_RECHAZA);
  });

  it('no puede crear una marca dentro de la agencia B (42501)', async () => {
    const { error } = await sesiones.adminA.from('clients').insert({
      name: `Marca infiltrada ${sufijo}`,
      brand_name: 'Infiltrada',
      timezone: 'America/Mexico_City',
      agency_id: B.agencia,
    });

    expect(error?.code).toBe(RLS_RECHAZA);
  });

  // En UPDATE y DELETE la RLS NO levanta error: el `using` filtra la fila y la sentencia afecta a
  // cero filas. Lo que se afirma es más fuerte que un código -- que la fila de B siguió exactamente
  // igual, leída con el cliente de servicio, que salta la RLS.
  //
  // LO QUE ESTAS DOS PRUEBAS PRUEBAN DE VERDAD, DICHO SIN ADORNOS: se midió revirtiendo
  // `content_pieces_agency_update` y `content_pieces_agency_delete` a su `is_agency()` original, y
  // las dos SIGUIERON EN VERDE. No es un fallo de la prueba, es cómo funciona Postgres: un UPDATE o
  // un DELETE con `where` tiene que LEER la fila, así que se le aplica también la política de
  // SELECT. Y `content_pieces_select` pasa por `has_client_access()`, que sí está aislada. Quitar el
  // `.select()` tampoco cambia nada -- se probó: el `where` basta para que la política de lectura
  // entre. No hay forma, por la API, de que una prueba distinga la política de escritura de la de
  // lectura.
  //
  // Lo que sí detectan, y por eso siguen aquí: se vuelven ROJAS en cuanto se revierte
  // `has_client_access()`, que es la política que realmente decide. La versión acotada de las
  // políticas de escritura es defensa en profundidad para el día en que la fila llegue por un camino
  // que no pase por la lectura, y su mitad que sí es observable -- el `with check` del insert -- la
  // cubren las dos pruebas de arriba.
  it('no puede editar la pieza de B: la pieza queda intacta', async () => {
    const { error } = await sesiones.adminA
      .from('content_pieces')
      .update({ title: 'Título secuestrado' })
      .eq('id', B.pieza);

    expect(error).toBeNull();

    const { data: despues } = await admin.from('content_pieces').select('title').eq('id', B.pieza).single();
    expect(despues?.title).toBe('Pieza de B');
  });

  it('no puede borrar la pieza de B: la pieza sigue ahí', async () => {
    const { error } = await sesiones.adminA.from('content_pieces').delete().eq('id', B.pieza);

    expect(error).toBeNull();

    const { data: despues } = await admin.from('content_pieces').select('id').eq('id', B.pieza).maybeSingle();
    expect(despues?.id).toBe(B.pieza);
  });

  it('no puede aprobar la pieza de B (P0001)', async () => {
    const { error } = await sesiones.adminA.rpc('approve_content_piece', {
      p_content_piece_id: B.pieza,
      p_note: 'aprobada por quien no debe',
    });

    expect(error?.code).toBe(REGLA_DE_NEGOCIO);
    expect(error?.message).toMatch(/no autorizado/i);

    const { data } = await admin.from('content_pieces').select('status').eq('id', B.pieza).single();
    expect(data?.status).toBe('pendiente_revision');
  });

  // Mismo límite que las dos de arriba, medido igual: revertir `attachments_agency_delete` a
  // `is_agency()` a secas deja esta prueba en VERDE, porque el DELETE lee la fila y ahí entra
  // `attachments_select`, que sí está aislada. Se vuelve roja al revertir `has_client_access()`.
  it('no puede borrar el adjunto de B: el adjunto sigue ahí', async () => {
    const { error } = await sesiones.adminA.from('attachments').delete().eq('id', B.adjunto);

    expect(error).toBeNull();

    const { data: despues } = await admin.from('attachments').select('id').eq('id', B.adjunto).maybeSingle();
    expect(despues?.id).toBe(B.adjunto);
  });
});

// ============================================================================================
// LAS RPC. Una función SECURITY DEFINER corre con los privilegios de su dueño, así que las
// políticas de arriba NO la frenan: si no comprueba la agencia ella misma, el aislamiento se
// esquiva llamando a la RPC en vez de escribiendo la tabla -- y las dos son una llamada HTTP.
// ============================================================================================
// SE AFIRMA EL MENSAJE Y NO SÓLO EL CÓDIGO, y no es adorno: varias de estas funciones YA rebotaban
// antes de 0010, pero por otro motivo -- `mark_scheduled` se quejaba de que la pieza no estuviera
// aprobada, `resubmit_idea` de que la idea no estuviera en corrección. Una prueba que sólo mirara
// `P0001` pasaría en verde contra la versión sin aislar y no demostraría nada. El mensaje es lo que
// distingue "rebotó porque es de otra agencia" de "rebotó de casualidad".
interface RpcAislada {
  nombre: string;
  args: () => Record<string, unknown>;
  mensaje: RegExp;
}

const RPC_DE_PIEZA: RpcAislada[] = [
  { nombre: 'submit_for_review', args: () => ({ p_content_piece_id: B.pieza }), mensaje: /no autorizado/i },
  { nombre: 'mark_scheduled', args: () => ({ p_content_piece_id: B.pieza }), mensaje: /no autorizado/i },
  { nombre: 'mark_published', args: () => ({ p_content_piece_id: B.pieza }), mensaje: /no autorizado/i },
  {
    nombre: 'cancel_content_piece',
    args: () => ({ p_content_piece_id: B.pieza, p_reason: 'porque sí' }),
    mensaje: /no autorizado/i,
  },
  {
    nombre: 'reschedule_content_piece',
    args: () => ({ p_content_piece_id: B.pieza, p_new_scheduled_at: enUnDia() }),
    mensaje: /no autorizado/i,
  },
  {
    nombre: 'request_changes',
    args: () => ({ p_content_piece_id: B.pieza, p_note: 'cambia esto' }),
    mensaje: /no autorizado/i,
  },
];

const RPC_DE_IDEA: RpcAislada[] = [
  { nombre: 'submit_idea_to_client', args: () => ({ p_idea_id: B.idea }), mensaje: /otra agencia/i },
  {
    nombre: 'request_idea_internal_changes',
    args: () => ({ p_idea_id: B.idea, p_note: 'corrige' }),
    mensaje: /otra agencia/i,
  },
  // Estas dos NO cambiaron en 0010 y no tenían por qué: exigen estar en `client_contacts` de la marca
  // de la idea, que es una pertenencia por fila y nunca dependió de la agencia. El administrador de A
  // no está en los contactos de una marca de B, así que ya rebotaban antes. Se prueban igual porque
  // el aislamiento tiene que valer para TODAS las RPC, no sólo para las que hubo que arreglar.
  {
    nombre: 'approve_idea',
    args: () => ({ p_idea_id: B.idea, p_note: null }),
    mensaje: /solo el cliente puede aprobar/i,
  },
  {
    nombre: 'request_idea_client_changes',
    args: () => ({ p_idea_id: B.idea, p_note: 'cambia' }),
    mensaje: /solo el cliente puede pedir cambios/i,
  },
  {
    nombre: 'discard_idea',
    args: () => ({ p_idea_id: B.idea, p_reason: 'no me gusta' }),
    mensaje: /no autorizado/i,
  },
  { nombre: 'resubmit_idea', args: () => ({ p_idea_id: B.idea }), mensaje: /otra agencia/i },
  {
    nombre: 'convert_idea_to_piece',
    args: () => ({ p_idea_id: B.idea, p_content_piece_id: B.pieza }),
    mensaje: /otra agencia/i,
  },
];

describe('ninguna RPC de transición acepta una fila de B en manos de A', () => {
  it.each(RPC_DE_PIEZA)('$nombre rebota sobre la pieza de B', async (r) => {
    const { error } = await sesiones.adminA.rpc(r.nombre, r.args());

    expect(error?.code).toBe(REGLA_DE_NEGOCIO);
    expect(error?.message).toMatch(r.mensaje);

    const { data } = await admin.from('content_pieces').select('status').eq('id', B.pieza).single();
    expect(data?.status).toBe('pendiente_revision');
  });

  it.each(RPC_DE_IDEA)('$nombre rebota sobre la idea de B', async (r) => {
    const { error } = await sesiones.adminA.rpc(r.nombre, r.args());

    expect(error?.code).toBe(REGLA_DE_NEGOCIO);
    expect(error?.message).toMatch(r.mensaje);

    const { data } = await admin.from('ideas').select('status').eq('id', B.idea).single();
    expect(data?.status).toBe('propuesta');
  });
});

// ============================================================================================
// ADJUNTOS EN STORAGE. Es lo más dañino que se puede filtrar -- el archivo en sí -- y las tres
// políticas del bucket (0002 y 0003) no se tocaron en 0010: heredan el aislamiento porque llaman a
// `has_client_access((storage.foldername(name))[1]::uuid)`. Estas pruebas existen para comprobar
// esa herencia en vez de darla por hecha.
// ============================================================================================
describe('los adjuntos de B no salen del bucket para A', () => {
  it('el administrador de A no obtiene una URL firmada del archivo de B', async () => {
    const { data, error } = await sesiones.adminA.storage
      .from('attachments')
      .createSignedUrl(B.rutaAdjunto, 60);

    expect(error).not.toBeNull();
    expect(data?.signedUrl).toBeUndefined();
  });

  it('el administrador de A no descarga el archivo de B', async () => {
    const { data, error } = await sesiones.adminA.storage.from('attachments').download(B.rutaAdjunto);

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it('el administrador de A no lista la carpeta de la marca de B', async () => {
    const { data } = await sesiones.adminA.storage.from('attachments').list(`${B.marca}/${B.pieza}`);

    expect(data ?? []).toEqual([]);
  });

  it('el administrador de A no borra el archivo de B', async () => {
    await sesiones.adminA.storage.from('attachments').remove([B.rutaAdjunto]);

    const { data } = await admin.storage.from('attachments').list(`${B.marca}/${B.pieza}`);
    expect((data ?? []).map((archivo) => archivo.name)).toContain(`archivo-B.png`);
  });

  it('y el suyo sí lo obtiene: la política no está simplemente cerrada', async () => {
    const { data, error } = await sesiones.adminA.storage
      .from('attachments')
      .createSignedUrl(A.rutaAdjunto, 60);

    expect(error).toBeNull();
    expect(data?.signedUrl).toBeTruthy();
  });
});

// ============================================================================================
// LOS CONTACTOS DE CLIENTE
// ============================================================================================
describe('un contacto de cliente de A no ve nada de B', () => {
  it('sólo ve su propia marca', async () => {
    const { data } = await sesiones.contactoA.from('clients').select('id');

    expect((data ?? []).map((c) => c.id)).toEqual([A.marca]);
  });

  it('no ve la pieza de B', async () => {
    const { data } = await sesiones.contactoA.from('content_pieces').select('id');
    const ids = (data ?? []).map((p) => p.id);

    expect(ids).not.toContain(B.pieza);
    expect(ids).toContain(A.pieza);
  });

  it('no ve la agencia de B, ni ninguna otra', async () => {
    // Un contacto no pertenece a ninguna agencia: `mi_agencia()` le devuelve nulo y la política de
    // `agencies` no autoriza con nulo.
    const { data } = await sesiones.contactoA.from('agencies').select('id');

    expect(data ?? []).toEqual([]);
  });
});

// El caso que el modelo de una sola agencia nunca tuvo, y el más fácil de romper con un
// `mi_agencia()` de más en el lado del cliente: un contacto tiene `agency_id` NULO, así que
// cualquier comprobación que le pida una agencia lo deja sin ver absolutamente nada.
describe('un contacto de marcas de dos agencias distintas ve las dos, y sólo esas', () => {
  it('ve exactamente las dos marcas de las que es contacto', async () => {
    const { data } = await sesiones.doble.from('clients').select('id');
    const ids = (data ?? []).map((c) => c.id).sort();

    expect(ids).toEqual([A.marca, B.marca].sort());
  });

  it('ve las piezas de las dos marcas y ninguna más', async () => {
    const { data } = await sesiones.doble.from('content_pieces').select('id').order('id');
    const ids = (data ?? []).map((p) => p.id).sort();

    expect(ids).toEqual([A.pieza, B.pieza].sort());
  });

  it('no ve la marca sin asignar de A, de la que no es contacto', async () => {
    const { data } = await sesiones.doble.from('clients').select('id');

    expect((data ?? []).map((c) => c.id)).not.toContain(A.marcaSinAsignar);
  });

  it('no ve ninguna agencia: no pertenece a ninguna', async () => {
    const { data } = await sesiones.doble.from('agencies').select('id');

    expect(data ?? []).toEqual([]);
  });
});

// ============================================================================================
// LO QUE TIENE QUE SEGUIR FUNCIONANDO DENTRO DE UNA AGENCIA. Aislar de más es otra forma de
// romperlo: el modelo del producto dice que cualquier usuario de agencia llega a todas las marcas
// de SU agencia, y eso no es lo que 0010 viene a cerrar.
// ============================================================================================
describe('dentro de una agencia no cambia nada', () => {
  it('un miembro de A llega a una marca de A a la que no está asignado', async () => {
    const { data } = await sesiones.miembroA.from('clients').select('id');
    const ids = (data ?? []).map((c) => c.id);

    expect(ids).toContain(A.marca);
    expect(ids).toContain(A.marcaSinAsignar);
    expect(ids).not.toContain(B.marca);
  });

  it('un miembro de A crea una pieza en esa marca sin asignar', async () => {
    const { data, error } = await sesiones.miembroA
      .from('content_pieces')
      .insert({
        client_id: A.marcaSinAsignar,
        platform: 'instagram',
        format: 'post',
        title: 'Pieza del miembro',
        scheduled_at: enUnDia(),
      })
      .select('id')
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });

  it('un miembro de A mueve una pieza de A por la RPC', async () => {
    const pieza = await insertar('content_pieces', {
      client_id: A.marcaSinAsignar,
      platform: 'instagram',
      format: 'post',
      title: 'Pieza para revisar',
      scheduled_at: enUnDia(),
      created_by: A.miembro,
    });

    const { error } = await sesiones.miembroA.rpc('submit_for_review', { p_content_piece_id: pieza });

    expect(error).toBeNull();
    const { data } = await admin.from('content_pieces').select('status').eq('id', pieza).single();
    expect(data?.status).toBe('pendiente_revision');
  });

  it('el contacto de A sigue aprobando una pieza de A', async () => {
    const pieza = await insertar('content_pieces', {
      client_id: A.marca,
      platform: 'instagram',
      format: 'post',
      title: 'Pieza para aprobar',
      scheduled_at: enUnDia(),
      status: 'pendiente_revision',
      created_by: A.admin,
    });

    const { error } = await sesiones.contactoA.rpc('approve_content_piece', {
      p_content_piece_id: pieza,
      p_note: 'listo',
    });

    expect(error).toBeNull();
    const { data } = await admin.from('content_pieces').select('status').eq('id', pieza).single();
    expect(data?.status).toBe('aprobado');
  });

  it('el administrador de A sigue leyendo el secreto de SU webhook', async () => {
    const { data, error } = await sesiones.adminA.from('webhook_configs').select('id, secret');

    expect(error).toBeNull();
    expect(data).toEqual([{ id: A.webhook, secret: 'secreto-de-A' }]);
  });

  it('el administrador de A sigue leyendo el token de SU conexión de Google', async () => {
    const { data, error } = await sesiones.adminA
      .from('google_calendar_connections')
      .select('id, refresh_token');

    expect(error).toBeNull();
    expect(data).toEqual([{ id: A.conexion, refresh_token: 'token-de-refresco-de-A' }]);
  });
});

// ============================================================================================
// LAS CREDENCIALES DE B. Se afirma aparte porque no es una fila más: `webhook_configs.secret` firma
// lo que sale hacia Make y `google_calendar_connections.refresh_token` abre el calendario de otra
// agencia. Una fuga aquí no filtra datos, filtra llaves.
// ============================================================================================
describe('las credenciales de B no se leen desde A', () => {
  it('el administrador de A no lee el secreto del webhook de B', async () => {
    const { data } = await sesiones.adminA.from('webhook_configs').select('secret');

    expect((data ?? []).map((w) => w.secret)).not.toContain('secreto-de-B');
  });

  it('el administrador de A no lee el refresh_token de la conexión de B', async () => {
    const { data } = await sesiones.adminA.from('google_calendar_connections').select('refresh_token');

    expect((data ?? []).map((c) => c.refresh_token)).not.toContain('token-de-refresco-de-B');
  });

  it('el administrador de A no puede mapear una marca suya al calendario de B', async () => {
    const { error } = await sesiones.adminA
      .from('client_calendar_mappings')
      .insert({ client_id: A.marcaSinAsignar, connection_id: B.conexion });

    expect(error?.code).toBe(RLS_RECHAZA);
  });
});
