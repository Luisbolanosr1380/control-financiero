'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from 'recharts';
import { I } from '@/components/common/icons';
import { Q } from '@/lib/utils';
import { NuevaDeudaButton } from '@/components/deudas/nueva-deuda-button';
import type { Acreedor, Deuda, KPIsDeudas, CategoriaPasivo } from '@/lib/db/deudas';

interface Props {
  deudas: Deuda[];
  kpis: KPIsDeudas;
  acreedores: Acreedor[];
  centros: Array<{ id: string; nombre: string }>;
  // F-042: deep-link desde /empleados a /deudas?categoria=empleados.
  initialCategoria?: CategoriaPasivo | '';
}

type EstadoFiltro = 'todas' | 'vigentes' | 'vencidas';

const CATEGORIA_LABELS: Record<CategoriaPasivo, string> = {
  externa:               '🔴 Externa',
  socios:                '🟡 Socios',
  empleados:             '🟢 Empleados (salarios)',   // F-037
  ex_empleados:          '🟠 Ex-empleados',
  asesores_relacionados: '🔵 Asesores / relacionados',
};

// Colores del bar chart de top acreedores, por categoría.
const CATEGORIA_COLORS: Record<CategoriaPasivo, string> = {
  externa:               '#8A2A2A',   // wine (rojo)
  socios:                '#B8801C',   // burnt (amarillo/dorado)
  empleados:             '#3D7A4E',   // verde — F-037
  ex_empleados:          '#D97A1A',   // naranja
  asesores_relacionados: '#2B3A6B',   // azul navy
};

const CATEGORIA_ICONS: Record<CategoriaPasivo, string> = {
  externa:               '',
  socios:                '🤝',
  empleados:             '👥',         // F-037
  ex_empleados:          '👤',
  asesores_relacionados: '🤵',
};

const DONUT_COLORS = ['#8A2A2A', '#B8801C', '#5A6A2E', '#2B3A6B', '#7A857F', '#1A3B33', '#A8B0AB', '#4A5A53'];

export function DeudasClient({ deudas, kpis, acreedores, centros, initialCategoria = '' }: Props) {
  const router = useRouter();

  const [estado, setEstado] = useState<EstadoFiltro>('todas');
  const [tipoDoc, setTipoDoc] = useState<string>('');
  const [acreedorId, setAcreedorId] = useState<string>('');
  const [centroId, setCentroId] = useState<string>('');
  const [categoria, setCategoria] = useState<CategoriaPasivo | ''>(initialCategoria);
  const [search, setSearch] = useState('');
  const [verTodasVencidas, setVerTodasVencidas] = useState(false);

  // Opciones únicas para filtros
  const tiposDoc = useMemo(() => [...new Set(deudas.map(d => d.tipoDocumento).filter(Boolean))].sort(), [deudas]);
  // Usa la lista completa de centros activos (prop) — incluye centros sin deudas todavía.
  const centrosFiltro = useMemo(() => [...centros].sort((a, b) => a.nombre.localeCompare(b.nombre)), [centros]);

  const vencidas = useMemo(() => deudas.filter(d => d.vencida || d.diasEnMora > 0).sort((a, b) => b.diasEnMora - a.diasEnMora), [deudas]);

  // Listado filtrado
  const rows = useMemo(() => {
    let r = deudas;
    if (estado === 'vigentes')  r = r.filter(d => !d.vencida && d.diasEnMora === 0);
    if (estado === 'vencidas')  r = r.filter(d => d.vencida || d.diasEnMora > 0);
    if (tipoDoc)                r = r.filter(d => d.tipoDocumento === tipoDoc);
    if (acreedorId)             r = r.filter(d => d.acreedorId === acreedorId);
    if (centroId)               r = r.filter(d => d.centroCostoId === centroId);
    if (categoria)              r = r.filter(d => d.categoriaPasivo === categoria);
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(d =>
        d.acreedorNombre.toLowerCase().includes(q) ||
        d.nombreDeuda.toLowerCase().includes(q) ||
        d.tipoDocumento.toLowerCase().includes(q),
      );
    }
    // Vencidas primero, luego por días para vencer ascendente
    return [...r].sort((a, b) => {
      const av = (a.vencida || a.diasEnMora > 0) ? 1 : 0;
      const bv = (b.vencida || b.diasEnMora > 0) ? 1 : 0;
      if (av !== bv) return bv - av;
      return a.diasAVencer - b.diasAVencer;
    });
  }, [deudas, estado, tipoDoc, acreedorId, centroId, categoria, search]);

  const sumaSaldoFiltrado = rows.reduce((s, d) => s + d.saldoPendiente, 0);

  const limpiarFiltros = () => {
    setEstado('todas'); setTipoDoc(''); setAcreedorId(''); setCentroId('');
    setCategoria(''); setSearch('');
  };

  const verVencidas = () => {
    setEstado('vencidas');
    limpiarOtrosFiltros();
  };
  function limpiarOtrosFiltros() {
    setTipoDoc(''); setAcreedorId(''); setCentroId('');
    setCategoria(''); setSearch('');
  }

  const donutData = kpis.porTipo.map((p, i) => ({ name: p.tipo, value: p.saldo, color: DONUT_COLORS[i % DONUT_COLORS.length] }));
  const barData   = kpis.porAcreedor.map(p => ({ name: p.acreedor, saldo: p.saldo, categoria: p.categoria }));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Deudas y pasivos</h1>
          <div className="page-subtitle">
            Pasivo total: <span className="num">{Q(kpis.totalPasivo)}</span> · <span className="num">{deudas.length}</span> deudas vigentes
          </div>
        </div>
        <div className="page-actions">
          <NuevaDeudaButton acreedores={acreedores} centros={centros} />
        </div>
      </div>

      {/* 1. HERO — 7 KPIs (5 categorías + mora + próximos) en grid 4×2.
            F-037: nueva categoría "Empleados" para salarios diferidos a activos. */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 22 }}>
        <KpiCard
          label="🔴 Deuda externa"
          value={Q(kpis.porCategoria.externa.monto)}
          hint={`${kpis.porCategoria.externa.cantidad} deudas · bancos, fisco, tarjetas, proveedores`}
        />
        <KpiCard
          label="🟡 Con socios"
          value={Q(kpis.porCategoria.socios.monto)}
          hint={`${kpis.porCategoria.socios.cantidad} deudas · parte relacionada accionaria`}
        />
        <KpiCard
          label="🟢 Salarios pendientes"
          value={Q(kpis.porCategoria.empleados.monto)}
          hint={`${kpis.porCategoria.empleados.cantidad} deudas · empleados activos (riesgo laboral)`}
          alarma={kpis.porCategoria.empleados.monto > 0}
        />
        <KpiCard
          label="🟠 Con ex-empleados"
          value={Q(kpis.porCategoria.ex_empleados.monto)}
          hint={`${kpis.porCategoria.ex_empleados.cantidad} deudas · prioridad por riesgo laboral`}
        />
        <KpiCard
          label="🔵 Asesores / relacionados"
          value={Q(kpis.porCategoria.asesores_relacionados.monto)}
          hint={`${kpis.porCategoria.asesores_relacionados.cantidad} deudas · proveedores con vínculo cercano`}
        />
        <KpiCard
          label={kpis.vencidas.cantidad > 0 ? '⚠️ Vencido y en mora' : '✓ Sin vencidas'}
          value={Q(kpis.vencidas.montoTotal)}
          hint={kpis.vencidas.cantidad > 0
            ? `${kpis.vencidas.cantidad} deudas · ${kpis.vencidas.diasPromedioMora.toFixed(0)} días promedio`
            : 'Sin deudas en mora'}
          alarma={kpis.vencidas.cantidad > 0}
        />
        <KpiCard
          label="📅 Vence en 30 días"
          value={Q(kpis.proximosVencimientos.montoTotal)}
          hint={`${kpis.proximosVencimientos.cantidad} deudas próximas`}
        />
        <KpiCard
          label="💼 Total pasivo"
          value={Q(kpis.totalPasivo)}
          hint="Suma de todas las categorías"
        />
      </div>

      {/* 2. BLOQUE ATENCIÓN INMEDIATA */}
      {vencidas.length > 0 && (
        <div className="card" style={{
          marginBottom: 22,
          borderLeft: '4px solid var(--wine)',
          background: 'rgba(138, 42, 42, 0.04)',
        }}>
          <div className="card-head" style={{ borderBottom: '1px solid var(--line-3)' }}>
            <div className="card-title" style={{ color: 'var(--wine)' }}>
              <I.Alert size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              Atención inmediata · {vencidas.length} deudas vencidas
            </div>
            <div className="card-actions">
              <button className="btn btn-secondary" onClick={() => setVerTodasVencidas(v => !v)}>
                {verTodasVencidas ? 'Mostrar 5' : `Ver las ${vencidas.length}`}
              </button>
              <button className="btn btn-primary" onClick={verVencidas}>
                Filtrar listado <I.ChevDown size={12} />
              </button>
            </div>
          </div>
          <div style={{ padding: '8px 0' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Acreedor</th>
                  <th>Tipo</th>
                  <th className="num">Saldo</th>
                  <th className="num">Días en mora</th>
                  <th>Centro de costo</th>
                </tr>
              </thead>
              <tbody>
                {(verTodasVencidas ? vencidas : vencidas.slice(0, 5)).map(d => (
                  <tr key={d.id} className="clickable" onClick={() => router.push(`/deudas/${d.id}`)}>
                    <td className="cell-strong" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {d.esParteRelacionada && <span title="Parte relacionada (socio)">🤝</span>}
                      <span
                        onClick={(e) => { e.stopPropagation(); router.push(`/acreedores/${d.acreedorId}`); }}
                        style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
                      >
                        {d.acreedorNombre}
                      </span>
                    </td>
                    <td><span className="badge badge-outline">{d.tipoDocumento}</span></td>
                    <td className="num cell-strong">{Q(d.saldoPendiente)}</td>
                    <td className="num" style={{ color: 'var(--wine)', fontWeight: 600 }}>{d.diasEnMora} d</td>
                    <td className="cell-mute">{d.centroCostoNombre || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. COMPOSICIÓN DEL PASIVO — dos charts lado a lado */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22, marginBottom: 22 }}>
        <div className="card">
          <div className="card-head"><div className="card-title">Pasivo por tipo de documento</div></div>
          <div style={{ height: 260, padding: '8px 12px' }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip
                  formatter={(v: number, n: string) => [Q(v), n]}
                  contentStyle={{ background: 'var(--paper)', border: '1px solid var(--line-2)', borderRadius: 4, fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ padding: '0 16px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11.5 }}>
            {donutData.map((d, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color }} />
                <span style={{ color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                <span className="num" style={{ marginLeft: 'auto', color: 'var(--ink-3)' }}>{Q(d.value)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="card-title">Top 10 acreedores por saldo</div></div>
          <div style={{ height: 320, padding: '8px 12px' }}>
            <ResponsiveContainer>
              <BarChart data={barData} layout="vertical" margin={{ top: 8, right: 16, bottom: 4, left: 16 }}>
                <CartesianGrid stroke="var(--line-3)" strokeDasharray="2 4" horizontal={false} />
                <XAxis type="number" stroke="var(--ink-4)" fontSize={10.5} tickLine={false} axisLine={false}
                  tickFormatter={(v: number) => v >= 1000 ? `Q${Math.round(v / 1000)}K` : `Q${v}`}
                />
                <YAxis dataKey="name" type="category" stroke="var(--ink-4)" fontSize={10.5} tickLine={false} axisLine={false} width={140}
                  tick={(props) => {
                    const { x, y, payload } = props as { x: number; y: number; payload: { value: string } };
                    const it = barData.find(b => b.name === payload.value);
                    const icon = it ? CATEGORIA_ICONS[it.categoria] : '';
                    const prefix = icon ? `${icon} ` : '';
                    const label = prefix + (payload.value.length > 18 ? payload.value.slice(0, 17) + '…' : payload.value);
                    return <text x={x} y={y} dy={4} textAnchor="end" fontSize={10.5} fill="var(--ink-2)">{label}</text>;
                  }}
                />
                <Tooltip
                  formatter={(v: number) => Q(v)}
                  contentStyle={{ background: 'var(--paper)', border: '1px solid var(--line-2)', borderRadius: 4, fontSize: 12 }}
                />
                <Bar dataKey="saldo" radius={[0, 3, 3, 0]} maxBarSize={22}>
                  {barData.map((b, i) => <Cell key={i} fill={CATEGORIA_COLORS[b.categoria]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ padding: '0 16px 12px', display: 'flex', gap: 12, fontSize: 10.5, color: 'var(--ink-3)', flexWrap: 'wrap' }}>
            {(['externa', 'socios', 'ex_empleados', 'asesores_relacionados'] as CategoriaPasivo[]).map(c => (
              <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: CATEGORIA_COLORS[c] }} />
                {CATEGORIA_LABELS[c]}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 4. LISTADO CONSOLIDADO */}
      <div className="card" style={{ padding: 0 }}>
        <div className="card-head">
          <div className="card-title">Todas las deudas vigentes</div>
          <div className="card-actions" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
            <span>{rows.length} resultados</span>
            <span style={{ margin: '0 8px', color: 'var(--line-2)' }}>·</span>
            <span className="num">Suma: {Q(sumaSaldoFiltrado)}</span>
          </div>
        </div>

        {/* Filtros */}
        <div style={{ display: 'flex', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--line-3)', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="tabs" style={{ marginBottom: 0 }}>
            {(['todas', 'vigentes', 'vencidas'] as const).map(t => (
              <button key={t} className={'tab' + (estado === t ? ' active' : '')} onClick={() => setEstado(t)}>
                {t === 'todas' ? 'Todas' : t === 'vigentes' ? 'Vigentes' : 'Vencidas'}
              </button>
            ))}
          </div>
          <select value={tipoDoc} onChange={(e) => setTipoDoc(e.target.value)} style={inputStyle}>
            <option value="">Tipo (todos)</option>
            {tiposDoc.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={acreedorId} onChange={(e) => setAcreedorId(e.target.value)} style={inputStyle}>
            <option value="">Acreedor (todos)</option>
            {acreedores.map(a => <option key={a.id} value={a.id}>{a.nombre || a.nombreLegal}</option>)}
          </select>
          <select value={centroId} onChange={(e) => setCentroId(e.target.value)} style={inputStyle}>
            <option value="">Centro de costo (todos)</option>
            {centrosFiltro.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <select value={categoria} onChange={(e) => setCategoria((e.target.value || '') as CategoriaPasivo | '')} style={inputStyle}>
            <option value="">Categoría (todas)</option>
            <option value="externa">{CATEGORIA_LABELS.externa}</option>
            <option value="socios">{CATEGORIA_LABELS.socios}</option>
            <option value="ex_empleados">{CATEGORIA_LABELS.ex_empleados}</option>
            <option value="asesores_relacionados">{CATEGORIA_LABELS.asesores_relacionados}</option>
          </select>
          <div className="toolbar-search" style={{ marginLeft: 'auto' }}>
            <I.Search size={13} style={{ color: 'var(--ink-4)' }} />
            <input placeholder="Acreedor, nombre, tipo..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button className="btn btn-ghost" onClick={limpiarFiltros} style={{ fontSize: 11 }}>
            Limpiar
          </button>
        </div>

        <div className="table-wrap" style={{ borderRadius: '0 0 var(--r-3) var(--r-3)', borderTop: 'none' }}>
          <table className="table" style={{ tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th>Acreedor</th>
                <th style={{ width: 130 }}>Tipo</th>
                <th className="num" style={{ width: 120 }}>Saldo</th>
                <th className="num" style={{ width: 120 }}>Monto original</th>
                <th className="num" style={{ width: 90 }}>Avance</th>
                <th className="num" style={{ width: 110 }}>Vencimiento</th>
                <th className="num" style={{ width: 100 }}>Mora</th>
                <th style={{ width: 120 }}>Semáforo</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={8} style={{ height: 180, textAlign: 'center', color: 'var(--ink-4)' }}>
                  <I.Debt size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
                  {deudas.length === 0 ? (
                    <>
                      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink-2)', marginBottom: 2 }}>No hay deudas registradas todavía</div>
                      <div style={{ fontSize: 12.5 }}>Tocá <strong>&quot;+ Nueva deuda&quot;</strong> arriba para crear la primera.</div>
                    </>
                  ) : (
                    <div style={{ fontSize: 13 }}>No hay deudas que coincidan con el filtro</div>
                  )}
                </td></tr>
              ) : rows.map(d => {
                const morColor = d.diasEnMora > 0 ? 'var(--wine)' : d.diasAVencer <= 7 ? 'var(--burnt)' : 'var(--ink-3)';
                return (
                  <tr key={d.id} className="clickable" onClick={() => router.push(`/deudas/${d.id}`)}>
                    <td className="cell-strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.acreedorNombre}>
                      {d.esParteRelacionada && <span style={{ marginRight: 4 }} title="Parte relacionada (socio)">🤝</span>}
                      <span
                        onClick={(e) => { e.stopPropagation(); router.push(`/acreedores/${d.acreedorId}`); }}
                        style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
                      >
                        {d.acreedorNombre}
                      </span>
                    </td>
                    <td><span className="badge badge-outline" style={{ fontSize: 10.5 }}>{d.tipoDocumento || '—'}</span></td>
                    <td className="num cell-strong">{Q(d.saldoPendiente)}</td>
                    <td className="num cell-mute">{Q(d.montoOriginal)}</td>
                    <td className="num cell-mute">{d.pctAvance > 0 ? `${Math.round(d.pctAvance)}%` : '—'}</td>
                    <td className="num cell-mute" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{d.fechaVencimientoReal ? formatVenc(d.fechaVencimientoReal) : '—'}</td>
                    <td className="num" style={{ color: morColor, fontWeight: d.diasEnMora > 0 ? 600 : 400 }}>
                      {d.diasEnMora > 0 ? `+${d.diasEnMora} d` : d.diasAVencer >= 0 ? `${d.diasAVencer} d` : '—'}
                    </td>
                    <td style={{ fontSize: 12 }}>{d.semaforoVencimiento || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontSize: 12, padding: '5px 8px', borderRadius: 4,
  border: '1px solid var(--line-2)', background: 'var(--paper-2)',
  color: 'var(--ink)', fontFamily: 'inherit',
};

function KpiCard({ label, value, hint, alarma }: { label: string; value: string; hint?: string; alarma?: boolean }) {
  return (
    <div className="kpi" style={alarma ? { borderRight: '1px solid var(--line-2)' } : undefined}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={alarma ? { color: 'var(--wine)' } : undefined}>{value}</div>
      {hint && <div className="kpi-delta"><span className="vs">{hint}</span></div>}
    </div>
  );
}

function formatVenc(s: string): string {
  // "Fecha_Vencimiento_Real" puede venir como ISO o como "SIN-FECHA"
  if (!s || s === 'SIN-FECHA') return '—';
  const d = s.slice(0, 10);
  // dd/mm/yyyy
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return s;
  return `${day}/${m}/${y}`;
}
