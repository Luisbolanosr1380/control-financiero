import { getFacturasPendientesCobro } from '@/lib/db/facturas-pendientes';
import { PendientesCobroClient } from '@/components/facturas/pendientes-client';

export const revalidate = 30;

export default async function PendientesCobroPage() {
  const data = await getFacturasPendientesCobro();
  return <PendientesCobroClient data={data} />;
}
