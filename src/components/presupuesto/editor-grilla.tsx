'use client';

import { useMemo } from 'react';
import { Q } from '@/lib/utils';
import { csvEscape } from '@/lib/facturacion/reporte-csv';
import { claveCelda, MESES_CORTOS, resolverLineas, sumarCeldas, TODOS, TODOS_LOS_MESES, type LineaPres } from '@/lib/presupuesto/modelo';
import type { CentroPres, PresupuestoCab } from '@/lib/db/presupuesto';

interface Props {
  cab: PresupuestoCab;
  lineas: LineaPres[];
  centros: CentroPres[];
  celdas: ReadonlyMap<string, number>;
  cambios: ReadonlyMap<string, number>;
  editable: boolean;
  centro: string;
  setCentro: (c: string) => void;
  onCambio: (orden: number, centroId: string, mes: number, monto: number) => void;
  onGuardar: () => void;
  onDescartar: () => void;
  onLimpiar: () => void;
  guardando: boolean;
}

const CLASE_LABEL: Record<string, string> = { ingreso: 'Ingreso', descuento: 'Resta', costo: 'Costo', gasto: 'Gasto', calculada: '' };
const num = (t: string) => { const n = Number(t.replace(/[,\sQ]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
const fmt = (n: number) => (n === 0 ? '' : n.toLocaleString('en-US', { maximumFractionDigits: 2 }));

export function EditorGrilla({ cab, lineas, centros, celdas, cambios, editable, centro, setCentro, onCambio, onGuardar, onDescartar, onLimpiar, guardando }: Props) {
  const porMes = useMemo(() => TODOS_LOS_MESES.map(m => resolverLineas(lineas, sumarCeldas(celdas, { centroId: centro, meses: [m] }))), [lineas, celdas, centro]);
  const anual = useMemo(() => resolverLineas(lineas, sumarCeldas(celdas, { centroId: centro, meses: TODOS_LOS_MESES })), [lineas, celdas, centro]);
  const editaEste = editable && centro !== TODOS;

  const exportar = () => {
    const L: string[] = [];
    const fila = (...c: Array<string | number>) => L.push(c.map(csvEscape).join(','));
    fila(cab.nombre, `estado: ${cab.estado}`, 'montos en Q (magnitud por línea; los subtotales con las fórmulas del ER)');
    for (const c of [{ id: TODOS, nombre: 'Consolidado' }, ...centros]) {
      L.push('');
      fila(`Centro: ${c.nombre}`);
      fila('Orden', 'Línea', ...MESES_CORTOS, 'Total');
      const pm = TODOS_LOS_MESES.map(m => resolverLineas(lineas, sumarCeldas(celdas, { centroId: c.id, meses: [m] })));
      const an = resolverLineas(lineas, sumarCeldas(celdas, { centroId: c.id, meses: TODOS_LOS_MESES }));
      for (const l of lineas) fila(l.orden, l.nombre, ...pm.map(x => x.get(l.orden) ?? 0), an.get(l.orden) ?? 0);
    }
    const blob = new Blob(['﻿' + L.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `presupuesto_${cab.anio}_${cab.estado.toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="card">
      <div className="card-head" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {centros.map(c => (
            <button key={c.id} className={'btn ' + (centro === c.id ? 'btn-secondary' : 'btn-ghost')} style={{ fontSize: 12 }} onClick={() => setCentro(c.id)}>{c.nombre}</button>
          ))}
          <button className={'btn ' + (centro === TODOS ? 'btn-secondary' : 'btn-ghost')} style={{ fontSize: 12 }} onClick={() => setCentro(TODOS)}>Consolidado</button>
        </div>
        <div className="card-actions" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {editable && cambios.size > 0 && <span style={{ fontSize: 12, color: 'var(--burnt, #b5651d)' }}>{cambios.size} cambio{cambios.size === 1 ? '' : 's'} sin guardar</span>}
          {editable && cambios.size > 0 && <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onDescartar}>Descartar</button>}
          {editable && <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={cambios.size === 0 || guardando} onClick={onGuardar}>{guardando ? 'Guardando…' : 'Guardar'}</button>}
          {editaEste && <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onLimpiar}>Poner en cero</button>}
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={exportar}>Exportar CSV</button>
        </div>
      </div>
      {editable && centro === TODOS && <div style={{ padding: '6px 16px', fontSize: 12, color: 'var(--ink-3)' }}>El consolidado es la suma de los centros: para editar, elegí un centro.</div>}
      {!editable && cab.estado === 'Aprobado' && <div style={{ padding: '6px 16px', fontSize: 12, color: 'var(--ink-3)' }}>Aprobado: las celdas están bloqueadas. Para cambiarlo, un Admin lo reabre (queda en el historial).</div>}
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ minWidth: 1280 }}>
          <thead>
            <tr>
              <th style={{ position: 'sticky', left: 0, background: 'var(--paper)', zIndex: 1, minWidth: 230 }}>Línea del ER</th>
              {MESES_CORTOS.map(m => <th key={m} className="num" style={{ minWidth: 86 }}>{m}</th>)}
              <th className="num" style={{ minWidth: 104 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map(l => {
              const calc = l.clase === 'calculada';
              return (
                <tr key={l.orden} style={calc ? { background: 'var(--paper-2, #f6f1e4)', fontWeight: 600 } : undefined}>
                  <td style={{ position: 'sticky', left: 0, background: calc ? 'var(--paper-2, #f6f1e4)' : 'var(--paper)', zIndex: 1 }}>
                    {l.nombre}
                    {!calc && <span style={{ fontSize: 10.5, color: 'var(--ink-4)', marginLeft: 6 }}>{CLASE_LABEL[l.clase]}</span>}
                  </td>
                  {TODOS_LOS_MESES.map(m => {
                    const v = porMes[m - 1].get(l.orden) ?? 0;
                    if (calc || !editaEste) return <td key={m} className="num" style={{ color: v < 0 ? 'var(--wine)' : undefined }}>{v === 0 ? <span style={{ color: 'var(--ink-4)' }}>—</span> : Q(v)}</td>;
                    const k = claveCelda(l.orden, centro, m);
                    const sucia = cambios.has(k);
                    return (
                      <td key={m} style={{ padding: 2 }}>
                        <input
                          key={`${k}:${celdas.get(k) ?? 0}`}
                          aria-label={`${l.nombre} ${MESES_CORTOS[m - 1]}`}
                          className="input num"
                          inputMode="decimal"
                          defaultValue={fmt(celdas.get(k) ?? 0)}
                          onBlur={e => { const n = e.target.value.trim() === '' ? 0 : num(e.target.value); if (Number.isFinite(n)) onCambio(l.orden, centro, m, n); else e.target.value = fmt(celdas.get(k) ?? 0); }}
                          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          style={{ width: '100%', textAlign: 'right', fontSize: 12, padding: '4px 6px', background: sucia ? '#fff6d8' : undefined }}
                        />
                      </td>
                    );
                  })}
                  <td className="num cell-strong" style={{ color: (anual.get(l.orden) ?? 0) < 0 ? 'var(--wine)' : undefined }}>{Q(anual.get(l.orden) ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
