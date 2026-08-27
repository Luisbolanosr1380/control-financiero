'use client';

/**
 * F-EXPORT-CONFIG: selector de período REUSABLE para exportaciones y
 * reportes — presets + mes puntual + rango custom. El mismo componente
 * vive en el reporte de facturación y en el export de cobros para que
 * la contadora vea exactamente el mismo control en los dos lados.
 */

import { mesActualGT } from '@/lib/utils/mes-activo';

export type PresetPeriodo = 'este_mes' | 'mes_anterior' | 'trimestre' | 'este_anio' | 'anio_anterior' | 'historico';

export interface RangoPeriodo {
  desde: string;                 // YYYY-MM-DD ('' = sin límite)
  hasta: string;
  preset: PresetPeriodo | null;  // null = mes puntual o rango editado a mano
}

const PRESETS_TODOS: Array<{ key: PresetPeriodo; label: string }> = [
  { key: 'este_mes',      label: 'Este mes' },
  { key: 'mes_anterior',  label: 'Mes anterior' },
  { key: 'trimestre',     label: 'Este trimestre' },
  { key: 'este_anio',     label: 'Este año' },
  { key: 'anio_anterior', label: 'Año anterior' },
  { key: 'historico',     label: 'Histórico' },
];

const pad2 = (n: number) => String(n).padStart(2, '0');
const ultimoDia = (y: number, m: number) => new Date(y, m, 0).getDate();

export function rangoDePreset(preset: PresetPeriodo): { desde: string; hasta: string } {
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
    default:              return { desde: '', hasta: '' };
  }
}

/** ¿El rango es exactamente un mes calendario? → 'YYYY-MM' (para nombres de archivo). */
export function mesCalendarioDe(desde: string, hasta: string): string | null {
  if (!desde || !hasta || desde.slice(0, 7) !== hasta.slice(0, 7)) return null;
  const [y, m] = desde.split('-').map(Number);
  if (desde.slice(8) !== '01' || Number(hasta.slice(8)) !== ultimoDia(y, m)) return null;
  return desde.slice(0, 7);
}

/** Etiqueta corta del rango para nombres de archivo: '2026-07' o '2026-07-01_2026-09-30'. */
export function etiquetaArchivo(desde: string, hasta: string): string {
  const mes = mesCalendarioDe(desde, hasta);
  if (mes) return mes;
  if (!desde && !hasta) return 'historico';
  return `${desde || 'inicio'}_${hasta || 'hoy'}`;
}

interface Props {
  value: RangoPeriodo;
  onChange: (r: RangoPeriodo) => void;
  /** Subconjunto de presets a mostrar (default: todos). */
  presets?: PresetPeriodo[];
  disabled?: boolean;
}

export function PeriodoSelector({ value, onChange, presets, disabled }: Props) {
  const lista = presets ? PRESETS_TODOS.filter(p => presets.includes(p.key)) : PRESETS_TODOS;
  const { desde, hasta, preset } = value;

  const setMes = (ym: string) => {
    if (!ym) return;
    const [y, m] = ym.split('-').map(Number);
    onChange({ preset: null, desde: `${y}-${pad2(m)}-01`, hasta: `${y}-${pad2(m)}-${pad2(ultimoDia(y, m))}` });
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {lista.map(p => (
        <button
          key={p.key}
          className="chip"
          disabled={disabled}
          onClick={() => onChange({ preset: p.key, ...rangoDePreset(p.key) })}
          style={preset === p.key ? { background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)' } : undefined}
        >
          {p.label}
        </button>
      ))}
      <span style={{ width: 1, height: 20, background: 'var(--line)', margin: '0 4px' }} />
      <input
        type="month"
        className="input"
        disabled={disabled}
        value={mesCalendarioDe(desde, hasta) ?? ''}
        onChange={e => setMes(e.target.value)}
        title="Un mes específico"
        style={{ width: 150 }}
      />
      <span style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>o rango</span>
      <input type="date" className="input" value={desde} max={hasta || undefined} disabled={disabled}
        onChange={e => onChange({ preset: null, desde: e.target.value, hasta })} style={{ width: 140 }} />
      <span style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>—</span>
      <input type="date" className="input" value={hasta} min={desde || undefined} disabled={disabled}
        onChange={e => onChange({ preset: null, desde, hasta: e.target.value })} style={{ width: 140 }} />
    </div>
  );
}
