import { exigirPagina } from '@/lib/auth/guard';
import { getTarifario, tarifarioDisponible } from '@/lib/db/tarifario';
import { resumenPorEmpresa } from '@/lib/tarifario/resumen';
import { TarifarioClient } from '@/components/tarifario/tarifario-client';

export const dynamic = 'force-dynamic';

/** Tarifario MAESTRO: una fila por empresa (NIT) con semáforo; "Ver todas" recupera el listado plano. Ver: 'ver'; editar: 'catalogos'. */
export default async function TarifarioPage() {
  await exigirPagina('ver');
  const disponible = await tarifarioDisponible();
  const tarifas = disponible ? await getTarifario() : [];
  return <TarifarioClient disponible={disponible} tarifas={tarifas} empresas={resumenPorEmpresa(tarifas)} />;
}
