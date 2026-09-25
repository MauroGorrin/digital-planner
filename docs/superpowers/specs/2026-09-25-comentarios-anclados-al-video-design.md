# Comentarios anclados a un momento del video

**Fecha:** 2026-09-25
**Estado:** aprobado por el usuario, listo para plan de implementación

## El problema

La rama anterior logró que el cliente reproduzca el video dentro de la ficha en vez de descargarlo.
Eso cerró el circuito de revisión, pero dejó a medias la parte que más ida y vuelta genera: **los
comentarios cuelgan de la pieza entera, no de un momento del video**.

En la práctica, el cliente escribe "el logo se ve mal" y la agencia tiene que adivinar en qué
segundo. Se responde preguntando, el cliente vuelve a mirar, contesta, y recién entonces se corrige.
Son tres intercambios para un dato que el cliente tenía delante cuando escribió.

Para una pieza de texto eso da igual. Para un reel de cuarenta segundos con seis cortes, es la
diferencia entre una ronda de revisión y tres.

## Alcance

**Dentro:** anclar un comentario a un archivo de video y a un segundo concreto; mostrar esa marca en
el hilo; y saltar el reproductor a ese momento al pulsarla.

**Fuera, deliberadamente:**

| No se construye | Por qué |
|---|---|
| Marcas sobre la barra del reproductor | Exigiría reemplazar `<video controls>` por un reproductor propio, y con él play, pausa, barra, volumen, pantalla completa, teclado y accesibilidad. Los clientes revisan desde el móvil, que es donde peor se comportan los reproductores propios. Decisión del operador, tomada a sabiendas de que se ve mejor. |
| Anclar en imágenes o PDF (dibujar sobre el archivo) | Es otro modelo de anclaje — coordenadas, no tiempo — y otro diseño. |
| Responder a un comentario anclado | `comments.parent_comment_id` ya existe, pero conectar hilos es trabajo aparte y no se pidió. |
| Que el comentario anclado dispare un cambio de estado | Pedir cambios sigue siendo su propio botón, con su nota. Un comentario es conversación, no una transición. |

## Lo que ya existe y este diseño usa

Verificado contra el código, no asumido:

- `comments` (`0001_init.sql`): `id`, `content_piece_id`, `author_id` (anulable, referencia a
  `profiles`), `body`, `parent_comment_id`, `created_at`.
- `comments_insert` exige `author_id = auth.uid()` **y** `has_client_access(...)` de la marca de la
  pieza. `comments_select` filtra por la misma función.
- `addComment(id, body, parentId?)` en `app/actions.ts:217`.
- `attachments` con `replaces_id` y `review_round` (`0003_attachment_versions.sql`).
- `FilaAdjunto` en `components/AttachmentUploader.tsx` renderiza un `<video>` por cada adjunto de
  video, **incluidas las versiones del historial**. Eso es lo que hace posible saltar al segundo
  correcto de una versión vieja sin construir nada nuevo.
- `agruparPorRonda` en `lib/attachments.ts` devuelve, por ronda, el adjunto vigente y su cadena de
  reemplazados.

## Diseño

### Modelo de datos

Migración `0004`, aditiva. Dos columnas opcionales en `comments`:

| Columna | Tipo | Nota |
|---|---|---|
| `attachment_id` | `uuid references attachments (id) on delete set null` | Archivo al que apunta |
| `video_segundo` | `int` | Segundo dentro de ese archivo |

Un comentario con ambas vacías es un comentario normal. Ninguna fila existente se rompe y ningún
consumidor actual necesita cambiar.

**El `on delete set null` es una decisión, no un descuido.** Desde la rama anterior se pueden borrar
versiones viejas de un adjunto. Si borrar el archivo arrastrara sus comentarios, se perdería parte
del registro de por qué una pieza se aprobó o se rechazó — justo lo que no debe perderse en un flujo
de aprobación. El comentario sobrevive; lo que se pierde es el ancla.

Consecuencia que la interfaz debe manejar: **puede existir una fila con `video_segundo` y sin
`attachment_id`.** Se muestra como comentario normal, indicando que el archivo al que apuntaba fue
eliminado. No se agrega una restricción que prohíba ese estado, porque prohibirlo obligaría a
borrar el comentario, que es lo que se quiere evitar.

### Integridad

Un comentario **solo puede anclarse a un archivo de su propia pieza**. Lo impone un trigger
`before insert or update` en `comments`, no la interfaz.

No es precaución teórica: en este mismo proyecto, `attachments.replaces_id` no exige que el archivo
padre y el hijo compartan `content_piece_id`, y eso quedó anotado como deuda durante la revisión de
la rama anterior. Repetir el mismo hueco en una tabla nueva sería un error conocido cometido dos
veces.

Si `attachment_id` es nulo, el trigger no valida nada.

### Permisos

No cambian. `comments_insert` y `comments_select` ya filtran por la marca de la pieza; agregar
columnas no abre ninguna puerta. El trigger de integridad es `security definer` con
`set search_path = public`, igual que el resto de funciones del proyecto.

**Nota para el diseño siguiente (enlace de revisión sin cuenta):** `comments_insert` exige
`author_id = auth.uid()`. Un invitado sin sesión no cumple esa condición, así que ese diseño tendrá
que resolver explícitamente cómo se identifica a quien comenta desde un enlace. Se anota acá porque
se descubrió acá; no se toca en esta entrega.

### Cómo se crea

Dentro de `FilaAdjunto`, debajo del reproductor y solo para adjuntos cuyo `file_type` empiece por
`video/`, un botón que lee `video.currentTime` y se rotula con él: **"Comentar en 0:42"**.

Al pulsarlo se abre un campo de texto en ese mismo lugar, con enviar y cancelar. Al enviar, el
comentario se crea con su `attachment_id` y su `video_segundo`.

El botón se muestra a cualquiera que ya pueda comentar — agencia y cliente por igual. La agencia
también revisa internamente antes de mandar al cliente, y no hay razón para negarle la herramienta.

La razón de ponerlo junto al reproductor y no en la caja de abajo: **el momento en que alguien
quiere comentar un video es mientras lo mira.** Si hay que desplazarse hasta un formulario, se
escribe "el logo se ve mal" y se sigue — que es exactamente el comportamiento que este diseño
existe para cambiar.

### Cómo se lee

El hilo de comentarios sigue siendo **uno solo**, cronológico, como hoy. No se fragmenta por archivo
ni por versión: la conversación se lee entera.

Un comentario anclado antepone su marca: el nombre del archivo y el segundo, por ejemplo
`Reel_final.mp4 · 0:12`. Si ese archivo ya fue reemplazado por una versión posterior, la marca lo
indica, para que nadie lea un comentario viejo como si fuera sobre el corte actual.

Un archivo está reemplazado cuando **otro adjunto de la misma pieza lo declara en su
`replaces_id`** — el mismo criterio que ya usa `agruparPorRonda` para decidir cuál es el vigente. No
se guarda un segundo estado que pueda desincronizarse; se deriva de los datos que ya hay.

**Al pulsar la marca, el reproductor de ese archivo salta a ese segundo.** Como `FilaAdjunto`
renderiza un `<video>` por adjunto —también los del historial—, un comentario sobre la versión 1
salta en el reproductor de la versión 1, no en el de la vigente. Si esa versión está plegada dentro
del desplegable de historial, se despliega antes de saltar.

Sin este salto la marca sería decorativa: el dato estaría, pero seguiría costando encontrarlo.

Formato del segundo: `0:12`, `1:05`, y `1:05:03` cuando pasa de la hora.

## Qué se prueba

**Integración** (`tests/integration/`, contra Postgres real):

1. El trigger rechaza un comentario anclado a un adjunto de **otra** pieza.
2. El trigger acepta uno anclado a un adjunto de su propia pieza.
3. Al borrar un adjunto, sus comentarios **sobreviven** con `attachment_id` en nulo.

**Unitarias** (`tests/unit/`):

4. El formateo de segundos: `12 → "0:12"`, `65 → "1:05"`, `3903 → "1:05:03"`, `0 → "0:00"`.

**Manual, en navegador:** que el botón tome el segundo correcto del reproductor y que pulsar una
marca salte al momento justo, incluso cuando el comentario apunta a una versión del historial. El
proyecto no tiene pruebas E2E de navegador y eso sigue siendo un no-objetivo; se dice acá en vez de
dejarlo implícito.

## Criterios de aceptación

1. CUANDO se pulsa "Comentar en M:SS" bajo un video, EL SISTEMA crea el comentario con el archivo y
   el segundo que mostraba el reproductor en ese instante.
2. CUANDO se muestra un comentario anclado, EL SISTEMA antepone el nombre del archivo y el segundo, e
   indica si ese archivo ya fue reemplazado.
3. CUANDO se pulsa la marca de un comentario anclado, EL SISTEMA lleva el reproductor de ese archivo
   a ese segundo, desplegando el historial si estaba plegado.
4. CUANDO se intenta anclar un comentario a un adjunto de otra pieza, EL SISTEMA lo rechaza en la
   base de datos.
5. CUANDO se borra un adjunto, EL SISTEMA conserva sus comentarios y los muestra sin ancla.
6. CUANDO el adjunto no es un video, EL SISTEMA no ofrece el botón de comentar con marca.

### Cómo se verifica cada criterio

| Criterio | Cómo |
|---|---|
| 1 | **Manual** — depende del estado del reproductor en el navegador |
| 2 | **Manual** |
| 3 | **Manual** |
| 4 | Integración 1 y 2 |
| 5 | Integración 3 |
| 6 | **Manual** |

Cuatro de seis son manuales porque esta función vive casi entera en el navegador. Decirlo es más
honesto que inventar pruebas que no ejercitan lo que dicen ejercitar.

## Orden de entrega sugerido

1. Migración `0004`: las dos columnas y el trigger de integridad, con sus pruebas de integración.
2. `formatearSegundos` y su prueba unitaria.
3. El botón de crear bajo el reproductor, con `addComment` extendido.
4. La marca en el hilo y el salto del reproductor.

Cada paso deja algo que funciona: tras el 3 ya se pueden anclar comentarios aunque se lean sin
marca; el 4 completa la lectura.
