# Panel de métricas de paquete — Plan de implementación

> **Para agentes:** ejecutar con superpowers:subagent-driven-development, tarea por tarea.

**Objetivo:** que la agencia y el cliente vean, para un mes, cuánto se contrató, cuánto está
planificado y cuánto se entregó de cada formato.

**Arquitectura:** una tabla `client_packages` con la cuota mensual por formato y marca; una librería
pura `lib/metricas.ts` que resuelve los límites del mes en la zona horaria de la marca y agrega las
piezas; una página `/metricas` que los muestra y, solo para la agencia, permite editar la cuota.

**Stack:** Next.js 14 (App Router, Server Components), Supabase con RLS, `date-fns-tz` 3.2 (ya
instalado), Vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-27-panel-de-metricas-de-paquete.md`

## Restricciones globales

- Todo el texto visible en español, **tú** neutro latinoamericano, nunca **vos** — vigilar también las
  formas enclíticas (`Revisalo`), no solo las acentuadas (`Revisá`).
- `content_pieces.status` y `ideas.status` solo cambian dentro de funciones `SECURITY DEFINER`. Esta
  entrega **no cambia ningún estado**: solo lee piezas y escribe cuotas.
- `SUPABASE_SERVICE_ROLE_KEY` nunca en un archivo con `"use client"`.
- Nunca editar `0001`–`0005`. Esta entrega crea `0006_client_packages.sql`.
- `0006` se aplica **a mano, pegada en el editor SQL del panel de Supabase**, así que tiene que ser
  repetible: `if not exists`, `create or replace`, y `drop policy if exists` antes de cada
  `create policy`, igual que hacen `0003`, `0004` y `0005`.
- Las pruebas de integración corren contra Postgres real y nunca se mockean.
- Alias `@/`; nada de `../../..`.
- Gate antes de dar una tarea por terminada:
  `npm run typecheck && npm run lint && npm run test && npm run test:integration && npm run build`.
- **Una prueba que no se vio fallar todavía no es una prueba.** Para cada prueba nueva, romper a
  propósito el comportamiento que cubre, verla ponerse roja, revertir y verla volver a verde. Reportar
  cualquier prueba que sobreviva a su mutación: eso vale más que una suite verde.

## Datos ya verificados — usar estos valores, no recalcularlos

Comprobado corriendo `date-fns-tz` 3.2 en este proyecto:

- **El borde que motiva todo el diseño.** `fromZonedTime('2026-01-31T23:00:00', 'America/Mexico_City')`
  es `2026-02-01T05:00:00.000Z`. Es decir: **en UTC esa pieza cae en febrero**. El inicio de febrero en
  esa zona es `2026-02-01T06:00:00.000Z`, así que la comparación `pieza < inicioDeFebrero` da
  verdadero y la pieza queda correctamente en enero.
- **Ojo con el horario de verano: `America/Mexico_City` ya no lo observa.** Marzo 2026 mide 744 horas y
  abril 720, sin saltos. Una prueba de DST escrita contra esa zona **no probaría nada y pasaría
  trivialmente**. Zonas que sí cruzan un cambio, con su duración real de mes:
  - `America/Santiago`, septiembre 2026: 719 h (pierde una hora) — inicio `2026-09-01T04:00:00.000Z`,
    fin `2026-10-01T03:00:00.000Z`.
  - `Europe/Madrid`, marzo 2026: 743 h — inicio `2026-02-28T23:00:00.000Z`, fin
    `2026-03-31T22:00:00.000Z`.
  - `Europe/Madrid`, octubre 2026: 745 h (gana una hora) — inicio `2026-09-30T22:00:00.000Z`, fin
    `2026-10-31T23:00:00.000Z`.
- `date-fns-tz` 3.2 exporta: `format`, `formatInTimeZone`, `fromZonedTime`, `toZonedTime`,
  `getTimezoneOffset`, `toDate`. **No existe** `zonedTimeToUtc` (ese era el nombre en la versión 2).
- `content_format` tiene seis valores: `post`, `reel`, `historia`, `carrusel`, `video`, `otro`.
- `content_status` incluye `publicado` y `cancelado`.
- `clients.timezone` es `text not null default 'America/Mexico_City'`.

---

## Tarea 1: `lib/metricas.ts` — los límites del mes y la agregación

**Archivos:**
- Crear: `lib/metricas.ts`
- Crear: `tests/unit/lib/metricas.test.ts`

**Interfaces que produce** (las tareas 2 y 3 dependen de estos nombres y tipos):

```typescript
export interface LimitesDeMes { inicio: string; finExclusivo: string } // ISO UTC
export function limitesDelMes(anio: number, mes: number, timeZone: string): LimitesDeMes

export interface FilaDeMetrica {
  format: ContentFormat;
  contratado: number | null;   // null = el formato no está en el paquete
  planificado: number;
  entregado: number;
}
export function agregarMetricas(
  piezas: Pick<ContentPiece, 'format' | 'status'>[],
  paquete: Pick<ClientPackage, 'format' | 'monthly_quota'>[],
): FilaDeMetrica[]
```

`mes` es 1–12, no 0–11. Documentarlo en el tipo o en un comentario: el desfase de meses de JavaScript
es la clase de error que produce números mal sin fallar.

`agregarMetricas` devuelve primero las filas contratadas (en el orden del enum `content_format`), y
después las no contratadas que tengan algo entregado o planificado, con `contratado: null`. Un formato
sin contratar y sin nada entregado no produce fila.

**Pasos:**

1. Escribir las pruebas de `tests/unit/lib/metricas.test.ts` y verlas fallar:
   - El borde de las 23:00: una pieza en `2026-02-01T05:00:00.000Z` está dentro de los límites de enero
     2026 para `America/Mexico_City` y **fuera** de los de febrero. Usar los instantes exactos de la
     sección de datos verificados.
   - `Europe/Madrid` marzo 2026: `inicio` es `2026-02-28T23:00:00.000Z` y `finExclusivo` es
     `2026-03-31T22:00:00.000Z`.
   - `America/Santiago` septiembre 2026: el mes mide 719 horas.
   - Diciembre: `limitesDelMes(2026, 12, tz).finExclusivo` cae en enero de 2027, no en el mes 13.
   - `agregarMetricas`: una pieza `cancelado` no cuenta como planificada; una `publicado` cuenta en
     planificado **y** en entregado; un formato entregado sin estar en el paquete sale con
     `contratado: null` y al final; un formato contratado sin nada entregado sale con `entregado: 0`.
2. Implementar `lib/metricas.ts`. Sin React, sin Supabase, sin `Date.now()` — funciones puras.
3. Correr `npm run test` (no necesita Docker) y el resto del gate.
4. Probar que cada prueba es portante (romper, ver rojo, revertir, ver verde).
5. Commit: `feat: add package metrics aggregation in the client's timezone`

---

## Tarea 2: migración `0006` — la tabla del paquete y su RLS

**Archivos:**
- Crear: `supabase/migrations/0006_client_packages.sql`
- Crear: `tests/integration/client-packages.test.ts`
- Modificar: `types/database.ts` (agregar la interfaz `ClientPackage`)

**Consume:** nada de la Tarea 1. **Produce:** la tabla y el tipo `ClientPackage` que usa la Tarea 3.

La tabla, la RLS y el trigger de `updated_at` según el spec. La política de lectura del cliente usa la
construcción explícita de `client_contacts` + `auth.uid()`, **no** `has_client_access()`, y lleva un
comentario que diga por qué: esa función devuelve verdadero para cualquier usuario de agencia sin
mirar la marca. Copiar el patrón de `ideas_select` en `0005_ideas.sql`.

Reusar el trigger `touch_updated_at()` que ya existe en `0001_init.sql` — no escribir otro.

**Pruebas de integración** (seguir el estilo y el fixture de `tests/integration/ideas-rls.test.ts`,
que ya crea dos marcas):
- Un contacto del cliente lee el paquete de su marca.
- Un contacto del cliente obtiene **cero filas** del paquete de otra marca.
- Un contacto del cliente **no puede** insertar ni actualizar su propio paquete; asertar el mensaje o
  el código del rechazo, **no** solamente que hubo un error. En esta base de código ya se colaron tres
  pruebas que solo comprobaban que "algo falló"; no agregar una cuarta.
- `monthly_quota = 0` es rechazado por el `check`.

Commit: `feat: add the monthly package quota table with its read policy`

---

## Tarea 3: la página `/metricas`

**Archivos:**
- Crear: `app/metricas/page.tsx`
- Crear: `components/PanelDeMetricas.tsx`
- Crear: `components/EditorDePaquete.tsx`
- Crear: `app/actions-paquetes.ts`
- Crear: `tests/unit/components/PanelDeMetricas.test.tsx`
- Modificar: `components/AppShell.tsx` (una entrada `/metricas` en `AGENCY_NAV` y en `CLIENT_NAV`)

**Consume:** `limitesDelMes` y `agregarMetricas` de la Tarea 1; la tabla y el tipo de la Tarea 2.

La página resuelve la marca y el mes desde `searchParams`, con el mes actual y — para el cliente — su
propia marca como valores por omisión. Un cliente **nunca** recibe el selector de marca ni el editor;
la RLS es el control, y la interfaz solo evita ofrecer lo que la base va a negar.

Los selectores navegan cambiando `searchParams` (Server Component, sin estado de cliente).

`app/actions-paquetes.ts` expone una Server Action para guardar la cuota de un formato, con
`requireAgency()` antes de escribir, siguiendo la forma de `app/actions-ideas.ts`.

**Prueba de componente:** como cliente no se renderiza ni el editor ni el selector de marca; como
agencia, los dos sí. Más: una fila fuera del paquete se muestra como tal y no como incumplimiento, y
una marca sin paquete muestra el mensaje explícito en vez de una tabla vacía.

Commit: `feat: show monthly package progress for the agency and the client`
