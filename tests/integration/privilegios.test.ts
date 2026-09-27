import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agenciaDelBackfill } from '@/tests/integration/agencia';

// Corre contra la Supabase LOCAL levantada por `npm run test:integration`. Nunca contra un
// proyecto remoto: las credenciales salen de .env.test.local, que scripts/write-supabase-test-env.mjs
// genera desde `supabase status`.
//
// Esta suite prueba la capa de PRIVILEGIOS DE COLUMNA de 0007_endurecimiento_privilegios.sql, que es
// una capa distinta de la RLS. La RLS decide qué FILA puedes tocar; el privilegio de columna decide
// qué COLUMNA. Ninguna prueba de RLS puede detectar un agujero de columna, y por eso ninguna de las
// otras suites cubría nada de esto: todas escriben sus fixtures con el cliente de servicio, que
// conserva todos los privilegios.
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
const sufijo = Date.now();
const correos = {
  agencia: `privilegios-agencia-${sufijo}@prueba.local`,
  contacto: `privilegios-contacto-${sufijo}@prueba.local`,
};

const ids = { agencia: '', contacto: '', marca: '', marcaB: '' };
// La agencia del backfill de 0009_agencias.sql. Se resuelve en beforeAll porque `clients.agency_id`
// es not null y el check de profiles exige agencia para todo rol de agencia.
let idAgencia = '';

// Código de Postgres para "permiso denegado" (insufficient_privilege). Se afirma el código y no
// sólo la existencia del error a propósito: sin esto la prueba pasaría en verde por cualquier
// motivo -- un typo en el nombre de la columna, una pieza que no existe, una sesión caída -- y
// dejaría de demostrar que lo que rechaza la escritura es el privilegio de columna.
const PERMISO_DENEGADO = '42501';
// raise_exception: el código de cualquier `raise exception` de plpgsql (los guards en español).
const REGLA_DE_NEGOCIO = 'P0001';
// check_violation: el CHECK de reference_link.
const CHECK_VIOLADO = '23514';

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

/** Crea una pieza con el cliente de servicio, que conserva el privilegio sobre `status`. */
async function crearPieza(clientId: string = ids.marca, status = 'borrador') {
  const { data, error } = await admin
    .from('content_pieces')
    .insert({
      client_id: clientId,
      platform: 'instagram',
      format: 'post',
      title: `Pieza de privilegios ${Math.random().toString(36).slice(2, 8)}`,
      copy_text: 'Texto de prueba.',
      scheduled_at: enUnDia(),
      status,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

async function crearIdea(clientId: string = ids.marca, status = 'propuesta') {
  const { data, error } = await admin
    .from('ideas')
    .insert({
      client_id: clientId,
      title: `Idea de privilegios ${Math.random().toString(36).slice(2, 8)}`,
      description: 'Descripcion de prueba',
      status,
      created_by: ids.agencia,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

async function piezaPorId(id: string) {
  const { data } = await admin.from('content_pieces').select('status, client_id').eq('id', id).single();
  return data as { status: string; client_id: string } | null;
}

beforeAll(async () => {
  ids.agencia = await crearUsuario(correos.agencia);
  ids.contacto = await crearUsuario(correos.contacto);

  // handle_new_user() ya creó los profiles con rol 'client'; el de agencia necesita su rol real.
  idAgencia = await agenciaDelBackfill(admin);
  const { error: rolError } = await admin
    .from('profiles')
    .update({ role: 'agency_admin', agency_id: idAgencia })
    .eq('id', ids.agencia);
  if (rolError) throw rolError;

  const { data: marca, error } = await admin
    .from('clients')
    .insert({ name: `Marca privilegios ${sufijo}`, brand_name: 'Privilegios', agency_id: idAgencia, created_by: ids.agencia })
    .select('id')
    .single();
  if (error) throw error;
  ids.marca = marca.id;

  // Segunda marca: el destino ajeno con el que se prueba que una pieza no se pueda mudar de marca
  // ni un adjunto apuntar a la carpeta de otra.
  const { data: marcaB, error: errorB } = await admin
    .from('clients')
    .insert({ name: `Marca privilegios B ${sufijo}`, brand_name: 'Privilegios B', agency_id: idAgencia, created_by: ids.agencia })
    .select('id')
    .single();
  if (errorB) throw errorB;
  ids.marcaB = marcaB.id;

  const { error: vinculoError } = await admin.from('client_contacts').insert({
    client_id: ids.marca,
    profile_id: ids.contacto,
  });
  if (vinculoError) throw vinculoError;

  // El usuario de agencia va en client_assignments porque notify_comment deriva de ahí los
  // destinatarios cuando quien comenta es el cliente.
  //
  // El CONTACTO también va en client_assignments, y no es un descuido: es lo que hace que la mitad
  // "y nunca al autor" de la prueba de notify_comment signifique algo. Si el contacto solo estuviera
  // en client_contacts, esa afirmación pasaría en verde sola -- el autor no saldría en la consulta
  // de destinatarios ni sin el filtro `profile_id <> auth.uid()` -- y no probaría nada. Estando en
  // las dos tablas, ese filtro es lo único que lo excluye (comprobado: quitándolo del cuerpo de la
  // función, la prueba cae).
  const { error: asignacionError } = await admin.from('client_assignments').insert([
    { client_id: ids.marca, profile_id: ids.agencia },
    { client_id: ids.marca, profile_id: ids.contacto },
  ]);
  if (asignacionError) throw asignacionError;
});

afterAll(async () => {
  for (const marca of [ids.marca, ids.marcaB]) {
    if (marca) await admin.from('clients').delete().eq('id', marca);
  }
  for (const id of [ids.agencia, ids.contacto]) {
    if (id) await admin.auth.admin.deleteUser(id);
  }
});

describe('profiles.role: nadie se asciende a sí mismo', () => {
  it('un contacto de cliente no puede ponerse rol agency_admin', async () => {
    const contacto = await sesionDe(correos.contacto);

    const { error } = await contacto.from('profiles').update({ role: 'agency_admin' }).eq('id', ids.contacto);

    const { data } = await admin.from('profiles').select('role').eq('id', ids.contacto).single();
    // Se restaura ANTES de afirmar: si esta prueba corre en rojo el ascenso sí ocurrió, y el resto
    // del archivo depende de que este usuario siga siendo cliente (aprobar una pieza, notify_comment).
    // Sin esta línea un fallo aquí se propagaría como fallos falsos en las demás pruebas.
    if (data?.role !== 'client') {
      await admin.from('profiles').update({ role: 'client' }).eq('id', ids.contacto);
    }

    expect(error?.code).toBe(PERMISO_DENEGADO);
    expect(data?.role).toBe('client');
  });
});

describe('content_pieces: la máquina de estados deja de ser sugerencia', () => {
  it('un usuario de agencia no puede escribir status = aprobado directamente', async () => {
    const pieza = await crearPieza();
    const agencia = await sesionDe(correos.agencia);

    const { error } = await agencia.from('content_pieces').update({ status: 'aprobado' }).eq('id', pieza);

    expect(error?.code).toBe(PERMISO_DENEGADO);
    expect((await piezaPorId(pieza))?.status).toBe('borrador');
  });

  // El insert importa tanto como el update: crear una pieza que YA nace 'aprobado' es la misma
  // falsificación con otro verbo, y sin revocar el insert la revocación del update se esquiva en un
  // paso. La columna tiene default 'borrador', así que la app no necesita mandarla nunca.
  it('un usuario de agencia no puede crear una pieza que ya nazca aprobada', async () => {
    const agencia = await sesionDe(correos.agencia);

    const { error } = await agencia.from('content_pieces').insert({
      client_id: ids.marca,
      platform: 'instagram',
      format: 'post',
      title: 'Nace aprobada',
      scheduled_at: enUnDia(),
      status: 'aprobado',
    });

    expect(error?.code).toBe(PERMISO_DENEGADO);
  });

  it('un usuario de agencia no puede mudar una pieza a otra marca', async () => {
    const pieza = await crearPieza();
    const agencia = await sesionDe(correos.agencia);

    const { error } = await agencia.from('content_pieces').update({ client_id: ids.marcaB }).eq('id', pieza);

    expect(error?.code).toBe(PERMISO_DENEGADO);
    expect((await piezaPorId(pieza))?.client_id).toBe(ids.marca);
  });

  it('un usuario de agencia sí puede editar los campos de contenido de la pieza', async () => {
    const pieza = await crearPieza();
    const agencia = await sesionDe(correos.agencia);

    const { error } = await agencia
      .from('content_pieces')
      .update({ title: 'Título editado', copy_text: 'Copy editado' })
      .eq('id', pieza);

    expect(error).toBeNull();
    const { data } = await admin.from('content_pieces').select('title').eq('id', pieza).single();
    expect(data?.title).toBe('Título editado');
  });
});

describe('ideas: el mismo cierre que content_pieces', () => {
  it('un usuario de agencia no puede escribir ideas.status directamente', async () => {
    const idea = await crearIdea();
    const agencia = await sesionDe(correos.agencia);

    const { error } = await agencia.from('ideas').update({ status: 'aprobada' }).eq('id', idea);

    expect(error?.code).toBe(PERMISO_DENEGADO);
    const { data } = await admin.from('ideas').select('status').eq('id', idea).single();
    expect(data?.status).toBe('propuesta');
  });
});

// Sin estas dos pruebas las de arriba no valen nada: demostrar que una escritura está cerrada no
// dice nada si el producto quedó cerrado con ella. Las funciones de transición son SECURITY DEFINER
// y pertenecen a `postgres`, así que conservan el privilegio de columna que `authenticated` perdió.
describe('las RPC de transición siguen funcionando', () => {
  it('un contacto del cliente todavía puede aprobar su pieza', async () => {
    const pieza = await crearPieza(ids.marca, 'pendiente_revision');
    const contacto = await sesionDe(correos.contacto);

    const { error } = await contacto.rpc('approve_content_piece', {
      p_content_piece_id: pieza,
      p_note: 'Se ve bien',
    });

    expect(error).toBeNull();
    expect((await piezaPorId(pieza))?.status).toBe('aprobado');

    const { data: approvals } = await admin
      .from('approvals')
      .select('decision')
      .eq('content_piece_id', pieza);
    expect(approvals).toHaveLength(1);
    expect(approvals?.[0].decision).toBe('aprobado');
  });

  it('la agencia todavía puede enviar a revisión y cancelar', async () => {
    const agencia = await sesionDe(correos.agencia);

    const paraRevision = await crearPieza();
    const { error: errorRevision } = await agencia.rpc('submit_for_review', {
      p_content_piece_id: paraRevision,
    });
    expect(errorRevision).toBeNull();
    expect((await piezaPorId(paraRevision))?.status).toBe('pendiente_revision');

    // cancel_content_piece escribe status Y cancelled_reason en la misma sentencia: prueba que la
    // revocación no rompe una transición que toca más de una columna.
    const paraCancelar = await crearPieza();
    const { error: errorCancelar } = await agencia.rpc('cancel_content_piece', {
      p_content_piece_id: paraCancelar,
      p_reason: 'El cliente bajó la campaña',
    });
    expect(errorCancelar).toBeNull();
    expect((await piezaPorId(paraCancelar))?.status).toBe('cancelado');
  });

  it('una idea todavía recorre su máquina de estados por las RPC', async () => {
    const idea = await crearIdea();
    const agencia = await sesionDe(correos.agencia);

    const { error } = await agencia.rpc('submit_idea_to_client', { p_idea_id: idea });
    expect(error).toBeNull();

    const { data } = await admin.from('ideas').select('status').eq('id', idea).single();
    expect(data?.status).toBe('pendiente_cliente');
  });
});

describe('reference_link tiene que ser http(s)', () => {
  it('rechaza javascript: y acepta https:// en piezas y en ideas', async () => {
    const agencia = await sesionDe(correos.agencia);

    const { error: piezaMala } = await agencia.from('content_pieces').insert({
      client_id: ids.marca,
      platform: 'instagram',
      format: 'post',
      title: 'Con enlace hostil',
      scheduled_at: enUnDia(),
      reference_link: 'javascript:alert(1)',
    });
    expect(piezaMala?.code).toBe(CHECK_VIOLADO);

    const { error: piezaBuena } = await agencia.from('content_pieces').insert({
      client_id: ids.marca,
      platform: 'instagram',
      format: 'post',
      title: 'Con enlace válido',
      scheduled_at: enUnDia(),
      reference_link: 'https://ejemplo.test/referencia',
    });
    expect(piezaBuena).toBeNull();

    const { error: ideaMala } = await agencia.from('ideas').insert({
      client_id: ids.marca,
      title: 'Idea con enlace hostil',
      description: 'No debería entrar',
      reference_link: 'javascript:alert(1)',
    });
    expect(ideaMala?.code).toBe(CHECK_VIOLADO);

    const { error: ideaBuena } = await agencia.from('ideas').insert({
      client_id: ids.marca,
      title: 'Idea con enlace válido',
      description: 'Sí debería entrar',
      reference_link: 'https://ejemplo.test/referencia',
    });
    expect(ideaBuena).toBeNull();
  });
});

describe('notify_comment deriva los destinatarios en el servidor', () => {
  it('notifica a la contraparte y nunca al autor del comentario', async () => {
    const pieza = await crearPieza();
    const contacto = await sesionDe(correos.contacto);

    const { error } = await contacto.rpc('notify_comment', {
      p_content_piece_id: pieza,
      p_body: 'Cambia el gancho del primer segundo',
    });
    expect(error).toBeNull();

    const { data } = await admin
      .from('notifications')
      .select('profile_id, title, body')
      .eq('content_piece_id', pieza)
      .eq('type', 'comentario');

    // Quien comenta es el cliente, así que la contraparte son los asignados de la marca.
    expect((data ?? []).map((n) => n.profile_id)).toEqual([ids.agencia]);
    expect((data ?? []).map((n) => n.profile_id)).not.toContain(ids.contacto);
    expect(data?.[0].body).toContain('Cambia el gancho');
  });
});

describe('attachments.file_path pertenece a la marca de su pieza', () => {
  it('rechaza una ruta que empieza con el uuid de otra marca', async () => {
    const pieza = await crearPieza();
    const agencia = await sesionDe(correos.agencia);

    const { error } = await agencia.from('attachments').insert({
      content_piece_id: pieza,
      file_path: `${ids.marcaB}/robado.jpg`,
      file_name: 'robado.jpg',
    });

    expect(error?.code).toBe(REGLA_DE_NEGOCIO);
    expect(error?.message).toContain('marca');
  });

  it('rechaza una ruta sin uuid de marca con un mensaje claro, no con un fallo de cast', async () => {
    const pieza = await crearPieza();
    const agencia = await sesionDe(correos.agencia);

    const { error } = await agencia.from('attachments').insert({
      content_piece_id: pieza,
      file_path: 'sin-carpeta.jpg',
      file_name: 'sin-carpeta.jpg',
    });

    // 22P02 (invalid_text_representation) sería el cast crudo reventando: un mensaje en inglés
    // sobre sintaxis de uuid que no le dice nada a nadie. Tiene que ser el guard, en español.
    expect(error?.code).toBe(REGLA_DE_NEGOCIO);
    expect(error?.code).not.toBe('22P02');
  });

  it('acepta una ruta que sí empieza con el uuid de su propia marca', async () => {
    const pieza = await crearPieza();
    const agencia = await sesionDe(correos.agencia);

    const { error } = await agencia.from('attachments').insert({
      content_piece_id: pieza,
      file_path: `${ids.marca}/correcto.jpg`,
      file_name: 'correcto.jpg',
    });

    expect(error).toBeNull();
  });
});
