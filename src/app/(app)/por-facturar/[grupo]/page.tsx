import { notFound } from 'next/navigation';
import { exigirPagina } from '@/lib/auth/guard';
import { configAgenda } from '@/lib/facturacion-agenda/config';
import { facturacionAgendaDisponible, getGrupo } from '@/lib/db/facturacion-agenda';
import { GrupoDetalleView } from '@/components/por-facturar/grupo-detalle';

export const dynamic = 'force-dynamic';

/**
 * DETALLE de un cliente en "Por facturar": sus expedientes con persona, servicio,
 * categoría, territorio y precio resuelto (o su estado), filtros por mes y cobro,
 * selección → "Facturar" (número y fecha reales de SAT/FEL), y "Mapear" si la
 * empresa de la Agenda todavía no apunta a un cliente de financiero.
 * La clave es `n-<nit>` (mapeado) o `e-<empresa.id>` (sin mapear).
 */
export default async function PorFacturarGrupoPage({ params }: { params: Promise<{ grupo: string }> }) {
  await exigirPagina('ver');
  const { grupo } = await params;
  if (!(await facturacionAgendaDisponible())) notFound();
  const datos = await getGrupo(decodeURIComponent(grupo));
  if (!datos) notFound();
  const cfg = configAgenda();
  return <GrupoDetalleView datos={datos} writeback={cfg.writeback} configurada={cfg.apiKey.length > 0} montoModo={cfg.montoModo} />;
}
