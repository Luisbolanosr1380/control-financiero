import { getFacturasPagina, getFacturasCountTotal } from '@/lib/db/facturas';
import { getClientes } from '@/lib/db/clientes';
import { FacturasListClient } from '@/components/facturas/list-client';

export const dynamic = 'force-dynamic';

export default async function FacturacionPage() {
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
    />
  );
}
