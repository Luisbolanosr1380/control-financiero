import Link from 'next/link';
import { getEmpleadoPorId } from '@/lib/db/empleados';
import { getDeudas } from '@/lib/db/deudas';
import { getCentrosCostoActivos } from '@/lib/db/centros';
import { EmpleadoDetalle } from '@/components/empleados/empleado-detalle';
import { I } from '@/components/common/icons';

export const revalidate = 30;

export default async function EmpleadoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const empleado = await getEmpleadoPorId(id);

  if (!empleado) {
    return (
      <div className="page">
        <div className="card" style={{ marginTop: 40 }}>
          <div className="card-pad" style={{ textAlign: 'center', padding: 48, color: 'var(--ink-4)' }}>
            <I.Users size={28} style={{ opacity: 0.4, marginBottom: 10 }} />
            <div style={{ fontSize: 14, color: 'var(--ink-2)', marginBottom: 4 }}>Empleado no encontrado</div>
            <Link href="/empleados" className="btn btn-secondary"><I.ChevLeft size={13} /> Volver a Empleados</Link>
          </div>
        </div>
      </div>
    );
  }

  const [deudas, centros] = await Promise.all([getDeudas(), getCentrosCostoActivos()]);
  const deudasSalariales = deudas
    .filter(d => d.acreedorId === empleado.acreedorVinculadoId && d.tipoDocumento === 'Salario Pendiente')
    .sort((a, b) => (b.fechaEmision || '').localeCompare(a.fechaEmision || ''));
  const centrosUI = centros.map(c => ({ id: c.id, nombre: c.nombre }));
  // Vacío: el modal de Editar tiene datalist para departamento — sin sugerencias
  // si el usuario edita desde el detalle. Una mejora futura llenaría esto.
  const departamentos: string[] = [];

  return (
    <EmpleadoDetalle
      empleado={empleado}
      deudasSalariales={deudasSalariales}
      centros={centrosUI}
      departamentos={departamentos}
    />
  );
}
