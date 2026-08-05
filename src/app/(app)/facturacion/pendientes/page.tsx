import { getFacturasPendientesCobro } from '@/lib/db/facturas-pendientes';
import { getResumenGestiones } from '@/lib/db/gestiones-cobro';
import { PendientesCobroClient } from '@/components/facturas/pendientes-client';

export const revalidate = 30;

export default async function PendientesCobroPage() {
  const [data, gestiones] = await Promise.all([
    getFacturasPendientesCobro(),
    getResumenGestiones(),
  ]);
  return <PendientesCobroClient data={data} gestiones={gestiones} />;
}
