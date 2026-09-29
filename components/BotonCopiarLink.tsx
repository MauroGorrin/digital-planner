'use client';

import { useState } from 'react';

/**
 * Botón que copia una URL al portapapeles y muestra una confirmación breve.
 *
 * Vive aparte de PanelDeMetricas porque necesita `'use client'` (`navigator.clipboard`) y
 * PanelDeMetricas es un Server Component en espíritu -- mismo motivo por el que EditorDePaquete
 * vive en su propio archivo.
 */
export function BotonCopiarLink({ url, etiqueta = 'Copiar link para compartir' }: { url: string; etiqueta?: string }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Algunos navegadores en contextos no seguros (http, o sin el permiso concedido) rechazan
      // clipboard.writeText. No hay nada más que hacer aquí salvo no fingir que sí se copió.
    }
  }

  return (
    <button type="button" onClick={copiar} className="btn-secondary">
      {copiado ? '¡Copiado!' : etiqueta}
    </button>
  );
}
