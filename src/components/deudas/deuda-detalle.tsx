import Link from 'next/link';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { RegistrarPagoButton } from '@/components/deudas/registrar-pago-button';
import { EditarDeudaButton } from '@/components/deudas/editar-deuda-button';
import type { Deuda, Acreedor } from '@/lib/db/deudas';
import type { PagoDeuda } from '@/lib/db/pagos-deudas';

interface Props {
  deuda: Deuda;
  pagos: PagoDeuda[];
  cuentasBanco: string[];
  acreedores: Acreedor[];
  centros: Array<{ id: string; nombre: string }>;
}

function formatFecha(s: string): string {
  if (!s || s === 'SIN-FECHA') return '—';
  const d = s.slice(0, 10);
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return s;
  return `${day}/${m}/${y}`;
}

export function DeudaDetalle({ deuda: d, pagos, cuentasBanco, acreedores, centros }: Props) {
  const pctAvance = Math.max(0, Math.min(100, d.pctAvance));
  const enMora = d.diasEnMora > 0;
  const proxima = !enMora && d.diasAVencer >= 0 && d.diasAVencer <= 30;
  const estaLiquidada = /liquidada/i.test(d.estadoDeuda);

  return (
    <div className="page">
      {/* 1. HEADER con botón Registrar pago */}
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
        <div className="page-actions">
          <EditarDeudaButton
            deuda={d}
            acreedores={acreedores}
            centros={centros}
            numPagos={d.numPagos}
          />
          <RegistrarPagoButton
            deudaId={d.id}
            deudaNombre={d.nombreDeuda}
            acreedorNombre={d.acreedorNombre}
            saldoPendiente={d.saldoPendiente}
            estaLiquidada={estaLiquidada}
            cuentasBanco={cuentasBanco}
          />
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

      {/* 5. HISTORIAL DE PAGOS */}
      <HistorialPagos pagos={pagos} />
    </div>
  );
}

function HistorialPagos({ pagos }: { pagos: PagoDeuda[] }) {
  if (pagos.length === 0) {
    return (
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-head"><div className="card-title">Historial de pagos</div></div>
        <div className="card-pad" style={{ padding: 32, textAlign: 'center', color: 'var(--ink-4)' }}>
          <I.Coins size={26} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div style={{ fontSize: 13 }}>Aún no se han registrado pagos para esta deuda</div>
        </div>
      </div>
    );
  }

  const totalCapital  = pagos.reduce((s, p) => s + p.capital, 0);
  const totalInteres  = pagos.reduce((s, p) => s + p.interes, 0);
  const totalMora     = pagos.reduce((s, p) => s + p.mora, 0);
  const totalComision = pagos.reduce((s, p) => s + p.comision, 0);
  const totalDesemb   = totalCapital + totalInteres + totalMora + totalComision;

  return (
    <div className="card" style={{ marginBottom: 22 }}>
      <div className="card-head">
        <div className="card-title">Historial de pagos</div>
        <div className="card-actions" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
          {pagos.length} pago{pagos.length === 1 ? '' : 's'}
        </div>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th className="num" style={{ width: 100 }}>Fecha</th>
            <th className="num">Total</th>
            <th className="num">Capital</th>
            <th className="num">Interés</th>
            <th className="num">Mora</th>
            <th className="num">Comisión</th>
            <th>Método</th>
            <th>Referencia</th>
            <th>Banco</th>
            <th>Notas</th>
          </tr>
        </thead>
        <tbody>
          {pagos.map(p => (
            <tr key={p.id}>
              <td className="num cell-strong" style={{ whiteSpace: 'nowrap' }}>{formatFecha(p.fecha)}</td>
              <td className="num cell-strong">{Q(p.montoTotal)}</td>
              <td className="num">{Q(p.capital)}</td>
              <td className="num cell-mute">{p.interes ? Q(p.interes) : '—'}</td>
              <td className="num cell-mute">{p.mora ? Q(p.mora) : '—'}</td>
              <td className="num cell-mute">{p.comision ? Q(p.comision) : '—'}</td>
              <td><span className="badge badge-outline" style={{ fontSize: 10.5 }}>{p.metodo}</span></td>
              <td className="cell-mute" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }} title={p.referencia}>{p.referencia || '—'}</td>
              <td className="cell-mute" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }} title={p.cuentaBancoName}>{p.cuentaBancoName || '—'}</td>
              <td className="cell-mute" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }} title={p.notas}>{p.notas || '—'}</td>
            </tr>
          ))}
          <tr style={{ background: 'var(--paper-tint)', fontWeight: 600 }}>
            <td className="num" style={{ textAlign: 'right', color: 'var(--ink-3)' }}>Totales</td>
            <td className="num cell-strong">{Q(totalDesemb)}</td>
            <td className="num cell-strong">{Q(totalCapital)}</td>
            <td className="num">{totalInteres ? Q(totalInteres) : '—'}</td>
            <td className="num">{totalMora ? Q(totalMora) : '—'}</td>
            <td className="num">{totalComision ? Q(totalComision) : '—'}</td>
            <td colSpan={4}></td>
          </tr>
        </tbody>
      </table>
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
