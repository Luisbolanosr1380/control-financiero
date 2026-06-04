import { redirect } from 'next/navigation';
import { currentUser } from '@clerk/nextjs/server';
import { AppShell } from '@/components/shell/app-shell';
import { getRolUsuario } from '@/lib/auth/allowlist';
import { getLimiteAuros } from '@/lib/auth/permissions';
import { getSidebarBadges } from '@/lib/db/sidebar-kpis';
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

  // F-043: única fuente de verdad para los badges del sidebar. Los counts
  // ya vienen normalizados a 0 si una fuente falló (silenciosa).
  const badges = await getSidebarBadges();

  // Consumo mensual de Auros para mostrar en el drawer (silencioso si falla).
  // Si el rol no usa el chat, omitimos el query para ahorrar Airtable.
  const limiteAuros = getLimiteAuros(rol);
  let consumoAuros = 0;
  if (limiteAuros > 0) {
    try { consumoAuros = await getConsumoMensual(email); } catch { /* 0 */ }
  }

  return (
    <AppShell
      facturasVencidasCount={badges.facturasVencidas}
      deudasVencidasCount={badges.deudasVencidas}
      pagosPendientesCount={badges.pagosPendientes}
      pagosPendientesAlertasRojas={badges.pagosPendientesAlertasRojas}
      rol={rol}
      email={email}
      consumoAuros={consumoAuros}
      limiteAuros={limiteAuros}
    >{children}</AppShell>
  );
}
