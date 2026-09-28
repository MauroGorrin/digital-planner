import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * renombrar_mi_agencia() -- 0012_renombrar_agencia.sql.
 *
 * Corre contra la Supabase LOCAL de `npm run test:integration`, nunca contra un proyecto remoto.
 *
 * DOS AGENCIAS NUEVAS, ninguna es la del backfill de 0009, por lo mismo que aislamiento.test.ts: la
 * prueba que importa es "el administrador de A no le cambia el nombre a B", y eso exige una B con
 * nombre conocido. Además, renombrar la agencia del backfill rompería `agenciaDelBackfill()`, que la
 * encuentra por su nombre 'Agencia' en todas las demás suites.
 *
 * CÓMO SE AFIRMA: después de cada rechazo se RELEE el nombre con el cliente de servicio. Que la RPC
 * devuelva error no prueba nada si el update ya se hizo antes de fallar; lo que se afirma es que la
 * fila quedó como estaba.
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
/** raise_exception: el código de cualquier `raise exception` de plpgsql (los guards en español). */
const REGLA_DE_NEGOCIO = 'P0001';

interface Agencia {
  nombreOriginal: string;
  id: string;
  admin: string;
  miembro: string;
  correoAdmin: string;
  correoMiembro: string;
}

const A = { nombreOriginal: `Renombrar A ${sufijo}` } as Agencia;
const B = { nombreOriginal: `Renombrar B ${sufijo}` } as Agencia;

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

async function nombreDe(agencia: string): Promise<string> {
  const { data, error } = await admin.from('agencies').select('name').eq('id', agencia).single();
  if (error) throw error;
  return data.name as string;
}

async function montarAgencia(f: Agencia, etiqueta: string) {
  const { data, error } = await admin.from('agencies').insert({ name: f.nombreOriginal }).select('id').single();
  if (error) throw error;
  f.id = data.id as string;

  f.correoAdmin = `renombrar-${etiqueta}-admin-${sufijo}@prueba.local`;
  f.correoMiembro = `renombrar-${etiqueta}-miembro-${sufijo}@prueba.local`;
  f.admin = await crearUsuario(f.correoAdmin);
  f.miembro = await crearUsuario(f.correoMiembro);

  // El rol y la agencia en el MISMO update: el check `profiles_agency_id_rol_check` de 0009 rechaza
  // un rol de agencia sin agencia.
  for (const [id, role] of [
    [f.admin, 'agency_admin'],
    [f.miembro, 'agency_member'],
  ] as const) {
    const { error: errorRol } = await admin.from('profiles').update({ role, agency_id: f.id }).eq('id', id);
    if (errorRol) throw errorRol;
  }
}

/** Vuelve a dejar el nombre original, para que cada prueba parta de un estado conocido. */
async function restaurar(f: Agencia) {
  const { error } = await admin.from('agencies').update({ name: f.nombreOriginal }).eq('id', f.id);
  if (error) throw error;
}

beforeAll(async () => {
  await montarAgencia(A, 'a');
  await montarAgencia(B, 'b');
});

afterAll(async () => {
  for (const f of [A, B]) {
    for (const id of [f.admin, f.miembro]) if (id) await admin.auth.admin.deleteUser(id);
  }
  // Las agencias al final: los perfiles las referencian y caen con el usuario.
  for (const f of [A, B]) if (f.id) await admin.from('agencies').delete().eq('id', f.id);
});

describe('renombrar_mi_agencia: el administrador le cambia el nombre a SU agencia, y a ninguna otra', () => {
  it('el administrador renombra su propia agencia, con el nombre recortado', async () => {
    await restaurar(A);
    const sesion = await sesionDe(A.correoAdmin);
    const nuevo = `Estudio Norte ${sufijo}`;

    const { error } = await sesion.rpc('renombrar_mi_agencia', { p_nombre: `  ${nuevo}  ` });

    expect(error).toBeNull();
    expect(await nombreDe(A.id)).toBe(nuevo);
    // Y lo ve él mismo por la política de lectura, que es por donde lo lee /ajustes.
    const { data } = await sesion.from('agencies').select('name').eq('id', A.id).single();
    expect(data?.name).toBe(nuevo);
  });

  it('un agency_member NO puede renombrar su agencia', async () => {
    await restaurar(A);
    const sesion = await sesionDe(A.correoMiembro);

    const { error } = await sesion.rpc('renombrar_mi_agencia', { p_nombre: `Intento del miembro ${sufijo}` });

    expect(error?.code).toBe(REGLA_DE_NEGOCIO);
    expect(error?.message).toMatch(/solo el administrador/i);
    expect(await nombreDe(A.id)).toBe(A.nombreOriginal);
  });

  it('el administrador de A NO puede renombrar la agencia B, por ningún camino', async () => {
    await restaurar(A);
    await restaurar(B);
    const sesion = await sesionDe(A.correoAdmin);

    // 1. La función no acepta la agencia como parámetro. Mandarla igual no la hace existir:
    //    PostgREST busca una firma (p_nombre, p_agencia) que no hay y rechaza la llamada.
    const conAgencia = await sesion.rpc('renombrar_mi_agencia', { p_nombre: `Robada ${sufijo}`, p_agencia: B.id });

    // 2. Ni la política de tabla: `agencies` no tiene política de escritura, así que un update
    //    directo no toca ninguna fila (ni la propia).
    const directo = await sesion.from('agencies').update({ name: `Robada directo ${sufijo}` }).eq('id', B.id).select('id');

    // 3. Y el camino legítimo renombra A, no B.
    const propio = await sesion.rpc('renombrar_mi_agencia', { p_nombre: `Sólo A ${sufijo}` });

    // Lo primero que se afirma es el estado de B, no los errores: si algo de lo anterior la tocó,
    // eso es lo que tiene que decir el fallo.
    expect(await nombreDe(B.id)).toBe(B.nombreOriginal);
    expect(await nombreDe(A.id)).toBe(`Sólo A ${sufijo}`);
    expect(conAgencia.error).not.toBeNull();
    expect(directo.data ?? []).toEqual([]);
    expect(propio.error).toBeNull();
  });

  it('rechaza un nombre vacío o sólo con espacios', async () => {
    await restaurar(A);
    const sesion = await sesionDe(A.correoAdmin);

    for (const p_nombre of ['', '    ']) {
      const { error } = await sesion.rpc('renombrar_mi_agencia', { p_nombre });
      expect(error?.code, `«${p_nombre}»`).toBe(REGLA_DE_NEGOCIO);
      expect(error?.message).toMatch(/falta el nombre/i);
    }
    expect(await nombreDe(A.id)).toBe(A.nombreOriginal);
  });

  it('acepta 80 caracteres y rechaza 81, el mismo tope que el alta', async () => {
    await restaurar(A);
    const sesion = await sesionDe(A.correoAdmin);

    const largo = await sesion.rpc('renombrar_mi_agencia', { p_nombre: 'x'.repeat(81) });
    expect(largo.error?.code).toBe(REGLA_DE_NEGOCIO);
    expect(largo.error?.message).toMatch(/80 caracteres/);
    expect(await nombreDe(A.id)).toBe(A.nombreOriginal);

    const justo = await sesion.rpc('renombrar_mi_agencia', { p_nombre: 'y'.repeat(80) });
    expect(justo.error).toBeNull();
    expect(await nombreDe(A.id)).toBe('y'.repeat(80));
  });

  it('sin sesión no se puede llamar', async () => {
    await restaurar(A);
    const anonimo = createClient(URL!, ANON!, { auth: { persistSession: false } });

    const { error } = await anonimo.rpc('renombrar_mi_agencia', { p_nombre: `Intruso ${sufijo}` });

    // 42501: se le quitó el EXECUTE a anon; no llega ni a entrar en la función.
    expect(error?.code).toBe('42501');
    expect(await nombreDe(A.id)).toBe(A.nombreOriginal);
    expect(await nombreDe(B.id)).toBe(B.nombreOriginal);
  });
});
