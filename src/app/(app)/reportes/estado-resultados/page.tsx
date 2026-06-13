/**
 * F-058b — Vista del Estado de Resultados.
 *
 * Server component: lee searchParams (mes, modo, cc), corre el motor,
 * y delega a un client component para el toggle/filtros. El motor es
 * pesado (lee PARTIDAS + MAPEO_ER + CUENTAS + GASTOS) — server-side
 * permite cache de Next.js por searchParams.
 */

import { parseMesParam } from '@/lib/utils/mes-activo';
import { generarEstadoResultados, type ModoER } from '@/lib/contabilidad/estado-resultados';
import { getCentrosCostoActivos } from '@/lib/db/centros';
import { EstadoResultadosClient } from '@/components/reportes/estado-resultados-client';

export const revalidate = 60;

const MODOS_VALIDOS: readonly ModoER[] = ['fiscal', 'operativo'];

export default async function EstadoResultadosPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; modo?: string; cc?: string }>;
}) {
  const { mes: mesRaw, modo: modoRaw, cc: ccRaw } = await searchParams;

  const periodo = parseMesParam(mesRaw);
  const modo: ModoER = MODOS_VALIDOS.includes(modoRaw as ModoER) ? (modoRaw as ModoER) : 'fiscal';
  const centroCostoId = ccRaw?.trim() || undefined;

  const [er, centros] = await Promise.all([
    generarEstadoResultados({ periodo, modo, centroCostoId }),
    getCentrosCostoActivos(),
  ]);

  return (
    <EstadoResultadosClient
      key={`${periodo}|${modo}|${centroCostoId ?? ''}`}
      er={er}
      centros={centros.map(c => ({ id: c.id, nombre: c.nombre }))}
      periodoActivo={periodo}
      modoActivo={modo}
      centroCostoActivo={centroCostoId}
    />
  );
}
