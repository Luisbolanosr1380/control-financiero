import { getAnalisisClientes } from '@/lib/db/clientes-analisis';
import { getClientes } from '@/lib/db/clientes';
import { clientesConNitCompartido } from '@/lib/clientes/nit';
import { terminosDe } from '@/lib/clientes/buscar';
import { ClientesListClient } from '@/components/clientes/list-client';

export const revalidate = 120;

export default async function ClientesPage() {
  const [clientes, catalogo] = await Promise.all([getAnalisisClientes(), getClientes().catch(() => [])]);
  // AVISO-NIT: señal en la lista para los clientes activos que comparten NIT con otro.
  const nitCompartido = Object.fromEntries(clientesConNitCompartido(catalogo));
  // 020: el buscador de la lista encuentra por nombre, razón social, nombre comercial, marcas y NIT (sin tildes).
  const terminos = Object.fromEntries(catalogo.map(c => [c.id, [...terminosDe(c), c.nit ?? '']]));
  const nombreComercial = Object.fromEntries(catalogo.filter(c => c.nombreComercial && c.nombreComercial !== c.name).map(c => [c.id, c.nombreComercial!]));
  return <ClientesListClient clientes={clientes} nitCompartido={nitCompartido} terminos={terminos} nombreComercial={nombreComercial} />;
}
