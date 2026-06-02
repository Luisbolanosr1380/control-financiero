import { getFacturasPagina, getFacturasLiviano } from '@/lib/db/facturas';
import { getClientes } from '@/lib/db/clientes';
import { FacturasListClient, type FacturasTab } from '@/components/facturas/list-client';

export const revalidate = 30;

const TABS_VALIDOS: readonly FacturasTab[] = ['todas', 'vencidas', 'por_cobrar', 'cobradas', 'anuladas', 'pendientes', 'refacturadas'];

export default async function FacturacionPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const initialTab: FacturasTab = TABS_VALIDOS.includes(tab as FacturasTab) ? (tab as FacturasTab) : 'todas';

  // F-033: livianas en paralelo con la paginación. Livianas es el dataset
  // completo (mínimo) que alimenta los totales agregados del header sin
  // depender de cuántas filas están "cargadas". `totalConsolidadas` legacy
  // se deriva de livianas.length para evitar otro round-trip.
  const [pagina, livianas, clientes] = await Promise.all([
    getFacturasPagina({ limit: 50 }),
    getFacturasLiviano(),
    getClientes(),
  ]);
  return (
    <FacturasListClient
      initialInvoices={pagina.invoices}
      initialHayMas={pagina.hayMas}
      initialUltimaFecha={pagina.ultimaFecha}
      facturasLivianas={livianas}
      clientes={clientes}
      initialTab={initialTab}
    />
  );
}
