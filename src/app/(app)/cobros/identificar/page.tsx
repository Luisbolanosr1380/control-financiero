import { getFacturas } from '@/lib/db/facturas';
import { getClientes } from '@/lib/db/clientes';
import { IdentificarClient } from '@/components/cobros/identificar-client';

export const dynamic = 'force-dynamic';

export default async function IdentificarPage() {
  const [facturas, clientes] = await Promise.all([getFacturas(), getClientes()]);
  const abiertas = facturas.filter(f => f.status === 'vencido' || f.status === 'por_cobrar');
  return <IdentificarClient facturas={abiertas} clientes={clientes} />;
}
