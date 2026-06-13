import { parseMesParam } from '@/lib/utils/mes-activo';
import { calcularDepreciacionMes } from '@/lib/contabilidad/depreciacion';
import { DepreciacionClient } from '@/components/reportes/depreciacion-client';

export const revalidate = 60;

export default async function DepreciacionPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes: mesRaw } = await searchParams;
  const periodo = parseMesParam(mesRaw);

  const dep = await calcularDepreciacionMes({ periodo });

  return <DepreciacionClient key={periodo} dep={dep} periodo={periodo} />;
}
