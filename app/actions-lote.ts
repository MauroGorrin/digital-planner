'use server';

import { createContentPiece } from '@/app/actions';
import { requireAgency } from '@/lib/auth';
import { unstable_rethrow } from 'next/navigation';
import type { ContentFormat, PlatformType } from '@/types/database';

/** Mismos campos que acepta createContentPiece — createContentPieces no agrega ni quita ninguno. */
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

/**
 * Tope duro de un lote, verificado antes de crear nada.
 *
 * Ni la carga múltiple (10 archivos) ni la recurrencia (12 repeticiones) pueden pedir más por su
 * propia interfaz — esto es una red de seguridad del lado del servidor, no algo que el uso normal
 * vaya a tocar.
 */
const TOPE_DE_LOTE = 12;

/**
 * Crea varias piezas de contenido de una vez, reutilizando `createContentPiece` ítem por ítem.
 *
 * Por dentro es un bucle sobre `createContentPiece`, a propósito: es la misma validación, el mismo
 * scoping por agencia (`requireAgency()`) y el mismo mensaje de error que ya tiene la creación de
 * una sola pieza, sin lógica nueva de autorización que pueda desalinearse de la original.
 *
 * Si un ítem falla, los que ya se crearon ANTES quedan creados -- no se revierte nada. Es el mismo
 * criterio que ya usa ContentPieceForm hoy para una sola pieza: mejor una pieza de más creada y
 * visible que perder trabajo válido porque una fila tuvo un problema.
 *
 * Invariante: este archivo NUNCA hace un insert directo a `content_pieces` -- todo pasa por
 * `createContentPiece`, que es lo que hace automático el scoping por agencia (RLS). Si hace falta
 * otro campo o comportamiento, se agrega ahí, no acá.
 */
export async function createContentPieces(items: ItemDeLote[]): Promise<ResultadoDeLote> {
  if (items.length > TOPE_DE_LOTE) {
    throw new Error(`Un lote no puede pedir más de ${TOPE_DE_LOTE} piezas de una vez.`);
  }

  // Se resuelve la sesión UNA vez acá, antes del bucle y fuera de cualquier try/catch.
  // requireAgency() funciona lanzando el redirect() de Next (un throw especial, NEXT_REDIRECT)
  // cuando la sesión expiró o el rol no alcanza, y ese throw tiene que escapar tal cual -- el
  // try/catch de abajo, pensado para que un ítem fallido no tumbe a los demás, lo confundiría con
  // el fallo de una sola pieza y lo repetiría como fila de `fallidas` una vez por ítem, sin
  // redirigir nunca. createContentPiece vuelve a resolver el perfil por ítem (es barato y es la
  // función ya probada); esto solo adelanta la parte que puede redirigir.
  await requireAgency();

  const creadas: { indice: number; id: string }[] = [];
  const fallidas: { indice: number; mensaje: string }[] = [];

  for (const [indice, item] of items.entries()) {
    try {
      const id = await createContentPiece(item);
      creadas.push({ indice, id });
    } catch (err) {
      // Defensa en profundidad: si de todos modos un redirect() de Next se lanza acá dentro,
      // unstable_rethrow lo deja escapar en vez de convertirlo en una fila de `fallidas` sin
      // sentido (ver el comentario de arriba sobre por qué ese throw no puede tratarse como un
      // fallo más).
      unstable_rethrow(err);
      fallidas.push({ indice, mensaje: err instanceof Error ? err.message : 'No se pudo crear esta pieza.' });
    }
  }

  return { creadas, fallidas };
}
