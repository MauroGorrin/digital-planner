import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generarClave, LONGITUD_DE_CLAVE } from '@/lib/clave';

// `node:crypto` se importa sin problema bajo el entorno jsdom de estas pruebas: jsdom sustituye
// los globales del navegador, pero Vitest sigue corriendo sobre Node y los módulos nativos
// resuelven igual. Por eso esta prueba vive en tests/unit/** como cualquier otra y no necesita
// un entorno propio ni un doble de `randomBytes`.

/** Cuántas claves se generan en las pruebas estadísticas. */
const REPETICIONES = 400;

const AMBIGUOS = ['0', 'O', '1', 'l', 'I'];

function clavesGeneradas(cantidad: number): string[] {
  return Array.from({ length: cantidad }, () => generarClave());
}

describe('generarClave', () => {
  it('devuelve una clave de la longitud declarada, de al menos 20 caracteres', () => {
    expect(LONGITUD_DE_CLAVE).toBeGreaterThanOrEqual(20);
    for (const clave of clavesGeneradas(REPETICIONES)) {
      expect(clave).toHaveLength(LONGITUD_DE_CLAVE);
    }
  });

  it('incluye siempre al menos una mayúscula, una minúscula, un dígito y un símbolo', () => {
    for (const clave of clavesGeneradas(REPETICIONES)) {
      expect(clave, `sin mayúscula: ${clave}`).toMatch(/[A-Z]/);
      expect(clave, `sin minúscula: ${clave}`).toMatch(/[a-z]/);
      expect(clave, `sin dígito: ${clave}`).toMatch(/[0-9]/);
      expect(clave, `sin símbolo: ${clave}`).toMatch(/[!@#$%&*+\-=?]/);
    }
  });

  it('nunca usa un carácter ambiguo (0, O, 1, l, I), porque la clave se dicta o se copia a mano', () => {
    for (const clave of clavesGeneradas(REPETICIONES)) {
      for (const ambiguo of AMBIGUOS) {
        expect(clave.includes(ambiguo), `"${ambiguo}" apareció en ${clave}`).toBe(false);
      }
    }
  });

  it('usa solo caracteres del alfabeto previsto, sin espacios ni acentos', () => {
    for (const clave of clavesGeneradas(REPETICIONES)) {
      expect(clave).toMatch(/^[A-Za-z0-9!@#$%&*+\-=?]+$/);
    }
  });

  it('dos llamadas consecutivas devuelven claves distintas', () => {
    expect(generarClave()).not.toBe(generarClave());
  });

  it('no repite ninguna clave a lo largo de muchas llamadas', () => {
    const claves = clavesGeneradas(REPETICIONES);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('no fija la clase de carácter por posición: la mezcla reparte cada clase por toda la clave', () => {
    // Si se concatenara "una de cada clase" y no se mezclara, la posición 0 sería siempre
    // mayúscula, la 1 siempre minúscula, y así. Se comprueba que la primera posición ve varias
    // clases distintas a lo largo de muchas claves.
    const clasesEnLaPrimeraPosicion = new Set(
      clavesGeneradas(REPETICIONES).map((clave) => {
        const primero = clave[0];
        if (/[A-Z]/.test(primero)) return 'mayuscula';
        if (/[a-z]/.test(primero)) return 'minuscula';
        if (/[0-9]/.test(primero)) return 'digito';
        return 'simbolo';
      })
    );
    expect(clasesEnLaPrimeraPosicion.size).toBeGreaterThan(1);
  });
});

/** Quita comentarios de línea y de bloque, para mirar solo el código ejecutable. */
function sinComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

// Esta última no mira el resultado sino el código fuente, porque ninguna prueba de comportamiento
// puede distinguir una mezcla con `crypto` de una con un PRNG débil: ambas producen claves de la
// misma forma y con la misma pinta estadística a esta escala. Se comprobó: sustituir el
// `enteroAleatorio` del Fisher-Yates por el PRNG del lenguaje deja las siete pruebas de arriba en
// verde. Y sin embargo es justo el fallo que importa — un PRNG sembrado por el proceso hace la
// clave reproducible. Así que se vigila la única propiedad observable que queda: que el PRNG no
// aparezca en el código del archivo.
//
// Se ignoran los comentarios a propósito: lib/clave.ts lo nombra varias veces justamente para
// explicar por qué no lo usa, y una comprobación sobre el texto crudo castigaría esa explicación.
describe('lib/clave.ts como fuente', () => {
  it('no usa el PRNG del lenguaje en ningún sitio: toda la aleatoriedad sale de node:crypto', () => {
    // Ruta relativa al cwd (la raíz del repo, desde donde corre Vitest) y no a `import.meta.url`:
    // bajo este entorno jsdom `import.meta.url` no es una URL `file:` y readFileSync revienta con
    // "The URL must be of scheme file". Mismo criterio que el loadEnvFile de vitest.setup.ts.
    const codigo = sinComentarios(readFileSync(join(process.cwd(), 'lib', 'clave.ts'), 'utf8'));
    expect(codigo).not.toMatch(/Math\s*\.\s*random/);
    expect(codigo).toMatch(/from 'node:crypto'/);
  });
});
