# Auditoría de aislamiento — `0010_aislamiento_por_agencia.sql`

**Fecha:** 2026-09-28
**Cubre:** el paso 2 de [`specs/2026-09-27-multi-agencia-y-registro.md`](specs/2026-09-27-multi-agencia-y-registro.md).

Esto no es papeleo. El riesgo de este paso, dicho por el spec, es que un `is_agency()` se quede
donde hacía falta comparar la agencia: una fuga entre inquilinos que compila, pasa el gate y sólo se
nota cuando dos clientes reales comparan lo que ven. Este archivo existe para que el siguiente
revisor pueda **comprobar cada decisión una por una** en vez de confiar en que alguien las miró.

Si cambias una política de `0010`, actualiza aquí su fila. Una fila que no corresponda con el SQL es
peor que no tenerla.

## El recuento que encontré, que no coincide con el del spec

| | Spec | Medido hoy | Por qué difiere |
|---|---|---|---|
| Usos de `is_agency(` | 47 | **48** ocurrencias en `supabase/migrations/**` | De las 48: **1** es la definición de la propia función (`0001:235`), **3** están en comentarios (`0007:50`, `0009:4` y el de `0006:56`) y **44** son llamadas reales en SQL ejecutable. El 47 del spec parece ser 48 menos la definición. |
| Usos de `is_agency_admin(` | 14 | **14** ocurrencias | De las 14: **1** es la definición (`0001:240`), **3** están en comentarios, **10** son llamadas reales. |
| Usos de `has_client_access(` | 23 | **23** ocurrencias | **1** definición, **7** en comentarios, **15** llamadas reales. |

El número que importa no es el total sino el de **llamadas reales**: 44 de `is_agency()` y 10 de
`is_agency_admin()`. Abajo están las 54, una por fila. La orden decía "todas", y todas están,
incluidas las que viven en comentarios (marcadas como tales, porque no deciden nada).

Se contaron con un recorrido carácter a carácter que distingue código de comentario, no con un
`grep -c`: `grep` cuenta LÍNEAS, y una línea como
`using (is_agency()) with check (is_agency())` tiene dos llamadas. Contar líneas da 40 y esconde
cuatro sitios.

---

## 1. Los 44 usos de `is_agency()` en código

**Decisión** es una de tres:

- **`has_client_access(fila.client_id)`** — la fila pertenece a una marca.
- **Comparar contra `mi_agencia()`** — la fila pertenece a una agencia directamente, o la
  comprobación vive dentro de una función `SECURITY DEFINER` que ya tiene la fila en la mano.
- **Se queda `is_agency()`** — la comprobación no necesita fila, o la fila la acota otra mitad de la
  misma expresión. **Cada una lleva su motivo escrito**, porque un `is_agency()` que se quede donde
  hacía falta comparar la agencia es exactamente la fuga que este paso existe para evitar.

| # | Archivo:línea | Qué era | Decisión | Por qué |
|---|---|---|---|---|
| 1 | `0001:235` | la definición de `is_agency()` | **Sin cambios** | Sigue respondiendo "soy personal de agencia". Es la pregunta correcta; lo que faltaba era acompañarla de una fila. Cambiarla aquí rompería las 44 llamadas a la vez sin que ninguna diga qué compara. |
| 2 | `0001:247` | `has_client_access` = `is_agency() or exists(client_contacts…)` | **Reescrita** (el embudo) | Es el cambio central. Ahora `(is_agency() and c.agency_id = mi_agencia()) or exists(client_contacts…)`. Aísla de golpe sus 15 sitios de llamada sin editar ni una de sus políticas. |
| 3 | `0001:304` | `profiles_select` … `or is_agency()` | **`mi_agencia()` + contactos de mis marcas** | Un perfil no cuelga de una marca, cuelga de una agencia (o de ninguna, si es contacto). Con `is_agency()` a secas, A leía nombre, correo y teléfono de todo el personal y todos los contactos de B. |
| 4 | `0001:310` (`using`) | `clients_agency_write` | **`agency_id = mi_agencia()`** | La fila ES de una agencia; se compara la columna directamente. |
| 5 | `0001:310` (`with check`) | `clients_agency_write` | **`agency_id = mi_agencia()`** | El caso que el spec señala: un `with check` sobre una fila que se está creando no puede preguntar `has_client_access` por ella, porque todavía no existe. Lo que se acota es el `agency_id` que entra. Sin esto, A crea una marca dentro de B. |
| 6 | `0001:313` | `client_assignments_select` | **`is_agency() and has_client_access(client_id)`** | La fila cuelga de una marca. El `is_agency()` se conserva a propósito: sin él, la otra rama de `has_client_access` (ser contacto) abriría esta tabla a los contactos de cliente, que hoy no la ven. Aislar no es ensanchar. |
| 7 | `0001:314` (`using`) | `client_assignments_write` | **`is_agency() and has_client_access(client_id)`** | Igual que la anterior. |
| 8 | `0001:314` (`with check`) | `client_assignments_write` | **`is_agency() and has_client_access(client_id)`** | Aquí el `with check` SÍ puede usar `has_client_access`: la marca a la que apunta la fila nueva ya existe (`client_id` es clave ajena). La diferencia con `clients` es concreta y es la que explica por qué no son el mismo caso. |
| 9 | `0001:315` | `client_contacts_select` … `is_agency() or profile_id = auth.uid()` | **`(is_agency() and has_client_access(client_id)) or profile_id = auth.uid()`** | La segunda rama se queda intacta: es lo que deja a un contacto ver sus propias filas, incluidas las de marcas de dos agencias distintas. |
| 10 | `0001:316` (`using`) | `client_contacts_write` | **`is_agency() and has_client_access(client_id)`** | La fila cuelga de una marca. |
| 11 | `0001:316` (`with check`) | `client_contacts_write` | **`is_agency() and has_client_access(client_id)`** | Sin esto, A vincula a un contacto suyo a una marca de B y le abre todo el panel de esa marca. |
| 12 | `0001:320` | `content_pieces_agency_write` (insert) | **`is_agency() and has_client_access(client_id)`** | La marca existe, así que el `with check` puede preguntar por ella. Es el único verbo que devuelve `42501` cuando rechaza. |
| 13 | `0001:321` (`using`) | `content_pieces_agency_update` | **`is_agency() and has_client_access(client_id)`** | Ver la nota del final sobre qué puede y qué no puede observar una prueba aquí. |
| 14 | `0001:321` (`with check`) | `content_pieces_agency_update` | **`is_agency() and has_client_access(client_id)`** | Impide además mover una pieza a una marca ajena por el `with check`, aunque el privilegio de columna sobre `client_id` ya lo cierre desde `0007`. Dos controles y no uno. |
| 15 | `0001:322` | `content_pieces_agency_delete` | **`is_agency() and has_client_access(client_id)`** | Borrar la pieza de otra agencia es destruir su trabajo, no sólo verlo. |
| 16 | `0001:329` | `attachments_agency_write` … `is_agency() and has_client_access(…)` | **Se queda `is_agency()`** | La segunda mitad de la expresión ya acota la fila, y desde este archivo `has_client_access()` mira la marca. El `is_agency()` aquí significa "el cliente no sube archivos", que es una regla de rol y no de inquilino. |
| 17 | `0001:331` | `attachments_agency_delete` | **`is_agency() and has_client_access(marca_de_pieza(…))`** | Era el `is_agency()` suelto más dañino: A borraba los adjuntos de cualquier pieza de B. `0003` ya había dejado escrito que el `and has_client_access(...)` estaba ahí "para que un futuro acotamiento alcance también al borrado"; hoy es ese futuro. |
| 18 | `0001:352` (`using`) | `gcal_map_admin` | **`is_agency() and has_client_access(client_id)`** | El mapeo cuelga de una marca. |
| 19 | `0001:352` (`with check`) | `gcal_map_admin` | **`… and conexion_de_mi_agencia(connection_id)`** | La mitad que no es obvia: sin ella A mapea SU marca al calendario de Google de B y termina escribiendo eventos en un servicio de terceros a nombre de otra agencia. |
| 20 | `0001:353` | `gcal_map_select` | **`is_agency() and has_client_access(client_id)`** | Igual que el `using`. |
| 21 | `0001:354` | `event_links_agency` | **`is_agency() and has_client_access(marca_de_pieza(content_piece_id))`** | La fila cuelga de una pieza, la pieza de una marca. Filtra el id del evento de Google y el calendario de la otra agencia. |
| 22 | `0001:362` (`using`) | `notification_settings_write` | **`is_agency() and has_client_access(client_id)`** | La fila cuelga de una marca. |
| 23 | `0001:362` (`with check`) | `notification_settings_write` | **`is_agency() and has_client_access(client_id)`** | Sin esto A cambia los avisos de una marca de B (o los apaga). |
| 24 | `0001:372` | `submit_for_review` | **`+ has_client_access(v_client)`** | La función ya leía `client_id`; sólo faltaba compararlo. Una RPC es una llamada HTTP igual de fácil que una escritura de tabla: si no comprueba, el aislamiento de las políticas se esquiva llamándola. |
| 25 | `0001:432` | `mark_scheduled` | **`+ client_id` al `select` y `has_client_access`** | No leía la marca en absoluto. Sin el `client_id` añadido no hay nada con qué comparar. |
| 26 | `0001:445` | `mark_published` | **`+ client_id` al `select` y `has_client_access`** | Igual. Sin el arreglo, A marcaba como publicada una pieza de B. |
| 27 | `0001:457` | `cancel_content_piece` | **`+ client_id` al `select` y `has_client_access`** | Igual. Sin el arreglo, A cancelaba una pieza de B con el motivo que quisiera. |
| 28 | `0001:468` | `reschedule_content_piece` | **`+ client_id` al `select` y `has_client_access`** | No leía nada de la pieza antes de escribirla. |
| 29 | `0002:17` | `attachments_write` (storage) … `is_agency() and has_client_access(carpeta)` | **Se queda `is_agency()`** | La segunda mitad ya acota, y hereda el aislamiento del embudo: la política llama a `has_client_access((storage.foldername(name))[1]::uuid)`. Aquí `is_agency()` significa "el cliente no sube archivos". |
| 30 | `0002:22` | `attachments_delete` (storage, versión de `0002`) | **Sustituida por `0003`** | `0003:74` la reemplazó y es esa versión la que corre. Se documenta porque el `grep` la encuentra y alguien podría creer que quedó sin auditar. |
| 31 | `0003:74` | `attachments_delete` (storage, vigente) … `is_agency() and has_client_access(carpeta)` | **Se queda `is_agency()`** | Misma razón que `0002:17`: la segunda mitad acota la carpeta y hereda. Es literalmente el caso que el comentario de `0003` anticipaba. |
| 32 | `0005:73` | `ideas_select`, rama de agencia | **`is_agency() and has_client_access(ideas.client_id)`** | `0005` anotaba que `has_client_access()` "NO sirve acá" porque no distinguía agencia de contacto. Sigue sin servir SOLA, y por eso la forma es `is_agency() and …` y la rama del contacto conserva su `exists` explícito con su filtro por estado. |
| 33 | `0005:84` | `ideas_agency_write` (insert) | **`is_agency() and has_client_access(client_id)`** | La marca ya existe: el `with check` puede preguntar por ella. |
| 34 | `0005:87` (`using`) | `ideas_agency_update` | **`is_agency() and has_client_access(client_id)`** | La fila cuelga de una marca. |
| 35 | `0005:87` (`with check`) | `ideas_agency_update` | **`is_agency() and has_client_access(client_id)`** | Idem. |
| 36 | `0005:90` | `ideas_agency_delete` | **`is_agency() and has_client_access(client_id)`** | Idem. |
| 37 | `0005:103` | `idea_history_select`, rama de agencia | **`is_agency() and has_client_access(marca_de_idea(idea_id))`** | La fila cuelga de una idea, la idea de una marca. La rama del contacto se queda igual: sigue filtrando por transición y no por idea, por lo que documenta `0005`, y eso no tiene que ver con las agencias. |
| 38 | `0005:209` | `discard_idea` … `is_agency() or exists(client_contacts…)` | **`has_client_access(v_client)`** | Esa expresión es exactamente lo que `has_client_access()` responde ahora. Sustituirla por la llamada deja una sola definición de "quién alcanza esta marca" en vez de dos que hay que mantener de acuerdo. |
| 39 | `0005:244` | `resubmit_idea` | **`+ has_client_access(v_client)`** | Ya leía `client_id`. |
| 40 | `0005:274` | `convert_idea_to_piece` | **`+ has_client_access(v_client_idea)`** | La que el spec señala con nombre. Ya comparaba que idea y pieza fueran de la misma marca; faltaba que esa marca fuera tuya. Con comprobarlo sobre la idea basta: si la pieza es de la misma marca que la idea, y la marca de la idea es de tu agencia, la pieza también. |
| 41 | `0006:48` | `client_packages_select`, rama de agencia | **`is_agency() and has_client_access(client_packages.client_id)`** | `0006` dejó escrito "no simplifiques esto de vuelta a `has_client_access()`". Sigue valiendo: la rama del contacto conserva su `exists` explícito. Lo que cambia es sólo la rama de agencia. |
| 42 | `0006:59` | `client_packages_agency_insert` | **`is_agency() and has_client_access(client_id)`** | Es lo que la agencia le cobra a la marca. |
| 43 | `0006:63` (`using`) | `client_packages_agency_update` | **`is_agency() and has_client_access(client_id)`** | Idem. |
| 44 | `0006:63` (`with check`) | `client_packages_agency_update` | **`is_agency() and has_client_access(client_id)`** | Idem. |
| 45 | `0006:66` | `client_packages_agency_delete` | **`is_agency() and has_client_access(client_id)`** | Idem. |
| 46 | `0013:45` | `submit_for_internal_review` (función nueva) | **`is_agency() and has_client_access(v_client)`** | Mismo patrón que `submit_for_review`: cualquiera del equipo puede proponer, pero solo sobre una pieza de su propia agencia. |
| 47 | `0013:67` | `approve_internal_review` (función nueva) | **`is_agency_admin() and has_client_access(v_client)`** | El admin de otra agencia también tiene que rechazarse aquí — ser admin no basta, tiene que ser admin DE ESTA agencia. |
| 48 | `0013:89` | `request_internal_changes` (función nueva) | **`is_agency_admin() and has_client_access(v_client)`** | Misma razón que la anterior. |

Son 48 filas para 47 llamadas porque la fila 30 documenta una política que `0003` sustituyó y que ya
no está viva: se incluye para que nadie la lea como un sitio sin auditar.

### Los 3 `is_agency(` que están en comentarios

No deciden nada; se listan porque la orden decía "todos" y porque un lector futuro los va a encontrar
con `grep`.

| Archivo:línea | Qué es |
|---|---|
| `0006:56` | Comentario que explica por qué la escritura de paquetes queda reservada a la agencia. Sigue siendo cierto; sólo que ahora "la agencia" significa "tu agencia". |
| `0007:50` | Comentario de `CN-001`: enumera las tres funciones que se resuelven contra `profiles.role`. Sigue siendo cierto. |
| `0009:4` | Comentario que dice que `0009` no aísla nada todavía y que el aislamiento es el paso 2. Era cierto cuando se escribió y describe el estado anterior a este archivo; no se toca porque `0009` no se edita. |

---

## 2. Los 10 usos de `is_agency_admin()` en código

| # | Archivo:línea | Qué era | Decisión | Por qué |
|---|---|---|---|---|
| 1 | `0001:240` | la definición | **Sin cambios** | Mismo criterio que `is_agency()`: la pregunta de rol es correcta, lo que faltaba era la fila. |
| 2 | `0001:306` (`using`) | `profiles_admin_manage` | **`is_agency_admin() and (agency_id = mi_agencia() or es_contacto_de_mi_agencia(id))`** | Sin esto, el administrador de A cambiaba el nombre —o borraba la fila— de cualquier usuario de B. La segunda rama es la que le deja seguir gestionando a los contactos de sus propias marcas, que no tienen `agency_id`. |
| 3 | `0001:306` (`with check`) | `profiles_admin_manage` | **Misma expresión** | La mitad que impide dejar la fila apuntando a otra agencia después del update. |
| 4 | `0001:351` (`using`) | `gcal_conn_admin` | **`is_agency_admin() and agency_id = mi_agencia()`** | La tabla no tenía dueño: era global del sistema porque el sistema era de una sola agencia. Guarda `access_token` y `refresh_token` de Google. Esta fuga no filtra datos, filtra credenciales. |
| 5 | `0001:351` (`with check`) | `gcal_conn_admin` | **Misma expresión** | Impide crear o mover una conexión dentro de otra agencia. |
| 6 | `0001:355` (`using`) | `webhook_configs_admin` | **`is_agency_admin() and agency_id = mi_agencia()`** | Misma historia: `secret` es la clave con la que se firma lo que sale hacia Make. Leerla es poder falsificar eventos de otra agencia contra su propio receptor. |
| 7 | `0001:355` (`with check`) | `webhook_configs_admin` | **Misma expresión** | Idem. |
| 8 | `0001:356` | `webhook_deliveries_admin` | **`is_agency_admin() and webhook_de_mi_agencia(webhook_config_id)`** | El envío guarda el payload completo de la pieza: título, copy, estado y marca. Se acota por el webhook que lo originó. `webhook_config_id` es anulable, y una entrega sin webhook no la ve nadie: en la duda no se enseña. |
| 9 | `0005:126` | `submit_idea_to_client` | **`+ has_client_access(v_client)`** | Es admin de SU agencia, no de la de al lado. Ya leía `client_id`. |
| 10 | `0005:144` | `request_idea_internal_changes` | **`+ client_id` al `select` y `has_client_access`** | No leía la marca: sólo estado y autor. Hubo que añadir el `client_id` para tener con qué comparar. |
| 11 | `0007:114` | `guard_profile_role` … `and not is_agency_admin()` | **Se queda `is_agency_admin()`** | Es un trigger de guarda sobre `profiles.role`, y la fila que protege la acota **la política**, no el trigger: sólo llega aquí un update que `profiles_update_self` o `profiles_admin_manage` ya autorizó, y las dos están acotadas por agencia desde este archivo. Añadir aquí una comparación de agencia sería un segundo control sobre la misma fila, con la trampa añadida de que esta función **no** es `SECURITY DEFINER` a propósito (lo documenta `0007`) y llamar a `mi_agencia()` desde ella se resolvería igual pero haría creer que el guard decide algo que no decide. |

Son 11 filas para 10 llamadas y 1 definición porque la línea `0001:306` y la `0001:355` llevan dos
llamadas cada una (`using` y `with check`) y se auditan por separado.

### Agregadas después de `0010`

La regla 9 de `CLAUDE.md` pide una fila por cada sitio nuevo. El recuento de arriba es el de `0010` y
no se toca; lo nuevo va aquí, con su archivo.

| # | Archivo:línea | Qué es | Decisión | Por qué |
|---|---|---|---|---|
| 12 | `0012:69` | `renombrar_mi_agencia(p_nombre)` … `if not is_agency_admin() or v_agencia is null` | **`is_agency_admin()` + `where id = mi_agencia()`** (`0012:81`) | `is_agency_admin()` responde "¿puedes renombrar?" (un `agency_member` no); la fila la fija `v_agencia := mi_agencia()`, **que no es un parámetro**: no hay id de agencia que el navegador pueda cambiar, así que no hay comparación que olvidar. Es `SECURITY DEFINER` y no una política de `UPDATE` porque `agencies` no está en el bloque de privilegios de columna: `authenticated` tiene UPDATE de tabla sobre todas sus columnas y una política acotaría la fila pero no la columna (`id`, `created_at`…). La función escribe sólo `name`. Pruebas: `tests/integration/renombrar-agencia.test.ts`, que afirma que el nombre de B **sigue igual** después de que el administrador de A lo intenta por los tres caminos (parámetro colado, update directo, RPC legítima). |

### Los 3 `is_agency_admin(` en comentarios

`0007:50` (la enumeración de `CN-001`), `0007:104` (por qué `guard_profile_role` puede llamarla sin
ser `SECURITY DEFINER`) y `0007:111` (por qué `crearUsuario` está exento del guard). Ninguno decide
nada.

---

## 3. Las funciones `SECURITY DEFINER`

`grep -c "security definer"` da **29** en `supabase/migrations/**`, que es el número del spec, pero
ese conteo incluye las redefiniciones: `handle_new_user()` aparece dos veces (`0001` y `0007`).
Distintas son **23** antes de este archivo. Aquí está cada una.

### Reescritas en `0010` (10)

| Función | Qué le faltaba |
|---|---|
| `submit_for_review` | Comparaba `is_agency()` y escribía. Ahora `has_client_access(v_client)`. |
| `mark_scheduled` | No leía la marca. Se le añadió `client_id` al `select` y la comparación. |
| `mark_published` | Idem. |
| `cancel_content_piece` | Idem. |
| `reschedule_content_piece` | Idem; no leía nada de la pieza antes de escribirla. |
| `submit_idea_to_client` | `is_agency_admin()` sin marca. |
| `request_idea_internal_changes` | `is_agency_admin()` sin marca, y no leía `client_id`. |
| `discard_idea` | `is_agency() or exists(contactos)` → `has_client_access(v_client)`. |
| `resubmit_idea` | `is_agency()` sin marca. |
| `convert_idea_to_piece` | Comparaba idea contra pieza pero no contra tu agencia. |

**El orden de las comprobaciones importa** y está elegido, no heredado: la de pertenencia va
**después** de la de existencia y **antes** de las de estado. Antes de la de existencia cambiaría el
mensaje `La idea no existe` por uno de autorización y rompería pruebas que afirman ese texto; después
de las de estado filtraría, por el mensaje de error, en qué estado está una pieza de otra agencia.
`discard_idea` lleva un comentario en el propio SQL porque ahí el orden quedó **al revés** que en
`0005` y no es un descuido: `has_client_access(null)` es falso, así que dejarla primero haría que una
idea inexistente respondiera `No autorizado`.

### Nuevas en `0010` (7)

| Función | Para qué |
|---|---|
| `mi_agencia()` | La agencia del usuario actual. `SECURITY DEFINER` para leer `profiles` sin chocar con la RLS de `profiles`, que a su vez la llama. Devuelve NULL para un contacto, y el NULL es el que niega. |
| `has_client_access(uuid)` | El embudo reescrito. Es la única función existente cuya **definición** cambia. |
| `marca_de_pieza(uuid)` | La marca de una pieza, sin que la RLS de `content_pieces` se interponga al resolverla desde otra política. |
| `marca_de_idea(uuid)` | Igual, para ideas. |
| `es_contacto_de_mi_agencia(uuid)` | Si un perfil es contacto de alguna marca de mi agencia. Es la mitad que deja ver a los contactos de tus propias marcas, que no tienen `agency_id`. |
| `conexion_de_mi_agencia(uuid)` | Si una conexión de Google es de mi agencia. |
| `webhook_de_mi_agencia(uuid)` | Si un webhook es de mi agencia. |

Los cinco ayudantes son `SECURITY DEFINER` **no por comodidad**: una política que consulta otra tabla
aplica también la RLS de esa otra tabla, así que la subconsulta devolvería lo que el usuario puede
ver en vez de la verdad — a veces cerrando de más, a veces enredándose con la política que la llamó.

### Deliberadamente sin tocar (13)

| Función | Por qué no necesita comparar la agencia |
|---|---|
| `is_agency()` | Responde una pregunta de rol, no de fila. Es correcta; lo que hacía falta era acompañarla. |
| `is_agency_admin()` | Igual. |
| `current_role_is(user_role)` | Lee el rol del propio llamador. No hay otra fila en juego. |
| `handle_new_user()` (versión de `0007`) | Crea el perfil como `'client'` con `agency_id` nulo y no lee ninguna otra fila. La agencia la pondrá el alta del paso 3, que será su propia función `SECURITY DEFINER`. |
| `approve_content_piece` | Ya preguntaba `has_client_access(v_client)` **y** exigía estar en `client_contacts` de esa marca. Hereda el aislamiento del embudo. |
| `request_changes` | Idem. |
| `approve_idea` | Exige estar en `client_contacts` de la marca de la idea. Es una pertenencia por fila que nunca dependió de la agencia: un contacto de A no está en los contactos de una marca de B. **Nunca fue una fuga.** |
| `request_idea_client_changes` | Idem. |
| `notify_comment` (`0007`) | Ya pregunta `has_client_access(v_client)` antes de escribir, y deriva los destinatarios de `client_assignments`/`client_contacts` de esa marca. Hereda. |
| `set_attachment_round` (`0003`) | Trigger `before insert` sobre `attachments`: calcula una ronda a partir del historial de SU propia pieza. Qué filas pueden insertarse lo decide `attachments_agency_write`, que sí está acotada. |
| `check_comment_attachment_piece` (`0004`) | Trigger que comprueba que el adjunto anclado sea de la misma pieza. Relación entre dos filas que ya pasaron por sus políticas. |
| `guard_attachment_path` (`0007`) | Trigger que comprueba que la carpeta del adjunto sea la marca de su pieza. Misma situación. |
| `touch_updated_at()` | No es `SECURITY DEFINER` y no decide nada. Se lista para que el recuento cierre. |

`guard_profile_role()` (`0007`) tampoco es `SECURITY DEFINER` — deliberadamente, y `0007` explica por
qué — y ya está auditada en la tabla de `is_agency_admin()`.

### Nuevas después de `0010`

| Función | Archivo | Cómo queda acotada |
|---|---|---|
| `renombrar_mi_agencia(text)` | `0012_renombrar_agencia.sql` | Fila 12 de la tabla de `is_agency_admin()`: rol con `is_agency_admin()`, fila con `mi_agencia()`, columna fija (`name`). `EXECUTE` sólo para `authenticated`. |

---

## 4. Lo que hay que saber para leer las pruebas

**Tres pruebas de `tests/integration/aislamiento.test.ts` no se ponen rojas contra su propia política
sin aislar, y hay que decirlo en voz alta:**

- `no puede editar la pieza de B`
- `no puede borrar la pieza de B`
- `no puede borrar el adjunto de B`

Se midió: revirtiendo `content_pieces_agency_update`, `content_pieces_agency_delete` y
`attachments_agency_delete` a su `is_agency()` original, las tres siguen en **verde**.

**El porqué que daba antes esta sección era equivocado, aunque la conclusión se sostiene.** Decía que
un `UPDATE` o un `DELETE` con `where` "tiene que leer la fila", y que por eso la política de escritura
no puede distinguirse nunca de la de lectura. A nivel de SQL eso es falso: **la política de escritura
sí es alcanzable sin la de lectura.** Se comprobó en la Postgres local con una tabla de juguete,
`select using (false)` y `update using (true)`, como `authenticated`:

| Sentencia | Resultado |
|---|---|
| `update t set texto = '...' where id = 1;` | `UPDATE 0` — con `where` se leen columnas, así que sí entra la política de `SELECT` |
| `update t set texto = '...';` | `UPDATE 1` — **sin `where` no se lee ninguna columna, la de `SELECT` no entra, y decide sólo la de `UPDATE`** |

Lo que tapa ese camino hoy no es Postgres: es **PostgREST**, que se niega a ejecutar una escritura sin
filtro. Verificado contra la instancia local, y ni siquiera la clave de servicio lo esquiva:

```
UPDATE sin filtro  -> {"code":"21000", "message":"UPDATE requires a WHERE clause"}
DELETE sin filtro  -> {"code":"21000", "message":"DELETE requires a WHERE clause"}
```

Así que la conclusión operativa no cambia — **por la API que usa la app no hay forma de que una prueba
distinga la política de escritura de la de lectura**, y quitar el `.select()` de la llamada tampoco
cambia nada; se probó —, pero el motivo es otro, y el motivo importa.

**La consecuencia, escrita para que no haya que volver a deducirla:** el aislamiento de esas tres
políticas se apoya hoy en un guard de PostgREST, no en las políticas mismas. Si ese guard deja de
estar —una versión de PostgREST que no lo traiga, o una configuración que lo desactive— o si aparece
una función `SECURITY INVOKER` que haga un `UPDATE` o un `DELETE` sin filtro (corre como quien llama,
así que se le aplica la política de escritura y no la de lectura), esos tres caminos quedan
expuestos **y ninguna prueba de esta suite se va a poner roja.** Quien toque cualquiera de las dos
cosas tiene que volver a este párrafo.

Lo que esas tres pruebas sí detectan: se ponen rojas en cuanto se revierte `has_client_access()`, que
es la política que de verdad decide en ese camino. La versión acotada de las políticas de escritura
es defensa en profundidad —para el día en que una fila llegue por un camino que no pase por la
lectura— y su mitad observable, el `with check` del `insert`, sí tiene su prueba en rojo propia
(`42501`).

**Dos pruebas de RPC no tienen versión sin aislar contra la que ponerse rojas:** `approve_idea` y
`request_idea_client_changes` rebotan por pertenencia a `client_contacts`, igual antes que después de
`0010`. Se prueban de todos modos porque el aislamiento tiene que valer para todas las RPC, no sólo
para las que hubo que arreglar.

**`notifications_select` tampoco tenía versión sin aislar:** siempre fue `profile_id = auth.uid()` y
nunca usó `is_agency()`. Para comprobar que su prueba muerde se la mutó a
`is_agency() or profile_id = auth.uid()` —la forma que tendría si alguien "la arreglara" mal— y la
prueba se puso roja.

---

## 5. Lo que se encontró fuera de las políticas

**Los sitios que llaman a `createServiceClient()` son TRES, no dos.** Esta sección enumeraba dos y se
dejó fuera el tercero, que resultó ser el que tenía el agujero. El recuento completo,
`grep -rn "createServiceClient" --include=*.ts --include=*.tsx` sin contar `lib/supabase/server.ts`
(donde se define) ni los mocks de `tests/unit/`:

| Archivo | Para qué usa el cliente de servicio | Cómo queda acotado |
|---|---|---|
| `lib/webhooks/dispatch.ts` | Leer los webhooks activos y registrar la entrega | Resuelve la agencia de la marca de la pieza y filtra por ella **en el propio archivo** |
| `lib/google-calendar/sync.ts` | Leer la conexión de Google y sus tokens | Llega a la conexión **por el mapeo de la marca**, y el `with check` de `gcal_map_admin` impide que un mapeo apunte a la conexión de otra agencia |
| `app/admin-actions.ts` (`crearUsuario`) | `auth.admin.createUser` y el update de `profiles.role` / `profiles.agency_id` | **Sólo para eso.** El vínculo con la marca lo escribe `vincularAMarca` con el cliente sujeto a RLS, así que lo decide `client_contacts_write` / `client_assignments_write` |

`lib/webhooks/dispatch.ts` enviaba cada evento a **todos** los webhooks activos, así que una pieza de
la agencia A salía firmada y completa —título, copy, estado y marca— hacia el endpoint de Make de
todas las demás agencias. Es una fuga entre inquilinos que además sale del producto. Se arregló ahí
mismo y tiene dos pruebas unitarias nuevas.

`app/admin-actions.ts` **no apareció en la auditoría original, y era el tercer sitio.** `crearUsuario`
aceptaba `client_id` de quien llamara y no comprobaba de qué agencia era la marca; su ayudante
`vincularAMarca` escribía la fila de `client_contacts` / `client_assignments` con el cliente de
servicio, saltándose la política. Un administrador de la agencia A podía llamarla con su propio
correo y el `client_id` de una marca de B: devolvía `{ yaExistia: true }` y dejaba escrita la
pertenencia. A partir de ahí `has_client_access()` le respondía **que sí**, correctamente, y con eso
leía marca, pieza, `copy_text`, adjuntos, comentarios y paquete de B; editaba y borraba su pieza;
firmaba una URL de su adjunto; y reapuntaba su mapeo de calendario. Con `role: 'agency_member'` la
fila caía en `client_assignments` y además empezaba a recibir sus notificaciones.

**Ninguna política estaba rota:** se fabricaba la pertenencia por debajo de ellas. Es la misma clase
que la fuga del webhook —un camino con cliente de servicio, fuera de RLS— y por eso el recuento de
esta sección importa más que el de las demás.

El arreglo **no** añade una comprobación paralela en la Server Action: quita el bypass.
`vincularAMarca` escribe con `createClient()`, que es el cliente sujeto a RLS, y ya no lo recibe por
parámetro —lo crea ella— para que no haya llamada desde la que volver a colarle el de servicio. La
base de datos ya rechazaba esa escritura; lo único que hacía falta era dejar de rodearla. Además
`crearUsuario` resuelve la marca **antes** de crear nada y rechaza si no es de su agencia: eso es un
guard de usabilidad, no el control —sin él la cuenta de auth se creaba y el vínculo fallaba después,
dejando un huérfano—, y `vincularAMarca` ya no se traga el error del upsert, que antes descartaba
entero (CN-015 otra vez).

Las pruebas viven en `tests/integration/aislamiento.test.ts` y **prueban la capa de la base de
datos**, no la Server Action: esa suite habla con Postgres directamente y no puede importar un módulo
`server-only`. Lo dice el propio archivo en el comentario de ese bloque, junto con lo que esa capa
**no** cubre.

---

## Addendum — `0016_restringir_acceso_por_asignacion.sql`

**Fecha:** 2026-10-06.

0010 dejó `has_client_access()` dando acceso a **cualquier** personal de agencia (admin o miembro)
sobre **todas** las marcas de su agencia: `client_assignments` existía desde 0001, pero solo
decidía a quién le llegaba una notificación (0001/0005/0007/0013/0014), nunca qué podía ver o
escribir cada quien. 0003 ya lo anotaba en `attachments_agency_delete`: el `and has_client_access(...)`
estaba puesto "para que un futuro acotamiento de `has_client_access()` alcance también al borrado".

0016 es ese acotamiento, a pedido explícito: un `agency_admin` sigue viendo todas las marcas de su
agencia (sin cambio); un `agency_member` ahora solo ve, abre, crea y mueve piezas de las marcas que
tiene en `client_assignments`. El cambio vive en un solo sitio —la propia función— porque el diseño
de 0010 ya enrutaba 40 de sus 44 usos de `is_agency()` a través de `has_client_access(client_id)`,
en lectura **y en escritura**: `content_pieces`, `attachments`, `comments`, `ideas`,
`client_packages`, `notification_settings`, `client_calendar_mappings`, `client_assignments` y
`client_contacts` quedan endurecidos sin tocar ni una de esas políticas.

**La única excepción real:** `clients_agency_write` era una sola política `for all` con
`is_agency() and agency_id = mi_agencia()` -- la razón documentada en 0010 es que el `with check` de
un INSERT no puede preguntar por una fila que no existe. El problema es que, al ser una sola
política, esa misma comparación suelta regía también el UPDATE y el DELETE de una marca **ya
existente**, dejando que cualquier miembro archivara o editara una marca que no tiene asignada. 0016
la parte en tres, igual que ya está partido `content_pieces`:

| Operación | Antes (0010) | Ahora (0016) |
|---|---|---|
| `insert` en `clients` | `is_agency() and agency_id = mi_agencia()` | `is_agency_admin() and agency_id = mi_agencia()` — crear una marca pasa a ser solo de administrador (ver más abajo) |
| `update` en `clients` | igual que insert | `is_agency() and has_client_access(id)` |
| `delete` en `clients` | igual que insert | `is_agency() and has_client_access(id)` |

**Por qué crear una marca pasa a ser solo de administrador, y no es un recorte aparte:** una marca
recién creada no tiene ninguna fila en `client_assignments` todavía, así que si un `agency_member`
pudiera insertarla, su propio `.insert().select()` devolvería cero filas — el `RETURNING` de
Postgres pasa por la política de `select` (que ya depende de `has_client_access()`), no solo por el
`with check` del insert. `createClientEntity` (`app/admin-actions.ts`) y `/clientes/nuevo` pasan a
`requireAgencyAdmin()` por la misma razón: la base ya lo iba a rechazar, y antes de 0016 el límite
real era "cualquier marca de tu agencia", así que no había caso que lo deje al descubierto.

**Lo que NO se tocó a propósito:** `assignTeamMember` / `removeTeamAssignment` (asignar o quitar a
alguien de una marca) siguen gateadas solo por `requireAgencyAdmin()` en la Server Action
(`app/admin-actions.ts`), no por una política de RLS nueva — la política `client_assignments_write`
sigue siendo `is_agency() and has_client_access(client_id)`, igual que antes de 0016. Es la misma
asimetría que ya tenía `client_contacts_write` (la creación de un contacto solo la gatea
`requireAgencyAdmin()` dentro de `crearUsuario`, no la política): un miembro asignado a una marca
podría, a nivel de base, reasignar a otra persona de esa misma marca si llamara a la tabla
directamente. Documentado aquí, no cerrado, por paridad con un patrón que el propio 0010 ya
aceptaba en otro sitio — cerrarlo es un cambio aparte si hace falta.

**Pruebas:** `tests/integration/aislamiento.test.ts`, bloque
`'dentro de una agencia, el acceso de un miembro sigue su asignación (0016)'`. Reemplaza al bloque
`'dentro de una agencia no cambia nada'` que 0010 había escrito con la afirmación contraria (que un
miembro SÍ llegaba a una marca sin asignar) — esa afirmación queda invertida a propósito, no es una
prueba que "se rompió".
