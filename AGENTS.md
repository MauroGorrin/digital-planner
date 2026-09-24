# digital-planner — instrucciones para agentes

Planificador de contenido para agencia + clientes: calendario compartido, aprobación con estados,
Google Calendar y webhooks a Make. Next.js 14 + Supabase (Postgres/Auth/Storage/RLS).

## Comandos

| Tarea | Comando |
|---|---|
| Instalar | `npm install` |
| Dev | `npm run dev` |
| Build | `npm run build` |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Pruebas unitarias | `npm run test` |
| Pruebas de integración | `npm run test:integration` |

## No negociable

1. Nunca cambies `content_pieces.status` fuera de las funciones `SECURITY DEFINER` en
   `supabase/migrations/0001_init.sql`.
2. Nunca expongas `SUPABASE_SERVICE_ROLE_KEY` a código cliente.
3. Nunca edites una migración ya aplicada — agrega una nueva.
4. Nunca mockees Postgres en `tests/integration/**`.
5. Nunca marques una tarea terminada con el gate en rojo.

Arquitectura completa, límites entre capas y tokens de diseño: ver `CLAUDE.md` en este directorio.
