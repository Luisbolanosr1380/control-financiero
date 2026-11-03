import { exigirPagina } from '@/lib/auth/guard';
import { facturacionAgendaDisponible, produccionMensual } from '@/lib/db/facturacion-agenda';
import { mesValido, primerDia, rangoPorDefecto, ultimoDia } from '@/lib/facturacion-agenda/produccion';
import { ProduccionMensualView } from '@/components/por-facturar/produccion-mensual';

export const dynamic = 'force-dynamic';

/**
 * POR FACTURAR · PRODUCCIÓN POR MES (025): en qué mes se TERMINÓ cada prueba (fecha de
 * resultado, zona Guatemala) y cuánto de eso está facturado y cobrado; backlog con antigüedad;
 * cortes por línea de negocio y por cliente; cuántas pruebas quedan sin fecha confiable.
 * Rango por `?desde=YYYY-MM&hasta=YYYY-MM` (default: últimos 6 meses). Agregado en SQL
 * (RPC facturacion_produccion_mensual): nunca carga el espejo. Ver: 'ver'.
 */
export default async function ProduccionPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  await exigirPagina('ver');
  const sp = await searchParams;
  const def = rangoPorDefecto(6);
  const desde = mesValido(sp.desde) ?? def.desde;
  const hasta0 = mesValido(sp.hasta) ?? def.hasta;
  const hasta = hasta0 < desde ? desde : hasta0;
  const disponible = await facturacionAgendaDisponible();
  const datos = disponible ? await produccionMensual({ desde: primerDia(desde), hasta: ultimoDia(hasta) }) : null;
  return <ProduccionMensualView datos={datos} desde={desde} hasta={hasta} disponible={disponible} />;
}
