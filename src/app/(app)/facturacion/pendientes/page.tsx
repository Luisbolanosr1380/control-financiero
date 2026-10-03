import { getFacturasPendientesCobro } from '@/lib/db/facturas-pendientes';
import { getResumenGestiones } from '@/lib/db/gestiones-cobro';
import { getEtiquetasPorDocumento } from '@/lib/db/etiquetas';
import { PendientesCobroClient } from '@/components/facturas/pendientes-client';

export const revalidate = 30;

export default async function PendientesCobroPage() {
  const [data, gestiones, etiquetasFacturas] = await Promise.all([
    getFacturasPendientesCobro(),
    getResumenGestiones(),
    getEtiquetasPorDocumento('factura'),
  ]);
  return <PendientesCobroClient data={data} gestiones={gestiones} etiquetasFacturas={etiquetasFacturas} />;
}
