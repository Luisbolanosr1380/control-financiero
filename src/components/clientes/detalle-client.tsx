'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from 'recharts';
import { I } from '@/components/common/icons';
import { Q, formatDate } from '@/lib/utils';
import type { AnalisisCliente, ClienteClasificacion, Tendencia } from '@/lib/db/clientes-analisis';
import type { Invoice } from '@/lib/types';

const BADGE: Record<ClienteClasificacion, { cls: string; text: string }> = {
  perdido:    { cls: 'badge-wine',    text: 'Perdido' },
  en_riesgo:  { cls: 'badge-warn',    text: 'En riesgo' },
  en_declive: { cls: 'badge-outline', text: 'En declive' },
  sano:       { cls: 'badge-olive',   text: 'Sano' },
  nuevo:      { cls: 'badge-mute',    text: 'Nuevo' },
  episodico:  { cls: 'badge-mute',    text: 'Episódico' },
};

function TendenciaInline({ t }: { t: Tendencia }) {
  if (t === 'creciente')   return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--olive)' }}><I.ArrowUp size={11} /> creciente</span>;
  if (t === 'decreciente') return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--wine)' }}><I.ArrowDown size={11} /> decreciente</span>;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--ink-3)' }}>estable</span>;
}

// 'YYYY-MM' → 'MMM 'YY' corto
function labelMes(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${meses[m - 1]} '${String(y).slice(2)}`;
}

interface Props {
  analisis: AnalisisCliente;
  facturas: Invoice[];
}

export function ClienteDetalleClient({ analisis: a, facturas }: Props) {
  const router = useRouter();
  const badge = BADGE[a.clasificacion];

  const datosChart = a.serieMensual.map(s => ({ mes: labelMes(s.mes), monto: Math.round(s.monto) }));
  const facturasOrdenadas = [...facturas]
    .filter(f => f.fechaEmision)
    .sort((x, y) => (y.fechaEmision ?? '').localeCompare(x.fechaEmision ?? ''));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div style={{ marginBottom: 6 }}>
            <Link href="/clientes" className="btn btn-ghost" style={{ padding: '3px 8px' }}>
              <I.ChevLeft size={13} /> Volver a clientes
            </Link>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 className="page-title" style={{ fontSize: 26 }}>{a.nombre}</h1>
            <span className={'badge ' + badge.cls} style={{ fontSize: 11.5, padding: '3px 10px' }}>{badge.text}</span>
          </div>
          <div className="page-subtitle" style={{ marginTop: 6 }}>
            Última factura {formatDate(a.ultimaFactura)} · {facturas.length} factura(s) en 12 meses
          </div>
        </div>
      </div>

      {/* Métricas */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 22 }}>
        <div className="kpi">
          <div className="kpi-label">Promedio / mes activo</div>
          <div className="kpi-value"><span className="currency">Q</span>{Math.round(a.montoPromedio).toLocaleString('en-US')}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Intervalo normal</div>
          <div className="kpi-value">{a.intervaloNormal == null ? '—' : `${a.intervaloNormal.toFixed(1)} m`}</div>
          <div className="kpi-delta"><span className="vs">entre facturas</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Sin facturar</div>
          <div className="kpi-value" style={{ color: a.mesesSinFacturar > 2 ? 'var(--wine)' : 'var(--ink)' }}>
            {a.mesesSinFacturar.toFixed(1)}<span style={{ fontSize: 14, color: 'var(--ink-3)', marginLeft: 4 }}>meses</span>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Tendencia (3m vs 3m anteriores)</div>
          <div style={{ marginTop: 8, fontSize: 14 }}><TendenciaInline t={a.tendencia} /></div>
          <div className="kpi-delta"><span className="vs"><span className="num">{Q(a.montoReciente)}</span> vs <span className="num">{Q(a.montoBase)}</span></span></div>
        </div>
      </div>

      {/* Gráfico mensual */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-head">
          <div className="card-title">Facturación mensual (12 meses)</div>
        </div>
        <div className="card-pad">
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={datosChart} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="var(--line-3)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="mes" stroke="var(--ink-4)" fontSize={10.5} tickLine={false} axisLine={false} />
                <YAxis
                  stroke="var(--ink-4)" fontSize={10.5} tickLine={false} axisLine={false}
                  tickFormatter={(v: number) => v >= 1000 ? `Q${Math.round(v / 1000)}K` : `Q${v}`}
                />
                <Tooltip
                  formatter={(v: number) => Q(v)}
                  labelStyle={{ fontSize: 11, color: 'var(--ink-3)' }}
                  contentStyle={{ background: 'var(--paper)', border: '1px solid var(--line-2)', borderRadius: 4, fontSize: 12 }}
                />
                <Bar dataKey="monto" fill="var(--ink)" radius={[2, 2, 0, 0]} maxBarSize={42} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Facturas */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">Facturas del cliente</div>
          <div className="card-actions">
            <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{facturasOrdenadas.length} en 12 meses</span>
          </div>
        </div>
        {facturasOrdenadas.length === 0 ? (
          <div className="card-pad" style={{ textAlign: 'center', color: 'var(--ink-4)', padding: 32, fontSize: 12.5 }}>
            Sin facturas en la ventana.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Factura</th>
                <th className="num">Fecha</th>
                <th className="num">Total</th>
                <th className="num">Saldo</th>
                <th>Estado</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {facturasOrdenadas.map(f => (
                <tr key={f.id} className="clickable" onClick={() => router.push(`/facturacion/${f.id}`)}>
                  <td className="num cell-strong">{f.noFactura}</td>
                  <td className="num cell-mute">{formatDate(f.fechaEmision)}</td>
                  <td className="num cell-strong">{Q(f.total)}</td>
                  <td className="num" style={{ color: f.balance > 0 ? 'var(--wine)' : 'var(--ink-3)' }}>{Q(f.balance)}</td>
                  <td><span className="badge badge-mute" style={{ fontSize: 10.5 }}>{f.status}</span></td>
                  <td><button className="modal-close"><I.More size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
