import { Q } from '@/lib/utils';
import { formatearFechaCorta } from '@/lib/utils/fechas';
import type { DetalleCompleto } from '@/lib/db/detalle-facturacion';
import { ImprimirBoton } from './imprimir-boton';

/**
 * Documento imprimible (server component): encabezado del emisor y del cliente, correlativo,
 * fecha, título "Detalle de servicios / Pre-liquidación" (o "Detalle de la factura N°" cuando ya
 * se facturó), una línea por proceso, totales. Los procesos sin precio quedan abajo como "no
 * incluidos" y no suman. Estilos propios + @media print (sin shell).
 */
export function DetalleImprimible({ datos, emisor }: { datos: DetalleCompleto; emisor: { nombre: string; nit: string; direccion: string } }) {
  const { detalle: d, documento: doc } = datos;
  const facturado = d.estado === 'facturada' && d.noFactura;
  return (
    <main style={{ fontFamily: 'Georgia, "Times New Roman", serif', color: '#111', maxWidth: 820, margin: '0 auto', padding: '32px 28px', background: '#fff' }} data-imprimible>
      <style>{`
        @media print { .no-print { display: none !important; } body { margin: 0; } main { padding: 0 !important; } @page { margin: 18mm 14mm; } }
        .doc-tabla { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        .doc-tabla th { text-align: left; font-weight: 600; border-bottom: 1.5px solid #111; padding: 6px 6px; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
        .doc-tabla td { padding: 7px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
        .doc-tabla td.num, .doc-tabla th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .doc-mute { color: #666; font-size: 11px; }
      `}</style>
      <div className="no-print" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 16 }}>
        <a href={`/por-facturar/detalle/${d.id}`} style={{ fontSize: 13, color: '#444', alignSelf: 'center' }}>← Volver al detalle</a>
        <ImprimirBoton />
      </div>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 24, borderBottom: '2px solid #111', paddingBottom: 14, marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{emisor.nombre}</div>
          {emisor.nit && <div className="doc-mute">NIT {emisor.nit}</div>}
          {emisor.direccion && <div className="doc-mute">{emisor.direccion}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{facturado ? `Detalle de la factura ${d.noFactura}` : 'Detalle de servicios'}</div>
          <div className="doc-mute">{facturado ? `Pre-liquidación ${d.correlativo}` : `Pre-liquidación · ${d.correlativo}`}</div>
          <div className="doc-mute">Fecha: {formatearFechaCorta(facturado && d.facturadoEn ? d.facturadoEn : d.createdAt)}</div>
          {!facturado && <div className="doc-mute" style={{ marginTop: 4 }}>Documento previo a la factura: no es una factura ni tiene número de SAT.</div>}
        </div>
      </header>
      <section style={{ marginBottom: 18, fontSize: 13 }}>
        <div><strong>Cliente:</strong> {datos.clienteNombre}</div>
        <div><strong>NIT:</strong> {d.nit}{datos.empresaNombreExterno && datos.empresaNombreExterno !== datos.clienteNombre ? <span className="doc-mute"> · en la Agenda: {datos.empresaNombreExterno}</span> : null}</div>
        {d.aprobadaEn && <div className="doc-mute">Aprobado por {d.aprobadoPor} ({d.aprobadoCanal}) el {formatearFechaCorta(d.aprobadaEn)}</div>}
      </section>
      <table className="doc-tabla">
        <thead><tr><th>#</th><th>Persona</th><th>Ingreso</th><th>Servicio</th><th>Categoría</th><th>Territorio</th><th className="num">Monto sin IVA</th></tr></thead>
        <tbody>
          {doc.incluidas.map((l, i) => (
            <tr key={l.idExterno}>
              <td className="num">{i + 1}</td>
              <td>{l.persona}{l.puesto ? <div className="doc-mute">{l.puesto}</div> : null}</td>
              <td>{l.fechaIngreso ? formatearFechaCorta(l.fechaIngreso) : '—'}</td>
              <td>{l.servicio}{l.componentes ? <div className="doc-mute">{l.componentes}</div> : null}</td>
              <td>{l.categoria}</td><td>{l.territorio}</td>
              <td className="num">{Q(l.monto)}</td>
            </tr>
          ))}
          {doc.incluidas.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: '#666' }}>Ningún proceso con precio en este detalle.</td></tr>}
        </tbody>
        <tfoot>
          <tr><td colSpan={6} className="num" style={{ borderBottom: 'none', paddingTop: 12 }}>Subtotal sin IVA</td><td className="num" style={{ borderBottom: 'none', paddingTop: 12 }}>{Q(doc.subtotal)}</td></tr>
          <tr><td colSpan={6} className="num" style={{ borderBottom: 'none' }}>IVA 12 %</td><td className="num" style={{ borderBottom: 'none' }}>{Q(doc.iva)}</td></tr>
          <tr><td colSpan={6} className="num" style={{ borderTop: '1.5px solid #111', fontWeight: 600, fontSize: 14 }}>Total</td><td className="num" style={{ borderTop: '1.5px solid #111', fontWeight: 600, fontSize: 14 }} data-total={doc.total}>{Q(doc.total)}</td></tr>
        </tfoot>
      </table>
      {doc.faltantes.length > 0 && (
        <section style={{ marginTop: 18, fontSize: 12 }} data-faltantes>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No incluidos en este detalle ({doc.faltantes.length})</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: '#555' }}>{doc.faltantes.map(l => <li key={l.idExterno}>{l.persona} · {l.servicio} · {l.motivo}</li>)}</ul>
        </section>
      )}
      {d.notas && <section style={{ marginTop: 18, fontSize: 12.5 }}><strong>Notas:</strong> {d.notas}</section>}
      <footer className="doc-mute" style={{ marginTop: 28, borderTop: '1px solid #ddd', paddingTop: 8 }}>Montos en quetzales. Precios según el tarifario pactado con el cliente. {facturado ? '' : 'Al aprobarse este detalle se emite la factura electrónica (FEL/SAT) por el total indicado.'}</footer>
    </main>
  );
}
