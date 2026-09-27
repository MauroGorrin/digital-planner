// Generador de la clave que se le entrega a una persona al crearle la cuenta (ver
// `crearUsuario` en app/admin-actions.ts). La clave se muestra una sola vez y no se guarda
// en ningún sitio: si se pierde, el arreglo es generar otra, no recuperarla.

import { randomBytes } from 'node:crypto';

/**
 * Alfabetos por clase, **sin caracteres ambiguos**: fuera `0`/`O` y `1`/`l`/`I`.
 *
 * No es cosmética. Esta clave viaja entre la agencia y su cliente por WhatsApp, por teléfono o
 * dictada en una llamada, y `O0l1I` es exactamente donde se rompe: el cliente escribe la otra,
 * el login falla y nadie sabe si la clave está mal o la cuenta no existe. Se pierden ~5
 * caracteres de alfabeto y se compensa de sobra con la longitud.
 */
const MAYUSCULAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin O ni I
const MINUSCULAS = 'abcdefghijkmnopqrstuvwxyz'; // sin l
const DIGITOS = '23456789'; // sin 0 ni 1
const SIMBOLOS = '!@#$%&*+-=?';

const CLASES = [MAYUSCULAS, MINUSCULAS, DIGITOS, SIMBOLOS] as const;
const ALFABETO = CLASES.join('');

/** Longitud de la clave generada. 24 con este alfabeto son ~140 bits de entropía. */
export const LONGITUD_DE_CLAVE = 24;

/**
 * Entero aleatorio en [0, tope) a partir de bytes de `crypto`, **sin sesgo**.
 *
 * El `randomBytes(1)[0] % tope` ingenuo reparte mal cuando 256 no es múltiplo de `tope`: los
 * primeros restos salen más veces que los últimos. Se descarta el tramo sobrante y se vuelve a
 * pedir byte (rejection sampling). Con los tamaños de aquí el descarte es mínimo y el bucle
 * termina con probabilidad 1.
 */
function enteroAleatorio(tope: number): number {
  if (tope <= 0 || tope > 256) throw new Error('Tope fuera de rango para enteroAleatorio.');
  const limite = Math.floor(256 / tope) * tope;
  for (;;) {
    const byte = randomBytes(1)[0];
    if (byte < limite) return byte % tope;
  }
}

/** Un carácter al azar del alfabeto que se le pase. */
function caracterDe(alfabeto: string): string {
  return alfabeto[enteroAleatorio(alfabeto.length)];
}

/**
 * Fisher-Yates con aleatoriedad de `crypto`.
 *
 * Tiene que ser `crypto` y no `Math.random()`: garantizar una clase por posición fija y después
 * mezclar con un PRNG predecible deja la clave tan adivinable como el PRNG — la mezcla es parte
 * de la clave, no un detalle de presentación.
 */
function mezclar(caracteres: string[]): string[] {
  for (let i = caracteres.length - 1; i > 0; i--) {
    const j = enteroAleatorio(i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j], caracteres[i]];
  }
  return caracteres;
}

/**
 * Devuelve una clave nueva de `LONGITUD_DE_CLAVE` caracteres con al menos una mayúscula, una
 * minúscula, un dígito y un símbolo, y sin ningún carácter ambiguo.
 *
 * Toda la aleatoriedad sale de `crypto.randomBytes`. `Math.random()` no aparece en este archivo
 * a propósito: es un PRNG sembrado por el proceso, no un CSPRNG, y esta es la única clave que
 * protege la cuenta de un cliente hasta que la cambie.
 */
export function generarClave(): string {
  // Una de cada clase primero, para que las cuatro estén garantizadas...
  const caracteres = CLASES.map((clase) => caracterDe(clase));
  // ...el resto libre del alfabeto completo...
  while (caracteres.length < LONGITUD_DE_CLAVE) caracteres.push(caracterDe(ALFABETO));
  // ...y se mezcla, para que la clase de cada posición no sea deducible.
  return mezclar(caracteres).join('');
}
