import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Corre contra la Supabase LOCAL levantada por `npm run test:integration`
// (supabase start && supabase db reset). Nunca contra un proyecto remoto: las credenciales salen
// de .env.test.local, que scripts/write-supabase-test-env.mjs genera desde `supabase status`.
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
  agencia: `agencia-${sufijo}@prueba.local`,
  contacto: `contacto-${sufijo}@prueba.local`,
  ajeno: `ajeno-${sufijo}@prueba.local`,
};

const ids = { agencia: '', contacto: '', ajeno: '', cliente: '', clienteAjeno: '', pieza: '' };

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

async function estadoDeLaPieza() {
  const { data } = await admin.from('content_pieces').select('status').eq('id', ids.pieza).single();
  return data?.status as string;
}

async function historial(to: string) {
  const { data } = await admin
    .from('status_history')
    .select('id')
    .eq('content_piece_id', ids.pieza)
    .eq('to_status', to);
  return data ?? [];
}

beforeAll(async () => {
  ids.agencia = await crearUsuario(correos.agencia);
  ids.contacto = await crearUsuario(correos.contacto);
  ids.ajeno = await crearUsuario(correos.ajeno);

  // handle_new_user() ya creó los profiles; el admin de agencia necesita su rol real.
  const { error: rolError } = await admin
    .from('profiles')
    .update({ role: 'agency_admin' })
    .eq('id', ids.agencia);
  if (rolError) throw rolError;

  const { data: cliente, error: cliError } = await admin
    .from('clients')
    .insert({ name: 'Cliente de prueba', brand_name: 'Marca de prueba' })
    .select('id')
    .single();
  if (cliError) throw cliError;
  ids.cliente = cliente.id;

  const { data: otro, error: otroError } = await admin
    .from('clients')
    .insert({ name: 'Otro cliente', brand_name: 'Otra marca' })
    .select('id')
    .single();
  if (otroError) throw otroError;
  ids.clienteAjeno = otro.id;

  const { error: contactoError } = await admin
    .from('client_contacts')
    .insert([
      { client_id: ids.cliente, profile_id: ids.contacto },
      { client_id: ids.clienteAjeno, profile_id: ids.ajeno },
    ]);
  if (contactoError) throw contactoError;

  const { data: pieza, error: piezaError } = await admin
    .from('content_pieces')
    .insert({
      client_id: ids.cliente,
      platform: 'instagram',
      format: 'reel',
      title: 'Pieza de prueba',
      copy_text: 'Texto de prueba.',
      scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
    })
    .select('id, status')
    .single();
  if (piezaError) throw piezaError;
  ids.pieza = pieza.id;

  expect(pieza.status).toBe('borrador');
});

afterAll(async () => {
  // Borrar los clients arrastra en cascada content_pieces, client_contacts, status_history y
  // approvals. Los usuarios de auth se borran aparte.
  if (ids.cliente) await admin.from('clients').delete().eq('id', ids.cliente);
  if (ids.clienteAjeno) await admin.from('clients').delete().eq('id', ids.clienteAjeno);
  for (const id of [ids.agencia, ids.contacto, ids.ajeno]) {
    if (id) await admin.auth.admin.deleteUser(id);
  }
});

describe('transiciones de estado con SECURITY DEFINER', () => {
  it('la agencia envía a revisión y queda registrado en status_history', async () => {
    const agencia = await sesionDe(correos.agencia);

    const { error } = await agencia.rpc('submit_for_review', { p_content_piece_id: ids.pieza });
    expect(error).toBeNull();

    expect(await estadoDeLaPieza()).toBe('pendiente_revision');
    expect(await historial('pendiente_revision')).toHaveLength(1);
  });

  it('el contacto del cliente aprueba y quedan historial y approval', async () => {
    const contacto = await sesionDe(correos.contacto);

    const { error } = await contacto.rpc('approve_content_piece', {
      p_content_piece_id: ids.pieza,
      p_note: 'Se ve bien',
    });
    expect(error).toBeNull();

    expect(await estadoDeLaPieza()).toBe('aprobado');
    expect(await historial('aprobado')).toHaveLength(1);

    const { data: approvals } = await admin
      .from('approvals')
      .select('decision')
      .eq('content_piece_id', ids.pieza);
    expect(approvals).toHaveLength(1);
    expect(approvals?.[0].decision).toBe('aprobado');
  });

  it('un contacto de OTRO cliente no puede aprobar la pieza', async () => {
    const ajeno = await sesionDe(correos.ajeno);
    const estadoPrevio = await estadoDeLaPieza();

    const { error } = await ajeno.rpc('approve_content_piece', {
      p_content_piece_id: ids.pieza,
      p_note: 'Intento no autorizado',
    });

    expect(error).not.toBeNull();
    expect(await estadoDeLaPieza()).toBe(estadoPrevio);
  });
});
