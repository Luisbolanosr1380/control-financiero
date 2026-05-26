import Link from 'next/link';
import { I } from '@/components/common/icons';
import { Q, formatDate } from '@/lib/utils';
import { LINES } from '@/lib/mock-data';
import { AdjuntoViewer } from '@/components/facturas/adjunto-viewer';
import { AnularFacturaButton } from '@/components/facturas/anular-factura-button';
import type { Invoice, InvoiceStatus } from '@/lib/types';

const STATUS_BADGE: Record<InvoiceStatus, { cls: string; text: string }> = {
  vencido:       { cls: 'badge-wine',    text: 'Vencida' },
  por_cobrar:    { cls: 'badge-outline', text: 'Por cobrar' },
  cobrado:       { cls: 'badge-olive',   text: 'Cobrada' },
  anulado:       { cls: 'badge-mute',    text: 'Anulada' },
  pendiente:     { cls: 'badge-mute',    text: 'Pendiente' },
  emitida:       { cls: 'badge-outline', text: 'Emitida' },
  contabilizado: { cls: 'badge-outline', text: 'Contabilizada' },
};

interface Props {
  factura: Invoice;
  clienteNombre: string;
}

export function FacturaDetalle({ factura: inv, clienteNombre }: Props) {
  const badge = STATUS_BADGE[inv.status] ?? { cls: 'badge-mute', text: inv.status };

  const sumIva = inv.lineas.reduce((s, l) => s + (l.iva ?? 0), 0);
  const sumTotal = inv.lineas.reduce((s, l) => s + l.amount, 0);
  const sumSub = sumTotal - sumIva;

  const pctCobrado = inv.total > 0 ? Math.round((1 - inv.balance / inv.total) * 100) : 0;

  return (
    <div className="page">
      {/* 1. CABECERA */}
      <div className="page-header">
        <div>
          <div style={{ marginBottom: 6 }}>
            <Link href="/facturacion" className="btn btn-ghost" style={{ padding: '3px 8px' }}>
              <I.ChevLeft size={13} /> Volver al listado
            </Link>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 className="page-title num" style={{ fontSize: 26, letterSpacing: '-0.01em' }}>{inv.noFactura}</h1>
            <span className={'badge ' + badge.cls} style={{ fontSize: 11.5, padding: '3px 10px' }}>{badge.text}</span>
            {inv.isMixed ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--ink-3)' }}>
                {inv.lineas.map((l, i) => <span key={i} className={'dot ' + LINES[l.line].dot} title={LINES[l.line].name}></span>)}
                <span style={{ marginLeft: 4, fontStyle: 'italic' }}>{inv.lineas.length} líneas</span>
              </span>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-3)' }}>
                <span className={'dot ' + LINES[inv.line].dot}></span>{LINES[inv.line].name}
              </span>
            )}
          </div>
          <div className="page-subtitle" style={{ marginTop: 6 }}>
            {clienteNombre} · Emitida {formatDate(inv.fechaEmision)} · Vence {formatDate(inv.fechaVencimiento)}
          </div>
        </div>
        <div className="page-actions">
          <AnularFacturaButton noFactura={inv.noFactura} status={inv.status} />
          <button className="btn btn-primary" disabled title="Próximamente"><I.Coins size={13} /> Registrar cobro</button>
        </div>
      </div>

      {/* 2. RESUMEN DE COBRANZA */}
      <div className="kpi-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr', marginBottom: 22 }}>
        <div className="kpi">
          <div className="kpi-label">Total facturado</div>
          <div className="kpi-value"><span className="currency">Q</span>{Math.round(inv.total).toLocaleString('en-US')}</div>
          <div className="kpi-delta"><span className="vs">IVA incluido · 12%</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Saldo pendiente</div>
          <div className="kpi-value" style={{ color: inv.balance > 0 ? 'var(--wine)' : 'var(--olive)' }}>
            <span className="currency">Q</span>{Math.round(inv.balance).toLocaleString('en-US')}
          </div>
          <div className="kpi-delta"><span className="vs">{inv.balance <= 0 ? 'Pagada completa' : `${pctCobrado}% cobrado`}</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Días vencidos</div>
          <div className="kpi-value" style={{ color: inv.dueAgo > 0 ? 'var(--wine)' : 'var(--ink)' }}>
            {inv.dueAgo > 0 ? inv.dueAgo : 0}
          </div>
          <div className="kpi-delta" style={{ color: inv.dueAgo > 0 ? 'var(--wine)' : 'var(--ink-3)' }}>
            <I.Clock size={11} /> {inv.dueAgo > 0 ? `Vencida hace ${inv.dueAgo} d` : `Vence en ${Math.abs(inv.dueAgo)} d`}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Estado</div>
          <div style={{ marginTop: 6 }}><span className={'badge ' + badge.cls} style={{ fontSize: 12, padding: '4px 12px' }}>{badge.text}</span></div>
        </div>
      </div>

      {/* 3. LÍNEAS */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-head">
          <div className="card-title">Líneas por centro de costo</div>
          <div className="card-actions">
            <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{inv.lineas.length} línea(s) · misma NO.FACTURA</span>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Centro de costo</th>
              <th className="num">Subtotal</th>
              <th className="num">IVA</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {inv.lineas.map((l, i) => {
              const iva = l.iva ?? 0;
              const sub = l.amount - iva;
              return (
                <tr key={i}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <span className={'dot ' + LINES[l.line].dot}></span>{LINES[l.line].name}
                    </span>
                  </td>
                  <td className="num">{Q(sub)}</td>
                  <td className="num">{Q(iva)}</td>
                  <td className="num cell-strong">{Q(l.amount)}</td>
                </tr>
              );
            })}
            <tr style={{ background: 'var(--bg-2)' }}>
              <td className="num" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>Subtotal</td>
              <td className="num cell-strong">{Q(sumSub)}</td>
              <td></td><td></td>
            </tr>
            <tr style={{ background: 'var(--bg-2)' }}>
              <td className="num" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>IVA (12%)</td>
              <td></td>
              <td className="num cell-strong">{Q(sumIva)}</td>
              <td></td>
            </tr>
            <tr style={{ background: 'var(--bg-2)' }}>
              <td className="num" style={{ textAlign: 'right', color: 'var(--ink)', fontWeight: 600 }}>Total</td>
              <td></td><td></td>
              <td className="num" style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{Q(sumTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
        {/* 4. PDF ADJUNTO */}
        <div className="card">
          <div className="card-head"><div className="card-title">Documento adjunto</div></div>
          <div className="card-pad">
            {inv.adjuntoUrl ? (
              <AdjuntoViewer url={inv.adjuntoUrl} nombre={inv.adjuntoNombre} />
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--ink-4)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <I.Paperclip size={14} style={{ opacity: 0.5 }} /> Sin documento adjunto
              </div>
            )}
          </div>
        </div>

        {/* 5. ASIENTO CONTABLE */}
        <div className="card">
          <div className="card-head"><div className="card-title">Asiento contable</div></div>
          <div className="card-pad">
            {inv.asientoRef ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <I.Journal size={16} style={{ color: 'var(--ink-3)' }} />
                  <span className="num" style={{ fontSize: 13, color: 'var(--ink) ' }}>{inv.asientoRef}</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 8 }}>
                  {/* TODO: leer partidas debe/haber de ASIENTOS/PARTIDAS y mostrarlas */}
                  Detalle de partidas (debe/haber) pendiente — próxima capa.
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--ink-4)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <I.Journal size={14} style={{ opacity: 0.5 }} /> Sin asiento generado
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
