/**
 * TARIFARIO · Histórico y antigüedad del precio — PURO (sin IO).
 *
 * La bitácora (`tarifario_historial`, migración 015) la escribe un trigger en
 * la base; acá solo se interpreta. "¿Desde cuándo no le subimos precio a
 * este cliente?" se responde, en orden:
 *  1. Último `cambio_precio` en la bitácora → su fecha.
 *  2. Si no hay (las 788 cargadas arrancan sin historial) → el `anio` de la
 *     tarifa, tratado como 1-ene de ese año: es el dato real de cuándo se
 *     fijó ese precio.
 *  3. Si no hay año → `updated_at`.
 * Tarifa ESTANCADA = antigüedad > umbral (default 12 meses; configurable por
 * base con TARIFARIO_UMBRAL_ESTANCADA_MESES). Una Q0 no está estancada: no
 * hay precio que subir, está "sin tarifa".
 */
import { esSinTarifa } from './canon';

export type AccionHistorial = 'alta' | 'cambio_precio' | 'aprobacion' | 'desactivacion' | 'reactivacion';

export interface HistorialTarifa {
  id: string;
  /** Orden estable de la línea de tiempo (varios renglones en una transacción comparten created_at). */
  seq: number;
  tarifarioId: string;
  nit: string;
  tipoPrueba: string;
  categoria: string;
  territorio: string;
  accion: AccionHistorial;
  montoAnterior: number | null;
  montoNuevo: number | null;
  /** (nuevo − anterior) / anterior × 100. Null si el anterior era Q0 o no aplica. */
  variacionPct: number | null;
  /** Vacío si el cambio se hizo por fuera de la app (SQL directo, sin GUC). */
  usuario: string;
  motivo: string;
  anio: string;
  createdAt: string;
}

export type OrigenAntiguedad = 'historial' | 'anio' | 'actualizacion' | 'desconocido';

export interface AntiguedadPrecio {
  /** ISO de la fecha desde la que rige el precio actual (null si no hay ningún dato). */
  desde: string | null;
  origen: OrigenAntiguedad;
  /** Meses completos desde `desde` hasta hoy (0 si no hay dato). */
  meses: number;
  /** antigüedad > umbral y con monto (> 0). */
  estancada: boolean;
}

export const UMBRAL_ESTANCADA_MESES_DEFAULT = 12;

/** Umbral de "estancada" en meses: el valor de la env (entero > 0) o el default de 12. */
export function umbralEstancadaMeses(valorEnv: string | undefined): number {
  const n = Number(valorEnv);
  return Number.isInteger(n) && n > 0 ? n : UMBRAL_ESTANCADA_MESES_DEFAULT;
}

export const ETIQUETAS_ACCION: Record<AccionHistorial, string> = {
  alta: 'Alta',
  cambio_precio: 'Cambio de precio',
  aprobacion: 'Aprobación',
  desactivacion: 'Desactivación',
  reactivacion: 'Reactivación',
};

/** Último cambio de precio por tarifa (ISO), desde la bitácora. */
export function ultimoCambioPrecio(historial: readonly Pick<HistorialTarifa, 'tarifarioId' | 'accion' | 'createdAt'>[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const h of historial) {
    if (h.accion !== 'cambio_precio') continue;
    const prev = m.get(h.tarifarioId);
    if (!prev || h.createdAt > prev) m.set(h.tarifarioId, h.createdAt);
  }
  return m;
}

/** Meses completos entre una fecha ISO y hoy (nunca negativo). */
export function mesesEntre(desdeIso: string, hoy: Date): number {
  const d = new Date(desdeIso);
  if (Number.isNaN(d.getTime())) return 0;
  let m = (hoy.getUTCFullYear() - d.getUTCFullYear()) * 12 + (hoy.getUTCMonth() - d.getUTCMonth());
  if (hoy.getUTCDate() < d.getUTCDate()) m--;
  return Math.max(0, m);
}

export function antiguedadDe(
  t: { monto: number; anio: string; updatedAt?: string | null },
  ultimoCambio: string | null | undefined,
  umbralMeses: number,
  hoy: Date = new Date(),
): AntiguedadPrecio {
  let desde: string | null = null;
  let origen: OrigenAntiguedad = 'desconocido';
  if (ultimoCambio) { desde = ultimoCambio; origen = 'historial'; }
  else if (/^20\d{2}$/.test((t.anio ?? '').trim())) { desde = `${t.anio.trim()}-01-01T00:00:00.000Z`; origen = 'anio'; }
  else if (t.updatedAt) { desde = t.updatedAt; origen = 'actualizacion'; }
  const meses = desde ? mesesEntre(desde, hoy) : 0;
  return { desde, origen, meses, estancada: !!desde && meses > umbralMeses && !esSinTarifa(t.monto) };
}

/** id → antigüedad para un lote de tarifas (activas e inactivas; la pantalla decide qué mostrar). */
export function antiguedades(
  tarifas: readonly { id: string; monto: number; anio: string; updatedAt?: string | null }[],
  ultimoCambio: ReadonlyMap<string, string>,
  umbralMeses: number,
  hoy: Date = new Date(),
): Record<string, AntiguedadPrecio> {
  const out: Record<string, AntiguedadPrecio> = {};
  for (const t of tarifas) out[t.id] = antiguedadDe(t, ultimoCambio.get(t.id), umbralMeses, hoy);
  return out;
}

/** "hace 3 meses" · "hace 2 años y 1 mes" · "este mes". */
export function haceTexto(meses: number): string {
  if (meses <= 0) return 'este mes';
  if (meses < 24) return `hace ${meses} mes${meses === 1 ? '' : 'es'}`;
  const anios = Math.floor(meses / 12), resto = meses % 12;
  return `hace ${anios} años${resto ? ` y ${resto} mes${resto === 1 ? '' : 'es'}` : ''}`;
}

/** Texto del badge por fila: "última subida: hace X" · "desde 2023" · "sin cambios hace X" · "sin dato". */
export function textoAntiguedad(a: AntiguedadPrecio): string {
  switch (a.origen) {
    case 'historial': return `última subida: ${haceTexto(a.meses)}`;
    case 'anio': return `desde ${a.desde!.slice(0, 4)}`;
    case 'actualizacion': return `sin cambios ${haceTexto(a.meses)}`;
    default: return 'sin dato';
  }
}

/** Puntos de precio para el sparkline: la alta y cada cambio de precio, en orden. */
export function puntosPrecio(historial: readonly HistorialTarifa[]): { fecha: string; monto: number }[] {
  return [...historial]
    .filter(h => (h.accion === 'alta' || h.accion === 'cambio_precio') && h.montoNuevo !== null)
    .sort((a, b) => a.seq - b.seq)
    .map(h => ({ fecha: h.createdAt, monto: h.montoNuevo as number }));
}

/** Cómo creció el precio: primer punto → último, con el % total (null si el inicial era Q0). */
export function crecimiento(puntos: readonly { monto: number }[]): { inicial: number; final: number; pct: number | null } | null {
  if (puntos.length < 2) return null;
  const inicial = puntos[0].monto, final = puntos[puntos.length - 1].monto;
  return { inicial, final, pct: inicial > 0 ? Math.round(((final - inicial) / inicial) * 10000) / 100 : null };
}

/** La fecha más antigua de "precio desde" entre varias antigüedades (= desde cuándo no se le revisa precio al cliente). */
export function precioDesdeMasAntiguo(lista: readonly AntiguedadPrecio[]): string | null {
  let min: string | null = null;
  for (const a of lista) if (a.desde && (!min || a.desde < min)) min = a.desde;
  return min;
}

/** "2023" si la fecha es un 1-ene exacto (viene del año de la tarifa); si no "mar 2025". En UTC para no correr el día. */
export function fechaDesdeTexto(iso: string | null): string {
  if (!iso) return '—';
  if (/^20\d{2}-01-01T00:00:00(\.000)?Z$/.test(iso)) return iso.slice(0, 4);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-GT', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
