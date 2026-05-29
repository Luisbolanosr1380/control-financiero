import { getClientes } from '@/lib/db/clientes';
import { getCentrosCostoActivos } from '@/lib/db/centros';
import { NuevaFacturaClient } from '@/components/facturas/nueva-factura-client';

export const revalidate = 120;

export default async function NuevaFacturaPage() {
  const [clientes, centros] = await Promise.all([
    getClientes(),
    getCentrosCostoActivos(),
  ]);

  return <NuevaFacturaClient clientes={clientes} centros={centros} />;
}
