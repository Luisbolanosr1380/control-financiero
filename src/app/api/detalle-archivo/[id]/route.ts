import { NextResponse, type NextRequest } from 'next/server';
import { autorizar } from '@/lib/auth/guard';
import { urlFirmadaArchivo } from '@/lib/db/detalle-archivo';

export const dynamic = 'force-dynamic';

/**
 * DETALLE FIRMADO EN PAPEL (032) · Ver / Descargar un archivo del detalle. Con sesión (quien puede ver el detalle),
 * valida el permiso en el servidor y redirige a una URL FIRMADA de 5 minutos del bucket privado. Nunca una URL
 * pública; la respuesta no se guarda en caché. Esta ruta pasa por Clerk (middleware).
 */
const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive' };

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const permiso = await autorizar('ver');
  if (!permiso.ok) return NextResponse.json({ error: permiso.error }, { status: 401, headers: NO_STORE });
  const { id } = await ctx.params;
  const descargar = req.nextUrl.searchParams.get('descargar') === '1';
  const r = await urlFirmadaArchivo(id, { descargar });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 404, headers: NO_STORE });
  return NextResponse.redirect(r.url, { status: 302, headers: NO_STORE });
}
