import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SERVICE) {
  throw new Error(
    'Faltan credenciales de Supabase local. Corre `npm run test:integration`, que ejecuta ' +
      'scripts/write-supabase-test-env.mjs antes de Vitest.'
  );
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

const sufijo = Date.now();
const correoAgencia = `anc-agencia-${sufijo}@prueba.local`;

const ids = {
  agencia: '',
  clienteA: '',
  clienteB: '',
  piezaA: '',
  piezaB: '',
  adjuntoA: '',
  adjuntoB: '',
};

async function crearPieza(clientId: string, titulo: string) {
  const { data, error } = await admin
    .from('content_pieces')
    .insert({
      client_id: clientId,
      platform: 'instagram',
      format: 'reel',
      title: titulo,
      scheduled_at: new Date().toISOString(),
      created_by: ids.agencia,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

async function crearAdjunto(clientId: string, piezaId: string, nombre: string) {
  const { data, error } = await admin
    .from('attachments')
    .insert({
      content_piece_id: piezaId,
      file_path: `${clientId}/${piezaId}/${nombre}`,
      file_name: nombre,
      file_type: 'video/mp4',
      file_size: 1024,
      uploaded_by: ids.agencia,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

beforeAll(async () => {
  const { data: usuario, error } = await admin.auth.admin.createUser({
    email: correoAgencia,
    password: 'contrasena-de-prueba-1234',
    email_confirm: true,
  });
  if (error) throw error;
  ids.agencia = usuario.user.id;
  await admin.from('profiles').update({ role: 'agency_admin' }).eq('id', ids.agencia);

  const { data: marcaA } = await admin
    .from('clients')
    .insert({ name: `Marca A ${sufijo}`, brand_name: 'A', timezone: 'America/Mexico_City', created_by: ids.agencia })
    .select('id')
    .single();
  const { data: marcaB } = await admin
    .from('clients')
    .insert({ name: `Marca B ${sufijo}`, brand_name: 'B', timezone: 'America/Mexico_City', created_by: ids.agencia })
    .select('id')
    .single();
  ids.clienteA = marcaA!.id;
  ids.clienteB = marcaB!.id;

  ids.piezaA = await crearPieza(ids.clienteA, 'Pieza A');
  ids.piezaB = await crearPieza(ids.clienteB, 'Pieza B');
  ids.adjuntoA = await crearAdjunto(ids.clienteA, ids.piezaA, 'a.mp4');
  ids.adjuntoB = await crearAdjunto(ids.clienteB, ids.piezaB, 'b.mp4');
});

afterAll(async () => {
  await admin.from('clients').delete().eq('id', ids.clienteA);
  await admin.from('clients').delete().eq('id', ids.clienteB);
  if (ids.agencia) await admin.auth.admin.deleteUser(ids.agencia);
});

describe('anclas de comentarios', () => {
  it('acepta un comentario anclado a un adjunto de su propia pieza', async () => {
    const { data, error } = await admin
      .from('comments')
      .insert({
        content_piece_id: ids.piezaA,
        author_id: ids.agencia,
        body: 'En 0:12 el logo esta cortado',
        attachment_id: ids.adjuntoA,
        video_segundo: 12,
      })
      .select('id, video_segundo')
      .single();

    expect(error).toBeNull();
    expect(data!.video_segundo).toBe(12);
  });

  it('rechaza un comentario anclado a un adjunto de otra pieza', async () => {
    const { error } = await admin.from('comments').insert({
      content_piece_id: ids.piezaA,
      author_id: ids.agencia,
      body: 'Ancla invalida',
      attachment_id: ids.adjuntoB,
      video_segundo: 5,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/no pertenece a la pieza/);
  });

  it('conserva el comentario cuando se borra el adjunto al que apuntaba', async () => {
    const adjunto = await crearAdjunto(ids.clienteA, ids.piezaA, 'efimero.mp4');
    const { data: comentario } = await admin
      .from('comments')
      .insert({
        content_piece_id: ids.piezaA,
        author_id: ids.agencia,
        body: 'Sobrevive al borrado',
        attachment_id: adjunto,
        video_segundo: 30,
      })
      .select('id')
      .single();

    await admin.from('attachments').delete().eq('id', adjunto);

    const { data: despues } = await admin
      .from('comments')
      .select('id, body, attachment_id, video_segundo')
      .eq('id', comentario!.id)
      .single();

    expect(despues).not.toBeNull();
    expect(despues!.body).toBe('Sobrevive al borrado');
    expect(despues!.attachment_id).toBeNull();
    expect(despues!.video_segundo).toBe(30);
  });

  it('rechaza un INSERT con video_segundo sin attachment_id', async () => {
    const { error } = await admin.from('comments').insert({
      content_piece_id: ids.piezaA,
      author_id: ids.agencia,
      body: 'Ancla incompleta desde el principio',
      attachment_id: null,
      video_segundo: 7,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/no puede tener video_segundo sin attachment_id/);
  });

  it('rechaza un video_segundo negativo', async () => {
    const { error } = await admin.from('comments').insert({
      content_piece_id: ids.piezaA,
      author_id: ids.agencia,
      body: 'Segundo invalido',
      attachment_id: ids.adjuntoA,
      video_segundo: -1,
    });

    expect(error).not.toBeNull();
  });
});
