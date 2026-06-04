import { currentUser } from '@clerk/nextjs/server';
import { getNotasCredito, getKPIsNotasCredito } from '@/lib/db/notas-credito';
import { getRolUsuario } from '@/lib/auth/allowlist';
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

  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? '';
  const rol = getRolUsuario(email);

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
