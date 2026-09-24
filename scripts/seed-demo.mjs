// Siembra datos de demostración en una instancia de Supabase para poder entrar a la aplicación
// y recorrer el flujo completo sin crear nada a mano en el panel.
//
// Uso:  node scripts/seed-demo.mjs
//
// Lee las credenciales de .env.local (las que genera scripts/write-supabase-test-env.mjs a partir
// de la Supabase local). Es idempotente: si los usuarios de demo ya existen, reutiliza sus ids en
// vez de fallar.
//
// SOLO PARA DESARROLLO LOCAL. Se niega a correr contra un host que no sea local, para que una
// contraseña de demo no termine nunca en una base de producción.

import { existsSync, readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

function cargarEnv(ruta) {
  if (!existsSync(ruta)) return;
  for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith('#')) continue;
    const i = limpia.indexOf('=');
    if (i === -1) continue;
    const clave = limpia.slice(0, i).trim();
    if (!(clave in process.env)) process.env[clave] = limpia.slice(i + 1).trim();
  }
}

cargarEnv('.env.local');

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SERVICE) {
  console.error(
    'Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY. Levanta la Supabase local con ' +
      '`npx supabase start` y genera el archivo con `node scripts/write-supabase-test-env.mjs .env.local`.'
  );
  process.exit(1);
}

const esLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(URL);
if (!esLocal) {
  console.error(
    `Este seed es solo para desarrollo local y ${URL} no lo parece. ` +
      'Para producción, crea el primer administrador desde el panel de Supabase (ver README).'
  );
  process.exit(1);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

const CLAVE = 'demo1234';
const USUARIOS = {
  agencia: { email: 'agencia@demo.local', nombre: 'Ana Agencia', rol: 'agency_admin' },
  cliente: { email: 'cliente@demo.local', nombre: 'Carlos Cliente', rol: 'client' },
};

async function idDeUsuario(email, nombre) {
  const { data: creado, error } = await admin.auth.admin.createUser({
    email,
    password: CLAVE,
    email_confirm: true,
    user_metadata: { full_name: nombre },
  });
  if (!error) return creado.user.id;

  // Ya existía: lo buscamos en profiles, que handle_new_user() creó en su momento.
  const { data: perfil } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
  if (perfil) return perfil.id;
  throw error;
}

const PIEZAS = [
  { platform: 'instagram', format: 'reel', title: 'Reel de lanzamiento', status: 'borrador', dias: 1 },
  { platform: 'instagram', format: 'carrusel', title: 'Carrusel de beneficios', status: 'pendiente_revision', dias: 2 },
  { platform: 'linkedin', format: 'post', title: 'Caso de éxito', status: 'aprobado', dias: 3 },
  { platform: 'tiktok', format: 'video', title: 'Detrás de cámaras', status: 'programado', dias: 5 },
];

const idAgencia = await idDeUsuario(USUARIOS.agencia.email, USUARIOS.agencia.nombre);
const idCliente = await idDeUsuario(USUARIOS.cliente.email, USUARIOS.cliente.nombre);

await admin.from('profiles').update({ role: 'agency_admin' }).eq('id', idAgencia);
await admin.from('profiles').update({ role: 'client' }).eq('id', idCliente);

let { data: marca } = await admin.from('clients').select('id').eq('name', 'Marca Demo').maybeSingle();
if (!marca) {
  const { data, error } = await admin
    .from('clients')
    .insert({
      name: 'Marca Demo',
      brand_name: 'Demo',
      timezone: 'America/Mexico_City',
      created_by: idAgencia,
    })
    .select('id')
    .single();
  if (error) throw error;
  marca = data;
}

await admin.from('client_assignments').upsert(
  { client_id: marca.id, profile_id: idAgencia },
  { onConflict: 'client_id,profile_id' }
);
await admin.from('client_contacts').upsert(
  { client_id: marca.id, profile_id: idCliente },
  { onConflict: 'client_id,profile_id' }
);

const { data: yaHay } = await admin.from('content_pieces').select('id').eq('client_id', marca.id);
if (!yaHay || yaHay.length === 0) {
  const filas = PIEZAS.map((p) => ({
    client_id: marca.id,
    platform: p.platform,
    format: p.format,
    title: p.title,
    copy_text: `Texto de ejemplo para "${p.title}".`,
    scheduled_at: new Date(Date.now() + p.dias * 86_400_000).toISOString(),
    status: p.status,
    assignee_id: idAgencia,
    created_by: idAgencia,
  }));
  const { error } = await admin.from('content_pieces').insert(filas);
  if (error) throw error;
}

console.log(`
Datos de demostración listos.

  Agencia (administrador):  ${USUARIOS.agencia.email}  /  ${CLAVE}
  Cliente (aprueba):        ${USUARIOS.cliente.email}  /  ${CLAVE}

  Marca "Marca Demo" con ${PIEZAS.length} piezas en distintos estados.

Levanta la aplicación con \`npm run dev\` y entra en http://localhost:3000/login
`);
