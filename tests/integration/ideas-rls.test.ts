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

async function crearIdea(titulo: string, status: string, clientId: string = ids.marca) {
  const { data, error } = await admin
    .from('ideas')
    .insert({
      client_id: clientId,
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

  // Segunda marca, sin ningun contacto asignado: la unica forma de que un contacto de `ids.marca`
  // termine leyendo algo de aqui es que la politica no aisle por marca. Vive en el fixture
  // compartido (no dentro de una sola prueba) porque cualquier prueba de esta suite se beneficia
  // de tener una marca ajena con la que probar fugas cruzadas.
  const { data: marcaB, error: errorMarcaB } = await admin
    .from('clients')
    .insert({
      name: `Marca ideas B ${sufijo}`,
      brand_name: 'Ideas B',
      timezone: 'America/Mexico_City',
      created_by: ids.agencia,
    })
    .select('id')
    .single();
  if (errorMarcaB) throw errorMarcaB;
  ids.marcaB = marcaB.id;
});

afterAll(async () => {
  await admin.from('clients').delete().eq('id', ids.marca);
  await admin.from('clients').delete().eq('id', ids.marcaB);
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

  it(
    // Se prueba la fila de historial, no la idea: la idea se deja en 'aprobada' (visible para el
    // cliente via ideas_select) a proposito. Si en cambio la idea quedara en 'descartada',
    // ideas_select ya escondería la idea entera y esta prueba pasaria por el motivo equivocado --
    // el cliente no veria nada porque la idea desaparecio, no porque la fila de historial se haya
    // filtrado. Agregar 'descartada' a la lista de to_status visibles de la politica (el edit mas
    // plausible sobre esa linea, porque se ve como un estado de idea mas) haria que este caso
    // pasara en verde si no existiera esta prueba.
    'un contacto del cliente no lee una fila de historial a descartada, aunque la idea siga visible',
    async () => {
      const idea = await crearIdea('Aprobada con un descarte fantasma en el historial', 'aprobada');

      const { error } = await admin.from('idea_status_history').insert([
        { idea_id: idea, from_status: 'pendiente_cliente', to_status: 'aprobada' },
        {
          idea_id: idea,
          from_status: 'aprobada',
          to_status: 'descartada',
          note: 'Motivo interno de agencia: ya no aplica',
        },
      ]);
      if (error) throw error;

      const cliente = await sesionDe(correos.cliente);
      const { data } = await cliente
        .from('idea_status_history')
        .select('to_status, note')
        .eq('idea_id', idea);

      const vistos = (data ?? []).map((h) => h.to_status);
      expect(vistos).toContain('aprobada');
      expect(vistos).not.toContain('descartada');
      expect((data ?? []).some((h) => h.note?.includes('Motivo interno'))).toBe(false);
    }
  );

  // Lo que esta prueba fija y lo que NO: comprobado corriendo la politica mutada.
  // Caza que alguien borre el vinculo con ideas (dejando solo el filtro por to_status): ahi la fila
  // de la marca B se volveria legible y este caso cae. NO caza que alguien borre solo el exists
  // anidado de client_contacts: ese subquery corre bajo la RLS del llamador, ideas_select ya le
  // esconde la idea de la marca B, y los 34 tests pasan en verde con la politica rota (verificado).
  // Que la politica del historial aisle por marca POR SI SOLA no es demostrable desde una prueba:
  // hay que aflojar ideas_select a mano, porque una prueba no puede mutar una politica. Si tocas
  // esa linea de la politica, no te apoyes en esta prueba -- leela y razonala.
  it('un contacto de la marca A no lee el historial de una idea de la marca B', async () => {
    const ideaDeOtraMarca = await crearIdea('Aprobada en otra marca', 'aprobada', ids.marcaB);

    const { error } = await admin.from('idea_status_history').insert({
      idea_id: ideaDeOtraMarca,
      from_status: 'pendiente_cliente',
      to_status: 'aprobada',
      note: 'Nota de la marca B',
    });
    if (error) throw error;

    // ids.cliente es contacto de ids.marca (marca A), no de ids.marcaB.
    const cliente = await sesionDe(correos.cliente);
    const { data } = await cliente.from('idea_status_history').select('id').eq('idea_id', ideaDeOtraMarca);

    expect(data).toEqual([]);
  });
});
