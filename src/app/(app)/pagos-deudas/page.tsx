import { getPagosRecientes } from '@/lib/db/pagos-deudas';
import { getAcreedores } from '@/lib/db/deudas';
import { PagosDeudasClient } from '@/components/deudas/pagos-deudas-client';

export const revalidate = 30;

export default async function PagosDeudasPage() {
  const [pagos, acreedores] = await Promise.all([
    getPagosRecientes(200),
    getAcreedores(),
  ]);
  return <PagosDeudasClient pagos={pagos} acreedores={acreedores} />;
}
