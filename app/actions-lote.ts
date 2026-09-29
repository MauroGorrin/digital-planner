'use server';

import { createContentPiece } from '@/app/actions';
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
 */
export async function createContentPieces(items: ItemDeLote[]): Promise<ResultadoDeLote> {
  if (items.length > TOPE_DE_LOTE) {
    throw new Error(`Un lote no puede pedir más de ${TOPE_DE_LOTE} piezas de una vez.`);
  }

  const creadas: { indice: number; id: string }[] = [];
  const fallidas: { indice: number; mensaje: string }[] = [];

  for (const [indice, item] of items.entries()) {
    try {
      const id = await createContentPiece(item);
      creadas.push({ indice, id });
    } catch (err) {
      fallidas.push({ indice, mensaje: err instanceof Error ? err.message : 'No se pudo crear esta pieza.' });
    }
  }

  return { creadas, fallidas };
}
