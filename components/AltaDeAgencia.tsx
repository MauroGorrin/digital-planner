'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { completarAltaDeAgencia } from '@/app/registro-actions';
import { validarNombreDeAgencia } from '@/lib/validacion-registro';

/**
 * El último paso del alta: confirmar el nombre y crear la agencia.
 *
 * Se pregunta el nombre otra vez aunque casi siempre venga prellenado desde el registro. Es lo que
 * convierte un alta a medio terminar en algo recuperable: si alguien confirmó su correo y nunca
 * llegó a promocionarse — porque cerró la pestaña, porque se registró con una versión anterior de
 * la app, o porque la metadata se perdió — esta pantalla sigue pudiendo terminar el trabajo en vez
 * de dejar una cuenta confirmada que no lleva a ningún sitio.
 */
export function AltaDeAgencia({ nombreSugerido }: { nombreSugerido: string }) {
  const router = useRouter();
  const [nombre, setNombre] = useState(nombreSugerido);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);

  async function alEnviar(e: React.FormEvent) {
    e.preventDefault();
    const invalido = validarNombreDeAgencia(nombre);
    if (invalido) {
      setError(invalido);
      return;
    }
    setError(null);
    setCreando(true);
    try {
      await completarAltaDeAgencia(nombre);
      router.push('/calendario');
      router.refresh();
    } catch (e) {
      // El mensaje que llega aquí es el de un `raise exception` de `crear_mi_agencia()`, que
      // `errorParaElCliente` deja pasar tal cual porque son frases pensadas para leerse ("Tu cuenta
      // ya pertenece a una agencia"). Cualquier otro error llega ya convertido en el genérico.
      setError(e instanceof Error ? e.message : 'No pudimos crear tu agencia.');
      setCreando(false);
    }
  }

  return (
    <form onSubmit={alEnviar} noValidate className="space-y-4">
      <div>
        <label htmlFor="alta-nombre-agencia" className="mb-1 block text-sm font-medium text-slate-700">
          Nombre de tu agencia
        </label>
        <input
          id="alta-nombre-agencia"
          value={nombre}
          onChange={(e) => {
            setNombre(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
          placeholder="Mi Agencia"
        />
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={creando}
        className="w-full rounded-full bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-800 disabled:opacity-60"
      >
        {creando ? 'Creando tu agencia…' : 'Crear mi agencia'}
      </button>
    </form>
  );
}
