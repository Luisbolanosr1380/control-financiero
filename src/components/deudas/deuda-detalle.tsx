import Link from 'next/link';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import type { Deuda } from '@/lib/db/deudas';

interface Props {
  deuda: Deuda;
}

function formatFecha(s: string): string {
  if (!s || s === 'SIN-FECHA') return '—';
  const d = s.slice(0, 10);
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return s;
  return `${day}/${m}/${y}`;
}

export function DeudaDetalle({ deuda: d }: Props) {
  const pctAvance = Math.max(0, Math.min(100, d.pctAvance));
  const enMora = d.diasEnMora > 0;
  const proxima = !enMora && d.diasAVencer >= 0 && d.diasAVencer <= 30;

  return (
    <div className="page">
      {/* 1. HEADER */}
      <div className="page-header">
        <div>
          <div style={{ marginBottom: 6 }}>
            <Link href="/deudas" className="btn btn-ghost" style={{ padding: '3px 8px' }}>
              <I.ChevLeft size={13} /> Volver a Deudas
            </Link>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 className="page-title" style={{ fontSize: 24 }}>
              {d.esParteRelacionada && <span style={{ marginRight: 8 }} title="Parte relacionada (socio)">🤝</span>}
              {d.acreedorNombre}
            </h1>
            <span className="badge badge-outline">{d.tipoDocumento || 'Sin tipo'}</span>
            {d.tipoAcreedor && <span className="badge badge-mute">{d.tipoAcreedor}</span>}
            {enMora && <span className="badge badge-wine">+{d.diasEnMora}d en mora</span>}
            {proxima && <span className="badge badge-warn">Vence en {d.diasAVencer}d</span>}
            {!enMora && !proxima && d.diasAVencer > 30 && <span className="badge badge-olive">Vigente</span>}
          </div>
          <div className="page-subtitle" style={{ marginTop: 6 }}>
            {d.nombreDeuda || '—'} · Centro: {d.centroCostoNombre || '—'} · Moneda: {d.moneda || '—'}
          </div>
        </div>
      </div>

      {/* 2. TARJETAS CON DATOS CLAVE */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 22 }}>
        <div className="kpi">
          <div className="kpi-label">Saldo pendiente</div>
          <div className="kpi-value">
            <span className="currency">Q</span>{Math.round(d.saldoPendiente).toLocaleString('en-US')}
          </div>
          <div className="kpi-delta">
            <span className="vs">de Q{Math.round(d.montoOriginal).toLocaleString('en-US')} original</span>
          </div>
          {/* Barra de progreso = %_Avance */}
          <div style={{ marginTop: 8, height: 6, background: 'var(--line-3)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              width: `${pctAvance}%`, height: '100%',
              background: pctAvance >= 75 ? 'var(--olive)' : 'var(--burnt)',
              transition: 'width 0.3s',
            }} />
          </div>
          <div style={{ marginTop: 4, fontSize: 10.5, color: 'var(--ink-4)', textAlign: 'right' }}>
            {pctAvance.toFixed(0)}% pagado
          </div>
        </div>

        <div className="kpi">
          <div className="kpi-label">{enMora ? 'Días en mora' : 'Días a vencer'}</div>
          <div className="kpi-value" style={{ color: enMora ? 'var(--wine)' : d.diasAVencer <= 7 ? 'var(--burnt)' : 'var(--ink)' }}>
            {enMora ? `+${d.diasEnMora}` : Math.max(0, d.diasAVencer)}
          </div>
          <div className="kpi-delta">
            <I.Clock size={11} /> <span className="vs">Vence {formatFecha(d.fechaVencimientoReal || d.fechaVencimiento)}</span>
          </div>
        </div>

        <div className="kpi">
          <div className="kpi-label">Tasa de interés</div>
          <div className="kpi-value">
            {d.tasaInteres > 0 ? `${(d.tasaInteres * 100).toFixed(2)}%` : '—'}
          </div>
          <div className="kpi-delta">
            <span className="vs">{d.moraAcumulada > 0 ? `Mora acumulada Q${Math.round(d.moraAcumulada).toLocaleString('en-US')}` : 'Sin mora acumulada'}</span>
          </div>
        </div>

        <div className="kpi">
          <div className="kpi-label">Total pagado</div>
          <div className="kpi-value">
            <span className="currency">Q</span>{Math.round(d.totalPagado).toLocaleString('en-US')}
          </div>
          <div className="kpi-delta">
            <span className="vs">{d.numPagos} pago{d.numPagos === 1 ? '' : 's'} a la fecha</span>
          </div>
        </div>
      </div>

      {/* 3. DATOS DE LA DEUDA */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-head"><div className="card-title">Datos de la deuda</div></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0 }}>
          <Dato label="Clave" value={d.claveDeuda || '—'} />
          <Dato label="Tipo de documento" value={d.tipoDocumento || '—'} />
          <Dato label="Estado" value={d.estado || '—'} />
          <Dato label="Fecha de emisión" value={formatFecha(d.fechaEmision)} />
          <Dato label="Fecha de vencimiento" value={formatFecha(d.fechaVencimiento)} />
          <Dato label="Vencimiento real" value={formatFecha(d.fechaVencimientoReal)} />
          <Dato label="Moneda" value={d.moneda || '—'} />
          <Dato label="Monto original" value={d.moneda === 'GTQ' ? Q(d.montoOriginal) : `${d.moneda} ${d.montoOriginal.toLocaleString('en-US')}`} />
          <Dato label="Monto en GTQ" value={Q(d.montoGTQ)} />
          <Dato label="Centro de costo" value={d.centroCostoNombre || '—'} />
          <Dato label="Acreedor" value={d.acreedorNombre || '—'} extra={d.esParteRelacionada ? '🤝 Parte relacionada' : 'Externa'} />
          <Dato label="Semáforo" value={d.semaforoVencimiento || '—'} />
        </div>
      </div>

      {/* 4. NOTAS */}
      {d.notas && (
        <div className="card" style={{ marginBottom: 22 }}>
          <div className="card-head"><div className="card-title">Notas</div></div>
          <div className="card-pad" style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>
            {d.notas}
          </div>
        </div>
      )}

      {/* 5. AVISO REGISTRO DE PAGOS */}
      <div className="card" style={{ background: 'var(--paper-2)', marginBottom: 22 }}>
        <div className="card-pad" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
          <I.Info size={14} style={{ color: 'var(--ink-3)', flexShrink: 0, marginTop: 2 }} />
          <div>
            Esta pantalla muestra la deuda en modo solo lectura. El <strong>registro de pagos</strong> contra esta deuda (con asiento Banco/CxP automático) se habilita en la próxima fase del módulo.
          </div>
        </div>
      </div>
    </div>
  );
}

function Dato({ label, value, extra }: { label: string; value: string; extra?: string }) {
  return (
    <div style={{ padding: '12px 18px', borderRight: '1px solid var(--line-3)', borderBottom: '1px solid var(--line-3)' }}>
      <div style={{ fontSize: 10.5, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: 'var(--ink)' }}>{value}</div>
      {extra && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{extra}</div>}
    </div>
  );
}
