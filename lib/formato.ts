// Utilidades de presentación (español de México).
import type { Asistencia } from './tipos';

const fmtDia = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const fmtCorto = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function fechaLarga(iso: string | null): string {
  if (!iso) return 'Fecha no registrada';
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const t = fmtDia.format(d);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function fechaCorta(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : fmtCorto.format(d);
}

/** Texto que explica cómo se registró una asistencia. */
export function descripcionRegistro(a: Asistencia): string {
  const origen = (a.origen ?? '').trim();
  if (origen.toLowerCase().startsWith('derivada')) return 'Registrada por tu participación en la sesión';
  if (origen.toLowerCase().startsWith('captura manual')) return 'Captura manual (sin hora de registro)';
  if (a.registro) {
    const [dia, hora] = a.registro.split('T');
    const hhmm = (hora ?? '').slice(0, 5);
    const base = origen ? `${origen} · ` : '';
    if (a.fecha && dia !== a.fecha) return `${base}registrada el ${fechaCorta(dia)} a las ${hhmm} h`;
    return `${base}registrada a las ${hhmm} h`;
  }
  return origen || 'Sin detalle de registro';
}

export function agruparPorFecha<T extends { fecha: string | null }>(items: T[]): [string | null, T[]][] {
  const mapa = new Map<string | null, T[]>();
  for (const it of items) {
    const k = it.fecha ?? null;
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k)!.push(it);
  }
  return [...mapa.entries()];
}

export function plural(n: number, uno: string, varios: string) {
  return `${n} ${n === 1 ? uno : varios}`;
}
