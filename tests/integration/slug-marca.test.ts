import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Corre contra la Supabase LOCAL de `npm run test:integration`, nunca contra un proyecto remoto.
// Verifica la migración 0015: el slug sale del nombre, es único, no cambia al renombrar la marca,
// y un usuario autenticado no puede escribirlo.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SERVICE) {
  throw new Error('Faltan credenciales de Supabase local. Corre `npm run test:integration`.');
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const PASSWORD = 'contrasena-de-prueba-1234';
const sufijo = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const ids: { agencia?: string; marcas: string[] } = { marcas: [] };
let usuario: SupabaseClient;

async function crearMarca(brand_name: string): Promise<{ id: string; slug: string }> {
  const { data, error } = await admin
    .from('clients')
    .insert({ name: `${brand_name} ${sufijo}`, brand_name, agency_id: ids.agencia, timezone: 'UTC' })
    .select('id,slug')
    .single();
  if (error) throw new Error(error.message);
  ids.marcas.push(data.id);
  return data as { id: string; slug: string };
}

beforeAll(async () => {
  const { data: agencia, error } = await admin.from('agencies').insert({ name: `Slug ${sufijo}` }).select('id').single();
  if (error) throw error;
  ids.agencia = agencia.id;

  const correo = `slug-${sufijo}@test.local`;
  const { data: creado, error: errUsuario } = await admin.auth.admin.createUser({
    email: correo,
    password: PASSWORD,
    email_confirm: true,
  });
  if (errUsuario) throw errUsuario;
  usuario = createClient(URL!, ANON!, { auth: { persistSession: false } });
  await usuario.auth.signInWithPassword({ email: correo, password: PASSWORD });
  await admin.from('profiles').update({ role: 'agency_admin', agency_id: ids.agencia }).eq('id', creado.user.id);
});

afterAll(async () => {
  if (ids.marcas.length > 0) await admin.from('clients').delete().in('id', ids.marcas);
});

describe('slug de la marca (migración 0015)', () => {
  it('sale del nombre, sin acentos ni espacios', async () => {
    const marca = await crearMarca('Café Lúcuma');
    expect(marca.slug).toBe('cafe-lucuma');
  });

  it('una marca con el mismo nombre recibe un sufijo, no un duplicado', async () => {
    const primera = await crearMarca('Marca Dos');
    const segunda = await crearMarca('Marca Dos');
    expect(primera.slug).toBe('marca-dos');
    expect(segunda.slug).toBe('marca-dos-2');
  });

  it('renombrar la marca no cambia su slug', async () => {
    const marca = await crearMarca('Nombre Viejo');
    await admin.from('clients').update({ brand_name: 'Nombre Nuevo' }).eq('id', marca.id);
    const { data } = await admin.from('clients').select('slug').eq('id', marca.id).single();
    expect(data?.slug).toBe('nombre-viejo');
  });

  it('un usuario autenticado no puede escribir el slug', async () => {
    const marca = await crearMarca('Protegida');
    const { error } = await usuario.from('clients').update({ slug: 'robado' }).eq('id', marca.id);
    expect(error?.code).toBe('42501');
  });
});
