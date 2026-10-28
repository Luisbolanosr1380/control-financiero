import { NextResponse, type NextRequest } from 'next/server';
import { verifyCronSecret } from '@/lib/auth/cron';
import { agendaConfigurada } from '@/lib/facturacion-agenda/config';
import { sincronizarAgenda } from '@/lib/db/facturacion-agenda';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * FACTURACIÓN AGENDA · cron cada 15 min (vercel.json): trae de la Agenda lo que
 * cambió (cambiadosDesde) página por página y re-resuelve precios. Red de
 * seguridad del webhook. Sin llave en el deploy (HIT) no toca nada.
 */
export async function GET(req: NextRequest) {
  const unauthorized = verifyCronSecret(req);
  if (unauthorized) return unauthorized;
  if (!agendaConfigurada()) return NextResponse.json({ ok: true, omitido: 'Este deploy no tiene FACTURACION_API_KEY_AGENDA', timestamp: new Date().toISOString() });
  const r = await sincronizarAgenda({ actor: 'cron' });
  return NextResponse.json({ ...r, timestamp: new Date().toISOString() }, { status: r.ok ? 200 : 500 });
}
