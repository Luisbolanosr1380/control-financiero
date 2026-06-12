import { getFacturasPagina, getFacturasLiviano, computeTopClientesDelMes, type FiltroTabFactura } from '@/lib/db/facturas';
import { getClientes } from '@/lib/db/clientes';
import { getKPIsNotasCredito } from '@/lib/db/notas-credito';
import { FacturasListClient, type FacturasTab } from '@/components/facturas/list-client';
import { parseMesParam } from '@/lib/utils/mes-activo';

export const revalidate = 30;

const TABS_VALIDOS: readonly FacturasTab[] = [
  'todas', 'cartera_total', 'por_cobrar', 'vencidas', 'pendientes', 'parciales', 'cobradas', 'anuladas', 'refacturadas',
];

export default async function FacturacionPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; mes?: string }>;
}) {
  const { tab, mes: mesRaw } = await searchParams;
  const initialTab: FacturasTab = TABS_VALIDOS.includes(tab as FacturasTab) ? (tab as FacturasTab) : 'todas';
  const filtro: FiltroTabFactura = initialTab;
  // F-BF-002a: el selector global de mes filtra tab+listado+livianas.
  const mes = parseMesParam(mesRaw);

  const [pagina, livianas, clientes, ncsKpis] = await Promise.all([
    getFacturasPagina({ limit: 50, filtro, mes }),
    getFacturasLiviano({ mes }),
    getClientes(),
    getKPIsNotasCredito(),   // F-045: para mostrar facturado bruto vs neto
  ]);
  // F-BF-002b: top clientes del mes (no toca Airtable — usa el dataset liviano).
  const topClientes = computeTopClientesDelMes(livianas, clientes, 5);
  return (
    <FacturasListClient
      key={`${initialTab}|${mes}`}
      initialInvoices={pagina.invoices}
      initialHayMas={pagina.hayMas}
      initialUltimaFecha={pagina.ultimaFecha}
      facturasLivianas={livianas}
      clientes={clientes}
      initialTab={initialTab}
      mesActivo={mes}
      topClientes={topClientes.items}
      totalMesQ={topClientes.totalMesQ}
      ncsActivasAnio={ncsKpis.montoActivasAnio}
    />
  );
}
