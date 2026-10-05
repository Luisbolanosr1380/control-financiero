import { exigirPagina } from '@/lib/auth/guard';
import { listarPresupuestos, presupuestoDisponible } from '@/lib/db/presupuesto';
import { obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';
import { PresupuestosLista } from '@/components/presupuesto/presupuestos-lista';

export const dynamic = 'force-dynamic';

/** Presupuestos por año y estado. Ver: 'ver_presupuesto'; crear: 'presupuesto' (la action lo revalida). */
export default async function PresupuestoPage() {
  await exigirPagina('ver_presupuesto');
  const disponible = await presupuestoDisponible();
  const presupuestos = disponible ? await listarPresupuestos() : [];
  const anioActual = Number(obtenerFechaHoyGuatemala().slice(0, 4));
  return <PresupuestosLista disponible={disponible} presupuestos={presupuestos} anioSugerido={anioActual + 1} />;
}
