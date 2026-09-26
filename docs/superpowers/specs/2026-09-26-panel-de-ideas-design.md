# Panel de ideas con aprobación en cadena

**Fecha:** 2026-09-26
**Estado:** aprobado por el usuario, listo para plan de implementación

## El problema

El producto empieza demasiado tarde. La primera cosa que existe en la aplicación es una pieza con
fecha, plataforma y formato — es decir, algo que **ya se decidió**. Todo lo anterior (proponer,
discutir, descartar, convencer al cliente) ocurre en WhatsApp y en reuniones, y no deja rastro.

Eso tiene dos costos concretos:

- **Las buenas ideas se pierden.** Alguien del equipo propone algo en un chat un martes y nadie lo
  vuelve a ver.
- **Se produce antes de acordar.** Se graba y edita un reel, y recién entonces el cliente dice "no
  era por ahí". Una idea rechazada cuesta una conversación; un reel rechazado cuesta una
  producción.

Este diseño mete esa etapa dentro de la herramienta, con dos filtros en cadena: primero el interno
del equipo, después el del cliente.

## Alcance

**Dentro:** proponer ideas, filtrarlas internamente, someterlas al cliente, pedir correcciones de
ambos lados, descartar con motivo, y convertir una idea aprobada en una pieza del calendario.

**Fuera, deliberadamente:**

| No se construye | Por qué |
|---|---|
| Comentarios hilados sobre una idea | La nota obligatoria de cada transición es la conversación en esta entrega. Soportar hilos exigiría tocar `comments`, cuya columna `content_piece_id` es `not null` — es decir, un comentario hoy no puede existir sin pertenecer a una pieza. Es aditivo después. |
| Webhooks a Make para eventos de ideas | `webhook_event_type` es un enum fijo y ampliarlo es otra decisión, con su propio payload. Las notificaciones internas sí se construyen. |
| Que el cliente proponga ideas | Su idea tendría que pasar por el filtro interno y volver a él para aprobarla — aprobarse a sí mismo. Decidir si se salta una etapa es un diseño aparte. El embudo v1 tiene una sola dirección. |
| Adjuntar archivos a una idea | Una idea es texto: si ya hay un archivo, es una pieza. |
| Fecha en la idea | La fecha se elige al convertir, que es cuando de verdad se sabe. |

## Lo que ya existe y este diseño usa

Verificado contra el código, no asumido:

- `content_pieces.scheduled_at` es `timestamptz **not null**` (`0001_init.sql`). Una pieza no puede
  existir sin fecha, y eso es lo que hace confiable el calendario.
- `comments.content_piece_id` es `not null`.
- `status_history`: `content_piece_id`, `from_status`, `to_status`, `changed_by`, `note`,
  `created_at`. Es el modelo a espejar.
- `notifications`: `profile_id`, `content_piece_id` (**anulable**, FK a `content_pieces`), `type`,
  `title`, `body`, `read_at`, `created_at`.
- Funciones de rol: `is_agency()`, `is_agency_admin()`, `has_client_access(uuid)`. **Ojo:**
  `has_client_access` devuelve verdadero para cualquier usuario de agencia sin mirar la marca
  (`0001_init.sql:245-250`), así que por sí sola no distingue agencia de cliente.
- El patrón de transición: función `security definer set search_path = public` que valida el rol,
  actualiza el estado, escribe el historial y crea las notificaciones — todo en una transacción.
  `approve_content_piece` es el ejemplar.
- `client_assignments` es a quién notificar del lado de la agencia; `client_contacts`, del lado del
  cliente.

## Diseño

### Modelo de datos

Migración `0005`. Un enum y dos tablas nuevas, más una columna en `notifications`.

```
idea_status: propuesta · correccion_interna · pendiente_cliente ·
             correccion_cliente · aprobada · descartada · convertida
```

**`ideas`**

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid | |
| `client_id` | uuid not null → `clients` on delete cascade | La marca a la que pertenece |
| `title` | text not null | |
| `description` | text not null default `''` | |
| `reference_link` | text | Opcional |
| `suggested_platform` | `platform_type` | **Opcional**: en esta etapa todavía se discute |
| `suggested_format` | `content_format` | Opcional, por lo mismo |
| `status` | `idea_status` not null default `'propuesta'` | |
| `created_by` | uuid → `profiles` | Quién la propuso |
| `content_piece_id` | uuid → `content_pieces` on delete set null | La pieza que originó, si se convirtió |
| `created_at` / `updated_at` | timestamptz | |

`content_piece_id` con `on delete set null` y no `cascade`: borrar la pieza no debe borrar la idea
que la originó ni su historial de por qué se aprobó.

**`idea_status_history`** — espejo de `status_history`: `idea_id`, `from_status`, `to_status`,
`changed_by`, `note`, `created_at`.

Tabla propia y no reutilizar `status_history`, porque su `content_piece_id` es `not null`.

**`notifications.idea_id`** — columna nueva, anulable, FK a `ideas` on delete cascade. Sin ella una
notificación de idea no sabría adónde llevar al usuario: `content_piece_id` apunta a piezas.

### Las transiciones viven en Postgres

Seis funciones `security definer set search_path = public`, el mismo patrón no negociable que usan
las piezas. Cada una valida el rol **en la base**, escribe en `idea_status_history` y crea las
notificaciones de la contraparte.

| Función | Quién puede | De | A |
|---|---|---|---|
| `submit_idea_to_client(id)` | `is_agency_admin()` | propuesta | pendiente_cliente |
| `request_idea_internal_changes(id, note)` | `is_agency_admin()` | propuesta | correccion_interna |
| `approve_idea(id, note?)` | contacto del cliente | pendiente_cliente | aprobada |
| `request_idea_client_changes(id, note)` | contacto del cliente | pendiente_cliente | correccion_cliente |
| `discard_idea(id, reason)` | agencia o contacto del cliente | cualquiera salvo convertida | descartada |
| `resubmit_idea(id)` | `is_agency()` | correccion_interna → propuesta<br>correccion_cliente → pendiente_cliente | |

**`resubmit_idea` no necesita saber quién pidió el cambio: lo deduce del estado.** Si viene de
corrección interna vuelve al filtro interno; si viene del cliente vuelve directo al cliente, sin
repetir el filtro. Repetirlo haría que cada ida y vuelta con el cliente pasara dos veces por el
equipo y duplicaría el ciclo.

**Pedir corrección y descartar exigen nota**, validado en la función con `raise exception`, no en el
formulario. Sin nota, el autor recibe "corrígela" sin saber qué, y una idea rechazada sin motivo se
vuelve a proponer en tres semanas.

Que la agencia no pueda aprobar y que el cliente no pueda hacer el filtro interno se impone acá, no
en la interfaz: una llamada directa a la API tiene que fallar igual.

### El cliente no ve lo que el equipo descartó

Política de lectura de `ideas`:

- **Agencia:** ve todas las ideas (`is_agency()`).
- **Cliente:** ve solo las de su marca **y** con estado en
  `('pendiente_cliente', 'correccion_cliente', 'aprobada', 'convertida')`.

Es el punto más importante del diseño. Todo el sentido del filtro interno es que el cliente no vea
las veinte ideas que el equipo descartó entre ellos. Si eso dependiera de un filtro en la interfaz,
una consulta directa a la API se las mostraría todas.

`has_client_access()` **no alcanza** para expresar esto, porque devuelve verdadero para cualquier
usuario de agencia sin mirar la marca. La política tiene que distinguir explícitamente el caso
agencia del caso contacto de cliente.

Escritura: solo agencia inserta y edita (`is_agency()`). El estado nunca se cambia por `update`
directo — solo por las funciones de arriba.

### La conversión

En una idea aprobada, un botón **"Crear pieza desde esta idea"** abre el formulario de nueva pieza
con el título, el texto y las sugerencias de plataforma y formato ya rellenados. Al guardar, se
vincula `ideas.content_piece_id` y la idea pasa a `convertida`.

La fecha se elige ahí, que es cuando se sabe. Ese es el motivo de que la idea no la tenga.

### Dónde se ve

- **Sección "Ideas"** nueva en la navegación, para agencia y cliente.
- **Agencia:** agrupadas por estado, con formulario de nueva idea.
- **Cliente:** solo las que la política le deja ver.
- **Pendientes:** las ideas en `pendiente_cliente` aparecen en la página de pendientes del cliente,
  junto a las piezas, para que no tenga dos lugares que revisar.

## Qué se prueba

**Integración** (`tests/integration/`, contra Postgres real):

1. Un usuario de agencia **no puede** aprobar una idea (la función lanza).
2. Un contacto del cliente **no puede** hacer el filtro interno ni enviar al cliente.
3. Un contacto del cliente **no ve** una idea en `propuesta` ni en `correccion_interna` — la
   consulta devuelve cero filas, no una fila filtrada por la interfaz.
4. Pedir corrección sin nota es rechazado; con nota queda registrada en el historial.
5. `resubmit_idea` devuelve la idea al filtro interno o al cliente según de dónde venga.
6. Descartar exige motivo y lo registra.
7. Enviar una idea al cliente crea una fila en `notifications` para **cada contacto** de esa marca,
   con `idea_id` apuntando a la idea y `content_piece_id` vacío.

**Unitarias** (`tests/unit/`):

8. El mapa de estado a etiqueta y color, y qué transiciones ofrece la interfaz a cada rol — para
   que la interfaz no muestre un botón que la base va a rechazar.

**Manual:** el recorrido completo, proponer → filtrar → cliente → corrección → aprobar → convertir.

## Criterios de aceptación

1. CUANDO un usuario de agencia intenta aprobar una idea, EL SISTEMA lo rechaza en la base de datos.
2. CUANDO un contacto del cliente consulta las ideas de su marca, EL SISTEMA devuelve solo las que
   están en `pendiente_cliente` o posterior.
3. CUANDO se pide una corrección sin nota, EL SISTEMA la rechaza.
4. CUANDO se reenvía una idea corregida, EL SISTEMA la devuelve a la etapa que pidió el cambio, sin
   repetir la anterior.
5. CUANDO se crea una pieza desde una idea aprobada, EL SISTEMA vincula ambas y deja la idea en
   `convertida`.
6. CUANDO una idea pasa a `pendiente_cliente`, EL SISTEMA notifica a los contactos de esa marca.

### Cómo se verifica cada criterio

| Criterio | Cómo |
|---|---|
| 1 | Integración 1 |
| 2 | Integración 3 |
| 3 | Integración 4 |
| 4 | Integración 5 |
| 5 | **Manual** — cruza dos formularios y una navegación |
| 6 | Integración 7 |

## Orden de entrega sugerido

1. Migración `0005`: enum, tablas, columna en `notifications`, políticas y las seis funciones, con
   sus pruebas de integración. Es el grueso y es donde vive la seguridad.
2. La sección Ideas para la agencia: listar, crear, y las transiciones de su lado.
3. La vista del cliente y su entrada en Pendientes.
4. La conversión a pieza.

Cada paso deja algo usable: tras el 2 el equipo ya puede proponer y filtrar aunque el cliente no
participe todavía.
