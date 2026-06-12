import { getCobrosPagina, getCobrosCompletos } from '@/lib/db/cobros';
import { getClientes } from '@/lib/db/clientes';
import { CobrosListClient } from '@/components/cobros/cobros-list-client';
import { parseMesParam } from '@/lib/utils/mes-activo';

export const revalidate = 30;

export default async function CobrosPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes: mesRaw } = await searchParams;
  // F-BF-002a: respeta el selector global de mes.
  const mes = parseMesParam(mesRaw);

  const [pagina, cobrosCompletos, clientes] = await Promise.all([
    getCobrosPagina({ limit: 50, mes }),
    getCobrosCompletos({ mes }),
    getClientes(),
  ]);
  return (
    <CobrosListClient
      key={mes}
      initialCobros={pagina.cobros}
      initialHayMas={pagina.hayMas}
      initialUltimaFecha={pagina.ultimaFecha}
      cobrosCompletos={cobrosCompletos}
      clientes={clientes}
      mesActivo={mes}
    />
  );
}
