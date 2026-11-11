import { notFound } from 'next/navigation';
import { exigirPagina } from '@/lib/auth/guard';
import { empresaConfig } from '@/lib/config/empresa';
import { getPaqueteDetalle } from '@/lib/db/paquetes';
import { obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';
import { PaqueteImprimible } from '@/components/paquetes/paquete-imprimible';

export const dynamic = 'force-dynamic';

/**
 * PAQUETES PREPAGADOS (034) · «Estado del paquete» imprimible (fuera del shell: solo el documento, con el logo y el
 * formato del detalle) para mandárselo al cliente: «Usadas 63 de 100 · Restan 37». Requiere sesión (ver).
 */
export default async function ImprimirPaquetePage({ params }: { params: Promise<{ id: string }> }) {
  await exigirPagina('ver');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const datos = await getPaqueteDetalle(id);
  if (!datos) notFound();
  const emp = empresaConfig();
  return <PaqueteImprimible datos={datos} emisor={{ nombre: emp.nombreLegal || emp.nombre, nit: emp.nit ?? '', direccion: emp.direccion ?? '', logoUrl: emp.logoUrl }} hoy={obtenerFechaHoyGuatemala()} />;
}
