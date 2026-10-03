import { exigirPagina } from '@/lib/auth/guard';
import { getCatalogos } from '@/lib/db/catalogos';
import { getEtiquetas, getUsoEtiquetas } from '@/lib/db/etiquetas';
import { AdminCatalogosClient } from '@/components/admin/catalogos-client';

export const dynamic = 'force-dynamic';

export default async function AdminCatalogosPage() {
  // Server guard: solo admin entra (igual que /admin/usuarios).
  // Catálogos: admin y contador (matriz F-GESTION-USUARIOS).
  await exigirPagina('catalogos');

  const [catalogos, etiquetas, usoEtiquetas] = await Promise.all([
    getCatalogos(), getEtiquetas(), getUsoEtiquetas(),
  ]);
  return <AdminCatalogosClient catalogos={catalogos} etiquetas={etiquetas} usoEtiquetas={usoEtiquetas} />;
}
