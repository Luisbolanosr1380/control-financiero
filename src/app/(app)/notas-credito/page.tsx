import { getNotasCredito, getKPIsNotasCredito } from '@/lib/db/notas-credito';
import { getSesion } from '@/lib/auth/guard';
import { NotasCreditoClient, type FiltroEstadoNC } from '@/components/notas-credito/notas-credito-client';

export const revalidate = 30;

const FILTROS_VALIDOS: readonly FiltroEstadoNC[] = ['todas', 'activas', 'pendientes', 'anuladas'];

export default async function NotasCreditoPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const { estado } = await searchParams;
  const initialTab: FiltroEstadoNC = FILTROS_VALIDOS.includes(estado as FiltroEstadoNC)
    ? (estado as FiltroEstadoNC)
    : 'todas';

  const { email, rol } = await getSesion();

  const [notas, kpis] = await Promise.all([
    getNotasCredito(),
    getKPIsNotasCredito(),
  ]);

  return (
    <NotasCreditoClient
      notas={notas}
      kpis={kpis}
      esAdmin={rol === 'admin'}
      initialTab={initialTab}
    />
  );
}
