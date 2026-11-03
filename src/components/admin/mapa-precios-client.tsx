'use client';

/**
 * ADMIN · MAPA DE PRECIOS (027). Solo admin (la página y el loader lo exigen; acá solo se pinta).
 * Controles (rango de ingreso + umbrales → search params, recalcula en SQL), KPIs, matriz de cuadrantes
 * (dispersión: x pruebas en log, y índice, tamaño producción, color cuadrante, líneas en los umbrales),
 * brecha por cliente (top 15), rangos de precio por línea (min–p25–mediana–p75–max + precio real; sin / con
 * IVA), franjas preempleo, producción por servicio y la tabla de clientes (orden, buscador, filtro por
 * cuadrante, CSV, link al tarifario). Nota metodológica al pie. Montos SIN IVA salvo el interruptor.
 * Sin diálogos del navegador. Recharts (ya en uso en la app), sin dependencias nuevas.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import { I } from '@/components/common/icons';
import { HelpButton } from '@/components/ayuda/help-button';
import { Q } from '@/lib/utils';
import { buscarClientes } from '@/lib/clientes/buscar';
import {
  COLOR_CUADRANTE, COLUMNAS_CLIENTES, CUADRANTES, DESCRIPCION_CUADRANTE, conIva, csvClientes, etiquetaFecha, filtrosPorDefecto, ordenarClientes, queryDeFiltros,
  type ClienteMapa, type ColumnaClientes, type Cuadrante, type FiltrosMapa, type MapaPrecios,
} from '@/lib/precios/mapa';

interface Props { datos: MapaPrecios | null; filtros: FiltrosMapa }

const Qk = (v: number): string => (Math.abs(v) >= 1000 ? `Q${Math.round(v / 1000)}k` : `Q${Math.round(v)}`);
const pct = (v: number): string => `${v.toLocaleString('es-GT', { maximumFractionDigits: 1 })} %`;
const idx = (v: number): string => v.toFixed(2);
const ETIQUETA_SERVICIO: Record<string, string> = { POLIGRAFO: 'Polígrafo', SOCIOECONOMICO: 'Socioeconómico', 'POLIGRAFO BASIC': 'Polígrafo basic' };
const nombreServicio = (s: string): string => ETIQUETA_SERVICIO[s] ?? s.charAt(0) + s.slice(1).toLowerCase();

function BadgeCuadrante({ c }: { c: Cuadrante }) {
  return <span className="badge" style={{ background: `${COLOR_CUADRANTE[c]}1a`, color: COLOR_CUADRANTE[c], whiteSpace: 'nowrap' }} data-cuadrante={c}>{c}</span>;
}

function TooltipCliente({ active, payload }: { active?: boolean; payload?: Array<{ payload: ClienteMapa }> }) {
  if (!active || !payload?.length) return null;
  const c = payload[0].payload;
  return (
    <div className="card" style={{ padding: '8px 10px', fontSize: 12, lineHeight: 1.5, boxShadow: '0 4px 14px rgba(0,0,0,.12)' }}>
      <div className="cell-strong">{c.cliente}</div>
      <div>{c.pruebas} pruebas · {Q(c.produccion)}</div>
      <div>Índice {idx(c.indice)} · brecha {Q(c.brecha)}</div>
      <div style={{ color: COLOR_CUADRANTE[c.cuadrante] }}>{c.cuadrante}</div>
    </div>
  );
}

export function MapaPreciosClient({ datos, filtros }: Props) {
  const router = useRouter();
  const [f, setF] = useState<FiltrosMapa>(filtros);
  const [ivaOn, setIvaOn] = useState(false);
  const [busq, setBusq] = useState('');
  const [cuadFiltro, setCuadFiltro] = useState<Cuadrante | ''>('');
  const [orden, setOrden] = useState<{ col: ColumnaClientes; dir: 'asc' | 'desc' }>({ col: 'produccion', dir: 'desc' });

  const r = datos?.resumen;
  const clientes = datos?.clientes ?? [];
  const cuadrantes = useMemo(() => CUADRANTES.map(q => (r?.cuadrantes ?? []).find(x => x.cuadrante === q) ?? { cuadrante: q, clientes: 0, pruebas: 0, produccion: 0, brecha: 0, pct_clientes: 0, pct_pruebas: 0, pct_produccion: 0, pct_brecha: 0 }), [r]);
  const topBrecha = useMemo(() => [...clientes].filter(c => c.brecha > 0).sort((a, b) => b.brecha - a.brecha).slice(0, 15), [clientes]);
  const buscables = useMemo(() => clientes.map(c => ({ id: c.nit, name: c.cliente, nit: c.nit, _c: c })), [clientes]);
  const tabla = useMemo(() => {
    const base = buscarClientes(buscables, busq).map(b => b._c).filter(c => !cuadFiltro || c.cuadrante === cuadFiltro);
    return ordenarClientes(base, orden.col, orden.dir);
  }, [buscables, busq, cuadFiltro, orden]);
  const fmt = (q: number) => Q(ivaOn ? conIva(q) : q);
  const dominioX = useMemo(() => { const xs = clientes.map(c => c.pruebas).filter(x => x > 0); if (!xs.length) return [1, 100] as [number, number]; return [Math.max(1, Math.floor(Math.min(...xs) * 0.8)), Math.ceil(Math.max(...xs) * 1.25)] as [number, number]; }, [clientes]);
  // Ticks "bonitos" para la escala log: 1, 2, 5 × 10^k dentro del dominio (recharts no los genera solo).
  const ticksX = useMemo(() => { const out: number[] = []; for (let k = 0; k <= 6; k++) for (const m of [1, 2, 5]) { const v = m * 10 ** k; if (v >= dominioX[0] && v <= dominioX[1]) out.push(v); } return out.length ? out : [dominioX[0], dominioX[1]]; }, [dominioX]);
  const dominioY = useMemo(() => { const ys = clientes.map(c => c.indice); const max = Math.max(1.2, ...(ys.length ? ys : [1])); return [0, Math.ceil(max * 10) / 10] as [number, number]; }, [clientes]);
  const refs = datos?.referencias ?? [];
  const escalaRef = useMemo(() => { const vals = refs.flatMap(x => [x.minimo, x.maximo, x.precio_real ?? 0]); return { min: Math.min(0, ...vals), max: Math.max(1, ...vals) }; }, [refs]);
  const posRef = (v: number) => `${((v - escalaRef.min) / (escalaRef.max - escalaRef.min || 1)) * 100}%`;

  const aplicar = () => router.push(`/admin/precios${queryDeFiltros({ ...f, hasta: f.hasta < f.desde ? f.desde : f.hasta })}`);
  const restablecer = () => { const d = filtrosPorDefecto(new Date()); setF(d); router.push(`/admin/precios${queryDeFiltros(d)}`); };
  const exportar = () => {
    const blob = new Blob([csvClientes(tabla, filtros)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `mapa-precios-${filtros.desde}_${filtros.hasta}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const ordenarPor = (col: ColumnaClientes) => setOrden(o => (o.col === col ? { col, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: COLUMNAS_CLIENTES.find(c => c.k === col)?.num ? 'desc' : 'asc' }));
  const filtrosValidos = /^\d{4}-\d{2}-\d{2}$/.test(f.desde) && /^\d{4}-\d{2}-\d{2}$/.test(f.hasta) && f.umbralVol >= 1 && f.umbralIdx > 0;

  return (
    <div className="page" data-pagina="mapa-precios">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Mapa de precios <HelpButton tag="mapa de precios" /></h1>
          <div className="page-subtitle">Cuánto vale cada cliente <strong>a su tarifa</strong> frente a la <strong>mediana del mercado</strong> (lo que cobran los demás por el mismo servicio y categoría), en qué cuadrante queda y cuánta brecha deja. Pruebas que cobran con tarifa resuelta, ingresadas del {etiquetaFecha(filtros.desde)} al {etiquetaFecha(filtros.hasta)}. Montos <strong>sin IVA</strong>. Solo admin.</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={exportar} disabled={!datos || !tabla.length} data-accion="exportar-csv"><I.Download size={13} /> Exportar CSV</button>
        </div>
      </div>

      {!datos && <div className="card" style={{ borderColor: 'var(--warn)', marginBottom: 16 }} role="status" data-falta-027><div className="card-pad" style={{ fontSize: 13 }}>Falta aplicar la migración <strong>027_precios_mapa</strong> en esta base: el mapa se calcula en SQL y sin ella no hay datos. Aplicarla no cambia ningún dato; solo crea la función de lectura.</div></div>}

      {/* Controles */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }} data-controles>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>Ingresos desde <input className="input" type="date" value={f.desde} onChange={e => setF({ ...f, desde: e.target.value })} data-campo="desde" aria-label="Desde" /></label>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>hasta <input className="input" type="date" value={f.hasta} onChange={e => setF({ ...f, hasta: e.target.value })} data-campo="hasta" aria-label="Hasta" /></label>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }} title="Pruebas en el periodo a partir de las cuales el cliente cuenta como de volumen">Umbral volumen <input className="input" type="number" min={1} step={1} value={f.umbralVol} onChange={e => setF({ ...f, umbralVol: Number(e.target.value) })} style={{ width: 80 }} data-campo="vol" aria-label="Umbral de volumen (pruebas)" /></label>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }} title="Índice de precio (producción ÷ producción a mercado) a partir del cual el cliente cuenta como de buen precio">Umbral índice <input className="input" type="number" min={0.05} max={10} step={0.05} value={f.umbralIdx} onChange={e => setF({ ...f, umbralIdx: Number(e.target.value) })} style={{ width: 80 }} data-campo="idx" aria-label="Umbral de índice" /></label>
          <button className="btn btn-primary" onClick={aplicar} disabled={!filtrosValidos} data-accion="aplicar">Aplicar</button>
          <button className="btn btn-ghost" onClick={restablecer} data-accion="restablecer">Restablecer</button>
          <span style={{ marginLeft: 'auto', color: 'var(--ink-4)' }}>{datos ? `${r!.clientes} clientes · ${r!.pruebas} pruebas` : '—'}{datos ? ` · al ${datos.parametros.hoy}` : ''}</span>
        </div>
      </div>

      {/* KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)', marginBottom: 14 }}>
        <div className="kpi" data-kpi="produccion" title="Suma del precio de tarifa de cada prueba que cobra, sin IVA"><div className="kpi-label">Producción a tarifa</div><div className="kpi-value">{r ? Q(r.produccion) : '—'}</div><div className="kpi-delta"><span className="vs">sin IVA</span></div></div>
        <div className="kpi" data-kpi="pruebas"><div className="kpi-label">Pruebas · clientes</div><div className="kpi-value">{r ? `${r.pruebas.toLocaleString('es-GT')} · ${r.clientes}` : '—'}</div><div className="kpi-delta"><span className="vs">con tarifa resuelta</span></div></div>
        <div className="kpi" data-kpi="concentracion" title="Participación de los clientes más grandes en la producción"><div className="kpi-label">Concentración top 5 · 10 · 20</div><div className="kpi-value" style={{ fontSize: 17, whiteSpace: 'nowrap' }}>{r ? `${r.top5} · ${r.top10} · ${r.top20} %` : '—'}</div><div className="kpi-delta"><span className="vs">{r?.mayor_cliente ? `mayor: ${r.mayor_cliente.cliente}` : ''}</span></div></div>
        <div className="kpi" data-kpi="brecha" title="Lo que se deja sobre la mesa por cobrar debajo de la mediana del mercado (suma de las brechas por cliente)"><div className="kpi-label">Brecha total</div><div className="kpi-value" style={{ color: 'var(--wine)' }}>{r ? Q(r.brecha) : '—'}</div><div className="kpi-delta"><span className="vs">{r && r.produccion > 0 ? `${pct(Math.round((r.brecha / r.produccion) * 1000) / 10)} de la producción` : ''}</span></div></div>
        <div className="kpi" data-kpi="mayor-brecha"><div className="kpi-label">Cliente con mayor brecha</div><div className="kpi-value" style={{ fontSize: 16, lineHeight: 1.25 }}>{r?.mayor_brecha && r.mayor_brecha.brecha > 0 ? r.mayor_brecha.cliente : '—'}</div><div className="kpi-delta"><span className="vs">{r?.mayor_brecha && r.mayor_brecha.brecha > 0 ? `${Q(r.mayor_brecha.brecha)} · índice ${idx(r.mayor_brecha.indice)}` : 'sin brecha'}</span></div></div>
        <div className="kpi" data-kpi="mayor-indice"><div className="kpi-label">Mayor índice de precio</div><div className="kpi-value" style={{ fontSize: 16, lineHeight: 1.25 }}>{r?.mayor_indice ? r.mayor_indice.cliente : '—'}</div><div className="kpi-delta"><span className="vs">{r?.mayor_indice ? `índice ${idx(r.mayor_indice.indice)} · ${r.mayor_indice.pruebas} pruebas` : ''}</span></div></div>
      </div>

      {/* Matriz de cuadrantes */}
      <div className="card" style={{ marginBottom: 12 }} data-seccion="cuadrantes">
        <div className="card-head"><div className="card-title">Matriz de cuadrantes</div><div className="card-actions" style={{ fontSize: 12, color: 'var(--ink-4)' }}>x pruebas (log) · y índice de precio · tamaño producción · líneas en los umbrales ({filtros.umbralVol} pruebas, {idx(filtros.umbralIdx)})</div></div>
        <div className="card-pad" style={{ paddingTop: 0 }}>
          <div style={{ width: '100%', height: 360 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 12, right: 24, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line-2, #e5e5e5)" />
                <XAxis type="number" dataKey="pruebas" name="Pruebas" scale="log" domain={dominioX} ticks={ticksX} allowDataOverflow tick={{ fontSize: 11 }} tickFormatter={(v: number) => String(Math.round(v))} label={{ value: 'Pruebas en el periodo (escala log)', position: 'insideBottom', offset: -2, fontSize: 11 }} />
                <YAxis type="number" dataKey="indice" name="Índice" domain={dominioY} tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(1)} width={40} label={{ value: 'Índice', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                <ZAxis type="number" dataKey="produccion" range={[40, 900]} name="Producción" />
                <Tooltip content={<TooltipCliente />} cursor={{ strokeDasharray: '3 3' }} />
                <ReferenceLine x={filtros.umbralVol} stroke="var(--ink-3, #777)" strokeDasharray="4 4" />
                <ReferenceLine y={filtros.umbralIdx} stroke="var(--ink-3, #777)" strokeDasharray="4 4" />
                {CUADRANTES.map(q => (
                  <Scatter key={q} name={q} data={clientes.filter(c => c.cuadrante === q)} fill={COLOR_CUADRANTE[q]} fillOpacity={0.75} isAnimationActive={false}>
                    {clientes.filter(c => c.cuadrante === q).map(c => <Cell key={c.nit} fill={COLOR_CUADRANTE[q]} />)}
                  </Scatter>
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 10 }}>
            {cuadrantes.map(q => (
              <div key={q.cuadrante} className="kpi" style={{ borderTop: `3px solid ${COLOR_CUADRANTE[q.cuadrante]}`, cursor: 'pointer' }} onClick={() => setCuadFiltro(cuadFiltro === q.cuadrante ? '' : q.cuadrante)} data-tarjeta-cuadrante={q.cuadrante} title={DESCRIPCION_CUADRANTE[q.cuadrante]} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCuadFiltro(cuadFiltro === q.cuadrante ? '' : q.cuadrante); } }}>
                <div className="kpi-label" style={{ color: COLOR_CUADRANTE[q.cuadrante] }}>{q.cuadrante}</div>
                <div className="kpi-value" style={{ fontSize: 18 }}>{q.clientes} cliente{q.clientes === 1 ? '' : 's'} · {pct(q.pct_produccion)}</div>
                <div className="kpi-delta"><span className="vs">{Q(q.produccion)} · {q.pruebas} pruebas{q.brecha > 0 ? ` · brecha ${Q(q.brecha)}` : ''}</span></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12, marginBottom: 12 }} className="grid-2-1">
        {/* Brecha por cliente */}
        <div className="card" data-seccion="brecha">
          <div className="card-head"><div className="card-title">Brecha por cliente · top 15</div><div className="card-actions" style={{ fontSize: 12, color: 'var(--ink-4)' }}>producción a mercado − producción, sin IVA</div></div>
          <div className="card-pad" style={{ paddingTop: 0 }}>
            {topBrecha.length === 0 ? <div style={{ padding: 18, textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>Sin brecha: ningún cliente cobra debajo de la mediana.</div> : (
              <div style={{ width: '100%', height: Math.max(160, topBrecha.length * 26 + 30) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topBrecha} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 4 }}>
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={Qk} />
                    <YAxis type="category" dataKey="cliente" width={150} tick={{ fontSize: 11 }} interval={0} />
                    <Tooltip formatter={(v: number) => Q(v)} labelStyle={{ fontSize: 12 }} contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="brecha" name="Brecha" isAnimationActive={false} radius={[0, 3, 3, 0]} label={{ position: 'right', fontSize: 10, formatter: (v: number) => Qk(v) }}>
                      {topBrecha.map(c => <Cell key={c.nit} fill={COLOR_CUADRANTE[c.cuadrante]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        {/* Producción por servicio */}
        <div className="card" data-seccion="servicios">
          <div className="card-head"><div className="card-title">Producción por servicio</div><div className="card-actions" style={{ fontSize: 12, color: 'var(--ink-4)' }}>pruebas y precio promedio</div></div>
          <div className="card-pad" style={{ paddingTop: 0 }}>
            <div style={{ width: '100%', height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={(datos?.servicios ?? []).slice(0, 8).map(s => ({ ...s, nombre: nombreServicio(s.servicio) }))} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--line-2, #e5e5e5)" />
                  <XAxis dataKey="nombre" tick={{ fontSize: 10 }} interval={0} />
                  <YAxis tick={{ fontSize: 11 }} width={34} />
                  <Tooltip formatter={(v: number, k: string) => (k === 'Pruebas' ? v : Q(v))} contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="pruebas" name="Pruebas" fill="#2B3A6B" isAnimationActive={false} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="table-scroll" style={{ marginTop: 6 }}>
              <table className="table" data-tabla="servicios">
                <thead><tr><th>Servicio</th><th className="num">Pruebas</th><th className="num">Producción</th><th className="num">Precio promedio</th></tr></thead>
                <tbody>
                  {(datos?.servicios ?? []).map(s => <tr key={s.servicio} data-servicio={s.servicio}><td className="cell-strong">{nombreServicio(s.servicio)}</td><td className="num">{s.pruebas}</td><td className="num">{Q(s.produccion)}</td><td className="num">{Q(s.precio_promedio)}</td></tr>)}
                  {!(datos?.servicios ?? []).length && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 14, color: 'var(--ink-4)' }}>Sin pruebas en el periodo.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Rangos de precio por línea */}
      <div className="card" style={{ marginBottom: 12 }} data-seccion="referencias">
        <div className="card-head">
          <div className="card-title">Rangos de precio por línea</div>
          <div className="card-actions" style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 12 }}>
            <span style={{ color: 'var(--ink-4)' }}>tarifario activo: mín – p25 – mediana – p75 – máx · punto = precio real cobrado</span>
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={ivaOn} onChange={e => setIvaOn(e.target.checked)} data-accion="con-iva" /> con IVA (× 1.12)</label>
          </div>
        </div>
        <div className="table-scroll">
          <table className="table" data-tabla="referencias" data-iva={ivaOn ? 'con' : 'sin'}>
            <thead><tr><th>Línea</th><th style={{ minWidth: 260 }}>Rango</th><th className="num">Mín</th><th className="num">p25</th><th className="num">Mediana</th><th className="num">p75</th><th className="num">Máx</th><th className="num">Precio real</th><th className="num">Pruebas</th><th className="num">Clientes con tarifa</th></tr></thead>
            <tbody>
              {refs.map(x => (
                <tr key={`${x.servicio}|${x.categoria}`} data-linea={`${x.servicio}|${x.categoria}`}>
                  <td className="cell-strong" style={{ whiteSpace: 'nowrap' }}>{nombreServicio(x.servicio)} <span className="cell-mute">· {x.categoria ?? 'única'}</span></td>
                  <td>
                    <div style={{ position: 'relative', height: 18, minWidth: 240 }} aria-label={`mín ${fmt(x.minimo)}, p25 ${fmt(x.p25)}, mediana ${fmt(x.mediana)}, p75 ${fmt(x.p75)}, máx ${fmt(x.maximo)}${x.precio_real !== null ? `, real ${fmt(x.precio_real)}` : ''}`}>
                      <div style={{ position: 'absolute', top: 8, left: posRef(x.minimo), width: `calc(${posRef(x.maximo)} - ${posRef(x.minimo)})`, height: 2, background: 'var(--ink-4, #999)' }} />
                      <div style={{ position: 'absolute', top: 3, left: posRef(x.p25), width: `calc(${posRef(x.p75)} - ${posRef(x.p25)})`, height: 12, background: 'rgba(43,58,107,.18)', border: '1px solid #2B3A6B', borderRadius: 2 }} />
                      <div style={{ position: 'absolute', top: 1, left: posRef(x.mediana), width: 2, height: 16, background: '#2B3A6B' }} title={`mediana ${fmt(x.mediana)}`} />
                      {x.precio_real !== null && <div style={{ position: 'absolute', top: 4, left: `calc(${posRef(x.precio_real)} - 5px)`, width: 10, height: 10, borderRadius: '50%', background: x.precio_real < x.mediana ? '#8A2A2A' : '#3D7A4E', border: '1.5px solid #fff', boxShadow: '0 0 0 1px rgba(0,0,0,.25)' }} title={`precio real ${fmt(x.precio_real)}`} />}
                    </div>
                  </td>
                  <td className="num">{fmt(x.minimo)}</td><td className="num">{fmt(x.p25)}</td><td className="num cell-strong">{fmt(x.mediana)}</td><td className="num">{fmt(x.p75)}</td><td className="num">{fmt(x.maximo)}</td>
                  <td className="num" style={{ color: x.precio_real === null ? undefined : x.precio_real < x.mediana ? 'var(--wine)' : 'var(--olive, #3D7A4E)' }}>{x.precio_real === null ? '—' : fmt(x.precio_real)}</td>
                  <td className="num">{x.pruebas || '—'}</td><td className="num cell-mute">{x.clientes}</td>
                </tr>
              ))}
              {!refs.length && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 14, color: 'var(--ink-4)' }}>Sin tarifas activas para las líneas de referencia.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Franjas preempleo */}
      <div className="card" style={{ marginBottom: 12 }} data-seccion="franjas">
        <div className="card-head"><div className="card-title">Franjas de precio · preempleo</div><div className="card-actions" style={{ fontSize: 12, color: 'var(--ink-4)' }}>cada cliente cae en Bajo (&lt; p25), Medio o Alto (&gt; p75) según su precio promedio cobrado</div></div>
        <div className="table-scroll">
          <table className="table" data-tabla="franjas">
            <thead><tr><th>Servicio</th><th>Franja</th><th className="num">Corte</th><th className="num">Clientes</th><th className="num">Pruebas</th><th className="num">Producción</th><th style={{ minWidth: 160 }}>Clientes (%)</th></tr></thead>
            <tbody>
              {(datos?.franjas ?? []).map(x => {
                const total = (datos?.franjas ?? []).filter(y => y.servicio === x.servicio).reduce((s, y) => s + y.clientes, 0);
                const p = total ? (x.clientes / total) * 100 : 0;
                const color = x.orden === 1 ? '#8A2A2A' : x.orden === 2 ? '#7A857F' : '#3D7A4E';
                return (
                  <tr key={`${x.servicio}|${x.orden}`} data-franja={`${x.servicio}|${x.franja}`}>
                    {x.orden === 1 ? <td className="cell-strong" rowSpan={3} style={{ verticalAlign: 'top' }}>{nombreServicio(x.servicio)}</td> : null}
                    <td style={{ color }}>{x.franja}</td>
                    <td className="num cell-mute" style={{ fontSize: 12 }}>{x.orden === 1 ? (x.p25 !== null ? `< ${Q(x.p25)}` : '—') : x.orden === 2 ? (x.p25 !== null && x.p75 !== null ? `${Q(x.p25)} – ${Q(x.p75)}` : '—') : (x.p75 !== null ? `> ${Q(x.p75)}` : '—')}</td>
                    <td className="num">{x.clientes}</td><td className="num">{x.pruebas}</td><td className="num">{Q(x.produccion)}</td>
                    <td><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ flex: 1, height: 8, background: 'var(--bg-2, #eee)', borderRadius: 4, overflow: 'hidden' }}><div style={{ width: `${p}%`, height: '100%', background: color }} /></div><span className="cell-mute" style={{ fontSize: 11, minWidth: 36, textAlign: 'right' }}>{Math.round(p)} %</span></div></td>
                  </tr>
                );
              })}
              {!(datos?.franjas ?? []).length && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 14, color: 'var(--ink-4)' }}>Sin datos.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tabla de clientes */}
      <div className="card" style={{ marginBottom: 12 }} data-seccion="clientes">
        <div className="card-head" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="card-title">Clientes <span className="cell-mute" style={{ fontWeight: 400, fontSize: 12 }}>· {tabla.length} de {clientes.length}</span></div>
          <div className="card-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input className="input" placeholder="Buscar cliente o NIT" value={busq} onChange={e => setBusq(e.target.value)} style={{ minWidth: 200 }} data-filtro="buscar" aria-label="Buscar cliente" />
            <select className="input" value={cuadFiltro} onChange={e => setCuadFiltro(e.target.value as Cuadrante | '')} data-filtro="cuadrante" aria-label="Filtrar por cuadrante">
              <option value="">Todos los cuadrantes</option>
              {CUADRANTES.map(q => <option key={q} value={q}>{q}</option>)}
            </select>
          </div>
        </div>
        <div className="table-scroll">
          <table className="table" data-tabla="clientes">
            <thead>
              <tr>{COLUMNAS_CLIENTES.map(c => (
                <th key={c.k} className={c.num ? 'num' : undefined} style={{ cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }} onClick={() => ordenarPor(c.k)} aria-sort={orden.col === c.k ? (orden.dir === 'asc' ? 'ascending' : 'descending') : 'none'} data-col={c.k}>
                  {c.label}{orden.col === c.k ? (orden.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {tabla.map(c => (
                <tr key={c.nit} data-nit={c.nit} data-cuadrante-fila={c.cuadrante}>
                  <td><Link href={`/tarifario/${encodeURIComponent(c.nit)}`} className="cell-strong" style={{ textDecoration: 'none', color: 'var(--ink)' }} title="Ver el tarifario del cliente">{c.cliente}</Link></td>
                  <td className="cell-mute" style={{ fontSize: 12 }}>{c.nit}</td>
                  <td className="num">{c.pruebas}</td><td className="num cell-mute">{c.poligrafos || '—'}</td><td className="num cell-mute">{c.socios || '—'}</td>
                  <td className="num cell-strong">{Q(c.produccion)}</td><td className="num">{Q(c.produccion_mercado)}</td>
                  <td className="num" style={{ color: c.indice < filtros.umbralIdx ? 'var(--wine)' : undefined }}>{idx(c.indice)}</td>
                  <td className="num" style={{ color: c.brecha > 0 ? 'var(--wine)' : undefined }}>{c.brecha > 0 ? Q(c.brecha) : '—'}</td>
                  <td className="num">{Q(c.precio_efectivo)}</td>
                  <td><BadgeCuadrante c={c.cuadrante} /></td>
                </tr>
              ))}
              {!tabla.length && <tr><td colSpan={COLUMNAS_CLIENTES.length} style={{ textAlign: 'center', padding: 18, color: 'var(--ink-4)' }}>{clientes.length ? 'Ningún cliente coincide con la búsqueda o el filtro.' : 'Sin pruebas con tarifa resuelta en el periodo.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Nota metodológica */}
      <details className="card" style={{ marginBottom: 12 }} data-seccion="metodologia">
        <summary className="card-pad" style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Nota metodológica</summary>
        <div className="card-pad" style={{ paddingTop: 0, fontSize: 12.5, lineHeight: 1.6, color: 'var(--ink-2)' }}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li><strong>Qué entra:</strong> solo las pruebas que <strong>cobran</strong> y tienen <strong>tarifa resuelta</strong> (precio mayor a cero) en expedientes vigentes con NIT, por fecha de ingreso dentro del rango. <strong>Las pruebas sin tarifa no entran; ver Por facturar.</strong></li>
            <li><strong>Mediana del mercado:</strong> para cada servicio y categoría se toma el precio promedio que paga cada cliente y la referencia es la <strong>mediana entre clientes</strong> (no el promedio: un cliente grande no la mueve). La categoría vacía cuenta como única.</li>
            <li><strong>Índice:</strong> producción del cliente ÷ lo que valdría esa misma producción a la referencia de mercado de cada prueba. <strong>Brecha:</strong> la diferencia cuando el índice es menor que 1; nunca negativa.</li>
            <li><strong>Cuadrantes:</strong> por pruebas en el periodo (umbral de volumen) e índice (umbral de índice). Cambiar los umbrales recalcula todo.</li>
            <li><strong>Rangos por línea:</strong> salen del <strong>tarifario activo</strong> (precio promedio por cliente); el punto es el precio real cobrado en el periodo. <strong>Franjas:</strong> Bajo es menor que p25, Alto es mayor que p75, Medio lo demás.</li>
            <li><strong>IVA:</strong> todo va <strong>sin IVA</strong>, como el tarifario; el interruptor de los rangos solo multiplica por 1.12 para leerlos como en la factura.</li>
          </ul>
        </div>
      </details>
      <style>{`@media (max-width: 900px) { .grid-2-1 { grid-template-columns: minmax(0, 1fr) !important; } }`}</style>
    </div>
  );
}
