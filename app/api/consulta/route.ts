import { NextResponse, type NextRequest } from 'next/server';
import { normalizarClave, claveValida } from '@/lib/clave';
import { consultarClave, hashIp } from '@/lib/servidor/consulta';
import type { CodigoError } from '@/lib/tipos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CABECERAS = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
};

function error(codigo: CodigoError, status: number) {
  return NextResponse.json({ error: codigo }, { status, headers: CABECERAS });
}

function ipCliente(req: NextRequest): string {
  // En Vercel, x-real-ip / x-forwarded-for los fija la plataforma.
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return 'desconocida';
}

export async function POST(req: NextRequest) {
  // Solo peticiones desde el propio sitio.
  const origen = req.headers.get('origin');
  if (origen && origen !== req.nextUrl.origin) {
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    if (!host || new URL(origen).host !== host) return error('solicitud', 403);
  }
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) {
    return error('solicitud', 415);
  }

  let clave = '';
  try {
    const texto = await req.text();
    if (texto.length > 512) return error('solicitud', 413);
    const cuerpo = JSON.parse(texto) as unknown;
    if (!cuerpo || typeof cuerpo !== 'object' || typeof (cuerpo as { clave?: unknown }).clave !== 'string') {
      return error('solicitud', 400);
    }
    clave = normalizarClave((cuerpo as { clave: string }).clave);
  } catch {
    return error('solicitud', 400);
  }
  if (!claveValida(clave)) return error('formato', 400);

  try {
    const r = await consultarClave(clave, hashIp(ipCliente(req)));
    switch (r.estado) {
      case 'ok':
        return NextResponse.json(
          { persona: r.persona, asistencias: r.asistencias, participaciones: r.participaciones },
          { status: 200, headers: CABECERAS },
        );
      case 'no_encontrado':
        return error('no_encontrado', 404);
      case 'limite':
        return NextResponse.json({ error: 'limite' }, { status: 429, headers: { ...CABECERAS, 'Retry-After': '900' } });
      default:
        return error('formato', 400);
    }
  } catch (e) {
    // No se registra la clave consultada.
    console.error('[consulta] fallo de servicio:', e instanceof Error ? e.message : 'desconocido');
    return error('servicio', 503);
  }
}

export function GET() {
  return error('solicitud', 405);
}
