import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReportePublico } from '@/components/ReportePublico';
import type { FilaDeMetrica } from '@/lib/metricas';

describe('ReportePublico', () => {
  it('muestra el nombre de la marca, el mes y el año, y la tabla con las filas', () => {
    const filas: FilaDeMetrica[] = [{ format: 'post', contratado: 12, planificado: 5, entregado: 3 }];

    render(
      <ReportePublico
        clientName="Marca Uno"
        billingMode="paquete"
        anio={2026}
        mes={10}
        filas={filas}
        sinPaquete={false}
        linkDelPdf="https://app.ejemplo.com/api/reportes/pdf?client=client-1&anio=2026&mes=10&firma=abc"
      />
    );

    expect(screen.getByText('Marca Uno')).toBeInTheDocument();
    expect(screen.getByText('Octubre 2026')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('nunca muestra un selector de marca ni de mes, ni el editor de cuotas: es una vista fija', () => {
    render(
      <ReportePublico
        clientName="Marca Uno"
        billingMode="paquete"
        anio={2026}
        mes={10}
        filas={[]}
        sinPaquete={true}
        linkDelPdf="https://app.ejemplo.com/api/reportes/pdf?client=client-1&anio=2026&mes=10&firma=abc"
      />
    );

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(screen.queryByText(/editar/i)).not.toBeInTheDocument();
  });

  it('marca libre: muestra el aviso de modo libre y nunca el de "paquete sin definir"', () => {
    const filas: FilaDeMetrica[] = [{ format: 'post', contratado: null, planificado: 5, entregado: 3 }];

    render(
      <ReportePublico
        clientName="Marca Uno"
        billingMode="libre"
        anio={2026}
        mes={10}
        filas={filas}
        sinPaquete={false}
        linkDelPdf="https://app.ejemplo.com/x"
      />
    );

    expect(screen.getByText(/trabaja en modo libre/)).toBeInTheDocument();
    expect(screen.queryByText('Esta marca todavía no tiene un paquete mensual definido.')).not.toBeInTheDocument();
  });

  it('sin paquete definido (y sin ser libre): muestra el aviso explícito en vez de una tabla vacía', () => {
    render(
      <ReportePublico
        clientName="Marca Uno"
        billingMode="paquete"
        anio={2026}
        mes={10}
        filas={[]}
        sinPaquete={true}
        linkDelPdf="https://app.ejemplo.com/x"
      />
    );

    expect(screen.getByText('Esta marca todavía no tiene un paquete mensual definido.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('el botón de descargar PDF apunta exactamente a linkDelPdf', () => {
    render(
      <ReportePublico
        clientName="Marca Uno"
        billingMode="paquete"
        anio={2026}
        mes={10}
        filas={[]}
        sinPaquete={false}
        linkDelPdf="https://app.ejemplo.com/api/reportes/pdf?client=client-1&anio=2026&mes=10&firma=abc"
      />
    );

    expect(screen.getByRole('link', { name: 'Descargar PDF' })).toHaveAttribute(
      'href',
      'https://app.ejemplo.com/api/reportes/pdf?client=client-1&anio=2026&mes=10&firma=abc'
    );
  });
});
