import { getFacturasPendientesCobro } from '@/lib/db/facturas-pendientes';
import { agruparPorCliente } from '@/lib/resumen/cobrar';
import { ListaCobrar } from '@/components/movil/lista-cobrar';

export const dynamic = 'force-dynamic';

/**
 * Por cobrar en el teléfono: "¿a quién le cobro?". Misma fuente que
 * Pendientes de cobro en la computadora (facturas-pendientes.ts), sin las
 * cedidas a factoraje (las cobra el financiador), agrupado por cliente y
 * con lo vencido primero.
 */
export default async function CobrarMovilPage() {
  const pend = await getFacturasPendientesCobro();
  return <ListaCobrar clientes={agruparPorCliente(pend.filas)} totales={pend.totales} />;
}
