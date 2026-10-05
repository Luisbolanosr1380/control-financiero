import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/app-shell';
import { getSesion } from '@/lib/auth/guard';
import { getLimiteAuros } from '@/lib/auth/permissions';
import { getSidebarBadges } from '@/lib/db/sidebar-kpis';
import { getConsumoMensual } from '@/lib/db/uso-auros';
import { empresaConfig } from '@/lib/config/empresa';
import { slugsConAcceso } from '@/lib/auth/roles';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // F-GESTION-USUARIOS: el rol se resuelve POR EMPRESA (accesos del
  // metadata de Clerk; esquema legacy si aún no migró). Sin rol en este
  // deploy: si tiene acceso a otras empresas → selector; si no → sin acceso.
  // (Las server actions NO pasan por acá: cada una valida con guard.ts.)
  const marca = empresaConfig();
  const { email, rol, meta } = await getSesion();
  const empresasUsuario = slugsConAcceso(meta);
  if (!rol) {
    redirect(empresasUsuario && empresasUsuario.some(s => s !== marca.slug) ? '/empresas' : '/no-acceso');
  }
  const multiEmpresa = (empresasUsuario?.length ?? 0) > 1;

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
      ncsPendientesCount={badges.ncsPendientesAprobacion}
      rol={rol}
      email={email}
      consumoAuros={consumoAuros}
      limiteAuros={limiteAuros}
      marcaNombre={marca.nombreSistema}
      marcaSub={marca.subtitulo}
      multiEmpresa={multiEmpresa}
      dueno={marca.dueno}
    >{children}</AppShell>
  );
}
