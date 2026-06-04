/**
 * F-041 — Normalización de zona horaria a America/Guatemala.
 *
 * Toda fecha que se MUESTRA al usuario o se COMPARA con "hoy" pasa por estas
 * funciones. Guatemala es UTC-6 fijo (no observa horario de verano), así que
 * convertir entre UTC y Guatemala es siempre +/- 6 horas.
 *
 * Reglas:
 *  - LEER: parseISO + formatInTimeZone(TZ_GUATEMALA, …).
 *  - MOSTRAR: formatearFecha* (devuelve string ya en zona Guatemala).
 *  - ESCRIBIR a Airtable: fechaParaAirtable(value) garantiza 'YYYY-MM-DD'.
 *  - HOY: obtenerFechaHoyGuatemala() en lugar de new Date().toISOString().slice(0,10).
 *  - DIFERENCIA DE DÍAS: diferenciaDias() normaliza ambas fechas a Guatemala
 *    antes de calcular para evitar off-by-one en cálculos de mora / antigüedad.
 */

import { formatDistanceToNow, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export const TZ_GUATEMALA = 'America/Guatemala';

type FechaInput = string | Date | null | undefined;

function aDate(fecha: FechaInput): Date | null {
  if (!fecha) return null;
  if (fecha instanceof Date) return Number.isFinite(fecha.getTime()) ? fecha : null;
  try {
    const d = parseISO(fecha);
    return Number.isFinite(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

/* ============================================================
 * Mostrar fechas
 * ============================================================ */

export function formatearFecha(fecha: FechaInput, formato = 'dd/MM/yyyy'): string {
  const d = aDate(fecha);
  if (!d) return '—';
  try {
    return formatInTimeZone(d, TZ_GUATEMALA, formato, { locale: es });
  } catch {
    return '—';
  }
}

export const formatearFechaCorta    = (f: FechaInput) => formatearFecha(f, 'dd/MM/yyyy');
export const formatearFechaLarga    = (f: FechaInput) => formatearFecha(f, "d 'de' MMMM yyyy");
export const formatearFechaConHora  = (f: FechaInput) => formatearFecha(f, 'dd/MM/yyyy HH:mm');
export const formatearFechaConDia   = (f: FechaInput) => formatearFecha(f, "EEEE d 'de' MMMM yyyy");

/** "hace 3 días", "en 5 días", "hace 2 minutos". */
export function fechaRelativa(fecha: FechaInput): string {
  const d = aDate(fecha);
  if (!d) return '—';
  try {
    return formatDistanceToNow(d, { addSuffix: true, locale: es });
  } catch {
    return '—';
  }
}

/* ============================================================
 * Hoy en Guatemala
 * ============================================================ */

/** 'YYYY-MM-DD' del día actual en Guatemala. */
export function obtenerFechaHoyGuatemala(): string {
  return formatInTimeZone(new Date(), TZ_GUATEMALA, 'yyyy-MM-dd');
}

/** 'YYYY-MM-DDTHH:mm:ssXXX' con offset Guatemala (-06:00). */
export function obtenerDateTimeHoyGuatemala(): string {
  return formatInTimeZone(new Date(), TZ_GUATEMALA, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/* ============================================================
 * Conversión input → ISO para Airtable
 * ============================================================ */

/**
 * Convierte 'YYYY-MM-DD' de un <input type="date"> (interpretado como hora
 * Guatemala) a un ISO UTC equivalente al inicio del día Guatemala.
 * Útil cuando se manda a un endpoint que espera Date completo.
 */
export function inputDateAGuatemalaISO(inputDate: string): string {
  const fechaGT = fromZonedTime(`${inputDate}T00:00:00`, TZ_GUATEMALA);
  return fechaGT.toISOString();
}

/**
 * Garantiza 'YYYY-MM-DD' en zona Guatemala para escribir en campos Date-only
 * de Airtable. Acepta Date, string ISO o string ya en formato.
 */
export function fechaParaAirtable(fecha: FechaInput): string {
  const d = aDate(fecha);
  if (!d) return obtenerFechaHoyGuatemala();
  return formatInTimeZone(d, TZ_GUATEMALA, 'yyyy-MM-dd');
}

/* ============================================================
 * Diferencia de días (calendario, no horas exactas)
 * ============================================================ */

/**
 * Días calendario entre dos fechas, normalizadas al día Guatemala. Útil para:
 *  - antigüedad de empleado (FECHA_INGRESO → hoy)
 *  - mora de deuda (FECHA_VENCIMIENTO → hoy)
 *  - días pendiente de pago (FECHA_APROBACION → hoy)
 *
 * Si `hasta` < `desde`, devuelve número negativo.
 */
export function diferenciaDias(desde: FechaInput, hasta: FechaInput = new Date()): number {
  const a = aDate(desde);
  const b = aDate(hasta);
  if (!a || !b) return 0;
  // Normalizamos cada fecha a 'YYYY-MM-DD' en GT y reparseamos para tener
  // medianoche local. Eso elimina cualquier ruido de horas.
  const aGT = parseISO(formatInTimeZone(a, TZ_GUATEMALA, 'yyyy-MM-dd'));
  const bGT = parseISO(formatInTimeZone(b, TZ_GUATEMALA, 'yyyy-MM-dd'));
  return Math.floor((bGT.getTime() - aGT.getTime()) / 86400000);
}

/* ============================================================
 * Helpers para construir contexto temporal (Auros)
 * ============================================================ */

/** Día (1-31), mes (1-12), año, weekday (0-6, domingo=0) en zona Guatemala. */
export function partesFechaHoy(): { dia: number; mes: number; anio: number; weekday: number } {
  const iso = obtenerFechaHoyGuatemala();
  const [y, m, d] = iso.split('-').map(Number);
  // Calculamos el weekday con la fecha parseada en zona Guatemala.
  const fechaGT = parseISO(iso);
  return { dia: d, mes: m, anio: y, weekday: fechaGT.getDay() };
}
