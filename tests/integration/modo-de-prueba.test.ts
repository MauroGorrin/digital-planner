import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Corre contra la Supabase LOCAL de `npm run test:integration`, nunca contra un proyecto remoto.
//
// Esta suite prueba el supuesto detrás del "modo de prueba" (app/admin-actions.ts
// activarModoDePrueba/desactivarModoDePrueba): que `client_contacts.profile_id` no exige rol
// 'client', así que un agency_admin vinculado ahí puede aprobar de verdad -- la misma RPC, la
// misma política, sin ninguna excepción para administradores. No es una suposición de código: se
// comprueba aquí contra Postgres real.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SERVICE) {
  throw new Error('Faltan credenciales de Supabase local. Corre `npm run test:integration`.');
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const PASSWORD = 'contrasena-de-prueba-1234';
const sufijo = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function insertar(tabla: string, fila: Record<string, unknown>, clave = 'id'): Promise<string> {
  const { data, error } = await admin.from(tabla).insert(fila).select(clave).single();
  if (error) throw new Error(`No se pudo insertar en ${tabla}: ${error.message}`);
  return (data as unknown as Record<string, unknown>)[clave] as string;
}

async function sesionDe(email: string): Promise<SupabaseClient> {
  const cliente = createClient(URL!, ANON!, { auth: { persistSession: false } });
  const { error } = await cliente.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return cliente;
}

const ids: { agencia?: string; adminId?: string; marca?: string; pieza?: string } = {};
let adminSesion: SupabaseClient;

beforeAll(async () => {
  ids.agencia = await insertar('agencies', { name: `Modo de prueba ${sufijo}` });

  const correo = `modo-prueba-admin-${sufijo}@prueba.local`;
  const { data: creado, error } = await admin.auth.admin.createUser({
    email: correo,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  ids.adminId = creado.user.id;
  await admin.from('profiles').update({ role: 'agency_admin', agency_id: ids.agencia }).eq('id', ids.adminId);

  ids.marca = await insertar('clients', {
    name: `Marca ${sufijo}`,
    brand_name: 'Marca de prueba',
    timezone: 'UTC',
    agency_id: ids.agencia,
    created_by: ids.adminId,
  });

  ids.pieza = await insertar('content_pieces', {
    client_id: ids.marca,
    platform: 'instagram',
    format: 'post',
    title: 'Pieza para aprobar en modo de prueba',
    scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
    status: 'pendiente_revision',
    created_by: ids.adminId,
  });

  adminSesion = await sesionDe(correo);
});

afterAll(async () => {
  if (ids.marca) await admin.from('clients').delete().eq('id', ids.marca);
  if (ids.adminId) await admin.auth.admin.deleteUser(ids.adminId);
});

describe('modo de prueba: un agency_admin como contacto real de su propia marca', () => {
  it('un agency_admin SIN estar en client_contacts no puede aprobar (confirma la línea base)', async () => {
    const { error } = await adminSesion.rpc('approve_content_piece', { p_content_piece_id: ids.pieza });

    expect(error?.code).toBe('P0001');
    expect(error?.message).toMatch(/solo el cliente puede aprobar/i);
  });

  it('client_contacts acepta el profile_id de un agency_admin, sin exigir rol client', async () => {
    const { error } = await admin
      .from('client_contacts')
      .upsert({ client_id: ids.marca, profile_id: ids.adminId }, { onConflict: 'client_id,profile_id' });

    expect(error).toBeNull();
  });

  it('una vez vinculado, el mismo agency_admin SÍ aprueba la pieza', async () => {
    const { error } = await adminSesion.rpc('approve_content_piece', {
      p_content_piece_id: ids.pieza,
      p_note: 'Aprobado en modo de prueba',
    });

    expect(error).toBeNull();
    const { data } = await admin.from('content_pieces').select('status').eq('id', ids.pieza).single();
    expect(data?.status).toBe('aprobado');

    // Y queda registrado con su propio id, no con uno simulado: es una aprobación real.
    const { data: aprobacion } = await admin
      .from('approvals')
      .select('decided_by')
      .eq('content_piece_id', ids.pieza)
      .single();
    expect(aprobacion?.decided_by).toBe(ids.adminId);
  });

  it('desactivar el modo de prueba (borrar su fila de client_contacts) le quita el acceso otra vez', async () => {
    await admin.from('client_contacts').delete().eq('client_id', ids.marca).eq('profile_id', ids.adminId);

    const pieza2 = await insertar('content_pieces', {
      client_id: ids.marca,
      platform: 'instagram',
      format: 'post',
      title: 'Segunda pieza',
      scheduled_at: new Date(Date.now() + 86_400_000).toISOString(),
      status: 'pendiente_revision',
      created_by: ids.adminId,
    });

    const { error } = await adminSesion.rpc('approve_content_piece', { p_content_piece_id: pieza2 });
    expect(error?.code).toBe('P0001');

    await admin.from('content_pieces').delete().eq('id', pieza2);
  });
});
