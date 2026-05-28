import { NextResponse, type NextRequest } from 'next/server';

/**
 * Valida que la request venga del cron de Vercel (o de quien tenga el CRON_SECRET).
 * Vercel envía `Authorization: Bearer <CRON_SECRET>` en cada disparo.
 * Devuelve null si la auth es válida; un NextResponse 401 si no.
 */
export function verifyCronSecret(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET no configurado en el servidor' }, { status: 500 });
  }
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  return null;
}
