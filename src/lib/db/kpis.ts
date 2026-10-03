// ============================================================
// Agregaciones para el Dashboard CFO (F-002)
// Todas calculan sobre las facturas consolidadas (getFacturas)
// y los clientes reales (getClientes). Se ejecutan en el server.
// ============================================================

import { getFacturas } from './facturas';
import { getClientes } from './clientes';
import { getCentrosCosto } from './centros';
import type { Invoice, Customer, AgingEntry, HealthStatus } from '../types';

// F-032: usar estadoBruto directo para excluir anuladas Y refacturadas
// (antes solo se excluían anuladas vía `status !== 'anulado'`, pero las
// REFACTURADAS también se mapeaban a 'anulado' legacy — colateralmente
// se excluían, hoy ya no porque estadoBruto las distingue).
const isActiva = (i: Invoice) => i.estadoBruto !== 'anulado' && i.estadoBruto !== 'refacturado';
// F-035: COBRADO PARCIAL es parte de cobranza activa (sigue siendo cobrable).
//   - Por cobrar    = EMITIDA + COBRADO PARCIAL (cartera activa de cobranza).
//   - Cartera total = EMITIDA + PENDIENTE + COBRADO PARCIAL (todo lo no liquidado).
//   - Vencidas      = subset de Por cobrar con vencida=true.
const esPorCobrar    = (i: Invoice) => i.estadoBruto === 'emitida' || i.estadoBruto === 'cobrado_parcial';
const esCarteraTotal = (i: Invoice) => esPorCobrar(i) || i.estadoBruto === 'pendiente';

export interface DashboardKPIs {
  porCobrarTotal: number;
  carteraTotal: number;        // F-034: EMITIDA + PENDIENTE
  vencidoTotal: number;
  cobradoTotal: number;
  facturadoTotal: number;
  tasaCobranza: number;
  numVencidas: number;
  numPorCobrar: number;
  numCarteraTotal: number;     // F-034
  numPendientes: number;       // F-034
  numCobradas: number;
  // F-034.2: líneas crudas (servicios facturados) en el universo activo.
  // Una factura SAT con 3 servicios suma 3 a numServiciosActivos y 1 a numFacturasActivas.
  numFacturasActivas: number;
  numServiciosActivos: number;
}

export async function getDashboardKPIs(facturas?: Invoice[]): Promise<DashboardKPIs> {
  const all = facturas ?? await getFacturas();
  const activas = all.filter(isActiva);

  const porCobrarTotal = activas
    .filter(esPorCobrar)
    .reduce((s, i) => s + i.balance, 0);

  const carteraTotal = activas
    .filter(esCarteraTotal)
    .reduce((s, i) => s + i.balance, 0);

  const vencidoTotal = activas
    .filter(i => esPorCobrar(i) && i.vencida)
    .reduce((s, i) => s + i.balance, 0);

  const facturadoTotal = activas.reduce((s, i) => s + i.total, 0);
  const cobradoTotal = activas.reduce((s, i) => s + (i.total - i.balance), 0);
  const tasaCobranza = facturadoTotal > 0 ? (cobradoTotal / facturadoTotal) * 100 : 0;

  return {
    porCobrarTotal,
    carteraTotal,
    vencidoTotal,
    cobradoTotal,
    facturadoTotal,
    tasaCobranza,
    numVencidas:      activas.filter(i => esPorCobrar(i) && i.vencida).length,
    numPorCobrar:     activas.filter(esPorCobrar).length,
    numCarteraTotal:  activas.filter(esCarteraTotal).length,
    numPendientes:    activas.filter(i => i.estadoBruto === 'pendiente').length,
    numCobradas:      activas.filter(i => i.estadoBruto === 'cobrado').length,
    numFacturasActivas:  activas.length,
    numServiciosActivos: activas.reduce((s, i) => s + (i.lineas?.length ?? 1), 0),
  };
}

function healthFor(tasa: number): HealthStatus {
  if (tasa > 45) return 'good';
  if (tasa >= 20) return 'warn';
  return 'bad';
}

/**
 * FIX-DASHBOARD-ANALITICA-HIT: las líneas del widget "Líneas de negocio"
 * se derivan de los centros_costo ACTIVOS de la base del deploy (en
 * Golden sus 4 históricas; en HIT sus 6). El monto se atribuye por LÍNEA
 * de factura al centro real (centroCostoId); lo que no mapea a un CC
 * activo cae al bucket "Otros" (solo aparece si tiene movimiento).
 */
export interface LineStatsCC {
  ccId: string | null;          // null = bucket "Otros"
  name: string;
  count: number;
  facturado: number;
  cobrado: number;
  porCobrar: number;
  tasa: number;
  health: HealthStatus;
}

export async function getLineStats(facturas?: Invoice[]): Promise<LineStatsCC[]> {
  const [all, centros] = await Promise.all([
    facturas ? Promise.resolve(facturas) : getFacturas(),
    getCentrosCosto(),
  ]);
  const activas = all.filter(isActiva);
  const servicios = centros
    .filter(c => c.activo && c.nombre.trim())
    .map(c => ({ id: c.id, nombre: c.nombre.trim() }));

  const acc = new Map<string, { facturado: number; porCobrar: number; count: number }>();
  const bucket = (key: string) => {
    let b = acc.get(key);
    if (!b) { b = { facturado: 0, porCobrar: 0, count: 0 }; acc.set(key, b); }
    return b;
  };
  const activosSet = new Set(servicios.map(s => s.id));

  // Alias histórico (mismo criterio que la analítica): 'Poligrafia Xela'
  // (CC inactivo, oficina cerrada) suma a 'Poligrafia' cuando esa línea
  // sigue activa — antes el mapeo fijo hacía exactamente eso.
  const idActivoPorNombre = new Map(servicios.map(s => [s.nombre, s.id]));
  const redirigir = new Map<string, string>();
  for (const c of centros) {
    if (c.activo) continue;
    if (c.nombre.trim() === 'Poligrafia Xela' && idActivoPorNombre.has('Poligrafia')) {
      redirigir.set(c.id, idActivoPorNombre.get('Poligrafia')!);
    }
  }

  // Atribuir por LÍNEA, no por inv.line (una factura puede ser mixta).
  for (const inv of activas) {
    for (const l of inv.lineas) {
      const ccId = l.centroCostoId ? (redirigir.get(l.centroCostoId) ?? l.centroCostoId) : undefined;
      const key = ccId && activosSet.has(ccId) ? ccId : 'otros';
      const b = bucket(key);
      b.facturado += l.amount;
      b.porCobrar += l.balance;
      b.count += 1;
    }
  }

  const fila = (ccId: string | null, name: string, a: { facturado: number; porCobrar: number; count: number }): LineStatsCC => {
    const cobrado = a.facturado - a.porCobrar;
    const tasa = a.facturado > 0 ? (cobrado / a.facturado) * 100 : 0;
    return { ccId, name, count: a.count, facturado: a.facturado, cobrado, porCobrar: a.porCobrar, tasa, health: healthFor(tasa) };
  };

  // Todos los CCs activos SIEMPRE aparecen (aunque estén en Q0 — base nueva);
  // "Otros" solo si acumuló algo.
  const vacio = { facturado: 0, porCobrar: 0, count: 0 };
  const out = servicios.map(sv => fila(sv.id, sv.nombre, acc.get(sv.id) ?? vacio));
  out.sort((a, b) => b.facturado - a.facturado || a.name.localeCompare(b.name));
  const otros = acc.get('otros');
  if (otros && (otros.facturado !== 0 || otros.count > 0)) out.push(fila(null, 'Otros', otros));
  return out;
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
    if (inv.vencida) g.vencido += inv.balance;
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
