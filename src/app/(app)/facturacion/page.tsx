import { getFacturasPagina, getFacturasLiviano, type FiltroTabFactura } from '@/lib/db/facturas';
import { getClientes } from '@/lib/db/clientes';
import { getKPIsNotasCredito } from '@/lib/db/notas-credito';
import { FacturasListClient, type FacturasTab } from '@/components/facturas/list-client';

export const revalidate = 30;

const TABS_VALIDOS: readonly FacturasTab[] = [
  'todas', 'cartera_total', 'por_cobrar', 'vencidas', 'pendientes', 'parciales', 'cobradas', 'anuladas', 'refacturadas',
];

export default async function FacturacionPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const initialTab: FacturasTab = TABS_VALIDOS.includes(tab as FacturasTab) ? (tab as FacturasTab) : 'todas';
  const filtro: FiltroTabFactura = initialTab;

  // F-034: la página filtra server-side por el tab activo. Tabs chicos
  // (Pendientes, Refacturadas) traen TODOS sus records en una página y no
  // dependen de la ventana FECHA_EMISION desc del default global.
  // Las livianas siguen siendo el dataset completo: alimentan los counts
  // por tab y el header agregado de F-033.
  const [pagina, livianas, clientes, ncsKpis] = await Promise.all([
    getFacturasPagina({ limit: 50, filtro }),
    getFacturasLiviano(),
    getClientes(),
    getKPIsNotasCredito(),   // F-045: para mostrar facturado bruto vs neto
  ]);
  return (
    <FacturasListClient
      key={initialTab}
      initialInvoices={pagina.invoices}
      initialHayMas={pagina.hayMas}
      initialUltimaFecha={pagina.ultimaFecha}
      facturasLivianas={livianas}
      clientes={clientes}
      initialTab={initialTab}
      ncsActivasAnio={ncsKpis.montoActivasAnio}
    />
  );
}
