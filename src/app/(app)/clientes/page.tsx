import { getAnalisisClientes } from '@/lib/db/clientes-analisis';
import { getClientes } from '@/lib/db/clientes';
import { clientesConNitCompartido } from '@/lib/clientes/nit';
import { ClientesListClient } from '@/components/clientes/list-client';

export const revalidate = 120;

export default async function ClientesPage() {
  const [clientes, catalogo] = await Promise.all([getAnalisisClientes(), getClientes().catch(() => [])]);
  // AVISO-NIT: señal en la lista para los clientes activos que comparten NIT con otro.
  const nitCompartido = Object.fromEntries(clientesConNitCompartido(catalogo));
  return <ClientesListClient clientes={clientes} nitCompartido={nitCompartido} />;
}
