import { getFacturasPagina, getFacturasCountTotal } from '@/lib/db/facturas';
import { getClientes } from '@/lib/db/clientes';
import { FacturasListClient, type FacturasTab } from '@/components/facturas/list-client';

export const dynamic = 'force-dynamic';

const TABS_VALIDOS: readonly FacturasTab[] = ['todas', 'vencidas', 'por_cobrar', 'cobradas', 'anuladas', 'pendientes'];

export default async function FacturacionPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const initialTab: FacturasTab = TABS_VALIDOS.includes(tab as FacturasTab) ? (tab as FacturasTab) : 'todas';

  const [pagina, totalConsolidadas, clientes] = await Promise.all([
    getFacturasPagina({ limit: 50 }),
    getFacturasCountTotal(),
    getClientes(),
  ]);
  return (
    <FacturasListClient
      initialInvoices={pagina.invoices}
      initialHayMas={pagina.hayMas}
      initialUltimaFecha={pagina.ultimaFecha}
      totalConsolidadas={totalConsolidadas}
      clientes={clientes}
      initialTab={initialTab}
    />
  );
}
