import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { FilaDeMetrica } from '@/lib/metricas';
import { FORMAT_LABELS } from '@/types/database';
import { MESES } from '@/components/TablaDeMetricas';

// PDF descargable del mismo reporte que ya muestran PanelDeMetricas (agencia) y ReportePublico
// (link compartido) -- las mismas FilaDeMetrica que ya calcula lib/metricas.ts, solo con otro
// renderizador. Los primitivos (Document, Page, View, Text) son de @react-pdf/renderer, no HTML:
// no se comparte JSX con TablaDeMetricas aunque muestren la misma tabla.
const estilos = StyleSheet.create({
  pagina: { padding: 32, fontSize: 11, fontFamily: 'Helvetica' },
  titulo: { fontSize: 18, marginBottom: 2 },
  subtitulo: { fontSize: 11, color: '#64748b', marginBottom: 20 },
  encabezado: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#94a3b8',
    paddingBottom: 6,
    marginBottom: 4,
  },
  encabezadoTexto: { flex: 1, fontFamily: 'Helvetica-Bold' },
  fila: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#e2e8f0', paddingVertical: 6 },
  celda: { flex: 1 },
  celdaOpaca: { flex: 1, color: '#94a3b8' },
  aviso: { fontSize: 10, color: '#475569', marginTop: 16 },
});

export function ReporteMetricasPdf({
  clientName,
  anio,
  mes,
  filas,
}: {
  clientName: string;
  anio: number;
  mes: number;
  filas: FilaDeMetrica[];
}) {
  return (
    <Document>
      <Page size="A4" style={estilos.pagina}>
        <Text style={estilos.titulo}>{clientName}</Text>
        <Text style={estilos.subtitulo}>
          Reporte de contenido — {MESES[mes - 1]} {anio}
        </Text>

        <View style={estilos.encabezado}>
          <Text style={estilos.encabezadoTexto}>Formato</Text>
          <Text style={estilos.encabezadoTexto}>Contratado</Text>
          <Text style={estilos.encabezadoTexto}>Planificado</Text>
          <Text style={estilos.encabezadoTexto}>Entregado</Text>
        </View>

        {filas.map((fila) => (
          <View key={fila.format} style={estilos.fila}>
            <Text style={estilos.celda}>{FORMAT_LABELS[fila.format]}</Text>
            {fila.contratado === null ? (
              <Text style={estilos.celdaOpaca}>Fuera del paquete</Text>
            ) : (
              <Text style={estilos.celda}>{fila.contratado}</Text>
            )}
            <Text style={estilos.celda}>{fila.planificado}</Text>
            <Text style={estilos.celda}>{fila.entregado}</Text>
          </View>
        ))}

        {filas.length === 0 && <Text style={estilos.aviso}>Sin contenido registrado este mes.</Text>}
      </Page>
    </Document>
  );
}
