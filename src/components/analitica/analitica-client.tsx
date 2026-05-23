'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BarChart, Bar, Cell, LineChart, Line,
  XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { I } from '@/components/common/icons';
import { InfoTooltip } from '@/components/common/info-tooltip';
import { Q } from '@/lib/utils';
import { explicar, guiaAnalitica, type GuiaSeccion } from '@/lib/explicaciones';
import type { AnaliticaIngresos, MoverCliente } from '@/lib/db/analitica';

const PROVISIONAL_MESES = 3;   // últimos 3 meses se consideran provisionales para "apagados"

const SERVICIO_COLOR: Record<string, string> = {
  Poligrafia:       'var(--line-poligrafo)',
  Socioeconomicos:  'var(--line-socio)',
  TalentTrackAI:    'var(--line-talenttrack)',
  Administrativo:   'var(--line-ventas)',
  Otros:            'var(--ink-4)',
};

function labelMes(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${meses[m - 1]} '${String(y).slice(2)}`;
}

interface Props {
  data: AnaliticaIngresos;
}

type FiltroServicio = 'Todos' | string;

export function AnaliticaClient({ data }: Props) {
  const router = useRouter();
  const [filtro, setFiltro] = useState<FiltroServicio>('Todos');
  const [guiaAbierta, setGuiaAbierta] = useState(false);

  // Serie a graficar según el filtro
  const serie = filtro === 'Todos' ? data.serieMensualTotal : (data.serieMensualPorServicio[filtro] ?? []);

  // Detectar meses "sin datos" (Q0 antes del primer mes con monto > 0)
  const firstNonZero = serie.findIndex(s => s.monto > 0);
  const sinDatosIdx = new Set<number>();
  if (firstNonZero > 0) for (let i = 0; i < firstNonZero; i++) sinDatosIdx.add(i);
  if (firstNonZero === -1) for (let i = 0; i < serie.length; i++) sinDatosIdx.add(i);

  // Recalcular mes quiebre/pico/valle/promedio sobre la serie filtrada
  const kpis = useMemo(() => {
    const conDatos = serie.map((s, i) => ({ ...s, idx: i })).filter(s => !sinDatosIdx.has(s.idx));
    if (conDatos.length === 0) return { pico: null, valle: null, mesQuiebre: null, promedio: 0 };

    const pico = conDatos.reduce((a, b) => (b.monto > a.monto ? b : a));
    const valle = conDatos.reduce((a, b) => (b.monto < a.monto ? b : a));
    const promedio = conDatos.reduce((s, x) => s + x.monto, 0) / conDatos.length;

    let mesQuiebre: { mes: string; caidaQ: number; caidaPct: number } | null = null;
    let peor = 0;
    for (let i = 1; i < serie.length; i++) {
      if (sinDatosIdx.has(i) || sinDatosIdx.has(i - 1)) continue;
      const diff = serie[i].monto - serie[i - 1].monto;
      if (diff < peor) {
        peor = diff;
        const prev = serie[i - 1].monto;
        mesQuiebre = { mes: serie[i].mes, caidaQ: Math.abs(diff), caidaPct: prev > 0 ? Math.abs(diff) / prev * 100 : 0 };
      }
    }
    return { pico, valle, mesQuiebre, promedio };
  }, [serie, sinDatosIdx]);

  // Datos para el bar chart con flags
  const dataTotal = serie.map((s, i) => ({
    mes: labelMes(s.mes),
    rawMes: s.mes,
    monto: sinDatosIdx.has(i) ? null : s.monto,
    isQuiebre: kpis.mesQuiebre?.mes === s.mes,
    sinDatos: sinDatosIdx.has(i),
  }));

  // Datos para el line chart por servicio (multi-línea, esquivando los meses sin datos)
  const dataServ = data.serieMensualTotal.map((s, i) => {
    const sinDatos = sinDatosIdx.has(i);
    const row: { mes: string; rawMes: string } & Record<string, string | number | null> = { mes: labelMes(s.mes), rawMes: s.mes };
    for (const sv of data.servicios) {
      const v = data.serieMensualPorServicio[sv]?.[i]?.monto ?? 0;
      row[sv] = sinDatos ? null : v;
    }
    return row;
  });

  // Apagados con flags confiable/provisional
  const totalBuckets = data.clientesApagadosPorMes.length;
  const provisionalDesde = totalBuckets - PROVISIONAL_MESES;
  const apagadosViz = data.clientesApagadosPorMes.map((b, i) => ({
    mes: labelMes(b.mes),
    rawMes: b.mes,
    cantidad: b.cantidad,
    montoPerdido: b.montoPerdido,
    provisional: i >= provisionalDesde,
    sinDatos: sinDatosIdx.has(i),
  }));
  // Peor mes "confiable" (no provisional, con cantidad > 0)
  const peorMesConfiable = [...apagadosViz]
    .filter(b => !b.provisional && !b.sinDatos && b.cantidad > 0)
    .sort((a, b) => b.cantidad - a.cantidad)[0];

  // Split movers: "se fueron del todo" vs "bajaron parcial"
  const cayeronTodo = data.moversClientes.cayeron.filter(m => m.reciente <= 1 && m.variacionPct <= -99);
  const cayeronParcial = data.moversClientes.cayeron.filter(m => !(m.reciente <= 1 && m.variacionPct <= -99));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Analítica de ingresos</h1>
          <div className="page-subtitle">
            Ventana 12 meses · diagnóstico por tiempo, servicio y cliente
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={() => setGuiaAbierta(true)}>
            <I.Info size={13} /> ¿Cómo leer este panel?
          </button>
        </div>
      </div>

      {/* Filtro por servicio */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-pad" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, color: 'var(--ink-3)', marginRight: 4 }}>Servicio</span>
          {(['Todos', ...data.servicios] as FiltroServicio[]).map(s => (
            <button
              key={s}
              className={'btn ' + (filtro === s ? 'btn-primary' : 'btn-secondary')}
              style={{ padding: '5px 12px', fontSize: 12 }}
              onClick={() => setFiltro(s)}
            >
              {s !== 'Todos' && SERVICIO_COLOR[s] && (
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: SERVICIO_COLOR[s], marginRight: 6 }} />
              )}
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* SECCIÓN 1: serie mensual + KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 16 }}>
        <KpiCard
          label="Mes pico" big={kpis.pico ? Q(kpis.pico.monto) : '—'} sub={kpis.pico ? labelMes(kpis.pico.mes) : ''}
          info={kpis.pico ? explicar.mesPico(kpis.pico.mes, kpis.pico.monto) : undefined}
        />
        <KpiCard
          label="Mes valle" big={kpis.valle ? Q(kpis.valle.monto) : '—'} sub={kpis.valle ? labelMes(kpis.valle.mes) : ''}
          info={kpis.valle ? explicar.mesValle(kpis.valle.mes, kpis.valle.monto) : undefined}
        />
        <KpiCard
          label="Caída MoM mayor"
          big={kpis.mesQuiebre ? '−' + Q(kpis.mesQuiebre.caidaQ) : '—'}
          sub={kpis.mesQuiebre ? `${labelMes(kpis.mesQuiebre.mes)} · ${kpis.mesQuiebre.caidaPct.toFixed(1)}%` : ''}
          tone="neg"
          info={kpis.mesQuiebre ? explicar.caidaMoMMayor(kpis.mesQuiebre.mes, kpis.mesQuiebre.caidaQ, kpis.mesQuiebre.caidaPct) : undefined}
        />
        <KpiCard label="Promedio mensual" big={Q(kpis.promedio)} sub="meses con datos" info={explicar.promedioMensual()} />
      </div>

      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-head">
          <div className="card-title">Facturación mensual {filtro !== 'Todos' && `· ${filtro}`}<InfoTooltip text={explicar.facturacionMensual()} /></div>
          <div className="card-actions" style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--ink-3)' }}>
            <Legenda swatch="var(--ink)"   label="normal" />
            <Legenda swatch="var(--wine)"  label="mes de quiebre" />
            <Legenda swatch="var(--line-3)" label="sin datos" striped />
          </div>
        </div>
        <div className="card-pad">
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={dataTotal} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="var(--line-3)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="mes" stroke="var(--ink-4)" fontSize={10.5} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--ink-4)" fontSize={10.5} tickLine={false} axisLine={false}
                  tickFormatter={(v: number) => v >= 1000 ? `Q${Math.round(v / 1000)}K` : `Q${v}`}
                />
                <Tooltip
                  formatter={(v) => v == null ? 'sin datos' : Q(Number(v))}
                  contentStyle={{ background: 'var(--paper)', border: '1px solid var(--line-2)', borderRadius: 4, fontSize: 12 }}
                />
                <Bar dataKey="monto" radius={[2, 2, 0, 0]} maxBarSize={48}>
                  {dataTotal.map((d, i) => (
                    <Cell key={i} fill={d.sinDatos ? 'var(--line-3)' : d.isQuiebre ? 'var(--wine)' : 'var(--ink)'}
                          fillOpacity={d.sinDatos ? 0.35 : 1} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* SECCIÓN 2: por servicio */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 22, marginBottom: 22 }}>
        <div className="card">
          <div className="card-head">
            <div className="card-title">Facturación por servicio · 12 meses<InfoTooltip text={explicar.facturacionPorServicio()} /></div>
          </div>
          <div className="card-pad">
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={dataServ} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid stroke="var(--line-3)" strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="mes" stroke="var(--ink-4)" fontSize={10.5} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--ink-4)" fontSize={10.5} tickLine={false} axisLine={false}
                    tickFormatter={(v: number) => v >= 1000 ? `Q${Math.round(v / 1000)}K` : `Q${v}`}
                  />
                  <Tooltip
                    formatter={(v) => v == null ? 'sin datos' : Q(Number(v))}
                    contentStyle={{ background: 'var(--paper)', border: '1px solid var(--line-2)', borderRadius: 4, fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11.5 }} />
                  {data.servicios.map(sv => (
                    <Line
                      key={sv}
                      type="monotone"
                      dataKey={sv}
                      stroke={SERVICIO_COLOR[sv] ?? 'var(--ink-3)'}
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="card-title">Variación por servicio<InfoTooltip text={explicar.variacionPorServicio()} /></div></div>
          <table className="table">
            <thead>
              <tr>
                <th>Servicio</th>
                <th className="num">Reciente</th>
                <th className="num">vs Base</th>
              </tr>
            </thead>
            <tbody>
              {data.variacionPorServicio.map(v => (
                <tr key={v.servicio}>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 4, background: SERVICIO_COLOR[v.servicio] ?? 'var(--ink-4)' }} />
                      {v.servicio}
                    </span>
                  </td>
                  <td className="num cell-strong">{Q(v.reciente)}</td>
                  <td className="num" style={{ color: v.variacionQ < 0 ? 'var(--wine)' : v.variacionQ > 0 ? 'var(--olive)' : 'var(--ink-3)' }}>
                    {v.variacionQ === 0 ? '—' : `${v.variacionQ > 0 ? '+' : ''}${v.variacionPct.toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="card-pad" style={{ paddingTop: 0, fontSize: 11, color: 'var(--ink-4)' }}>
            Reciente = últimos 3 m · Base = 3 m anteriores
          </div>
        </div>
      </div>

      {/* SECCIÓN 3: movers de clientes */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22, marginBottom: 22 }}>
        {/* Cayeron — split */}
        <div className="card">
          <div className="card-head"><div className="card-title">Clientes que cayeron<InfoTooltip text={explicar.clientesCayeron()} /></div>
            <div className="card-actions"><span style={{ fontSize: 11, color: 'var(--ink-4)' }}>top 15 por impacto</span></div>
          </div>
          <SubtablaMovers titulo="Se fueron del todo" rows={cayeronTodo} router={router} tipo="todo" />
          <SubtablaMovers titulo="Bajaron pero siguen" rows={cayeronParcial} router={router} tipo="parcial" />
        </div>

        {/* Crecieron */}
        <div className="card">
          <div className="card-head"><div className="card-title">Clientes que crecieron<InfoTooltip text={explicar.clientesCrecieron()} /></div>
            <div className="card-actions"><span style={{ fontSize: 11, color: 'var(--ink-4)' }}>top 15 por impacto</span></div>
          </div>
          <table className="table">
            <thead>
              <tr><th>Cliente</th><th className="num">Reciente</th><th className="num">Variación</th></tr>
            </thead>
            <tbody>
              {data.moversClientes.crecieron.length === 0 ? (
                <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--ink-4)', padding: 20, fontSize: 12.5 }}>Sin crecimientos en la ventana.</td></tr>
              ) : data.moversClientes.crecieron.map(m => (
                <tr key={m.custId} className="clickable" onClick={() => router.push(`/clientes/${m.custId}`)}>
                  <td className="cell-strong">{m.nombre}</td>
                  <td className="num cell-strong">{Q(m.reciente)}</td>
                  <td className="num" style={{ color: 'var(--olive)' }}>+{Q(m.variacionQ)} · +{m.variacionPct.toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECCIÓN 4: apagados por mes */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-head">
          <div className="card-title">Clientes apagados por mes<InfoTooltip text={explicar.clientesApagados()} /></div>
          <div className="card-actions" style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--ink-3)' }}>
            <Legenda swatch="var(--wine)"  label="confiables (>3 m sin volver)" />
            <Legenda swatch="var(--amber)" label="provisional (últimos 3 m)" />
          </div>
        </div>
        <div className="card-pad">
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 8 }}>
            La fuga real solo se confirma tras ~3 meses de silencio (= 3× un ciclo típico). Los últimos 3 meses son <strong>provisionales</strong>:
            un cliente sin facturar en mayo puede estar en su ciclo normal.
            {peorMesConfiable && (
              <> · Mes con más fugas <strong>confiables</strong>: <strong style={{ color: 'var(--wine)' }}>{labelMes(peorMesConfiable.rawMes)}</strong> ({peorMesConfiable.cantidad} clientes).</>
            )}
          </div>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={apagadosViz} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="var(--line-3)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="mes" stroke="var(--ink-4)" fontSize={10.5} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--ink-4)" fontSize={10.5} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  formatter={(v, _name, item) => {
                    const prov = (item as { payload?: { provisional?: boolean } })?.payload?.provisional;
                    return `${v} cliente(s)${prov ? ' · provisional' : ''}`;
                  }}
                  contentStyle={{ background: 'var(--paper)', border: '1px solid var(--line-2)', borderRadius: 4, fontSize: 12 }}
                />
                <Bar dataKey="cantidad" radius={[2, 2, 0, 0]} maxBarSize={42}>
                  {apagadosViz.map((d, i) => (
                    <Cell key={i} fill={d.sinDatos ? 'var(--line-3)' : d.provisional ? 'var(--amber)' : 'var(--wine)'}
                          fillOpacity={d.sinDatos ? 0.35 : 1} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* SECCIÓN 5: concentración (Pareto) */}
      <div className="card">
        <div className="card-head"><div className="card-title">Concentración de ingresos (Pareto)<InfoTooltip text={explicar.concentracion(data.concentracion.top10pct, data.concentracion.clientes80pct, data.concentracion.totalClientes)} /></div></div>
        <div className="card-pad" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24 }}>
          <ConcMetric label="Top 5"  value={`${data.concentracion.top5pct.toFixed(1)}%`} />
          <ConcMetric label="Top 10" value={`${data.concentracion.top10pct.toFixed(1)}%`} />
          <ConcMetric label="Top 20" value={`${data.concentracion.top20pct.toFixed(1)}%`} />
          <ConcMetric label="80% de los ingresos" value={`${data.concentracion.clientes80pct} clientes`} sub={`de ${data.concentracion.totalClientes} activos`} />
        </div>
      </div>

      {/* Modal: guía completa */}
      {guiaAbierta && (
        <GuiaModal
          onClose={() => setGuiaAbierta(false)}
          secciones={guiaAnalitica({
            mesPico: kpis.pico,
            mesValle: kpis.valle,
            mesQuiebre: kpis.mesQuiebre,
            peorServicio: [...data.variacionPorServicio].sort((a, b) => a.variacionPct - b.variacionPct)[0] ?? null,
            concentracion: {
              top10pct: data.concentracion.top10pct,
              clientes80pct: data.concentracion.clientes80pct,
              totalClientes: data.concentracion.totalClientes,
            },
          })}
        />
      )}
    </div>
  );
}

function GuiaModal({ onClose, secciones }: { onClose: () => void; secciones: GuiaSeccion[] }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20, 18, 16, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4vh 4vw' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(720px, 94vw)', maxHeight: '92vh', background: 'var(--paper)', borderRadius: 'var(--r-3)', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid var(--line-2)' }}>
          <I.Info size={15} style={{ color: 'var(--ink-3)', marginRight: 10 }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>¿Cómo leer este panel?</div>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={onClose} title="Cerrar (Esc)">
            <I.X size={15} />
          </button>
        </div>
        <div style={{ overflowY: 'auto', padding: '18px 22px' }}>
          {secciones.map((s, i) => (
            <div key={i} style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', marginBottom: 6, letterSpacing: '-0.005em' }}>{s.titulo}</div>
              <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, whiteSpace: 'pre-line' }}>{s.cuerpo}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============= Subcomponentes ============= */

function KpiCard({ label, big, sub, tone, info }: { label: string; big: string; sub?: string; tone?: 'neg'; info?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label" style={{ display: 'flex', alignItems: 'center' }}>
        {label}
        {info && <InfoTooltip text={info} ariaLabel={`Más información sobre ${label}`} />}
      </div>
      <div className="kpi-value" style={{ color: tone === 'neg' ? 'var(--wine)' : 'var(--ink)' }}>{big}</div>
      {sub && <div className="kpi-delta"><span className="vs">{sub}</span></div>}
    </div>
  );
}

function Legenda({ swatch, label, striped }: { swatch: string; label: string; striped?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        width: 10, height: 10, borderRadius: 2, background: swatch,
        opacity: striped ? 0.45 : 1,
        backgroundImage: striped ? 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)' : undefined,
      }} />
      {label}
    </span>
  );
}

function ConcMetric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div className="num" style={{ fontSize: 24, fontWeight: 500, color: 'var(--ink)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

interface AppRouter { push: (href: string) => void }

function SubtablaMovers({ titulo, rows, router, tipo }: {
  titulo: string;
  rows: MoverCliente[];
  router: AppRouter;
  tipo: 'todo' | 'parcial';
}) {
  if (rows.length === 0) {
    return (
      <div className="card-pad" style={{ paddingTop: 8, paddingBottom: 12 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 500, marginBottom: 4 }}>{titulo}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>Sin clientes en esta categoría.</div>
      </div>
    );
  }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px 6px', borderTop: '1px solid var(--line-3)' }}>
        <I.Alert size={13} style={{ color: tipo === 'todo' ? 'var(--wine)' : 'var(--amber)' }} />
        <span style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 500 }}>{titulo}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-4)' }} className="num">{rows.length}</span>
      </div>
      <table className="table">
        <thead>
          <tr><th>Cliente</th><th className="num">Base</th><th className="num">Variación</th></tr>
        </thead>
        <tbody>
          {rows.map(m => (
            <tr key={m.custId} className="clickable" onClick={() => router.push(`/clientes/${m.custId}`)}>
              <td className="cell-strong">{m.nombre}</td>
              <td className="num cell-mute">{Q(m.base)}</td>
              <td className="num" style={{ color: 'var(--wine)' }}>
                −{Q(Math.abs(m.variacionQ))} · {m.variacionPct.toFixed(0)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
