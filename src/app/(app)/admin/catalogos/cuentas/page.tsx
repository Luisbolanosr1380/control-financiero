import { redirect } from 'next/navigation';
import { currentUser } from '@clerk/nextjs/server';
import { getRolUsuario } from '@/lib/auth/allowlist';
import { getCatalogos } from '@/lib/db/catalogos';
import { CuentasCreatorClient } from '@/components/admin/cuentas-creator-client';

export const dynamic = 'force-dynamic';

export default async function CuentasCreatorPage() {
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? '';
  if (getRolUsuario(email) !== 'admin') {
    redirect('/no-acceso');
  }

  const { cuentas } = await getCatalogos();   // ya vienen en orden jerárquico
  return <CuentasCreatorClient cuentas={cuentas} />;
}
