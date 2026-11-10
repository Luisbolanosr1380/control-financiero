import { NextResponse, type NextRequest } from 'next/server';
import { autorizar } from '@/lib/auth/guard';
import { urlFirmadaAdjunto } from '@/lib/db/cobranza-adjuntos';

export const dynamic = 'force-dynamic';

/** CENTRO DE COBROS (033) · Ver / Descargar un adjunto del historial: con sesión (ver_cobranza), redirige a una URL firmada de 5 minutos del bucket privado. */
const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive' };

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const permiso = await autorizar('ver_cobranza');
  if (!permiso.ok) return NextResponse.json({ error: permiso.error }, { status: 401, headers: NO_STORE });
  const { id } = await ctx.params;
  const r = await urlFirmadaAdjunto(id, { descargar: req.nextUrl.searchParams.get('descargar') === '1' });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 404, headers: NO_STORE });
  return NextResponse.redirect(r.url, { status: 302, headers: NO_STORE });
}
