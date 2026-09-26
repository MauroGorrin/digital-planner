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
  agencia: `ideas-agencia-${sufijo}@prueba.local`,
  cliente: `ideas-cliente-${sufijo}@prueba.local`,
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
      name: `Marca ideas ${sufijo}`,
      brand_name: 'Ideas',
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

describe('visibilidad de ideas', () => {
  it('el cliente no ve una idea en propuesta ni en correccion interna', async () => {
    const enPropuesta = await crearIdea('Solo del equipo', 'propuesta');
    const enCorreccion = await crearIdea('Devuelta al autor', 'correccion_interna');

    const cliente = await sesionDe(correos.cliente);
    const { data } = await cliente.from('ideas').select('id');
    const visibles = (data ?? []).map((i) => i.id);

    expect(visibles).not.toContain(enPropuesta);
    expect(visibles).not.toContain(enCorreccion);
  });

  it('el cliente si ve una idea desde pendiente_cliente en adelante', async () => {
    const pendiente = await crearIdea('Para que la apruebe', 'pendiente_cliente');
    const aprobada = await crearIdea('Ya aprobada', 'aprobada');

    const cliente = await sesionDe(correos.cliente);
    const { data } = await cliente.from('ideas').select('id');
    const visibles = (data ?? []).map((i) => i.id);

    expect(visibles).toContain(pendiente);
    expect(visibles).toContain(aprobada);
  });

  it('la agencia ve todas, incluidas las que el cliente no puede ver', async () => {
    const interna = await crearIdea('Interna', 'propuesta');

    const agencia = await sesionDe(correos.agencia);
    const { data } = await agencia.from('ideas').select('id');

    expect((data ?? []).map((i) => i.id)).toContain(interna);
  });

  it('el cliente no puede crear ideas', async () => {
    const cliente = await sesionDe(correos.cliente);
    const { error } = await cliente.from('ideas').insert({
      client_id: ids.marca,
      title: 'Idea del cliente',
      description: 'No deberia entrar',
    });

    expect(error).not.toBeNull();
  });

  it(
    'un contacto del cliente ve el historial de una idea visible pero no la ronda de correccion interna que tuvo antes',
    async () => {
      const idea = await crearIdea('Con historia mixta', 'pendiente_cliente');

      // Misma idea, tres filas de historial: la ronda interna (con su nota, que nunca debe llegar
      // al cliente), el resubmit que la devuelve a 'propuesta', y la que de verdad la hizo visible.
      const { error } = await admin.from('idea_status_history').insert([
        { idea_id: idea, from_status: 'propuesta', to_status: 'correccion_interna', note: 'Nota interna: reformula el gancho' },
        { idea_id: idea, from_status: 'correccion_interna', to_status: 'propuesta' },
        { idea_id: idea, from_status: 'propuesta', to_status: 'pendiente_cliente' },
      ]);
      if (error) throw error;

      const cliente = await sesionDe(correos.cliente);
      const { data } = await cliente
        .from('idea_status_history')
        .select('to_status, note')
        .eq('idea_id', idea);

      const vistos = (data ?? []).map((h) => h.to_status);
      expect(vistos).toContain('pendiente_cliente');
      expect(vistos).not.toContain('correccion_interna');
      expect(vistos).not.toContain('propuesta');
      expect((data ?? []).some((h) => h.note?.includes('Nota interna'))).toBe(false);
    }
  );
});
