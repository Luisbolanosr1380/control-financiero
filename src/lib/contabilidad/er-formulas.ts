/**
 * Fórmulas del Estado de Resultados — PURAS (sin IO), compartidas por el
 * motor del ER en vivo (estado-resultados.ts) y el Presupuesto (que las
 * aplica a montos presupuestados en el servidor y en el navegador).
 *
 * La estructura del ER vive en mapeo_er y su clave estable es `orden`
 * (igual en HIT y Golden; los uuid/airtable_id difieren entre bases):
 *   10–60  ingresos · 70 descuentos y NC (resta) · 110–160 costos
 *   210–240 gastos operativos · 250 financieros · 260 depreciación
 *   270 ISR · 280 otros gastos · 900+ subtotales calculados
 * Si el orden de mapeo_er cambia, se modifican los rangos acá (un solo lugar).
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface SubtotalesER {
  ingresosBrutos: number;
  descuentosNC: number;
  ingresosNetos: number;
  costoVentas: number;
  utilidadBruta: number;
  gastosOperativos: number;
  ebitda: number;
  depreciacion: number;
  utilidadOperativa: number;
  gastosFinancieros: number;
  isr: number;
  otrosGastos: number;
  utilidadNeta: number;
}

function sumarRango(montosPorOrden: ReadonlyMap<number, number>, desde: number, hasta: number): number {
  let s = 0;
  for (const [orden, monto] of montosPorOrden) {
    if (orden >= desde && orden <= hasta) s += monto;
  }
  return round2(s);
}

function montoExacto(montosPorOrden: ReadonlyMap<number, number>, orden: number): number {
  return round2(montosPorOrden.get(orden) ?? 0);
}

/**
 * Subtotales a partir de montos CON SIGNO del ER (la línea 70 ya negativa).
 *   Ingresos Netos = Σ[10,60] + (70) · U.Bruta = Netos − Σ[110,160]
 *   EBITDA = U.Bruta − Σ[210,240] · U.Operativa = EBITDA − (260)
 *   U.Neta = U.Operativa − (250) − (270) − (280)
 */
export function calcularSubtotales(montosPorOrden: ReadonlyMap<number, number>): SubtotalesER {
  const ingresosBrutos    = sumarRango(montosPorOrden, 10, 60);
  const descuentosNC      = montoExacto(montosPorOrden, 70);
  const ingresosNetos     = round2(ingresosBrutos + descuentosNC);
  const costoVentas       = sumarRango(montosPorOrden, 110, 160);
  const utilidadBruta     = round2(ingresosNetos - costoVentas);
  const gastosOperativos  = sumarRango(montosPorOrden, 210, 240);
  const ebitda            = round2(utilidadBruta - gastosOperativos);
  const depreciacion      = montoExacto(montosPorOrden, 260);
  const utilidadOperativa = round2(ebitda - depreciacion);
  const gastosFinancieros = montoExacto(montosPorOrden, 250);
  const isr               = montoExacto(montosPorOrden, 270);
  const otrosGastos       = montoExacto(montosPorOrden, 280);
  const utilidadNeta      = round2(utilidadOperativa - gastosFinancieros - isr - otrosGastos);
  return {
    ingresosBrutos, descuentosNC, ingresosNetos,
    costoVentas, utilidadBruta,
    gastosOperativos, ebitda,
    depreciacion, utilidadOperativa,
    gastosFinancieros, isr, otrosGastos, utilidadNeta,
  };
}

/** Mapea un nombre de línea "Calculada" al subtotal correspondiente. */
export function valorCalculada(nombre: string, subt: SubtotalesER): number {
  const n = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (n.includes('ingresos netos'))                       return subt.ingresosNetos;
  if (n.includes('utilidad bruta'))                       return subt.utilidadBruta;
  if (n.includes('ebitda'))                               return subt.ebitda;
  if (n.includes('utilidad operativa') || n.includes('utilidad de operacion')) return subt.utilidadOperativa;
  if (n.includes('utilidad neta'))                        return subt.utilidadNeta;
  if (n.includes('costo de ventas'))                      return subt.costoVentas;
  if (n.includes('gastos operativos'))                    return subt.gastosOperativos;
  return 0;
}

/**
 * Signo de una línea de mapeo_er. Las bases no lo escriben igual: Golden
 * usa la raya "–" (U+2013) y HIT el guion "-" — ambos significan resta.
 */
export function esSignoNegativo(signo: string | null | undefined): boolean {
  const s = String(signo ?? '').trim();
  return s === '-' || s === '–' || s === '—' || s === '−';
}

export type ClaseLinea = 'ingreso' | 'descuento' | 'costo' | 'gasto' | 'calculada';

/** Clase de una línea por su orden (la misma convención que los subtotales). */
export function claseDeLinea(orden: number, tipo?: string): ClaseLinea {
  if (tipo === 'Calculada' || orden >= 900) return 'calculada';
  if (orden === 70) return 'descuento';
  if (orden >= 10 && orden <= 60) return 'ingreso';
  if (orden >= 110 && orden <= 160) return 'costo';
  return 'gasto';
}
