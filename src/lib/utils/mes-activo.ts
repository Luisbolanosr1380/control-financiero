/**
 * F-BF-002 — Mes activo del header (searchParam ?mes=YYYY-MM).
 *
 * Una sola fuente de verdad: el searchParam `mes`. Las páginas server-side
 * leen el param via `parseMesParam` y lo aplican como filtro a sus fetch.
 * El dropdown del topbar actualiza el param via router.push preservando
 * los demás.
 *
 * Regla F-041: comparación de strings YYYY-MM, sin Date para zonas
 * horarias. La conversión a "Guatemala" solo aplica al CALCULAR el mes
 * actual (sí necesita Date) — luego todo es string.
 */

import { formatInTimeZone } from 'date-fns-tz';

const MES_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

const NOMBRES_MES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
] as const;

/** "YYYY-MM" del mes actual en hora Guatemala. */
export function mesActualGT(now: Date = new Date()): string {
  return formatInTimeZone(now, 'America/Guatemala', 'yyyy-MM');
}

/**
 * Valida y normaliza el searchParam `mes`. Si viene vacío o malformado,
 * cae al mes actual. Siempre devuelve un YYYY-MM válido.
 */
export function parseMesParam(raw: string | string[] | undefined, now: Date = new Date()): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v && MES_REGEX.test(v)) return v;
  return mesActualGT(now);
}

/** "Mayo 2026" para mostrar en el dropdown / títulos. Capitalizado. */
export function etiquetaMes(mes: string): string {
  if (!MES_REGEX.test(mes)) return mes;
  const [y, m] = mes.split('-').map(Number);
  const nombre = NOMBRES_MES[m - 1];
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${y}`;
}

/**
 * Lista de meses para el selector: `mesesAtras` anteriores + actual.
 * Por defecto 12 atrás + actual. Devuelve en orden DESCENDENTE
 * (más reciente primero) para que el actual quede arriba.
 */
export function mesesDisponibles(mesesAtras = 12, now: Date = new Date()): string[] {
  const actual = mesActualGT(now);
  const [yStr, mStr] = actual.split('-');
  let y = Number(yStr);
  let m = Number(mStr);
  const out: string[] = [];
  for (let i = 0; i <= mesesAtras; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m < 1) { m = 12; y -= 1; }
  }
  return out;
}
