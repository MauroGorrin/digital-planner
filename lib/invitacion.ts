/**
 * El mensaje listo para pegar en WhatsApp o correo, para que alguien entre a revisar y aprobar el
 * contenido de una marca. No manda nada por su cuenta -- la app no tiene SMTP propio (ver CLAUDE.md,
 * "Sobre el captcha" explica el porqué del mismo límite en otro lado): quien invita copia este
 * texto y lo entrega por el medio que ya usa con esa persona.
 *
 * Sin `clave` arma un mensaje más corto, para cuando la cuenta ya existía y solo se le vinculó a
 * una marca nueva -- no hay credenciales que mostrar, solo avisarle que ya tiene acceso.
 */
export function mensajeDeInvitacion(input: {
  fullName: string;
  marca: string;
  email: string;
  clave?: string;
  baseUrl: string;
}): string {
  const enlace = `${input.baseUrl}/login?redirect=%2Fgrilla`;

  if (!input.clave) {
    return (
      `Hola ${input.fullName}, ya tienes acceso para revisar y aprobar el contenido de ${input.marca}.\n\n` +
      `Entra con tu cuenta de siempre: ${enlace}`
    );
  }

  return (
    `Hola ${input.fullName}, ya puedes revisar y aprobar el contenido de ${input.marca}.\n\n` +
    `Entra aquí: ${enlace}\n` +
    `Usuario: ${input.email}\n` +
    `Clave: ${input.clave}\n\n` +
    `Puedes cambiar la clave después desde tu perfil.`
  );
}

/** El enlace de WhatsApp Web/app con el mensaje ya cargado: quien lo abre elige a quién mandárselo. */
export function urlDeWhatsApp(mensaje: string): string {
  return `https://wa.me/?text=${encodeURIComponent(mensaje)}`;
}
