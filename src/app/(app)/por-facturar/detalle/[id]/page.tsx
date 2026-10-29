import { notFound } from 'next/navigation';
import { exigirPagina } from '@/lib/auth/guard';
import { configAgenda } from '@/lib/facturacion-agenda/config';
import { detallesDisponibles, getDetalle } from '@/lib/db/detalle-facturacion';
import { DetalleView } from '@/components/por-facturar/detalle-view';

export const dynamic = 'force-dynamic';

/** DETALLE DE FACTURACIÓN (pre-liquidación, 019): ver = todos; enviar / aprobar / facturar / anular = facturar_agenda. */
export default async function DetalleFacturacionPage({ params }: { params: Promise<{ id: string }> }) {
  await exigirPagina('ver');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await detallesDisponibles())) notFound();
  const datos = await getDetalle(id);
  if (!datos) notFound();
  const cfg = configAgenda();
  return <DetalleView datos={datos} writeback={cfg.writeback} configurada={cfg.apiKey.length > 0} montoModo={cfg.montoModo} />;
}
