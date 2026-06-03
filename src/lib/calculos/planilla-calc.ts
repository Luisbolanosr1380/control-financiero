/**
 * F-038 — Cálculos puros de una quincena de planilla (Guatemala).
 *
 * Sin I/O. Reglas:
 *  - Ordinario = salarioBase / 2 (quincena = mitad del salario mensual).
 *  - Bonificación = Q125 fijos por quincena (decreto 78-89 = Q250/mes ÷ 2).
 *  - IGSS laboral = 4.83% SOLO sobre el ordinario; bonificación no cotiza.
 *  - ISR según tabla SAT 2026 (anual): 0–48,000 exento; 48,000–300,000 al 5%;
 *    >300,000 = 12,600 + 7% sobre el exceso. Se proyecta el ingreso quincenal
 *    a 24 quincenas, se calcula ISR anual y se divide entre 24.
 *  - Neto = ingresoBruto - igssLaboral - isr - otrosDescuentos.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export const BONIFICACION_QUINCENAL = 125;
export const IGSS_LABORAL_PCT = 0.0483;

export interface EmpleadoParaPlanilla {
  id: string;
  nombre: string;
  salarioBase: number;
}

export interface DescuentoQuincena {
  tipo: 'Préstamo' | 'Anticipo' | 'Daño' | 'Otro';
  monto: number;
  descripcion?: string;
}

export interface AjustesQuincena {
  extraordinario?: number;     // pago de horas extra
  bonoKPI?: number;            // mapeado al campo COMISIONES en Airtable
  otrosIngresos?: number;
  descuentos?: DescuentoQuincena[];
}

export interface QuincenaCalculada {
  ordinario: number;
  bonificacion: number;
  extraordinario: number;
  comisiones: number;          // ≡ bonoKPI
  otrosIngresos: number;
  ingresoBruto: number;
  igssLaboral: number;
  isr: number;
  otrosDescuentos: number;
  netoPagar: number;
}

/**
 * ISR quincenal según tabla SAT GT 2026 (régimen sobre la renta de trabajo).
 *
 * Proyectamos el ingreso bruto a 24 quincenas, restamos el IGSS anual estimado
 * (igssLaboral × 24) y calculamos el ISR sobre la renta imponible. Después
 * dividimos entre 24 para obtener la retención quincenal.
 *
 * NOTA: en Guatemala las deducciones permitidas también incluyen Q48,000 fijos
 * (ya implícitos en el tramo exento) y crédito por IVA hasta Q12,000 — este
 * último NO se contempla aquí porque solo se ajusta en la declaración anual.
 */
export function calcularISR(salarioBase: number, ingresoBrutoQuincenal: number): number {
  if (!(ingresoBrutoQuincenal > 0)) return 0;

  // IGSS anual estimado sobre el ordinario (no sobre la bonif).
  const ordinarioAnual = salarioBase * 12;
  const igssLaboralAnual = round2(ordinarioAnual * IGSS_LABORAL_PCT);

  const ingresoBrutoAnual = ingresoBrutoQuincenal * 24;
  const rentaImponible = ingresoBrutoAnual - igssLaboralAnual;

  if (rentaImponible <= 48000) return 0;

  let isrAnual: number;
  if (rentaImponible <= 300000) {
    isrAnual = (rentaImponible - 48000) * 0.05;
  } else {
    isrAnual = 12600 + (rentaImponible - 300000) * 0.07;
  }

  return round2(isrAnual / 24);
}

export function calcularQuincena(args: {
  empleado: EmpleadoParaPlanilla;
  ajustes?: AjustesQuincena;
}): QuincenaCalculada {
  const { empleado } = args;
  const ajustes = args.ajustes ?? {};

  const ordinario      = round2((empleado.salarioBase ?? 0) / 2);
  const bonificacion   = BONIFICACION_QUINCENAL;
  const extraordinario = round2(ajustes.extraordinario ?? 0);
  const comisiones     = round2(ajustes.bonoKPI ?? 0);
  const otrosIngresos  = round2(ajustes.otrosIngresos ?? 0);

  const ingresoBruto = round2(ordinario + bonificacion + extraordinario + comisiones + otrosIngresos);

  const igssLaboral = round2(ordinario * IGSS_LABORAL_PCT);
  const isr         = calcularISR(empleado.salarioBase, ingresoBruto);

  const otrosDescuentos = round2((ajustes.descuentos ?? []).reduce((s, d) => s + (d.monto || 0), 0));
  const netoPagar       = round2(ingresoBruto - igssLaboral - isr - otrosDescuentos);

  return {
    ordinario,
    bonificacion,
    extraordinario,
    comisiones,
    otrosIngresos,
    ingresoBruto,
    igssLaboral,
    isr,
    otrosDescuentos,
    netoPagar,
  };
}
