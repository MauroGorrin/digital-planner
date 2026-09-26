import { describe, expect, it } from 'vitest';
import { accionesDisponibles, ideaSirveComoOrigenDePieza } from '@/lib/ideas';

describe('accionesDisponibles', () => {
  it('un admin de agencia filtra una propuesta', () => {
    expect(accionesDisponibles('propuesta', 'agency_admin', false)).toEqual([
      'enviar_al_cliente',
      'pedir_correccion_interna',
      'descartar',
    ]);
  });

  it('un miembro de agencia no filtra, solo descarta', () => {
    expect(accionesDisponibles('propuesta', 'agency_member', false)).toEqual(['descartar']);
  });

  it('el cliente decide sobre una idea que le enviaron', () => {
    expect(accionesDisponibles('pendiente_cliente', 'client', true)).toEqual([
      'aprobar',
      'pedir_correccion_cliente',
      'descartar',
    ]);
  });

  it('la agencia no puede aprobar aunque vea la idea pendiente', () => {
    expect(accionesDisponibles('pendiente_cliente', 'agency_admin', false)).toEqual(['descartar']);
  });

  it('una idea en correccion se reenvia desde la agencia', () => {
    expect(accionesDisponibles('correccion_cliente', 'agency_member', false)).toEqual([
      'reenviar',
      'descartar',
    ]);
  });

  it('una idea aprobada se convierte, y solo desde la agencia', () => {
    expect(accionesDisponibles('aprobada', 'agency_admin', false)).toEqual(['convertir', 'descartar']);
    // El brief propone [] aqui, pero la implementacion (paso 7 del propio brief) y el SQL de
    // discard_idea (que permite descartar desde cualquier estado salvo 'convertida', a la agencia
    // o al contacto del cliente) coinciden en que un cliente si puede descartar una idea aprobada.
    // La expectativa correcta es ['descartar'], no [].
    expect(accionesDisponibles('aprobada', 'client', true)).toEqual(['descartar']);
  });

  it('una idea descartada o convertida no ofrece nada', () => {
    expect(accionesDisponibles('descartada', 'agency_admin', false)).toEqual([]);
    expect(accionesDisponibles('convertida', 'agency_admin', false)).toEqual([]);
  });
});

describe('ideaSirveComoOrigenDePieza', () => {
  it('una idea aprobada si sirve de origen', () => {
    expect(ideaSirveComoOrigenDePieza({ status: 'aprobada' })).toBe(true);
  });

  it('una idea todavia en propuesta no sirve de origen', () => {
    expect(ideaSirveComoOrigenDePieza({ status: 'propuesta' })).toBe(false);
  });

  it('una idea ya convertida no sirve de origen otra vez', () => {
    expect(ideaSirveComoOrigenDePieza({ status: 'convertida' })).toBe(false);
  });
});
