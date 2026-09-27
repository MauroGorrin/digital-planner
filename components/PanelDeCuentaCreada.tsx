'use client';

import { useState } from 'react';

export interface CuentaCreada {
  email: string;
  /** La clave generada. Ausente cuando la cuenta ya existía: en ese caso no se tocó su clave. */
  clave?: string;
  yaExistia: boolean;
}

/**
 * Panel que muestra el resultado de crear una cuenta: el correo y, si la cuenta es nueva, la clave
 * generada con un botón para copiarla.
 *
 * Dos decisiones que no son de estilo:
 *
 * 1. **No se oculta solo.** No hay temporizador ni se cierra al navegar. La clave existe una sola
 *    vez y quien la necesita va a cambiar de ventana para pegarla en WhatsApp o en un correo --
 *    justo el momento en el que un panel con temporizador desaparecería. Se va cuando la persona
 *    dice que ya la guardó, y no antes.
 * 2. **Es el mismo panel para los dos casos.** Cuando la cuenta ya existía no hay clave que
 *    mostrar, y el panel lo dice con esas palabras en vez de quedarse en blanco: un hueco donde se
 *    esperaba una clave se lee como un fallo, no como "esta persona ya tenía cuenta".
 */
export function PanelDeCuentaCreada({ cuenta, onCerrar }: { cuenta: CuentaCreada; onCerrar: () => void }) {
  const [copiada, setCopiada] = useState(false);
  const [errorAlCopiar, setErrorAlCopiar] = useState(false);

  async function copiar() {
    if (!cuenta.clave) return;
    setErrorAlCopiar(false);
    try {
      await navigator.clipboard.writeText(cuenta.clave);
      setCopiada(true);
    } catch {
      // El portapapeles puede no estar disponible (contexto no seguro, permiso denegado). No es
      // motivo para esconder la clave: sigue visible arriba para copiarla a mano.
      setErrorAlCopiar(true);
    }
  }

  if (cuenta.yaExistia) {
    return (
      <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
        <p className="text-sm font-semibold text-amber-900">Esa persona ya tenía cuenta</p>
        <p className="mt-1 text-sm text-amber-800">
          <span className="font-medium">{cuenta.email}</span> ya existía en el planner, así que la vinculamos a esta
          marca sin crear nada nuevo. Su clave no se cambió: sigue entrando con la que ya usaba.
        </p>
        <button type="button" onClick={onCerrar} className="mt-3 text-xs font-medium text-amber-900 underline">
          Entendido
        </button>
      </div>
    );
  }

  return (
    <div role="status" className="rounded-lg border border-amber-400 bg-amber-50 px-4 py-3">
      <p className="text-sm font-semibold text-amber-900">Cuenta creada — guarda la clave ahora</p>
      <p className="mt-1 text-sm text-amber-800">
        Entrégale estos datos a la persona por el medio que uses normalmente. Puede cambiar la clave después desde su
        perfil.
      </p>

      <dl className="mt-3 space-y-2">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-amber-700">Correo</dt>
          <dd className="break-all font-mono text-sm text-amber-950">{cuenta.email}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-amber-700">Clave</dt>
          <dd className="break-all font-mono text-base font-semibold text-amber-950" data-testid="clave-generada">
            {cuenta.clave}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-sm font-medium text-red-700">
        Esta clave se muestra una sola vez y no queda guardada en ningún sitio. Si la pierdes, tendrás que crear una
        clave nueva.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={copiar} className="btn-primary">
          {copiada ? 'Clave copiada' : 'Copiar clave'}
        </button>
        <button type="button" onClick={onCerrar} className="text-xs font-medium text-amber-900 underline">
          Ya la guardé, cerrar
        </button>
      </div>
      {errorAlCopiar && (
        <p className="mt-2 text-sm text-red-700">No pudimos usar el portapapeles. Copia la clave de arriba a mano.</p>
      )}
    </div>
  );
}
