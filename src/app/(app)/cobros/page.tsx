import { getCobrosPagina, getCobrosCountTotal } from '@/lib/db/cobros';
import { getClientes } from '@/lib/db/clientes';
import { CobrosListClient } from '@/components/cobros/cobros-list-client';

export const dynamic = 'force-dynamic';

export default async function CobrosPage() {
  const [pagina, totalConsolidados, clientes] = await Promise.all([
    getCobrosPagina({ limit: 50 }),
    getCobrosCountTotal(),
    getClientes(),
  ]);
  return (
    <CobrosListClient
      initialCobros={pagina.cobros}
      initialHayMas={pagina.hayMas}
      initialUltimaFecha={pagina.ultimaFecha}
      totalConsolidados={totalConsolidados}
      clientes={clientes}
    />
  );
}
