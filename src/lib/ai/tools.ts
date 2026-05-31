/**
 * Tools que la AI puede invocar por function calling. Cada tool wrappea las
 * funciones existentes en @/lib/db. La regla de oro: NO recalculamos nada
 * acá — solo proyectamos / filtramos lo que ya devuelve el backend.
 *
 * Las respuestas se mantienen compactas: muchas facturas/clientes no
 * devolvemos campos pesados que no aportan al razonamiento de la AI.
 */
import { tool } from 'ai';
import { z } from 'zod';
import { getDashboardKPIs } from '@/lib/db/kpis';
import { getFacturas } from '@/lib/db/facturas';
import { getClientes } from '@/lib/db/clientes';
import { getCobros } from '@/lib/db/cobros';
import { getAnalisisClientes } from '@/lib/db/clientes-analisis';
import { getAnaliticaIngresos, type FiltroNaturaleza } from '@/lib/db/analitica';
import type { Invoice, InvoiceStatus } from '@/lib/types';

// Estados aceptados (lo expongo crudo para que la AI sepa qué pedir).
const ESTADOS = ['vencido', 'por_cobrar', 'cobrado', 'anulado', 'pendiente', 'emitida', 'contabilizado'] as const;

// Match suave de cliente por nombre (case+acento insensible, substring).
function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
async function resolverClienteId(nombre: string): Promise<{ id: string | null; nombreEncontrado: string | null; candidatos: Array<{ id: string; name: string }> }> {
  const clientes = await getClientes();
  const q = normalizar(nombre);
  const exactos = clientes.filter(c => normalizar(c.name) === q || normalizar(c.short ?? '') === q);
  if (exactos.length === 1) return { id: exactos[0].id, nombreEncontrado: exactos[0].name, candidatos: [] };
  const contains = clientes.filter(c => normalizar(c.name).includes(q) || normalizar(c.short ?? '').includes(q));
  if (contains.length === 1) return { id: contains[0].id, nombreEncontrado: contains[0].name, candidatos: [] };
  return { id: null, nombreEncontrado: null, candidatos: contains.slice(0, 6).map(c => ({ id: c.id, name: c.name })) };
}

// Proyección compacta de Invoice (NO mandar líneas/balance interno cuando no aportan).
function proyectarFactura(i: Invoice) {
  return {
    noFactura: i.noFactura,
    fecha: i.fechaEmision,
    vencimiento: i.fechaVencimiento,
    total: i.total,
    saldo: i.balance,
    estado: i.status,
    diasVencido: Math.max(0, i.dueAgo),
    numLineas: i.lineas.length,
  };
}

// ===========================================================================
// TOOLS
// ===========================================================================

export const aiTools = {
  getKPIs: tool({
    description: 'KPIs principales del sistema: total facturado, cobrado, por cobrar, vencido, tasa de cobranza, # facturas por estado. Usar para preguntas tipo "¿cómo va el mes?", "¿cuánto debo cobrar?", "¿tasa de cobranza?".',
    parameters: z.object({}),
    execute: async () => {
      const k = await getDashboardKPIs();
      return {
        facturadoTotalQ: k.facturadoTotal,
        cobradoTotalQ: k.cobradoTotal,
        porCobrarTotalQ: k.porCobrarTotal,
        vencidoTotalQ: k.vencidoTotal,
        tasaCobranzaPct: Number((k.tasaCobranza * 100).toFixed(1)),
        numVencidas: k.numVencidas,
        numPorCobrar: k.numPorCobrar,
        numCobradas: k.numCobradas,
      };
    },
  }),

  getFacturasPorCliente: tool({
    description: 'Lista las facturas de un cliente identificado por nombre (match parcial, case-insensitive). Si el match es ambiguo, devuelve la lista de candidatos.',
    parameters: z.object({
      nombreCliente: z.string().describe('Nombre o fragmento del nombre del cliente'),
      limite: z.number().int().positive().max(50).default(20).describe('Máximo de facturas a devolver (default 20, más recientes)'),
    }),
    execute: async ({ nombreCliente, limite }) => {
      const r = await resolverClienteId(nombreCliente);
      if (!r.id) return { ok: false, motivo: r.candidatos.length === 0 ? 'cliente_no_encontrado' : 'multiples_candidatos', candidatos: r.candidatos };
      const facturas = await getFacturas({ custId: r.id });
      return {
        ok: true,
        cliente: { id: r.id, nombre: r.nombreEncontrado },
        totalFacturas: facturas.length,
        facturas: facturas.slice(0, limite).map(proyectarFactura),
      };
    },
  }),

  getFacturasPorEstado: tool({
    description: 'Lista facturas filtradas por estado: vencido, por_cobrar, cobrado, anulado, pendiente, emitida, contabilizado.',
    parameters: z.object({
      estado: z.enum(ESTADOS),
      limite: z.number().int().positive().max(100).default(30).describe('Máximo de facturas a devolver'),
    }),
    execute: async ({ estado, limite }) => {
      const facturas = await getFacturas({ status: estado as InvoiceStatus });
      const clientes = await getClientes();
      const nombreById = new Map(clientes.map(c => [c.id, c.name]));
      return {
        estado,
        total: facturas.length,
        sumaSaldoQ: facturas.reduce((s, f) => s + f.balance, 0),
        sumaTotalQ: facturas.reduce((s, f) => s + f.total, 0),
        facturas: facturas.slice(0, limite).map(f => ({
          ...proyectarFactura(f),
          cliente: nombreById.get(f.custId) ?? f.custId ?? '—',
        })),
      };
    },
  }),

  getCobrosPorPeriodo: tool({
    description: 'Lista cobros (pagos recibidos) en un rango de fechas. Útil para "¿cuánto cobré en mayo?", "¿cobros de la última semana?".',
    parameters: z.object({
      desde: z.string().describe('Fecha inicio en formato YYYY-MM-DD (inclusive)'),
      hasta: z.string().describe('Fecha fin en formato YYYY-MM-DD (inclusive)'),
      limite: z.number().int().positive().max(200).default(100).describe('Máximo de cobros a devolver'),
    }),
    execute: async ({ desde, hasta, limite }) => {
      const cobros = await getCobros();
      const clientes = await getClientes();
      const nombreById = new Map(clientes.map(c => [c.id, c.name]));
      const enRango = cobros.filter(c => c.date >= desde && c.date <= hasta);
      enRango.sort((a, b) => b.date.localeCompare(a.date));
      return {
        desde, hasta,
        total: enRango.length,
        sumaQ: enRango.reduce((s, c) => s + c.amount, 0),
        cobros: enRango.slice(0, limite).map(c => ({
          fecha: c.date,
          cliente: nombreById.get(c.custId) ?? c.custId,
          montoQ: c.amount,
          metodo: c.method,
          banco: c.bank,
          referencia: c.ref,
        })),
      };
    },
  }),

  getAnalisisClienteDetalle: tool({
    description: 'Análisis completo de un cliente: clasificación de retención (estable / en_riesgo / en_declive / perdido), naturaleza (recurrente/proyecto/mixto), facturación promedio, meses sin facturar, tendencia, contexto comercial. Usar para "¿cómo está X cliente?", "¿cliente fugado?".',
    parameters: z.object({
      nombreCliente: z.string(),
    }),
    execute: async ({ nombreCliente }) => {
      const r = await resolverClienteId(nombreCliente);
      if (!r.id) return { ok: false, motivo: r.candidatos.length === 0 ? 'cliente_no_encontrado' : 'multiples_candidatos', candidatos: r.candidatos };
      const todos = await getAnalisisClientes();
      const a = todos.find(c => c.custId === r.id);
      if (!a) return { ok: false, motivo: 'sin_analisis_disponible' };
      return {
        ok: true,
        cliente: a.nombre,
        clasificacion: a.clasificacion,
        naturalezaDominante: a.naturalezaDominante,
        pctRecurrente: Number((a.pctRecurrente * 100).toFixed(1)),
        mesesSinFacturar: Number(a.mesesSinFacturar.toFixed(1)),
        intervaloNormalMeses: a.intervaloNormal !== null ? Number(a.intervaloNormal.toFixed(1)) : null,
        montoPromedioMensualQ: Math.round(a.montoPromedio),
        montoReciente3mQ: Math.round(a.montoReciente),
        montoBase3mQ: Math.round(a.montoBase),
        tendencia: a.tendencia,
        ultimaFactura: a.ultimaFactura,
        contextoComercial: a.contextoComercial ?? null,
      };
    },
  }),

  getClientesEnRiesgo: tool({
    description: 'Clientes que están en riesgo, en declive o perdidos, ordenados por monto promedio mensual (mayor impacto primero). Por default filtra a recurrentes (los proyecto-dominantes son episódicos y su ausencia puede ser ciclo normal).',
    parameters: z.object({
      incluirEpisodicos: z.boolean().default(false).describe('Si true, incluye también clientes por proyecto. Por default solo recurrentes/mixtos.'),
      limite: z.number().int().positive().max(30).default(15),
    }),
    execute: async ({ incluirEpisodicos, limite }) => {
      const todos = await getAnalisisClientes();
      const filtrados = todos
        .filter(c => ['en_riesgo', 'en_declive', 'perdido'].includes(c.clasificacion))
        .filter(c => incluirEpisodicos || c.naturalezaDominante !== 'proyecto')
        .sort((a, b) => b.montoPromedio - a.montoPromedio)
        .slice(0, limite);
      return {
        total: filtrados.length,
        clientes: filtrados.map(c => ({
          nombre: c.nombre,
          clasificacion: c.clasificacion,
          naturaleza: c.naturalezaDominante,
          montoPromedioMensualQ: Math.round(c.montoPromedio),
          mesesSinFacturar: Number(c.mesesSinFacturar.toFixed(1)),
          ultimaFactura: c.ultimaFactura,
          contexto: c.contextoComercial ?? null,
        })),
      };
    },
  }),

  getAnaliticaIngresos: tool({
    description: 'Métricas analíticas globales: tendencia mensual, mes pico/valle, mayor caída mes a mes, top clientes que crecieron/cayeron (movers), concentración Pareto (top 5/10/20%, intocables del 80%), clientes apagados por mes. Filtro opcional por naturaleza.',
    parameters: z.object({
      filtroNaturaleza: z.enum(['todos', 'recurrente', 'proyecto']).default('todos').describe('todos | recurrente (solo Polígrafo+Socio+Admin) | proyecto (TalentTrack)'),
    }),
    execute: async ({ filtroNaturaleza }) => {
      const a = await getAnaliticaIngresos(filtroNaturaleza as FiltroNaturaleza);
      // Proyección compacta — la versión cruda es enorme.
      return {
        serieMensualTotal: a.serieMensualTotal,
        mesPico: a.mesPico,
        mesValle: a.mesValle,
        mesQuiebre: a.mesQuiebre,
        variacionPorServicio: a.variacionPorServicio,
        topQueCrecieron: a.moversClientes.crecieron.slice(0, 8).map(m => ({
          cliente: m.nombre,
          base3mQ: Math.round(m.base),
          reciente3mQ: Math.round(m.reciente),
          variacionQ: Math.round(m.variacionQ),
          variacionPct: Number(m.variacionPct.toFixed(1)),
        })),
        topQueCayeron: a.moversClientes.cayeron.slice(0, 8).map(m => ({
          cliente: m.nombre,
          base3mQ: Math.round(m.base),
          reciente3mQ: Math.round(m.reciente),
          variacionQ: Math.round(m.variacionQ),
          variacionPct: Number(m.variacionPct.toFixed(1)),
          ultimaFactura: m.ultimaFactura,
        })),
        concentracion: {
          top5pct: Number(a.concentracion.top5pct.toFixed(1)),
          top10pct: Number(a.concentracion.top10pct.toFixed(1)),
          top20pct: Number(a.concentracion.top20pct.toFixed(1)),
          intocables80pct: a.concentracion.clientes80pct,
          totalClientes: a.concentracion.totalClientes,
          top5: a.concentracion.top5.map(c => ({ cliente: c.nombre, facturacion12mQ: Math.round(c.monto), pctDelTotal: Number(c.pctDelTotal.toFixed(1)) })),
        },
        apagadosRecientes: a.clientesApagadosPorMes
          .filter(b => b.cantidad > 0)
          .slice(-3)
          .map(b => ({ mes: b.mes, cantidad: b.cantidad, montoPerdidoQ: Math.round(b.montoPerdido) })),
      };
    },
  }),

  getServiciosPerformance: tool({
    description: 'Variación reciente por línea de servicio (Poligrafia / Socioeconomicos / TalentTrackAI / Administrativo / Otros): facturación últimos 3 meses vs 3 anteriores. Atajo a la variacionPorServicio sin pedir toda la analítica.',
    parameters: z.object({}),
    execute: async () => {
      const a = await getAnaliticaIngresos('todos');
      return {
        variacion3m: a.variacionPorServicio.map(v => ({
          servicio: v.servicio,
          reciente3mQ: Math.round(v.reciente),
          base3mQ: Math.round(v.base),
          variacionQ: Math.round(v.variacionQ),
          variacionPct: Number(v.variacionPct.toFixed(1)),
        })),
      };
    },
  }),
} as const;

export type AiToolName = keyof typeof aiTools;
