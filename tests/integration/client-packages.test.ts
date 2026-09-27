import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
  agencia: `paquetes-agencia-${sufijo}@prueba.local`,
  cliente: `paquetes-cliente-${sufijo}@prueba.local`,
};

const ids = { agencia: '', cliente: '', marca: '', marcaB: '' };

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

beforeAll(async () => {
  ids.agencia = await crearUsuario(correos.agencia);
  ids.cliente = await crearUsuario(correos.cliente);
  await admin.from('profiles').update({ role: 'agency_admin' }).eq('id', ids.agencia);
  await admin.from('profiles').update({ role: 'client' }).eq('id', ids.cliente);

  const { data: marca, error } = await admin
    .from('clients')
    .insert({
      name: `Marca paquetes ${sufijo}`,
      brand_name: 'Paquetes',
      timezone: 'America/Mexico_City',
      created_by: ids.agencia,
    })
    .select('id')
    .single();
  if (error) throw error;
  ids.marca = marca.id;

  await admin.from('client_contacts').insert({ client_id: ids.marca, profile_id: ids.cliente });
  await admin.from('client_assignments').insert({ client_id: ids.marca, profile_id: ids.agencia });

  // Segunda marca, sin ningun contacto asignado: la unica forma de que un contacto de `ids.marca`
  // termine leyendo su paquete es que la politica no aisle por marca.
  const { data: marcaB, error: errorMarcaB } = await admin
    .from('clients')
    .insert({
      name: `Marca paquetes B ${sufijo}`,
      brand_name: 'Paquetes B',
      timezone: 'America/Mexico_City',
      created_by: ids.agencia,
    })
    .select('id')
    .single();
  if (errorMarcaB) throw errorMarcaB;
  ids.marcaB = marcaB.id;

  const { error: errorPaquetes } = await admin.from('client_packages').insert([
    { client_id: ids.marca, format: 'post', monthly_quota: 12 },
    { client_id: ids.marca, format: 'reel', monthly_quota: 8 },
    { client_id: ids.marcaB, format: 'post', monthly_quota: 20 },
  ]);
  if (errorPaquetes) throw errorPaquetes;
});

afterAll(async () => {
  await admin.from('clients').delete().eq('id', ids.marca);
  await admin.from('clients').delete().eq('id', ids.marcaB);
  for (const id of [ids.agencia, ids.cliente]) {
    if (id) await admin.auth.admin.deleteUser(id);
  }
});

describe('lectura del paquete', () => {
  it('un contacto del cliente lee el paquete de su propia marca', async () => {
    const cliente = await sesionDe(correos.cliente);
    const { data, error } = await cliente
      .from('client_packages')
      .select('format, monthly_quota')
      .eq('client_id', ids.marca);
    if (error) throw error;

    const porFormato = Object.fromEntries((data ?? []).map((f) => [f.format, f.monthly_quota]));
    expect(porFormato).toEqual({ post: 12, reel: 8 });
  });

  // Se asiste sobre el valor devuelto, no solo sobre la longitud: una politica rota que
  // devolviera una fila de la marca B en vez de ninguna tiene que hacer fallar esta prueba, y
  // solo lo hace si se mira el contenido.
  it('un contacto del cliente obtiene cero filas del paquete de otra marca', async () => {
    const cliente = await sesionDe(correos.cliente);
    const { data, error } = await cliente
      .from('client_packages')
      .select('client_id, format, monthly_quota')
      .eq('client_id', ids.marcaB);
    if (error) throw error;

    expect(data).toEqual([]);
  });

  it('la agencia lee el paquete de cualquier marca', async () => {
    const agencia = await sesionDe(correos.agencia);
    const { data, error } = await agencia
      .from('client_packages')
      .select('format, monthly_quota')
      .eq('client_id', ids.marcaB);
    if (error) throw error;

    expect(data).toEqual([{ format: 'post', monthly_quota: 20 }]);
  });
});

describe('escritura del paquete', () => {
  it('un contacto del cliente no puede insertar su propio paquete', async () => {
    const cliente = await sesionDe(correos.cliente);
    const { error } = await cliente
      .from('client_packages')
      .insert({ client_id: ids.marca, format: 'video', monthly_quota: 4 });

    expect(error?.code).toBe('42501');
    expect(error?.message).toMatch(/row-level security policy/i);
  });

  it('un contacto del cliente no puede actualizar su propio paquete', async () => {
    const cliente = await sesionDe(correos.cliente);
    const { error, data } = await cliente
      .from('client_packages')
      .update({ monthly_quota: 99 })
      .eq('client_id', ids.marca)
      .eq('format', 'post')
      .select();

    // Un update sin `using` que autorice al llamador no lanza error de RLS: la clausula
    // `using` de la politica de select/update filtra la fila antes de tocarla, asi que
    // PostgREST no encuentra ninguna fila para actualizar y devuelve exito con un arreglo
    // vacio. El cambio no ocurrio, y se confirma leyendo la fila de nuevo con la agencia.
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const agencia = await sesionDe(correos.agencia);
    const { data: fila, error: errorLectura } = await agencia
      .from('client_packages')
      .select('monthly_quota')
      .eq('client_id', ids.marca)
      .eq('format', 'post')
      .single();
    if (errorLectura) throw errorLectura;
    expect(fila.monthly_quota).toBe(12);
  });

  it('la agencia puede insertar una fila del paquete', async () => {
    const agencia = await sesionDe(correos.agencia);
    const { error } = await agencia
      .from('client_packages')
      .insert({ client_id: ids.marca, format: 'video', monthly_quota: 2 });

    expect(error).toBeNull();
  });

  it('la agencia puede actualizar una fila del paquete', async () => {
    const agencia = await sesionDe(correos.agencia);
    const { error, data } = await agencia
      .from('client_packages')
      .update({ monthly_quota: 15 })
      .eq('client_id', ids.marca)
      .eq('format', 'post')
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.monthly_quota).toBe(15);
  });
});

describe('el check de la cuota', () => {
  it('monthly_quota = 0 se rechaza por el check', async () => {
    const { error } = await admin
      .from('client_packages')
      .insert({ client_id: ids.marca, format: 'carrusel', monthly_quota: 0 });

    expect(error?.code).toBe('23514');
    expect(error?.message).toMatch(/client_packages_monthly_quota_check/);
  });

  it('monthly_quota negativo se rechaza por el check', async () => {
    const { error } = await admin
      .from('client_packages')
      .insert({ client_id: ids.marca, format: 'carrusel', monthly_quota: -3 });

    expect(error?.code).toBe('23514');
    expect(error?.message).toMatch(/client_packages_monthly_quota_check/);
  });
});
