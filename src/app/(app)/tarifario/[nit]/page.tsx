import { notFound } from 'next/navigation';
import { exigirPagina } from '@/lib/auth/guard';
import { listarTarifasPorNit, tarifarioDisponible } from '@/lib/db/tarifario';
import { nitComparable } from '@/lib/clientes/nit';
import { EmpresaDetalle } from '@/components/tarifario/empresa-detalle';

export const dynamic = 'force-dynamic';

/** DETALLE del tarifario de una empresa (por NIT): matriz tipo × categoría × territorio, alta/edición scoped y aprobar en lote. */
export default async function TarifarioEmpresaPage({ params }: { params: Promise<{ nit: string }> }) {
  await exigirPagina('ver');
  const { nit } = await params;
  const k = nitComparable(decodeURIComponent(nit));
  if (!k) notFound();
  if (!(await tarifarioDisponible())) notFound();
  const tarifas = await listarTarifasPorNit(k);
  if (tarifas.length === 0) notFound();
  return <EmpresaDetalle nit={k} tarifas={tarifas} />;
}
