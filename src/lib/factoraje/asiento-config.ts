/**
 * FACTORAJE — asiento contable PARAMETRIZADO y APAGADO.
 *
 * Patrón gemelo de planilla-config.ts (F-056.2) y depreciacion-config.ts
 * (F-057): la estructura queda escrita y se puede PREVISUALIZAR, pero
 * NADIE escribe a libros hasta que el contador confirme el tratamiento
 * por tipo (agenda de la reunión):
 *
 *   · CON RECURSO  → préstamo garantizado con cartera. La CxC del cliente
 *     NO se da de baja; se reconoce un pasivo con el financiador.
 *   · SIN RECURSO  → venta de cartera. La CxC del cliente se da de baja
 *     por el monto cedido; la reserva retenida queda como CxC al
 *     financiador hasta que el cliente pague.
 *
 * Las cuentas se resuelven por CÓDIGO en la base de cada empresa (molde
 * compartido del plan). Si el contador decide otras, se cambian acá.
 * Módulo PURO: la generación (cuando se prenda) va por el RPC
 * transaccional fase2_crear_asiento_con_partidas, balanceado e
 * idempotente por asiento_ref.
 */

/** Interruptor maestro. false = solo preview; nada se escribe a libros. */
export const GENERAR_ASIENTO_FACTORAJE = false;

export const ORIGEN_ASIENTO_FACTORAJE = 'FACTORAJE';

/** Cuentas por código (plan molde, verificadas en HIT y Golden). */
export const CUENTAS_FACTORAJE = {
  CXC_CLIENTES:        '1-1-3-1',   // CxC Clientes Nacionales (sin recurso: baja de la cartera cedida)
  CXC_FINANCIADOR:     '1-1-3-9',   // Otras Cuentas por Cobrar — reserva retenida por el financiador
  PASIVO_FINANCIADOR:  '2-1-8',     // Prestamos CP — con recurso: obligación con el financiador
  GASTO_COMISION:      '6-5-2',     // Comisiones Bancarias
  GASTO_INTERES:       '6-5-1',     // Intereses
} as const;

export type TipoFactoraje = 'con_recurso' | 'sin_recurso';

export interface TerminosFactoraje {
  montoCedido: number;       // Σ facturas cedidas (valor nominal)
  reservaPct: number;        // 0-1: lo que el financiador retiene hasta el cobro
  comisionPct: number;       // 0-1 sobre el monto cedido
  interesPct: number;        // 0-1 ANUAL; se prorratea por plazoDias
  plazoDias: number;
  conRecurso: boolean;
}

export interface Desglose {
  montoCedido: number;
  reserva: number;
  comision: number;
  interes: number;
  adelantoNeto: number;      // lo que efectivamente entra al banco
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Reserva, comisión, interés y adelanto neto a partir de los términos. */
export function desglosarFactoraje(t: TerminosFactoraje): Desglose {
  const reserva = r2(t.montoCedido * (t.reservaPct || 0));
  const comision = r2(t.montoCedido * (t.comisionPct || 0));
  const interes = r2(t.montoCedido * (t.interesPct || 0) * (Math.max(t.plazoDias, 0) / 365));
  return { montoCedido: r2(t.montoCedido), reserva, comision, interes, adelantoNeto: r2(t.montoCedido - reserva - comision - interes) };
}

export interface PartidaPreview {
  cuentaCodigo: string;
  descripcion: string;
  debe: number;
  haber: number;
}

export interface AsientoFactorajePreview {
  tipo: TipoFactoraje;
  habilitado: boolean;       // = GENERAR_ASIENTO_FACTORAJE
  partidas: PartidaPreview[];
  totalDebe: number;
  totalHaber: number;
  balanceado: boolean;
  nota: string;
}

/**
 * Asiento del ADELANTO (momento de la cesión). Es la estructura propuesta,
 * pendiente de validación del contador — por eso `habilitado` refleja el flag.
 */
export function previewAsientoAdelanto(t: TerminosFactoraje, cuentaBancoCodigo: string): AsientoFactorajePreview {
  const d = desglosarFactoraje(t);
  const tipo: TipoFactoraje = t.conRecurso ? 'con_recurso' : 'sin_recurso';
  const partidas: PartidaPreview[] = [];
  if (d.adelantoNeto > 0) partidas.push({ cuentaCodigo: cuentaBancoCodigo, descripcion: 'Adelanto recibido del financiador', debe: d.adelantoNeto, haber: 0 });
  if (d.comision > 0) partidas.push({ cuentaCodigo: CUENTAS_FACTORAJE.GASTO_COMISION, descripcion: 'Comisión de factoraje', debe: d.comision, haber: 0 });
  if (d.interes > 0) partidas.push({ cuentaCodigo: CUENTAS_FACTORAJE.GASTO_INTERES, descripcion: 'Interés de factoraje (descuento)', debe: d.interes, haber: 0 });
  if (d.reserva > 0) partidas.push({ cuentaCodigo: CUENTAS_FACTORAJE.CXC_FINANCIADOR, descripcion: 'Reserva retenida por el financiador', debe: d.reserva, haber: 0 });
  partidas.push(
    tipo === 'con_recurso'
      ? { cuentaCodigo: CUENTAS_FACTORAJE.PASIVO_FINANCIADOR, descripcion: 'Obligación con el financiador (con recurso)', debe: 0, haber: d.montoCedido }
      : { cuentaCodigo: CUENTAS_FACTORAJE.CXC_CLIENTES, descripcion: 'Baja de CxC cedida (sin recurso)', debe: 0, haber: d.montoCedido },
  );
  const totalDebe = r2(partidas.reduce((s, p) => s + p.debe, 0));
  const totalHaber = r2(partidas.reduce((s, p) => s + p.haber, 0));
  return {
    tipo, habilitado: GENERAR_ASIENTO_FACTORAJE, partidas, totalDebe, totalHaber,
    balanceado: Math.abs(totalDebe - totalHaber) <= 0.01,
    nota: tipo === 'con_recurso'
      ? 'Con recurso: la CxC del cliente sigue en libros; se reconoce el pasivo con el financiador. Al cobrarse: Dr Prestamos CP / Cr CxC Clientes (+ liberación de la reserva). PENDIENTE de validación del contador.'
      : 'Sin recurso: se da de baja la CxC cedida; la reserva queda como CxC al financiador hasta el cobro. PENDIENTE de validación del contador.',
  };
}
