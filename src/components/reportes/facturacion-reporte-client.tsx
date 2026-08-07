'use client';

/**
 * F-REPORTE-FACTURACION — UI del reporte de facturación emitida.
 *
 * El corazón son los filtros combinables (período + cliente + línea +
 * estado) y las 4 vistas del mismo total: por cliente, por línea, por
 * mes y detalle. Todo corre en memoria sobre el dataset completo que
 * manda el server — cambiar un filtro recalcula al instante y el Δ vs
 * período anterior sale del mismo dataset.
 *
 * Export CSV (con BOM para Excel) de la vista activa con los filtros
 * aplicados — es lo que se entrega a clientes/gerentes/socios. El
 * encabezado en pantalla (período + filtros) sirve de carátula para
 * captura/impresión (PDF formal quedó fuera del V1).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
} from 'recharts';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { mesActualGT, etiquetaMes } from '@/lib/utils/mes-activo';
import type { FacturaReporte } from '@/lib/db/facturas';
import {
  filtrarReporte, totalesReporte, reportePorCliente, reportePorCentroCosto,
  reportePorMes, rangoAnterior, type EstadoFiltroReporte,
} from '@/lib/facturacion/reporte';
import { construirCsvReporte, nombreArchivoExport } from '@/lib/facturacion/reporte-csv';

interface Props {
  facturas: FacturaReporte[];
  clientes: Array<{ id: string; name: string }>;
  centros: Array<{ id: string; nombre: string; activo: boolean }>;
}

type Vista = 'cliente' | 'linea' | 'mes' | 'detalle';
type Preset = 'este_mes' | 'mes_anterior' | 'trimestre' | 'este_anio' | 'anio_anterior' | 'historico';

const PRESETS: Array<{ key: Preset; label: string }> = [
  { key: 'este_mes',      label: 'Este mes' },
  { key: 'mes_anterior',  label: 'Mes anterior' },
  { key: 'trimestre',     label: 'Este trimestre' },
  { key: 'este_anio',     label: 'Este año' },
  { key: 'anio_anterior', label: 'Año anterior' },
  { key: 'historico',     label: 'Histórico' },
];

const VISTAS: Array<{ key: Vista; label: string }> = [
  { key: 'cliente', label: 'Por cliente' },
  { key: 'linea',   label: 'Por línea' },
  { key: 'mes',     label: 'Por mes' },
  { key: 'detalle', label: 'Detalle' },
];

// Mismos colores de serie que la analítica (color sigue a la entidad).
const CC_COLOR: Record<string, string> = {
  'Poligrafia':      'var(--line-poligrafo)',
  'Poligrafia Xela': 'var(--line-poligrafo)',
  'Socioeconomicos': 'var(--line-socio)',
  'TalentTrackAI':   'var(--line-talenttrack)',
  'Administrativo':  'var(--line-ventas)',
};

const ESTADO_BADGE: Record<string, { cls: string; text: string }> = {
  cobrado:         { cls: 'badge-olive',   text: 'Cobrada' },
  cobrado_parcial: { cls: 'badge-warn',    text: 'Parcial' },
  emitida:         { cls: 'badge-outline', text: 'Emitida' },
  pendiente:       { cls: 'badge-warn',    text: 'Pendiente' },
  otro:            { cls: 'badge-mute',    text: 'Otro' },
};

const DETALLE_MAX = 300;

const pad2 = (n: number) => String(n).padStart(2, '0');
const ultimoDia = (y: number, m1: number) => new Date(y, m1, 0).getDate();

function rangoDePreset(preset: Preset): { desde: string; hasta: string } {
  const mesActual = mesActualGT();
  const y = Number(mesActual.slice(0, 4));
  const m = Number(mesActual.slice(5, 7));
  switch (preset) {
    case 'este_mes':
      return { desde: `${y}-${pad2(m)}-01`, hasta: `${y}-${pad2(m)}-${pad2(ultimoDia(y, m))}` };
    case 'mes_anterior': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { desde: `${py}-${pad2(pm)}-01`, hasta: `${py}-${pad2(pm)}-${pad2(ultimoDia(py, pm))}` };
    }
    case 'trimestre': {
      const q0 = Math.floor((m - 1) / 3) * 3 + 1;
      return { desde: `${y}-${pad2(q0)}-01`, hasta: `${y}-${pad2(q0 + 2)}-${pad2(ultimoDia(y, q0 + 2))}` };
    }
    case 'este_anio':     return { desde: `${y}-01-01`,     hasta: `${y}-12-31` };
    case 'anio_anterior': return { desde: `${y - 1}-01-01`, hasta: `${y - 1}-12-31` };
    case 'historico':
    default:              return { desde: '', hasta: '' };
  }
}

function labelMes(ym: string): string {
  if (!ym) return '—';
  const [y, m] = ym.split('-').map(Number);
  const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return `${meses[m - 1]} '${String(y).slice(2)}`;
}

function fechaHumana(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function FacturacionReporteClient({ facturas, clientes, centros }: Props) {
  const [preset, setPreset] = useState<Preset | null>('este_anio');
  const inicial = rangoDePreset('este_anio');
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);
  const [clienteIds, setClienteIds] = useState<string[]>([]);
  const [ccIds, setCcIds] = useState<string[]>([]);
  const [estado, setEstado] = useState<EstadoFiltroReporte>('todas');
  const [vista, setVista] = useState<Vista>('cliente');

  const nombreCliente = useMemo(() => new Map(clientes.map(c => [c.id, c.name])), [clientes]);
  const nombreCC = useMemo(() => new Map(centros.map(c => [c.id, c.nombre])), [centros]);
  const nomCli = (id: string) => nombreCliente.get(id) ?? (id ? id : 'Sin cliente');
  const nomCC  = (id: string) => nombreCC.get(id) ?? (id ? id : 'Sin centro');

  // Solo los centros que aparecen en el dataset (chips con sentido), orden por monto histórico.
  const ccPresentes = useMemo(() => {
    const monto = new Map<string, number>();
    for (const f of facturas) {
      for (const l of f.lineasCC) monto.set(l.ccId, (monto.get(l.ccId) ?? 0) + l.total);
    }
    return [...monto.entries()]
      .filter(([, m]) => m > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
  }, [facturas]);

  const aplicarPreset = (p: Preset) => {
    const r = rangoDePreset(p);
    setPreset(p);
    setDesde(r.desde);
    setHasta(r.hasta);
  };

  const setMes = (ym: string) => {
    if (!ym) return;
    const [y, m] = ym.split('-').map(Number);
    setPreset(null);
    setDesde(`${y}-${pad2(m)}-01`);
    setHasta(`${y}-${pad2(m)}-${pad2(ultimoDia(y, m))}`);
  };

  const filtros = useMemo(() => ({
    desde: desde || undefined,
    hasta: hasta || undefined,
    clienteIds,
    centroCostoIds: ccIds,
    estado,
  }), [desde, hasta, clienteIds, ccIds, estado]);

  const { filtradas, numAnuladas } = useMemo(
    () => filtrarReporte(facturas, filtros), [facturas, filtros]);
  const tot = useMemo(() => totalesReporte(filtradas), [filtradas]);
  const porCliente = useMemo(() => reportePorCliente(filtradas), [filtradas]);
  const porCC = useMemo(() => reportePorCentroCosto(filtradas, ccIds), [filtradas, ccIds]);
  // El bucket sin fecha con Q0 (fila basura conocida) solo ensucia el eje del chart.
  const porMes = useMemo(() =>
    reportePorMes(filtradas).filter(g => g.key !== '' || g.montoQ > 0),
  [filtradas]);

  // Δ vs período igual anterior (solo con rango completo definido).
  const comparativo = useMemo(() => {
    if (!desde || !hasta) return null;
    const prev = rangoAnterior(desde, hasta);
    const r = filtrarReporte(facturas, { ...filtros, desde: prev.desde, hasta: prev.hasta });
    const t = totalesReporte(r.filtradas);
    return { ...prev, totalQ: t.totalQ, numFacturas: t.numFacturas };
  }, [facturas, filtros, desde, hasta]);
  const deltaPct = comparativo && comparativo.totalQ > 0
    ? ((tot.totalQ - comparativo.totalQ) / comparativo.totalQ) * 100
    : null;

  const etiquetaPeriodo = useMemo(() => {
    if (!desde && !hasta) return 'Histórico completo';
    if (desde && hasta && desde.slice(0, 7) === hasta.slice(0, 7)
      && desde.endsWith('-01') && hasta === `${hasta.slice(0, 7)}-${pad2(ultimoDia(Number(hasta.slice(0, 4)), Number(hasta.slice(5, 7))))}`) {
      return etiquetaMes(desde.slice(0, 7));
    }
    return `${fechaHumana(desde)} — ${hasta ? fechaHumana(hasta) : 'hoy'}`;
  }, [desde, hasta]);

  const filtrosHumanos = useMemo(() => {
    const partes: string[] = [];
    if (clienteIds.length > 0) {
      partes.push(clienteIds.length === 1 ? nomCli(clienteIds[0]) : `${clienteIds.length} clientes`);
    }
    if (ccIds.length > 0) partes.push(ccIds.map(nomCC).join(' + '));
    if (estado !== 'todas') {
      partes.push({ cobradas: 'solo cobradas', por_cobrar: 'solo por cobrar', pendientes: 'solo pendientes' }[estado]);
    }
    return partes.length > 0 ? partes.join(' · ') : 'Todos los clientes y líneas';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteIds, ccIds, estado, nombreCliente, nombreCC]);

  const detalle = useMemo(() =>
    [...filtradas].sort((a, b) =>
      b.f.fecha.localeCompare(a.f.fecha) || b.f.noFactura.localeCompare(a.f.noFactura)),
  [filtradas]);

  /* ── Export: resumen + detalle en un solo archivo ───────────────
   * El dataset viene de getFacturasReporte() → fetchAll PAGINADO —
   * jamás armar esto con un .select() directo (trunca en 1,000 filas). */
  const exportarCsv = () => {
    const csv = construirCsvReporte(filtradas, {
      etiquetaPeriodo: etiquetaPeriodo,
      filtrosHumanos: filtrosHumanos,
      nomCliente: nomCli,
      nomCentro: nomCC,
      centroCostoIds: ccIds,
      numAnuladas,
    });
    // BOM para que Excel abra el UTF-8 con acentos bien.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivoExport({
      clienteSlugs: clienteIds.map(nomCli),
      centroSlugs: ccIds.map(nomCC),
      desde: desde || undefined,
      hasta: hasta || undefined,
    });
    a.click();
    URL.revokeObjectURL(url);
  };

  const ejeQ = (v: number) => v >= 1000 ? `Q${Math.round(v / 1000)}K` : `Q${v}`;
  const tooltipStyle = { background: 'var(--paper)', border: '1px solid var(--line-2)', borderRadius: 4, fontSize: 12 } as const;

  return (
    <div className="page">
      <header className="page-header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="page-title">Reporte de <em>Facturación</em></h1>
          <p className="page-subtitle">
            Facturación <strong>emitida</strong> (ventas) · {etiquetaPeriodo} · {filtrosHumanos}
            <span style={{ color: 'var(--ink-4)' }}> · distinta de pendientes de cobro</span>
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => window.print()} title="Imprimir / guardar como PDF">
            <I.Print size={13} /> Imprimir
          </button>
          <button className="btn btn-primary" onClick={exportarCsv}>
            <I.Download size={13} /> Exportar CSV
          </button>
        </div>
      </header>

      {/* ── Filtros ─────────────────────────────────────────────── */}
      {/* overflow visible: .card recorta con overflow hidden y el dropdown de clientes se abre hacia abajo */}
      <div className="card card-pad" style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'visible' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {PRESETS.map(p => (
            <button
              key={p.key}
              className="chip"
              onClick={() => aplicarPreset(p.key)}
              style={preset === p.key ? { background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)' } : undefined}
            >
              {p.label}
            </button>
          ))}
          <span style={{ width: 1, height: 20, background: 'var(--line)', margin: '0 4px' }} />
          <input
            type="month"
            className="input"
            value={desde && desde.slice(0, 7) === hasta.slice(0, 7) ? desde.slice(0, 7) : ''}
            onChange={e => setMes(e.target.value)}
            title="Un mes específico"
            style={{ width: 150 }}
          />
          <span style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>o rango</span>
          <input type="date" className="input" value={desde} max={hasta || undefined}
            onChange={e => { setPreset(null); setDesde(e.target.value); }} style={{ width: 140 }} />
          <span style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>—</span>
          <input type="date" className="input" value={hasta} min={desde || undefined}
            onChange={e => { setPreset(null); setHasta(e.target.value); }} style={{ width: 140 }} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <MultiSelectClientes
            clientes={clientes}
            seleccionados={clienteIds}
            onChange={setClienteIds}
          />
          <span style={{ width: 1, height: 20, background: 'var(--line)' }} />
          {ccPresentes.map(id => {
            const activo = ccIds.includes(id);
            return (
              <button
                key={id || 'sin-cc'}
                className="chip"
                onClick={() => setCcIds(activo ? ccIds.filter(x => x !== id) : [...ccIds, id])}
                style={activo ? { background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)' } : undefined}
              >
                {nomCC(id)}
              </button>
            );
          })}
          <span style={{ width: 1, height: 20, background: 'var(--line)' }} />
          <select className="input" value={estado} onChange={e => setEstado(e.target.value as EstadoFiltroReporte)} style={{ width: 160 }}>
            <option value="todas">Todos los estados</option>
            <option value="cobradas">Solo cobradas</option>
            <option value="por_cobrar">Solo por cobrar</option>
            <option value="pendientes">Solo pendientes</option>
          </select>
          {(clienteIds.length > 0 || ccIds.length > 0 || estado !== 'todas') && (
            <button className="btn btn-ghost" style={{ fontSize: 11.5 }}
              onClick={() => { setClienteIds([]); setCcIds([]); setEstado('todas'); }}>
              <I.X size={12} /> Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {/* ── Totales del filtro ──────────────────────────────────── */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
        <div className="kpi">
          <div className="kpi-label">Total facturado</div>
          <div className="kpi-value">{Q(Math.round(tot.totalQ))}</div>
          <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 2 }}>
            subtotal {Q(Math.round(tot.subtotalQ))} · IVA {Q(Math.round(tot.ivaQ))}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Facturas</div>
          <div className="kpi-value num">{tot.numFacturas}</div>
          {numAnuladas > 0 && (
            <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 2 }}>
              + {numAnuladas} anuladas/refact. (excluidas)
            </div>
          )}
        </div>
        <div className="kpi">
          <div className="kpi-label">Ticket promedio</div>
          <div className="kpi-value">{tot.numFacturas > 0 ? Q(Math.round(tot.ticketPromedioQ)) : '—'}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">vs período anterior</div>
          {comparativo && deltaPct != null ? (
            <>
              <div className={`kpi-delta ${deltaPct >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 20, fontWeight: 600 }}>
                {deltaPct >= 0 ? '+' : ''}{deltaPct.toFixed(1)}%
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 2 }}>
                {fechaHumana(comparativo.desde)} — {fechaHumana(comparativo.hasta)}: {Q(Math.round(comparativo.totalQ))}
              </div>
            </>
          ) : (
            <div className="kpi-value" style={{ color: 'var(--ink-4)' }}>—</div>
          )}
        </div>
      </div>

      {/* ── Vistas ──────────────────────────────────────────────── */}
      <div className="tabs">
        {VISTAS.map(v => (
          <div key={v.key} className={`tab ${vista === v.key ? 'active' : ''}`} onClick={() => setVista(v.key)}>
            {v.label}
          </div>
        ))}
      </div>

      {tot.numFacturas === 0 ? (
        <div className="card card-pad" style={{ textAlign: 'center', padding: 40, color: 'var(--ink-3)' }}>
          <div style={{ fontSize: 15, color: 'var(--ink-2)', fontWeight: 500, marginBottom: 4 }}>
            Sin facturación en este filtro
          </div>
          <div style={{ fontSize: 12.5 }}>
            No hay facturas emitidas que cumplan el período y los filtros aplicados.
            {numAnuladas > 0 && <> Hay {numAnuladas} anulada(s)/refacturada(s) en el rango, excluidas del reporte.</>}
          </div>
        </div>
      ) : (
        <>
          {vista === 'cliente' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 420px', gap: 16, alignItems: 'start' }}>
              <div className="card" style={{ padding: 0 }}>
                <div className="card-head"><div className="card-title">Ranking de clientes · {porCliente.length}</div></div>
                <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: 30 }}>#</th><th>Cliente</th>
                        <th className="num">Facturas</th><th className="num">Total</th><th className="num">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {porCliente.map((g, i) => (
                        <tr key={g.key || 'sin'}>
                          <td style={{ color: 'var(--ink-4)' }} className="num">{i + 1}</td>
                          <td>{nomCli(g.key)}</td>
                          <td className="num">{g.numFacturas}</td>
                          <td className="num">{Q(Math.round(g.montoQ))}</td>
                          <td className="num" style={{ color: 'var(--ink-3)' }}>{g.pct.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="card">
                <div className="card-head"><div className="card-title">Top 10 clientes</div></div>
                <div className="card-pad">
                  <div style={{ width: '100%', height: Math.max(200, Math.min(porCliente.length, 10) * 34 + 30) }}>
                    <ResponsiveContainer>
                      <BarChart
                        data={porCliente.slice(0, 10).map(g => ({ nombre: nomCli(g.key), monto: Math.round(g.montoQ) }))}
                        layout="vertical"
                        margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
                      >
                        <CartesianGrid stroke="var(--line-3)" strokeDasharray="2 4" horizontal={false} />
                        <XAxis type="number" stroke="var(--ink-4)" fontSize={10.5} tickLine={false} axisLine={false} tickFormatter={ejeQ} />
                        <YAxis type="category" dataKey="nombre" width={130} stroke="var(--ink-4)" fontSize={10.5}
                          tickLine={false} axisLine={false}
                          tickFormatter={(v: string) => v.length > 18 ? `${v.slice(0, 17)}…` : v} />
                        <Tooltip formatter={(v) => Q(Number(v))} contentStyle={tooltipStyle} />
                        <Bar dataKey="monto" fill="var(--ink)" radius={[0, 2, 2, 0]} maxBarSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          )}

          {vista === 'linea' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 420px', gap: 16, alignItems: 'start' }}>
              <div className="card" style={{ padding: 0 }}>
                <div className="card-head"><div className="card-title">Facturación por centro de costo</div></div>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Centro de costo</th>
                      <th className="num">Facturas</th><th className="num">Total</th><th className="num">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porCC.map(g => (
                      <tr key={g.key || 'sin'}>
                        <td>
                          <span style={{
                            display: 'inline-block', width: 8, height: 8, borderRadius: 2, marginRight: 8,
                            background: CC_COLOR[nomCC(g.key)] ?? 'var(--ink-4)',
                          }} />
                          {nomCC(g.key)}
                        </td>
                        <td className="num">{g.numFacturas}</td>
                        <td className="num">{Q(Math.round(g.montoQ))}</td>
                        <td className="num" style={{ color: 'var(--ink-3)' }}>{g.pct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ padding: '8px 12px', fontSize: 10.5, color: 'var(--ink-4)', borderTop: '1px solid var(--line-3)' }}>
                  Una factura mixta (varias líneas) aporta a cada centro solo su porción — por eso la
                  columna Facturas puede sumar más que el total de facturas del filtro.
                </div>
              </div>
              <div className="card">
                <div className="card-head"><div className="card-title">Mezcla de líneas</div></div>
                <div className="card-pad">
                  <div style={{ width: '100%', height: 240 }}>
                    <ResponsiveContainer>
                      <BarChart
                        data={porCC.map(g => ({ nombre: nomCC(g.key), monto: Math.round(g.montoQ) }))}
                        margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
                      >
                        <CartesianGrid stroke="var(--line-3)" strokeDasharray="2 4" vertical={false} />
                        <XAxis dataKey="nombre" stroke="var(--ink-4)" fontSize={10.5} tickLine={false} axisLine={false}
                          tickFormatter={(v: string) => v.length > 12 ? `${v.slice(0, 11)}…` : v} />
                        <YAxis stroke="var(--ink-4)" fontSize={10.5} tickLine={false} axisLine={false} tickFormatter={ejeQ} />
                        <Tooltip formatter={(v) => Q(Number(v))} contentStyle={tooltipStyle} />
                        <Bar dataKey="monto" radius={[2, 2, 0, 0]} maxBarSize={48}>
                          {porCC.map((g, i) => (
                            <Cell key={i} fill={CC_COLOR[nomCC(g.key)] ?? 'var(--ink-4)'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          )}

          {vista === 'mes' && (
            <>
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-head"><div className="card-title">Evolución mensual</div></div>
                <div className="card-pad">
                  <div style={{ width: '100%', height: 260 }}>
                    <ResponsiveContainer>
                      <BarChart
                        data={porMes.map(g => ({ mes: labelMes(g.key), monto: Math.round(g.montoQ) }))}
                        margin={{ top: 8, right: 12, bottom: 4, left: 0 }}
                      >
                        <CartesianGrid stroke="var(--line-3)" strokeDasharray="2 4" vertical={false} />
                        <XAxis dataKey="mes" stroke="var(--ink-4)" fontSize={10.5} tickLine={false} axisLine={false} />
                        <YAxis stroke="var(--ink-4)" fontSize={10.5} tickLine={false} axisLine={false} tickFormatter={ejeQ} />
                        <Tooltip formatter={(v) => Q(Number(v))} contentStyle={tooltipStyle} />
                        <Bar dataKey="monto" fill="var(--ink)" radius={[2, 2, 0, 0]} maxBarSize={48} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
              <div className="card" style={{ padding: 0 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Mes</th><th className="num">Facturas</th><th className="num">Total</th>
                      <th className="num">Δ vs mes anterior</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porMes.map((g, i) => {
                      const prev = i > 0 ? porMes[i - 1].montoQ : null;
                      const d = prev != null && prev > 0 ? ((g.montoQ - prev) / prev) * 100 : null;
                      return (
                        <tr key={g.key || 'sin'}>
                          <td>{g.key ? etiquetaMes(g.key) : 'Sin fecha'}</td>
                          <td className="num">{g.numFacturas}</td>
                          <td className="num">{Q(Math.round(g.montoQ))}</td>
                          <td className="num" style={{ color: d == null ? 'var(--ink-4)' : d >= 0 ? 'var(--olive)' : 'var(--wine)' }}>
                            {d == null ? '—' : `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {vista === 'detalle' && (
            <div className="card" style={{ padding: 0 }}>
              <div className="card-head">
                <div className="card-title">
                  Detalle · {detalle.length} facturas
                  {ccIds.length > 0 && <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}> (montos de las líneas filtradas)</span>}
                </div>
              </div>
              <div style={{ maxHeight: 560, overflowY: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>No. factura</th><th>Fecha</th><th>Cliente</th><th>Centro de costo</th>
                      <th className="num">Subtotal</th><th className="num">IVA</th><th className="num">Total</th><th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.slice(0, DETALLE_MAX).map(x => {
                      const badge = ESTADO_BADGE[x.f.estadoBruto] ?? ESTADO_BADGE.otro;
                      const ccs = [...new Set(
                        x.f.lineasCC
                          .filter(l => ccIds.length === 0 || ccIds.includes(l.ccId))
                          .map(l => nomCC(l.ccId)),
                      )];
                      return (
                        <tr key={x.f.id}>
                          <td className="num">{x.f.noFactura}</td>
                          <td>{fechaHumana(x.f.fecha)}</td>
                          <td>{nomCli(x.f.custId)}</td>
                          <td style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>{ccs.join(' + ') || '—'}</td>
                          <td className="num">{Q(Math.round(x.subtotalQ))}</td>
                          <td className="num" style={{ color: 'var(--ink-3)' }}>{Q(Math.round(x.ivaQ))}</td>
                          <td className="num" style={{ fontWeight: 500 }}>{Q(Math.round(x.totalQ))}</td>
                          <td><span className={`badge ${badge.cls}`}>{badge.text}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {detalle.length > DETALLE_MAX && (
                <div style={{ padding: '8px 12px', fontSize: 11.5, color: 'var(--ink-3)', borderTop: '1px solid var(--line-3)' }}>
                  Mostrando {DETALLE_MAX} de {detalle.length} — exportá el CSV para el detalle completo.
                </div>
              )}
            </div>
          )}
        </>
      )}

      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--ink-4)' }}>
        Universo: facturación emitida (excluye anuladas y refacturadas{numAnuladas > 0 ? ` — ${numAnuladas} en este filtro` : ''}).
        Cada factura cuenta por su total en su mes de emisión. Para cobranza, ver Pendientes de cobro.
      </div>
    </div>
  );
}

/* =========================================================================
 * Multi-select de clientes con búsqueda (dropdown con checkboxes)
 * ========================================================================= */

function MultiSelectClientes({
  clientes, seleccionados, onChange,
}: {
  clientes: Array<{ id: string; name: string }>;
  seleccionados: string[];
  onChange: (ids: string[]) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [abierto]);

  const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = normalizar(busqueda.trim());
  const visibles = useMemo(() => {
    const orden = [...clientes].sort((a, b) => a.name.localeCompare(b.name));
    return q ? orden.filter(c => normalizar(c.name).includes(q)) : orden;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientes, q]);

  const toggle = (id: string) => {
    onChange(seleccionados.includes(id) ? seleccionados.filter(x => x !== id) : [...seleccionados, id]);
  };

  const etiqueta = seleccionados.length === 0
    ? 'Todos los clientes'
    : seleccionados.length === 1
      ? (clientes.find(c => c.id === seleccionados[0])?.name ?? '1 cliente')
      : `${seleccionados.length} clientes`;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn btn-secondary" onClick={() => setAbierto(!abierto)} style={{ maxWidth: 240 }}>
        <I.Users size={13} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{etiqueta}</span>
        <I.ChevDown size={12} />
      </button>
      {abierto && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 30,
          width: 280, maxHeight: 340, display: 'flex', flexDirection: 'column',
          background: 'var(--paper)', border: '1px solid var(--line-2)', borderRadius: 6,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        }}>
          <div style={{ padding: 8, borderBottom: '1px solid var(--line-3)' }}>
            <input
              className="input"
              placeholder="Buscar cliente…"
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              autoFocus
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ overflowY: 'auto', padding: 4 }}>
            {seleccionados.length > 0 && (
              <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start', fontSize: 11.5 }}
                onClick={() => onChange([])}>
                <I.X size={12} /> Quitar selección ({seleccionados.length})
              </button>
            )}
            {visibles.map(c => (
              <label key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px',
                fontSize: 12.5, cursor: 'pointer', borderRadius: 4,
              }}>
                <input type="checkbox" checked={seleccionados.includes(c.id)} onChange={() => toggle(c.id)} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
              </label>
            ))}
            {visibles.length === 0 && (
              <div style={{ padding: 12, fontSize: 12, color: 'var(--ink-4)' }}>Sin resultados para “{busqueda}”.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
