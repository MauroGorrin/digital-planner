/**
 * El mensaje listo para pegar en WhatsApp o correo, para que alguien entre a revisar y aprobar el
 * contenido de una marca. No manda nada por su cuenta -- la app no tiene SMTP propio (ver CLAUDE.md,
 * "Sobre el captcha" explica el porqué del mismo límite en otro lado): quien invita copia este
 * texto y lo entrega por el medio que ya usa con esa persona.
 *
 * Sin `clave` arma un mensaje más corto, para cuando la cuenta ya existía y solo se le vinculó a
 * una marca nueva -- no hay credenciales que mostrar, solo avisarle que ya tiene acceso.
 *
 * `/` en el valor de `redirect` no necesita escaparse (no es un carácter reservado dentro de un
 * parámetro de consulta, RFC 3986) -- `encodeURIComponent` lo convertía en `%2Fgrilla`, que se ve
 * como una URL rota al pegarla en un mensaje. `/login?redirect=/grilla` es la misma URL, sin eso.
 */
export function mensajeDeInvitacion(input: {
  fullName: string;
  marca: string;
  email: string;
  clave?: string;
  baseUrl: string;
  /** Nombre de la agencia que invita. Sin esto, el mensaje no firma con ningún nombre. */
  agencyName?: string;
}): string {
  const enlace = `${input.baseUrl}/login?redirect=/grilla`;
  const firma = input.agencyName ? `\n\nSaludos,\n${input.agencyName}` : '';

  if (!input.clave) {
    return (
      `Hola ${input.fullName}:\n\n` +
      `Ya tienes acceso para revisar y aprobar el contenido de ${input.marca}.\n\n` +
      `Ingresa con tu cuenta en: ${enlace}` +
      firma
    );
  }

  return (
    `Hola ${input.fullName}:\n\n` +
    `Ya puedes revisar y aprobar el contenido de ${input.marca}.\n\n` +
    `Enlace de acceso: ${enlace}\n` +
    `Usuario: ${input.email}\n` +
    `Contraseña temporal: ${input.clave}\n\n` +
    `Puedes cambiar tu contraseña luego desde tu perfil.` +
    firma
  );
}

/** El enlace de WhatsApp Web/app con el mensaje ya cargado: quien lo abre elige a quién mandárselo. */
export function urlDeWhatsApp(mensaje: string): string {
  return `https://wa.me/?text=${encodeURIComponent(mensaje)}`;
}
