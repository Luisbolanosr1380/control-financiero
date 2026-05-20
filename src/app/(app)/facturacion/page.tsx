import { getFacturas } from '@/lib/db/facturas';
import { getClientes } from '@/lib/db/clientes';
import { FacturasListClient } from '@/components/facturas/list-client';

export const dynamic = 'force-dynamic'; // siempre fetch fresh

export default async function FacturacionPage() {
  const [facturas, clientes] = await Promise.all([
    getFacturas(),
    getClientes(),
  ]);
  return <FacturasListClient facturas={facturas} clientes={clientes} />;
}
