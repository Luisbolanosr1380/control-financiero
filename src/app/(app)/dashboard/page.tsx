import { getFacturas } from '@/lib/db/facturas';
import { getClientes } from '@/lib/db/clientes';
import { getDashboardKPIs, getLineStats, getAging, getTopDeudores } from '@/lib/db/kpis';
import { getAnalisisClientes } from '@/lib/db/clientes-analisis';
import { DashboardClient } from '@/components/dashboard/dashboard-client';

export const revalidate = 60;

export default async function DashboardPage() {
  const [facturas, clientes] = await Promise.all([getFacturas(), getClientes()]);

  const [kpis, lineStats, aging, topDeudores, analisis] = await Promise.all([
    getDashboardKPIs(facturas),
    getLineStats(facturas),
    getAging(facturas),
    getTopDeudores(5, facturas, clientes),
    getAnalisisClientes(),
  ]);

  // "En riesgo" = fuga real → solo clientes con naturaleza recurrente o mixta.
  // Los proyecto-dominantes (TalentTrack, Administrativo) NO son fuga por inactividad.
  const clientesRiesgo = analisis
    .filter(a =>
      (a.clasificacion === 'perdido' || a.clasificacion === 'en_riesgo' || a.clasificacion === 'en_declive')
      && a.naturalezaDominante !== 'proyecto',
    )
    .sort((a, b) => b.montoPromedio - a.montoPromedio)
    .slice(0, 8);

  return (
    <DashboardClient
      kpis={kpis}
      lineStats={lineStats}
      aging={aging}
      topDeudores={topDeudores}
      clientesRiesgo={clientesRiesgo}
    />
  );
}
