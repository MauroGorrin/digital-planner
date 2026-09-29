import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PanelDeMetricas, type MarcaOpcion } from '@/components/PanelDeMetricas';
import type { FilaDeMetrica } from '@/lib/metricas';
import type { ClientPackage } from '@/types/database';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/app/actions-paquetes', () => ({
  definirCuotaDeFormato: vi.fn().mockResolvedValue(undefined),
  quitarFormatoDelPaquete: vi.fn().mockResolvedValue(undefined),
}));

const MARCA_UNO: MarcaOpcion = { id: 'client-1', name: 'Cliente Uno', brand_name: 'Marca Uno' };

function crearPaquete(overrides: Pick<ClientPackage, 'format' | 'monthly_quota'>[] = []): Pick<ClientPackage, 'format' | 'monthly_quota'>[] {
  return overrides;
}

describe('PanelDeMetricas — selector de marca y editor según el rol', () => {
  it('como cliente: ni el editor ni el selector de marca se renderizan', () => {
    const filas: FilaDeMetrica[] = [{ format: 'post', contratado: 12, planificado: 5, entregado: 3 }];
    const paquete = crearPaquete([{ format: 'post', monthly_quota: 12 }]);

    render(
      <PanelDeMetricas
        role="client"
        brands={[MARCA_UNO]}
        selectedClientId={MARCA_UNO.id}
        clientName={MARCA_UNO.brand_name}
        billingMode="paquete"
        anio={2026}
        mes={9}
        filas={filas}
        paquete={paquete}
      />
    );

    expect(screen.queryByLabelText('Marca')).not.toBeInTheDocument();
    expect(screen.queryByText('Editar el paquete de esta marca')).not.toBeInTheDocument();
  });

  it('como agencia: tanto el selector de marca como el editor se renderizan', () => {
    const filas: FilaDeMetrica[] = [{ format: 'post', contratado: 12, planificado: 5, entregado: 3 }];
    const paquete = crearPaquete([{ format: 'post', monthly_quota: 12 }]);

    render(
      <PanelDeMetricas
        role="agency"
        brands={[MARCA_UNO]}
        selectedClientId={MARCA_UNO.id}
        clientName={MARCA_UNO.brand_name}
        billingMode="paquete"
        anio={2026}
        mes={9}
        filas={filas}
        paquete={paquete}
      />
    );

    expect(screen.getByLabelText('Marca')).toBeInTheDocument();
    expect(screen.getByText('Editar el paquete de esta marca')).toBeInTheDocument();
  });

  it('una fila entregada sin estar contratada se muestra como fuera del paquete, no como incumplimiento', () => {
    const filas: FilaDeMetrica[] = [
      { format: 'post', contratado: 12, planificado: 5, entregado: 3 },
      { format: 'reel', contratado: null, planificado: 2, entregado: 2 },
    ];
    const paquete = crearPaquete([{ format: 'post', monthly_quota: 12 }]);

    render(
      <PanelDeMetricas
        role="agency"
        brands={[MARCA_UNO]}
        selectedClientId={MARCA_UNO.id}
        clientName={MARCA_UNO.brand_name}
        billingMode="paquete"
        anio={2026}
        mes={9}
        filas={filas}
        paquete={paquete}
      />
    );

    // La agrupación explícita que pide el spec.
    const tabla = screen.getByRole('table');
    expect(within(tabla).getByText('Fuera del paquete')).toBeInTheDocument();
    // El reel entregado aparece en la tabla, dentro de esa fila fuera del paquete...
    expect(within(tabla).getByText('Reel')).toBeInTheDocument();
    // ...pero nada en la pantalla lo describe como un incumplimiento o una falta.
    expect(screen.queryByText(/incumpl/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/falta/i)).not.toBeInTheDocument();
  });

  it('una marca sin paquete definido muestra el mensaje explícito en vez de una tabla vacía', () => {
    render(
      <PanelDeMetricas
        role="agency"
        brands={[MARCA_UNO]}
        selectedClientId={MARCA_UNO.id}
        clientName={MARCA_UNO.brand_name}
        billingMode="paquete"
        anio={2026}
        mes={9}
        filas={[]}
        paquete={[]}
      />
    );

    expect(screen.getByText('Esta marca todavía no tiene un paquete mensual definido.')).toBeInTheDocument();
    expect(screen.getByText(/Usa el editor de abajo para definirlo\./)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('como agencia con link y PDF disponibles, aparecen los dos botones de compartir', () => {
    render(
      <PanelDeMetricas
        role="agency"
        brands={[MARCA_UNO]}
        selectedClientId={MARCA_UNO.id}
        clientName={MARCA_UNO.brand_name}
        billingMode="paquete"
        anio={2026}
        mes={9}
        filas={[]}
        paquete={[]}
        linkDelReporte="https://app.ejemplo.com/reportes/client-1/2026/9?firma=abc"
        linkDelPdf="https://app.ejemplo.com/api/reportes/pdf?client=client-1&anio=2026&mes=9&firma=abc"
      />
    );

    expect(screen.getByRole('button', { name: 'Copiar link para compartir' })).toBeInTheDocument();
    const enlacePdf = screen.getByRole('link', { name: 'Descargar PDF' });
    expect(enlacePdf).toHaveAttribute(
      'href',
      'https://app.ejemplo.com/api/reportes/pdf?client=client-1&anio=2026&mes=9&firma=abc'
    );
  });

  it('sin REPORT_LINK_SECRET configurada (linkDelReporte/linkDelPdf undefined), no aparece ningún botón de compartir', () => {
    render(
      <PanelDeMetricas
        role="agency"
        brands={[MARCA_UNO]}
        selectedClientId={MARCA_UNO.id}
        clientName={MARCA_UNO.brand_name}
        billingMode="paquete"
        anio={2026}
        mes={9}
        filas={[]}
        paquete={[]}
      />
    );

    expect(screen.queryByRole('button', { name: 'Copiar link para compartir' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Descargar PDF' })).not.toBeInTheDocument();
  });

  it('como cliente, no aparecen los botones de compartir aunque vengan los links (compartir es cosa de la agencia)', () => {
    render(
      <PanelDeMetricas
        role="client"
        brands={[MARCA_UNO]}
        selectedClientId={MARCA_UNO.id}
        clientName={MARCA_UNO.brand_name}
        billingMode="paquete"
        anio={2026}
        mes={9}
        filas={[]}
        paquete={[]}
        linkDelReporte="https://app.ejemplo.com/reportes/client-1/2026/9?firma=abc"
        linkDelPdf="https://app.ejemplo.com/api/reportes/pdf?client=client-1&anio=2026&mes=9&firma=abc"
      />
    );

    expect(screen.queryByRole('button', { name: 'Copiar link para compartir' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Descargar PDF' })).not.toBeInTheDocument();
  });

  it('una marca libre no muestra el aviso de "paquete sin definir" ni el editor de cuotas', () => {
    const filas: FilaDeMetrica[] = [{ format: 'post', contratado: null, planificado: 5, entregado: 3 }];

    render(
      <PanelDeMetricas
        role="agency"
        brands={[MARCA_UNO]}
        selectedClientId={MARCA_UNO.id}
        clientName={MARCA_UNO.brand_name}
        billingMode="libre"
        anio={2026}
        mes={9}
        filas={filas}
        paquete={[]}
      />
    );

    expect(screen.queryByText('Esta marca todavía no tiene un paquete mensual definido.')).not.toBeInTheDocument();
    expect(screen.queryByText('Editar el paquete de esta marca')).not.toBeInTheDocument();
    expect(screen.getByText(/trabaja en modo libre/)).toBeInTheDocument();
  });
});
