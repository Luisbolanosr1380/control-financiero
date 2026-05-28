import { NextResponse, type NextRequest } from 'next/server';
import { verifyCronSecret } from '@/lib/auth/cron';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const unauthorized = verifyCronSecret(req);
  if (unauthorized) return unauthorized;

  // Implementación real en F-009 (insights nocturnos con Gemini).
  return NextResponse.json({ ok: true, ran: 'cron/insights stub', timestamp: new Date().toISOString() });
}
