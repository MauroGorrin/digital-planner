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
  agencia: `adj-agencia-${sufijo}@prueba.local`,
  contacto: `adj-contacto-${sufijo}@prueba.local`,
};

const ids = { agencia: '', contacto: '', cliente: '', pieza: '' };

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

async function insertarAdjunto(nombre: string, replacesId: string | null = null) {
  const { data, error } = await admin
    .from('attachments')
    .insert({
      content_piece_id: ids.pieza,
      file_path: `${ids.cliente}/${ids.pieza}/${nombre}`,
      file_name: nombre,
      file_type: 'video/mp4',
      file_size: 1024,
      uploaded_by: ids.agencia,
      replaces_id: replacesId,
    })
    .select('id, review_round')
    .single();
  return { data, error };
}

beforeAll(async () => {
  ids.agencia = await crearUsuario(correos.agencia);
  ids.contacto = await crearUsuario(correos.contacto);
  await admin.from('profiles').update({ role: 'agency_admin' }).eq('id', ids.agencia);
  await admin.from('profiles').update({ role: 'client' }).eq('id', ids.contacto);

  const { data: cliente } = await admin
    .from('clients')
    .insert({ name: `Cliente adj ${sufijo}`, brand_name: 'Marca adj' })
    .select('id')
    .single();
  ids.cliente = cliente!.id;

  await admin
    .from('client_contacts')
    .insert({ client_id: ids.cliente, profile_id: ids.contacto });

  const { data: pieza } = await admin
    .from('content_pieces')
    .insert({
      client_id: ids.cliente,
      platform: 'instagram',
      format: 'reel',
      title: 'Pieza de adjuntos',
      copy_text: 'x',
      scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
    })
    .select('id')
    .single();
  ids.pieza = pieza!.id;
});

afterAll(async () => {
  if (ids.cliente) await admin.from('clients').delete().eq('id', ids.cliente);
  for (const id of [ids.agencia, ids.contacto]) {
    if (id) await admin.auth.admin.deleteUser(id);
  }
});

describe('versionado de adjuntos', () => {
  it('asigna la ronda 1 antes de cualquier solicitud de cambios', async () => {
    const { data, error } = await insertarAdjunto('v1.mp4');
    expect(error).toBeNull();
    expect(data!.review_round).toBe(1);
  });

  it('asigna la ronda 2 a lo subido despues de un cambios_solicitados', async () => {
    await admin.from('status_history').insert({
      content_piece_id: ids.pieza,
      from_status: 'pendiente_revision',
      to_status: 'cambios_solicitados',
      changed_by: ids.agencia,
    });

    const { data, error } = await insertarAdjunto('v2.mp4');
    expect(error).toBeNull();
    expect(data!.review_round).toBe(2);
  });

  it('ignora la ronda que mande el cliente y usa la que calcula la base', async () => {
    const { data, error } = await admin
      .from('attachments')
      .insert({
        content_piece_id: ids.pieza,
        file_path: `${ids.cliente}/${ids.pieza}/mentira.mp4`,
        file_name: 'mentira.mp4',
        file_type: 'video/mp4',
        file_size: 1024,
        uploaded_by: ids.agencia,
        review_round: 99,
      })
      .select('review_round')
      .single();
    expect(error).toBeNull();
    expect(data!.review_round).toBe(2);
  });

  it('impide que dos adjuntos reemplacen al mismo padre', async () => {
    const { data: padre } = await insertarAdjunto('padre.mp4');
    const primero = await insertarAdjunto('reemplazo-a.mp4', padre!.id);
    expect(primero.error).toBeNull();

    const segundo = await insertarAdjunto('reemplazo-b.mp4', padre!.id);
    expect(segundo.error).not.toBeNull();
  });

  it('permite varios adjuntos originales sin reemplazo', async () => {
    const a = await insertarAdjunto('suelto-a.mp4');
    const b = await insertarAdjunto('suelto-b.mp4');
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
  });
});

describe('politica de borrado en storage', () => {
  // Un remove() sobre una ruta que no existe puede devolver exito sin borrar nada, asi que estas
  // pruebas operan sobre un objeto real subido de antemano y verifican el efecto (con el cliente
  // admin, que ignora RLS) en vez de fiarse solo del `error` que devuelve remove().
  async function subirObjetoReal(): Promise<string> {
    const ruta = `${ids.cliente}/${ids.pieza}/borrado-${Date.now()}-${Math.random()}.mp4`;
    const { error } = await admin.storage
      .from('attachments')
      .upload(ruta, new Blob(['contenido de prueba'], { type: 'video/mp4' }), {
        contentType: 'video/mp4',
      });
    if (error) throw error;
    return ruta;
  }

  async function existeObjeto(ruta: string): Promise<boolean> {
    const carpeta = ruta.slice(0, ruta.lastIndexOf('/'));
    const nombre = ruta.slice(ruta.lastIndexOf('/') + 1);
    const { data, error } = await admin.storage.from('attachments').list(carpeta);
    if (error) throw error;
    return (data ?? []).some((archivo) => archivo.name === nombre);
  }

  it('rechaza a un contacto de cliente', async () => {
    const ruta = await subirObjetoReal();
    const contacto = await sesionDe(correos.contacto);

    await contacto.storage.from('attachments').remove([ruta]);

    expect(await existeObjeto(ruta)).toBe(true);

    await admin.storage.from('attachments').remove([ruta]);
  });

  it('permite a un usuario de agencia', async () => {
    const ruta = await subirObjetoReal();
    const agencia = await sesionDe(correos.agencia);

    await agencia.storage.from('attachments').remove([ruta]);

    expect(await existeObjeto(ruta)).toBe(false);
  });
});
