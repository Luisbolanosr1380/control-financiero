import Link from 'next/link';
import { getAcreedores, getDeudas, clasificarPasivo, type CategoriaPasivo } from '@/lib/db/deudas';
import { getPagosPorAcreedor } from '@/lib/db/pagos-deudas';
import { AcreedorDetalle } from '@/components/deudas/acreedor-detalle';
import { I } from '@/components/common/icons';

export const revalidate = 60;

export default async function AcreedorDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [acreedores, deudas, pagos] = await Promise.all([
    getAcreedores(),
    getDeudas({ acreedorId: id }),
    getPagosPorAcreedor(id),
  ]);
  const acreedor = acreedores.find(a => a.id === id) ?? null;

  if (!acreedor) {
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <Link href="/deudas" className="btn btn-ghost" style={{ padding: '3px 8px', marginBottom: 6 }}>
              <I.ChevLeft size={13} /> Volver a Deudas
            </Link>
            <h1 className="page-title">Acreedor no encontrado</h1>
            <div className="page-subtitle">El registro <span className="num">{id}</span> no existe o fue eliminado.</div>
          </div>
        </div>
      </div>
    );
  }

  const categoria: CategoriaPasivo = clasificarPasivo(acreedor.tipoAcreedor, acreedor.esParteRelacionada);

  return <AcreedorDetalle acreedor={acreedor} categoria={categoria} deudas={deudas} pagos={pagos} />;
}
