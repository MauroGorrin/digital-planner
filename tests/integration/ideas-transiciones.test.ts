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
  agencia: `ideas-transiciones-agencia-${sufijo}@prueba.local`,
  cliente: `ideas-transiciones-cliente-${sufijo}@prueba.local`,
};

const ids = { agencia: '', cliente: '', marca: '' };

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

async function crearIdea(titulo: string, status: string) {
  const { data, error } = await admin
    .from('ideas')
    .insert({
      client_id: ids.marca,
      title: titulo,
      description: 'Descripcion de prueba',
      status,
      created_by: ids.agencia,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

beforeAll(async () => {
  ids.agencia = await crearUsuario(correos.agencia);
  ids.cliente = await crearUsuario(correos.cliente);
  await admin.from('profiles').update({ role: 'agency_admin' }).eq('id', ids.agencia);
  await admin.from('profiles').update({ role: 'client' }).eq('id', ids.cliente);

  const { data: marca, error } = await admin
    .from('clients')
    .insert({
      name: `Marca transiciones ${sufijo}`,
      brand_name: 'Transiciones',
      timezone: 'America/Mexico_City',
      created_by: ids.agencia,
    })
    .select('id')
    .single();
  if (error) throw error;
  ids.marca = marca.id;

  await admin.from('client_contacts').insert({ client_id: ids.marca, profile_id: ids.cliente });
  await admin.from('client_assignments').insert({ client_id: ids.marca, profile_id: ids.agencia });
});

afterAll(async () => {
  await admin.from('clients').delete().eq('id', ids.marca);
  for (const id of [ids.agencia, ids.cliente]) {
    if (id) await admin.auth.admin.deleteUser(id);
  }
});

describe('transiciones de ideas', () => {
  it('un usuario de agencia no puede aprobar', async () => {
    const idea = await crearIdea('Para aprobar', 'pendiente_cliente');
    const agencia = await sesionDe(correos.agencia);

    const { error } = await agencia.rpc('approve_idea', { p_idea_id: idea, p_note: null });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/solo el cliente/i);
  });

  it('un contacto del cliente no puede enviar al cliente', async () => {
    const idea = await crearIdea('En propuesta', 'propuesta');
    const cliente = await sesionDe(correos.cliente);

    const { error } = await cliente.rpc('submit_idea_to_client', { p_idea_id: idea });

    expect(error).not.toBeNull();
  });

  it('pedir correccion sin nota es rechazado', async () => {
    const idea = await crearIdea('Sin nota', 'pendiente_cliente');
    const cliente = await sesionDe(correos.cliente);

    const { error } = await cliente.rpc('request_idea_client_changes', {
      p_idea_id: idea,
      p_note: '   ',
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/nota/i);
  });

  it('pedir correccion con nota la registra en el historial', async () => {
    const idea = await crearIdea('Con nota', 'pendiente_cliente');
    const cliente = await sesionDe(correos.cliente);

    const { error } = await cliente.rpc('request_idea_client_changes', {
      p_idea_id: idea,
      p_note: 'El tono no es el de la marca',
    });
    expect(error).toBeNull();

    const { data } = await admin
      .from('idea_status_history')
      .select('to_status, note')
      .eq('idea_id', idea)
      .single();

    expect(data!.to_status).toBe('correccion_cliente');
    expect(data!.note).toBe('El tono no es el de la marca');
  });

  it('reenviar devuelve la idea a quien pidio el cambio', async () => {
    const agencia = await sesionDe(correos.agencia);

    const deInterna = await crearIdea('Corregida internamente', 'correccion_interna');
    await agencia.rpc('resubmit_idea', { p_idea_id: deInterna });
    const { data: a } = await admin.from('ideas').select('status').eq('id', deInterna).single();
    expect(a!.status).toBe('propuesta');

    const delCliente = await crearIdea('Corregida para el cliente', 'correccion_cliente');
    await agencia.rpc('resubmit_idea', { p_idea_id: delCliente });
    const { data: b } = await admin.from('ideas').select('status').eq('id', delCliente).single();
    expect(b!.status).toBe('pendiente_cliente');
  });

  it('descartar exige motivo y lo registra', async () => {
    const idea = await crearIdea('A descartar', 'propuesta');
    const agencia = await sesionDe(correos.agencia);

    const sinMotivo = await agencia.rpc('discard_idea', { p_idea_id: idea, p_reason: '' });
    expect(sinMotivo.error).not.toBeNull();

    const conMotivo = await agencia.rpc('discard_idea', {
      p_idea_id: idea,
      p_reason: 'Ya se hizo algo igual en julio',
    });
    expect(conMotivo.error).toBeNull();

    const { data } = await admin.from('ideas').select('status').eq('id', idea).single();
    expect(data!.status).toBe('descartada');
  });

  it('enviar al cliente notifica a cada contacto de la marca', async () => {
    const idea = await crearIdea('Para el cliente', 'propuesta');
    const agencia = await sesionDe(correos.agencia);

    const { error } = await agencia.rpc('submit_idea_to_client', { p_idea_id: idea });
    expect(error).toBeNull();

    const { data } = await admin
      .from('notifications')
      .select('profile_id, idea_id, content_piece_id')
      .eq('idea_id', idea);

    expect(data).toHaveLength(1);
    expect(data![0].profile_id).toBe(ids.cliente);
    expect(data![0].content_piece_id).toBeNull();
  });

  it('un contacto del cliente no puede leer el historial de una idea que no puede ver', async () => {
    const idea = await crearIdea('Oculta para el cliente', 'propuesta');
    const agencia = await sesionDe(correos.agencia);
    // La transicion queda en 'correccion_interna', que el cliente tampoco puede ver, asi que su
    // historial deberia seguir oculto.
    const { error } = await agencia.rpc('request_idea_internal_changes', {
      p_idea_id: idea,
      p_note: 'Falta el gancho inicial',
    });
    expect(error).toBeNull();

    const cliente = await sesionDe(correos.cliente);
    const { data } = await cliente.from('idea_status_history').select('id').eq('idea_id', idea);

    expect(data).toEqual([]);
  });

  it('un contacto del cliente si puede leer el historial de una idea que si puede ver', async () => {
    const idea = await crearIdea('Visible para el cliente', 'propuesta');
    const agencia = await sesionDe(correos.agencia);
    // La transicion deja la idea en 'pendiente_cliente', visible para el cliente, y escribe una
    // fila de historial propia para esta idea.
    const { error } = await agencia.rpc('submit_idea_to_client', { p_idea_id: idea });
    expect(error).toBeNull();

    const cliente = await sesionDe(correos.cliente);
    const { data } = await cliente
      .from('idea_status_history')
      .select('id, to_status')
      .eq('idea_id', idea);

    expect(data).toHaveLength(1);
    expect(data![0].to_status).toBe('pendiente_cliente');
  });
});
