'use client';

/**
 * F-EXPORT-CONFIG: selector de período REUSABLE para exportaciones y
 * reportes — presets + mes puntual + rango custom. El mismo componente
 * vive en el reporte de facturación y en el export de cobros para que
 * la contadora vea exactamente el mismo control en los dos lados.
 */

import {
  mesCalendarioDe, pad2, rangoDePreset, ultimoDia,
  type PresetPeriodo, type RangoPeriodo,
} from './periodo-rango';

// Los helpers puros viven en periodo-rango.ts (server-safe). Se re-exportan
// para que los importadores cliente existentes sigan funcionando. Un server
// component debe importar DIRECTO de './periodo-rango', nunca de acá.
export { rangoDePreset, mesCalendarioDe, etiquetaArchivo } from './periodo-rango';
export type { PresetPeriodo, RangoPeriodo } from './periodo-rango';

const PRESETS_TODOS: Array<{ key: PresetPeriodo; label: string }> = [
  { key: 'este_mes',      label: 'Este mes' },
  { key: 'mes_anterior',  label: 'Mes anterior' },
  { key: 'trimestre',     label: 'Este trimestre' },
  { key: 'este_anio',     label: 'Este año' },
  { key: 'anio_anterior', label: 'Año anterior' },
  { key: 'historico',     label: 'Histórico' },
];

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
