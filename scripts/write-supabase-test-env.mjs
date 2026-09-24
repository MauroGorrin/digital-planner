// Lee las credenciales de la instancia local de Supabase (`supabase status -o json`) y las escribe
// en un archivo .env. Nunca se hardcodea una credencial: la instancia local regenera sus llaves y
// un valor copiado a mano queda obsoleto sin avisar.
//
// Uso:  node scripts/write-supabase-test-env.mjs [rutaDestino]
//       sin argumento  -> .env.test.local   (pruebas de integración, E2-T1)
//       con argumento  -> esa ruta          (E2-T5 le pasa .env.local para el build de producción)
//
// Ambos destinos ya están fuera de control de versiones por los patrones `.env.local` y
// `.env*.local` que el .gitignore del repo trae desde antes de este blueprint.

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const destino = process.argv[2] ?? '.env.test.local';

// Comando constante, sin interpolación de nada: execSync ya corre a través del shell, lo que evita
// el DeprecationWarning DEP0190 que sale al pasarle `shell: true` a execFileSync (necesario en
// Windows para resolver npx).
const salida = execSync('npx supabase status -o json', { encoding: 'utf8' });

const estado = JSON.parse(salida);

const requeridas = ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY'];
const faltantes = requeridas.filter((k) => !estado[k]);
if (faltantes.length > 0) {
  console.error(
    `supabase status no devolvió ${faltantes.join(', ')}. ` +
      `Claves recibidas: ${Object.keys(estado).join(', ')}. ` +
      'Ajusta los nombres de propiedad en este script contra tu versión del CLI; ' +
      'nunca sustituyas por una credencial hardcodeada.'
  );
  process.exit(1);
}

const contenido = [
  `NEXT_PUBLIC_SUPABASE_URL=${estado.API_URL}`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=${estado.ANON_KEY}`,
  `SUPABASE_SERVICE_ROLE_KEY=${estado.SERVICE_ROLE_KEY}`,
  'NEXT_PUBLIC_APP_URL=http://localhost:3000',
  '',
].join('\n');

writeFileSync(destino, contenido);
console.log(`Credenciales de Supabase local escritas en ${destino}`);
