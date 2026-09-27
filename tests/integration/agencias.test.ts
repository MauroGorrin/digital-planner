import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agenciaDelBackfill } from '@/tests/integration/agencia';

// Corre contra la Supabase LOCAL de `npm run test:integration`, nunca contra un proyecto remoto.
//
// Esta suite cubre `0009_agencias.sql`: la entidad agencia, el backfill y los privilegios de columna
// que protegen `profiles.agency_id` y `clients.agency_id`. No cubre el aislamiento entre agencias —
// eso todavía no existe: `is_agency()` sigue respondiendo "soy personal de agencia" sin mirar de qué
// agencia, y convertir sus 47 usos es el paso 2 del spec, con sus propias 19 pruebas por tabla.
//
// LO QUE ESTA SUITE NO PUEDE PROBAR, Y DÓNDE SE PRUEBA: el backfill de filas que ya existían.
// `supabase db reset` aplica las migraciones sobre una base VACÍA, así que cuando 0009 corre aquí no
// hay ni una marca ni un perfil que reubicar; lo único que el reset deja observable es el invariante
// que el backfill garantiza, y es eso lo que se afirma abajo. Que el backfill mueva datos legados de
// verdad se comprueba pegando el archivo en una base con datos previos, que es además su camino real
// de aplicación (el editor SQL del panel de Supabase).
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
  agencia: `agencias-agencia-${sufijo}@prueba.local`,
  contacto: `agencias-contacto-${sufijo}@prueba.local`,
};

const ids = { agencia: '', contacto: '', marca: '', senuelo: '' };
let idAgencia = '';

// Se afirma el CÓDIGO de Postgres y no sólo que hubo un error, por lo mismo que documenta
// privilegios.test.ts: un typo en el nombre de una columna también produce "un error", y una prueba
// que sólo mira `error !== null` pasaría en verde sin demostrar nada.
/** insufficient_privilege: lo que devuelve un privilegio de columna revocado. */
const PERMISO_DENEGADO = '42501';
/** check_violation: lo que devuelve `profiles_agency_id_rol_check`. */
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

async function perfilPorId(id: string) {
  const { data } = await admin.from('profiles').select('role, agency_id').eq('id', id).single();
  return data as { role: string; agency_id: string | null } | null;
}

beforeAll(async () => {
  idAgencia = await agenciaDelBackfill(admin);

  ids.agencia = await crearUsuario(correos.agencia);
  ids.contacto = await crearUsuario(correos.contacto);

  // El rol y la agencia en el MISMO update: el check exige que un rol de agencia traiga agencia, así
  // que partirlo en dos escrituras haría rebotar la primera con 23514. Es exactamente lo que hará el
  // alta pública del paso 3, y por eso el estado intermedio no existe en ningún camino real.
  const { error: rolError } = await admin
    .from('profiles')
    .update({ role: 'agency_admin', agency_id: idAgencia })
    .eq('id', ids.agencia);
  if (rolError) throw rolError;

  // Agencia señuelo: el destino ajeno de los intentos de mudanza. Se queda VACÍA a propósito — sin
  // marcas ni perfiles — para que las pruebas que afirman "todo vive en una sola agencia" sigan
  // significando algo con ella presente.
  const { data: senuelo, error: errorSenuelo } = await admin
    .from('agencies')
    .insert({ name: `Agencia senuelo ${sufijo}` })
    .select('id')
    .single();
  if (errorSenuelo) throw errorSenuelo;
  ids.senuelo = senuelo.id;

  const { data: marca, error: errorMarca } = await admin
    .from('clients')
    .insert({
      name: `Marca agencias ${sufijo}`,
      brand_name: 'Agencias',
      timezone: 'America/Mexico_City',
      agency_id: idAgencia,
      created_by: ids.agencia,
    })
    .select('id')
    .single();
  if (errorMarca) throw errorMarca;
  ids.marca = marca.id;

  const { error: errorContacto } = await admin
    .from('client_contacts')
    .insert({ client_id: ids.marca, profile_id: ids.contacto });
  if (errorContacto) throw errorContacto;

  const { error: errorAsignacion } = await admin
    .from('client_assignments')
    .insert({ client_id: ids.marca, profile_id: ids.agencia });
  if (errorAsignacion) throw errorAsignacion;
});

afterAll(async () => {
  if (ids.marca) await admin.from('clients').delete().eq('id', ids.marca);
  for (const id of [ids.agencia, ids.contacto]) {
    if (id) await admin.auth.admin.deleteUser(id);
  }
  // El señuelo va al final: si alguna prueba hubiera logrado mudarle una marca o un perfil, este
  // delete fallaría por la clave ajena en vez de borrar en silencio la evidencia.
  if (ids.senuelo) await admin.from('agencies').delete().eq('id', ids.senuelo);
});

describe('el backfill deja todo en una sola agencia', () => {
  it('toda marca tiene agencia, y es la misma para todas', async () => {
    const { data, error } = await admin.from('clients').select('id, agency_id');
    if (error) throw error;

    // No es una comprobación vacía aunque la columna sea `not null`: lo que se afirma es que no hay
    // NINGUNA marca fuera de la agencia del backfill. Cualquier fixture de cualquier suite que se
    // inventara su propia agencia hace caer esta prueba, que es justo el descuido que convertiría
    // "una agencia" en "dos agencias a medias" en cuanto llegue el aislamiento del paso 2.
    expect(data?.length).toBeGreaterThan(0);
    expect((data ?? []).filter((c) => c.agency_id === null)).toEqual([]);
    expect([...new Set((data ?? []).map((c) => c.agency_id))]).toEqual([idAgencia]);
  });

  it('el personal de agencia apunta a esa agencia y los contactos de cliente no apuntan a ninguna', async () => {
    const { data, error } = await admin.from('profiles').select('id, role, agency_id');
    if (error) throw error;

    const staff = (data ?? []).filter((p) => p.role !== 'client');
    const contactos = (data ?? []).filter((p) => p.role === 'client');

    expect(staff.length).toBeGreaterThan(0);
    expect(staff.filter((p) => p.agency_id !== idAgencia)).toEqual([]);
    // La otra mitad de la regla, y no es simetría decorativa: un contacto con agencia quedaría
    // dentro del inquilino de una agencia sin que nadie lo hubiera invitado.
    expect(contactos.filter((p) => p.agency_id !== null)).toEqual([]);
  });

  it('existe exactamente una agencia del backfill, aunque el archivo se aplique dos veces', async () => {
    // El guard `if not exists (select 1 from agencies)` de 0009 es lo que hace el backfill
    // idempotente: sin él, una segunda aplicación —algo que pasa de verdad cuando la primera se
    // corta a mitad del pegado— crearía otra agencia y partiría los datos entre las dos.
    //
    // Que la SEGUNDA aplicación no cambie nada se comprueba pegando el archivo dos veces en psql y
    // comparando `information_schema.column_privileges` antes y después; aquí se afirma el
    // invariante que ese guard protege y que sí es observable desde la app.
    const { data, error } = await admin.from('agencies').select('id, name').eq('name', 'Agencia');
    if (error) throw error;

    expect(data).toEqual([{ id: idAgencia, name: 'Agencia' }]);
  });
});

describe('el check de profiles.agency_id amarra rol y agencia', () => {
  it('rechaza un perfil con rol de agencia y agency_id nulo', async () => {
    const { error } = await admin
      .from('profiles')
      .update({ role: 'agency_member', agency_id: null })
      .eq('id', ids.contacto);

    expect(error?.code).toBe(CHECK_VIOLADO);
    expect(error?.message).toMatch(/profiles_agency_id_rol_check/);
    // El update falla completo, así que la fila no se movió. Se comprueba porque el resto del
    // archivo depende de que este usuario siga siendo un contacto de cliente.
    expect(await perfilPorId(ids.contacto)).toEqual({ role: 'client', agency_id: null });
  });

  it('rechaza un contacto de cliente con agencia', async () => {
    const { error } = await admin.from('profiles').update({ agency_id: idAgencia }).eq('id', ids.contacto);

    expect(error?.code).toBe(CHECK_VIOLADO);
    expect(error?.message).toMatch(/profiles_agency_id_rol_check/);
    expect(await perfilPorId(ids.contacto)).toEqual({ role: 'client', agency_id: null });
  });
});

// Criterio de aceptación 5 del spec. Sin esto, el aislamiento del paso 2 no hace falta romperlo: se
// esquiva cambiándose de inquilino, y las políticas del inquilino nuevo te dejan ver lo que hay ahí.
describe('nadie se cambia de agencia', () => {
  it('un usuario de agencia no puede mover su propio agency_id a otra agencia', async () => {
    const agencia = await sesionDe(correos.agencia);

    // Este destino es válido para el check (rol de agencia + agencia no nula), así que lo único que
    // puede rechazar la escritura es el privilegio de columna. Si se probara con `null`, un 23514
    // del check dejaría pasar la prueba sin que el privilegio existiera.
    const { error } = await agencia.from('profiles').update({ agency_id: ids.senuelo }).eq('id', ids.agencia);

    expect(error?.code).toBe(PERMISO_DENEGADO);
    expect(await perfilPorId(ids.agencia)).toEqual({ role: 'agency_admin', agency_id: idAgencia });
  });

  it('un contacto de cliente tampoco puede darse una agencia', async () => {
    const contacto = await sesionDe(correos.contacto);

    const { error } = await contacto.from('profiles').update({ agency_id: ids.senuelo }).eq('id', ids.contacto);

    expect(error?.code).toBe(PERMISO_DENEGADO);
    expect(await perfilPorId(ids.contacto)).toEqual({ role: 'client', agency_id: null });
  });

  it('un usuario de agencia no puede mudar una marca a otra agencia', async () => {
    const agencia = await sesionDe(correos.agencia);

    // `clients` no estaba en la lista de 0007; esta protección nace en 0009. Mudar una marca se
    // llevaría con ella sus piezas, ideas, comentarios y adjuntos al panel de otra agencia.
    const { error } = await agencia.from('clients').update({ agency_id: ids.senuelo }).eq('id', ids.marca);

    expect(error?.code).toBe(PERMISO_DENEGADO);
    const { data } = await admin.from('clients').select('agency_id').eq('id', ids.marca).single();
    expect(data?.agency_id).toBe(idAgencia);
  });
});

// El bloque de privilegios de 0009 SUSTITUYE al de 0007: lo reejecuta con el conjunto protegido
// ampliado. Eso significa que quitar una tabla de esa lista por descuido devolvería el privilegio en
// silencio, y ninguna prueba de 0007 lo notaría, porque aquel archivo ya no es el que manda. Estas
// pruebas son la red para ese fallo concreto, y por eso repiten a propósito lo que ya cubre
// privilegios.test.ts.
describe('las protecciones de 0007 siguen en pie después de 0009', () => {
  it('profiles.role sigue cerrado para authenticated', async () => {
    const contacto = await sesionDe(correos.contacto);

    const { error } = await contacto.from('profiles').update({ role: 'agency_admin' }).eq('id', ids.contacto);

    expect(error?.code).toBe(PERMISO_DENEGADO);
    expect((await perfilPorId(ids.contacto))?.role).toBe('client');
  });

  it('content_pieces.status sigue cerrado en el insert y en el update', async () => {
    const agencia = await sesionDe(correos.agencia);

    const { error: errorInsert } = await agencia.from('content_pieces').insert({
      client_id: ids.marca,
      platform: 'instagram',
      format: 'post',
      title: 'Nace aprobada',
      scheduled_at: enUnDia(),
      status: 'aprobado',
    });
    expect(errorInsert?.code).toBe(PERMISO_DENEGADO);

    const { data: pieza, error: errorCrear } = await admin
      .from('content_pieces')
      .insert({
        client_id: ids.marca,
        platform: 'instagram',
        format: 'post',
        title: 'Pieza para el update',
        scheduled_at: enUnDia(),
      })
      .select('id')
      .single();
    if (errorCrear) throw errorCrear;

    const { error: errorUpdate } = await agencia
      .from('content_pieces')
      .update({ status: 'aprobado' })
      .eq('id', pieza.id);
    expect(errorUpdate?.code).toBe(PERMISO_DENEGADO);

    const { data } = await admin.from('content_pieces').select('status').eq('id', pieza.id).single();
    expect(data?.status).toBe('borrador');
  });

  it('ideas.status sigue cerrado para authenticated', async () => {
    const { data: idea, error: errorCrear } = await admin
      .from('ideas')
      .insert({
        client_id: ids.marca,
        title: `Idea agencias ${sufijo}`,
        description: 'Descripcion de prueba',
        created_by: ids.agencia,
      })
      .select('id')
      .single();
    if (errorCrear) throw errorCrear;

    const agencia = await sesionDe(correos.agencia);
    const { error } = await agencia.from('ideas').update({ status: 'aprobada' }).eq('id', idea.id);

    expect(error?.code).toBe(PERMISO_DENEGADO);
    const { data } = await admin.from('ideas').select('status').eq('id', idea.id).single();
    expect(data?.status).toBe('propuesta');
  });
});

// Demostrar que unas escrituras están cerradas no dice nada si el producto quedó cerrado con ellas.
// Estas tres son las que el bloque de 0009 podría haber roto al revocar el privilegio de tabla sin
// devolverlo bien columna por columna — y `clients` es nueva en esa lista, así que su re-otorgamiento
// nunca estuvo probado por nadie.
describe('lo que tiene que seguir funcionando', () => {
  it('service_role todavía escribe profiles.role y profiles.agency_id', async () => {
    // Si esto se rompiera, `crearUsuario` dejaría de poder dar de alta a un miembro del equipo: es
    // el único camino que fija el rol, y desde 0009 también la agencia.
    const { error } = await admin
      .from('profiles')
      .update({ role: 'agency_member', agency_id: idAgencia })
      .eq('id', ids.agencia);
    expect(error).toBeNull();
    expect(await perfilPorId(ids.agencia)).toEqual({ role: 'agency_member', agency_id: idAgencia });

    const { error: errorVuelta } = await admin
      .from('profiles')
      .update({ role: 'agency_admin', agency_id: idAgencia })
      .eq('id', ids.agencia);
    expect(errorVuelta).toBeNull();
  });

  it('authenticated todavía escribe content_pieces.title', async () => {
    const { data: pieza, error: errorCrear } = await admin
      .from('content_pieces')
      .insert({
        client_id: ids.marca,
        platform: 'instagram',
        format: 'post',
        title: 'Título original',
        scheduled_at: enUnDia(),
      })
      .select('id')
      .single();
    if (errorCrear) throw errorCrear;

    const agencia = await sesionDe(correos.agencia);
    const { error } = await agencia
      .from('content_pieces')
      .update({ title: 'Título editado' })
      .eq('id', pieza.id);

    expect(error).toBeNull();
    const { data } = await admin.from('content_pieces').select('title').eq('id', pieza.id).single();
    expect(data?.title).toBe('Título editado');
  });

  it('authenticated todavía escribe clients.name', async () => {
    const agencia = await sesionDe(correos.agencia);
    const nuevo = `Marca agencias renombrada ${sufijo}`;

    const { error } = await agencia.from('clients').update({ name: nuevo }).eq('id', ids.marca);

    expect(error).toBeNull();
    const { data } = await admin.from('clients').select('name').eq('id', ids.marca).single();
    expect(data?.name).toBe(nuevo);
  });
});
