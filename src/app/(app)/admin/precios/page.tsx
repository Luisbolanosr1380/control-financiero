import { redirect } from 'next/navigation';
import { getSesion } from '@/lib/auth/guard';
import { getMapaPrecios } from '@/lib/db/precios';
import { filtrosDesdeParams } from '@/lib/precios/mapa';
import { MapaPreciosClient } from '@/components/admin/mapa-precios-client';

export const dynamic = 'force-dynamic';

/**
 * ADMIN · MAPA DE PRECIOS (027). Solo admin: muestra el precio y la brecha de cada cliente.
 * Rango y umbrales por search params (?desde&hasta&vol&idx); todo se calcula en SQL (RPC precios_mapa).
 */
export default async function MapaPreciosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // Solo admin — mismo patrón que admin/roadmap. El loader vuelve a validar y la RPC solo acepta service_role.
  const { rol } = await getSesion();
  if (rol !== 'admin') {
    redirect('/no-acceso');
  }
  const filtros = filtrosDesdeParams(await searchParams, new Date());
  const datos = await getMapaPrecios(filtros);
  return <MapaPreciosClient datos={datos} filtros={filtros} />;
}
