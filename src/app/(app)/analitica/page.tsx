import { getAnaliticaIngresos } from '@/lib/db/analitica';
import { AnaliticaClient } from '@/components/analitica/analitica-client';

export const dynamic = 'force-dynamic';

export default async function AnaliticaPage() {
  const data = await getAnaliticaIngresos();
  return <AnaliticaClient data={data} />;
}
