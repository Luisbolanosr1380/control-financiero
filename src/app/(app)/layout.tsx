import { redirect } from 'next/navigation';
import { currentUser } from '@clerk/nextjs/server';
import { AppShell } from '@/components/shell/app-shell';
import { isEmailAllowed } from '@/lib/auth/allowlist';

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

  return <AppShell>{children}</AppShell>;
}
