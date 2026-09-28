import { describe, expect, it } from 'vitest';
import {
  LARGO_MAXIMO_DE_AGENCIA,
  LARGO_MAXIMO_DE_CLAVE,
  LARGO_MAXIMO_DE_CORREO,
  LARGO_MAXIMO_DE_NOMBRE,
  LARGO_MINIMO_DE_CLAVE,
  componerNombreCompleto,
  registroEsValido,
  validarApellido,
  validarClave,
  validarCorreo,
  validarNombre,
  validarNombreDeAgencia,
  validarRegistro,
  validarTelefono,
  type DatosDeRegistro,
} from '@/lib/validacion-registro';

/** Un alta que pasa todos los validadores. Cada prueba rompe UN campo sobre esta base. */
function datosValidos(overrides: Partial<DatosDeRegistro> = {}): DatosDeRegistro {
  return {
    nombre: 'Ana',
    apellido: 'Pérez',
    telefono: '+584141234567',
    correo: 'ana@agencia.test',
    clave: 'una frase larga de verdad',
    nombreDeAgencia: 'Agencia Pérez',
    ...overrides,
  };
}

describe('validarNombre', () => {
  it('acepta un nombre normal', () => {
    expect(validarNombre('Ana')).toBeNull();
  });

  it('acepta un nombre con espacios alrededor y no se queja de ellos', () => {
    expect(validarNombre('  Ana  ')).toBeNull();
  });

  it('rechaza el vacío', () => {
    expect(validarNombre('')).toBe('Escribe tu nombre.');
  });

  it('rechaza una cadena de solo espacios, que un length > 0 dejaría pasar', () => {
    expect(validarNombre('     ')).toBe('Escribe tu nombre.');
  });

  it('rechaza un nombre más largo que el tope', () => {
    expect(validarNombre('a'.repeat(LARGO_MAXIMO_DE_NOMBRE + 1))).toBe(
      `Tu nombre no puede pasar de ${LARGO_MAXIMO_DE_NOMBRE} caracteres.`
    );
  });

  it('acepta un nombre justo en el tope', () => {
    expect(validarNombre('a'.repeat(LARGO_MAXIMO_DE_NOMBRE))).toBeNull();
  });
});

describe('validarApellido', () => {
  it('acepta un apellido normal', () => {
    expect(validarApellido('Pérez')).toBeNull();
  });

  it('rechaza el vacío con su propio mensaje, no con el del nombre', () => {
    expect(validarApellido('')).toBe('Escribe tu apellido.');
  });

  it('rechaza una cadena de solo espacios', () => {
    expect(validarApellido('\t  \n')).toBe('Escribe tu apellido.');
  });

  it('rechaza un apellido más largo que el tope', () => {
    expect(validarApellido('a'.repeat(LARGO_MAXIMO_DE_NOMBRE + 1))).toBe(
      `Tu apellido no puede pasar de ${LARGO_MAXIMO_DE_NOMBRE} caracteres.`
    );
  });
});

describe('validarTelefono', () => {
  const MAL_FORMADO =
    'El teléfono debe ir en formato internacional: un + y de 8 a 15 dígitos, sin espacios ni guiones. Por ejemplo: +584141234567';

  it('acepta un E.164 de 12 dígitos', () => {
    expect(validarTelefono('+584141234567')).toBeNull();
  });

  it('acepta el mínimo de 8 dígitos', () => {
    expect(validarTelefono('+12345678')).toBeNull();
  });

  it('acepta el máximo de 15 dígitos', () => {
    expect(validarTelefono(`+${'1'.repeat(15)}`)).toBeNull();
  });

  it('rechaza el vacío', () => {
    expect(validarTelefono('')).toBe('Escribe tu teléfono.');
  });

  it('rechaza un número sin el + inicial', () => {
    expect(validarTelefono('584141234567')).toBe(MAL_FORMADO);
  });

  it('rechaza el 00 internacional en vez del +', () => {
    expect(validarTelefono('00584141234567')).toBe(MAL_FORMADO);
  });

  it('rechaza espacios dentro del número', () => {
    expect(validarTelefono('+58 414 1234567')).toBe(MAL_FORMADO);
  });

  it('rechaza guiones', () => {
    expect(validarTelefono('+58-414-1234567')).toBe(MAL_FORMADO);
  });

  it('rechaza paréntesis', () => {
    expect(validarTelefono('+58(414)1234567')).toBe(MAL_FORMADO);
  });

  it('rechaza 7 dígitos, uno por debajo del mínimo', () => {
    expect(validarTelefono('+1234567')).toBe(MAL_FORMADO);
  });

  it('rechaza 16 dígitos, uno por encima del máximo', () => {
    expect(validarTelefono(`+${'1'.repeat(16)}`)).toBe(MAL_FORMADO);
  });

  it('rechaza letras', () => {
    expect(validarTelefono('+58414ABCDEFG')).toBe(MAL_FORMADO);
  });

  it('rechaza un + solo', () => {
    expect(validarTelefono('+')).toBe(MAL_FORMADO);
  });
});

describe('validarCorreo', () => {
  const MAL_FORMADO = 'Ese correo no parece válido. Revisa que tenga una arroba y un dominio.';

  it('acepta un correo normal', () => {
    expect(validarCorreo('ana@agencia.test')).toBeNull();
  });

  it('acepta un correo con subdominio y signos válidos', () => {
    expect(validarCorreo('ana.perez+planner@mail.agencia.com.ve')).toBeNull();
  });

  it('rechaza el vacío', () => {
    expect(validarCorreo('')).toBe('Escribe tu correo.');
  });

  it('rechaza solo espacios', () => {
    expect(validarCorreo('   ')).toBe('Escribe tu correo.');
  });

  it('rechaza un correo sin arroba', () => {
    expect(validarCorreo('ana.agencia.test')).toBe(MAL_FORMADO);
  });

  it('rechaza un correo sin punto en el dominio', () => {
    expect(validarCorreo('ana@agencia')).toBe(MAL_FORMADO);
  });

  it('rechaza un correo con un espacio dentro', () => {
    expect(validarCorreo('ana perez@agencia.test')).toBe(MAL_FORMADO);
  });

  it('rechaza un correo más largo que el tope', () => {
    const largo = `${'a'.repeat(LARGO_MAXIMO_DE_CORREO)}@agencia.test`;
    expect(validarCorreo(largo)).toBe(`El correo no puede pasar de ${LARGO_MAXIMO_DE_CORREO} caracteres.`);
  });
});

describe('validarClave', () => {
  it('acepta una frase larga sin símbolos ni mayúsculas: no hay ritual de complejidad', () => {
    expect(validarClave('caballo correcto grapa')).toBeNull();
  });

  it('acepta una clave justo en el mínimo', () => {
    expect(validarClave('a'.repeat(LARGO_MINIMO_DE_CLAVE))).toBeNull();
  });

  it('rechaza el vacío', () => {
    expect(validarClave('')).toBe('Escribe una contraseña.');
  });

  it('rechaza una clave con un carácter menos que el mínimo', () => {
    expect(validarClave('a'.repeat(LARGO_MINIMO_DE_CLAVE - 1))).toBe(
      `La contraseña debe tener al menos ${LARGO_MINIMO_DE_CLAVE} caracteres.`
    );
  });

  it('rechaza una clave más larga que el tope de bcrypt', () => {
    expect(validarClave('a'.repeat(LARGO_MAXIMO_DE_CLAVE + 1))).toBe(
      `La contraseña no puede pasar de ${LARGO_MAXIMO_DE_CLAVE} caracteres.`
    );
  });

  it('NO recorta espacios: un espacio es parte legítima de la contraseña', () => {
    // 12 espacios llegan al mínimo por su propia longitud. Si el validador recortara, esto sería
    // "vacío" y el alta guardaría una clave distinta de la que la persona tecleó.
    expect(validarClave(' '.repeat(LARGO_MINIMO_DE_CLAVE))).toBeNull();
  });
});

describe('validarNombreDeAgencia', () => {
  it('acepta un nombre normal', () => {
    expect(validarNombreDeAgencia('Agencia Pérez')).toBeNull();
  });

  it('rechaza el vacío', () => {
    expect(validarNombreDeAgencia('')).toBe('Escribe el nombre de tu agencia.');
  });

  it('rechaza solo espacios', () => {
    expect(validarNombreDeAgencia('   ')).toBe('Escribe el nombre de tu agencia.');
  });

  it('rechaza un nombre más largo que el tope', () => {
    expect(validarNombreDeAgencia('a'.repeat(LARGO_MAXIMO_DE_AGENCIA + 1))).toBe(
      `El nombre de la agencia no puede pasar de ${LARGO_MAXIMO_DE_AGENCIA} caracteres.`
    );
  });

  it('acepta un nombre justo en el tope, que es el mismo que comprueba crear_mi_agencia()', () => {
    expect(validarNombreDeAgencia('a'.repeat(LARGO_MAXIMO_DE_AGENCIA))).toBeNull();
  });
});

describe('validarRegistro', () => {
  it('no devuelve ningún error con datos válidos', () => {
    const errores = validarRegistro(datosValidos());
    expect(errores).toEqual({});
    expect(registroEsValido(errores)).toBe(true);
  });

  it('señala el campo que falla y solo ese', () => {
    const errores = validarRegistro(datosValidos({ telefono: '0414-1234567' }));
    expect(Object.keys(errores)).toEqual(['telefono']);
    expect(registroEsValido(errores)).toBe(false);
  });

  it('devuelve TODOS los errores a la vez, no solo el primero', () => {
    const errores = validarRegistro({
      nombre: '',
      apellido: '   ',
      telefono: 'no es un teléfono',
      correo: 'no es un correo',
      clave: 'corta',
      nombreDeAgencia: '',
    });
    expect(Object.keys(errores).sort()).toEqual(
      ['apellido', 'clave', 'correo', 'nombre', 'nombreDeAgencia', 'telefono'].sort()
    );
  });
});

describe('componerNombreCompleto', () => {
  it('une nombre y apellido con un espacio', () => {
    expect(componerNombreCompleto('Ana', 'Pérez')).toBe('Ana Pérez');
  });

  it('recorta los espacios de cada parte', () => {
    expect(componerNombreCompleto('  Ana ', ' Pérez  ')).toBe('Ana Pérez');
  });
});
