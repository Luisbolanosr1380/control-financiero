import Link from 'next/link';
import { getFactura } from '@/lib/db/facturas';
import { getClientes } from '@/lib/db/clientes';
import { getBancosActivos } from '@/lib/db/bancos';
import { FacturaDetalle } from '@/components/facturas/factura-detalle';
import { I } from '@/components/common/icons';

export const revalidate = 30;

export default async function FacturaDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [factura, clientes, bancos] = await Promise.all([getFactura(id), getClientes(), getBancosActivos()]);

  if (!factura) {
    return (
      <div className="page">
        <div className="card" style={{ marginTop: 40 }}>
          <div className="card-pad" style={{ textAlign: 'center', padding: 48, color: 'var(--ink-4)' }}>
            <I.Receipt size={28} style={{ opacity: 0.4, marginBottom: 10 }} />
            <div style={{ fontSize: 14, color: 'var(--ink-2)', marginBottom: 4 }}>Factura no encontrada</div>
            <div style={{ fontSize: 12.5, marginBottom: 16 }}>No existe una factura con ese identificador.</div>
            <Link href="/facturacion" className="btn btn-secondary"><I.ChevLeft size={13} /> Volver al listado</Link>
          </div>
        </div>
      </div>
    );
  }

  const cliente = clientes.find(c => c.id === factura.custId);
  return <FacturaDetalle factura={factura} clienteNombre={cliente?.name ?? factura.custId ?? '—'} bancos={bancos} />;
}
