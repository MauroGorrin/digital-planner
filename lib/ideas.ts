import type { Idea, IdeaStatus, IdeaStatusHistoryEntry, UserRole } from '@/types/database';

export type AccionDeIdea =
  | 'enviar_al_cliente'
  | 'pedir_correccion_interna'
  | 'aprobar'
  | 'pedir_correccion_cliente'
  | 'reenviar'
  | 'convertir'
  | 'descartar';

/**
 * Que puede hacer cada rol con una idea segun su estado.
 *
 * Existe para que la interfaz no ofrezca un boton que la base va a rechazar: las reglas de verdad
 * estan en las funciones SECURITY DEFINER de 0005_ideas.sql, y esto es su reflejo para decidir que
 * dibujar. Si las dos se separan, manda la base y la interfaz esta mal.
 */
export function accionesDisponibles(
  status: IdeaStatus,
  rol: UserRole,
  esContactoDelCliente: boolean
): AccionDeIdea[] {
  if (status === 'descartada' || status === 'convertida') return [];

  const esAgencia = rol === 'agency_admin' || rol === 'agency_member';
  const acciones: AccionDeIdea[] = [];

  if (status === 'propuesta' && rol === 'agency_admin') {
    acciones.push('enviar_al_cliente', 'pedir_correccion_interna');
  }
  if (status === 'pendiente_cliente' && esContactoDelCliente) {
    acciones.push('aprobar', 'pedir_correccion_cliente');
  }
  if ((status === 'correccion_interna' || status === 'correccion_cliente') && esAgencia) {
    acciones.push('reenviar');
  }
  if (status === 'aprobada' && esAgencia) {
    acciones.push('convertir');
  }

  if (esAgencia || esContactoDelCliente) acciones.push('descartar');

  return acciones;
}

/**
 * Si esta idea puede usarse como origen de una pieza nueva.
 *
 * El mismo requisito vive en `convert_idea_to_piece` (0005_ideas.sql), que es quien de verdad lo
 * hace cumplir. Esto existe para que `/piezas/nueva?idea=...` no le arme a un usuario un
 * formulario prellenado que la base va a rechazar — un enlace viejo a una idea ya convertida o
 * todavia en propuesta simplemente debe degradar a un formulario en blanco, no a un error.
 */
export function ideaSirveComoOrigenDePieza(idea: Pick<Idea, 'status'>): boolean {
  return idea.status === 'aprobada';
}

/**
 * Agrupa filas de idea_status_history por idea, mas reciente primero dentro de cada grupo.
 *
 * Existe para que `app/ideas/page.tsx` pueda traer el historial de todas las ideas visibles en
 * una sola consulta (`.in('idea_id', ids)`) y repartirlo en memoria, en vez de una consulta por
 * tarjeta -- que es invisible con cuatro ideas y arruina la pagina con doscientas.
 */
export function agruparHistorialPorIdea(
  historial: IdeaStatusHistoryEntry[]
): Record<string, IdeaStatusHistoryEntry[]> {
  const porIdea: Record<string, IdeaStatusHistoryEntry[]> = {};
  for (const entrada of historial) {
    (porIdea[entrada.idea_id] ??= []).push(entrada);
  }
  for (const lista of Object.values(porIdea)) {
    lista.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  }
  return porIdea;
}
