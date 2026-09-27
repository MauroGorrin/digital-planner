# Multi-agencia y registro público

**Fecha:** 2026-09-27
**Estado:** diseñado, **pendiente de tu revisión antes de escribir código**

Esto no es una pantalla más. Convierte una herramienta de una agencia en un producto donde cualquier
agencia se da de alta y trabaja aislada de las demás. El modo de fallo que importa no es "no
compila": es que una agencia vea las marcas, las piezas o los comentarios de otra. Por eso el spec
existe antes que el código.

## El problema

Hoy la app asume **una sola agencia: la tuya**. No es una suposición implícita, está escrita:

```sql
create or replace function is_agency()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('agency_admin','agency_member'));
$$;
```

No pregunta *de qué* agencia. Cualquier usuario con rol de agencia ve **todas** las marcas. Con una
sola agencia eso es correcto y está documentado como el modelo del producto. Con dos, es una fuga
total entre inquilinos.

## Lo que hay hoy, medido

| | Cantidad |
|---|---|
| Tablas con RLS | 19 |
| Políticas | 44 |
| Funciones `SECURITY DEFINER` | 29 |
| Usos de `is_agency()` | 47 |
| Usos de `has_client_access()` | 23 |
| Usos de `is_agency_admin()` | 14 |
| Políticas que pasan por alguna de las tres | 40 de 44 |

**Ese último número es la buena noticia del diseño.** No hay 44 reescrituras independientes: hay un
embudo de tres funciones. `has_client_access(uuid)` ya recibe el id de la marca, así que reescribirla
para que además compare la agencia arregla 23 sitios de una vez, sin tocar sus políticas.

## Alcance

**Dentro:** el concepto de agencia, el aislamiento entre agencias en la base, el registro público con
verificación de correo, y el alta de la agencia de quien se registra.

**Fuera, deliberadamente:**

| No se construye | Por qué |
|---|---|
| Facturación, planes y límites de uso | Es otro producto dentro del producto. Primero que dos agencias convivan sin verse. |
| Que una persona pertenezca a varias agencias | Ver la decisión de abajo. Se puede agregar después cambiando una columna por una tabla de unión; hacerlo ahora multiplica cada política por un `exists`. |
| Subdominio o URL por agencia | No cambia el aislamiento, que es lo que importa. Se agrega cuando haya a quién enseñárselo. |
| Verificación del teléfono por SMS | Requiere contratar un proveedor y cada mensaje cuesta. El correo sí se verifica. |
| Invitar miembros del equipo durante el registro | El alta crea a la primera persona; el resto entra por `crearUsuario`, que ya existe. |

## Decisiones tomadas, para que las revises como criterio

### 1. Una persona pertenece a una sola agencia

`profiles.agency_id` es una columna, no una tabla de unión. Un freelance que trabaje para dos
agencias necesita dos cuentas con dos correos.

**Por qué:** la alternativa convierte cada comprobación de pertenencia en un `exists` sobre una tabla
de unión, en las 40 políticas y las 29 funciones, y multiplica la superficie donde un error aísla mal.
El caso de uso es real pero minoritario, y pasar de columna a tabla de unión después es una migración
acotada — al revés no.

**Ojo con lo que esta decisión NO limita:** solo afecta al personal de agencia. Un contacto de
cliente tiene `agency_id` nulo y se conecta por `client_contacts`, que ya es una tabla de unión — así
que el responsable de marketing de una marca puede seguir siendo contacto de marcas de agencias
distintas sin ningún cambio.

### 2. Quien se registra crea su agencia y queda como su administrador

El alta pública crea tres cosas en una transacción: el usuario, una fila en `agencies`, y su perfil
con `role = 'agency_admin'` y `agency_id` apuntando a la agencia nueva.

**Esto reintroduce, de forma acotada, lo que cerramos en `0007`.** Ahí el problema era que
`handle_new_user()` leía el rol de la metadata del endpoint público: cualquiera pedía ser
`agency_admin` y lo era **de todo el sistema**. Aquí el rol sí lo determina el registro, pero de una
agencia recién creada y vacía, que no contiene datos de nadie más. La diferencia es el alcance, y solo
se sostiene si el aislamiento de la sección siguiente es correcto. **Si el aislamiento falla, esto
vuelve a ser la vulnerabilidad crítica de esta mañana.**

Por eso `handle_new_user()` **no** vuelve a leer la metadata. El alta de agencia pasa por una función
`SECURITY DEFINER` dedicada, que valida y crea las tres filas junto con su comprobación.

### 3. El correo se verifica; el resto se valida

- **Correo:** confirmación obligatoria antes del primer ingreso. Ya está activado en Supabase.
- **Nombre y apellido:** campos separados, no un `full_name`. Se validan longitud y que no vengan
  vacíos ni con solo espacios. `profiles.full_name` se mantiene como columna derivada para no tocar
  las ~20 pantallas que ya la muestran.
- **Teléfono:** formato internacional E.164 (`+` y de 8 a 15 dígitos), validado en el cliente y en la
  base con un `check`. La columna `profiles.phone` ya existe.
- **Agencia:** nombre obligatorio.

Validar no es verificar, y el spec lo dice en vez de sugerir lo contrario: de estos campos **solo el
correo queda probado**. Nombre, apellido y teléfono quedan bien formados y sin comprobar.

## Diseño

### Modelo de datos

Migración `0009`.

**`agencies`** — `id`, `name`, `created_at`, `updated_at`.

**`profiles.agency_id`** — uuid anulable → `agencies`. Nulo en los contactos de cliente; obligatorio,
por `check`, cuando el rol es de agencia.

**`clients.agency_id`** — uuid **not null** → `agencies`. Una marca pertenece a una agencia.

**Retrocompatibilidad:** la migración crea una agencia con tus datos actuales, apunta a ella todos los
`profiles` con rol de agencia y todas las filas de `clients`, y recién entonces pone el `not null`.
Tus datos siguen funcionando igual y tú quedas como administrador de tu agencia.

### El aislamiento: reescribir el embudo, no las 44 políticas

```sql
-- La agencia del usuario actual. SECURITY DEFINER para leer profiles sin chocar con su propia RLS.
create or replace function mi_agencia() returns uuid ...

-- Antes: "soy personal de agencia?" -- Ahora: "soy personal de agencia DE ESTA marca?"
create or replace function has_client_access(target_client_id uuid) returns boolean ... as $$
  select exists (
    select 1 from clients c
    where c.id = target_client_id
      and (
        (is_agency() and c.agency_id = mi_agencia())
        or exists (select 1 from client_contacts cc
                   where cc.client_id = c.id and cc.profile_id = auth.uid())
      )
  );
$$;
```

Con eso, los 23 sitios que ya llaman a `has_client_access(client_id)` quedan aislados sin editarlos.

**Lo que no se arregla solo, y es donde vive el riesgo:** los 47 usos de `is_agency()` a secas.
`is_agency()` seguirá respondiendo "soy personal de agencia", que sin la marca no aísla nada. Cada uno
de esos 47 hay que mirarlo y decidir si pasa a `has_client_access(...)`, a una comparación explícita
contra `mi_agencia()`, o si de verdad no necesita fila (por ejemplo, "puedo crear una marca").

**Eso es una auditoría, no un reemplazo mecánico, y es la parte cara de este trabajo.** Un
`is_agency()` que se quede donde hacía falta comparar la agencia es exactamente una fuga entre
inquilinos que compila, pasa las pruebas existentes y no se ve.

### El registro

Página pública `/registro`, fuera del middleware de sesión:

1. Formulario: nombre, apellido, teléfono, correo, contraseña, nombre de la agencia.
2. Validación en el cliente y otra vez en el servidor — el navegador no es un control.
3. `supabase.auth.signUp()` con la confirmación de correo activada.
4. Al confirmar y entrar por primera vez, se llama a la función `SECURITY DEFINER` que crea la
   agencia y completa el perfil.
5. Protección contra bots: Turnstile o hCaptcha, que Supabase soporta de forma nativa en el signup.

Hay que **volver a habilitar `enable_signup`** en `config.toml` y en el panel, y actualizar la regla 7
de `CLAUDE.md`, que hoy dice lo contrario. Ese cambio se hace **en el mismo commit** que el
aislamiento, nunca antes.

## Qué se prueba

El aislamiento entre agencias es la entrega; el resto es accesorio.

**Integración, contra Postgres real** — con dos agencias completas en el fixture:

1. Un `agency_admin` de la agencia A **no ve** ninguna marca de la agencia B. Cero filas.
2. Tampoco ve sus piezas, ideas, comentarios, adjuntos, historial, notificaciones ni paquetes —
   **una prueba por tabla**, las 19. Es repetitivo a propósito: es la única forma de saber que no
   quedó una política sin convertir.
3. Un `agency_admin` de A **no puede** aprobar, editar ni borrar una pieza de B.
4. Un contacto de cliente de una marca de A no ve nada de B.
5. Un contacto que lo sea de marcas de **dos agencias distintas** ve las dos, y solo esas.
6. El alta crea agencia, perfil y rol en una sola transacción; si algo falla, no queda ni un usuario
   huérfano ni una agencia vacía.
7. Nadie puede cambiarse su propio `agency_id` — mismo mecanismo de privilegio de columna que `0007`
   aplica a `role`.

**Unitarias:** los validadores de teléfono, nombre y apellido.

**De componente:** el formulario de registro rechaza cada campo mal formado con su mensaje.

## Criterios de aceptación

1. CUANDO un usuario de la agencia A consulta cualquier tabla, EL SISTEMA devuelve solo filas de A.
2. CUANDO un usuario de A intenta escribir una fila de B, EL SISTEMA lo rechaza en la base.
3. CUANDO alguien se registra, EL SISTEMA no le da acceso hasta que confirme el correo.
4. CUANDO se completa un alta, EL SISTEMA crea agencia, perfil y rol, o ninguno de los tres.
5. CUANDO un usuario intenta cambiar su `agency_id`, EL SISTEMA lo rechaza con `42501`.
6. CUANDO se aplica la migración sobre los datos actuales, EL SISTEMA los deja en una agencia y nada
   cambia para el usuario de hoy.

## El riesgo, dicho sin adornos

La parte peligrosa no es escribir código nuevo: es **convertir 47 llamadas a `is_agency()` sin
olvidar ninguna**. Una que se quede sin convertir es una fuga silenciosa entre agencias —
compila, pasa el gate actual, y solo se nota cuando dos clientes reales comparen lo que ven.

Por eso las pruebas van tabla por tabla en vez de por muestreo, y por eso este trabajo necesita su
propia auditoría al final, igual que la de hoy.

## Orden de entrega

1. Migración `0009`: `agencies`, las dos columnas, el backfill de tus datos y el `not null`.
2. Reescritura del embudo (`mi_agencia()`, `has_client_access()`) y **la auditoría de los 47
   `is_agency()`**, con las 19 pruebas de aislamiento. Es el grueso y es donde vive la seguridad.
3. El alta: función de creación de agencia, página `/registro`, validadores y captcha.
4. Reabrir `enable_signup`, actualizar `CLAUDE.md`, y una auditoría final de aislamiento.

Los pasos 1 y 2 no sirven de nada por separado, y el 4 **no se hace antes que el 2** bajo ninguna
circunstancia: abrir el registro con el aislamiento a medias es publicar la vulnerabilidad.
