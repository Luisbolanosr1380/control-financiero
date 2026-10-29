import { nombreQueCoincide } from '@/lib/clientes/buscar';
import type { ClienteSlim } from '@/lib/db/facturacion-agenda';

/**
 * Texto de una opción del buscador de clientes del mapeo: nombre · NIT, y si la
 * búsqueda dio con el cliente por otro nombre (marca, razón social, nombre en la
 * Agenda) se muestra entre paréntesis para que se entienda por qué apareció.
 */
export function etiquetaOpcionCliente(c: ClienteSlim, consulta = ''): string {
  const otro = nombreQueCoincide(c, consulta) || (c.nombreComercial && c.nombreComercial !== c.name ? c.nombreComercial : '');
  return `${c.name}${otro ? ` (${otro})` : ''}${c.nit ? ` · NIT ${c.nit}` : ' · sin NIT'}`;
}
