// Lector CSV mínimo (RFC 4180): comillas, comas y saltos de línea dentro de
// campos, CRLF/LF y BOM UTF-8. Sin dependencias externas.
import { readFileSync } from 'node:fs';

export function parseCsv(texto) {
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
  const filas = [];
  let fila = [];
  let campo = '';
  let enComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else enComillas = false;
      } else campo += c;
    } else if (c === '"') {
      enComillas = true;
    } else if (c === ',') {
      fila.push(campo); campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); campo = '';
      filas.push(fila); fila = [];
    } else campo += c;
  }
  if (enComillas) throw new Error('CSV mal formado: comillas sin cerrar al final del archivo');
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  // Ignora líneas totalmente vacías
  return filas.filter((f) => !(f.length === 1 && f[0] === ''));
}

/** Lee un CSV y devuelve { encabezados, registros[], lineas } validando UTF-8. */
export function leerCsv(ruta) {
  const buf = readFileSync(ruta);
  const texto = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  const filas = parseCsv(texto);
  const [encabezados, ...datos] = filas;
  const registros = [];
  const problemas = [];
  datos.forEach((f, idx) => {
    if (f.length !== encabezados.length) {
      problemas.push(`fila ${idx + 2}: tiene ${f.length} columnas, se esperaban ${encabezados.length}`);
      return;
    }
    const r = {};
    encabezados.forEach((h, j) => { r[h] = f[j]; });
    r.__fila = idx + 2;
    registros.push(r);
  });
  return { encabezados, registros, problemas };
}
