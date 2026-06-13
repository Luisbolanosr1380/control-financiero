/**
 * F-056.1 — Proyección del asiento de RECUPERACIÓN intercompany.
 *
 * F-056 modeló el DESEMBOLSO (Dr CxC HIT / Cr Banco): Golden adelanta
 * la plata. F-056.1 modela la RECUPERACIÓN: Golden cobra la factura
 * intercompany emitida a la empresa hermana.
 *
 * Estructura del asiento, según margen:
 *
 *   margen_pct = 0 (estado actual: reembolso al costo):
 *     Dr  Banco                                      [monto adelantado]
 *     Cr  1-1-3-3-x CxC Intercompany [empresa]       [monto adelantado]
 *     2 partidas. Cancela exactamente la CxC.
 *
 *   margen_pct > 0 (estado futuro, ej 0.05 = 5%):
 *     base   = monto adelantado
 *     fee    = base * margen_pct
 *     cobro  = base + fee
 *     Dr  Banco                                      [cobro]
 *     Cr  1-1-3-3-x CxC Intercompany [empresa]       [base]
 *     Cr  4-1-7-x Ingresos Servicios Admin. [empresa] [fee]
 *     3 partidas. Cancela CxC y reconoce ingreso por el margen.
 *
 * Hook IVA (NO implementado, queda comentado): si el contador confirma
 * que el fee lleva IVA débito fiscal del 12%, agregar una 4ta partida
 * Cr 2-1-3 IVA Débito Fiscal y aumentar el Dr Banco. Esto debe
 * decidirlo el contador en la luz verde de F-056.1.
 *
 * Función PURA: no escribe a Airtable. La generación real está detrás
 * del flag GENERAR_ASIENTO_INTERCOMPANY (intercompany-config.ts), que
 * arranca en false hasta que el contador valide la estructura.
 */

import {
  CXC_INTERCOMPANY,
  INGRESO_INTERCOMPANY,
  type EmpresaIntercompany,
} from '@/lib/contabilidad/cuentas-sistema';
import { MARGEN_INTERCOMPANY_PCT } from '@/lib/contabilidad/intercompany-config';

const round2 = (n: number) => Math.round(n * 100) / 100;

export type TipoPartida = 'Dr' | 'Cr';
export type CategoriaPartidaRecuperacion = 'banco' | 'cxc_intercompany' | 'ingreso_intercompany';

export interface PartidaRecuperacion {
  tipo: TipoPartida;
  categoria: CategoriaPartidaRecuperacion;
  /** Cuenta CxC o Ingreso: recordId+codigo. Banco queda para el caller. */
  cuentaContableId?: string;
  cuentaCodigo?: string;
  empresa?: EmpresaIntercompany;
  /** Monto en GTQ (siempre positivo; el signo va en `tipo`). */
  montoQ: number;
  descripcion: string;
}

export interface AsientoRecuperacionProyectado {
  empresa: EmpresaIntercompany | null;
  margenPct: number;
  baseQ: number;
  feeQ: number;
  cobroQ: number;
  partidas: PartidaRecuperacion[];
  /** Σ Dr == Σ Cr (tolerancia 0.01). */
  balanceado: boolean;
  /** Mensajes para mostrar en la UI (empresa no mapeada, margen inválido, etc.). */
  advertencias: string[];
}

export interface ProyectarRecuperacionInput {
  empresa: string;
  montoAdelantadoQ: number;
  /** 0..1. Si no se pasa, usa MARGEN_INTERCOMPANY_PCT global. */
  margenPct?: number;
}

function esEmpresaIntercompany(s: string): s is EmpresaIntercompany {
  return Object.prototype.hasOwnProperty.call(CXC_INTERCOMPANY, s);
}

export function proyectarAsientoRecuperacionIntercompany(
  input: ProyectarRecuperacionInput,
): AsientoRecuperacionProyectado {
  const advertencias: string[] = [];
  const margenPct = typeof input.margenPct === 'number' ? input.margenPct : MARGEN_INTERCOMPANY_PCT;

  // Validaciones de entrada.
  if (!(input.montoAdelantadoQ > 0)) {
    advertencias.push('Monto adelantado debe ser mayor a 0.');
  }
  if (!Number.isFinite(margenPct) || margenPct < 0 || margenPct > 1) {
    advertencias.push(`Margen inválido (${margenPct}). Debe estar entre 0 y 1.`);
  }
  if (!esEmpresaIntercompany(input.empresa)) {
    advertencias.push(`Empresa "${input.empresa}" no tiene cuenta CxC/ingreso mapeada. Pedile al contador y agregala a CXC_INTERCOMPANY / INGRESO_INTERCOMPANY.`);
    return {
      empresa: null,
      margenPct,
      baseQ: round2(input.montoAdelantadoQ),
      feeQ: 0,
      cobroQ: round2(input.montoAdelantadoQ),
      partidas: [],
      balanceado: false,
      advertencias,
    };
  }

  if (advertencias.length > 0) {
    // Hay error de input pero la empresa sí está mapeada — devolvemos
    // estructura vacía con advertencias para que la UI pueda mostrar
    // qué falló sin romper el render.
    return {
      empresa: input.empresa,
      margenPct,
      baseQ: 0,
      feeQ: 0,
      cobroQ: 0,
      partidas: [],
      balanceado: false,
      advertencias,
    };
  }

  const empresa = input.empresa;
  const cxc      = CXC_INTERCOMPANY[empresa];
  const ingreso  = INGRESO_INTERCOMPANY[empresa];

  const base  = round2(input.montoAdelantadoQ);
  const fee   = round2(base * margenPct);
  const cobro = round2(base + fee);

  const partidas: PartidaRecuperacion[] = [];

  // Dr Banco — el caller decide la cuenta del banco real al persistir
  // (cuenta_contable del BANCO usado). Acá lo dejamos sin cuentaContableId
  // y con `categoria: 'banco'` para que la UI sepa qué partida es.
  partidas.push({
    tipo: 'Dr',
    categoria: 'banco',
    montoQ: cobro,
    descripcion: `Cobro de factura intercompany a ${empresa}`,
  });

  // Cr CxC Intercompany — cancela el saldo del desembolso.
  partidas.push({
    tipo: 'Cr',
    categoria: 'cxc_intercompany',
    cuentaContableId: cxc.recordId,
    cuentaCodigo: cxc.codigo,
    empresa,
    montoQ: base,
    descripcion: `Cancelación CxC adelanto a ${empresa}`,
  });

  // Cr Ingreso fee — solo si hay margen > 0.
  if (fee > 0) {
    partidas.push({
      tipo: 'Cr',
      categoria: 'ingreso_intercompany',
      cuentaContableId: ingreso.recordId,
      cuentaCodigo: ingreso.codigo,
      empresa,
      montoQ: fee,
      descripcion: `Ingreso servicios administrativos a ${empresa} (margen ${(margenPct * 100).toFixed(1)}%)`,
    });
  }

  // HOOK IVA débito fiscal (NO implementado — queda pendiente de
  // confirmación del contador):
  //   if (margenPct > 0 && IVA_SOBRE_FEE) {
  //     const iva = round2(fee * 0.12);
  //     partidas.push({ tipo: 'Cr', categoria: 'iva_debito_fiscal', ... });
  //     // y el Dr Banco subiría: cobro + iva.
  //   }

  const totalDr = round2(partidas.filter(p => p.tipo === 'Dr').reduce((s, p) => s + p.montoQ, 0));
  const totalCr = round2(partidas.filter(p => p.tipo === 'Cr').reduce((s, p) => s + p.montoQ, 0));
  const balanceado = Math.abs(totalDr - totalCr) <= 0.01;
  if (!balanceado) {
    advertencias.push(`Asiento NO balanceado: Dr=${totalDr} Cr=${totalCr}.`);
  }

  return {
    empresa,
    margenPct,
    baseQ: base,
    feeQ: fee,
    cobroQ: cobro,
    partidas,
    balanceado,
    advertencias,
  };
}
