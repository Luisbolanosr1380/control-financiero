import { redirect } from 'next/navigation';
import { currentUser } from '@clerk/nextjs/server';
import { AppShell } from '@/components/shell/app-shell';
import { isEmailAllowed } from '@/lib/auth/allowlist';
import { getKPIsDeudas } from '@/lib/db/deudas';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress;
  if (!isEmailAllowed(email)) {
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

  return <AppShell deudasVencidasCount={deudasVencidasCount}>{children}</AppShell>;
}
