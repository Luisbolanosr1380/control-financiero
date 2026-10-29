import Link from 'next/link';
import { Q } from '@/lib/utils';
import { ETIQUETA_WRITEBACK } from '@/lib/facturacion-agenda/tipos';
import type { ProcesosDeFactura } from '@/lib/db/facturacion-agenda';
import { ReintentarWritebackButton } from './reintentar-writeback-button';

/**
 * Detalle de factura · "qué procesos de la Agenda cubre": un renglón por servicio
 * (un COMPLETO = polígrafo + socio) con su monto sin IVA y el estado del write-back.
 * Server component (sin estado); el botón de reintento es cliente.
 */
export function ProcesosAgendaSection({ noFactura, procesos, nombresCC = {} }: { noFactura: string; procesos: ProcesosDeFactura; nombresCC?: Record<string, string> }) {
  const wb = procesos.writeback;
  const pendientes = wb.pendientes + wb.conflictos + wb.errores;
  const nit = procesos.expedientes.find(e => e.nitResuelto)?.nitResuelto ?? null;
  return (
    <div className="card" style={{ marginBottom: 22 }} data-seccion="procesos-agenda">
      <div className="card-head">
        <div className="card-title">Procesos de la Agenda que cubre esta factura</div>
        <div className="card-actions" style={{ gap: 8 }}>
          {wb.confirmados > 0 && <span className="badge badge-olive" style={{ fontSize: 10 }}>{wb.confirmados} confirmado{wb.confirmados === 1 ? '' : 's'} en Agenda</span>}
          {wb.omitidos > 0 && <span className="badge badge-mute" style={{ fontSize: 10 }} title={ETIQUETA_WRITEBACK.omitido}>{wb.omitidos} sin enviar</span>}
          {wb.pendientes > 0 && <span className="badge badge-warn" style={{ fontSize: 10 }} title={ETIQUETA_WRITEBACK.pendiente}>{wb.pendientes} falta confirmar</span>}
          {wb.conflictos > 0 && <span className="badge badge-wine" style={{ fontSize: 10 }} title={ETIQUETA_WRITEBACK.conflicto}>{wb.conflictos} conflicto{wb.conflictos === 1 ? '' : 's'}</span>}
          {wb.errores > 0 && <span className="badge badge-wine" style={{ fontSize: 10 }} title={ETIQUETA_WRITEBACK.error}>{wb.errores} error{wb.errores === 1 ? '' : 'es'}</span>}
          {procesos.detalleFacturacion && <a className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 8px' }} href={`/imprimir/detalle/${procesos.detalleFacturacion.id}`} target="_blank" rel="noopener" title={`Pre-liquidación ${procesos.detalleFacturacion.correlativo}${procesos.detalleFacturacion.aprobadoPor ? ` · aprobada por ${procesos.detalleFacturacion.aprobadoPor}` : ''}`} data-accion="imprimir-detalle">Imprimir detalle</a>}
          {pendientes > 0 && <ReintentarWritebackButton noFactura={noFactura} compacto />}
          {nit && <Link href={`/por-facturar/${encodeURIComponent('n-' + nit)}`} style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Ver cliente en Por facturar →</Link>}
        </div>
      </div>
      <table className="table">
        <thead><tr><th>Persona</th><th>Expediente</th><th>Servicio</th><th>Categoría</th><th>Territorio</th><th>Centro de costo</th><th className="num">Monto sin IVA</th></tr></thead>
        <tbody>
          {procesos.detalle.map(d => {
            const e = procesos.expedientes.find(x => x.idExterno === d.idExterno);
            return (
              <tr key={d.id}>
                <td>{d.persona || e?.persona || '—'}</td>
                <td className="num cell-mute" style={{ fontSize: 11 }}>{d.idExterno}</td>
                <td>{d.tipoPrueba || '—'}</td>
                <td>{d.categoria || '—'}</td>
                <td>{d.territorio || '—'}</td>
                <td className="cell-mute" style={{ fontSize: 12 }}>{d.centroNombre || (d.centroCostoId ? nombresCC[d.centroCostoId] : '') || '—'}</td>
                <td className="num">{Q(d.monto)}</td>
              </tr>
            );
          })}
          <tr style={{ background: 'var(--bg-2)' }}><td colSpan={6} className="num" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>Subtotal sin IVA ({procesos.detalle.length} servicio{procesos.detalle.length === 1 ? '' : 's'} · {procesos.expedientes.length} expediente{procesos.expedientes.length === 1 ? '' : 's'})</td><td className="num cell-strong">{Q(procesos.subtotal)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
