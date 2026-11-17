import 'server-only';
import { createHmac } from 'node:crypto';
import { db } from './db';
import type { ResultadoConsulta } from '../tipos';

export type RespuestaBD =
  | ({ estado: 'ok' } & ResultadoConsulta)
  | { estado: 'no_encontrado' | 'limite' | 'invalida' };

/** Hash HMAC de la IP: el registro de intentos nunca guarda la IP en claro. */
export function hashIp(ip: string): string {
  const sal = process.env.RATE_LIMIT_SALT;
  if (!sal || sal.length < 32) throw new Error('RATE_LIMIT_SALT ausente o demasiado corta (mínimo 32 caracteres)');
  return createHmac('sha256', sal).update(ip).digest('hex');
}

export async function consultarClave(clave: string, ipHash: string): Promise<RespuestaBD> {
  const filas = await db()<{ r: RespuestaBD }[]>`select somexa.consultar(${clave}, ${ipHash}) as r`;
  return filas[0].r;
}
