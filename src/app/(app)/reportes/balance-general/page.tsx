import { parseMesParam } from '@/lib/utils/mes-activo';
import { generarBalanceGeneral } from '@/lib/contabilidad/balance-general';
import { getCentrosCostoActivos } from '@/lib/db/centros';
import { BalanceGeneralClient } from '@/components/reportes/balance-general-client';

export const revalidate = 60;

export default async function BalanceGeneralPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; cc?: string; tab?: string }>;
}) {
  const { mes: mesRaw, cc: ccRaw, tab: tabRaw } = await searchParams;
  const periodoCorte = parseMesParam(mesRaw);
  const centroCostoId = ccRaw?.trim() || undefined;
  const tab: 'balance' | 'comprobacion' = tabRaw === 'comprobacion' ? 'comprobacion' : 'balance';

  const [bg, centros] = await Promise.all([
    generarBalanceGeneral({ periodoCorte, centroCostoId }),
    getCentrosCostoActivos(),
  ]);

  return (
    <BalanceGeneralClient
      key={`${periodoCorte}|${centroCostoId ?? ''}|${tab}`}
      bg={bg}
      centros={centros.map(c => ({ id: c.id, nombre: c.nombre }))}
      periodoCorte={periodoCorte}
      centroCostoActivo={centroCostoId}
      tabActiva={tab}
    />
  );
}
