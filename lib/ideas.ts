import type { IdeaStatus, UserRole } from '@/types/database';

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
