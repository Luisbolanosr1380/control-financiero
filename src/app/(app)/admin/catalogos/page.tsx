import { redirect } from 'next/navigation';
import { currentUser } from '@clerk/nextjs/server';
import { getRolUsuario } from '@/lib/auth/allowlist';
import { getCatalogos } from '@/lib/db/catalogos';
import { getEtiquetas, getUsoEtiquetas } from '@/lib/db/etiquetas';
import { AdminCatalogosClient } from '@/components/admin/catalogos-client';

export const dynamic = 'force-dynamic';

export default async function AdminCatalogosPage() {
  // Server guard: solo admin entra (igual que /admin/usuarios).
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? '';
  if (getRolUsuario(email) !== 'admin') {
    redirect('/no-acceso');
  }

  const [catalogos, etiquetas, usoEtiquetas] = await Promise.all([
    getCatalogos(), getEtiquetas(), getUsoEtiquetas(),
  ]);
  return <AdminCatalogosClient catalogos={catalogos} etiquetas={etiquetas} usoEtiquetas={usoEtiquetas} />;
}
