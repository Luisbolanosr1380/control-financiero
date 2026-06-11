/**
 * F-051 — Centro de Pagos & Cash-Flow Planner.
 *
 * El server component carga todo lo necesario en paralelo y delega al
 * client component para horizonte + saldo manual + modal CRUD. La
 * proyección se recalcula en el servidor cuando cambia el horizonte
 * (revalidate corto + URL searchParam).
 */

import { construirFlujo } from '@/lib/flujo/construir-flujo';
import { getSaldoInicialBancos } from '@/lib/flujo/saldo-inicial';
import { listarObligaciones } from './_actions/obligaciones';
import { FlujoClient } from '@/components/flujo/flujo-client';

export const revalidate = 60;

const HORIZONTES_VALIDOS = new Set([30, 60, 90]);

export default async function FlujoPage({
  searchParams,
}: {
  searchParams: Promise<{ horizonte?: string; saldo?: string }>;
}) {
  const { horizonte: horizonteRaw, saldo: saldoRaw } = await searchParams;
  const horizonteDias = HORIZONTES_VALIDOS.has(Number(horizonteRaw))
    ? Number(horizonteRaw)
    : 60;
  const saldoManual = saldoRaw !== undefined ? Number(saldoRaw) : undefined;

  const [bancosSaldo, obligaciones] = await Promise.all([
    getSaldoInicialBancos(),
    listarObligaciones(),
  ]);

  const saldoSugerido = bancosSaldo?.totalQ ?? 0;
  const saldoInicial = Number.isFinite(saldoManual) ? Number(saldoManual) : saldoSugerido;
  const proyeccion = await construirFlujo({ horizonteDias, saldoInicial });

  return (
    <FlujoClient
      proyeccion={proyeccion}
      obligaciones={obligaciones}
      saldoSugerido={saldoSugerido}
      saldoSugeridoCuentas={bancosSaldo?.cuentas ?? 0}
    />
  );
}
