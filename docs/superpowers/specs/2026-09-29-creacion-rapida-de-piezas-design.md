# Creación más rápida de piezas: duplicar, carga múltiple y fechas recurrentes

**Fecha:** 2026-09-29
**Estado:** diseñado y aprobado por el usuario en conversación. Es el sub-proyecto **A** de la
descomposición acordada (A → B → C → D) de la lista de sugerencias sobre `digital-planner`.

## El problema

Quien lleva varias cuentas de contenido solo —el caso típico es un freelancer con 6-8 clientes—
crea cada pieza campo por campo: cliente, plataforma, formato, título, copy, link, fecha,
responsable. Eso cuesta lo mismo la primera vez que la vigésima, y hay tres situaciones donde ese
costo es innecesario:

- **Repetir algo parecido a lo último que hiciste.** Un carrusel semanal para el mismo cliente casi
  no cambia de una semana a otra, y hoy se vuelve a escribir entero.
- **Una sola sesión de fotos o video produce varias piezas.** Salen 5 posts de una tanda y hoy cada
  uno es un viaje completo por el formulario.
- **Un contenido fijo en el calendario.** "Todos los lunes y jueves publicamos algo" hoy se traduce
  en crear cada ocurrencia a mano, una por una, semana tras semana.

## Alcance

**Dentro:** un botón para duplicar una pieza existente, una pantalla para crear varias piezas de una
tanda de archivos, y una opción de repetición dentro del formulario de creación.

**Fuera, deliberadamente:**

| No se construye | Por qué |
|---|---|
| Biblioteca de plantillas con nombre | Decisión explícita del usuario: por ahora solo duplicar la pieza más reciente, no guardar y listar plantillas reutilizables. Se puede agregar después sin tocar lo de aquí. |
| Series vinculadas / edición en cascada de la recurrencia | También decisión explícita: cada ocurrencia nace independiente. Editar o borrar una no toca las demás, y no hay "editar esta y las futuras". |
| Copiar adjuntos al duplicar o repetir | Los archivos son lo específico de cada pieza — de una sesión de fotos futura no hay nada que copiar todavía, y copiar objetos de Storage entre piezas agrega complejidad de cuota (plan gratuito de Supabase) sin que nadie lo haya pedido. |
| Reintento en línea de una fila fallida en carga múltiple | Si una fila del lote falla, se resuelve creándola a mano después con el formulario normal. Un reintento en línea duplicaría la lógica de creación de una sola pieza dentro de la pantalla de lote. |
| Mezclar clientes distintos en un mismo lote | Cliente, plataforma y formato son compartidos por todo el lote (carga múltiple) o por toda la serie (recurrencia). Si hacen falta dos clientes, son dos lotes. |
| Validar contra la cuota del paquete (`client_packages`) al crear en lote | `createContentPiece` no lo hace hoy para una sola pieza tampoco — no es una regresión, es consistencia con el comportamiento actual. |

## Lo que ya existe y este diseño usa

Verificado contra el código, no asumido:

- `ContentPieceForm` (`components/ContentPieceForm.tsx`) ya sirve para crear y editar con la misma
  prop `piece` opcional, y ya sabe prellenarse desde una idea convertida vía la prop `ideaOrigen`
  (líneas 27-42). El diseño de abajo agrega una prop hermana, `piezaOrigen`, con el mismo patrón.
- `createContentPiece` (`app/actions.ts:32-60`) inserta con `status` en su default `'borrador'` — la
  columna no acepta que `authenticated` la escriba directamente desde `0007_endurecimiento_privilegios.sql`
  —, valida el link de referencia con `enlaceDeReferenciaValidado` y resuelve la agencia con
  `requireAgency()`. No hace ningún chequeo de cuota.
- `subirArchivoAPieza` (`lib/attachments.ts:323-361`) es la única función que sube un archivo a una
  pieza — firma la URL, transfiere con progreso, registra la fila —, ya la comparten la ficha y el
  formulario de creación, y el flujo de carga múltiple la reutiliza tal cual.
- `validarArchivo`, `TAMANO_MAXIMO_BYTES` (50 MB) y `TIPOS_PERMITIDOS` (`lib/attachments.ts:13-44`)
  ya validan cada archivo antes de subirlo. Se reutilizan sin cambios, archivo por archivo, en el
  lote.
- `ideaSirveComoOrigenDePieza` y su uso en `app/piezas/nueva/page.tsx:22-25` ya resuelven el caso de
  un enlace de origen que dejó de ser válido, degradando a un formulario en blanco en vez de romper
  la página. `desde=<id>` (duplicar) usa el mismo patrón cuando la pieza de origen ya no es
  accesible para quien la abre.

No hace falta ninguna migración: las tres funciones reutilizan `content_pieces` y `attachments` tal
cual están.

## Diseño

### Infraestructura compartida: `createContentPieces`

Carga múltiple y recurrencia comparten el mismo problema — crear varias piezas de una vez, dejando
ver cuáles fallaron sin perder las que sí se crearon —, así que las dos llaman a una sola función
nueva en `app/actions-lote.ts`:

```ts
export interface ItemDeLote {
  client_id: string;
  platform: PlatformType;
  format: ContentFormat;
  title: string;
  copy_text: string;
  reference_link?: string;
  scheduled_at: string;
  assignee_id?: string;
}

export interface ResultadoDeLote {
  creadas: { indice: number; id: string }[];
  fallidas: { indice: number; mensaje: string }[];
}

export async function createContentPieces(items: ItemDeLote[]): Promise<ResultadoDeLote>
```

**Decisión mía: por dentro, llama a `createContentPiece` en un bucle, una vez por ítem, capturando
el error de cada llamada en vez de reimplementar el insert.** Es la misma validación, el mismo
scoping por agencia y el mismo mensaje de error que ya tiene la creación de una sola pieza, con cero
lógica nueva de autorización que pueda desalinearse de la original. El costo es una llamada a
`requireAgency()` y un `revalidatePath` por ítem en vez de uno solo por lote — aceptable: cada ítem
ya implica un viaje a la base para el insert, y un lote es como mucho 12 piezas.

**Tope de 12 ítems, verificado antes de crear nada.** Si el lote trae 13, la función rechaza la
llamada completa sin tocar la base — ni carga múltiple (que limita a 10 archivos en su propia
interfaz) ni recurrencia (que limita a 12 repeticiones) pueden pedir más, así que este tope es una
red de seguridad del lado del servidor, no algo que el uso normal vaya a tocar.

**Fallo parcial: no se revierte nada.** Si el ítem 7 de 10 falla, los 6 anteriores quedan creados.
Es el mismo criterio que ya usa `ContentPieceForm` hoy (`piezaCreada` permite "ir a la pieza" aunque
la subida del archivo falle después): mejor una pieza de más creada y visible que una transacción
que borra trabajo válido porque una fila tuvo un problema.

### A1 — Duplicar pieza

Un botón **"Duplicar"** junto a "Editar" en `ContentPieceDetail`, visible para los mismos roles que
ya ven "Editar". Lleva a `/piezas/nueva?desde=<id>`.

`NuevaPiezaPage` (`app/piezas/nueva/page.tsx`) carga la pieza de origen igual que hoy carga la idea
de origen — con el cliente sujeto a RLS, así que una pieza de otra agencia simplemente no aparece —
y pasa una nueva prop a `ContentPieceForm`:

```ts
piezaOrigen?: {
  client_id: string;
  platform: PlatformType;
  format: ContentFormat;
  title: string;
  copy_text: string;
  reference_link: string | null;
  assignee_id: string | null;
}
```

`ContentPieceForm` usa `piezaOrigen` para los valores iniciales exactamente como ya usa `ideaOrigen`
— **salvo la fecha, que queda en blanco** (el valor por defecto de "ahora", igual que un formulario
nuevo sin origen) para que sea lo primero que el ojo detecta como pendiente de ajustar. Sin
adjuntos: la pieza nace sin archivos, se suben los que hagan falta.

Si llegan `idea` y `desde` a la vez en la URL (no debería pasar desde la interfaz, pero es un
parámetro que cualquiera puede escribir a mano), gana `idea` — convertir una idea es un compromiso
que ya quedó registrado en `ideas.status`, y perderlo silenciosamente por preferir el otro origen
sería peor que la ambigüedad.

### A3 — Fechas recurrentes

Dentro del mismo `ContentPieceForm`, **solo en modo creación** (no aparece cuando la prop `piece`
está presente, es decir, nunca al editar). Debajo del campo de fecha, un checkbox **"Repetir esta
pieza"** que revela:

- Siete checkboxes de día de la semana (L M M J V S D), con el día de la fecha elegida marcado por
  defecto.
- Un número, **"¿Cuántas veces?"**, de 1 a 12.
- Un resumen en texto plano de las fechas resultantes ("Se crearán 4 piezas: lun 5 oct, jue 8 oct,
  lun 12 oct, jue 15 oct") **antes de enviar** — para que la cantidad y las fechas nunca sean una
  sorpresa después del hecho.

La fecha ya elegida en el formulario es siempre la primera ocurrencia, caiga en el día que caiga; los
checkboxes de día deciden las siguientes. La hora se copia de esa primera fecha para todas las
ocurrencias.

Función pura en `lib/recurrencia.ts`:

```ts
export function fechasRecurrentes(
  fechaInicial: Date,
  diasDeLaSemana: number[], // 0 = domingo .. 6 = sábado, como Date#getDay()
  cantidad: number
): Date[]
```

Camina día por día desde `fechaInicial` (inclusive) y va juntando las fechas cuyo día de la semana
esté en `diasDeLaSemana`, hasta juntar `cantidad`. `fechaInicial` siempre entra como la primera,
esté o no su día marcado en `diasDeLaSemana` — es la fecha que la persona ya eligió a propósito.

Al enviar, el formulario arma un `ItemDeLote` por cada fecha (mismos cliente, plataforma, formato,
título, copy, link y responsable; solo cambia `scheduled_at`) y llama a `createContentPieces`. Sin
recurrencia marcada, el formulario sigue llamando a `createContentPiece` exactamente como hoy — cero
cambio de comportamiento para el caso normal.

### A2 — Carga múltiple

Ruta nueva `/piezas/nueva-multiple`, componente nuevo `ContentPiecesMultipleForm.tsx`. Dos pasos en
la misma pantalla:

**Paso 1 — lo compartido.** Cliente, plataforma y formato (los mismos selectores que
`ContentPieceForm`), y un input de archivos múltiple, tope de **10 archivos**. Cada archivo pasa por
`validarArchivo` al elegirlo — mismo tipo y mismo tope de 50 MB que hoy, sin excepción por venir en
lote.

**Paso 2 — una fila por archivo.** Nombre del archivo como referencia visual, y por fila: título
(obligatorio), copy (opcional), fecha (opcional, con el mismo valor por defecto de "ahora" que el
formulario normal). Sin link de referencia ni responsable en esta pantalla — quien lo necesite lo
agrega después editando esa pieza; una fila con diez campos ya es densa de por sí, y recortar los
dos menos usados es lo que la mantiene legible.

**Al enviar:**

1. `createContentPieces` con los ítems armados de las filas.
2. Para cada ítem que se creó, subir su archivo correspondiente con `subirArchivoAPieza`
   (client-side, con progreso — mismo mecanismo que ya usa `ContentPieceForm` hoy), en paralelo.
3. La pantalla pasa de formulario a una lista de resultado: cada fila muestra su título con un
   enlace a la pieza si se creó, o el mensaje de error si no. Nada desaparece ni se revierte — es un
   resumen de lo que pasó, no un formulario que se puede reenviar.

## Qué se prueba

**Unitarias** (`tests/unit/`):

1. `fechasRecurrentes`: inicio un martes, días `[lunes, jueves]`, cantidad 4 → las 4 fechas
   correctas en orden, con la hora del original preservada en cada una.
2. `fechasRecurrentes`: cantidad 1 devuelve solo `fechaInicial`, sin importar qué días estén
   marcados.
3. `fechasRecurrentes`: una serie que cruza un cambio de mes no salta ni repite un día.
4. `fechasRecurrentes`: `fechaInicial` siempre es la primera fecha devuelta, aunque su día no esté
   en `diasDeLaSemana`.

**Componentes** (`tests/unit/components/`):

5. `ContentPieceForm` con `piezaOrigen`: los campos se prellenan salvo la fecha, y no se muestra
   ningún adjunto.
6. `ContentPieceForm` con "Repetir esta pieza" marcado: cambiar la cantidad o los días actualiza el
   resumen de fechas antes de enviar.
7. `ContentPiecesMultipleForm`: elegir 3 archivos muestra 3 filas; enviar llama a
   `createContentPieces` con los 3 ítems y sube cada archivo a la pieza que le corresponde por
   índice.
8. `ContentPiecesMultipleForm`: si `createContentPieces` devuelve una fila fallida, esa fila muestra
   su error y las filas que sí se crearon suben su archivo igual — un fallo no detiene a las demás.

**Integración** (`tests/integration/`, contra Postgres real):

9. `createContentPieces` con un ítem cuyo `client_id` es de OTRA agencia: esa fila falla con el
   mismo error que ya da `createContentPiece` hoy, y los demás ítems válidos del mismo lote sí se
   crean.
10. `createContentPieces` con 13 ítems rechaza la llamada completa antes de crear ninguna fila.

**Manual:** ninguno. Si algo de esta entrega solo se puede verificar abriendo el navegador, falta
una prueba.

## Criterios de aceptación

1. CUANDO alguien pulsa "Duplicar" en una pieza, EL SISTEMA abre el formulario de creación con
   cliente, plataforma, formato, título, copy, link y responsable prellenados desde esa pieza, la
   fecha en blanco, y sin adjuntos.
2. CUANDO se suben varios archivos en `/piezas/nueva-multiple`, EL SISTEMA crea una pieza
   independiente por archivo, cada una con su propio título y fecha.
3. CUANDO una fila de un lote falla al crearse, EL SISTEMA conserva las filas que sí se crearon y
   muestra cuál falló y por qué, sin detener ni revertir el resto.
4. CUANDO se marca "Repetir esta pieza" con días y una cantidad, EL SISTEMA crea esa cantidad de
   piezas independientes, una por cada fecha calculada, cada una editable y borrable sin afectar a
   las demás.
5. CUANDO un lote pide más de 12 piezas, EL SISTEMA rechaza la llamada completa sin crear ninguna.
6. CUANDO un ítem de un lote apunta a una marca de otra agencia, EL SISTEMA rechaza esa fila y crea
   igual las demás filas válidas del mismo lote.

### Cómo se verifica cada criterio

| Criterio | Cómo |
|---|---|
| 1 | Componente 5 |
| 2 | Componente 7 |
| 3 | Componente 8, Integración 9 |
| 4 | Unitaria 1, Componente 6 |
| 5 | Integración 10 |
| 6 | Integración 9 |

## Orden de entrega

1. `lib/recurrencia.ts` con `fechasRecurrentes` y sus unitarias — función pura, no depende de nada
   más.
2. `app/actions-lote.ts` con `createContentPieces` (reutilizando `createContentPiece`) y sus pruebas
   de integración (tope de 12, aislamiento por agencia).
3. A1 — prop `piezaOrigen` en `ContentPieceForm`, botón "Duplicar" en `ContentPieceDetail`, y la
   prueba de componente. Es el cambio más chico sobre el formulario existente.
4. A3 — sección "Repetir esta pieza" dentro de `ContentPieceForm`, usando `fechasRecurrentes` y
   `createContentPieces` de los pasos 1 y 2, con su prueba de componente.
5. A2 — página `/piezas/nueva-multiple` y `ContentPiecesMultipleForm`, la superficie nueva más
   grande, al final porque depende de `createContentPieces` y reutiliza el mismo patrón de subida
   que A3 ya deja probado en el formulario principal.
