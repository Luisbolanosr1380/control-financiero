import { getDeudas, getKPIsDeudas, getAcreedores } from '@/lib/db/deudas';
import { getCentrosCostoActivos } from '@/lib/db/centros';
import { DeudasClient } from '@/components/deudas/deudas-client';

export const revalidate = 60;

export default async function DeudasPage() {
  const [deudas, kpis, acreedores, centros] = await Promise.all([
    getDeudas(),
    getKPIsDeudas(),
    getAcreedores(),
    getCentrosCostoActivos(),
  ]);
  const vigentes = deudas.filter(d => d.saldoPendiente > 0);
  const centrosUI = centros.map(c => ({ id: c.id, nombre: c.nombre }));
  return <DeudasClient deudas={vigentes} kpis={kpis} acreedores={acreedores} centros={centrosUI} />;
}
