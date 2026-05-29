import { getAnalisisClientes } from '@/lib/db/clientes-analisis';
import { ClientesListClient } from '@/components/clientes/list-client';

export const revalidate = 120;

export default async function ClientesPage() {
  const clientes = await getAnalisisClientes();
  return <ClientesListClient clientes={clientes} />;
}
