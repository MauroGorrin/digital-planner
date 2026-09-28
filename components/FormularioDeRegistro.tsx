'use client';

import { useState } from 'react';
import Link from 'next/link';
import { registrarAgencia } from '@/app/registro-actions';
import { Captcha } from '@/components/Captcha';
import { captchaEsObligatorio } from '@/lib/captcha';
import {
  registroEsValido,
  validarRegistro,
  type CampoDeRegistro,
  type DatosDeRegistro,
  type ErroresDeRegistro,
} from '@/lib/validacion-registro';

const VACIO: DatosDeRegistro = {
  nombre: '',
  apellido: '',
  telefono: '',
  correo: '',
  clave: '',
  nombreDeAgencia: '',
};

const ETIQUETAS: Record<CampoDeRegistro, string> = {
  nombre: 'Nombre',
  apellido: 'Apellido',
  telefono: 'Teléfono',
  correo: 'Correo electrónico',
  clave: 'Contraseña',
  nombreDeAgencia: 'Nombre de tu agencia',
};

/**
 * Formulario del alta pública de agencia.
 *
 * Valida con `lib/validacion-registro.ts` ANTES de enviar, y la Server Action vuelve a validar con
 * esas mismas funciones. Lo de aquí es para que el error salga junto al campo sin esperar un viaje
 * de red; el control es el del servidor. Si esta validación desapareciera, el alta seguiría siendo
 * correcta y sólo sería peor de usar.
 */
export function FormularioDeRegistro() {
  const [datos, setDatos] = useState<DatosDeRegistro>(VACIO);
  const [errores, setErrores] = useState<ErroresDeRegistro>({});
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState<'confirmar' | 'entrar' | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  function cambiar(campo: CampoDeRegistro, valor: string) {
    setDatos((previo) => ({ ...previo, [campo]: valor }));
    // El error del campo se borra al escribir en él, no al enviar: dejarlo puesto mientras la
    // persona lo corrige convierte el mensaje en ruido y hace dudar de si se está corrigiendo algo.
    setErrores((previos) => (previos[campo] ? { ...previos, [campo]: undefined } : previos));
  }

  async function alEnviar(e: React.FormEvent) {
    e.preventDefault();
    setMensaje(null);

    const encontrados = validarRegistro(datos);
    if (!registroEsValido(encontrados)) {
      setErrores(encontrados);
      return; // No se envía nada: el servidor rechazaría lo mismo y el viaje no aporta.
    }
    setErrores({});

    if (captchaEsObligatorio() && !captchaToken) {
      setMensaje('Resuelve el captcha antes de continuar.');
      return;
    }

    setEnviando(true);
    try {
      const resultado = await registrarAgencia({ ...datos, captchaToken });
      if (!resultado.ok) {
        if (resultado.errores) setErrores(resultado.errores);
        if (resultado.mensaje) setMensaje(resultado.mensaje);
        return;
      }
      setListo(resultado.necesitaConfirmacion ? 'confirmar' : 'entrar');
    } catch {
      setMensaje('No pudimos crear tu cuenta. Inténtalo de nuevo en un momento.');
    } finally {
      setEnviando(false);
    }
  }

  if (listo === 'confirmar') {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        <h2 className="text-lg font-semibold text-slate-900">Revisa tu correo</h2>
        <p className="mt-2 text-sm text-slate-600">
          Te enviamos un enlace de confirmación a <strong>{datos.correo.trim()}</strong>. Ábrelo para
          activar tu cuenta y crear tu agencia.
        </p>
        <p className="mt-4 text-xs text-slate-400">
          Si no lo ves en unos minutos, revisa la carpeta de correo no deseado.
        </p>
      </div>
    );
  }

  if (listo === 'entrar') {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        <h2 className="text-lg font-semibold text-slate-900">Tu cuenta está lista</h2>
        <p className="mt-2 text-sm text-slate-600">Ya puedes crear tu agencia y empezar a trabajar.</p>
        <Link
          href="/bienvenida"
          className="mt-5 inline-block rounded-full bg-ink-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-800"
        >
          Continuar
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={alEnviar} noValidate className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Campo campo="nombre" valor={datos.nombre} error={errores.nombre} onCambio={cambiar} autoComplete="given-name" />
        <Campo campo="apellido" valor={datos.apellido} error={errores.apellido} onCambio={cambiar} autoComplete="family-name" />
      </div>
      <Campo
        campo="telefono"
        valor={datos.telefono}
        error={errores.telefono}
        onCambio={cambiar}
        tipo="tel"
        autoComplete="tel"
        ayuda="Formato internacional, por ejemplo +584141234567"
      />
      <Campo campo="correo" valor={datos.correo} error={errores.correo} onCambio={cambiar} tipo="email" autoComplete="email" />
      <Campo
        campo="clave"
        valor={datos.clave}
        error={errores.clave}
        onCambio={cambiar}
        tipo="password"
        autoComplete="new-password"
        ayuda="Mínimo 12 caracteres. Una frase que recuerdes es mejor que una palabra con símbolos."
      />
      <Campo
        campo="nombreDeAgencia"
        valor={datos.nombreDeAgencia}
        error={errores.nombreDeAgencia}
        onCambio={cambiar}
        autoComplete="organization"
      />

      <Captcha onToken={setCaptchaToken} />

      {mensaje && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {mensaje}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-full bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-800 disabled:opacity-60"
      >
        {enviando ? 'Creando tu cuenta…' : 'Crear mi cuenta'}
      </button>
    </form>
  );
}

function Campo({
  campo,
  valor,
  error,
  onCambio,
  tipo = 'text',
  autoComplete,
  ayuda,
}: {
  campo: CampoDeRegistro;
  valor: string;
  error?: string;
  onCambio: (campo: CampoDeRegistro, valor: string) => void;
  tipo?: string;
  autoComplete?: string;
  ayuda?: string;
}) {
  const id = `registro-${campo}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
        {ETIQUETAS[campo]}
      </label>
      <input
        id={id}
        name={campo}
        type={tipo}
        value={valor}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onCambio(campo, e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
      />
      {ayuda && !error && <p className="mt-1 text-xs text-slate-400">{ayuda}</p>}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
