/**
 * F-037 PARTE B — Cálculos puros de planilla (Guatemala).
 *
 * Funciones aisladas, sin I/O. Sirven para:
 *  - Calcular antigüedad de un empleado a una fecha de corte.
 *  - Calcular provisiones acumuladas (Bono 14, Aguinaldo, Vacaciones,
 *    Indemnización) pro-rateadas por días dentro del período correspondiente.
 *  - Calcular liquidación al momento de dar de baja.
 *
 * Reglas Guatemala (Código de Trabajo + decreto 42-92):
 *  - Bono 14:        período jul 1 – jun 30; pagadero 1ra quincena de julio.
 *  - Aguinaldo:      período dic 1 – nov 30; pagadero 1ra quincena de diciembre.
 *  - Vacaciones:     15 días por año trabajado completo; pro-rata por meses.
 *  - Indemnización:  1 mes de salario por año trabajado + pro-rata por meses
 *    adicionales (solo se paga si es despido SIN responsabilidad del empleado).
 *  - Bono 14 y Aguinaldo: TOPE = 1 salario mensual completo.
 *
 * Las funciones reciben Date objects o strings YYYY-MM-DD. Devuelven Q
 * con 2 decimales.
 *
 * F-041: las funciones que aceptan `fechaCorte` por default usan la fecha
 * actual EN ZONA GUATEMALA. Esto elimina el off-by-one cuando la función se
 * evalúa desde un server en zona distinta (Vercel UTC → mostraba 1 día más
 * de antigüedad en la noche local Guatemala).
 */

import { obtenerFechaHoyGuatemala } from '../utils/fechas';

const round2 = (n: number) => Math.round(n * 100) / 100;

export function parseFecha(s: string | Date | undefined): Date | null {
  if (!s) return null;
  if (s instanceof Date) return Number.isFinite(s.getTime()) ? s : null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export interface Antiguedad {
  anios: number;
  meses: number;        // 0..11
  dias: number;         // 0..30
  totalMeses: number;   // entero, redondeo hacia abajo (años*12 + meses)
  totalDias: number;
  textoLegible: string; // ej. "3 años, 4 meses"
}

export function calcularAntiguedad(fechaIngreso: string | Date, fechaCorte: string | Date = obtenerFechaHoyGuatemala()): Antiguedad {
  const ing = parseFecha(fechaIngreso);
  const cor = parseFecha(fechaCorte);
  if (!ing || !cor || cor < ing) {
    return { anios: 0, meses: 0, dias: 0, totalMeses: 0, totalDias: 0, textoLegible: '—' };
  }

  let anios = cor.getFullYear() - ing.getFullYear();
  let meses = cor.getMonth() - ing.getMonth();
  let dias  = cor.getDate()  - ing.getDate();

  if (dias < 0) {
    meses -= 1;
    // Días del mes anterior al de corte
    const prevMonth = new Date(cor.getFullYear(), cor.getMonth(), 0);
    dias += prevMonth.getDate();
  }
  if (meses < 0) {
    anios -= 1;
    meses += 12;
  }

  const totalDias = Math.floor((cor.getTime() - ing.getTime()) / (1000 * 60 * 60 * 24));
  const totalMeses = anios * 12 + meses;

  let textoLegible: string;
  if (anios === 0 && meses === 0) textoLegible = `${dias} día${dias === 1 ? '' : 's'}`;
  else if (anios === 0)            textoLegible = `${meses} mes${meses === 1 ? '' : 'es'}`;
  else if (meses === 0)            textoLegible = `${anios} año${anios === 1 ? '' : 's'}`;
  else                              textoLegible = `${anios} año${anios === 1 ? '' : 's'}, ${meses} mes${meses === 1 ? '' : 'es'}`;

  return { anios, meses, dias, totalMeses, totalDias, textoLegible };
}

/**
 * Inicio del período de Bono 14 vigente al `fechaCorte` (1 julio del año anterior).
 * Si la fecha de corte es ≥ 1 julio, el período empezó ese 1 julio.
 * Si la fecha de corte es < 1 julio, el período empezó el 1 julio del año anterior.
 */
export function inicioPeriodoBono14(fechaCorte: Date): Date {
  const y = fechaCorte.getFullYear();
  const julio = new Date(y, 6, 1);   // 1 julio
  return fechaCorte >= julio ? julio : new Date(y - 1, 6, 1);
}

/**
 * Inicio del período de Aguinaldo vigente al `fechaCorte` (1 diciembre del año anterior).
 */
export function inicioPeriodoAguinaldo(fechaCorte: Date): Date {
  const y = fechaCorte.getFullYear();
  const diciembre = new Date(y, 11, 1);   // 1 diciembre
  return fechaCorte >= diciembre ? diciembre : new Date(y - 1, 11, 1);
}

/**
 * Días entre dos fechas (inclusivo del inicio, exclusivo del final).
 * Usado para pro-rateo de provisiones.
 */
export function diasEntre(desde: Date, hasta: Date): number {
  return Math.max(0, Math.floor((hasta.getTime() - desde.getTime()) / (1000 * 60 * 60 * 24)));
}

export interface ProvisionesAcumuladas {
  bono14: number;
  aguinaldo: number;
  vacaciones: {
    diasAcumulados: number;
    valorMonetario: number;
  };
  indemnizacionPotencial: number;
  totalPasivoLaboral: number;
}

export interface EmpleadoParaCalculo {
  fechaIngreso: string | Date;
  salarioMensual: number;   // salario base + bonif + bono variable (Salario Mensual de Airtable)
  salarioBase: number;      // sin bonificaciones (para Bono 14 / Aguinaldo / Indemnización)
}

/**
 * Calcula provisiones acumuladas a la fecha de corte.
 *
 * Bono 14 y Aguinaldo se pro-ratean por días desde el inicio del período hasta
 * la fecha de corte (o desde fechaIngreso si el empleado entró después del
 * inicio del período). Tope: 1 salario base.
 *
 * Vacaciones: 15 días / 365 días * días trabajados desde el último cumpleaños
 * laboral. Aquí simplificamos: prorrateo lineal sobre el año en curso del
 * empleado.
 *
 * Indemnización potencial: 1 mes salario base * años completos + pro-rata por
 * meses adicionales (asume despido sin responsabilidad).
 */
export function calcularProvisionesAcumuladas(
  emp: EmpleadoParaCalculo,
  fechaCorte: string | Date = obtenerFechaHoyGuatemala(),
): ProvisionesAcumuladas {
  const corte = parseFecha(fechaCorte) ?? parseFecha(obtenerFechaHoyGuatemala()) ?? new Date();
  const ingreso = parseFecha(emp.fechaIngreso);
  if (!ingreso || corte < ingreso || !(emp.salarioMensual > 0)) {
    return {
      bono14: 0,
      aguinaldo: 0,
      vacaciones: { diasAcumulados: 0, valorMonetario: 0 },
      indemnizacionPotencial: 0,
      totalPasivoLaboral: 0,
    };
  }

  const salarioBase = emp.salarioBase > 0 ? emp.salarioBase : emp.salarioMensual;
  const tope = salarioBase;   // tope legal Bono 14 y Aguinaldo = 1 salario base

  // ---- Bono 14 ----
  const inicioB14 = inicioPeriodoBono14(corte);
  const inicioReal_B14 = ingreso > inicioB14 ? ingreso : inicioB14;
  const diasB14 = diasEntre(inicioReal_B14, corte);
  const provBono14Raw = (salarioBase * diasB14) / 365;
  const bono14 = round2(Math.min(tope, provBono14Raw));

  // ---- Aguinaldo ----
  const inicioAg = inicioPeriodoAguinaldo(corte);
  const inicioReal_Ag = ingreso > inicioAg ? ingreso : inicioAg;
  const diasAg = diasEntre(inicioReal_Ag, corte);
  const provAguinaldoRaw = (salarioBase * diasAg) / 365;
  const aguinaldo = round2(Math.min(tope, provAguinaldoRaw));

  // ---- Vacaciones ----
  // 15 días al año, valor = días × (salarioMensual / 30).
  // Período: desde el último "cumpleaños laboral" (mismo mes-día que ingreso).
  const ultimoCumple = ((): Date => {
    const cand = new Date(corte.getFullYear(), ingreso.getMonth(), ingreso.getDate());
    return cand > corte ? new Date(corte.getFullYear() - 1, ingreso.getMonth(), ingreso.getDate()) : cand;
  })();
  const inicioVac = ingreso > ultimoCumple ? ingreso : ultimoCumple;
  const diasTrabajadosEnAnio = diasEntre(inicioVac, corte);
  const diasVacacionesAcumulados = round2((15 * diasTrabajadosEnAnio) / 365);
  const valorVacaciones = round2(diasVacacionesAcumulados * (emp.salarioMensual / 30));

  // ---- Indemnización potencial ----
  const antiguedad = calcularAntiguedad(ingreso, corte);
  // años completos + meses adicionales (sobre 12)
  const factorIndem = antiguedad.anios + (antiguedad.meses / 12) + (antiguedad.dias / 365);
  const indemnizacionPotencial = round2(salarioBase * factorIndem);

  const totalPasivoLaboral = round2(bono14 + aguinaldo + valorVacaciones + indemnizacionPotencial);

  return {
    bono14,
    aguinaldo,
    vacaciones: { diasAcumulados: diasVacacionesAcumulados, valorMonetario: valorVacaciones },
    indemnizacionPotencial,
    totalPasivoLaboral,
  };
}

/* Liquidación al dar de baja (F-037 modal-dar-de-baja). */

export type MotivoSalida =
  | 'Renuncia'
  | 'Despido con responsabilidad'
  | 'Despido sin responsabilidad'
  | 'Fin de contrato'
  | 'Mutuo acuerdo'
  | 'Otro';

export interface LiquidacionEstimada {
  bono14: number;
  aguinaldo: number;
  vacaciones: number;
  indemnizacion: number;     // 0 si el motivo no aplica
  total: number;
}

/**
 * En Guatemala la indemnización se paga al empleado si:
 *  - Despido SIN responsabilidad del empleado (despido injustificado).
 *  - Renuncia bajo "ventaja de tiempo" en ciertos contratos (raro, no se modela).
 *  - Fin de contrato por causa imputable al patrono.
 *
 * Simplificamos: indemnización ON solo si motivo === 'Despido sin responsabilidad'.
 * 'Mutuo acuerdo' puede tener bono pero no es indemnización legal — el operador
 * lo registra como bono manual fuera del sistema si quiere.
 */
export function calcularLiquidacion(
  emp: EmpleadoParaCalculo,
  motivo: MotivoSalida,
  fechaSalida: string | Date,
): LiquidacionEstimada {
  const prov = calcularProvisionesAcumuladas(emp, fechaSalida);
  const incluyeIndem = motivo === 'Despido sin responsabilidad';
  const indem = incluyeIndem ? prov.indemnizacionPotencial : 0;
  return {
    bono14:        prov.bono14,
    aguinaldo:     prov.aguinaldo,
    vacaciones:    prov.vacaciones.valorMonetario,
    indemnizacion: indem,
    total:         round2(prov.bono14 + prov.aguinaldo + prov.vacaciones.valorMonetario + indem),
  };
}
