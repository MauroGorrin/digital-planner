/**
 * Calcula las fechas de una pieza recurrente.
 *
 * `fechaInicial` es SIEMPRE la primera fecha devuelta, caiga en el día que caiga — es la fecha que
 * la persona ya eligió a propósito en el formulario. `diasDeLaSemana` decide las siguientes:
 * camina día por día desde `fechaInicial` (sin incluirla dos veces) y junta las fechas cuyo día de
 * la semana esté en la lista, hasta juntar `cantidad` en total. La hora se copia de `fechaInicial`
 * en cada una, porque el objeto de partida es un `Date` completo y solo se le cambia el día.
 *
 * `diasDeLaSemana` usa la convención de `Date#getDay()`: 0 = domingo … 6 = sábado.
 */
export function fechasRecurrentes(fechaInicial: Date, diasDeLaSemana: number[], cantidad: number): Date[] {
  if (cantidad <= 0) return [];

  const resultado: Date[] = [new Date(fechaInicial)];
  const cursor = new Date(fechaInicial);

  while (resultado.length < cantidad) {
    cursor.setDate(cursor.getDate() + 1);
    if (diasDeLaSemana.includes(cursor.getDay())) {
      resultado.push(new Date(cursor));
    }
  }

  return resultado;
}
