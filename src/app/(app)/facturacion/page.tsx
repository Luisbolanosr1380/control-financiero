import { getFacturasPagina, getFacturasLiviano, computeTopClientesDelMes, type FiltroTabFactura } from '@/lib/db/facturas';
import { getClientes } from '@/lib/db/clientes';
import { getKPIsNotasCredito } from '@/lib/db/notas-credito';
import { getCentrosCosto } from '@/lib/db/centros';
import { FacturasListClient, type CarteraProps, type FacturasTab } from '@/components/facturas/list-client';
import { parseMesParam } from '@/lib/utils/mes-activo';
import { criteriosDesdeParams, hayBusquedaServidor } from '@/lib/facturacion/buscar-monto';
import { buscarFacturas } from '@/lib/db/facturas-buscar';
import { getCarteraConSeguimiento } from '@/lib/db/cobranza-facturas';
import { FILTROS_COBRANZA, TABS_CARTERA, esFiltroCobranza, esOrdenCartera, esTabCartera, filaEnTabCartera as filaEnTab, pasaFiltroCobranza, type FiltroCobranza } from '@/lib/cobranza/seguimiento';

export const revalidate = 30;

const TABS_VALIDOS: readonly FacturasTab[] = [
  'todas', 'cartera_total', 'por_cobrar', 'vencidas', 'pendientes', 'parciales', 'cobradas', 'anuladas', 'refacturadas',
];

export default async function FacturacionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const uno = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const tab = uno('tab'), mesRaw = uno('mes');
  // BUSCAR POR MONTO / POR CLIENTE: los criterios viajan en la URL; con alguno, el servidor busca sobre TODAS las facturas (sin el mes)
  const criterios = criteriosDesdeParams(uno);
  const busqueda = hayBusquedaServidor(criterios) ? { criterios, resultado: await buscarFacturas(criterios) } : null;
  const initialTab: FacturasTab = TABS_VALIDOS.includes(tab as FacturasTab) ? (tab as FacturasTab) : 'todas';
  const filtro: FiltroTabFactura = initialTab;
  // F-BF-002a: el selector global de mes filtra tab+listado+livianas.
  const mes = parseMesParam(mesRaw);
  // SEGUIMIENTO DE COBRO: las pestañas de cartera muestran TODAS las abiertas (todos los meses) con la columna «Cobranza»
  const esCartera = !busqueda && esTabCartera(initialTab);

  const [pagina, livianas, clientes, ncsKpis, centros, carteraDatos] = await Promise.all([
    esCartera ? Promise.resolve({ invoices: [], hayMas: false, ultimaFecha: null }) : getFacturasPagina({ limit: 50, filtro, mes }),
    getFacturasLiviano({ mes }),
    getClientes(),
    getKPIsNotasCredito(),   // F-045: para mostrar facturado bruto vs neto
    getCentrosCosto(),       // FIX-DASHBOARD-ANALITICA-HIT: líneas reales de la base
    esCartera ? getCarteraConSeguimiento() : Promise.resolve(null),
  ]);
  const nombresCC = Object.fromEntries(centros.map(c => [c.id, c.nombre.trim()]));
  // F-BF-002b: top clientes del mes (no toca Airtable — usa el dataset liviano).
  const topClientes = computeTopClientesDelMes(livianas, clientes, 5);

  let cartera: CarteraProps | null = null;
  if (carteraDatos) {
    const filtroCob: FiltroCobranza | null = esFiltroCobranza(uno('cob')) ? (uno('cob') as FiltroCobranza) : null;
    const ordenRaw = uno('orden'), dirRaw = uno('dir');
    const orden = esOrdenCartera(ordenRaw) ? ordenRaw : 'dias';
    const dir: 'asc' | 'desc' = dirRaw === 'asc' ? 'asc' : dirRaw === 'desc' ? 'desc' : orden === 'cliente' || orden === 'factura' || orden === 'emision' || orden === 'vence' ? 'asc' : 'desc';
    const filasTab = carteraDatos.filas.filter(f => filaEnTab(f, initialTab));
    const filas = filtroCob ? filasTab.filter(f => pasaFiltroCobranza(f.seguimiento, filtroCob, carteraDatos.hoy)) : filasTab;
    const conteoFiltros = Object.fromEntries(FILTROS_COBRANZA.map(fc => [fc, filasTab.filter(f => pasaFiltroCobranza(f.seguimiento, fc, carteraDatos.hoy)).length])) as Record<FiltroCobranza, number>;
    const counts = Object.fromEntries(TABS_CARTERA.map(t => [t, carteraDatos.filas.filter(f => filaEnTab(f, t)).length])) as Partial<Record<FacturasTab, number>>;
    cartera = { hoy: carteraDatos.hoy, filas, filasTab, counts, orden, dir, filtro: filtroCob, conteoFiltros, kpiPromesas: carteraDatos.kpiPromesas, error: carteraDatos.error };
  }

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
      nombresCC={nombresCC}
      busqueda={busqueda}
      criteriosUrl={criterios}
      cartera={cartera}
    />
  );
}
