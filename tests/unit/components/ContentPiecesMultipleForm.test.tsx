import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentPiecesMultipleForm } from '@/components/ContentPiecesMultipleForm';
import { createContentPieces } from '@/app/actions-lote';
import { subirArchivoAPieza } from '@/lib/attachments';
import type { Client } from '@/types/database';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

vi.mock('@/app/actions-lote', () => ({
  createContentPieces: vi.fn(),
}));

vi.mock('@/lib/attachments', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/attachments')>();
  return { ...real, subirArchivoAPieza: vi.fn() };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } }),
}));

function crearClientes(): Client[] {
  return [
    {
      id: 'client-a',
      name: 'Cliente A',
      agency_id: 'agency-1',
      brand_name: 'Marca A',
      timezone: 'UTC',
      logo_url: null,
      notes: null,
      archived: false,
      billing_mode: 'paquete',
      created_by: null,
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ];
}

function archivo(nombre: string): File {
  return new File(['contenido'], nombre, { type: 'image/png' });
}

function elegirArchivos(archivos: File[]) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: archivos } });
}

describe('ContentPiecesMultipleForm', () => {
  afterEach(() => vi.clearAllMocks());

  it('elegir 3 archivos muestra 3 filas para completar', () => {
    render(<ContentPiecesMultipleForm clients={crearClientes()} />);
    elegirArchivos([archivo('a.png'), archivo('b.png'), archivo('c.png')]);

    expect(screen.getByText('a.png')).toBeInTheDocument();
    expect(screen.getByText('b.png')).toBeInTheDocument();
    expect(screen.getByText('c.png')).toBeInTheDocument();
  });

  it('al enviar, llama a createContentPieces con un ítem por fila, sube cada archivo a su pieza por índice y enlaza cada fila creada a su ficha', async () => {
    vi.mocked(createContentPieces).mockResolvedValue({
      creadas: [
        { indice: 0, id: 'pieza-1' },
        { indice: 1, id: 'pieza-2' },
      ],
      fallidas: [],
    });
    vi.mocked(subirArchivoAPieza).mockResolvedValue(undefined);

    render(<ContentPiecesMultipleForm clients={crearClientes()} />);
    elegirArchivos([archivo('a.png'), archivo('b.png')]);

    const titulos = screen.getAllByLabelText('Título');
    fireEvent.change(titulos[0], { target: { value: 'Post A' } });
    fireEvent.change(titulos[1], { target: { value: 'Post B' } });

    fireEvent.click(screen.getByRole('button', { name: /Crear 2 piezas/ }));

    await waitFor(() => expect(createContentPieces).toHaveBeenCalledTimes(1));
    const items = vi.mocked(createContentPieces).mock.calls[0][0];
    expect(items[0].title).toBe('Post A');
    expect(items[1].title).toBe('Post B');

    await waitFor(() => expect(subirArchivoAPieza).toHaveBeenCalledTimes(2));
    const llamadaFilaA = vi.mocked(subirArchivoAPieza).mock.calls.find((c) => c[0].contentPieceId === 'pieza-1');
    const llamadaFilaB = vi.mocked(subirArchivoAPieza).mock.calls.find((c) => c[0].contentPieceId === 'pieza-2');
    expect(llamadaFilaA?.[0].file.name).toBe('a.png');
    expect(llamadaFilaB?.[0].file.name).toBe('b.png');

    // Cada fila creada ofrece un enlace directo a su ficha, no solo el mensaje "✓ Creada".
    const enlaces = screen.getAllByRole('link', { name: 'Ver pieza' });
    expect(enlaces).toHaveLength(2);
    expect(enlaces.map((a) => a.getAttribute('href')).sort()).toEqual(['/piezas/pieza-1', '/piezas/pieza-2']);
  });

  it('si subirArchivoAPieza falla para una fila ya creada, esa fila muestra que la pieza existe (con enlace) pero el archivo no subió, distinto de una fila que nunca se creó', async () => {
    vi.mocked(createContentPieces).mockResolvedValue({
      creadas: [
        { indice: 0, id: 'pieza-1' },
        { indice: 1, id: 'pieza-2' },
      ],
      fallidas: [],
    });
    vi.mocked(subirArchivoAPieza).mockImplementation(async ({ contentPieceId }) => {
      if (contentPieceId === 'pieza-1') {
        throw new Error('Se cortó la conexión durante la subida.');
      }
    });

    render(<ContentPiecesMultipleForm clients={crearClientes()} />);
    elegirArchivos([archivo('a.png'), archivo('b.png')]);

    const titulos = screen.getAllByLabelText('Título');
    fireEvent.change(titulos[0], { target: { value: 'Post A' } });
    fireEvent.change(titulos[1], { target: { value: 'Post B' } });

    fireEvent.click(screen.getByRole('button', { name: /Crear 2 piezas/ }));

    await waitFor(() => {
      expect(
        screen.getByText(/Pieza creada, pero no se pudo subir el archivo: Se cortó la conexión durante la subida\./)
      ).toBeInTheDocument();
    });
    // La pieza SÍ existe: distinto del estado 'error' (nunca se creó), sigue teniendo enlace a la ficha.
    expect(screen.getAllByRole('link', { name: 'Ver pieza' }).some((a) => a.getAttribute('href') === '/piezas/pieza-1')).toBe(
      true
    );
    // La fila B, sin problema de subida, sigue mostrando el estado 'creada' normal: su propio
    // enlace, distinto del de la fila A, y ningún mensaje de fallo de subida para ella.
    const enlacesFinales = screen.getAllByRole('link', { name: 'Ver pieza' });
    expect(enlacesFinales).toHaveLength(2);
    expect(enlacesFinales.map((a) => a.getAttribute('href')).sort()).toEqual(['/piezas/pieza-1', '/piezas/pieza-2']);
  });

  it('una fila fallida muestra su error, y la fila que sí se creó sube su archivo igual', async () => {
    vi.mocked(createContentPieces).mockResolvedValue({
      creadas: [{ indice: 0, id: 'pieza-1' }],
      fallidas: [{ indice: 1, mensaje: 'Esa marca no existe o no pertenece a tu agencia.' }],
    });
    vi.mocked(subirArchivoAPieza).mockResolvedValue(undefined);

    render(<ContentPiecesMultipleForm clients={crearClientes()} />);
    elegirArchivos([archivo('a.png'), archivo('b.png')]);
    const titulos = screen.getAllByLabelText('Título');
    fireEvent.change(titulos[0], { target: { value: 'Post A' } });
    fireEvent.change(titulos[1], { target: { value: 'Post B' } });

    fireEvent.click(screen.getByRole('button', { name: /Crear 2 piezas/ }));

    await waitFor(() => {
      expect(screen.getByText('Esa marca no existe o no pertenece a tu agencia.')).toBeInTheDocument();
    });
    expect(subirArchivoAPieza).toHaveBeenCalledTimes(1);
    expect(vi.mocked(subirArchivoAPieza).mock.calls[0][0].contentPieceId).toBe('pieza-1');
  });

  it('elegir más de 10 archivos muestra un error y no arma filas', () => {
    render(<ContentPiecesMultipleForm clients={crearClientes()} />);
    const once = Array.from({ length: 11 }, (_, i) => archivo(`f${i}.png`));

    elegirArchivos(once);

    expect(screen.getByText(/hasta 10 archivos/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Título')).not.toBeInTheDocument();
  });

  it('borrar la fecha de una fila deshabilita el envío y evita el RangeError de una fecha vacía', async () => {
    render(<ContentPiecesMultipleForm clients={crearClientes()} />);
    elegirArchivos([archivo('a.png')]);

    fireEvent.change(screen.getAllByLabelText('Título')[0], { target: { value: 'Post A' } });
    fireEvent.change(screen.getAllByLabelText('Fecha')[0], { target: { value: '' } });

    const boton = screen.getByRole('button', { name: /Crear 1 piezas/ });
    expect(boton).toBeDisabled();

    // Se dispara el submit directo sobre el <form> (fireEvent.submit), no un click sobre el
    // botón: un botón disabled ya bloquea el click por su cuenta, y lo que este caso necesita
    // probar es que `alEnviar` en sí mismo (la función, no solo el atributo del botón) rechaza
    // seguir con una fecha vacía -- new Date('').toISOString() es un RangeError que, si se
    // construyera fuera del try/catch, dejaría `enviando` trabado en true para siempre.
    const formulario = document.querySelector('form') as HTMLFormElement;
    fireEvent.submit(formulario);

    expect(createContentPieces).not.toHaveBeenCalled();
    // El botón nunca cambia a "Creando…": ni se disparó el envío, ni (si algo lo disparara) se
    // quedaría colgado ahí -- sigue mostrando su texto normal de reposo.
    expect(screen.getByRole('button', { name: /Crear 1 piezas/ })).toHaveTextContent('Crear 1 piezas');
  });
});
