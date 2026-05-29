import { getAnaliticaIngresosVariantes } from '@/lib/db/analitica';
import { AnaliticaClient } from '@/components/analitica/analitica-client';

export const revalidate = 300;

export default async function AnaliticaPage() {
  const variantes = await getAnaliticaIngresosVariantes();
  return <AnaliticaClient variantes={variantes} />;
}
