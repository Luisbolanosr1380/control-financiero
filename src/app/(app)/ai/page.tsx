import { getUltimoAnalisis, getHistorialAnalisis, getCostoAcumulado } from '@/lib/db/ai-analisis';
import { AiInsightsClient } from '@/components/ai/insights-client';

export const dynamic = 'force-dynamic';

export default async function AiInsightsPage() {
  const [ultimo, historial, costo] = await Promise.all([
    getUltimoAnalisis(),
    getHistorialAnalisis(20),
    getCostoAcumulado(),
  ]);
  return <AiInsightsClient ultimo={ultimo} historial={historial} costo={costo} />;
}
