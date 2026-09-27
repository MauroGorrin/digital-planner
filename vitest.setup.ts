// Entry point específico de Vitest: registra los matchers vía `expect.extend` del propio Vitest.
// El entry point a secas ('@testing-library/jest-dom') asume un `expect` global estilo Jest y
// falla con "expect is not defined" mientras `test.globals` siga en false — que es como está
// vitest.config.ts a propósito, para que cada prueba importe describe/it/expect explícitamente.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

// Desmontaje entre pruebas, por el mismo motivo que el import de arriba: Testing Library registra
// su `afterEach(cleanup)` automatico solo si detecta un `afterEach` global, y con
// `test.globals: false` no existe. Sin esto, un archivo que llama a render() mas de una vez
// arrastra el DOM de la prueba anterior y los getBy* fallan con "found multiple elements" --
// un sintoma que no menciona la causa. Va aca y no en cada archivo para que nadie tenga que
// acordarse: la primera prueba de componente de este proyecto lo resolvio copiando la linea tres
// veces.
afterEach(() => cleanup());

/**
 * Cargador de variables de entorno sin dependencias nuevas (no usa dotenv ni la API
 * experimental process.loadEnvFile). Lee un archivo .env simple (CLAVE=valor por línea,
 * '#' como comentario) y solo rellena claves que process.env aún no tiene definidas.
 *
 * Si el archivo no existe, no hace nada — ese es el caso normal para `npm run test`
 * (pruebas unitarias, que no tocan Supabase). `npm run test:integration` genera
 * .env.test.local antes de invocar a Vitest (ver scripts/write-supabase-test-env.mjs),
 * así que para esa corrida el archivo sí existe y esta función lo carga.
 */
function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  const contents = readFileSync(path, 'utf8');
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile('.env.test.local');
