import { notFound } from 'next/navigation';
import { exigirPagina } from '@/lib/auth/guard';
import { getPaqueteDetalle } from '@/lib/db/paquetes';
import { obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';
import { PaqueteDetalleView } from '@/components/paquetes/paquete-detalle';

export const dynamic = 'force-dynamic';

/**
 * PAQUETES PREPAGADOS (034) · detalle de un paquete: líneas con las pruebas descontadas (persona, solicitante, fecha de
 * resultado, resultado, expediente), reversiones con motivo, «Estado del paquete» en PDF y CSV; enlazar factura, extender
 * o cerrar (admin y contador). Ver: 'ver'.
 */
export default async function PaqueteDetallePage({ params }: { params: Promise<{ id: string }> }) {
  await exigirPagina('ver');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const detalle = await getPaqueteDetalle(id);
  if (!detalle) notFound();
  return <PaqueteDetalleView detalle={detalle} hoy={obtenerFechaHoyGuatemala()} />;
}
