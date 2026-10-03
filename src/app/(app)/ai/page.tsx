import { redirect } from 'next/navigation';
import { getUltimoAnalisis, getHistorialAnalisis, getCostoAcumulado } from '@/lib/db/ai-analisis';
import { AiInsightsClient } from '@/components/ai/insights-client';
import { getSesion } from '@/lib/auth/guard';
import {
  PERMISSIONS,
  estaEnVentanaAnalisisManual,
  proximaVentanaAnalisisManual,
  fechaLegible,
} from '@/lib/auth/permissions';

export const dynamic = 'force-dynamic';

export default async function AiInsightsPage() {
  const { email, rol } = await getSesion();
  // Operativos NO ven /ai — redirigimos. (El sidebar ya esconde la entrada
  // si rol=operativo; este guard es por si alguien tipea la URL directo.)
  if (!rol || !PERMISSIONS[rol].verAnaliticaAvanzada) {
    redirect('/no-acceso');
  }

  const perms = PERMISSIONS[rol];
  const enVentana = !perms.analisisManualVentanaTiempo || estaEnVentanaAnalisisManual();
  const proximaVentana = enVentana ? null : fechaLegible(proximaVentanaAnalisisManual());

  const [ultimo, historial, costo] = await Promise.all([
    getUltimoAnalisis(),
    getHistorialAnalisis(20),
    getCostoAcumulado(),
  ]);
  return (
    <AiInsightsClient
      ultimo={ultimo}
      historial={historial}
      costo={costo}
      puedeGenerar={perms.analisisManual && enVentana}
      proximaVentana={proximaVentana}
    />
  );
}
