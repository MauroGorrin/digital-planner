# Grilla de contenido / vista previa de feed

**Fecha:** 2026-10-05
**Origen:** descripción entregada por el usuario (`CONTENT-GRID-FEATURE.md`). El commit que aquí se
describe (`3a74e0a`) no existe en este repositorio ni en `origin`, así que esta implementación parte
de la descripción, no de código previo.

## Qué es

Una página que muestra las piezas ya aprobadas, programadas o publicadas como se verían en el feed
de cada red social, para que la agencia y el cliente revisen la estrategia visual antes de que salga.

## Alcance

**Dentro**
- Página `/grilla` (servidor) con las piezas en estado `aprobado`, `programado` o `publicado`.
  - Agencia: piezas de todas sus marcas.
  - Cliente: solo las de sus marcas (`client_contacts`).
- Componente cliente `GrillaDeContenido` con selector de plataforma (todas o una) y contador por plataforma.
- Vistas por plataforma: Instagram, TikTok, LinkedIn, Facebook, X (twitter_x), YouTube, Pinterest.
  Una pieza en plataforma `otra` aparece solo en "Todas" con una vista genérica.
- Imagen de portada: la de `adjuntoDePortada()` (ya existe en `lib/attachments.ts`), firmada con
  `createSignedUrls` en una sola llamada, TTL 3600 s.
- Enlace "Grilla" en la navegación para los tres roles, después de "Calendario".

**Fuera**
- Exportar a HTML, carrusel interactivo, comentarios desde la vista, analíticas, plantillas guardadas.
- Ningún estado de revisión (`borrador`, `pendiente_revision`, `pendiente_revision_interna`,
  `cambios_solicitados`, `cancelado`) aparece aquí, nunca.

## Seguridad

- La RLS ya limita qué piezas puede leer cada usuario (`content_pieces_select`, endurecida en
  `0014`). La página no agrega ninguna lectura con cliente de servicio: usa el cliente de sesión.
- Como la RLS de un contacto de cliente ya oculta `pendiente_revision_interna`, y la página además
  filtra por tres estados concretos, una pieza en revisión interna no puede aparecer aquí.
- Las URLs firmadas son de una hora y solo se generan para piezas que el usuario ya puede leer.

## Decisiones

- Las vistas son componentes presentacionales sin lógica de negocio: reciben las piezas ya
  filtradas y firmadas. Así se prueban con Testing Library sin Supabase.
- Se usan `<img>` y no `next/image`: las URLs son firmadas de Supabase y el dominio no está en
  `remotePatterns` para todas las marcas. `eslint` puede marcar `@next/next/no-img-element`; se
  desactiva solo en esas líneas, con comentario.
- Sin nuevas dependencias.

## Addendum — 2026-10-06: la grilla pasa a ser también la cola de aprobación del cliente

Este spec decía, en **Fuera de alcance**: "Ningún estado de revisión (...) aparece aquí, nunca."
Eso deja de ser cierto para un `pendiente_revision`, y solo para el contacto de cliente que lo
puede aprobar:

- `cargarVistasDeGrilla` (`lib/grilla-datos.ts`) acepta ahora un filtro `estados`. La ruta pública
  (`/grilla/[slug]/[anio]/[mes]`) sigue pasando siempre `ESTADOS_EN_GRILLA` (aprobado, programado,
  publicado) -- ahí no hay sesión que distinga a un cliente de un desconocido con el enlace, así
  que nada en revisión puede aparecer, sin excepción. La grilla privada (`app/grilla/page.tsx`)
  amplía esto a `pendiente_revision`, pero **solo si `profile.role === 'client'`**: para la agencia
  no cambia nada.
- Esas piezas pendientes se muestran en una sección nueva, `RevisionDeCliente`, antes del feed de
  lo ya aprobado: cada una con la tarjeta real de su red (reutiliza `VISTA_POR_PLATAFORMA`, ahora en
  `lib/grilla-vistas.ts`) y, debajo, `AccionesDeAprobacion` -- las mismas Server Actions
  `approvePiece` / `requestPieceChanges` que ya usaba `ContentPieceDetail.tsx`, no un camino nuevo
  de autorización. La grilla le da un segundo lugar desde donde llamarlas, no un permiso nuevo:
  quien puede aprobar sigue siendo exactamente quien ya podía.
- `borrador`, `pendiente_revision_interna` y `cambios_solicitados` siguen sin aparecer nunca en
  ninguna de las dos pantallas.
