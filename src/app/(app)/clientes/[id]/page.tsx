import Link from 'next/link';
import { getAnalisisClientes } from '@/lib/db/clientes-analisis';
import { getFacturas } from '@/lib/db/facturas';
import { getCliente } from '@/lib/db/clientes';
import { ClienteDetalleClient } from '@/components/clientes/detalle-client';
import { NombresClienteCard } from '@/components/clientes/nombres-cliente-card';
import { I } from '@/components/common/icons';

export const revalidate = 120;

export default async function ClienteDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [analisisLista, facturas, cliente] = await Promise.all([
    getAnalisisClientes(),
    getFacturas({ custId: id }),
    getCliente(id).catch(() => null),
  ]);
  const analisis = analisisLista.find(c => c.custId === id);

  if (!analisis) {
    return (
      <div className="page">
        {cliente && (
          <div className="page-header">
            <div>
              <div style={{ marginBottom: 6 }}><Link href="/clientes" className="btn btn-ghost" style={{ padding: '3px 8px' }}><I.ChevLeft size={13} /> Volver a clientes</Link></div>
              <h1 className="page-title" style={{ fontSize: 26 }}>{cliente.name}</h1>
              {cliente.nit && <div className="page-subtitle num" style={{ marginTop: 6 }}>NIT {cliente.nit}</div>}
            </div>
          </div>
        )}
        {/* 020: los nombres se editan aunque el cliente no tenga actividad reciente (un cliente nuevo de la Agenda, por ejemplo). */}
        {cliente && <NombresClienteCard cliente={cliente} />}
        <div className="card" style={{ marginTop: cliente ? 0 : 40 }}>
          <div className="card-pad" style={{ textAlign: 'center', padding: 48, color: 'var(--ink-4)' }}>
            <I.Users size={28} style={{ opacity: 0.4, marginBottom: 10 }} />
            <div style={{ fontSize: 14, color: 'var(--ink-2)', marginBottom: 4 }}>{cliente ? 'Sin actividad reciente' : 'Cliente sin actividad reciente'}</div>
            <div style={{ fontSize: 12.5, marginBottom: 16 }}>No tiene facturas en los últimos 12 meses para analizar.</div>
            {!cliente && <Link href="/clientes" className="btn btn-secondary"><I.ChevLeft size={13} /> Volver a clientes</Link>}
          </div>
        </div>
      </div>
    );
  }

  return <ClienteDetalleClient analisis={analisis} facturas={facturas} cliente={cliente} />;
}
