import { redirect } from 'next/navigation';
import { formatInTimeZone } from 'date-fns-tz';
import { getSesion } from '@/lib/auth/guard';
import { puede } from '@/lib/auth/roles';
import { getEventosCaja } from '@/lib/tesoreria/fuentes';
import { ventanas } from '@/lib/tesoreria/motor';
import { TZ_GUATEMALA } from '@/lib/utils/fechas';
import { FlujoMovil } from '@/components/movil/flujo-movil';

export const dynamic = 'force-dynamic';

/**
 * Flujo de caja en el teléfono: los MISMOS eventos y el MISMO motor que
 * /tesoreria (mismos supuestos por defecto), dibujados para pantalla chica.
 * Permiso 'flujo' (admin, contador), igual que /tesoreria.
 */
export default async function FlujoMovilPage() {
  const { rol } = await getSesion();
  if (!puede(rol, 'flujo')) redirect('/m/resumen');
  const hoy = formatInTimeZone(new Date(), TZ_GUATEMALA, 'yyyy-MM-dd');
  const hasta = [ventanas(hoy, 'mes', 6), ventanas(hoy, 'semana', 26)]
    .map(v => v[v.length - 1].fin)
    .reduce((a, b) => (a > b ? a : b));
  const { eventos, supuestos } = await getEventosCaja(hoy, hasta);
  return <FlujoMovil hoy={hoy} eventos={eventos} saldoInicial={supuestos.saldoInicial.total} cedidas={supuestos.cedidas} />;
}
