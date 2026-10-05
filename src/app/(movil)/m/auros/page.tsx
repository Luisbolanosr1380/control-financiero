import { redirect } from 'next/navigation';
import { getSesion } from '@/lib/auth/guard';
import { getLimiteAuros, tienePermiso } from '@/lib/auth/permissions';
import { getConsumoMensual } from '@/lib/db/uso-auros';
import { empresaConfig } from '@/lib/config/empresa';
import { AurosMovil } from '@/components/movil/auros-movil';

export const dynamic = 'force-dynamic';

/** Auros a pantalla completa. Mismo endpoint (/api/ai/chat), mismos límites por rol. */
export default async function AurosMovilPage() {
  const { email, rol } = await getSesion();
  if (!rol || !tienePermiso(rol, 'aurosChat')) redirect('/m');
  const limite = getLimiteAuros(rol);
  let consumo = 0;
  if (Number.isFinite(limite)) {
    try { consumo = await getConsumoMensual(email); } catch { /* 0 */ }
  }
  return <AurosMovil rol={rol} consumoMensual={consumo} limiteMensual={limite} dueno={empresaConfig().dueno} />;
}
