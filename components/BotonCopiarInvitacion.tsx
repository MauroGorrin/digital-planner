'use client';

import { useState } from 'react';
import { mensajeDeInvitacion } from '@/lib/invitacion';

/**
 * Para un contacto que YA existe (no acaba de crearse, así que no hay clave que mostrar): copia el
 * mismo mensaje de invitación que `PanelDeCuentaCreada`, sin credenciales, para reenviarle el
 * enlace a quien lo haya perdido o lo esté pidiendo de nuevo.
 */
export function BotonCopiarInvitacion({
  fullName,
  email,
  marca,
  agencyName,
}: {
  fullName: string;
  email: string;
  marca: string;
  agencyName?: string;
}) {
  const [copiada, setCopiada] = useState(false);

  async function copiar() {
    const mensaje = mensajeDeInvitacion({
      fullName,
      marca,
      email,
      baseUrl: typeof window !== 'undefined' ? window.location.origin : '',
      agencyName,
    });
    try {
      await navigator.clipboard.writeText(mensaje);
      setCopiada(true);
      setTimeout(() => setCopiada(false), 2000);
    } catch {
      // Igual que BotonCopiarLink: sin portapapeles disponible no hay más que hacer aquí.
    }
  }

  return (
    <button type="button" onClick={copiar} className="text-xs text-brand-600 hover:underline">
      {copiada ? '¡Copiado!' : 'Copiar invitación'}
    </button>
  );
}
