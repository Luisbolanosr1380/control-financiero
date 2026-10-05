'use client';

/**
 * Resumen de junta: una pantalla. Ingresos / costos / gastos / utilidad,
 * presupuestado vs real acumulado, % de cumplimiento de la utilidad
 * comprometida, las líneas más desviadas en contra y dos gráficos simples
 * (barras presupuesto vs real; utilidad acumulada mes a mes).
 */
import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Q } from '@/lib/utils';
import {
  agregadosJunta, comparativo, masDesviadas, MESES_CORTOS, mesesHasta, realVista, resolverLineas, sumarCeldas, TODOS, TODOS_LOS_MESES,
  type LineaPres, type RealCeldas,
} from '@/lib/presupuesto/modelo';
import type { PresupuestoCab } from '@/lib/db/presupuesto';

interface Props { cab: PresupuestoCab; lineas: LineaPres[]; celdas: ReadonlyMap<string, number>; real: RealCeldas; corte: number; hoy: string }

const PPTO = '#9aa58a';
const REAL = '#0E2A24';
const QK = (n: number) => { const a = Math.abs(n); return `${n < 0 ? '−' : ''}Q${a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${Math.round(a / 1e3)}K` : Math.round(a)}`; };

export function ResumenJunta({ cab, lineas, celdas, real, corte }: Props) {
  const mesesYTD = mesesHasta(corte);
  const ordenUN = lineas.find(l => /utilidad neta/i.test(l.nombre))?.orden ?? -1;
  const d = useMemo(() => {
    const pYTD = sumarCeldas(celdas, { centroId: TODOS, meses: mesesYTD });
    const rYTD = realVista(lineas, real, { centroId: TODOS, meses: mesesYTD });
    const pAnual = sumarCeldas(celdas, { centroId: TODOS, meses: TODOS_LOS_MESES });
    const ap = agregadosJunta(lineas, pYTD), ar = agregadosJunta(lineas, rYTD), aa = agregadosJunta(lineas, pAnual);
    const filas = comparativo(lineas, celdas, real, { centroId: TODOS, meses: mesesYTD });
    let accP = 0, accR = 0;
    const curva = TODOS_LOS_MESES.map(m => {
      accP += resolverLineas(lineas, sumarCeldas(celdas, { centroId: TODOS, meses: [m] })).get(ordenUN) ?? 0;
      const rm = resolverLineas(lineas, realVista(lineas, real, { centroId: TODOS, meses: [m] })).get(ordenUN) ?? 0;
      accR += rm;
      return { mes: MESES_CORTOS[m - 1], presupuesto: Math.round(accP), real: m <= corte ? Math.round(accR) : null };
    });
    return { ap, ar, aa, desviadas: masDesviadas(filas, 5), curva };
  }, [celdas, lineas, real, corte, ordenUN, mesesYTD.join(',')]);

  const cumplimiento = Math.abs(d.ap.utilidad) > 0.5 ? (d.ar.utilidad / d.ap.utilidad) * 100 : null;
  const barras = [
    { k: 'Ingresos', presupuesto: d.ap.ingresos, real: d.ar.ingresos },
    { k: 'Costos', presupuesto: d.ap.costos, real: d.ar.costos },
    { k: 'Gastos', presupuesto: d.ap.gastos, real: d.ar.gastos },
    { k: 'Utilidad', presupuesto: d.ap.utilidad, real: d.ar.utilidad },
  ];
  const periodo = corte === 0 ? `${cab.anio} todavía no empieza` : corte === 12 ? `Año ${cab.anio} completo` : `Acumulado enero–${MESES_CORTOS[corte - 1]} ${cab.anio} · mes ${corte} de 12 (${MESES_CORTOS[corte - 1]} en curso)`;

  const tarjeta = (titulo: string, p: number, r: number, masEsMejor: boolean) => {
    const v = r - p;
    const bien = Math.abs(v) < 0.5 ? null : masEsMejor ? v > 0 : v < 0;
    return (
      <div className="kpi" key={titulo}>
        <div className="kpi-label">{titulo}</div>
        <div className="kpi-value" style={{ fontSize: 20 }}>{Q(r)}</div>
        <div className="kpi-delta"><span className="vs">ppto. {Q(p)}</span>
          {corte > 0 && <span style={{ marginLeft: 6, color: bien === null ? 'var(--ink-3)' : bien ? 'var(--olive)' : 'var(--wine)' }}>{v > 0 ? '+' : ''}{Q(v)}</span>}
        </div>
      </div>
    );
  };

  return (
    <>
      <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 10 }}>{periodo}. Real = Estado de Resultados (libro diario).</div>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 14 }}>
        {tarjeta('Ingresos netos', d.ap.ingresos, d.ar.ingresos, true)}
        {tarjeta('Costos', d.ap.costos, d.ar.costos, false)}
        {tarjeta('Gastos', d.ap.gastos, d.ar.gastos, false)}
        {tarjeta('Utilidad neta', d.ap.utilidad, d.ar.utilidad, true)}
        <div className="kpi">
          <div className="kpi-label">Cumplimiento de la utilidad</div>
          <div className="kpi-value" style={{ fontSize: 20, color: cumplimiento !== null && cumplimiento < 100 ? 'var(--wine)' : undefined }}>{corte === 0 ? '—' : cumplimiento === null ? 'sin meta' : `${cumplimiento.toFixed(0)}%`}</div>
          <div className="kpi-delta"><span className="vs">comprometida en el año: {Q(d.aa.utilidad)}</span></div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <div className="card">
          <div className="card-head"><div className="card-title">Presupuesto vs real · {corte === 0 ? 'año' : 'acumulado'}</div></div>
          <div style={{ height: 250, padding: '6px 10px' }}>
            <ResponsiveContainer>
              <BarChart data={barras} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="k" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => QK(Number(v))} width={62} domain={[(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)]} />
                <Tooltip formatter={v => Q(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="var(--ink)" />
                <Bar dataKey="presupuesto" name="Presupuesto" fill={PPTO} isAnimationActive={false} />
                <Bar dataKey="real" name="Real" fill={REAL} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><div className="card-title">Utilidad neta acumulada · comprometida vs real</div></div>
          <div style={{ height: 250, padding: '6px 10px' }}>
            <ResponsiveContainer>
              <LineChart data={d.curva} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => QK(Number(v))} width={62} domain={[(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)]} />
                <Tooltip formatter={v => (v === null ? '—' : Q(Number(v)))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={0} stroke="var(--ink)" />
                <Line type="monotone" dataKey="presupuesto" name="Comprometida (ppto.)" stroke={PPTO} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="real" name="Real" stroke={REAL} strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div className="card-title">Líneas más desviadas en contra</div></div>
        {corte === 0 ? (
          <div className="card-pad" style={{ fontSize: 13, color: 'var(--ink-3)' }}>El año todavía no empieza: no hay real para comparar.</div>
        ) : d.desviadas.length === 0 ? (
          <div className="card-pad" style={{ fontSize: 13, color: 'var(--olive)' }}>Ninguna línea va en contra del presupuesto en el acumulado.</div>
        ) : (
          <table className="table">
            <thead><tr><th>Línea</th><th className="num">Presupuesto</th><th className="num">Real</th><th className="num">Desvío</th><th></th></tr></thead>
            <tbody>{d.desviadas.map(f => (
              <tr key={f.orden} style={{ background: f.sobregiro ? 'rgba(138, 42, 42, 0.07)' : undefined }}>
                <td>{f.nombre}</td><td className="num">{Q(f.presupuesto)}</td><td className="num">{Q(f.real)}</td>
                <td className="num" style={{ color: 'var(--wine)', fontWeight: 500 }}>{f.variacion > 0 ? '+' : ''}{Q(f.variacion)}</td>
                <td>{f.sobregiro ? <span className="badge badge-wine" style={{ fontSize: 10.5 }}>Sobregiro</span> : <span className="badge badge-warn" style={{ fontSize: 10.5 }}>Por debajo</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
