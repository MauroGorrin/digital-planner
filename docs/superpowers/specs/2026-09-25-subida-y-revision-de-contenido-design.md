# Subida y revisión de contenido — diseño

Fecha: 2026-09-25 · Estado: propuesto, pendiente de aprobación

## Problema

`digital-planner` es un planificador de contenido para redes sociales: la agencia sube piezas y
sus clientes las revisan y aprueban. Los formatos que el propio sistema declara incluyen `reel` y
`video`, pero el flujo de adjuntos actual solo funciona bien con imágenes.

Verificado leyendo `components/AttachmentUploader.tsx` y `supabase/migrations/0002_storage.sql`:

| Problema | Consecuencia |
|---|---|
| El bucket no declara `file_size_limit` ni `allowed_mime_types` | Hereda el default del proyecto (50 MB). Un reel de 150 MB falla con un error de Supabase que el usuario no entiende. |
| No hay validación de tipo ni tamaño antes de subir | Entra cualquier archivo, de cualquier peso, hasta que el bucket lo rechaza. |
| No hay barra de progreso | En un video de 150 MB son minutos sin señal alguna. El usuario asume que se colgó. |
| El video no tiene previsualización | Solo `image/*` se muestra inline. Para aprobar un reel, el cliente tiene que descargarlo — rompe el circuito central del producto. |
| Los adjuntos son una lista plana | Tras un "cambios solicitados", la versión vieja y la nueva conviven sin distinción. El cliente puede aprobar mirando el archivo equivocado. |
| Si el insert en base falla tras subir al bucket | Queda un archivo huérfano que nadie ve ni limpia. |
| `attachments_delete` solo exige `is_agency()` | Cualquier miembro de agencia puede borrar adjuntos de una marca que no tiene asignada. Las políticas de lectura y escritura sí verifican la marca. |

## Alcance

**Dentro:** límites y validación de archivos, barra de progreso real, reproducción inline de video,
versionado de adjuntos por rondas más reemplazo explícito, y la corrección de la política de
borrado.

**Fuera, deliberadamente:**

| No se construye | Por qué |
|---|---|
| Subida reanudable (TUS) | Decisión del operador: ante un corte, se reintenta desde cero. Cubre el caso a 150 MB sin el costo de los casos borde de reanudación. |
| Transcodificación o compresión de video | El equipo sube archivos ya exportados y listos para publicar. |
| Comentarios atados a una versión o a un segundo del video | Decisión del operador: los comentarios siguen colgando de la pieza. El historial de estados ya da el contexto de qué ronda se revisaba. |
| Subida masiva (varias piezas a la vez) | No se pidió. El flujo sigue siendo por ficha de pieza. |
| Que el cliente suba archivos | Los clientes revisan y aprueban; no producen. La política de escritura sigue siendo solo de agencia. |

## Restricción que determina la arquitectura

**La subida tiene que ir directo del navegador a Supabase Storage.** Si pasara por una Server
Action o una ruta de la API, chocaría con el límite de ~4,5 MB de cuerpo de request de las
funciones serverless de Vercel, donde esta aplicación está desplegada. Un archivo de 150 MB nunca
llegaría. La arquitectura actual ya es la correcta en este punto y se conserva.

## Decisiones

### Modelo de versionado

Elegido: **dos columnas aditivas en `attachments`**.

- `replaces_id uuid references attachments(id) on delete set null`, con restricción `unique`, para
  que dos archivos no puedan declararse reemplazo del mismo padre y la cadena no se bifurque. Si un
  archivo viejo se borra, el reemplazo sobrevive y solo pierde el puntero a su antecesor.
- `review_round int not null default 1`.

Descartadas:

- *Tabla `attachment_versions` aparte.* Más limpia si hubiera muchas versiones por archivo, pero
  obliga a partir las filas existentes en dos tablas y a cambiar todo lo que hoy lee adjuntos.
  Demasiado costo para el beneficio real a esta escala.
- *Solo una marca `superseded_at`.* Lo más barato, pero pierde **qué** reemplazó a qué, que es
  justamente lo ambiguo cuando una pieza es un carrusel de varias imágenes.

**La ronda la asigna Postgres, no el navegador.** Un trigger `before insert` cuenta las
transiciones a `cambios_solicitados` en `status_history` para esa pieza y suma uno, sobrescribiendo
cualquier valor que llegue del cliente. Es la misma decisión que el proyecto ya toma para las
transiciones de estado: la autorización y la verdad viven en la base.

**"Vigente" se deriva, no se guarda.** Un adjunto es vigente si ningún otro lo reemplaza. Un
booleano persistido sería un segundo estado que se desincroniza; y como una pieza tiene pocos
adjuntos, calcularlo al vuelo no cuesta nada.

### Progreso de subida

Verificado en esta sesión contra la versión instalada (`@supabase/storage-js` 2.117.1): **el
`upload()` del SDK usa `fetch`, que no emite eventos de progreso.** No hay `XMLHttpRequest` ni
`onProgress` en todo el paquete.

Por eso la subida pasa a ser: `createSignedUploadUrl()` para obtener una URL firmada de un solo
uso, y luego `XMLHttpRequest` contra esa URL, que sí expone `upload.onprogress`. Sigue siendo
directo del navegador al bucket. Sin esto, una "barra de progreso" sería una animación inventada.

### Tipos y límites

Bucket: **200 MB** por archivo (headroom sobre los ~150 MB reales) y tipos permitidos
`image/jpeg`, `image/png`, `image/webp`, `image/gif`, `video/mp4`, `video/quicktime`, `video/webm`,
`application/pdf`.

`video/quicktime` entra a propósito: es lo que exporta un iPhone y el equipo subirá `.mov`
habitualmente. **Salvedad:** un `.mov` se almacena bien, pero su reproducción inline no está
garantizada fuera de Safari. Cuando el navegador no pueda reproducirlo, la ficha lo indica y ofrece
descargarlo, en lugar de mostrar un reproductor roto.

Validación en dos capas: en el navegador para dar un mensaje entendible antes de gastar ancho de
banda, y en el bucket como autoridad final, que no depende de que el cliente coopere.

## Cambios por archivo

### `supabase/migrations/0003_attachment_versions.sql` (nuevo)

1. `alter table attachments` con las dos columnas y el `unique (replaces_id)`.
   **Nota para quien implemente:** Postgres permite múltiples `NULL` en una restricción `unique`, y
   eso es exactamente lo que se busca — muchos adjuntos originales (`replaces_id is null`) conviven
   sin problema, y la restricción solo impide que dos archivos declaren el mismo padre. No hay que
   "corregirla" con un índice parcial.
2. Función `set_attachment_round()` y trigger `before insert` sobre `attachments`.
3. Para el bucket `attachments`: `file_size_limit = 209715200` (200 MB) y `allowed_mime_types =
   array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime',
   'video/webm','application/pdf']`.
4. Reemplazo de la política `attachments_delete` para que exija también
   `has_client_access((storage.foldername(name))[1]::uuid)`.

Migración aditiva: las filas existentes quedan válidas con los valores por defecto y ningún
consumidor actual se rompe.

### `types/database.ts`

Los dos campos nuevos en el tipo `Attachment`.

### `lib/attachments.ts` (nuevo)

Lógica sin React, para poder probarla en aislamiento:

- `agruparPorRonda(attachments)` — pura. Devuelve las rondas ordenadas, y dentro de cada una los
  adjuntos vigentes con su cadena de reemplazados.
- `validarArchivo(file)` — pura. Devuelve `null` o un mensaje en español; encapsula tope y tipos.
- `registrarAdjunto({ supabase, ... })` — recibe el cliente de Supabase como parámetro en vez de
  crearlo adentro. Hace el insert y, si falla, borra el objeto ya subido. Es lo que permite probar
  la compensación (prueba 6) sin un navegador: en la prueba se le pasa un cliente falso cuyo insert
  rechaza. Si esta lógica viviera incrustada en el manejador del componente, ese criterio solo
  podría verificarse a mano.

### `components/AttachmentUploader.tsx`

Validar → `createSignedUploadUrl` → subir por XHR con progreso → insertar en base. Al fallar el
insert, borrar el objeto recién subido. Archivos de a uno, cada uno con su barra. `router.refresh()`
en vez de `window.location.reload()`. Botón "Subir nueva versión" en cada adjunto vigente, que fija
`replaces_id`.

### `app/piezas/[id]/page.tsx`

Genera las URLs firmadas en el servidor y las pasa ya resueltas al componente. Elimina una ida y
vuelta por archivo desde el navegador y el parpadeo inicial sin previsualizaciones. Duran una hora;
recargar la página las renueva.

### `components/ContentPieceDetail.tsx`

Render agrupado por ronda: la más reciente abierta, las anteriores colapsadas con su resumen. Video
inline con `<video controls preload="metadata">` — carga solo la carátula y baja el archivo completo
solo si el cliente le da play.

## Manejo de errores

| Situación | Comportamiento |
|---|---|
| Archivo supera el tope o tipo no permitido | Se rechaza en el navegador antes de subir, con el peso real y el máximo en el mensaje. |
| La subida se corta a mitad | Mensaje claro y el archivo queda disponible para reintentar. Nada parcial se registra en la base. |
| Sube al bucket pero falla el insert | Se borra el objeto subido. Sin huérfanos. |
| El bucket rechaza pese a la validación del navegador | Se muestra el error de Supabase; es la autoridad final. |
| El navegador no puede reproducir el `.mov` | Aviso y enlace de descarga, no un reproductor roto. |
| La URL firmada expiró en una pestaña vieja | Recargar la página las renueva. |

## Pruebas

**Integración, contra Postgres real** (arnés existente, `tests/integration/`):

1. El trigger asigna `review_round = 1` antes de cualquier `cambios_solicitados`, y `2` a un archivo
   subido después de esa transición.
2. El `unique (replaces_id)` impide que dos adjuntos reemplacen al mismo padre.
3. La política de borrado corregida rechaza a un miembro de agencia sin acceso a esa marca, y
   permite al que sí lo tiene.

**Unitarias** (`tests/unit/`):

4. `agruparPorRonda` ordena las rondas, marca como vigente al no reemplazado y pliega la cadena.
5. `validarArchivo` acepta los tipos permitidos y rechaza por tamaño y por tipo con su mensaje.
6. La compensación ante fallo: con el insert en base forzado a fallar, se invoca el borrado del
   objeto recién subido y el error llega al usuario. Requiere que esa lógica viva en una función
   con el cliente de Supabase inyectado, no incrustada en el manejador del componente — es la
   única parte del subidor comprobable sin un navegador real.

Sin pruebas E2E de navegador: sigue siendo no-objetivo del proyecto.

## Criterios de aceptación

1. CUANDO se sube un archivo de más de 200 MB, EL SISTEMA lo rechaza en el navegador indicando el
   peso real y el máximo, sin iniciar la transferencia.
2. CUANDO se sube un video permitido, EL SISTEMA muestra progreso real basado en bytes transferidos.
3. CUANDO el cliente abre una pieza con un video vigente, EL SISTEMA lo reproduce inline sin
   descargar el archivo completo hasta que se pulsa play.
4. CUANDO se sube un archivo después de un `cambios_solicitados`, EL SISTEMA lo asigna a la ronda
   siguiente y deja la anterior colapsada como historial.
5. CUANDO se sube una nueva versión de un adjunto concreto, EL SISTEMA muestra la nueva como vigente
   y pliega la anterior bajo ella.
6. CUANDO el insert en base falla después de subir al bucket, EL SISTEMA borra el objeto subido.
7. CUANDO un miembro de agencia sin acceso a una marca intenta borrar un adjunto de esa marca,
   EL SISTEMA lo rechaza.

### Cómo se verifica cada criterio

El proyecto no tiene pruebas E2E de navegador y eso sigue siendo un no-objetivo, así que tres de
los siete criterios se comprueban a mano. Se dice acá en vez de dejarlo implícito:

| Criterio | Cómo se verifica |
|---|---|
| 1 — rechazo por tamaño | Unitaria 5 (`validarArchivo`) |
| 2 — progreso real | **Manual**: subir un video y observar que la barra avanza por bytes, no por tiempo |
| 3 — video inline sin descarga completa | **Manual**: abrir la ficha y confirmar en la pestaña de red del navegador que no se descarga el archivo entero hasta pulsar play |
| 4 — asignación de ronda | Integración 1 |
| 5 — reemplazo explícito visible | **Manual**: subir una nueva versión y confirmar que la anterior queda plegada |
| 6 — sin huérfanos | Unitaria sobre la ruta de compensación, con el insert forzado a fallar |
| 7 — borrado entre marcas | Integración 3 |

## Orden de entrega sugerido

1. Migración y tipos, con sus pruebas de integración. Nada visible todavía, pero es la base.
2. Límites, validación y progreso. Resuelve el fallo más frecuente.
3. Reproducción inline de video. Es lo que desbloquea la revisión del cliente.
4. Agrupado por rondas.
5. Reemplazo explícito por archivo.

Los pasos 1 a 3 ya entregan la mayor parte del valor: subir un reel y que el cliente pueda verlo
sin descargarlo. Los pasos 4 y 5 son el versionado, que puede seguir después sin bloquear nada.
