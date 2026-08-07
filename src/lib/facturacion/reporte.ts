/**
 * F-REPORTE-FACTURACION — Agregaciones del reporte de facturación emitida.
 *
 * Una sola fuente de verdad reusada por:
 *  - La vista /reportes/facturacion (client filtra y agrupa en memoria).
 *  - Auros tool `getReporteFacturacion(periodo, cliente?, lineas?)`.
 *
 * Entrada: dataset FacturaReporte[] completo (sin IO acá — el caller lo
 * obtiene con getFacturasReporte()). Reglas, mismas que top-clientes.ts:
 *  - Facturación EMITIDA = todo MENOS anuladas y refacturadas. Las
 *    excluidas se cuentan aparte en `numAnuladas` (anuladas + refact.)
 *    para poder mencionarlas sin mezclarlas en los totales.
 *  - Con filtro de centros de costo, cada factura aporta SOLO la porción
 *    de sus líneas en esos CCs (una factura mixta no atribuye su TOTAL
 *    completo a una línea). Facturas con porción 0 quedan fuera.
 */

import type { FacturaReporte } from '@/lib/db/facturas';

/** Filtro opcional de estado, sobre el universo ya sin anuladas/refacturadas. */
export type EstadoFiltroReporte = 'todas' | 'cobradas' | 'por_cobrar' | 'pendientes';

export interface FiltrosReporte {
  /** YYYY-MM-DD inclusive. Sin ambos → histórico completo. */
  desde?: string;
  hasta?: string;
  clienteIds?: readonly string[];
  centroCostoIds?: readonly string[];
  estado?: EstadoFiltroReporte;
}

/** Factura que pasó los filtros, con los montos atribuibles al filtro de CC. */
export interface FacturaFiltrada {
  f: FacturaReporte;
  totalQ: number;
  subtotalQ: number;
  ivaQ: number;
}

export interface ResultadoFiltro {
  filtradas: FacturaFiltrada[];
  /** Anuladas + refacturadas dentro del mismo rango/cliente/CC (excluidas del total). */
  numAnuladas: number;
}

function pasaEstado(estado: FacturaReporte['estadoBruto'], filtro: EstadoFiltroReporte): boolean {
  switch (filtro) {
    case 'cobradas':   return estado === 'cobrado';
    case 'por_cobrar': return estado === 'emitida' || estado === 'cobrado_parcial';
    case 'pendientes': return estado === 'pendiente';
    case 'todas':
    default:           return true;
  }
}

export function filtrarReporte(facturas: readonly FacturaReporte[], filtros: FiltrosReporte): ResultadoFiltro {
  const ccSet = filtros.centroCostoIds && filtros.centroCostoIds.length > 0
    ? new Set(filtros.centroCostoIds) : null;
  const cliSet = filtros.clienteIds && filtros.clienteIds.length > 0
    ? new Set(filtros.clienteIds) : null;

  const enRango = (f: FacturaReporte): boolean => {
    if (!filtros.desde && !filtros.hasta) return true;
    if (!f.fecha) return false;   // sin fecha no puede caer en un rango
    if (filtros.desde && f.fecha < filtros.desde) return false;
    if (filtros.hasta && f.fecha > filtros.hasta) return false;
    return true;
  };

  const montoAtribuible = (f: FacturaReporte): { totalQ: number; subtotalQ: number; ivaQ: number } => {
    if (!ccSet) return { totalQ: f.total, subtotalQ: f.subtotal, ivaQ: f.iva };
    let totalQ = 0, subtotalQ = 0, ivaQ = 0;
    for (const l of f.lineasCC) {
      if (!ccSet.has(l.ccId)) continue;
      totalQ += l.total; subtotalQ += l.subtotal; ivaQ += l.iva;
    }
    return { totalQ, subtotalQ, ivaQ };
  };

  const filtradas: FacturaFiltrada[] = [];
  let numAnuladas = 0;
  for (const f of facturas) {
    if (!enRango(f)) continue;
    if (cliSet && !cliSet.has(f.custId)) continue;
    const m = montoAtribuible(f);
    const esAnulada = f.estadoBruto === 'anulado' || f.estadoBruto === 'refacturado';
    if (esAnulada) {
      // Mismo criterio que top-clientes: cuenta si tiene monto atribuible al filtro.
      if (m.totalQ > 0) numAnuladas += 1;
      continue;
    }
    if (!pasaEstado(f.estadoBruto, filtros.estado ?? 'todas')) continue;
    if (ccSet && m.totalQ <= 0) continue;
    filtradas.push({ f, ...m });
  }
  return { filtradas, numAnuladas };
}

/* =========================================================================
 * Agregaciones sobre el set filtrado
 * ========================================================================= */

export interface TotalesReporte {
  totalQ: number;
  subtotalQ: number;
  ivaQ: number;
  numFacturas: number;
  ticketPromedioQ: number;   // totalQ / numFacturas (0 si no hay facturas)
}

export function totalesReporte(filtradas: readonly FacturaFiltrada[]): TotalesReporte {
  const totalQ    = filtradas.reduce((s, x) => s + x.totalQ, 0);
  const subtotalQ = filtradas.reduce((s, x) => s + x.subtotalQ, 0);
  const ivaQ      = filtradas.reduce((s, x) => s + x.ivaQ, 0);
  return {
    totalQ, subtotalQ, ivaQ,
    numFacturas: filtradas.length,
    ticketPromedioQ: filtradas.length > 0 ? totalQ / filtradas.length : 0,
  };
}

export interface GrupoReporte {
  /** custId, ccId o mes YYYY-MM según la agrupación ('' = sin valor). */
  key: string;
  montoQ: number;
  numFacturas: number;
  /** Participación 0–100 sobre el total filtrado. */
  pct: number;
}

function agrupar(pares: Iterable<{ key: string; monto: number }>): GrupoReporte[] {
  const byKey = new Map<string, { monto: number; n: number }>();
  let total = 0;
  for (const { key, monto } of pares) {
    const b = byKey.get(key) ?? { monto: 0, n: 0 };
    b.monto += monto;
    b.n += 1;
    byKey.set(key, b);
    total += monto;
  }
  return [...byKey.entries()].map(([key, v]) => ({
    key,
    montoQ: v.monto,
    numFacturas: v.n,
    pct: total > 0 ? (v.monto / total) * 100 : 0,
  }));
}

/** Ranking de clientes del set filtrado, ordenado por monto desc. */
export function reportePorCliente(filtradas: readonly FacturaFiltrada[]): GrupoReporte[] {
  return agrupar(filtradas.map(x => ({ key: x.f.custId, monto: x.totalQ })))
    .sort((a, b) => b.montoQ - a.montoQ);
}

/**
 * Total por centro de costo, ordenado por monto desc. Una factura mixta
 * aporta a cada CC su porción — por eso `numFacturas` de los grupos puede
 * sumar más que el total de facturas (una mixta cuenta en 2+ líneas).
 */
export function reportePorCentroCosto(filtradas: readonly FacturaFiltrada[], centroCostoIds?: readonly string[]): GrupoReporte[] {
  const ccSet = centroCostoIds && centroCostoIds.length > 0 ? new Set(centroCostoIds) : null;
  const pares: Array<{ key: string; monto: number }> = [];
  for (const x of filtradas) {
    const porCC = new Map<string, number>();
    for (const l of x.f.lineasCC) {
      if (ccSet && !ccSet.has(l.ccId)) continue;
      porCC.set(l.ccId, (porCC.get(l.ccId) ?? 0) + l.total);
    }
    for (const [key, monto] of porCC) {
      if (monto > 0) pares.push({ key, monto });
    }
  }
  return agrupar(pares).sort((a, b) => b.montoQ - a.montoQ);
}

/** Evolución mensual (key = YYYY-MM, '' si la factura no tiene fecha), orden cronológico. */
export function reportePorMes(filtradas: readonly FacturaFiltrada[]): GrupoReporte[] {
  return agrupar(filtradas.map(x => ({ key: x.f.fecha.slice(0, 7), monto: x.totalQ })))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/* =========================================================================
 * Período anterior comparable (para el Δ del header)
 * ========================================================================= */

const pad2 = (n: number) => String(n).padStart(2, '0');
const isoLocal = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const ultimoDiaMes = (y: number, m1: number) => new Date(y, m1, 0).getDate();

/**
 * Rango igual inmediatamente anterior a [desde, hasta].
 * Si el rango es de meses calendario completos (1º → último día), el
 * anterior son los N meses previos completos (ej. Q2 → Q1, un año → el
 * anterior). Si no, misma cantidad de días terminando el día antes de
 * `desde` (mismo criterio que getServiciosPerformance).
 */
export function rangoAnterior(desde: string, hasta: string): { desde: string; hasta: string } {
  const [dy, dm, dd] = desde.split('-').map(Number);
  const [hy, hm, hd] = hasta.split('-').map(Number);

  const esMesCompleto = dd === 1 && hd === ultimoDiaMes(hy, hm);
  if (esMesCompleto) {
    const numMeses = (hy - dy) * 12 + (hm - dm) + 1;
    if (numMeses >= 1) {
      const finAnterior = dm === 1 ? { y: dy - 1, m: 12 } : { y: dy, m: dm - 1 };
      let iy = finAnterior.y, im = finAnterior.m - (numMeses - 1);
      while (im < 1) { im += 12; iy -= 1; }
      return {
        desde: `${iy}-${pad2(im)}-01`,
        hasta: `${finAnterior.y}-${pad2(finAnterior.m)}-${pad2(ultimoDiaMes(finAnterior.y, finAnterior.m))}`,
      };
    }
  }

  const d0 = new Date(dy, dm - 1, dd);
  const h0 = new Date(hy, hm - 1, hd);
  const baseHasta = new Date(d0.getTime() - 86400000);
  const baseDesde = new Date(baseHasta.getTime() - (h0.getTime() - d0.getTime()));
  return { desde: isoLocal(baseDesde), hasta: isoLocal(baseHasta) };
}
