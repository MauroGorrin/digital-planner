/** "Marca Uno" -> "marcauno": sin acentos, sin espacios ni símbolos, en minúsculas. */
export function usuarioDeMarca(marca: string): string {
  return marca
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Avatar de la marca: su inicial sobre un círculo. `forma` cambia el círculo por un cuadrado redondeado. */
export function AvatarDeMarca({
  marca,
  tamano = 'h-9 w-9',
  forma = 'circulo',
  className = '',
}: {
  marca: string;
  tamano?: string;
  forma?: 'circulo' | 'cuadrado';
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center bg-gradient-to-br from-ink-700 to-ink-900 font-semibold text-white ${
        forma === 'circulo' ? 'rounded-full' : 'rounded-md'
      } ${tamano} ${className}`}
    >
      {marca.charAt(0).toUpperCase()}
    </span>
  );
}
