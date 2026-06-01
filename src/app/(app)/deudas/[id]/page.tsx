import Link from 'next/link';
import { getDeudaPorId, getAcreedores } from '@/lib/db/deudas';
import { getCentrosCostoActivos } from '@/lib/db/centros';
import { getPagosPorDeuda, getCuentasBancoParaPago } from '@/lib/db/pagos-deudas';
import { DeudaDetalle } from '@/components/deudas/deuda-detalle';
import { I } from '@/components/common/icons';

export const revalidate = 30;

export default async function DeudaDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [deuda, pagos, cuentasBanco, acreedores, centros] = await Promise.all([
    getDeudaPorId(id),
    getPagosPorDeuda(id),
    getCuentasBancoParaPago(),
    getAcreedores(),
    getCentrosCostoActivos(),
  ]);

  if (!deuda) {
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <Link href="/deudas" className="btn btn-ghost" style={{ padding: '3px 8px', marginBottom: 6 }}>
              <I.ChevLeft size={13} /> Volver a Deudas
            </Link>
            <h1 className="page-title">Deuda no encontrada</h1>
            <div className="page-subtitle">El registro <span className="num">{id}</span> no existe o fue eliminado.</div>
          </div>
        </div>
      </div>
    );
  }

  const centrosUI = centros.map(c => ({ id: c.id, nombre: c.nombre }));
  return <DeudaDetalle deuda={deuda} pagos={pagos} cuentasBanco={cuentasBanco} acreedores={acreedores} centros={centrosUI} />;
}
