import Link from 'next/link';
import { I } from '@/components/common/icons';
import { Q, formatDate } from '@/lib/utils';
import { formatearFecha } from '@/lib/utils/fechas';
import { LINES } from '@/lib/mock-data';
import { AdjuntoViewer } from '@/components/facturas/adjunto-viewer';
import { AnularFacturaButton } from '@/components/facturas/anular-factura-button';
import { EditarFacturaButton } from '@/components/facturas/editar-factura-button';
import { EmitirNCButton } from '@/components/facturas/emitir-nc-button';
import { NotasCreditoSection } from '@/components/facturas/notas-credito-section';
import { RegistrarCobroButton } from '@/components/facturas/registrar-cobro-button';
import { AnularCobroButton } from '@/components/facturas/anular-cobro-button';
import { HelpButton } from '@/components/ayuda/help-button';
import type { Banco } from '@/lib/db/bancos';
import type { GrupoCobro } from '@/lib/db/cobros';
import type { NotaCredito } from '@/lib/db/notas-credito';
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
  bancos: Banco[];
  saldoPendiente: number;   // F-035: viene del server (real, no del balance consolidado)
  cobros: GrupoCobro[];     // F-035: historial agrupado de cobros
  notasCredito: NotaCredito[];   // F-045
  esAdmin: boolean;              // F-045: solo admin aprueba NCs > Q5K
}

const formatFechaShort = (s: string): string =>
  !s ? '—' : formatearFecha(s, 'dd/MM/yyyy');

/** Agrupa componentes del mismo grupo cuando se generaron N records por multi-línea
 *  pero todos comparten método+referencia. Suma sus montos para presentación limpia. */
function dedupeComponentes(g: GrupoCobro): { metodo: string; bancoNombre: string | null; referencia: string; monto: number; constanciaUrl?: string; constanciaNombre?: string }[] {
  const buckets = new Map<string, { metodo: string; bancoNombre: string | null; referencia: string; monto: number; constanciaUrl?: string; constanciaNombre?: string }>();
  for (const c of g.componentes) {
    const key = `${c.metodo}|${c.bancoId ?? ''}|${c.referencia}`;
    const b = buckets.get(key);
    if (b) {
      b.monto += c.monto;
      if (!b.constanciaUrl && c.constanciaUrl) {
        b.constanciaUrl = c.constanciaUrl;
        b.constanciaNombre = c.constanciaNombre;
      }
    } else {
      buckets.set(key, {
        metodo: c.metodo,
        bancoNombre: c.bancoNombre,
        referencia: c.referencia,
        monto: c.monto,
        constanciaUrl: c.constanciaUrl,
        constanciaNombre: c.constanciaNombre,
      });
    }
  }
  return [...buckets.values()];
}

export function FacturaDetalle({ factura: inv, clienteNombre, bancos, saldoPendiente, cobros, notasCredito, esAdmin }: Props) {
  const badge = STATUS_BADGE[inv.status] ?? { cls: 'badge-mute', text: inv.status };

  const sumIva = inv.lineas.reduce((s, l) => s + (l.iva ?? 0), 0);
  const sumTotal = inv.lineas.reduce((s, l) => s + l.amount, 0);
  const sumSub = sumTotal - sumIva;

  // F-035: el saldoPendiente viene del server (real, post cobros parciales).
  const pctCobrado = inv.total > 0 ? Math.round((1 - saldoPendiente / inv.total) * 100) : 0;
  // F-036: solo cobros activos cuentan hacia el subtotal de retenciones del card.
  const totalRetIVA = cobros.filter(g => g.estadoCobro === 'Activo').reduce((s, g) => s + g.totalRetencionIVA, 0);
  const totalRetISR = cobros.filter(g => g.estadoCobro === 'Activo').reduce((s, g) => s + g.totalRetencionISR, 0);

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
            {inv.fechaUltimaEdicion && (
              <span
                title={`Editada el ${formatDate(inv.fechaUltimaEdicion)}${inv.editadoPor ? ` por ${inv.editadoPor}` : ''}`}
                style={{ marginLeft: 8, fontSize: 11 }}
              >
                · ✏️ Editada
              </span>
            )}
          </div>
        </div>
        <div className="page-actions">
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            <EditarFacturaButton
              factura={inv}
              clienteNombre={clienteNombre}
              subtotal={sumSub}
              iva={sumIva}
              cobrosActivos={cobros.filter(g => g.estadoCobro === 'Activo').length}
            />
            <HelpButton tag="editar-factura" />
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            <EmitirNCButton
              facturaId={inv.id}
              facturaNumero={inv.noFactura}
              clienteNombre={clienteNombre}
              total={inv.total}
              saldoPendiente={saldoPendiente}
              estadoBruto={inv.estadoBruto}
            />
            <HelpButton tag="emitir-nc" />
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            <AnularFacturaButton noFactura={inv.noFactura} status={inv.status} />
            <HelpButton tag="anular-factura" />
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center' }}>
            <RegistrarCobroButton
              noFactura={inv.noFactura}
              total={inv.total}
              saldoPendiente={saldoPendiente}
              status={inv.status}
              estadoBruto={inv.estadoBruto === 'cobrado_parcial' ? 'COBRADO PARCIAL' : undefined}
              bancos={bancos}
            />
            <HelpButton tag="registrar-cobro" />
          </span>
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
          <div className="kpi-value" style={{ color: saldoPendiente > 0 ? 'var(--wine)' : 'var(--olive)' }}>
            <span className="currency">Q</span>{Math.round(saldoPendiente).toLocaleString('en-US')}
          </div>
          <div className="kpi-delta"><span className="vs">{saldoPendiente <= 0 ? 'Pagada completa' : `${pctCobrado}% cobrado`}</span></div>
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

      {/* F-035: Historial de cobros agrupados por evento (Cobro_Grupo_ID). */}
      {cobros.length > 0 && (
        <div className="card" style={{ marginBottom: 22 }}>
          <div className="card-head">
            <div className="card-title">Cobros registrados</div>
            <div className="card-actions">
              <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                {cobros.length} evento{cobros.length === 1 ? '' : 's'} · {totalRetIVA + totalRetISR > 0 ? `incluye retenciones (IVA Q${totalRetIVA.toFixed(2)} + ISR Q${totalRetISR.toFixed(2)})` : 'sin retenciones'}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px' }}>
            {cobros.map(g => {
              const anulado = g.estadoCobro === 'Anulado';
              return (
              <div key={g.grupoId} style={{
                border: '1px solid var(--line-2)', borderRadius: 'var(--r-2)',
                padding: '12px 14px',
                background: anulado ? '#F2EDE9' : g.tieneRetencion ? '#FBF7E6' : 'var(--paper-2)',
                opacity: anulado ? 0.65 : 1,
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                  <span className="num" style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', textDecoration: anulado ? 'line-through' : 'none' }}>
                    {formatFechaShort(g.fecha)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                    {g.grupoId.startsWith('__legacy__') ? '· cobro legado' : `· ${g.grupoId}`}
                  </span>
                  {anulado && (
                    <span
                      className="badge badge-wine"
                      style={{ fontSize: 10, padding: '1px 6px' }}
                      title={`Anulado ${formatFechaShort(g.fechaAnulacion ?? '')} por ${g.anuladoPor ?? '—'}: ${g.motivoAnulacion ?? ''}`}
                    >
                      Anulado
                    </span>
                  )}
                  <span className="num" style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 600, color: 'var(--ink)', textDecoration: anulado ? 'line-through' : 'none' }}>
                    {Q(g.totalCobrado)}
                  </span>
                  <AnularCobroButton grupo={g} saldoActual={saldoPendiente} totalFactura={inv.total} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {/* Dedupe componentes por método+ref (un componente puede haberse partido en N líneas) */}
                  {dedupeComponentes(g).map((c, i) => {
                    const ret = c.metodo === 'Retención IVA' || c.metodo === 'Retención ISR';
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-3)' }}>
                        <span style={{
                          display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                          background: ret ? '#A85C32' : 'var(--olive)',
                        }} />
                        <span>{c.metodo}</span>
                        {c.bancoNombre && <span style={{ color: 'var(--ink-4)' }}>· {c.bancoNombre}</span>}
                        {c.referencia && <span style={{ color: 'var(--ink-4)' }}>· {c.referencia}</span>}
                        {c.constanciaUrl && (
                          <a href={c.constanciaUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--olive)', textDecoration: 'underline' }}>constancia</a>
                        )}
                        <span className="num" style={{ marginLeft: 'auto', color: 'var(--ink-2)' }}>{Q(c.monto)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* F-045: Notas de Crédito vinculadas a esta factura. */}
      {notasCredito.length > 0 && (
        <NotasCreditoSection notasCredito={notasCredito} esAdmin={esAdmin} />
      )}

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
