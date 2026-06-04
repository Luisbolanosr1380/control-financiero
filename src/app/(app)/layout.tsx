import { redirect } from 'next/navigation';
import { currentUser } from '@clerk/nextjs/server';
import { AppShell } from '@/components/shell/app-shell';
import { getRolUsuario } from '@/lib/auth/allowlist';
import { getLimiteAuros } from '@/lib/auth/permissions';
import { getKPIsDeudas } from '@/lib/db/deudas';
import { getKPIsPagosPendientes } from '@/lib/db/planillas';
import { getConsumoMensual } from '@/lib/db/uso-auros';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? '';
  const rol = getRolUsuario(email);
  if (!rol) {
    redirect('/no-acceso');
  }

  // Badges dinámicos para sidebar (silenciosos si fallan).
  let deudasVencidasCount = 0;
  let pagosPendientesCount = 0;
  let pagosPendientesAlertasRojas = 0;
  try {
    const [kd, kp] = await Promise.all([getKPIsDeudas(), getKPIsPagosPendientes()]);
    deudasVencidasCount = kd.vencidas.cantidad;
    pagosPendientesCount = kp.totalEmpleadosPendientes;
    pagosPendientesAlertasRojas = kp.alertasRojas;
  } catch {
    /* sin badges */
  }

  // Consumo mensual de Auros para mostrar en el drawer (silencioso si falla).
  // Si el rol no usa el chat, omitimos el query para ahorrar Airtable.
  const limiteAuros = getLimiteAuros(rol);
  let consumoAuros = 0;
  if (limiteAuros > 0) {
    try { consumoAuros = await getConsumoMensual(email); } catch { /* 0 */ }
  }

  return (
    <AppShell
      deudasVencidasCount={deudasVencidasCount}
      pagosPendientesCount={pagosPendientesCount}
      pagosPendientesAlertasRojas={pagosPendientesAlertasRojas}
      rol={rol}
      email={email}
      consumoAuros={consumoAuros}
      limiteAuros={limiteAuros}
    >{children}</AppShell>
  );
}
