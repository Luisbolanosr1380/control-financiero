/**
 * Mes en curso con conciencia de calendario (server). Una sola fuente para
 * Auros (tools) y el Resumen móvil: facturado = mismo universo que el
 * reporte de facturación (sin anuladas/refacturadas); cobrado = cobros
 * activos. Mes en curso a hoy, mes anterior completo y mes anterior al mismo día.
 */
import { getFacturasReporte } from '@/lib/db/facturas';
import { getCobrosCompletos } from '@/lib/db/cobros';
import { filtrarReporte } from '@/lib/facturacion/reporte';
import { obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';
import { ventanasCalendario, metricaCalendario, bloqueCalendario, type MetricaCalendario, type VentanasCalendario } from '@/lib/ai/contexto-calendario';

export async function cargarMesEnCurso(): Promise<{ v: VentanasCalendario; facturado: MetricaCalendario; cobrado: MetricaCalendario }> {
  const v = ventanasCalendario(obtenerFechaHoyGuatemala());
  const [facturas, cobros] = await Promise.all([getFacturasReporte(), getCobrosCompletos()]);
  const { filtradas } = filtrarReporte(facturas, { desde: v.mesAnterior.desde, hasta: v.hoy });
  const facturado = metricaCalendario(filtradas.map(x => ({ fecha: x.f.fecha, monto: x.totalQ })), v);
  const cobrado = metricaCalendario(
    cobros.filter(c => c.estadoCobro === 'Activo').map(c => ({ fecha: c.fechaCobro, monto: c.monto })), v,
  );
  return { v, facturado, cobrado };
}

export async function cargarCalendario(): Promise<{ v: VentanasCalendario; bloque: ReturnType<typeof bloqueCalendario> }> {
  const { v, facturado, cobrado } = await cargarMesEnCurso();
  return { v, bloque: bloqueCalendario(v, { facturado, cobrado }) };
}
