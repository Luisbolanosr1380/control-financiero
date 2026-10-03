/**
 * F-EXPORT-CONFIG: helpers PUROS de rango de período (sin 'use client').
 *
 * Viven separados de periodo-selector.tsx a propósito: ese archivo es un
 * módulo cliente y Next.js no permite llamar sus funciones desde un
 * server component (/conciliacion/page.tsx cayó con 500 por eso:
 * "Attempted to call rangoDePreset() from the server but rangoDePreset
 * is on the client"). Este módulo lo pueden importar servidor y cliente.
 */

import { mesActualGT } from '@/lib/utils/mes-activo';

export type PresetPeriodo = 'este_mes' | 'mes_anterior' | 'trimestre' | 'este_anio' | 'anio_anterior' | 'historico';

export interface RangoPeriodo {
  desde: string;                 // YYYY-MM-DD ('' = sin límite)
  hasta: string;
  preset: PresetPeriodo | null;  // null = mes puntual o rango editado a mano
}

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const ultimoDia = (y: number, m: number) => new Date(y, m, 0).getDate();

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
