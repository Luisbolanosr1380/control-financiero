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
// Formatters de fecha
// ============================================================

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export const formatDate = (d: Date | string | null | undefined): string => {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return `${dt.getDate().toString().padStart(2, '0')} ${MESES[dt.getMonth()]} ${dt.getFullYear()}`;
};

export const formatDateShort = (d: Date | string | null | undefined): string => {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return `${dt.getDate().toString().padStart(2, '0')} ${MESES[dt.getMonth()]}`;
};

// ============================================================
// Utilidad de clases (Tailwind merge)
// ============================================================

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
