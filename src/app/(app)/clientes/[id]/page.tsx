import Link from 'next/link';
import { getAnalisisClientes } from '@/lib/db/clientes-analisis';
import { getFacturas } from '@/lib/db/facturas';
import { ClienteDetalleClient } from '@/components/clientes/detalle-client';
import { I } from '@/components/common/icons';

export const dynamic = 'force-dynamic';

export default async function ClienteDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [analisisLista, facturas] = await Promise.all([
    getAnalisisClientes(),
    getFacturas({ custId: id }),
  ]);
  const analisis = analisisLista.find(c => c.custId === id);

  if (!analisis) {
    return (
      <div className="page">
        <div className="card" style={{ marginTop: 40 }}>
          <div className="card-pad" style={{ textAlign: 'center', padding: 48, color: 'var(--ink-4)' }}>
            <I.Users size={28} style={{ opacity: 0.4, marginBottom: 10 }} />
            <div style={{ fontSize: 14, color: 'var(--ink-2)', marginBottom: 4 }}>Cliente sin actividad reciente</div>
            <div style={{ fontSize: 12.5, marginBottom: 16 }}>No tiene facturas en los últimos 12 meses para analizar.</div>
            <Link href="/clientes" className="btn btn-secondary"><I.ChevLeft size={13} /> Volver a clientes</Link>
          </div>
        </div>
      </div>
    );
  }

  return <ClienteDetalleClient analisis={analisis} facturas={facturas} />;
}
