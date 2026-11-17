// Normalización y validación de la clave de participante.
// Se usa tanto en el navegador (validación inmediata) como en el servidor.

/** Formato aceptado tras normalizar: SMX-0001, SMX-f96ab04d, SMX-P-001, etc. */
export const RE_CLAVE = /^SMX-[A-Z0-9-]{3,16}$/;

/**
 * Quita espacios, convierte guiones tipográficos en "-", pasa a mayúsculas
 * y añade el guion si se escribió "SMX0001".
 */
export function normalizarClave(entrada: string): string {
  return entrada
    .normalize('NFKC')
    .replace(/[‐-―−﹘﹣－]/g, '-')
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/^SMX(?=[A-Z0-9])/, 'SMX-');
}

export function claveValida(clave: string): boolean {
  return RE_CLAVE.test(clave);
}
