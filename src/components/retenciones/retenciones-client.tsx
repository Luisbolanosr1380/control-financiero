'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';
import type { RetencionesAgregadas, RetencionRecord, TipoRetencion } from '@/lib/db/retenciones';

interface Props {
  data: RetencionesAgregadas;
}

function formatFecha(s: string): string {
  if (!s) return '—';
  const d = s.slice(0, 10);
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return s;
  return `${day}/${m}/${y}`;
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function RetencionesClient({ data }: Props) {
  const router = useRouter();
  const [tipoFilter, setTipoFilter]   = useState<'todos' | TipoRetencion>('todos');
  const [clienteFilter, setClienteFilter] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  const recordsFiltrados = useMemo(() => {
    let r: RetencionRecord[] = data.records;
    if (tipoFilter !== 'todos') r = r.filter(x => x.tipo === tipoFilter);
    if (clienteFilter.trim()) {
      const q = clienteFilter.toLowerCase();
      r = r.filter(x => x.clienteNombre.toLowerCase().includes(q));
    }
    if (desde) r = r.filter(x => x.fecha >= desde);
    if (hasta) r = r.filter(x => x.fecha <= hasta);
    return r;
  }, [data.records, tipoFilter, clienteFilter, desde, hasta]);

  const sumaFiltrada = recordsFiltrados.reduce((s, r) => s + r.monto, 0);

  const aniosOpciones = useMemo(() => {
    const actual = new Date().getFullYear();
    return [actual, actual - 1, actual - 2];
  }, []);

  const cambiarAnio = (a: number) => {
    if (a === data.anio) return;
    router.push(`/retenciones?anio=${a}`);
  };

  const exportCSV = () => {
    const headers = ['Fecha', 'NO.FACTURA', 'Cliente', 'Tipo', 'Monto', 'Constancia', 'Grupo'];
    const rows = recordsFiltrados.map(r => [
      r.fecha, r.noFactura, r.clienteNombre, r.tipo,
      r.monto.toFixed(2), r.numConstancia, r.grupoId,
    ].map(c => csvEscape(String(c))).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `retenciones-${data.anio}-${obtenerFechaHoyGuatemala()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Cálculos para el bar chart: max por mes para escalar
  const maxMes = Math.max(1, ...data.porMes.map(m => m.iva + m.isr));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Retenciones acumuladas</h1>
          <div className="page-subtitle">
            Crédito fiscal del año {data.anio} · IVA + ISR retenidos por clientes
          </div>
        </div>
        <div className="page-actions">
          <select
            className="input"
            value={data.anio}
            onChange={(e) => cambiarAnio(Number(e.target.value))}
            style={{ width: 100 }}
          >
            {aniosOpciones.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <button type="button" className="btn btn-secondary" onClick={exportCSV} disabled={recordsFiltrados.length === 0}>
            <I.Download size={13} /> Exportar CSV
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="kpi-grid" style={{ marginBottom: 22 }}>
        <div className="kpi">
          <div className="kpi-label">Retención IVA acumulada</div>
          <div className="kpi-value" style={{ color: '#B59E2A' }}>
            <span className="currency">Q</span>{Math.round(data.totalIVA).toLocaleString('en-US')}
          </div>
          <div className="kpi-delta"><span className="vs">{data.numIVA} constancia{data.numIVA === 1 ? '' : 's'}</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Retención ISR acumulada</div>
          <div className="kpi-value" style={{ color: '#A85C32' }}>
            <span className="currency">Q</span>{Math.round(data.totalISR).toLocaleString('en-US')}
          </div>
          <div className="kpi-delta"><span className="vs">{data.numISR} constancia{data.numISR === 1 ? '' : 's'}</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Total crédito fiscal {data.anio}</div>
          <div className="kpi-value" style={{ color: 'var(--olive)' }}>
            <span className="currency">Q</span>{Math.round(data.totalGeneral).toLocaleString('en-US')}
          </div>
          <div className="kpi-delta"><span className="vs">Sumado de los {data.numIVA + data.numISR} records</span></div>
        </div>
      </div>

      {data.records.length === 0 && (
        <div className="card" style={{ marginBottom: 22 }}>
          <div className="card-pad" style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--ink-3)' }}>
            <I.Statement size={36} style={{ opacity: 0.5, marginBottom: 12 }} />
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 4 }}>
              Sin retenciones en {data.anio}
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>
              Cuando registres un cobro con un componente "Retención IVA" o "Retención ISR" en
              {' '}<Link href="/facturacion" style={{ color: 'var(--olive)', textDecoration: 'underline' }}>/facturacion</Link>, aparecerá acá.
            </div>
          </div>
        </div>
      )}

      {data.records.length > 0 && (<>
        {/* Bar chart por mes */}
        <div className="card" style={{ marginBottom: 22 }}>
          <div className="card-head">
            <div className="card-title">Retenciones por mes — {data.anio}</div>
          </div>
          <div style={{ padding: '14px 18px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 6, height: 160 }}>
              {data.porMes.map(m => {
                const tot = m.iva + m.isr;
                const h = tot > 0 ? Math.max(2, (tot / maxMes) * 140) : 0;
                const hIVA = tot > 0 ? (m.iva / tot) * h : 0;
                const hISR = tot > 0 ? (m.isr / tot) * h : 0;
                return (
                  <div key={m.mes} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column-reverse', width: '100%', alignItems: 'center' }}>
                      <div style={{ width: '70%', display: 'flex', flexDirection: 'column-reverse' }}>
                        <div style={{ height: hIVA, background: '#D9C158', borderRadius: hISR > 0 ? '0 0 2px 2px' : '0 0 2px 2px' }} title={`IVA ${Q(m.iva)}`} />
                        <div style={{ height: hISR, background: '#A85C32', borderRadius: hISR > 0 ? '2px 2px 0 0' : '0' }} title={`ISR ${Q(m.isr)}`} />
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--ink-4)' }}>{m.nombre}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 11, color: 'var(--ink-3)', justifyContent: 'center' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, background: '#D9C158' }} /> IVA
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, background: '#A85C32' }} /> ISR
              </span>
            </div>
          </div>
        </div>

        {/* Por cliente */}
        <div className="card" style={{ marginBottom: 22 }}>
          <div className="card-head">
            <div className="card-title">Retenciones por cliente</div>
            <div className="card-actions">
              <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>{data.porCliente.length} cliente{data.porCliente.length === 1 ? '' : 's'}</span>
            </div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th className="num" style={{ width: 130 }}>Ret. IVA</th>
                <th className="num" style={{ width: 130 }}>Ret. ISR</th>
                <th className="num" style={{ width: 130 }}>Total</th>
                <th className="num" style={{ width: 90 }}>Constancias</th>
              </tr>
            </thead>
            <tbody>
              {data.porCliente.map(c => (
                <tr key={c.custId}>
                  <td className="cell-strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.clienteNombre}</td>
                  <td className="num" style={{ color: c.iva > 0 ? '#B59E2A' : 'var(--ink-4)' }}>{Q(c.iva)}</td>
                  <td className="num" style={{ color: c.isr > 0 ? '#A85C32' : 'var(--ink-4)' }}>{Q(c.isr)}</td>
                  <td className="num cell-strong">{Q(c.total)}</td>
                  <td className="num cell-mute">{c.numRetenciones}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Filtros + tabla de records */}
        <div className="card" style={{ padding: 0, marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 8, padding: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={tipoFilter} onChange={(e) => setTipoFilter(e.target.value as typeof tipoFilter)} style={selectStyle}>
              <option value="todos">Tipo (todos)</option>
              <option value="IVA">Retención IVA</option>
              <option value="ISR">Retención ISR</option>
            </select>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={selectStyle} title="Desde" />
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={selectStyle} title="Hasta" />
            <input
              type="text"
              placeholder="Filtrar por cliente..."
              value={clienteFilter}
              onChange={(e) => setClienteFilter(e.target.value)}
              className="input"
              style={{ flex: 1, minWidth: 180 }}
            />
            <div style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>
              <span>{recordsFiltrados.length} retenciones</span>
              <span style={{ margin: '0 8px', color: 'var(--line-2)' }}>·</span>
              <span className="num">Q {sumaFiltrada.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">Listado de retenciones {data.anio}</div>
          </div>
          <table className="table" style={{ tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th className="num" style={{ width: 100 }}>Fecha</th>
                <th className="num" style={{ width: 130 }}>NO.FACTURA</th>
                <th>Cliente</th>
                <th style={{ width: 100 }}>Tipo</th>
                <th className="num" style={{ width: 110 }}>Monto</th>
                <th style={{ width: 160 }}>Constancia</th>
              </tr>
            </thead>
            <tbody>
              {recordsFiltrados.length === 0 ? (
                <tr><td colSpan={6} style={{ height: 120, textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
                  Sin retenciones bajo los filtros actuales
                </td></tr>
              ) : recordsFiltrados.map(r => (
                <tr key={`${r.recordId}-${r.tipo}`}>
                  <td className="num cell-strong" style={{ whiteSpace: 'nowrap' }}>{formatFecha(r.fecha)}</td>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>{r.noFactura}</td>
                  <td className="cell-strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.clienteNombre}>{r.clienteNombre}</td>
                  <td>
                    <span className="badge badge-warn" style={{ fontSize: 10.5 }}>{r.tipo}</span>
                  </td>
                  <td className="num cell-strong">{Q(r.monto)}</td>
                  <td className="cell-mute" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.constanciaUrl ? (
                      <a href={r.constanciaUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--olive)', textDecoration: 'underline' }}>
                        {r.numConstancia || 'PDF'}
                      </a>
                    ) : (
                      r.numConstancia || '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>)}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  fontSize: 12, padding: '5px 8px', borderRadius: 4,
  border: '1px solid var(--line-2)', background: 'var(--paper-2)',
  color: 'var(--ink)', fontFamily: 'inherit',
};
