import { exigirPagina } from '@/lib/auth/guard';
import { getTarifario, tarifarioDisponible } from '@/lib/db/tarifario';
import { TarifarioClient } from '@/components/tarifario/tarifario-client';

export const dynamic = 'force-dynamic';

/** Tarifario: precios sin IVA por cliente (NIT) × tipo de prueba × categoría × territorio. Ver: 'ver'; editar: 'catalogos'. */
export default async function TarifarioPage() {
  await exigirPagina('ver');
  const disponible = await tarifarioDisponible();
  const tarifas = disponible ? await getTarifario() : [];
  return <TarifarioClient disponible={disponible} tarifas={tarifas} />;
}
