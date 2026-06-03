import Link from 'next/link';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import type { Acreedor, Deuda, CategoriaPasivo } from '@/lib/db/deudas';
import type { PagoDeuda } from '@/lib/db/pagos-deudas';

interface Props {
  acreedor: Acreedor;
  categoria: CategoriaPasivo;
  deudas: Deuda[];
  pagos: PagoDeuda[];
}

const CATEGORIA_BADGE: Record<CategoriaPasivo, { cls: string; text: string; icon: string }> = {
  externa:               { cls: 'badge-wine',    text: 'Externa',              icon: '🔴' },
  socios:                { cls: 'badge-warn',    text: 'Socio',                icon: '🤝' },
  empleados:             { cls: 'badge-olive',   text: 'Empleado (salario)',   icon: '👥' },   // F-037
  ex_empleados:          { cls: 'badge-outline', text: 'Ex-empleado',          icon: '👤' },
  asesores_relacionados: { cls: 'badge-mute',    text: 'Asesor / relacionado', icon: '🤵' },
};

function formatFecha(s: string): string {
  if (!s || s === 'SIN-FECHA') return '—';
  const d = s.slice(0, 10);
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return s;
  return `${day}/${m}/${y}`;
}

export function AcreedorDetalle({ acreedor: a, categoria, deudas, pagos }: Props) {
  const badge = CATEGORIA_BADGE[categoria];

  const activas    = deudas.filter(d => d.saldoPendiente > 0);
  const liquidadas = deudas.filter(d => d.saldoPendiente <= 0.01);
  const saldoTotal     = activas.reduce((s, d) => s + d.saldoPendiente, 0);
  const totalPagado    = pagos.reduce((s, p) => s + p.capital, 0);
  const totalDesemb    = pagos.reduce((s, p) => s + p.montoTotal, 0);

  return (
    <div className="page">
      {/* HEADER */}
      <div className="page-header">
        <div>
          <div style={{ marginBottom: 6 }}>
            <Link href="/deudas" className="btn btn-ghost" style={{ padding: '3px 8px' }}>
              <I.ChevLeft size={13} /> Volver a Deudas
            </Link>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 className="page-title" style={{ fontSize: 24 }}>
              <span style={{ marginRight: 8 }}>{badge.icon}</span>
              {a.nombre || a.nombreLegal}
            </h1>
            <span className={'badge ' + badge.cls}>{badge.text}</span>
            {a.tipoAcreedor && <span className="badge badge-mute">{a.tipoAcreedor}</span>}
            {a.tipoProducto && <span className="badge badge-outline">{a.tipoProducto}</span>}
          </div>
          <div className="page-subtitle" style={{ marginTop: 6 }}>
            {a.nombreLegal || '—'} {a.cuentaContable && <>· Cuenta contable: {a.cuentaContable}</>} · Moneda: {a.moneda || 'GTQ'}
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 22 }}>
        <div className="kpi">
          <div className="kpi-label">Saldo con este acreedor</div>
          <div className="kpi-value">
            <span className="currency">Q</span>{Math.round(saldoTotal).toLocaleString('en-US')}
          </div>
          <div className="kpi-delta">
            <span className="vs">{activas.length} deuda{activas.length === 1 ? '' : 's'} con saldo</span>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Total pagado histórico (capital)</div>
          <div className="kpi-value">
            <span className="currency">Q</span>{Math.round(totalPagado).toLocaleString('en-US')}
          </div>
          <div className="kpi-delta">
            <span className="vs">{pagos.length} pago{pagos.length === 1 ? '' : 's'} · desembolsado {Q(totalDesemb)}</span>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Total deuda inicial</div>
          <div className="kpi-value">
            <span className="currency">Q</span>{Math.round(a.totalDeudaInicial).toLocaleString('en-US')}
          </div>
          <div className="kpi-delta">
            <span className="vs">{liquidadas.length} liquidada{liquidadas.length === 1 ? '' : 's'} · {deudas.length} totales</span>
          </div>
        </div>
      </div>

      {/* DEUDAS CON ESTE ACREEDOR */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-head">
          <div className="card-title">Deudas con este acreedor</div>
          <div className="card-actions" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
            {deudas.length} deuda{deudas.length === 1 ? '' : 's'}
          </div>
        </div>
        {deudas.length === 0 ? (
          <div className="card-pad" style={{ padding: 32, textAlign: 'center', color: 'var(--ink-4)' }}>
            <I.Debt size={26} style={{ opacity: 0.4, marginBottom: 8 }} />
            <div style={{ fontSize: 13 }}>No hay deudas registradas con este acreedor.</div>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Deuda</th>
                <th>Tipo</th>
                <th className="num" style={{ width: 120 }}>Monto original</th>
                <th className="num" style={{ width: 120 }}>Saldo</th>
                <th className="num" style={{ width: 90 }}>Avance</th>
                <th className="num" style={{ width: 110 }}>Vencimiento</th>
                <th style={{ width: 110 }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {deudas.map(d => {
                const liquidada = d.saldoPendiente <= 0.01 || /liquidada/i.test(d.estadoDeuda);
                return (
                  <tr key={d.id}>
                    <td className="cell-strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }} title={d.nombreDeuda}>
                      <Link href={`/deudas/${d.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                        {d.nombreDeuda || d.claveDeuda || d.id}
                      </Link>
                    </td>
                    <td><span className="badge badge-outline" style={{ fontSize: 10.5 }}>{d.tipoDocumento || '—'}</span></td>
                    <td className="num cell-mute">{Q(d.montoOriginal)}</td>
                    <td className="num cell-strong">{Q(d.saldoPendiente)}</td>
                    <td className="num cell-mute">{d.pctAvance > 0 ? `${Math.round(d.pctAvance)}%` : '—'}</td>
                    <td className="num cell-mute" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{formatFecha(d.fechaVencimientoReal || d.fechaVencimiento)}</td>
                    <td>
                      {liquidada
                        ? <span className="badge badge-olive">Liquidada</span>
                        : d.diasEnMora > 0
                          ? <span className="badge badge-wine">+{d.diasEnMora}d mora</span>
                          : <span className="badge badge-outline">Vigente</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* HISTORIAL DE PAGOS COMPLETO */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-head">
          <div className="card-title">Historial completo de pagos a este acreedor</div>
          <div className="card-actions" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
            {pagos.length} pago{pagos.length === 1 ? '' : 's'}
          </div>
        </div>
        {pagos.length === 0 ? (
          <div className="card-pad" style={{ padding: 32, textAlign: 'center', color: 'var(--ink-4)' }}>
            <I.Coins size={26} style={{ opacity: 0.4, marginBottom: 8 }} />
            <div style={{ fontSize: 13 }}>Aún no se han registrado pagos a este acreedor.</div>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th className="num" style={{ width: 100 }}>Fecha</th>
                <th className="num">Total</th>
                <th className="num">Capital</th>
                <th>Método</th>
                <th>Referencia</th>
                <th>Banco</th>
                <th>Deuda</th>
              </tr>
            </thead>
            <tbody>
              {pagos.map(p => {
                const deudaNombre = deudas.find(d => d.id === p.deudaId)?.nombreDeuda || p.deudaId;
                return (
                  <tr key={p.id}>
                    <td className="num cell-strong" style={{ whiteSpace: 'nowrap' }}>{formatFecha(p.fecha)}</td>
                    <td className="num cell-strong">{Q(p.montoTotal)}</td>
                    <td className="num">{Q(p.capital)}</td>
                    <td><span className="badge badge-outline" style={{ fontSize: 10.5 }}>{p.metodo}</span></td>
                    <td className="cell-mute" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }} title={p.referencia}>{p.referencia || '—'}</td>
                    <td className="cell-mute" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }} title={p.cuentaBancoName}>{p.cuentaBancoName || '—'}</td>
                    <td className="cell-mute" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }} title={deudaNombre}>
                      <Link href={`/deudas/${p.deudaId}`} style={{ color: 'inherit', textDecoration: 'underline dotted' }}>
                        {deudaNombre}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {a.notas && (
        <div className="card" style={{ marginBottom: 22 }}>
          <div className="card-head"><div className="card-title">Notas sobre el acreedor</div></div>
          <div className="card-pad" style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: a.notas }} />
        </div>
      )}
    </div>
  );
}
