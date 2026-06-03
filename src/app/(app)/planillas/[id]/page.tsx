import Link from 'next/link';
import { getPeriodoPorId } from '@/lib/db/planillas';
import { getEmpleados } from '@/lib/db/empleados';
import { getBancosActivos } from '@/lib/db/bancos';
import { PlanillaDetalleClient } from '@/components/planillas/planilla-detalle-client';
import { I } from '@/components/common/icons';

export const revalidate = 30;

export default async function PlanillaDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const datos = await getPeriodoPorId(id);

  if (!datos) {
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <Link href="/planillas" className="btn btn-ghost" style={{ padding: '3px 8px', marginBottom: 6 }}>
              <I.ChevLeft size={13} /> Volver a planillas
            </Link>
            <h1 className="page-title">Planilla no encontrada</h1>
            <div className="page-subtitle">El período <span className="num">{id}</span> no existe o fue eliminado.</div>
          </div>
        </div>
      </div>
    );
  }

  // IGSS patronal estimado: salarioBase × 0.1267 / 2 por cada empleado activo del período.
  // Se calcula desde los empleados (no desde las líneas) porque la cuota patronal NO se
  // descuenta del neto del trabajador y por lo tanto no se almacena en PLANILLA.
  const empleados = await getEmpleados({ status: 'ACTIVO' });
  const empleadoSalarioById = new Map(empleados.map(e => [e.id, e.salarioBase]));
  const igssPatronalEstimado = Math.round(
    datos.lineas.reduce((s, l) => {
      const base = empleadoSalarioById.get(l.empleadoId) ?? 0;
      return s + (base * 0.1267) / 2;
    }, 0) * 100,
  ) / 100;

  const bancos = await getBancosActivos();
  const bancoOptions = bancos.map(b => ({
    id: b.id,
    nombre: b.nombreCuenta || b.banco || b.numeroCuenta,
  }));

  return (
    <PlanillaDetalleClient
      periodo={datos.periodo}
      lineas={datos.lineas}
      igssPatronalEstimado={igssPatronalEstimado}
      bancos={bancoOptions}
    />
  );
}
