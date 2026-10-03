// ============================================================
// FIX-DASHBOARD-ANALITICA-HIT — Dashboard con datos VIVOS por empresa.
//
// Antes el dashboard renderizaba mock-data del prototipo: AI_INSIGHTS
// (las "alertas" de Génesis/TalentTrack/Polígrafo que HIT veía) y
// MONTHLY (evolución 12m inventada). Acá se calculan EN VIVO desde la
// base del deploy; una base vacía produce series en Q0 y cero alertas,
// nunca datos de otra empresa.
// ============================================================

import { getCobrosCompletos } from './cobros';
import type { LineStatsCC, DashboardKPIs, TopDeudor } from './kpis';
import type { AnalisisCliente } from './clientes-analisis';
import type { Invoice, MonthlyEntry, AIInsight, AgingEntry } from '../types';
import { Q } from '../utils';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const ymKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Facturado (por mes de emisión) vs cobrado (por mes de cobro), últimos 12 meses. */
export async function getEvolucion12m(facturas: Invoice[]): Promise<MonthlyEntry[]> {
  const now = new Date();
  const buckets: Array<{ ym: string; label: string }> = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ ym: ymKey(d), label: `${MESES[d.getMonth()]}${d.getMonth() === 0 || i === 11 ? ` '${String(d.getFullYear()).slice(2)}` : ''}` });
  }
  const idx = new Map(buckets.map((b, i) => [b.ym, i]));

  const fact = new Array(buckets.length).fill(0);
  for (const f of facturas) {
    if (f.estadoBruto === 'anulado' || f.estadoBruto === 'refacturado' || !f.fechaEmision) continue;
    const i = idx.get(f.fechaEmision.slice(0, 7));
    if (i !== undefined) fact[i] += f.total;
  }

  const cob = new Array(buckets.length).fill(0);
  try {
    const cobros = await getCobrosCompletos();
    for (const c of cobros) {
      if (c.estadoCobro !== 'Activo' || !c.fechaCobro) continue;
      const i = idx.get(c.fechaCobro.slice(0, 7));
      if (i !== undefined) cob[i] += c.monto;
    }
  } catch {
    // sin cobros legibles → la serie queda en 0 (fail-soft)
  }

  return buckets.map((b, i) => ({ m: b.label, fact: Math.round(fact[i]), cob: Math.round(cob[i]) }));
}

/**
 * Alertas del dashboard calculadas en vivo desde los agregados que la
 * página ya computó (sin queries extra). Reglas simples y explicables;
 * una base sin movimiento no dispara ninguna.
 */
export function construirAlertasVivas(args: {
  kpis: DashboardKPIs;
  lineStats: LineStatsCC[];
  aging: AgingEntry[];
  topDeudores: TopDeudor[];
  clientesRiesgo: AnalisisCliente[];
}): AIInsight[] {
  const { kpis, lineStats, aging, topDeudores, clientesRiesgo } = args;
  const alertas: AIInsight[] = [];

  // 1) Concentración en +90 días (lo más caro de cobrar).
  const plus90 = aging[aging.length - 1];
  if (plus90 && plus90.amount > 0 && kpis.porCobrarTotal > 0) {
    const pct = (plus90.amount / kpis.porCobrarTotal) * 100;
    if (pct >= 15) {
      alertas.push({
        id: 'aging-90',
        severity: pct >= 30 ? 'critical' : 'warning',
        title: `${pct.toFixed(0)}% de la cartera lleva más de 90 días vencida`,
        body: `${plus90.count} factura${plus90.count === 1 ? '' : 's'} concentra${plus90.count === 1 ? '' : 'n'} ${Q(plus90.amount)} en el tramo +90 — cada mes que pasa son más difíciles de cobrar.`,
        actions: [],
        impact: Q(plus90.amount),
      });
    }
  }

  // 2) Deudor dominante con vencido alto.
  const top = topDeudores[0];
  if (top && top.vencido > 0 && kpis.vencidoTotal > 0) {
    const pct = (top.vencido / kpis.vencidoTotal) * 100;
    if (pct >= 30) {
      alertas.push({
        id: 'deudor-top',
        severity: pct >= 50 ? 'critical' : 'warning',
        title: `${top.name} concentra el ${pct.toFixed(0)}% del vencido`,
        body: `Debe ${Q(top.balance)} en ${top.numFacturas} factura${top.numFacturas === 1 ? '' : 's'}, con ${Q(top.vencido)} ya vencidos. Priorizar la gestión de cobro acá mueve la aguja.`,
        actions: [],
        impact: Q(top.vencido),
      });
    }
  }

  // 3) Línea con cobranza débil (solo líneas con facturación real).
  const minFacturado = kpis.facturadoTotal * 0.05;
  const lineaDebil = lineStats
    .filter(l => l.ccId !== null && l.facturado > Math.max(minFacturado, 0) && l.tasa < 45)
    .sort((a, b) => a.tasa - b.tasa)[0];
  if (lineaDebil) {
    alertas.push({
      id: 'linea-debil',
      severity: lineaDebil.tasa < 20 ? 'critical' : 'warning',
      title: `${lineaDebil.name}: tasa de cobranza ${lineaDebil.tasa.toFixed(1)}%`,
      body: `Facturó ${Q(lineaDebil.facturado)} y quedan ${Q(lineaDebil.porCobrar)} por cobrar — la línea más floja del negocio en recuperación.`,
      actions: [],
      impact: Q(lineaDebil.porCobrar),
    });
  }

  // 4) Clientes recurrentes apagándose (fuga).
  const perdidos = clientesRiesgo.filter(c => c.clasificacion === 'perdido' || c.clasificacion === 'en_riesgo');
  if (perdidos.length > 0) {
    const montoMes = perdidos.reduce((s, c) => s + c.montoPromedio, 0);
    alertas.push({
      id: 'clientes-riesgo',
      severity: 'info',
      title: `${perdidos.length} cliente${perdidos.length === 1 ? '' : 's'} recurrente${perdidos.length === 1 ? '' : 's'} en riesgo o perdido${perdidos.length === 1 ? '' : 's'}`,
      body: `Facturaban ${Q(montoMes)}/mes en promedio. El detalle está en la tabla de clientes en riesgo, abajo.`,
      actions: [],
      impact: `${Q(montoMes)}/mes`,
    });
  }

  return alertas.slice(0, 4);
}
