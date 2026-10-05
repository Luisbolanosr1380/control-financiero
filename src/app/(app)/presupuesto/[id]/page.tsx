import { notFound } from 'next/navigation';
import { exigirPagina } from '@/lib/auth/guard';
import { getPresupuesto, getReal, presupuestoDisponible } from '@/lib/db/presupuesto';
import { obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';
import { PresupuestoDetalle } from '@/components/presupuesto/presupuesto-detalle';

export const dynamic = 'force-dynamic';

/**
 * Un presupuesto: editor (Borrador), seguimiento presupuesto vs real,
 * resumen de junta e historial. El real sale del motor del ER en vivo
 * (mismas líneas, mismo cálculo) para el año del presupuesto.
 */
export default async function PresupuestoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  await exigirPagina('ver_presupuesto');
  const { id } = await params;
  if (!(await presupuestoDisponible())) notFound();
  const p = await getPresupuesto(id);
  if (!p) notFound();
  const real = await getReal(p.cab.anio, p.est);
  const hoy = obtenerFechaHoyGuatemala();
  return (
    <PresupuestoDetalle
      cab={p.cab}
      lineas={p.est.lineas}
      centros={p.est.centros}
      celdas={[...p.celdas]}
      real={{ porCelda: [...real.porCelda], consolidado: [...real.consolidado], numPartidas: real.numPartidas, partidasSinCentro: real.partidasSinCentro }}
      log={p.log}
      hoy={hoy}
    />
  );
}
