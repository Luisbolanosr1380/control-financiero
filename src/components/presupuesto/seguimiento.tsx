'use client';

/**
 * Presupuesto vs real. El real viene del motor del ER (mismas líneas):
 * por mes o acumulado al mes de corte, por centro o consolidado. El color
 * respeta el tipo de línea: en ingresos/utilidades quedar debajo es malo;
 * en costos/gastos/descuentos pasarse es malo (sobregiro, en rojo).
 */
import { Fragment, useMemo, useState } from 'react';
import { Q } from '@/lib/utils';
import { csvEscape } from '@/lib/facturacion/reporte-csv';
import {
  comparativo, filaComparativo, MESES_CORTOS, mesesHasta, resolverLineas, realVista, sumarCeldas, TODOS, TODOS_LOS_MESES,
  type FilaComparativo, type LineaPres, type RealCeldas,
} from '@/lib/presupuesto/modelo';
import type { CentroPres, PresupuestoCab } from '@/lib/db/presupuesto';

interface Props { cab: PresupuestoCab; lineas: LineaPres[]; centros: CentroPres[]; celdas: ReadonlyMap<string, number>; real: RealCeldas; corte: number; sinCentro: number }

const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(0)}%`);
const colorVar = (f: FilaComparativo) => (f.favorable === null ? 'var(--ink-3)' : f.favorable ? 'var(--olive)' : 'var(--wine)');

export function Seguimiento({ cab, lineas, centros, celdas, real, corte, sinCentro }: Props) {
  const [centro, setCentro] = useState<string>(TODOS);
  const [vista, setVista] = useState<'ytd' | 'mes'>('ytd');
  const [mes, setMes] = useState<number>(Math.max(1, corte || 1));
  const [abierta, setAbierta] = useState<number | null>(null);
  const meses = vista === 'ytd' ? mesesHasta(mes) : [mes];
  const filas = useMemo(() => comparativo(lineas, celdas, real, { centroId: centro, meses }), [lineas, celdas, real, centro, meses.join(',')]);
  const sobregiros = filas.filter(f => f.sobregiro);
  const centroApp = centros.find(c => c.id === centro)?.appId;

  const detalleMensual = (l: LineaPres) => TODOS_LOS_MESES.map(m => {
    const p = resolverLineas(lineas, sumarCeldas(celdas, { centroId: centro, meses: [m] })).get(l.orden) ?? 0;
    const r = resolverLineas(lineas, realVista(lineas, real, { centroId: centro, meses: [m] })).get(l.orden) ?? 0;
    return { m, ...filaComparativo(l, p, r) };
  });
  const detalleCentros = (l: LineaPres) => centros.map(c => {
    const f = comparativo(lineas, celdas, real, { centroId: c.id, meses }).find(x => x.orden === l.orden)!;
    return { centro: c.nombre, ...f };
  });

  const exportar = () => {
    const L: string[] = [];
    const fila = (...c: Array<string | number>) => L.push(c.map(csvEscape).join(','));
    fila(`${cab.nombre} · presupuesto vs real`, vista === 'ytd' ? `acumulado enero–${MESES_CORTOS[mes - 1]}` : `mes ${MESES_CORTOS[mes - 1]}`, centro === TODOS ? 'consolidado' : centros.find(c => c.id === centro)?.nombre ?? '');
    fila('Orden', 'Línea', 'Presupuesto', 'Real', 'Variación', '% ejecución', 'A favor', 'Sobregiro');
    for (const f of filas) fila(f.orden, f.nombre, f.presupuesto, f.real, f.variacion, f.ejecucionPct ?? '', f.favorable === null ? '' : f.favorable ? 'sí' : 'no', f.sobregiro ? 'SÍ' : '');
    const blob = new Blob(['﻿' + L.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `presupuesto_vs_real_${cab.anio}_${vista}-${String(mes).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-pad" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
          <select className="input" value={centro} onChange={e => setCentro(e.target.value)} style={{ fontSize: 12.5 }}>
            <option value={TODOS}>Consolidado (todos los centros)</option>
            {centros.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 2 }}>
            <button className={'btn ' + (vista === 'ytd' ? 'btn-secondary' : 'btn-ghost')} style={{ fontSize: 12 }} onClick={() => setVista('ytd')}>Acumulado</button>
            <button className={'btn ' + (vista === 'mes' ? 'btn-secondary' : 'btn-ghost')} style={{ fontSize: 12 }} onClick={() => setVista('mes')}>Un mes</button>
          </div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {vista === 'ytd' ? 'enero hasta' : 'mes'}
            <select className="input" value={mes} onChange={e => setMes(Number(e.target.value))} style={{ fontSize: 12.5 }}>
              {MESES_CORTOS.map((m, i) => <option key={m} value={i + 1}>{m} {cab.anio}</option>)}
            </select>
          </label>
          <span style={{ color: 'var(--ink-4)' }}>{corte === 0 ? `${cab.anio} todavía no empieza: el real cuenta desde enero.` : corte === 12 ? 'Año cerrado.' : `Mes en curso: ${MESES_CORTOS[corte - 1]} (no está cerrado).`}</span>
          <button className="btn btn-ghost" style={{ fontSize: 12, marginLeft: 'auto' }} onClick={exportar}>Exportar CSV</button>
        </div>
      </div>

      {sobregiros.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--wine)', marginBottom: 12 }}>
          <div className="card-pad" style={{ fontSize: 13, color: 'var(--wine)' }}>
            <strong>Sobregiro en {sobregiros.length} línea{sobregiros.length === 1 ? '' : 's'}:</strong> {sobregiros.map(f => `${f.nombre} (+${Q(f.variacion)})`).join(' · ')}
          </div>
        </div>
      )}
      {centro === TODOS && sinCentro > 0 && (
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 8 }}>El consolidado real incluye partidas sin centro de costo (Q{Math.round(sinCentro).toLocaleString('en-US')} en el año), igual que el Estado de Resultados.</div>
      )}

      <div className="card">
        <table className="table">
          <thead><tr><th>Línea del ER</th><th className="num">Presupuesto</th><th className="num">Real</th><th className="num">Variación</th><th style={{ width: 190 }}>% ejecución</th><th style={{ width: 90 }}></th></tr></thead>
          <tbody>
            {filas.map(f => {
              const l = lineas.find(x => x.orden === f.orden)!;
              const calc = f.clase === 'calculada';
              const ancho = f.ejecucionPct === null ? 0 : Math.min(100, Math.max(0, f.ejecucionPct));
              return (
                <Fragment key={f.orden}>
                  <tr className={calc ? '' : 'clickable'} style={{ cursor: calc ? undefined : 'pointer', fontWeight: calc ? 600 : undefined, background: f.sobregiro ? 'rgba(138, 42, 42, 0.07)' : calc ? 'var(--paper-2, #f6f1e4)' : undefined }}
                    onClick={() => !calc && setAbierta(abierta === f.orden ? null : f.orden)}>
                    <td>{!calc && <span style={{ display: 'inline-block', width: 14 }}>{abierta === f.orden ? '▾' : '▸'}</span>}{f.nombre}</td>
                    <td className="num">{Q(f.presupuesto)}</td>
                    <td className="num">{Q(f.real)}</td>
                    <td className="num" style={{ color: colorVar(f), fontWeight: 500 }}>{f.variacion > 0 ? '+' : ''}{Q(f.variacion)}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ flex: 1, height: 6, background: 'var(--line-3)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${ancho}%`, height: '100%', background: f.sobregiro ? 'var(--wine)' : f.favorable === false ? 'var(--burnt, #b5651d)' : 'var(--olive)' }} />
                        </div>
                        <span className="num" style={{ fontSize: 12, width: 44, textAlign: 'right' }}>{pct(f.ejecucionPct)}</span>
                      </div>
                    </td>
                    <td>{f.sobregiro && <span className="badge badge-wine" style={{ fontSize: 10.5 }}>Sobregiro</span>}</td>
                  </tr>
                  {abierta === f.orden && (
                    <tr><td colSpan={6} style={{ background: 'var(--bg-2, #faf7ef)', padding: '10px 16px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 18 }}>
                        <div>
                          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 4 }}>Mes a mes · {centro === TODOS ? 'consolidado' : centros.find(c => c.id === centro)?.nombre}</div>
                          <table className="table" style={{ background: 'transparent' }}>
                            <thead><tr><th>Mes</th><th className="num">Ppto.</th><th className="num">Real</th><th className="num">Var.</th><th></th></tr></thead>
                            <tbody>{detalleMensual(l).map(d => (
                              <tr key={d.m}><td>{MESES_CORTOS[d.m - 1]}</td><td className="num">{Q(d.presupuesto)}</td><td className="num">{Q(d.real)}</td>
                                <td className="num" style={{ color: colorVar(d) }}>{d.variacion > 0 ? '+' : ''}{Q(d.variacion)}</td>
                                <td>{d.real !== 0 && <a href={`/reportes/estado-resultados?mes=${cab.anio}-${String(d.m).padStart(2, '0')}${centroApp ? `&cc=${centroApp}` : ''}`} style={{ fontSize: 11.5 }}>ver en el ER</a>}</td></tr>
                            ))}</tbody>
                          </table>
                        </div>
                        <div>
                          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 4 }}>Por centro · {vista === 'ytd' ? `acumulado a ${MESES_CORTOS[mes - 1]}` : MESES_CORTOS[mes - 1]}</div>
                          <table className="table" style={{ background: 'transparent' }}>
                            <thead><tr><th>Centro</th><th className="num">Ppto.</th><th className="num">Real</th><th className="num">Var.</th></tr></thead>
                            <tbody>{detalleCentros(l).map(d => (
                              <tr key={d.centro} style={{ background: d.sobregiro ? 'rgba(138, 42, 42, 0.07)' : undefined }}><td>{d.centro}</td><td className="num">{Q(d.presupuesto)}</td><td className="num">{Q(d.real)}</td>
                                <td className="num" style={{ color: colorVar(d) }}>{d.variacion > 0 ? '+' : ''}{Q(d.variacion)}</td></tr>
                            ))}</tbody>
                          </table>
                        </div>
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
