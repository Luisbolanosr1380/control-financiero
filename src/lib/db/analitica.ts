// ============================================================
// Analítica de ingresos · ventana 12 meses
// Diagnóstico profundo y accionable: tiempo, servicio, cliente.
// Atribuye por LÍNEA al centro de costo real (no por inv.line).
// ============================================================

import { getFacturas } from './facturas';
import { getClientes } from './clientes';
import { getCentrosCosto, buildNaturalezaMap, type CentroCosto, type Naturaleza } from './centros';
import type { Customer, Invoice } from '../types';
import type { SerieMes } from './clientes-analisis';

export type FiltroNaturaleza = 'todos' | 'recurrente' | 'proyecto';

export interface AnaliticaVariantes {
  todos:      AnaliticaIngresos;
  recurrente: AnaliticaIngresos;
  proyecto:   AnaliticaIngresos;
}

export const CENTROS_SERVICIOS = ['Poligrafia', 'Socioeconomicos', 'TalentTrackAI', 'Administrativo'] as const;
export const OTROS_SERVICIO = 'Otros';

const MS_PER_MONTH = 30 * 24 * 60 * 60 * 1000;
const ymKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export interface MoverCliente {
  custId: string;
  nombre: string;
  base: number;
  reciente: number;
  variacionQ: number;
  variacionPct: number;
  ultimaFactura: string;
}

export interface VariacionServicio {
  servicio: string;
  reciente: number;
  base: number;
  variacionQ: number;
  variacionPct: number;
}

export interface ConcentracionCliente {
  custId: string;
  nombre: string;
  monto: number;          // total facturado en la ventana
  pctDelTotal: number;    // % del total facturado
}

export interface ClienteApagado {
  custId: string;
  nombre: string;
  ultimoMonto: number;    // monto de su última factura
  ultimaFactura: string;  // 'YYYY-MM-DD'
}

export interface AnaliticaIngresos {
  servicios: string[];
  serieMensualTotal: SerieMes[];
  serieMensualPorServicio: Record<string, SerieMes[]>;
  mesQuiebre: { mes: string; caidaQ: number; caidaPct: number } | null;
  mesPico:  { mes: string; monto: number } | null;
  mesValle: { mes: string; monto: number } | null;
  variacionPorServicio: VariacionServicio[];
  moversClientes: { cayeron: MoverCliente[]; crecieron: MoverCliente[] };
  clientesApagadosPorMes: Array<{
    mes: string;
    cantidad: number;
    montoPerdido: number;
    clientes: ClienteApagado[];
  }>;
  concentracion: {
    top5pct: number; top10pct: number; top20pct: number;
    clientes80pct: number; totalClientes: number; totalFacturado: number;
    top5:  ConcentracionCliente[];
    top10: ConcentracionCliente[];
    top20: ConcentracionCliente[];
    clientes80: ConcentracionCliente[];
  };
}

export async function getAnaliticaIngresos(filtroNaturaleza: FiltroNaturaleza = 'todos'): Promise<AnaliticaIngresos> {
  const [facturas, clientes, centros] = await Promise.all([getFacturas(), getClientes(), getCentrosCosto()]);
  return computarAnalitica(facturas, clientes, centros, filtroNaturaleza);
}

/** Devuelve los 3 snapshots (todos / recurrente / proyecto) con UNA sola pasada de Airtable. */
export async function getAnaliticaIngresosVariantes(): Promise<AnaliticaVariantes> {
  const [facturas, clientes, centros] = await Promise.all([getFacturas(), getClientes(), getCentrosCosto()]);
  return {
    todos:      computarAnalitica(facturas, clientes, centros, 'todos'),
    recurrente: computarAnalitica(facturas, clientes, centros, 'recurrente'),
    proyecto:   computarAnalitica(facturas, clientes, centros, 'proyecto'),
  };
}

function computarAnalitica(
  facturas: Invoice[],
  clientes: Customer[],
  centros: CentroCosto[],
  filtroNaturaleza: FiltroNaturaleza,
): AnaliticaIngresos {
  // Centro id → bucket de servicio (los 4 spec'd + Otros)
  const idToName = new Map(centros.map(c => [c.id, c.nombre]));
  const SERVICIOS: string[] = [...CENTROS_SERVICIOS, OTROS_SERVICIO];
  const includeSet = new Set<string>(CENTROS_SERVICIOS);
  const nameKey = (ccId: string | undefined): string => {
    const n = ccId ? idToName.get(ccId) ?? null : null;
    return n && includeSet.has(n) ? n : OTROS_SERVICIO;
  };
  const nombreCliente = new Map(clientes.map(c => [c.id, c.name]));

  // Ventana: 12 buckets, este mes y los 11 anteriores
  const now = new Date();
  const buckets: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push(ymKey(d));
  }
  const windowStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const bucketIdx = new Map(buckets.map((m, i) => [m, i] as [string, number]));

  const activasUniverso = facturas.filter(f =>
    f.status !== 'anulado' && f.fechaEmision && new Date(f.fechaEmision) >= windowStart
  );

  // === Filtro por naturaleza del cliente (F-020) ===
  // Computamos naturalezaDominante por cliente sobre el universo completo, después filtramos.
  const naturalezaById = buildNaturalezaMap(centros);
  const natTotales = new Map<string, { recurrente: number; proyecto: number }>();
  for (const f of activasUniverso) {
    let b = natTotales.get(f.custId);
    if (!b) { b = { recurrente: 0, proyecto: 0 }; natTotales.set(f.custId, b); }
    for (const l of f.lineas) {
      const nat: Naturaleza | null = l.centroCostoId ? (naturalezaById.get(l.centroCostoId) ?? null) : null;
      if (nat === 'recurrente') b.recurrente += l.amount;
      else if (nat === 'proyecto') b.proyecto += l.amount;
    }
  }
  const naturalezaDominante = (custId: string): 'recurrente' | 'proyecto' | 'mixto' => {
    const b = natTotales.get(custId);
    if (!b) return 'recurrente';
    const tot = b.recurrente + b.proyecto;
    if (tot === 0) return 'recurrente';
    const pct = (b.recurrente / tot) * 100;
    if (pct >= 60) return 'recurrente';
    if (pct <= 40) return 'proyecto';
    return 'mixto';
  };
  const keepCliente = (custId: string): boolean => {
    if (filtroNaturaleza === 'todos') return true;
    const nat = naturalezaDominante(custId);
    if (filtroNaturaleza === 'recurrente') return nat !== 'proyecto';   // recurrente + mixto
    return nat === 'proyecto';                                           // 'proyecto' only
  };
  const activas = activasUniverso.filter(f => keepCliente(f.custId));

  // 1) Serie total mensual
  const totalPorMes = new Map<string, number>(buckets.map(m => [m, 0]));
  for (const f of activas) {
    const k = ymKey(new Date(f.fechaEmision!));
    totalPorMes.set(k, (totalPorMes.get(k) ?? 0) + f.total);
  }
  const serieMensualTotal: SerieMes[] = buckets.map(m => ({ mes: m, monto: totalPorMes.get(m) ?? 0 }));

  // 2) Por servicio (atribuyendo por LÍNEA al centro real)
  const porServ: Record<string, Map<string, number>> = {};
  for (const s of SERVICIOS) porServ[s] = new Map(buckets.map(m => [m, 0] as [string, number]));
  for (const f of activas) {
    const k = ymKey(new Date(f.fechaEmision!));
    for (const l of f.lineas) {
      const serv = nameKey(l.centroCostoId);
      porServ[serv].set(k, (porServ[serv].get(k) ?? 0) + l.amount);
    }
  }
  const serieMensualPorServicio: Record<string, SerieMes[]> = {};
  for (const s of SERVICIOS) serieMensualPorServicio[s] = buckets.map(m => ({ mes: m, monto: porServ[s].get(m) ?? 0 }));

  // 3) Mes de quiebre / pico / valle
  let mesQuiebre: AnaliticaIngresos['mesQuiebre'] = null;
  let peorDiff = 0;
  for (let i = 1; i < serieMensualTotal.length; i++) {
    const diff = serieMensualTotal[i].monto - serieMensualTotal[i - 1].monto;
    if (diff < peorDiff) {
      peorDiff = diff;
      const prev = serieMensualTotal[i - 1].monto;
      mesQuiebre = { mes: serieMensualTotal[i].mes, caidaQ: Math.abs(diff), caidaPct: prev > 0 ? (Math.abs(diff) / prev) * 100 : 0 };
    }
  }
  const mesPico = serieMensualTotal.reduce<{ mes: string; monto: number } | null>(
    (a, b) => (a == null || b.monto > a.monto ? b : a), null,
  );
  const conMonto = serieMensualTotal.filter(s => s.monto > 0);
  const mesValle = conMonto.length
    ? conMonto.reduce((a, b) => (b.monto < a.monto ? b : a))
    : null;

  // 4) Variación por servicio (reciente: meses 9..11; base: meses 6..8)
  const variacionPorServicio: VariacionServicio[] = SERVICIOS.map(s => {
    const sv = serieMensualPorServicio[s];
    const reciente = sv.slice(9, 12).reduce((acc, x) => acc + x.monto, 0);
    const base     = sv.slice(6, 9).reduce((acc, x) => acc + x.monto, 0);
    const variacionQ = reciente - base;
    const variacionPct = base > 0 ? (variacionQ / base) * 100 : (reciente > 0 ? 100 : 0);
    return { servicio: s, reciente, base, variacionQ, variacionPct };
  });

  // 5/6/7) Agregado por cliente
  interface Agg { totalReciente: number; totalBase: number; totalAnual: number; ultimaFactura: Date; ultimoMonto: number }
  const porCliente = new Map<string, Agg>();
  for (const f of activas) {
    const d = new Date(f.fechaEmision!);
    const idx = bucketIdx.get(ymKey(d)) ?? -1;
    const c = porCliente.get(f.custId) ?? { totalReciente: 0, totalBase: 0, totalAnual: 0, ultimaFactura: new Date(0), ultimoMonto: 0 };
    c.totalAnual += f.total;
    if (idx >= 9) c.totalReciente += f.total;
    else if (idx >= 6) c.totalBase += f.total;
    if (d > c.ultimaFactura) { c.ultimaFactura = d; c.ultimoMonto = f.total; }
    porCliente.set(f.custId, c);
  }

  // 5) Movers
  const moversAll: MoverCliente[] = [];
  for (const [custId, agg] of porCliente) {
    const variacionQ = agg.totalReciente - agg.totalBase;
    const variacionPct = agg.totalBase > 0 ? (variacionQ / agg.totalBase) * 100 : (agg.totalReciente > 0 ? 100 : 0);
    moversAll.push({
      custId,
      nombre: nombreCliente.get(custId) || custId || '—',
      base: agg.totalBase,
      reciente: agg.totalReciente,
      variacionQ,
      variacionPct,
      ultimaFactura: agg.ultimaFactura.toISOString().slice(0, 10),
    });
  }
  const cayeron   = moversAll.filter(m => m.variacionQ < 0).sort((a, b) => a.variacionQ - b.variacionQ).slice(0, 15);
  const crecieron = moversAll.filter(m => m.variacionQ > 0).sort((a, b) => b.variacionQ - a.variacionQ).slice(0, 15);

  // 6) Apagados por mes (excluye los activos en el mes actual). Incluye la lista de clientes.
  interface ApagadoSlot { cantidad: number; montoPerdido: number; clientes: ClienteApagado[] }
  const apagados = new Map<string, ApagadoSlot>();
  for (const m of buckets) apagados.set(m, { cantidad: 0, montoPerdido: 0, clientes: [] });
  const mesActual = buckets[buckets.length - 1];
  for (const [custId, agg] of porCliente) {
    const ultMes = ymKey(agg.ultimaFactura);
    if (ultMes === mesActual) continue;
    const slot = apagados.get(ultMes);
    if (!slot) continue;
    slot.cantidad += 1;
    slot.montoPerdido += agg.totalAnual / 12;   // proxy de su facturación mensual promedio
    slot.clientes.push({
      custId,
      nombre: nombreCliente.get(custId) || custId || '—',
      ultimoMonto: agg.ultimoMonto,
      ultimaFactura: agg.ultimaFactura.toISOString().slice(0, 10),
    });
  }
  const clientesApagadosPorMes = buckets.map(m => {
    const v = apagados.get(m)!;
    // Ordenar los clientes del mes por monto perdido descendente
    v.clientes.sort((a, b) => b.ultimoMonto - a.ultimoMonto);
    return { mes: m, cantidad: v.cantidad, montoPerdido: v.montoPerdido, clientes: v.clientes };
  });

  // 7) Concentración (Pareto) — incluye las listas concretas por bucket
  const totalFacturado = serieMensualTotal.reduce((s, x) => s + x.monto, 0);
  const pctOf = (a: number) => totalFacturado > 0 ? (a / totalFacturado) * 100 : 0;
  const sortedClientes: ConcentracionCliente[] = [...porCliente.entries()]
    .map(([custId, c]) => ({
      custId,
      nombre: nombreCliente.get(custId) || custId || '—',
      monto: c.totalAnual,
      pctDelTotal: pctOf(c.totalAnual),
    }))
    .sort((a, b) => b.monto - a.monto);

  const sumN = (n: number) => sortedClientes.slice(0, n).reduce((s, v) => s + v.monto, 0);

  let acum = 0, clientes80 = 0;
  for (const cl of sortedClientes) {
    acum += cl.monto;
    clientes80 += 1;
    if (acum >= totalFacturado * 0.8) break;
  }
  const concentracion = {
    top5pct: pctOf(sumN(5)),
    top10pct: pctOf(sumN(10)),
    top20pct: pctOf(sumN(20)),
    clientes80pct: clientes80,
    totalClientes: sortedClientes.length,
    totalFacturado,
    top5:       sortedClientes.slice(0, 5),
    top10:      sortedClientes.slice(0, 10),
    top20:      sortedClientes.slice(0, 20),
    clientes80: sortedClientes.slice(0, clientes80),
  };

  return {
    servicios: SERVICIOS,
    serieMensualTotal,
    serieMensualPorServicio,
    mesQuiebre,
    mesPico,
    mesValle,
    variacionPorServicio,
    moversClientes: { cayeron, crecieron },
    clientesApagadosPorMes,
    concentracion,
  };
}
