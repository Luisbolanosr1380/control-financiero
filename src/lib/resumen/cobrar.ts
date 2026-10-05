/**
 * "¿A quién le cobro?" — agrupa las facturas pendientes por cliente. PURO.
 * Las cedidas a factoraje quedan fuera (las cobra el financiador), igual
 * que en los totales de facturas-pendientes.ts. Orden: el que más debe
 * vencido primero; después los que solo tienen saldo por vencer.
 */
import type { FacturaPendiente } from '@/lib/db/facturas-pendientes';

export interface ClienteCobrar {
  cliente: string;
  saldo: number;
  vencido: number;
  maxDiasVencidos: number;
  facturas: Array<{ noFactura: string; saldo: number; diasVencidos: number; fechaVencimiento: string }>;
}

export function agruparPorCliente(filas: FacturaPendiente[]): ClienteCobrar[] {
  const por = new Map<string, ClienteCobrar>();
  for (const f of filas) {
    if (f.cedida || !(f.saldo > 0.01)) continue;
    const k = f.custId || f.cliente;
    const c = por.get(k) ?? { cliente: f.cliente, saldo: 0, vencido: 0, maxDiasVencidos: -Infinity, facturas: [] };
    c.saldo += f.saldo;
    if (f.vencida) c.vencido += f.saldo;
    c.maxDiasVencidos = Math.max(c.maxDiasVencidos, f.diasVencidos);
    c.facturas.push({ noFactura: f.noFactura, saldo: f.saldo, diasVencidos: f.diasVencidos, fechaVencimiento: f.fechaVencimiento });
    por.set(k, c);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return [...por.values()]
    .map(c => ({ ...c, saldo: r2(c.saldo), vencido: r2(c.vencido), facturas: c.facturas.sort((a, b) => b.diasVencidos - a.diasVencidos) }))
    .sort((a, b) => b.vencido - a.vencido || b.maxDiasVencidos - a.maxDiasVencidos || b.saldo - a.saldo);
}
