import { redirect } from 'next/navigation';
import { currentUser } from '@clerk/nextjs/server';
import { AppShell } from '@/components/shell/app-shell';
import { getRolUsuario } from '@/lib/auth/allowlist';
import { getLimiteAuros } from '@/lib/auth/permissions';
import { getKPIsDeudas } from '@/lib/db/deudas';
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

  // Badge dinámico para "Deudas" en el sidebar (silencioso si falla).
  let deudasVencidasCount = 0;
  try {
    const k = await getKPIsDeudas();
    deudasVencidasCount = k.vencidas.cantidad;
  } catch {
    /* sin badge */
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
      rol={rol}
      email={email}
      consumoAuros={consumoAuros}
      limiteAuros={limiteAuros}
    >{children}</AppShell>
  );
}
