import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const registrarAgencia = vi.fn();
vi.mock('@/app/registro-actions', () => ({ registrarAgencia: (...args: unknown[]) => registrarAgencia(...args) }));
// Sin variables de captcha: el formulario no debe exigir un token que nadie puede generar aqui.
vi.mock('@/lib/captcha', async (original) => ({
  ...(await original<typeof import('@/lib/captcha')>()),
  captchaEsObligatorio: () => false,
}));

import { FormularioDeRegistro } from '@/components/FormularioDeRegistro';

const VALIDOS = {
  Nombre: 'Mauro',
  Apellido: 'Gorrin',
  'Teléfono': '+584141234567',
  'Correo electrónico': 'mauro@ejemplo.com',
  'Contraseña': 'una-clave-larga-123',
  'Nombre de tu agencia': 'Estudio Norte',
};

function llenar(sobre: Partial<Record<keyof typeof VALIDOS, string>> = {}) {
  for (const [etiqueta, valor] of Object.entries({ ...VALIDOS, ...sobre })) {
    fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } });
  }
}

function enviar() {
  fireEvent.click(screen.getByRole('button', { name: 'Crear mi cuenta' }));
}

beforeEach(() => {
  registrarAgencia.mockReset();
  registrarAgencia.mockResolvedValue({ ok: true, necesitaConfirmacion: true });
});

describe('FormularioDeRegistro', () => {
  it('con todo valido envia los datos y pide revisar el correo', async () => {
    render(<FormularioDeRegistro />);
    llenar();
    enviar();

    await waitFor(() => expect(screen.getByText('Revisa tu correo')).toBeInTheDocument());
    expect(registrarAgencia).toHaveBeenCalledWith(
      expect.objectContaining({ correo: 'mauro@ejemplo.com', telefono: '+584141234567', nombreDeAgencia: 'Estudio Norte' })
    );
  });

  // Cada campo mal formado: su mensaje aparece junto al campo y NO se envia nada. El "no se envia"
  // es la mitad que importa -- sin ella, esta prueba pasaria igual si el formulario mostrara el error
  // y ademas mandara la peticion.
  it.each([
    ['Nombre', '   ', /nombre/i],
    ['Apellido', '', /apellido/i],
    ['Teléfono', '04141234567', /tel[eé]fono/i],
    ['Correo electrónico', 'no-es-un-correo', /correo/i],
    ['Contraseña', 'corta', /contrase[ñn]a/i],
    ['Nombre de tu agencia', '', /agencia/i],
  ] as const)('rechaza %s mal formado con su mensaje y no envia', async (etiqueta, valor, patron) => {
    render(<FormularioDeRegistro />);
    llenar({ [etiqueta]: valor });
    enviar();

    const campo = screen.getByLabelText(etiqueta);
    await waitFor(() => expect(campo).toHaveAttribute('aria-invalid', 'true'));
    const idError = campo.getAttribute('aria-describedby') ?? `${campo.id}-error`;
    expect(document.getElementById(idError)?.textContent ?? '').toMatch(patron);
    expect(registrarAgencia).not.toHaveBeenCalled();
  });
});
