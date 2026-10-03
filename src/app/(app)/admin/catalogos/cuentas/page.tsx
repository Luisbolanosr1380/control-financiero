import { exigirPagina } from '@/lib/auth/guard';
import { getCatalogos } from '@/lib/db/catalogos';
import { CuentasCreatorClient } from '@/components/admin/cuentas-creator-client';

export const dynamic = 'force-dynamic';

export default async function CuentasCreatorPage() {
  // Catálogos: admin y contador (matriz F-GESTION-USUARIOS).
  await exigirPagina('catalogos');

  const { cuentas } = await getCatalogos();   // ya vienen en orden jerárquico
  return <CuentasCreatorClient cuentas={cuentas} />;
}
