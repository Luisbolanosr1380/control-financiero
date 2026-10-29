import { notFound } from 'next/navigation';
import { exigirPagina } from '@/lib/auth/guard';
import { empresaConfig } from '@/lib/config/empresa';
import { detallesDisponibles, getDetalle } from '@/lib/db/detalle-facturacion';
import { DetalleImprimible } from '@/components/por-facturar/detalle-imprimible';

export const dynamic = 'force-dynamic';

/**
 * VISTA IMPRIMIBLE del detalle de facturación (fuera del shell de la app: solo el documento).
 * Antes de facturar dice "Detalle de servicios / Pre-liquidación" (sin número de SAT); una vez
 * facturado lleva el número de factura real. Requiere sesión (ver).
 */
export default async function ImprimirDetallePage({ params }: { params: Promise<{ id: string }> }) {
  await exigirPagina('ver');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await detallesDisponibles())) notFound();
  const datos = await getDetalle(id);
  if (!datos) notFound();
  const emp = empresaConfig();
  return <DetalleImprimible datos={datos} emisor={{ nombre: emp.nombreLegal || emp.nombre, nit: emp.nit ?? '', direccion: emp.direccion ?? '' }} />;
}
