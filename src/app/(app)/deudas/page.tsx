import { getDeudas, getKPIsDeudas, getAcreedores } from '@/lib/db/deudas';
import { DeudasClient } from '@/components/deudas/deudas-client';

export const revalidate = 60;

export default async function DeudasPage() {
  const [deudas, kpis, acreedores] = await Promise.all([
    getDeudas(),
    getKPIsDeudas(),
    getAcreedores(),
  ]);
  const vigentes = deudas.filter(d => d.saldoPendiente > 0);
  return <DeudasClient deudas={vigentes} kpis={kpis} acreedores={acreedores} />;
}
