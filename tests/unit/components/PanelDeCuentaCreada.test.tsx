import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelDeCuentaCreada } from '@/components/PanelDeCuentaCreada';

describe('PanelDeCuentaCreada', () => {
  const writeText = vi.fn();
  const onCerrar = vi.fn();

  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    onCerrar.mockReset();
  });

  it('sin `marca`, no ofrece invitación (alta de equipo, no de contacto)', () => {
    render(<PanelDeCuentaCreada cuenta={{ email: 'a@b.com', clave: 'xyz', yaExistia: false }} onCerrar={onCerrar} />);

    expect(screen.queryByRole('button', { name: /Copiar invitación/ })).not.toBeInTheDocument();
  });

  it('con `marca`, copia la invitación con la clave que se acaba de generar', async () => {
    render(
      <PanelDeCuentaCreada
        cuenta={{ email: 'ana@cliente.com', clave: 'xyz123', yaExistia: false, fullName: 'Ana Pérez', marca: 'Mamalactea' }}
        onCerrar={onCerrar}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copiar invitación' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const mensaje = writeText.mock.calls[0][0] as string;
    expect(mensaje).toContain('Ana Pérez');
    expect(mensaje).toContain('Mamalactea');
    expect(mensaje).toContain('xyz123');
  });

  it('cuenta que ya existía: también ofrece invitación, sin clave', async () => {
    render(
      <PanelDeCuentaCreada
        cuenta={{ email: 'ana@cliente.com', yaExistia: true, fullName: 'Ana Pérez', marca: 'Mamalactea' }}
        onCerrar={onCerrar}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copiar invitación' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const mensaje = writeText.mock.calls[0][0] as string;
    expect(mensaje).not.toMatch(/clave/i);
  });

  it('incluye el enlace de WhatsApp con el mismo mensaje', () => {
    render(
      <PanelDeCuentaCreada
        cuenta={{ email: 'ana@cliente.com', clave: 'xyz123', yaExistia: false, fullName: 'Ana Pérez', marca: 'Mamalactea' }}
        onCerrar={onCerrar}
      />
    );

    const enlace = screen.getByRole('link', { name: 'Enviar por WhatsApp' });
    expect(enlace).toHaveAttribute('href', expect.stringContaining('https://wa.me/?text='));
    expect(decodeURIComponent(enlace.getAttribute('href')!.replace('https://wa.me/?text=', ''))).toContain('Mamalactea');
  });
});
