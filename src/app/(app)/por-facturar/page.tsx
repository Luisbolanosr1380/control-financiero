import { exigirPagina } from '@/lib/auth/guard';
import { configAgenda } from '@/lib/facturacion-agenda/config';
import { kpisPorFacturar } from '@/lib/facturacion-agenda/resumen';
import { facturacionAgendaDisponible, vistaPorFacturar, type VistaPorFacturar } from '@/lib/db/facturacion-agenda';
import { PorFacturarClient } from '@/components/por-facturar/por-facturar-client';

export const dynamic = 'force-dynamic';

/**
 * FACTURACIÓN AGENDA · "Por facturar": expedientes de evaluación terminados que
 * la Agenda de Golden tiene con cobro pendiente, agrupados por cliente, con su
 * precio del tarifario. Ver: 'ver'; traer / mapear / facturar: 'facturar_agenda'.
 * ESCALA: la lista NO carga el espejo (7,878 filas en Golden): agregados en SQL (017) o
 * consultas livianas; sin mapear y psicométricas solo se cuentan; la pestaña "Sin mapear"
 * se pide on demand, por empresa y paginada.
 */
export default async function PorFacturarPage() {
  await exigirPagina('ver');
  const disponible = await facturacionAgendaDisponible();
  const vista: VistaPorFacturar = disponible ? await vistaPorFacturar() : { grupos: [], kpis: kpisPorFacturar([]), sync: null, total: 0, sinMapear: { expedientes: 0, empresas: 0 }, noFacturan: [], agregadoEnSql: false };
  const cfg = configAgenda();
  return <PorFacturarClient disponible={disponible} configurada={cfg.apiKey.length > 0} writeback={cfg.writeback} grupos={vista.grupos} kpis={vista.kpis} sync={vista.sync} total={vista.total} sinMapear={vista.sinMapear} noFacturan={vista.noFacturan} agregadoEnSql={vista.agregadoEnSql} />;
}
