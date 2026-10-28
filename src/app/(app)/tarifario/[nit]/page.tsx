import { notFound } from 'next/navigation';
import { exigirPagina } from '@/lib/auth/guard';
import { listarHistorialPorNit, listarTarifasPorNit, tarifarioDisponible, umbralEstancada } from '@/lib/db/tarifario';
import { antiguedades, ultimoCambioPrecio } from '@/lib/tarifario/antiguedad';
import { nitComparable } from '@/lib/clientes/nit';
import { EmpresaDetalle } from '@/components/tarifario/empresa-detalle';

export const dynamic = 'force-dynamic';

/**
 * DETALLE del tarifario de una empresa (por NIT): matriz tipo × categoría × territorio, alta/edición scoped, aprobar
 * en lote, y por fila la antigüedad del precio (último cambio en la bitácora → año de la tarifa) con "ver histórico".
 */
export default async function TarifarioEmpresaPage({ params }: { params: Promise<{ nit: string }> }) {
  await exigirPagina('ver');
  const { nit } = await params;
  const k = nitComparable(decodeURIComponent(nit));
  if (!k) notFound();
  if (!(await tarifarioDisponible())) notFound();
  const [tarifas, historial] = await Promise.all([listarTarifasPorNit(k), listarHistorialPorNit(k)]);
  if (tarifas.length === 0) notFound();
  const umbralMeses = umbralEstancada();
  return <EmpresaDetalle nit={k} tarifas={tarifas} antiguedad={antiguedades(tarifas, ultimoCambioPrecio(historial), umbralMeses)} umbralMeses={umbralMeses} />;
}
