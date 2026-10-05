/**
 * PRESUPUESTO — modelo PURO (sin IO): lo usan el servidor, el navegador
 * (editor con totales en vivo), la tool de Auros y el validador.
 *
 * Convención de montos del presupuesto: MAGNITUD por línea (positivo =
 * "más de esa línea"): un descuento presupuestado de Q5,000 se guarda 5000.
 * Para los subtotales se pasa al signo del ER (las líneas que restan,
 * hoy solo "Descuentos y NC", van negativas) y se aplican las MISMAS
 * fórmulas del Estado de Resultados (er-formulas.ts). El real del ER
 * viene con su signo y se convierte a magnitud con la misma regla, así
 * presupuesto y real son la misma línea, en la misma unidad.
 *
 * Clave de celda: `${orden}|${centroId}|${mes}` — orden = clave estable de
 * la línea entre bases; centroId = uuid de centros_costo de ESTA base.
 */
import { calcularSubtotales, claseDeLinea, valorCalculada, type ClaseLinea } from '@/lib/contabilidad/er-formulas';

export const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const TODOS = 'todos';
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface LineaER {
  orden: number;
  nombre: string;
  tipo: 'Suma cuentas' | 'Calculada';
  /** La línea resta en el ER (signo "–"/"-"). */
  negativa: boolean;
}

export interface LineaPres extends LineaER { clase: ClaseLinea }

export function lineasPresupuesto(lineas: LineaER[]): LineaPres[] {
  return [...lineas].sort((a, b) => a.orden - b.orden).map(l => ({ ...l, clase: claseDeLinea(l.orden, l.tipo) }));
}

export const claveCelda = (orden: number, centroId: string, mes: number) => `${orden}|${centroId}|${mes}`;

/** Celdas → magnitud por orden, filtrando centro (o todos) y meses. */
export function sumarCeldas(
  celdas: ReadonlyMap<string, number>,
  filtro: { centroId: string; meses: readonly number[] },
): Map<number, number> {
  const meses = new Set(filtro.meses);
  const out = new Map<number, number>();
  for (const [k, monto] of celdas) {
    const [o, c, m] = k.split('|');
    if (!meses.has(Number(m))) continue;
    if (filtro.centroId !== TODOS && c !== filtro.centroId) continue;
    out.set(Number(o), r2((out.get(Number(o)) ?? 0) + monto));
  }
  return out;
}

/** Magnitudes por orden → montos de TODAS las líneas (base + subtotales) en magnitud de presentación. */
export function resolverLineas(lineas: LineaPres[], magnitudes: ReadonlyMap<number, number>): Map<number, number> {
  const conSigno = new Map<number, number>();
  for (const l of lineas) {
    if (l.clase === 'calculada') continue;
    const m = magnitudes.get(l.orden) ?? 0;
    conSigno.set(l.orden, l.negativa ? -m : m);
  }
  const subt = calcularSubtotales(conSigno);
  const out = new Map<number, number>();
  for (const l of lineas) {
    out.set(l.orden, l.clase === 'calculada' ? valorCalculada(l.nombre, subt) : r2(magnitudes.get(l.orden) ?? 0));
  }
  return out;
}

/** Real del ER (con signo) → magnitud de presentación (las líneas que restan se dan vuelta). */
export const realAMagnitud = (l: LineaPres, montoConSigno: number) => r2(l.negativa ? -montoConSigno : montoConSigno);

/* ── Precarga desde el real del año anterior ── */

export interface AjustesPrecarga {
  /** % global (ej. 8 = +8%). */
  globalPct: number;
  /** % por clase de línea; reemplaza al global para esa clase. */
  porClasePct?: Partial<Record<Exclude<ClaseLinea, 'calculada'>, number>>;
  /** % por línea (orden); reemplaza a clase y global. */
  porLineaPct?: Record<number, number>;
}

export function factorAjuste(l: LineaPres, a: AjustesPrecarga): number {
  const pct = a.porLineaPct?.[l.orden]
    ?? (l.clase !== 'calculada' ? a.porClasePct?.[l.clase] : undefined)
    ?? a.globalPct;
  return 1 + (Number.isFinite(pct) ? pct : 0) / 100;
}

/** Real N-1 (con signo, por orden|centro|mes) → celdas del presupuesto N con el ajuste aplicado. */
export function celdasDesdeReal(
  lineas: LineaPres[],
  real: Iterable<{ orden: number; centroId: string; mes: number; montoConSigno: number }>,
  ajustes: AjustesPrecarga,
): Map<string, number> {
  const porOrden = new Map(lineas.map(l => [l.orden, l]));
  const out = new Map<string, number>();
  for (const r of real) {
    const l = porOrden.get(r.orden);
    if (!l || l.clase === 'calculada' || !r.centroId) continue;
    const m = r2(realAMagnitud(l, r.montoConSigno) * factorAjuste(l, ajustes));
    if (m === 0) continue;
    const k = claveCelda(r.orden, r.centroId, r.mes);
    out.set(k, r2((out.get(k) ?? 0) + m));
  }
  return out;
}

/* ── Comparativo presupuesto vs real ── */

export interface FilaComparativo {
  orden: number;
  nombre: string;
  clase: ClaseLinea;
  presupuesto: number;
  real: number;
  /** real − presupuesto (en magnitud de la línea). */
  variacion: number;
  /** real / presupuesto × 100; null si el presupuesto es 0. */
  ejecucionPct: number | null;
  /** true = a favor (más ingreso/utilidad, o menos costo/gasto); null = sin diferencia. */
  favorable: boolean | null;
  /** Costo/gasto/descuento con el real POR ENCIMA del presupuesto del período. */
  sobregiro: boolean;
}

/** "Más es mejor" en ingresos y utilidades; "menos es mejor" en costos, gastos y descuentos. */
export const masEsMejor = (clase: ClaseLinea) => clase === 'ingreso' || clase === 'calculada';

export function filaComparativo(l: LineaPres, presupuesto: number, real: number): FilaComparativo {
  const variacion = r2(real - presupuesto);
  const ejecucionPct = Math.abs(presupuesto) > 0.005 ? r2((real / presupuesto) * 100) : null;
  const igual = Math.abs(variacion) < 0.005;
  const favorable = igual ? null : masEsMejor(l.clase) ? variacion > 0 : variacion < 0;
  const sobregiro = !masEsMejor(l.clase) && variacion > 0.005;
  return { orden: l.orden, nombre: l.nombre, clase: l.clase, presupuesto: r2(presupuesto), real: r2(real), variacion, ejecucionPct, favorable, sobregiro };
}

export interface RealCeldas {
  /** clave orden|centroUuid|mes → monto CON SIGNO del ER ('' = sin centro). */
  porCelda: ReadonlyMap<string, number>;
  /** orden|mes → consolidado con signo (todas las partidas). */
  consolidado: ReadonlyMap<string, number>;
}

/** Real de una vista (centro o todos) en magnitud por orden, para los meses dados. */
export function realVista(lineas: LineaPres[], real: RealCeldas, filtro: { centroId: string; meses: readonly number[] }): Map<number, number> {
  const meses = new Set(filtro.meses);
  const conSigno = new Map<number, number>();
  if (filtro.centroId === TODOS) {
    for (const [k, v] of real.consolidado) {
      const [o, m] = k.split('|').map(Number);
      if (meses.has(m)) conSigno.set(o, r2((conSigno.get(o) ?? 0) + v));
    }
  } else {
    for (const [k, v] of real.porCelda) {
      const [o, c, m] = k.split('|');
      if (c === filtro.centroId && meses.has(Number(m))) conSigno.set(Number(o), r2((conSigno.get(Number(o)) ?? 0) + v));
    }
  }
  const mag = new Map<number, number>();
  for (const l of lineas) if (l.clase !== 'calculada') mag.set(l.orden, realAMagnitud(l, conSigno.get(l.orden) ?? 0));
  return mag;
}

export function comparativo(
  lineas: LineaPres[],
  celdas: ReadonlyMap<string, number>,
  real: RealCeldas,
  filtro: { centroId: string; meses: readonly number[] },
): FilaComparativo[] {
  const p = resolverLineas(lineas, sumarCeldas(celdas, filtro));
  const r = resolverLineas(lineas, realVista(lineas, real, filtro));
  return lineas.map(l => filaComparativo(l, p.get(l.orden) ?? 0, r.get(l.orden) ?? 0));
}

export const mesesHasta = (mes: number) => Array.from({ length: Math.max(0, Math.min(12, mes)) }, (_, i) => i + 1);
export const TODOS_LOS_MESES = mesesHasta(12);

/** Las N líneas base más desviadas EN CONTRA (por monto), para el resumen de junta. */
export function masDesviadas(filas: FilaComparativo[], n = 5): FilaComparativo[] {
  return filas
    .filter(f => f.clase !== 'calculada' && f.favorable === false)
    .sort((a, b) => Math.abs(b.variacion) - Math.abs(a.variacion))
    .slice(0, n);
}

/** Agregados para la junta: ingresos netos, costos, gastos (todo lo que va después de la U. Bruta) y utilidad neta. */
export function agregadosJunta(lineas: LineaPres[], magnitudes: ReadonlyMap<number, number>) {
  const res = resolverLineas(lineas, magnitudes);
  const suma = (pred: (l: LineaPres) => boolean) => r2(lineas.filter(pred).reduce((s, l) => s + (magnitudes.get(l.orden) ?? 0), 0));
  const ingresosNetos = r2(suma(l => l.clase === 'ingreso') - suma(l => l.clase === 'descuento'));
  const utilidadNeta = res.get(lineas.find(l => /utilidad neta/i.test(l.nombre))?.orden ?? -1) ?? 0;
  return {
    ingresos: ingresosNetos,
    costos: suma(l => l.clase === 'costo'),
    gastos: suma(l => l.clase === 'gasto'),
    utilidad: utilidadNeta,
  };
}

/** Mes de corte para el real: el mes en curso si es el año actual; 12 si ya pasó; 0 si todavía no empieza. */
export function mesDeCorte(anio: number, hoy: string): number {
  const [y, m] = hoy.split('-').map(Number);
  if (anio < y) return 12;
  if (anio > y) return 0;
  return m;
}
