// Registra los matchers de @testing-library/jest-dom en los tipos de `expect` de Vitest.
//
// Hace falta como archivo aparte porque `vitest.setup.ts` está excluido de tsconfig.json
// (ver E1-T1: Bootstrap lo deposita antes de que se instalen los paquetes que importa), y esa
// exclusión también saca del programa de TypeScript la augmentación de tipos que el setup traía.
// Sin este archivo, `npm run typecheck` falla con
// "Property 'toBeInTheDocument' does not exist on type 'Assertion<...>'".
import '@testing-library/jest-dom/vitest';
