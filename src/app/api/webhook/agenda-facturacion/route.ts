import { NextResponse, type NextRequest } from 'next/server';
import { configAgenda } from '@/lib/facturacion-agenda/config';
import { verificarFirma } from '@/lib/facturacion-agenda/firma';
import { cargarContexto, facturacionAgendaDisponible, procesarExpedientes, registrarEventoWebhook } from '@/lib/db/facturacion-agenda';
import type { ExpedienteAgenda } from '@/lib/facturacion-agenda/tipos';

export const dynamic = 'force-dynamic';

/**
 * FACTURACIÓN AGENDA · webhook de avisos (proceso.terminado, cobro.actualizado,
 * expediente.actualizado / .eliminado / .restaurado…). Firma HMAC-SHA256 sobre el
 * cuerpo crudo (`x-golden-firma: t=…,v1=…`, rechazo si |t − ahora| > 5 min),
 * idempotente por `id` (un repetido se ignora con 200) y responde en < 10 s:
 * solo refresca el espejo del expediente que viene en el aviso.
 */
export async function POST(req: NextRequest) {
  const cfg = configAgenda();
  const cuerpo = await req.text();
  const motivo = verificarFirma(cuerpo, req.headers.get('x-golden-firma'), cfg.webhookSecret || undefined);
  if (motivo === 'sin_secreto') return NextResponse.json({ error: 'webhook no configurado en este deploy' }, { status: 503 });
  if (motivo !== 'ok') return NextResponse.json({ error: 'firma inválida', motivo }, { status: 401 });

  let payload: { id?: unknown; tipo?: unknown; ocurrido?: unknown; expediente?: ExpedienteAgenda | null } | null = null;
  try { payload = JSON.parse(cuerpo); } catch { return NextResponse.json({ error: 'cuerpo inválido' }, { status: 400 }); }
  const id = String(payload?.id ?? req.headers.get('x-golden-id') ?? '').trim();
  const tipo = String(payload?.tipo ?? req.headers.get('x-golden-evento') ?? '').trim();
  if (!id) return NextResponse.json({ error: 'aviso sin id' }, { status: 400 });
  if (!(await facturacionAgendaDisponible())) return NextResponse.json({ error: 'Falta la migración 016 en esta base' }, { status: 503 });

  const nuevo = await registrarEventoWebhook(id, tipo, typeof payload?.ocurrido === 'string' ? payload.ocurrido : null);
  if (!nuevo) return NextResponse.json({ ok: true, id, repetido: true });

  let procesados = 0;
  const exp = payload?.expediente;
  if (exp && typeof exp === 'object' && exp.id) procesados = await procesarExpedientes([exp], await cargarContexto());
  return NextResponse.json({ ok: true, id, tipo, procesados });
}
