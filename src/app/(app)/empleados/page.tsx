import {
  getEmpleados,
  getKPIsPlanilla,
  getPlanillaPorCentroCosto,
  getResumenSalariosPendientesConsolidado,
} from '@/lib/db/empleados';
import { getCentrosCostoActivos } from '@/lib/db/centros';
import { EmpleadosListClient } from '@/components/empleados/empleados-list-client';

export const revalidate = 60;

export default async function EmpleadosPage() {
  const [empleados, kpis, centros, planillaPorCC, resumenPendientes] = await Promise.all([
    getEmpleados(),
    getKPIsPlanilla(),
    getCentrosCostoActivos(),
    getPlanillaPorCentroCosto(),
    getResumenSalariosPendientesConsolidado(),
  ]);
  const centrosUI = centros.map(c => ({ id: c.id, nombre: c.nombre }));
  return (
    <EmpleadosListClient
      empleados={empleados}
      kpis={kpis}
      centros={centrosUI}
      planillaPorCC={planillaPorCC}
      resumenPendientes={resumenPendientes}
    />
  );
}
