---
description: Convenciones de pruebas — Vitest unitario vs. integración contra Supabase local
paths:
  - "tests/**"
  - "vitest.config.ts"
  - "vitest.setup.ts"
  - "scripts/write-supabase-test-env.mjs"
---

# Convenciones de pruebas

- `tests/unit/**` corre con jsdom (`npm run test`). Todo lo que toque
  `@/lib/supabase/server` (`createServiceClient`) o `global.fetch` debe mockearse con `vi.mock` /
  `vi.fn()` — nunca una llamada de red real en una prueba unitaria.
- `tests/integration/**` corre con `--environment node` contra una Supabase local real levantada
  por Docker (`npm run test:integration`, que hace `supabase start && supabase db reset && ...`).
  Nunca reemplaces esa base real por un mock: el objetivo de esta capa es probar las funciones
  `SECURITY DEFINER` de Postgres tal cual corren en producción.
- Toda prueba de integración limpia lo que crea (`afterAll`) — usuarios de prueba vía
  `supabase.auth.admin.deleteUser`, filas de negocio por cascada al borrar el `client` que las
  contiene — para que `npm run test:integration` sea seguro de correr dos veces seguidas sin
  reiniciar Docker.
- Nunca hardcodees una clave de Supabase local en un archivo commiteado. Las credenciales de la
  instancia local salen de `npx supabase status -o json` en tiempo de ejecución
  (`scripts/write-supabase-test-env.mjs`) y aterrizan en `.env.test.local`, que está fuera de
  control de versiones por el patrón `.env*.local` ya presente en `.gitignore`.
- Nombra cada prueba por el comportamiento que prueba ("aprueba una pieza solo si el usuario es
  contacto del cliente"), no por un número.
- Un factory por entidad de prueba (pieza de contenido, cliente, usuario) con valores por defecto
  válidos y campos sobreescribibles — nunca literales repetidos entre archivos de prueba.

## No hacer

- No mockear Postgres en `tests/integration/**` "para que corra más rápido" — esa capa existe
  precisamente porque las funciones `SECURITY DEFINER` (`submit_for_review`,
  `approve_content_piece`, etc.) son la lógica de autorización real, y un mock nunca la ejercita.
- No dejar una prueba de integración sin `afterAll` de limpieza — la siguiente corrida colisionará
  con datos huérfanos de la anterior.
