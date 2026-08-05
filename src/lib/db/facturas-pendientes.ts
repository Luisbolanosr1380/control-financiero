// ============================================================
// F-CXC-PEND: Facturas pendientes de cobro — TODOS los meses.
//
// La vista de /facturacion filtra por mes; esta capa arma el
// acumulado completo de "cuánto me deben" con aging de cobranza.
// Pendiente de cobro = estadoBruto ∈ {emitida, pendiente,
// cobrado_parcial} (el parcial entra con su SALDO real — sigue
// siendo cartera activa, F-035). Anuladas/refacturadas/cobradas
// quedan fuera.
//
// La usan la página /facturacion/pendientes y la tool de Auros
// getPendientesCobro — misma data, mismos números.
// ============================================================

import { getFacturas } from './facturas';
import { getClientes } from './clientes';
import { getCentrosCosto } from './centros';
import type { AgingBucket, Invoice } from '../types';

export const AGING_BUCKETS: readonly AgingBucket[] = ['corriente', '1-30', '31-60', '61-90', '90+'];

export const AGING_LABEL: Record<AgingBucket, string> = {
  corriente: 'Por vencer',
  '1-30':    '1–30 días',
  '31-60':   '31–60 días',
  '61-90':   '61–90 días',
  '90+':     '+90 días',
};

export interface FacturaPendiente {
  id: string;                 // record id de la línea principal (link a /facturacion/[id])
  noFactura: string;
  custId: string;
  cliente: string;            // razón social / nombre del cliente
  fechaEmision: string;       // YYYY-MM-DD ('' si no tiene)
  mesEmision: string;         // YYYY-MM
  total: number;
  saldo: number;              // saldo real por cobrar (parciales incluidos)
  diasCredito: number;
  fechaVencimiento: string;   // YYYY-MM-DD ('' si no calculable)
  diasVencidos: number;       // hoy − vencimiento (negativo = aún no vence)
  vencida: boolean;           // diasVencidos > 0
  bucket: AgingBucket;
  esParcial: boolean;         // ya tuvo cobros (estadoBruto = cobrado_parcial)
  centros: string[];          // nombres de centro de costo de sus líneas
  adjuntoUrl?: string;
}

export interface TramoAging {
  bucket: AgingBucket;
  etiqueta: string;
  cantidad: number;
  montoQ: number;
}

export interface PendientesCobro {
  filas: FacturaPendiente[];        // ordenadas por diasVencidos DESC
  totales: {
    saldoTotalQ: number;
    numFacturas: number;
    saldoVencidoQ: number;
    numVencidas: number;
    saldoPorVencerQ: number;
    numPorVencer: number;
  };
  aging: TramoAging[];              // los 5 tramos, siempre presentes
  porCentro: Array<{ centro: string; saldoQ: number; cantidad: number }>;
}

export function bucketDeDias(diasVencidos: number): AgingBucket {
  if (!Number.isFinite(diasVencidos) || diasVencidos <= 0) return 'corriente';
  if (diasVencidos <= 30) return '1-30';
  if (diasVencidos <= 60) return '31-60';
  if (diasVencidos <= 90) return '61-90';
  return '90+';
}

function diasVencidosDe(inv: Invoice): number {
  // dueAgo viene de la fórmula 'Dias vencidos' (NaN si la línea principal no
  // tiene fecha); como fallback se recalcula desde la fecha de vencimiento.
  if (Number.isFinite(inv.dueAgo)) return inv.dueAgo;
  if (inv.fechaVencimiento) {
    const venc = new Date(`${inv.fechaVencimiento}T00:00:00`);
    return Math.floor((Date.now() - venc.getTime()) / 86_400_000);
  }
  return 0;
}

export async function getFacturasPendientesCobro(): Promise<PendientesCobro> {
  const [facturas, clientes, centros] = await Promise.all([
    getFacturas(), getClientes(), getCentrosCosto(),
  ]);
  const clientePorId = new Map(clientes.map(c => [c.id, c]));
  const centroPorId = new Map(centros.map(c => [c.id, c.nombre]));

  const filas: FacturaPendiente[] = facturas
    .filter(f => f.estadoBruto === 'emitida' || f.estadoBruto === 'pendiente' || f.estadoBruto === 'cobrado_parcial')
    .filter(f => f.balance > 0)
    .map(f => {
      const cliente = clientePorId.get(f.custId);
      const dias = diasVencidosDe(f);
      const nombresCC = [...new Set(f.lineas.map(l => centroPorId.get(l.centroCostoId ?? '') ?? '').filter(Boolean))];
      return {
        id: f.id,
        noFactura: f.noFactura,
        custId: f.custId,
        cliente: cliente?.name ?? '—',
        fechaEmision: f.fechaEmision ?? '',
        mesEmision: (f.fechaEmision ?? '').slice(0, 7),
        total: f.total,
        saldo: f.balance,
        diasCredito: cliente?.credit ?? 0,
        fechaVencimiento: f.fechaVencimiento ?? '',
        diasVencidos: dias,
        vencida: dias > 0,
        bucket: bucketDeDias(dias),
        esParcial: f.estadoBruto === 'cobrado_parcial',
        centros: nombresCC,
        adjuntoUrl: f.adjuntoUrl,
      };
    })
    .sort((a, b) => b.diasVencidos - a.diasVencidos);

  const aging: TramoAging[] = AGING_BUCKETS.map(bucket => ({
    bucket,
    etiqueta: AGING_LABEL[bucket],
    cantidad: 0,
    montoQ: 0,
  }));
  const porBucket = new Map(aging.map(t => [t.bucket, t]));
  const porCentroMap = new Map<string, { centro: string; saldoQ: number; cantidad: number }>();

  let saldoTotalQ = 0, saldoVencidoQ = 0, numVencidas = 0;
  for (const fila of filas) {
    saldoTotalQ += fila.saldo;
    if (fila.vencida) { saldoVencidoQ += fila.saldo; numVencidas++; }
    const t = porBucket.get(fila.bucket)!;
    t.cantidad++; t.montoQ += fila.saldo;
    // El saldo por CC se reparte a la(s) línea(s): una factura mixta suma su
    // saldo completo en cada centro sería doble conteo — se asigna al primero.
    const centro = fila.centros[0] ?? 'Sin centro';
    const agg = porCentroMap.get(centro) ?? { centro, saldoQ: 0, cantidad: 0 };
    agg.saldoQ += fila.saldo; agg.cantidad++;
    porCentroMap.set(centro, agg);
  }

  return {
    filas,
    totales: {
      saldoTotalQ,
      numFacturas: filas.length,
      saldoVencidoQ,
      numVencidas,
      saldoPorVencerQ: saldoTotalQ - saldoVencidoQ,
      numPorVencer: filas.length - numVencidas,
    },
    aging,
    porCentro: [...porCentroMap.values()].sort((a, b) => b.saldoQ - a.saldoQ),
  };
}
