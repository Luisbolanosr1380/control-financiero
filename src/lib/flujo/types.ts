/**
 * F-051 — Tipos del motor de flujo de caja.
 *
 * EventoFlujo es la unidad atómica que viaja desde las fuentes (recurrentes,
 * CxP, deudas, planilla, cobros) hasta el agrupador por día (DiaFlujo) y el
 * forecast acumulado.
 *
 * Convención: `monto` SIEMPRE es positivo. El signo lo da `tipo`.
 */

import type { PrioridadObligacion, PorCuentaDe } from '@/lib/airtable/obligaciones-recurrentes-fields';

export type TipoEvento = 'egreso' | 'ingreso';

export type FuenteEvento =
  | 'recurrente'       // OBLIGACIONES_RECURRENTES proyectadas
  | 'cxp'              // GASTOS por pagar
  | 'deuda'            // DEUDAS con próximo pago
  | 'planilla'         // quincenas proyectadas
  | 'cobro_esperado';  // facturas con saldo

export type LinkTipoEvento = 'gasto' | 'deuda' | 'factura_cliente' | 'obligacion' | 'planilla';

export interface EventoFlujo {
  fecha: string;                    // YYYY-MM-DD
  tipo: TipoEvento;
  fuente: FuenteEvento;
  descripcion: string;
  monto: number;                    // siempre positivo
  prioridad: PrioridadObligacion;
  esEstimado: boolean;              // recurrentes y cobros sin confirmar
  /** Marca cuando la fecha fue empujada hacia el futuro (vencida → hoy+7). */
  fechaAjustada?: boolean;
  /** ID del record origen para navegar al detalle. */
  linkId?: string;
  linkTipo?: LinkTipoEvento;
  /**
   * F-051.6: empresa que asume el pago. Solo aplica a fuente='recurrente'.
   * Para las otras fuentes queda undefined (no se modelan intercompany todavía).
   */
  porCuentaDe?: PorCuentaDe;
}

export interface DiaFlujo {
  fecha: string;
  eventos: EventoFlujo[];
  totalEgresos: number;
  totalIngresos: number;
  /** Neto del día (ingresos - egresos). Negativo = sale más de lo que entra. */
  neto: number;
  /** Saldo acumulado desde el saldo inicial. */
  saldoProyectado: number;
}

export interface ProyeccionFlujo {
  saldoInicial: number;
  horizonteDias: number;
  fechaDesde: string;               // YYYY-MM-DD
  fechaHasta: string;
  dias: DiaFlujo[];
  /** Total de egresos en todo el horizonte. */
  totalEgresos: number;
  /** Total de ingresos esperados en todo el horizonte. */
  totalIngresos: number;
  /** Día con el saldo mínimo proyectado. null si no hay eventos. */
  puntoCritico: {
    fecha: string;
    saldoProyectado: number;
    seraNegativo: boolean;
  } | null;
}
