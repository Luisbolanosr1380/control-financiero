import { getAnalisisClientes } from '@/lib/db/clientes-analisis';
import { ClientesListClient } from '@/components/clientes/list-client';

export const dynamic = 'force-dynamic';

export default async function ClientesPage() {
  const clientes = await getAnalisisClientes();
  return <ClientesListClient clientes={clientes} />;
}
