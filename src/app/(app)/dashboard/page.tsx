import { getFacturas } from '@/lib/db/facturas';
import { getClientes } from '@/lib/db/clientes';
import { getDashboardKPIs, getLineStats, getAging, getTopDeudores } from '@/lib/db/kpis';
import { DashboardClient } from '@/components/dashboard/dashboard-client';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const [facturas, clientes] = await Promise.all([getFacturas(), getClientes()]);

  const [kpis, lineStats, aging, topDeudores] = await Promise.all([
    getDashboardKPIs(facturas),
    getLineStats(facturas),
    getAging(facturas),
    getTopDeudores(5, facturas, clientes),
  ]);

  return <DashboardClient kpis={kpis} lineStats={lineStats} aging={aging} topDeudores={topDeudores} />;
}
