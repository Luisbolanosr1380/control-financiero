/**
 * Tools que la AI puede invocar por function calling. Cada tool wrappea las
 * funciones existentes en @/lib/db. La regla de oro: NO recalculamos nada
 * acá — solo proyectamos / filtramos lo que ya devuelve el backend.
 *
 * Las tools que dependen de un período aceptan un parámetro `periodo`
 * (mes_actual | mes_anterior | ultimos_3_meses | ultimos_6_meses | ytd |
 * rango) e incluyen un bloque "metadata" en su respuesta con fecha_desde,
 * fecha_hasta, estado_periodo, días transcurridos, etc. — para que el
 * modelo NUNCA confunda YTD con "este mes" ni compare un mes en curso
 * contra otro cerrado sin advertirlo.
 */
import { tool } from 'ai';
import { z } from 'zod';
import { getFacturas } from '@/lib/db/facturas';
import { getClientes } from '@/lib/db/clientes';
import { getCobrosCompletos } from '@/lib/db/cobros';
import { getAnalisisClientes } from '@/lib/db/clientes-analisis';
import { getAnaliticaIngresos, getFacturadoPorRango, type FiltroNaturaleza } from '@/lib/db/analitica';
import { resolverPeriodo, enRango, type PeriodoNombre, type PeriodoMetadata } from '@/lib/db/periodos';
import type { Invoice, InvoiceStatus } from '@/lib/types';

const ESTADOS = ['vencido', 'por_cobrar', 'cobrado', 'anulado', 'pendiente', 'emitida', 'contabilizado'] as const;

const PERIODOS = ['mes_actual', 'mes_anterior', 'ultimos_3_meses', 'ultimos_6_meses', 'ytd', 'rango'] as const;
const periodoDesc =
  'Período a consultar. mes_actual = mes en curso (no cerrado). mes_anterior = último mes completo. ' +
  'ultimos_3_meses / ultimos_6_meses = N meses cerrados (excluye el mes en curso). ytd = año a la fecha. ' +
  'rango = pasar desde y hasta. Para "este mes" usar mes_actual; para "el mes pasado" mes_anterior; para "cómo viene el año" ytd.';

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

const periodoParams = z.object({
  periodo: z.enum(PERIODOS).default('ytd').describe(periodoDesc),
  desde: z.string().optional().describe('YYYY-MM-DD inclusive (solo si periodo="rango")'),
  hasta: z.string().optional().describe('YYYY-MM-DD inclusive (solo si periodo="rango")'),
});
type PeriodoInput = z.infer<typeof periodoParams>;
function meta(input: PeriodoInput): PeriodoMetadata {
  return resolverPeriodo(input.periodo as PeriodoNombre, new Date(), { desde: input.desde, hasta: input.hasta });
}

// ===========================================================================
// TOOLS
// ===========================================================================

export const aiTools = {
  getKPIs: tool({
    description:
      'KPIs del período: facturado y cobrado del rango, tasa de cobranza del período. ' +
      'También devuelve KPIs de STOCK (saldo por cobrar / vencido) que son SIEMPRE del momento actual (no dependen del período). ' +
      'Usar para "¿cómo viene este mes?" (periodo=mes_actual), "¿el año?" (periodo=ytd), "¿el mes pasado?" (periodo=mes_anterior). ' +
      'Si el usuario no aclara, asumí mes_actual para "este mes" y ytd para "el año".',
    parameters: periodoParams,
    execute: async (input) => {
      const m = meta(input);
      const [facturas, cobros] = await Promise.all([getFacturas(), getCobrosCompletos()]);
      const activas = facturas.filter(i => i.status !== 'anulado');
      const facturadasEnRango = activas.filter(i => enRango(i.fechaEmision, m.fecha_desde, m.fecha_hasta));
      const cobradosEnRango   = cobros.filter(c => enRango(c.fechaCobro, m.fecha_desde, m.fecha_hasta));

      const facturadoPeriodoQ = Math.round(facturadasEnRango.reduce((s, i) => s + i.total, 0));
      const cobradoPeriodoQ   = Math.round(cobradosEnRango.reduce((s, c) => s + c.monto, 0));
      const tasaCobranzaPeriodoPct = facturadoPeriodoQ > 0 ? Number(((cobradoPeriodoQ / facturadoPeriodoQ) * 100).toFixed(1)) : 0;

      // KPIs de STOCK (no dependen del período)
      const porCobrarLifetimeQ = Math.round(activas.filter(i => i.status === 'vencido' || i.status === 'por_cobrar').reduce((s, i) => s + i.balance, 0));
      const vencidoLifetimeQ   = Math.round(activas.filter(i => i.status === 'vencido').reduce((s, i) => s + i.balance, 0));

      return {
        metadata: m,
        flujo_del_periodo: {
          facturadoQ: facturadoPeriodoQ,
          cobradoQ: cobradoPeriodoQ,
          tasaCobranzaPct: tasaCobranzaPeriodoPct,
          numFacturas: facturadasEnRango.length,
          numCobros: cobradosEnRango.length,
        },
        stock_actual: {
          porCobrarQ: porCobrarLifetimeQ,
          vencidoQ: vencidoLifetimeQ,
          numVencidas: activas.filter(i => i.status === 'vencido').length,
          numPorCobrar: activas.filter(i => i.status === 'por_cobrar').length,
        },
      };
    },
  }),

  getFacturadoPorPeriodo: tool({
    description:
      'Facturado del período desglosado por servicio (Poligrafia, Socioeconomicos, TalentTrackAI, Administrativo, Otros). ' +
      'USAR cuando el usuario pregunte "cuánto facturé este mes/el mes pasado/el año" o quiera el split por servicio en un período. ' +
      'Más preciso que getKPIs cuando lo que importa es el facturado y su composición.',
    parameters: periodoParams,
    execute: async (input) => {
      const m = meta(input);
      const r = await getFacturadoPorRango(m.fecha_desde, m.fecha_hasta);
      return { metadata: m, ...r };
    },
  }),

  getServiciosPerformance: tool({
    description:
      'Variación de facturación por servicio (Poligrafia / Socioeconomicos / TalentTrackAI / Administrativo / Otros) entre el período pedido y el período IGUAL inmediatamente anterior. ' +
      'Ej: mes_actual compara mayo (en curso) vs abril; ultimos_3_meses compara feb-abr vs nov-ene. ' +
      'Si el periodo es "en_curso" (mes_actual / ytd), incluí en tu respuesta la advertencia: el período no está cerrado.',
    parameters: periodoParams,
    execute: async (input) => {
      const m = meta(input);
      // Período igual anterior: misma cantidad de días, terminando 1 día antes que `desde`.
      const desde = new Date(m.fecha_desde + 'T00:00:00');
      const hasta = new Date(m.fecha_hasta + 'T00:00:00');
      const baseHasta = new Date(desde.getTime() - 86400000);
      const baseDesde = new Date(baseHasta.getTime() - (hasta.getTime() - desde.getTime()));
      const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      const [reciente, base] = await Promise.all([
        getFacturadoPorRango(m.fecha_desde, m.fecha_hasta),
        getFacturadoPorRango(isoLocal(baseDesde), isoLocal(baseHasta)),
      ]);
      const baseByServ = new Map(base.porServicio.map(p => [p.servicio, p.montoQ]));
      const recByServ  = new Map(reciente.porServicio.map(p => [p.servicio, p.montoQ]));
      const SERVS = Array.from(new Set([...recByServ.keys(), ...baseByServ.keys()]));

      return {
        metadata: m,
        comparacion: 'período_actual_vs_periodo_igual_anterior',
        base: { desde: isoLocal(baseDesde), hasta: isoLocal(baseHasta), totalQ: base.facturadoTotalQ },
        reciente: { desde: m.fecha_desde, hasta: m.fecha_hasta, totalQ: reciente.facturadoTotalQ },
        variacionPorServicio: SERVS.map(servicio => {
          const r = recByServ.get(servicio) ?? 0;
          const b = baseByServ.get(servicio) ?? 0;
          const v = r - b;
          const pct = b > 0 ? Number(((v / b) * 100).toFixed(1)) : null;
          return { servicio, recienteQ: r, baseQ: b, variacionQ: v, variacionPct: pct };
        }).sort((a, b) => a.variacionQ - b.variacionQ),
      };
    },
  }),

  getCobrosPorPeriodo: tool({
    description:
      'Lista cobros (pagos recibidos) en un período. Devuelve total y lista detallada. ' +
      'Útil para "¿cuánto cobré en mayo?" (mes_actual), "¿cobros de la última semana?" (rango).',
    parameters: periodoParams.extend({
      limite: z.number().int().positive().max(200).default(100).describe('Máximo de cobros a devolver'),
    }),
    execute: async ({ periodo, desde, hasta, limite }) => {
      const m = meta({ periodo, desde, hasta });
      const cobros = await getCobrosCompletos();
      const clientes = await getClientes();
      const nombreById = new Map(clientes.map(c => [c.id, c.name]));
      const enRangoCobros = cobros.filter(c => enRango(c.fechaCobro, m.fecha_desde, m.fecha_hasta));
      enRangoCobros.sort((a, b) => b.fechaCobro.localeCompare(a.fechaCobro));
      return {
        metadata: m,
        total: enRangoCobros.length,
        sumaQ: Math.round(enRangoCobros.reduce((s, c) => s + c.monto, 0)),
        cobros: enRangoCobros.slice(0, limite).map(c => ({
          fecha: c.fechaCobro,
          cliente: nombreById.get(c.custId) ?? c.custId,
          noFactura: c.noFactura,
          montoQ: Math.round(c.monto),
          metodo: c.metodo,
          banco: c.bancoNombre,
          referencia: c.referencia,
        })),
      };
    },
  }),

  getFacturasPorCliente: tool({
    description: 'Lista las facturas de un cliente identificado por nombre (match parcial, case-insensitive). Si el match es ambiguo, devuelve la lista de candidatos. No filtra por período (devuelve la historia del cliente).',
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
    description: 'Lista facturas filtradas por estado (vencido, por_cobrar, cobrado, anulado, pendiente, emitida, contabilizado). Es STOCK actual — no depende de período.',
    parameters: z.object({
      estado: z.enum(ESTADOS),
      limite: z.number().int().positive().max(100).default(30),
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

  getAnalisisClienteDetalle: tool({
    description: 'Análisis completo de un cliente (clasificación, naturaleza, mesesSinFacturar, tendencia, contexto). Usar para "¿cómo está X cliente?".',
    parameters: z.object({ nombreCliente: z.string() }),
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
    description: 'Clientes en riesgo / declive / perdidos, ordenados por monto promedio mensual. Por default solo recurrentes (los proyecto son episódicos).',
    parameters: z.object({
      incluirEpisodicos: z.boolean().default(false).describe('Si true incluye también clientes proyecto.'),
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
    description:
      'Métricas analíticas GLOBALES (12 meses): tendencia mensual, mes pico/valle, mayor caída mes a mes, movers, Pareto, apagados. ' +
      'Usar SOLO para vistas de 12 meses; para preguntas sobre un mes o período específico, usar getKPIs / getFacturadoPorPeriodo / getServiciosPerformance.',
    parameters: z.object({
      filtroNaturaleza: z.enum(['todos', 'recurrente', 'proyecto']).default('todos'),
    }),
    execute: async ({ filtroNaturaleza }) => {
      const a = await getAnaliticaIngresos(filtroNaturaleza as FiltroNaturaleza);
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
} as const;

export type AiToolName = keyof typeof aiTools;
