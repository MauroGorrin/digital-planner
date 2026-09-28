// Validadores del alta pública de agencia (`/registro`). Módulo puro: sin Supabase, sin `fetch`,
// sin nada de servidor — lo importan los DOS lados del formulario, y ese es todo el punto.
//
// El navegador valida para que la persona vea el error junto al campo que lo causó, sin esperar un
// viaje de red. La Server Action vuelve a validar con exactamente estas mismas funciones porque
// **el navegador no es un control**: una Server Action es un endpoint HTTP y quien quiera puede
// llamarlo con lo que le dé la gana, sin pasar por ninguna pantalla. Dos llamadas, una sola
// definición de qué está bien — si fueran dos definiciones, un día no coincidirían y la que
// mandaría sería la del servidor, que es la que nadie mira.
//
// LO QUE ESTE ARCHIVO NO HACE, dicho porque el spec insiste en ello: **validar no es verificar**.
// De los seis campos, el único que queda PROBADO es el correo, y no lo prueba nada de aquí sino el
// enlace de confirmación que Supabase manda a esa dirección. El nombre, el apellido y el teléfono
// quedan bien formados y sin comprobar: nadie sabe si existen.

/** Los seis campos del formulario, tal cual se piden. */
export interface DatosDeRegistro {
  nombre: string;
  apellido: string;
  telefono: string;
  correo: string;
  clave: string;
  nombreDeAgencia: string;
}

export type CampoDeRegistro = keyof DatosDeRegistro;

/** Un mensaje por campo mal formado. Un objeto vacío significa que todo pasó. */
export type ErroresDeRegistro = Partial<Record<CampoDeRegistro, string>>;

/**
 * Topes de longitud. No son caprichos de UI: son lo que impide que un campo de texto libre se
 * convierta en una fila de megabytes. `profiles.full_name` es `text` sin límite en Postgres.
 */
export const LARGO_MAXIMO_DE_NOMBRE = 60;
export const LARGO_MAXIMO_DE_AGENCIA = 80;
export const LARGO_MAXIMO_DE_CORREO = 254;

/**
 * Mínimo de la contraseña. Es lo único que se le exige, a propósito.
 *
 * No hay ritual de complejidad (una mayúscula, un dígito, un símbolo) porque esas reglas empujan a
 * la gente a `Clave2024!` — que cumple las cuatro y es de las primeras que prueba cualquier
 * diccionario — mientras rechazan frases largas que son mucho mejores. La longitud es la única
 * propiedad que se correlaciona de verdad con lo difícil que es adivinarla, y es también la única
 * que la persona puede satisfacer sin apuntarla en un papel.
 */
export const LARGO_MINIMO_DE_CLAVE = 12;

/**
 * Máximo de la contraseña. Existe por un detalle concreto y silencioso: el hash de contraseñas de
 * Supabase (GoTrue) es bcrypt, y bcrypt **ignora todo lo que pase de 72 bytes**. Sin este tope,
 * alguien que escribe una frase de 90 caracteres cree tener una contraseña de 90 y tiene una de 72,
 * y además podría iniciar sesión escribiendo sólo los primeros 72 — un comportamiento que no
 * podría explicarse. Se rechaza aquí, donde sí se puede decir por qué.
 */
export const LARGO_MAXIMO_DE_CLAVE = 72;

/**
 * Forma E.164: un `+` y de 8 a 15 dígitos. Nada más — ni espacios, ni guiones, ni paréntesis, ni un
 * `00` inicial en vez del `+`.
 *
 * Se elige el formato estricto y no uno tolerante porque el teléfono lo va a usar una persona para
 * escribirle a otra, muchas veces desde otro país: `0414-1234567` no se puede marcar desde fuera de
 * Venezuela y nadie puede adivinar a qué país pertenece. El `+` obliga a incluir el código de país,
 * que es la única parte que un formato libre siempre pierde.
 *
 * El 15 es el máximo que define la propia recomendación E.164 de la UIT; el 8 deja pasar los
 * números cortos de país + nacional más breves sin abrir la puerta a un `+1`.
 */
const FORMA_E164 = /^\+[0-9]{8,15}$/;

/**
 * Forma del correo, **sólo la forma**. Algo, una arroba, algo, un punto, algo — sin espacios.
 *
 * Deliberadamente laxa. La expresión regular "correcta" para un correo según el RFC 5322 es
 * famosa por tener cientos de caracteres y por rechazar direcciones reales; y por más estricta que
 * fuera seguiría sin poder decir si la dirección EXISTE. Lo que prueba que el correo es de quien
 * dice serlo es el enlace de confirmación, no esto. Aquí sólo se atrapa el error de tecleo obvio
 * para no mandar un correo a la nada.
 */
const FORMA_DE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Comprueba un nombre propio (nombre o apellido) y devuelve el mensaje de error, o `null`. */
function validarNombrePropio(valor: string, etiqueta: string): string | null {
  const limpio = valor.trim();
  // El `.trim()` antes del `length` es la mitad que se olvida: `"   "` tiene longitud 3 y pasaría
  // un `length > 0` a secas, dejando un perfil que se llama con tres espacios.
  if (limpio.length === 0) return `Escribe tu ${etiqueta}.`;
  if (limpio.length > LARGO_MAXIMO_DE_NOMBRE) {
    return `Tu ${etiqueta} no puede pasar de ${LARGO_MAXIMO_DE_NOMBRE} caracteres.`;
  }
  return null;
}

/** Nombre de pila: no vacío tras recortar, y de largo razonable. */
export function validarNombre(valor: string): string | null {
  return validarNombrePropio(valor, 'nombre');
}

/** Apellido: mismas reglas que el nombre, mensaje propio. */
export function validarApellido(valor: string): string | null {
  return validarNombrePropio(valor, 'apellido');
}

/** Teléfono en E.164. */
export function validarTelefono(valor: string): string | null {
  const limpio = valor.trim();
  if (limpio.length === 0) return 'Escribe tu teléfono.';
  if (!FORMA_E164.test(limpio)) {
    return 'El teléfono debe ir en formato internacional: un + y de 8 a 15 dígitos, sin espacios ni guiones. Por ejemplo: +584141234567';
  }
  return null;
}

/** Correo: sólo la forma. Lo prueba el enlace de confirmación, no esto. */
export function validarCorreo(valor: string): string | null {
  const limpio = valor.trim();
  if (limpio.length === 0) return 'Escribe tu correo.';
  if (limpio.length > LARGO_MAXIMO_DE_CORREO) {
    return `El correo no puede pasar de ${LARGO_MAXIMO_DE_CORREO} caracteres.`;
  }
  if (!FORMA_DE_CORREO.test(limpio)) return 'Ese correo no parece válido. Revisa que tenga una arroba y un dominio.';
  return null;
}

/**
 * Contraseña: sólo longitud.
 *
 * **No se recorta con `trim()` y no es un olvido**: un espacio al principio o al final es parte
 * legítima de una contraseña, y quitárselo aquí guardaría una distinta de la que la persona tecleó.
 * En los demás campos recortar es un favor; aquí sería corromper el dato.
 */
export function validarClave(valor: string): string | null {
  if (valor.length === 0) return 'Escribe una contraseña.';
  if (valor.length < LARGO_MINIMO_DE_CLAVE) {
    return `La contraseña debe tener al menos ${LARGO_MINIMO_DE_CLAVE} caracteres.`;
  }
  if (valor.length > LARGO_MAXIMO_DE_CLAVE) {
    return `La contraseña no puede pasar de ${LARGO_MAXIMO_DE_CLAVE} caracteres.`;
  }
  return null;
}

/** Nombre de la agencia: no vacío tras recortar, y de largo razonable. */
export function validarNombreDeAgencia(valor: string): string | null {
  const limpio = valor.trim();
  if (limpio.length === 0) return 'Escribe el nombre de tu agencia.';
  if (limpio.length > LARGO_MAXIMO_DE_AGENCIA) {
    return `El nombre de la agencia no puede pasar de ${LARGO_MAXIMO_DE_AGENCIA} caracteres.`;
  }
  return null;
}

/**
 * Valida los seis campos y devuelve un mensaje por cada uno que falle.
 *
 * Devuelve TODOS los errores y no sólo el primero: un formulario que sólo señala un campo por
 * envío obliga a la persona a descubrir sus errores de uno en uno.
 */
export function validarRegistro(datos: DatosDeRegistro): ErroresDeRegistro {
  const errores: ErroresDeRegistro = {};
  const nombre = validarNombre(datos.nombre);
  const apellido = validarApellido(datos.apellido);
  const telefono = validarTelefono(datos.telefono);
  const correo = validarCorreo(datos.correo);
  const clave = validarClave(datos.clave);
  const nombreDeAgencia = validarNombreDeAgencia(datos.nombreDeAgencia);

  if (nombre) errores.nombre = nombre;
  if (apellido) errores.apellido = apellido;
  if (telefono) errores.telefono = telefono;
  if (correo) errores.correo = correo;
  if (clave) errores.clave = clave;
  if (nombreDeAgencia) errores.nombreDeAgencia = nombreDeAgencia;
  return errores;
}

/** `true` si no hay ni un campo mal formado. */
export function registroEsValido(errores: ErroresDeRegistro): boolean {
  return Object.keys(errores).length === 0;
}

/**
 * Compone el `full_name` que guarda `profiles`.
 *
 * `profiles.full_name` se queda como la columna que muestran las ~20 pantallas que pintan a una
 * persona, y aquí es donde el nombre y el apellido separados del formulario se convierten en ella.
 * No hay columnas `first_name` / `last_name`: el porqué está escrito en
 * supabase/migrations/0011_alta_de_agencia.sql, encima de la función del alta.
 */
export function componerNombreCompleto(nombre: string, apellido: string): string {
  return `${nombre.trim()} ${apellido.trim()}`.trim();
}
