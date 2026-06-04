import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// ============================================================
// Formatters de moneda quetzal
// ============================================================

/**
 * Formato Q123,456 o Q123,456.78
 * Para mostrar montos en UI.
 */
export const Q = (n: number | null | undefined): string => {
  if (n == null) return '—';
  const neg = n < 0;
  const v = Math.abs(n);
  const hasDec = v % 1 !== 0;
  const fmt = v.toLocaleString('en-US', {
    minimumFractionDigits: hasDec ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return (neg ? '−' : '') + 'Q' + fmt;
};

/**
 * Solo el número sin símbolo: 123,456
 * Útil para tablas donde el header ya dice "Q".
 */
export const Qn = (n: number | null | undefined): string => {
  if (n == null) return '—';
  const v = Math.abs(n);
  return v.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
};

// ============================================================
// Formatters de fecha (F-041: zona Guatemala)
//
// Antes usábamos new Date(iso).getDate()/.getMonth() que devuelven valores
// en la TZ local del browser. Para usuarios en otra timezone, una fecha
// "2026-06-04" (que internamente es medianoche UTC) salía como "03/06/2026"
// en zona Guatemala UTC-6.
//
// Ahora delegamos a formatearFecha* de src/lib/utils/fechas.ts que usa
// formatInTimeZone(TZ_GUATEMALA). Los nombres legacy se mantienen para que
// los componentes no tengan que migrar; los recomendados nuevos son los de
// '@/lib/utils/fechas'.
// ============================================================

import { formatearFecha } from './utils/fechas';

// date-fns con locale español devuelve meses en minúscula ("jun"). El sistema
// previo usaba mayúscula inicial ("Jun"). Conservamos la imagen visual.
const capitalizarMes = (s: string): string => s.replace(/\b([a-záéíóú])/g, c => c.toUpperCase());

export const formatDate = (d: Date | string | null | undefined): string =>
  capitalizarMes(formatearFecha(d, 'dd MMM yyyy'));

export const formatDateShort = (d: Date | string | null | undefined): string =>
  capitalizarMes(formatearFecha(d, 'dd MMM'));

/** Formato DD/MM/YYYY — útil en tablas donde el espacio es escaso */
export const formatDateDDMMYYYY = (d: Date | string | null | undefined): string =>
  formatearFecha(d, 'dd/MM/yyyy');

// ============================================================
// Utilidad de clases (Tailwind merge)
// ============================================================

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
