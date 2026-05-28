// ============================================================
// Agregaciones para el Dashboard CFO (F-002)
// Todas calculan sobre las facturas consolidadas (getFacturas)
// y los clientes reales (getClientes). Se ejecutan en el server.
// ============================================================

import { getFacturas } from './facturas';
import { getClientes } from './clientes';
import { LINES } from '../mock-data';
import type { Invoice, Customer, LineKey, LineStats, AgingEntry, HealthStatus } from '../types';

const isActiva = (i: Invoice) => i.status !== 'anulado';

export interface DashboardKPIs {
  porCobrarTotal: number;
  vencidoTotal: number;
  cobradoTotal: number;
  facturadoTotal: number;
  tasaCobranza: number;
  numVencidas: number;
  numPorCobrar: number;
  numCobradas: number;
}

export async function getDashboardKPIs(facturas?: Invoice[]): Promise<DashboardKPIs> {
  const all = facturas ?? await getFacturas();
  const activas = all.filter(isActiva);

  const porCobrarTotal = activas
    .filter(i => i.status === 'vencido' || i.status === 'por_cobrar')
    .reduce((s, i) => s + i.balance, 0);

  const vencidoTotal = activas
    .filter(i => i.status === 'vencido')
    .reduce((s, i) => s + i.balance, 0);

  const facturadoTotal = activas.reduce((s, i) => s + i.total, 0);
  const cobradoTotal = activas.reduce((s, i) => s + (i.total - i.balance), 0);
  const tasaCobranza = facturadoTotal > 0 ? (cobradoTotal / facturadoTotal) * 100 : 0;

  return {
    porCobrarTotal,
    vencidoTotal,
    cobradoTotal,
    facturadoTotal,
    tasaCobranza,
    numVencidas:   activas.filter(i => i.status === 'vencido').length,
    numPorCobrar:  activas.filter(i => i.status === 'por_cobrar').length,
    numCobradas:   activas.filter(i => i.status === 'cobrado').length,
  };
}

function healthFor(tasa: number): HealthStatus {
  if (tasa > 45) return 'good';
  if (tasa >= 20) return 'warn';
  return 'bad';
}

export async function getLineStats(facturas?: Invoice[]): Promise<LineStats[]> {
  const activas = (facturas ?? await getFacturas()).filter(isActiva);

  const order: LineKey[] = ['poligrafo', 'socio', 'talenttrack', 'administrativo'];
  const acc: Record<LineKey, { facturado: number; porCobrar: number; count: number }> = {
    poligrafo:      { facturado: 0, porCobrar: 0, count: 0 },
    socio:          { facturado: 0, porCobrar: 0, count: 0 },
    talenttrack:    { facturado: 0, porCobrar: 0, count: 0 },
    administrativo: { facturado: 0, porCobrar: 0, count: 0 },
  };

  // Atribuir por LÍNEA, no por inv.line (una factura puede ser mixta)
  for (const inv of activas) {
    for (const l of inv.lineas) {
      acc[l.line].facturado += l.amount;
      acc[l.line].porCobrar += l.balance;
      acc[l.line].count += 1;
    }
  }

  return order.map(line => {
    const a = acc[line];
    const cobrado = a.facturado - a.porCobrar;
    const tasa = a.facturado > 0 ? (cobrado / a.facturado) * 100 : 0;
    return {
      line,
      name:      LINES[line].name,
      count:     a.count,
      facturado: a.facturado,
      cobrado,
      porCobrar: a.porCobrar,
      tasa,
      health:    healthFor(tasa),
    };
  });
}

export async function getAging(facturas?: Invoice[]): Promise<AgingEntry[]> {
  const conSaldo = (facturas ?? await getFacturas()).filter(i => isActiva(i) && i.balance > 0);

  const buckets = [
    { label: 'Corriente', range: '0 días', cls: 'aging-current', test: (d: number) => d <= 0 },
    { label: '1–30 d',    range: '1–30',   cls: 'aging-1-30',    test: (d: number) => d >= 1 && d <= 30 },
    { label: '31–60 d',   range: '31–60',  cls: 'aging-31-60',   test: (d: number) => d >= 31 && d <= 60 },
    { label: '61–90 d',   range: '61–90',  cls: 'aging-61-90',   test: (d: number) => d >= 61 && d <= 90 },
    { label: '+90 d',     range: '+90',    cls: 'aging-90',      test: (d: number) => d > 90 },
  ];

  return buckets.map(b => {
    const rows = conSaldo.filter(i => b.test(i.dueAgo));
    return {
      label:  b.label,
      range:  b.range,
      cls:    b.cls,
      amount: rows.reduce((s, i) => s + i.balance, 0),
      count:  rows.length,
    };
  });
}

export interface TopDeudor {
  custId: string;
  name: string;
  balance: number;
  vencido: number;
  numFacturas: number;
}

export async function getTopDeudores(n = 5, facturas?: Invoice[], clientes?: Customer[]): Promise<TopDeudor[]> {
  const [all, custs] = await Promise.all([
    facturas ? Promise.resolve(facturas) : getFacturas(),
    clientes ? Promise.resolve(clientes) : getClientes(),
  ]);
  const activas = all.filter(isActiva);
  const nameById = new Map(custs.map(c => [c.id, c.name]));

  const grupo = new Map<string, { balance: number; vencido: number; numFacturas: number }>();
  for (const inv of activas) {
    if (inv.balance <= 0) continue;
    const g = grupo.get(inv.custId) ?? { balance: 0, vencido: 0, numFacturas: 0 };
    g.balance += inv.balance;
    if (inv.status === 'vencido') g.vencido += inv.balance;
    g.numFacturas += 1;
    grupo.set(inv.custId, g);
  }

  return [...grupo.entries()]
    .map(([custId, g]) => ({
      custId,
      name: nameById.get(custId) || custId,
      balance: g.balance,
      vencido: g.vencido,
      numFacturas: g.numFacturas,
    }))
    .sort((a, b) => b.balance - a.balance)
    .slice(0, n);
}
