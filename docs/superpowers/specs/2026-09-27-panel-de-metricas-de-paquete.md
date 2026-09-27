# Panel de métricas contra el paquete contratado

**Fecha:** 2026-09-27
**Estado:** diseñado sin aprobación previa, por instrucción explícita del usuario ("hazlo todo, no me
pidas aprobaciones"). **Las decisiones marcadas como mías están justificadas para que se revisen como
criterio, no como código.** Si alguna no cuadra, cambiarla es barato: cada una vive en un solo lugar.

## El problema

Una agencia de social media no vende piezas sueltas: vende un paquete mensual — "12 posts, 8 reels y
30 historias al mes". Hoy la herramienta ya sabe todo lo necesario para responder si ese paquete se
cumplió, y no lo responde. El dato está en `content_pieces` y la pregunta se contesta a mano,
contando en el calendario.

Eso tiene dos costos concretos:

- **La agencia descubre tarde que va corta.** El día 25 no hay forma de ver que faltan 4 reels sin
  contarlos uno por uno, y a esa altura ya no hay margen de producción.
- **El cliente no tiene por qué creer.** Pagó por 30 historias y no tiene ninguna pantalla que le
  diga cuántas recibió. La conversación de fin de mes se vuelve una discusión de memoria.

## Alcance

**Dentro:** definir el paquete mensual de cada marca por formato, y una pantalla que compare lo
contratado contra lo planificado y lo entregado en un mes, para la agencia y para el cliente.

**Fuera, deliberadamente:**

| No se construye | Por qué |
|---|---|
| Arrastre de saldo al mes siguiente | Si sobran 2 posts en marzo, ¿se suman a abril? Es una decisión comercial y de facturación, no de producto, y cada agencia la resuelve distinto. El paquete es del mes calendario. |
| Desglose por plataforma | Los paquetes se venden por formato ("8 reels"), no por plataforma ("8 reels de Instagram"). Agregar plataforma multiplica las filas sin responder la pregunta que se hace. |
| Gráficas de tendencia histórica | "¿Cumplimos este mes?" es la necesidad. "¿Cómo venimos los últimos seis meses?" es otra pantalla y otra conversación. |
| Exportar a PDF o CSV | Ya existe `/api/export/csv` para piezas. Si hace falta el reporte del paquete, se agrega después sabiendo qué se pide. |
| Alertas automáticas de "vas corto" | Necesita decidir cuándo avisar y a quién. La pantalla primero; el aviso, cuando se sepa qué umbral importa. |

## Lo que ya existe y este diseño usa

Verificado contra el código, no asumido:

- `content_pieces.format` es `content_format`, enum de seis valores: `post`, `reel`, `historia`,
  `carrusel`, `video`, `otro` (`0001_init.sql:11`).
- `content_pieces.scheduled_at` es `timestamptz not null`, y `status` es `content_status`, que incluye
  `publicado` y `cancelado` (`0001_init.sql`).
- `clients.timezone` es `text not null default 'America/Mexico_City'` (`0001_init.sql`). **Cada marca
  tiene su propia zona horaria.**
- `lib/tz.ts` ya usa `date-fns-tz` (`formatInTimeZone`, `fromZonedTime`). No hace falta ninguna
  dependencia nueva para calcular límites de mes en una zona.
- `FORMAT_LABELS` en `types/database.ts` ya traduce los seis formatos.
- RLS ya aísla `content_pieces` por marca para el cliente.

## Diseño

### El paquete: una cuota mensual por formato

Migración `0006`. Una tabla:

**`client_packages`**

| Columna | Tipo | Nota |
|---|---|---|
| `client_id` | uuid not null → `clients` on delete cascade | |
| `format` | `content_format` not null | |
| `monthly_quota` | int not null `check (monthly_quota > 0)` | |
| `created_at` / `updated_at` | timestamptz | |

Clave primaria `(client_id, format)`.

**Decisión mía: ausencia no es lo mismo que cuota cero.** Una fila que no existe significa "este
formato no está en el paquete"; la cuota 0 no existe, y de ahí el `check (monthly_quota > 0)`. La
diferencia importa: si el paquete no incluye reels y el equipo publicó 3, eso son 3 reels **fuera del
paquete** — un dato que la agencia quiere ver, no un incumplimiento. Con cuota 0, las dos situaciones
se verían idénticas.

**RLS:** la agencia lee y escribe (`is_agency()`); el contacto del cliente **solo lee** el de su
marca, con la misma construcción explícita de `client_contacts` + `auth.uid()` que usa `ideas_select`,
y por el mismo motivo ya documentado ahí: `has_client_access()` devuelve verdadero para cualquier
usuario de agencia sin mirar la marca, así que no distingue los dos casos. El cliente no escribe: su
propio paquete no lo edita él.

### Los tres números

Para un mes y una marca, por cada formato:

| Número | Definición |
|---|---|
| **Contratado** | `monthly_quota` de `client_packages`, o "fuera del paquete" si no hay fila |
| **Planificado** | piezas de ese formato con `scheduled_at` dentro del mes y `status <> 'cancelado'` |
| **Entregado** | piezas de ese formato con `scheduled_at` dentro del mes y `status = 'publicado'` |

**Decisión mía: se muestran los tres, no solo el entregado.** A mitad de mes, "entregado 4 de 12"
parece un fracaso cuando hay 10 más programadas. Planificado contra contratado responde "¿vamos a
cumplir?"; entregado contra contratado responde "¿cumplimos?". Son dos preguntas distintas que la
agencia se hace en momentos distintos del mes, y con un solo número ninguna de las dos se contesta
bien.

**Decisión mía: `cancelado` no cuenta como planificado.** Una pieza cancelada no va a existir;
dejarla dentro del planificado haría que un mes se viera cubierto por piezas que nadie va a publicar.
Es el error más caro posible en esta pantalla, porque se descubre a fin de mes, cuando ya no hay
margen.

### El mes es el del cliente, no el del servidor

**Este es el punto donde la pantalla daría números equivocados en silencio.** `scheduled_at` es
`timestamptz`: una pieza programada el 31 de enero a las 23:00 en Ciudad de México es 1 de febrero en
UTC. Contada en UTC, esa pieza se va al paquete del mes siguiente — enero se ve corto y febrero
inflado, sin que nada falle de forma visible.

Los límites del mes se calculan **en la zona horaria de la marca** (`clients.timezone`) con
`fromZonedTime`, y se consulta con `>= inicio` y `< inicio del mes siguiente`. Vive en una función
pura en `lib/metricas.ts` — `limitesDelMes(anio, mes, timeZone)` — con pruebas unitarias que incluyan
explícitamente el caso del borde a las 23:00 y un mes que cruce un cambio de horario de verano.

### Dónde se ve

Página nueva `/metricas`, en la navegación de **los dos roles**.

- **Agencia:** selector de marca y selector de mes. Una tabla por formato con los tres números y una
  barra de avance. Debajo, plegado, el editor del paquete de esa marca.
- **Cliente:** el mismo mes y su propia marca, sin selector de marca y **sin editor**. Para él la
  pantalla responde "qué recibí este mes", que es la transparencia que justifica todo el producto.

**Decisión mía: el editor del paquete vive en esta pantalla, no en `/clientes`.** Es donde uno se da
cuenta de que la cuota está mal, justamente porque ve que el número no cuadra. Mandarlo a otra sección
a corregirlo es pedirle que se acuerde.

Las filas con `monthly_quota` y nada entregado se muestran igual: son el hueco que hay que ver. Los
formatos entregados sin estar contratados se muestran al final, agrupados como **"Fuera del
paquete"**. Si la marca no tiene paquete definido, la pantalla lo dice y ofrece definirlo, en vez de
mostrar una tabla vacía.

## Qué se prueba

**Unitarias** (`tests/unit/`):

1. `limitesDelMes` devuelve el instante correcto para una zona con offset negativo, y el mes siguiente
   como límite superior exclusivo.
2. Una pieza a las 23:00 del último día del mes en la zona de la marca cae **dentro** de ese mes, y no
   en el siguiente.
3. Un mes que cruza un cambio de horario de verano no pierde ni duplica un día.
4. La agregación: dado un conjunto de piezas y un paquete, produce los tres números por formato, con
   `cancelado` excluido del planificado y los formatos no contratados agrupados aparte.

**Integración** (`tests/integration/`, contra Postgres real):

5. Un contacto del cliente **lee** el paquete de su marca.
6. Un contacto del cliente **no lee** el paquete de otra marca — cero filas, no una fila filtrada por
   la interfaz.
7. Un contacto del cliente **no puede escribir** su propio paquete: la política lo rechaza.

**Componentes** (`tests/unit/components/`):

8. Como cliente no se renderiza el editor del paquete ni el selector de marca; como agencia, sí.

**Manual:** ninguno. Si algo de esta entrega solo se puede verificar abriendo el navegador, es que
falta una prueba.

## Criterios de aceptación

1. CUANDO una pieza está programada a las 23:00 del último día del mes en la zona de la marca, EL
   SISTEMA la cuenta en ese mes y no en el siguiente.
2. CUANDO una pieza está en `cancelado`, EL SISTEMA no la cuenta como planificada.
3. CUANDO un formato se entregó sin estar en el paquete, EL SISTEMA lo muestra como fuera del paquete
   y no como incumplimiento.
4. CUANDO un contacto del cliente consulta el paquete de otra marca, EL SISTEMA devuelve cero filas.
5. CUANDO un contacto del cliente intenta editar un paquete, EL SISTEMA lo rechaza en la base de
   datos.
6. CUANDO una marca no tiene paquete definido, EL SISTEMA lo dice explícitamente en vez de mostrar una
   tabla vacía.

### Cómo se verifica cada criterio

| Criterio | Cómo |
|---|---|
| 1 | Unitaria 2 |
| 2 | Unitaria 4 |
| 3 | Unitaria 4 |
| 4 | Integración 6 |
| 5 | Integración 7 |
| 6 | Componente 8 |

## Orden de entrega

1. `lib/metricas.ts` con `limitesDelMes` y la agregación, con sus unitarias. Es donde vive la
   corrección del mes y no depende de nada más.
2. Migración `0006`: tabla, RLS y sus pruebas de integración.
3. La página `/metricas` y sus componentes, con la prueba de componente.
