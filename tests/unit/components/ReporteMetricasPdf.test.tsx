import { renderToBuffer } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { ReporteMetricasPdf } from '@/components/pdf/ReporteMetricasPdf';
import type { FilaDeMetrica } from '@/lib/metricas';

// Prueba de humo, no de contenido exacto: @react-pdf/renderer produce bytes binarios, no HTML que
// Testing Library pueda inspeccionar. Lo que importa verificar es que renderToBuffer() no revienta
// con las formas reales de FilaDeMetrica (contratado null, cero filas) y que el resultado es un
// PDF de verdad -- los primeros bytes de cualquier PDF válido son la firma "%PDF".
describe('ReporteMetricasPdf', () => {
  it('genera un PDF válido con filas contratadas y fuera del paquete', async () => {
    const filas: FilaDeMetrica[] = [
      { format: 'post', contratado: 12, planificado: 5, entregado: 3 },
      { format: 'reel', contratado: null, planificado: 2, entregado: 2 },
    ];

    const buffer = await renderToBuffer(<ReporteMetricasPdf clientName="Marca Uno" anio={2026} mes={10} filas={filas} />);

    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });

  it('genera un PDF válido incluso sin ninguna fila', async () => {
    const buffer = await renderToBuffer(<ReporteMetricasPdf clientName="Marca Uno" anio={2026} mes={10} filas={[]} />);

    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});
