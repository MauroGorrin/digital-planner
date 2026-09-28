import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agenciaDelBackfill } from './agencia';

/**
 * crear_mi_agencia() -- la unica via por la que alguien se convierte en administrador de agencia sin
 * que otro administrador lo haga.
 *
 * Es el camino que reabre, acotado, lo que 0007 cerro: alli el rol salia de la metadata del signup
 * publico y te hacia administrador de TODO el sistema. Aqui te hace administrador de una agencia
 * nueva y vacia, y solo si eres un registrado recien llegado. Lo que estas pruebas vigilan es esa
 * frontera: sobre todo que un contacto de cliente invitado -- que en el perfil es indistinguible de
 * un registrado, los dos son `client` sin agencia -- NO pueda promoverse.
 */

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
// P0001 es el codigo de un `raise exception` de las funciones del proyecto.
const REGLA_DE_NEGOCIO = 'P0001';

const creados: string[] = [];
const agenciasCreadas: string[] = [];
let marcaDelBackfill = '';

async function registrado(etiqueta: string, nombreAgencia?: string) {
  const email = `alta-${etiqueta}-${sufijo}@prueba.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: {
      full_name: `Persona ${etiqueta}`,
      phone: '+584141234567',
      ...(nombreAgencia ? { agency_name: nombreAgencia } : {}),
    },
  });
  if (error) throw error;
  creados.push(data.user.id);
  return { id: data.user.id, email };
}

async function sesionDe(email: string): Promise<SupabaseClient> {
  const cliente = createClient(URL!, ANON!, { auth: { persistSession: false } });
  const { error } = await cliente.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return cliente;
}

async function perfil(id: string) {
  const { data, error } = await admin.from('profiles').select('role, agency_id, phone').eq('id', id).single();
  if (error) throw error;
  return data;
}

async function agenciasLlamadas(nombre: string) {
  const { data, error } = await admin.from('agencies').select('id').eq('name', nombre);
  if (error) throw error;
  return (data ?? []).map((a) => a.id as string);
}

beforeAll(async () => {
  // Una marca real en la agencia del backfill, para poder afirmar que la agencia nueva NO la ve.
  const agencia = await agenciaDelBackfill(admin);
  const { data, error } = await admin
    .from('clients')
    .insert({ name: `Marca previa ${sufijo}`, brand_name: 'Previa', timezone: 'America/Caracas', agency_id: agencia })
    .select('id')
    .single();
  if (error) throw error;
  marcaDelBackfill = data.id;
});

afterAll(async () => {
  for (const id of creados) await admin.auth.admin.deleteUser(id);
  for (const id of agenciasCreadas) await admin.from('agencies').delete().eq('id', id);
  if (marcaDelBackfill) await admin.from('clients').delete().eq('id', marcaDelBackfill);
});

describe('crear_mi_agencia: quien se registra se vuelve administrador de SU agencia nueva', () => {
  it('promueve a un registrado: una agencia, rol agency_admin y agency_id puestos en el mismo paso', async () => {
    const nombre = `Agencia feliz ${sufijo}`;
    const { id, email } = await registrado('feliz', nombre);
    const sesion = await sesionDe(email);

    const { data: agenciaId, error } = await sesion.rpc('crear_mi_agencia');
    expect(error).toBeNull();
    agenciasCreadas.push(agenciaId as string);

    expect(await agenciasLlamadas(nombre)).toEqual([agenciaId]);
    expect(await perfil(id)).toMatchObject({ role: 'agency_admin', agency_id: agenciaId, phone: '+584141234567' });
  });

  it('rechaza la segunda llamada y no crea una segunda agencia', async () => {
    const nombre = `Agencia dos veces ${sufijo}`;
    const { email } = await registrado('dos-veces', nombre);
    const sesion = await sesionDe(email);

    const primera = await sesion.rpc('crear_mi_agencia');
    expect(primera.error).toBeNull();
    agenciasCreadas.push(primera.data as string);

    const segunda = await sesion.rpc('crear_mi_agencia');
    expect(segunda.error?.code).toBe(REGLA_DE_NEGOCIO);
    expect(segunda.error?.message).toMatch(/ya pertenece a una agencia/i);
    expect(await agenciasLlamadas(nombre)).toHaveLength(1);
  });

  it('un CONTACTO DE CLIENTE invitado no puede promoverse, aunque en el perfil sea igual a un registrado', async () => {
    // Es la prueba que importa. El contacto invitado y el registrado son los dos `client` sin
    // agencia; lo unico que los separa es la fila en client_contacts. Si la funcion dejara de
    // mirarla, esta prueba es la que tiene que caer.
    const nombre = `Agencia del contacto ${sufijo}`;
    const { id, email } = await registrado('contacto', nombre);
    const { error: errorVinculo } = await admin
      .from('client_contacts')
      .insert({ client_id: marcaDelBackfill, profile_id: id });
    if (errorVinculo) throw errorVinculo;

    const sesion = await sesionDe(email);
    const { error } = await sesion.rpc('crear_mi_agencia');

    expect(error?.code).toBe(REGLA_DE_NEGOCIO);
    expect(error?.message).toMatch(/contacto de cliente/i);
    expect(await perfil(id)).toMatchObject({ role: 'client', agency_id: null });
    expect(await agenciasLlamadas(nombre)).toEqual([]);
  });

  it('quien ya es personal de una agencia no puede crearse otra', async () => {
    const agencia = await agenciaDelBackfill(admin);
    const { id, email } = await registrado('personal', `Agencia paralela ${sufijo}`);
    const { error: errorRol } = await admin
      .from('profiles')
      .update({ role: 'agency_member', agency_id: agencia })
      .eq('id', id);
    if (errorRol) throw errorRol;

    const sesion = await sesionDe(email);
    const { error } = await sesion.rpc('crear_mi_agencia');

    expect(error?.code).toBe(REGLA_DE_NEGOCIO);
    expect(error?.message).toMatch(/ya pertenece a una agencia/i);
    expect(await perfil(id)).toMatchObject({ role: 'agency_member', agency_id: agencia });
  });

  it('la agencia nueva nace vacia: su administrador no ve nada de la agencia existente', async () => {
    const { email } = await registrado('vacia', `Agencia vacia ${sufijo}`);
    const sesion = await sesionDe(email);
    const { data: agenciaId, error } = await sesion.rpc('crear_mi_agencia');
    expect(error).toBeNull();
    agenciasCreadas.push(agenciaId as string);

    // Se consulta de nuevo con sesion fresca: el rol cambio dentro de la RPC y se lee de profiles
    // en cada politica, pero conviene no depender de nada cacheado en el cliente.
    const nueva = await sesionDe(email);
    for (const tabla of ['clients', 'content_pieces', 'ideas', 'client_packages'] as const) {
      // client_packages no tiene columna id: su clave es (client_id, format). Se pide client_id,
      // que existe en las cuatro tablas, para que la consulta no falle por otra cosa.
      const { data, error: errorLectura } = await nueva.from(tabla).select(tabla === 'clients' ? 'id' : 'client_id');
      expect(errorLectura).toBeNull();
      expect(data, `${tabla} deberia estar vacia para la agencia nueva`).toEqual([]);
    }

    const { data: agencias } = await nueva.from('agencies').select('id');
    expect((agencias ?? []).map((a) => a.id)).toEqual([agenciaId]);
  });

  // LO QUE ESTA PRUEBA NO DEMUESTRA, verificado: quitarle a crear_mi_agencia() su `for update` la
  // deja en verde igual. Dos peticiones en paralelo por PostgREST no se solapan de forma fiable
  // dentro de la ventana entre la lectura del perfil y su update, asi que la carrera casi nunca
  // ocurre aqui, con o sin bloqueo. El bloqueo se sostiene por razonamiento, no por esta prueba.
  // Lo que SI comprueba es el resultado visible de un doble clic -- una agencia, no dos --, que es
  // una propiedad que vale la pena fijar aunque no aisle la causa. No la leas como cobertura del lock.
  it('un doble clic deja UNA agencia (no prueba el bloqueo: ver comentario)', async () => {
    const nombre = `Agencia doble clic ${sufijo}`;
    const { email } = await registrado('doble-clic', nombre);
    const [a, b] = await Promise.all([sesionDe(email), sesionDe(email)]);

    const resultados = await Promise.all([a.rpc('crear_mi_agencia'), b.rpc('crear_mi_agencia')]);
    const exitos = resultados.filter((r) => !r.error);
    for (const r of exitos) agenciasCreadas.push(r.data as string);

    expect(exitos).toHaveLength(1);
    expect(await agenciasLlamadas(nombre)).toHaveLength(1);
  });

  it('sin sesion no se puede llamar', async () => {
    const anonimo = createClient(URL!, ANON!, { auth: { persistSession: false } });
    const { error } = await anonimo.rpc('crear_mi_agencia', { p_nombre_agencia: 'Intruso' });
    expect(error).not.toBeNull();
    // 42501: se le quito el EXECUTE a anon; no llega ni a entrar en la funcion.
    expect(error?.code).toBe('42501');
  });
});
