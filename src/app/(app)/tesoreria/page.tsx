import { formatInTimeZone } from 'date-fns-tz';
import { exigirPagina } from '@/lib/auth/guard';
import { getEventosCaja } from '@/lib/tesoreria/fuentes';
import { ventanas } from '@/lib/tesoreria/motor';
import { TZ_GUATEMALA } from '@/lib/utils/fechas';
import { TesoreriaClient } from '@/components/tesoreria/tesoreria-client';

export const dynamic = 'force-dynamic';

/**
 * TESORERÍA — flujo de caja proyectado (READ-ONLY: no escribe ni genera
 * asientos). El servidor arma los eventos fechados para el horizonte más
 * largo; el cliente proyecta (motor puro) según horizonte/granularidad.
 */
export default async function TesoreriaPage() {
  await exigirPagina('flujo');
  const hoy = formatInTimeZone(new Date(), TZ_GUATEMALA, 'yyyy-MM-dd');
  const hasta = [ventanas(hoy, 'mes', 6), ventanas(hoy, 'semana', 26)]
    .map(v => v[v.length - 1].fin)
    .reduce((a, b) => (a > b ? a : b));
  const { eventos, supuestos } = await getEventosCaja(hoy, hasta);
  return <TesoreriaClient hoy={hoy} eventos={eventos} supuestos={supuestos} />;
}
