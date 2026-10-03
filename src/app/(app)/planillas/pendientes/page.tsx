import { exigirPagina } from '@/lib/auth/guard';
import { getPagosPendientes, getKPIsPagosPendientes } from '@/lib/db/planillas';
import { getBancosActivos } from '@/lib/db/bancos';
import { PendientesClient } from '@/components/planillas/pendientes-client';

export const revalidate = 30;

export default async function PlanillasPendientesPage() {
  // F-GESTION-USUARIOS: pantalla completa gateada por rol (las actions revalidan igual).
  await exigirPagina('planilla');
  const [pendientes, kpis, bancos] = await Promise.all([
    getPagosPendientes(),
    getKPIsPagosPendientes(),
    getBancosActivos(),
  ]);
  const bancosUI = bancos.map(b => ({ id: b.id, nombre: b.nombreCuenta || b.banco || b.id }));
  return <PendientesClient pendientes={pendientes} kpis={kpis} bancos={bancosUI} />;
}
