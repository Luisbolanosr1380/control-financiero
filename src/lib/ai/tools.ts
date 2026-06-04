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
import { getFacturas, getHistorialEdicionesFactura } from '@/lib/db/facturas';
import {
  getNotasCredito,
  getNotasCreditoPendientesAprobacion,
  getKPIsNotasCredito,
} from '@/lib/db/notas-credito';
import { getClientes } from '@/lib/db/clientes';
import { getCobrosCompletos } from '@/lib/db/cobros';
import { getTopDeudores } from '@/lib/db/kpis';
import { getAnalisisClientes } from '@/lib/db/clientes-analisis';
import { getAnaliticaIngresos, getFacturadoPorRango, type FiltroNaturaleza } from '@/lib/db/analitica';
import { getProyeccionMesActual } from '@/lib/db/proyecciones';
import { getKPIsDeudas, getDeudas, getAcreedores, clasificarPasivo } from '@/lib/db/deudas';
import { getPagosPorDeuda, getPagosPorAcreedor, getPagosRecientes } from '@/lib/db/pagos-deudas';
import { getRetencionesAgregadas } from '@/lib/db/retenciones';
import {
  getEmpleados,
  getEmpleadoPorId,
  getKPIsPlanilla,
  getPlanillaPorCentroCosto,
  getResumenSalariosPendientesConsolidado,
} from '@/lib/db/empleados';
import { getPeriodos, getPeriodoPorId, getLineasPlanilla, getPagosPendientes, getKPIsPagosPendientes } from '@/lib/db/planillas';
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
      const [facturas, cobrosTodos] = await Promise.all([getFacturas(), getCobrosCompletos()]);
      // F-036: solo cobros ACTIVOS cuentan como ingreso.
      const cobros = cobrosTodos.filter(c => c.estadoCobro === 'Activo');
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

  getProyeccionMesActual: tool({
    description:
      'Proyección del mes en curso al cierre con dos métodos: (1) extrapolación lineal por días y (2) promedio de los 3 últimos meses cerrados. ' +
      'Devuelve también los últimos 3 meses cerrados como referencia y la variación proyectada vs el mes anterior. ' +
      'USAR cuando el usuario pregunte "cómo voy este mes" (junto con getKPIs mes_actual), "estimá el cierre", "hacia dónde va el mes". ' +
      'En la respuesta marcá explícitamente "REAL" (lo facturado hasta hoy) vs "PROYECTADO" (los dos métodos) y avisá que el período no está cerrado.',
    parameters: z.object({}),
    execute: async () => getProyeccionMesActual(),
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
      const cobrosTodos = await getCobrosCompletos();
      // F-036: solo cobros activos.
      const cobros = cobrosTodos.filter(c => c.estadoCobro === 'Activo');
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

  getTopDeudores: tool({
    description:
      'Top N deudores actuales agrupados por cliente: balance pendiente total, monto vencido y nº de facturas abiertas, ordenados por balance descendente. ' +
      'USAR cuando el usuario pregunte "¿quiénes son mis deudores más críticos?", "¿quiénes me deben más?", "top N que me deben". Es STOCK del momento, no depende de período.',
    parameters: z.object({
      n: z.number().int().min(1).max(20).describe('Cuántos deudores devolver (típicamente 5)'),
    }),
    execute: async ({ n }) => {
      const deudores = await getTopDeudores(n);
      return {
        total: deudores.length,
        deudores: deudores.map(d => ({
          cliente: d.name,
          balanceQ: Math.round(d.balance),
          vencidoQ: Math.round(d.vencido),
          numFacturasAbiertas: d.numFacturas,
        })),
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

  // ===========================================================================
  // DEUDAS Y PASIVOS (F-027)
  // ===========================================================================

  getKPIsDeudas: tool({
    description:
      'Resumen del PASIVO con 4 categorías: externa (bancos, fisco, tarjetas, proveedores no relacionados), socios (parte relacionada accionaria), ex_empleados (prioridad por riesgo laboral) y asesores_relacionados (proveedores con vínculo cercano). ' +
      'Incluye vencidas (cantidad, monto, mora promedio, peor caso), próximos vencimientos a 30 días, top acreedores con su categoría y desglose por tipo de documento. ' +
      'USAR cuando el usuario pregunte "¿cuánto debo?", "¿cómo viene el pasivo?", "¿tengo deudas vencidas?", "¿cuánto es deuda externa real?". ' +
      'REGLA AL RESPONDER: SIEMPRE distinguir las 4 categorías — la deuda "real" externa es la #1; las otras tres tienen mayor flexibilidad de negociación, pero ex_empleados tiene prioridad por riesgo laboral/reputacional.',
    parameters: z.object({}),
    execute: async () => {
      const k = await getKPIsDeudas();
      return {
        totalPasivoQ: Math.round(k.totalPasivo),
        porCategoria: {
          externa:               { montoQ: Math.round(k.porCategoria.externa.monto),               cantidad: k.porCategoria.externa.cantidad },
          socios:                { montoQ: Math.round(k.porCategoria.socios.monto),                cantidad: k.porCategoria.socios.cantidad },
          ex_empleados:          { montoQ: Math.round(k.porCategoria.ex_empleados.monto),          cantidad: k.porCategoria.ex_empleados.cantidad },
          asesores_relacionados: { montoQ: Math.round(k.porCategoria.asesores_relacionados.monto), cantidad: k.porCategoria.asesores_relacionados.cantidad },
        },
        vencidas: {
          cantidad: k.vencidas.cantidad,
          montoTotalQ: Math.round(k.vencidas.montoTotal),
          diasPromedioMora: Number(k.vencidas.diasPromedioMora.toFixed(1)),
          deudaMasAntiguaDias: k.vencidas.deudaMasAntigua,
        },
        proximosVencimientos30d: {
          cantidad: k.proximosVencimientos.cantidad,
          montoTotalQ: Math.round(k.proximosVencimientos.montoTotal),
        },
        topAcreedores: k.porAcreedor.map(a => ({
          acreedor: a.acreedor,
          saldoQ: Math.round(a.saldo),
          categoria: a.categoria,
        })),
        porTipo: k.porTipo.map(t => ({ tipo: t.tipo, saldoQ: Math.round(t.saldo), cantidad: t.cantidad })),
      };
    },
  }),

  getDeudasPorAcreedor: tool({
    description:
      'Lista las deudas de un acreedor identificado por nombre (match parcial, case+acento insensible). ' +
      'Útil para "¿cuánto le debo a Banco G&T?", "¿qué deudas tengo con Mónica?". ' +
      'Si el match es ambiguo devuelve la lista de candidatos para que preguntes.',
    parameters: z.object({
      nombreAcreedor: z.string().describe('Nombre o fragmento del nombre del acreedor'),
    }),
    execute: async ({ nombreAcreedor }) => {
      const acreedores = await getAcreedores();
      const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const q = norm(nombreAcreedor);
      const matches = acreedores.filter(a =>
        norm(a.nombre).includes(q) || norm(a.nombreLegal).includes(q)
      );
      if (matches.length === 0) {
        return { ok: false, motivo: 'acreedor_no_encontrado' };
      }
      if (matches.length > 1) {
        return {
          ok: false,
          motivo: 'multiples_candidatos',
          candidatos: matches.slice(0, 8).map(a => ({
            nombre: a.nombre || a.nombreLegal,
            tipo: a.tipoAcreedor,
            categoria: clasificarPasivo(a.tipoAcreedor, a.esParteRelacionada),
          })),
        };
      }
      const ac = matches[0];
      const deudas = await getDeudas({ acreedorId: ac.id });
      const vigentes = deudas.filter(d => d.saldoPendiente > 0);
      return {
        ok: true,
        acreedor: {
          nombre: ac.nombre || ac.nombreLegal,
          tipoAcreedor: ac.tipoAcreedor,
          categoria: clasificarPasivo(ac.tipoAcreedor, ac.esParteRelacionada),
          totalDeudaInicialQ: Math.round(ac.totalDeudaInicial),
        },
        totalSaldoQ: Math.round(vigentes.reduce((s, d) => s + d.saldoPendiente, 0)),
        cantidadDeudas: vigentes.length,
        deudas: vigentes.map(d => ({
          nombre: d.nombreDeuda,
          tipoDocumento: d.tipoDocumento,
          saldoQ: Math.round(d.saldoPendiente),
          montoOriginalQ: Math.round(d.montoOriginal),
          pctAvance: Number(d.pctAvance.toFixed(1)),
          fechaVencimiento: d.fechaVencimientoReal || d.fechaVencimiento,
          diasEnMora: d.diasEnMora,
          vencida: d.vencida || d.diasEnMora > 0,
          tasaInteresPct: d.tasaInteres > 0 ? Number((d.tasaInteres * 100).toFixed(2)) : null,
        })),
      };
    },
  }),

  getDeudasVencidas: tool({
    description:
      'Lista TODAS las deudas vencidas o en mora, ordenadas por días en mora descendente. ' +
      'USAR cuando el usuario pregunte "¿qué deudas están en mora?", "¿qué tengo vencido?", "¿qué pasivos hay que pagar ya?".',
    parameters: z.object({
      limite: z.number().int().min(1).max(50).describe('Cuántas devolver (típicamente 10-20)'),
    }),
    execute: async ({ limite }) => {
      const deudas = await getDeudas({ vencidasOnly: true });
      const ord = deudas.sort((a, b) => b.diasEnMora - a.diasEnMora).slice(0, limite);
      const totalMontoQ = Math.round(deudas.reduce((s, d) => s + d.saldoPendiente, 0));
      const promedioMora = deudas.length
        ? Number((deudas.reduce((s, d) => s + d.diasEnMora, 0) / deudas.length).toFixed(1))
        : 0;
      return {
        totalVencidas: deudas.length,
        totalMontoQ,
        diasPromedioMora: promedioMora,
        deudas: ord.map(d => ({
          acreedor: d.acreedorNombre,
          categoria: d.categoriaPasivo,
          tipoDocumento: d.tipoDocumento,
          saldoQ: Math.round(d.saldoPendiente),
          diasEnMora: d.diasEnMora,
          fechaVencimiento: d.fechaVencimientoReal || d.fechaVencimiento,
          moraAcumuladaQ: Math.round(d.moraAcumulada),
        })),
      };
    },
  }),

  // ===========================================================================
  // PAGOS A ACREEDORES (F-028)
  // ===========================================================================

  getPagosPorDeuda: tool({
    description:
      'Historial de pagos hechos contra UNA deuda específica. Devuelve cantidad, total pagado en capital, y detalle de cada pago (fecha, capital, interés, mora, comisión, método, referencia, banco, notas). ' +
      'USAR cuando el usuario pregunte "¿qué cuotas llevo del préstamo X?", "¿cuándo pagué la última cuota de Y?".',
    parameters: z.object({
      nombreDeuda: z.string().describe('Nombre o fragmento del nombre de la deuda (o nombre del acreedor para encontrarla)'),
    }),
    execute: async ({ nombreDeuda }) => {
      const deudas = await getDeudas();
      const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const q = norm(nombreDeuda);
      const matches = deudas.filter(d =>
        norm(d.nombreDeuda).includes(q) ||
        norm(d.acreedorNombre).includes(q) ||
        norm(d.claveDeuda).includes(q)
      );
      if (matches.length === 0) return { ok: false, motivo: 'deuda_no_encontrada' };
      if (matches.length > 1) {
        return {
          ok: false,
          motivo: 'multiples_candidatos',
          candidatos: matches.slice(0, 8).map(d => ({
            id: d.id,
            nombre: d.nombreDeuda,
            acreedor: d.acreedorNombre,
            saldoQ: Math.round(d.saldoPendiente),
          })),
        };
      }
      const d = matches[0];
      const pagos = await getPagosPorDeuda(d.id);
      return {
        ok: true,
        deuda: {
          nombre: d.nombreDeuda,
          acreedor: d.acreedorNombre,
          saldoPendienteQ: Math.round(d.saldoPendiente),
          montoOriginalQ: Math.round(d.montoOriginal),
          pctAvance: Number(d.pctAvance.toFixed(1)),
        },
        totalPagos: pagos.length,
        totalCapitalPagadoQ: Math.round(pagos.reduce((s, p) => s + p.capital, 0)),
        pagos: pagos.map(p => ({
          fecha: p.fecha,
          montoTotalQ: Math.round(p.montoTotal),
          capitalQ: Math.round(p.capital),
          interesQ: Math.round(p.interes),
          moraQ: Math.round(p.mora),
          comisionQ: Math.round(p.comision),
          metodo: p.metodo,
          referencia: p.referencia || null,
          banco: p.cuentaBancoName || null,
        })),
      };
    },
  }),

  getPagosPorAcreedor: tool({
    description:
      'Consolidado de todos los pagos hechos a UN acreedor a través de todas sus deudas. ' +
      'USAR cuando el usuario pregunte "¿cuánto le pagué a Mónica este año?", "¿cuándo fue mi último pago a Banco Industrial?".',
    parameters: z.object({
      nombreAcreedor: z.string(),
      desde: z.string().describe('YYYY-MM-DD para filtrar pagos desde esa fecha. Pasar "" si no se filtra por desde.'),
      hasta: z.string().describe('YYYY-MM-DD para filtrar pagos hasta esa fecha. Pasar "" si no se filtra por hasta.'),
    }),
    execute: async ({ nombreAcreedor, desde, hasta }) => {
      const acreedores = await getAcreedores();
      const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const q = norm(nombreAcreedor);
      const matches = acreedores.filter(a => norm(a.nombre).includes(q) || norm(a.nombreLegal).includes(q));
      if (matches.length === 0) return { ok: false, motivo: 'acreedor_no_encontrado' };
      if (matches.length > 1) {
        return {
          ok: false,
          motivo: 'multiples_candidatos',
          candidatos: matches.slice(0, 8).map(a => ({ nombre: a.nombre || a.nombreLegal, tipo: a.tipoAcreedor, categoria: clasificarPasivo(a.tipoAcreedor, a.esParteRelacionada) })),
        };
      }
      const ac = matches[0];
      let pagos = await getPagosPorAcreedor(ac.id);
      if (desde) pagos = pagos.filter(p => p.fecha >= desde);
      if (hasta) pagos = pagos.filter(p => p.fecha <= hasta);
      return {
        ok: true,
        acreedor: {
          nombre: ac.nombre || ac.nombreLegal,
          tipoAcreedor: ac.tipoAcreedor,
          categoria: clasificarPasivo(ac.tipoAcreedor, ac.esParteRelacionada),
        },
        rango: { desde: desde ?? null, hasta: hasta ?? null },
        totalPagos: pagos.length,
        totalCapitalQ: Math.round(pagos.reduce((s, p) => s + p.capital, 0)),
        totalDesembolsadoQ: Math.round(pagos.reduce((s, p) => s + p.montoTotal, 0)),
        pagos: pagos.slice(0, 50).map(p => ({
          fecha: p.fecha,
          montoTotalQ: Math.round(p.montoTotal),
          capitalQ: Math.round(p.capital),
          metodo: p.metodo,
          referencia: p.referencia || null,
        })),
      };
    },
  }),

  getPagosRecientes: tool({
    description:
      'Lista los últimos pagos a deudas (cualquier acreedor). Útil para "¿qué pagos hice esta semana?", "¿los últimos pagos por transferencia?", "¿pagos de mayo?". ' +
      'Permite filtros opcionales por método, banco y rango de fechas.',
    parameters: z.object({
      limite: z.number().int().min(1).max(100).describe('Cuántos devolver (típicamente 10-30)'),
      metodo: z.string().describe('Método de pago para filtrar, o "" para no filtrar. Valores: Transferencia / Cheque / Efectivo / Tarjeta / Domiciliado / Compensación.'),
      banco: z.string().describe('Nombre del singleSelect Cuenta_Banco, o "" para no filtrar.'),
      desde: z.string().describe('YYYY-MM-DD, o "" para no filtrar.'),
      hasta: z.string().describe('YYYY-MM-DD, o "" para no filtrar.'),
    }),
    execute: async ({ limite, metodo, banco, desde, hasta }) => {
      let pagos = await getPagosRecientes(200);
      if (metodo) pagos = pagos.filter(p => p.metodo === metodo);
      if (banco)  pagos = pagos.filter(p => p.cuentaBancoName === banco);
      if (desde)  pagos = pagos.filter(p => p.fecha >= desde);
      if (hasta)  pagos = pagos.filter(p => p.fecha <= hasta);
      const top = pagos.slice(0, limite);
      return {
        totalPagos: pagos.length,
        totalCapitalQ: Math.round(pagos.reduce((s, p) => s + p.capital, 0)),
        totalDesembolsadoQ: Math.round(pagos.reduce((s, p) => s + p.montoTotal, 0)),
        pagos: top.map(p => ({
          fecha: p.fecha,
          acreedor: p.acreedorNombre,
          deuda: p.deudaNombre,
          montoTotalQ: Math.round(p.montoTotal),
          capitalQ: Math.round(p.capital),
          metodo: p.metodo,
          referencia: p.referencia || null,
          banco: p.cuentaBancoName || null,
        })),
      };
    },
  }),

  // ===========================================================================
  // F-035: Retenciones (crédito fiscal IVA + ISR)
  // ===========================================================================

  getRetencionesAcumuladas: tool({
    description:
      'Retenciones IVA + ISR acumuladas en el año pedido (default: año actual). ' +
      'Devuelve totales (Q por tipo + total), conteo de constancias, y breakdown mensual con 12 meses. ' +
      'USAR cuando el usuario pregunte "cuánto llevo de retenciones este año / el año pasado", ' +
      '"cuánto IVA / ISR me retuvieron", "cuánto crédito fiscal tengo".',
    parameters: z.object({
      anio: z.number().int().optional().describe('Año (4 dígitos). Si no se pasa, usa el año actual.'),
    }),
    execute: async (input) => {
      const data = await getRetencionesAgregadas(input.anio);
      return {
        anio: data.anio,
        totalQ: Math.round(data.totalGeneral),
        totalIVAQ: Math.round(data.totalIVA),
        totalISRQ: Math.round(data.totalISR),
        numConstanciasIVA: data.numIVA,
        numConstanciasISR: data.numISR,
        porMes: data.porMes.map(m => ({
          mes: m.nombre,
          ivaQ: Math.round(m.iva),
          isrQ: Math.round(m.isr),
          totalQ: Math.round(m.iva + m.isr),
        })),
      };
    },
  }),

  getRetencionesPorCliente: tool({
    description:
      'Retenciones por cliente en el año pedido (default: año actual). Devuelve top N clientes ' +
      'ordenados por monto total retenido (IVA + ISR). ' +
      'USAR cuando pregunten "qué clientes me retienen más", "lista de clientes con retenciones", ' +
      '"cuánto me retuvo X cliente este año".',
    parameters: z.object({
      anio: z.number().int().optional().describe('Año (4 dígitos). Default: año actual.'),
      limite: z.number().int().min(1).max(50).default(10).describe('Cuántos clientes top devolver.'),
    }),
    execute: async (input) => {
      const data = await getRetencionesAgregadas(input.anio);
      const top = data.porCliente.slice(0, input.limite);
      return {
        anio: data.anio,
        numClientesConRetencion: data.porCliente.length,
        totalGeneralQ: Math.round(data.totalGeneral),
        clientes: top.map(c => ({
          cliente: c.clienteNombre,
          ivaQ: Math.round(c.iva),
          isrQ: Math.round(c.isr),
          totalQ: Math.round(c.total),
          numRetenciones: c.numRetenciones,
        })),
      };
    },
  }),

  getFacturasParciales: tool({
    description:
      'Facturas con ESTADO = "COBRADO PARCIAL" — facturas que tienen cobro registrado pero aún ' +
      'tienen saldo pendiente. Cartera activa en curso. ' +
      'USAR cuando el usuario pregunte "qué facturas están a medio cobrar", "facturas con saldo parcial", ' +
      '"qué se cobró parcialmente".',
    parameters: z.object({
      limite: z.number().int().min(1).max(100).default(20).describe('Cuántas devolver, ordenadas por mayor saldo restante.'),
    }),
    execute: async (input) => {
      const facturas = await getFacturas();
      const clientes = await getClientes();
      const nombrePorId = new Map(clientes.map(c => [c.id, c.name]));
      const parciales = facturas
        .filter(f => f.estadoBruto === 'cobrado_parcial')
        .sort((a, b) => b.balance - a.balance)
        .slice(0, input.limite);
      return {
        numFacturasParciales: facturas.filter(f => f.estadoBruto === 'cobrado_parcial').length,
        totalSaldoPendienteQ: Math.round(parciales.reduce((s, f) => s + f.balance, 0)),
        facturas: parciales.map(f => ({
          noFactura: f.noFactura,
          cliente: nombrePorId.get(f.custId) ?? f.custId,
          totalQ: Math.round(f.total),
          saldoPendienteQ: Math.round(f.balance),
          pctCobrado: f.total > 0 ? Number(((1 - f.balance / f.total) * 100).toFixed(1)) : 0,
          fechaEmision: f.fechaEmision,
          vencida: f.vencida,
          diasVencido: Math.max(0, f.dueAgo),
        })),
      };
    },
  }),

  // ===========================================================================
  // F-036: Anulaciones (solo lectura — la ejecución requiere humano + motivo)
  // ===========================================================================

  getCobrosAnulados: tool({
    description:
      'Cobros que fueron ANULADOS (Estado_Cobro=Anulado) en el período pedido. ' +
      'Útil para auditoría y para detectar patrones (clientes que ' +
      'cancelan mucho, métodos que fallan más). NO se cuentan como ingreso. ' +
      'USAR cuando el usuario pregunte "cuántos cobros anulados tengo este mes", ' +
      '"qué cobros anulé este año", "patrones de anulación".',
    parameters: periodoParams,
    execute: async (input) => {
      const m = meta(input);
      const cobros = await getCobrosCompletos();
      const anulados = cobros.filter(c =>
        c.estadoCobro === 'Anulado' && enRango(c.fechaCobro, m.fecha_desde, m.fecha_hasta),
      );
      return {
        metadata: m,
        numCobrosAnulados: anulados.length,
        montoTotalAnuladoQ: Math.round(anulados.reduce((s, c) => s + c.monto, 0)),
        cobros: anulados.slice(0, 50).map(c => ({
          noFactura: c.noFactura,
          fechaCobro: c.fechaCobro,
          monto: c.monto,
          metodo: c.metodo,
          banco: c.bancoNombre,
          fechaAnulacion: c.fechaAnulacion ?? null,
          motivo: c.motivoAnulacion ?? null,
          anuladoPor: c.anuladoPor ?? null,
        })),
      };
    },
  }),

  getPagosDeudaAnulados: tool({
    description:
      'Pagos a deudas que fueron ANULADOS (Estado_Pago=Anulado). Histórico para auditoría. ' +
      'No se cuentan en Total_Pagado de la deuda — el rollup los ignora porque su Monto_Pago=0. ' +
      'USAR para "pagos anulados este mes", "cuántos pagos he tenido que reversar".',
    parameters: z.object({
      desde: z.string().optional().describe('YYYY-MM-DD inclusive (opcional).'),
      hasta: z.string().optional().describe('YYYY-MM-DD inclusive (opcional).'),
      limite: z.number().int().min(1).max(100).default(50),
    }),
    execute: async (input) => {
      const pagos = await getPagosRecientes(500, { incluirAnulados: true });
      let anulados = pagos.filter(p => p.estadoPago === 'Anulado');
      if (input.desde)  anulados = anulados.filter(p => (p.fechaAnulacion ?? p.fecha) >= input.desde!);
      if (input.hasta)  anulados = anulados.filter(p => (p.fechaAnulacion ?? p.fecha) <= input.hasta!);
      return {
        numPagosAnulados: anulados.length,
        pagos: anulados.slice(0, input.limite).map(p => ({
          deudaNombre: p.deudaNombre,
          acreedor: p.acreedorNombre,
          fechaPago: p.fecha,
          metodo: p.metodo,
          fechaAnulacion: p.fechaAnulacion ?? null,
          motivo: p.motivoAnulacion ?? null,
          anuladoPor: p.anuladoPor ?? null,
        })),
      };
    },
  }),

  getMotivosAnulacion: tool({
    description:
      'Estadística agregada de MOTIVOS de anulación (cobros o pagos). Devuelve los motivos ' +
      'más frecuentes con count para detectar patrones recurrentes (ej. "10 anulaciones por ' +
      '\'cheque devuelto\' este año"). ' +
      'USAR cuando el usuario pregunte "por qué se anulan tantas cosas", "patrón de anulaciones", ' +
      '"qué motivos predominan".',
    parameters: z.object({
      tipo: z.enum(['cobros', 'pagos', 'ambos']).default('ambos'),
      anio: z.number().int().optional().describe('Año (4 dígitos). Si no se pasa, año actual.'),
    }),
    execute: async (input) => {
      const year = input.anio ?? new Date().getFullYear();
      const motivos = new Map<string, { count: number; tipo: 'cobro' | 'pago' }>();

      if (input.tipo === 'cobros' || input.tipo === 'ambos') {
        const cobros = await getCobrosCompletos();
        for (const c of cobros) {
          if (c.estadoCobro !== 'Anulado' || !c.motivoAnulacion) continue;
          const fa = c.fechaAnulacion ?? '';
          if (!fa.startsWith(String(year))) continue;
          const motivo = c.motivoAnulacion.trim().slice(0, 80);
          const existing = motivos.get(motivo);
          if (existing) existing.count += 1;
          else motivos.set(motivo, { count: 1, tipo: 'cobro' });
        }
      }
      if (input.tipo === 'pagos' || input.tipo === 'ambos') {
        const pagos = await getPagosRecientes(500, { incluirAnulados: true });
        for (const p of pagos) {
          if (p.estadoPago !== 'Anulado' || !p.motivoAnulacion) continue;
          const fa = p.fechaAnulacion ?? '';
          if (!fa.startsWith(String(year))) continue;
          // El motivo de pagos viene con prefijo de auditoría; nos quedamos con lo que escribió el humano.
          const limpio = (p.motivoAnulacion.split('\n').pop() ?? '').trim().slice(0, 80);
          if (!limpio) continue;
          const existing = motivos.get(limpio);
          if (existing) existing.count += 1;
          else motivos.set(limpio, { count: 1, tipo: 'pago' });
        }
      }
      const top = [...motivos.entries()]
        .map(([motivo, v]) => ({ motivo, count: v.count, tipo: v.tipo }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);
      return { anio: year, tipo: input.tipo, totalMotivosUnicos: motivos.size, top };
    },
  }),

  // ===========================================================================
  // F-037: Planilla y Empleados
  // ===========================================================================

  getKPIsPlanilla: tool({
    description:
      'KPIs agregados de planilla: número de empleados activos/inactivos, costo mensual total ' +
      '(con prestaciones e IGSS patronal), pasivo laboral acumulado desglosado (Bono 14, Aguinaldo, ' +
      'Vacaciones, Indemnización potencial, Salarios pendientes diferidos), proyección del próximo ' +
      'pago de Bono 14, y empleados con datos incompletos. ' +
      'USAR cuando el usuario pregunte "¿cuánto me cuesta la planilla?", "¿cuánto debo en prestaciones?", ' +
      '"¿cuál es mi pasivo laboral total?", "¿cuántos empleados activos tengo?".',
    parameters: z.object({}),
    execute: async () => await getKPIsPlanilla(),
  }),

  getEmpleadoPorNombre: tool({
    description:
      'Datos completos de un empleado por nombre (búsqueda case+acento insensible). ' +
      'Devuelve antigüedad, salario, costo total, prestaciones acumuladas (lo que se le debe HOY), ' +
      'salarios pendientes diferidos, alertas. ' +
      'USAR cuando el usuario pregunte por un empleado específico: "¿cuánto le debo a X?", ' +
      '"¿cuánto lleva X en la empresa?", "datos de X".',
    parameters: z.object({
      nombre: z.string().min(2).describe('Nombre o fragmento del nombre del empleado.'),
    }),
    execute: async (input) => {
      const empleados = await getEmpleados();
      const q = input.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
      const matches = empleados.filter(e =>
        e.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(q),
      );
      if (matches.length === 0) return { encontrado: false, candidatos: [] };
      if (matches.length > 1) {
        return {
          encontrado: false,
          candidatos: matches.slice(0, 8).map(e => ({ id: e.id, nombre: e.nombre, departamento: e.departamento, status: e.status })),
        };
      }
      const e = matches[0];
      return {
        encontrado: true,
        empleado: {
          nombre: e.nombre,
          status: e.status,
          departamento: e.departamento,
          fechaIngreso: e.fechaIngreso,
          antiguedad: e.antiguedad.textoLegible,
          salarioMensual: e.salarioMensual,
          costoTotalMensual: e.costoTotalMensual,
          prestacionesAcumuladas: e.provisionesAcumuladas,
          salariosPendientes: e.salariosPendientes,
          tieneDatosCompletos: e.tieneDatosCompletos,
          alertas: e.alertas,
        },
      };
    },
  }),

  getEmpleadosPorDepartamento: tool({
    description:
      'Lista de empleados activos por departamento, con costo individual y antigüedad. ' +
      'USAR cuando el usuario pregunte "¿quiénes están en X departamento?", "lista de operaciones / ventas / etc".',
    parameters: z.object({
      departamento: z.string().describe('Nombre exacto o parcial del departamento.'),
    }),
    execute: async (input) => {
      const empleados = await getEmpleados();
      const q = input.departamento.toLowerCase();
      const matches = empleados.filter(e => e.status === 'ACTIVO' && e.departamento.toLowerCase().includes(q));
      return {
        departamentoBuscado: input.departamento,
        cantidad: matches.length,
        empleados: matches.map(e => ({
          nombre: e.nombre,
          antiguedad: e.antiguedad.textoLegible,
          salarioMensual: e.salarioMensual,
          costoTotalMensual: e.costoTotalMensual,
        })),
      };
    },
  }),

  getSalariosPendientes: tool({
    description:
      'Empleados con quincenas DIFERIDAS (salarios pendientes). Devuelve cada empleado con la suma ' +
      'pendiente y cantidad de quincenas no pagadas. Esto es PRIORIDAD ALTA por riesgo laboral — ' +
      'salarios no pagados a empleados activos. ' +
      'USAR para "¿a quién le debo salarios?", "¿qué quincenas están pendientes?", ' +
      '"¿cuánto debo en salarios atrasados?".',
    parameters: z.object({}),
    execute: async () => {
      const empleados = await getEmpleados({ conSalariosPendientes: true });
      const total = empleados.reduce((s, e) => s + e.salariosPendientes.total, 0);
      return {
        totalPendiente: Math.round(total),
        numEmpleadosAfectados: empleados.length,
        empleados: empleados.map(e => ({
          nombre: e.nombre,
          departamento: e.departamento,
          salariosPendientesQ: Math.round(e.salariosPendientes.total),
          numQuincenas: e.salariosPendientes.cantidad,
          deudaIds: e.salariosPendientes.deudaIds,
        })),
      };
    },
  }),

  getDatosEmpleadoCompletos: tool({
    description:
      'Detalle COMPLETO de un empleado por ID — incluye composición salarial mensual, todas las ' +
      'provisiones mensuales, provisiones acumuladas al día, salarios pendientes, datos bancarios. ' +
      'USAR cuando ya se identificó el empleado y se necesita información detallada (ej. para calcular ' +
      'liquidación o explicar el costo total).',
    parameters: z.object({
      id: z.string().describe('Record ID del empleado (rec...).'),
    }),
    execute: async (input) => {
      const e = await getEmpleadoPorId(input.id);
      if (!e) return { encontrado: false };
      return { encontrado: true, empleado: e };
    },
  }),

  // ===========================================================================
  // F-038: Planillas quincenales (períodos)
  // ===========================================================================

  getPlanillasRecientes: tool({
    description:
      'Lista los últimos N períodos de planilla (quincenas) con su monto neto total, ' +
      'cantidad de empleados, estado del período (Borrador / Aprobada / En pago / Cerrada) ' +
      'y fechas de aprobación / cierre. ' +
      'USAR para "¿cuál fue la planilla de mayo?", "últimas planillas", "cuánto sale cada quincena".',
    parameters: z.object({
      limite: z.number().int().min(1).max(48).default(6).describe('Cuántos períodos devolver, default 6 (≈3 meses).'),
    }),
    execute: async ({ limite }) => {
      const periodos = await getPeriodos({ estado: 'todos' });
      const top = periodos.slice(0, limite);
      return {
        totalPeriodosDisponibles: periodos.length,
        periodos: top.map(p => ({
          id: p.id,
          nombre: p.nombre,
          quincena: p.quincena,
          mes: p.mes,
          anio: p.anio,
          fechaInicio: p.fechaInicio,
          fechaFin: p.fechaFin,
          estado: p.estado,
          cantidadEmpleados: p.cantidadEmpleados,
          montoNetoTotalQ: Math.round(p.montoTotal),
          aprobadoPor: p.aprobadoPor ?? null,
          fechaAprobacion: p.fechaAprobacion ?? null,
          pagadoPor: p.pagadoPor ?? null,
          fechaCierre: p.fechaCierre ?? null,
        })),
      };
    },
  }),

  getPlanillaActual: tool({
    description:
      'Devuelve el período de planilla "actual" — el más reciente en estado Borrador o En pago. ' +
      'Sirve para "¿qué planilla está activa ahora mismo?", "¿qué quincena estamos pagando?". ' +
      'Si no hay ninguna en esos estados, devuelve ok:false (puede ser que la última esté Aprobada ' +
      'o Cerrada — en ese caso usar getPlanillasRecientes para ver el contexto).',
    parameters: z.object({}),
    execute: async () => {
      const periodos = await getPeriodos({ estado: 'todos' });
      const activa = periodos.find(p => p.estado === 'Borrador' || p.estado === 'En pago');
      if (!activa) {
        return {
          ok: false,
          motivo: 'sin_periodo_activo',
          mensaje: 'No hay períodos en estado Borrador o En pago. Mirá getPlanillasRecientes para ver el último.',
        };
      }
      return {
        ok: true,
        periodo: {
          id: activa.id,
          nombre: activa.nombre,
          quincena: activa.quincena,
          mes: activa.mes,
          anio: activa.anio,
          fechaInicio: activa.fechaInicio,
          fechaFin: activa.fechaFin,
          estado: activa.estado,
          cantidadEmpleados: activa.cantidadEmpleados,
          montoNetoTotalQ: Math.round(activa.montoTotal),
          aprobadoPor: activa.aprobadoPor ?? null,
          fechaAprobacion: activa.fechaAprobacion ?? null,
        },
      };
    },
  }),

  getCostoPlanillaPeriodo: tool({
    description:
      'Desglose económico completo de UNA planilla (período) por ID: ingresos brutos ' +
      '(ordinario + bonificación + extraordinario + comisiones + otros), retenciones ' +
      '(IGSS laboral + ISR + otros descuentos) y neto pagado. También cuenta cuántas líneas ' +
      'están Pagadas, Pendientes y Diferidas. ' +
      'USAR para "desglose de la planilla de [período]", "cuánto se retuvo de IGSS en X quincena", ' +
      '"cuánto se difirió de la planilla de mayo Q2".',
    parameters: z.object({
      periodoId: z.string().describe('Record ID del período (rec...).'),
    }),
    execute: async ({ periodoId }) => {
      const datos = await getPeriodoPorId(periodoId);
      if (!datos) return { ok: false, motivo: 'periodo_no_encontrado' };
      const { periodo, lineas } = datos;
      const sum = (key: keyof typeof lineas[number]) => lineas.reduce((s, l) => s + (l[key] as number), 0);
      const ordinario      = sum('ordinario');
      const bonificacion   = sum('bonificacion');
      const extraordinario = sum('extraordinario');
      const comisiones     = sum('comisiones');
      const otrosIngresos  = sum('otrosIngresos');
      const igss           = sum('igssLaboral');
      const isr            = sum('isr');
      const otrosDesc      = sum('otrosDescuentos');
      const neto           = sum('netoPagar');
      const ingresosBrutos = ordinario + bonificacion + extraordinario + comisiones + otrosIngresos;
      const totalRetenciones = igss + isr + otrosDesc;
      return {
        ok: true,
        periodo: {
          id: periodo.id,
          nombre: periodo.nombre,
          estado: periodo.estado,
          fechaInicio: periodo.fechaInicio,
          fechaFin: periodo.fechaFin,
          cantidadEmpleados: lineas.length,
        },
        ingresos: {
          ordinarioQ:      Math.round(ordinario),
          bonificacionQ:   Math.round(bonificacion),
          extraordinarioQ: Math.round(extraordinario),
          comisionesQ:     Math.round(comisiones),
          otrosIngresosQ:  Math.round(otrosIngresos),
          totalBrutosQ:    Math.round(ingresosBrutos),
        },
        retenciones: {
          igssLaboralQ:    Math.round(igss),
          isrQ:            Math.round(isr),
          otrosDescuentosQ: Math.round(otrosDesc),
          totalQ:          Math.round(totalRetenciones),
        },
        netoPagarQ: Math.round(neto),
        lineas: {
          totales:    lineas.length,
          pagadas:    lineas.filter(l => l.estadoPago === 'Pagado').length,
          pendientes: lineas.filter(l => l.estadoPago === 'Pendiente').length,
          diferidas:  lineas.filter(l => l.estadoPago === 'Diferido').length,
        },
      };
    },
  }),

  getDiferimientosPendientes: tool({
    description:
      'Lista TODAS las líneas de planilla en estado DIFERIDO cuya deuda salarial vinculada ' +
      'NO está liquidada — es decir, salarios prometidos pero todavía no pagados al empleado. ' +
      'Devuelve por empleado: nombre, período, monto neto, deudaId. ' +
      'PRIORIDAD ALTA por riesgo laboral. USAR para "¿qué diferimientos están pendientes?", ' +
      '"¿qué salarios no he pagado aún?".',
    parameters: z.object({}),
    execute: async () => {
      const periodos = await getPeriodos({ estado: 'todos' });
      const deudas = await getDeudas();
      const deudaPorId = new Map(deudas.map(d => [d.id, d]));
      // Por cada período, leemos sus líneas y filtramos Diferido + deuda no liquidada.
      const out: Array<{
        empleadoNombre: string;
        periodoNombre: string;
        periodoId: string;
        montoQ: number;
        deudaId: string | null;
        saldoDeudaQ: number | null;
        estadoDeuda: string | null;
      }> = [];
      for (const p of periodos) {
        const lineas = await getLineasPlanilla(p.id);
        for (const l of lineas) {
          if (l.estadoPago !== 'Diferido') continue;
          const deuda = l.deudaVinculadaId ? deudaPorId.get(l.deudaVinculadaId) : undefined;
          const liquidada = deuda ? /liquidada/i.test(deuda.estadoDeuda) : false;
          // Si tiene deuda y está liquidada, NO la incluyo. Si no tiene deuda vinculada
          // pero está Diferido, igual lo reporto (la línea sigue Diferido hasta confirmación humana).
          if (deuda && liquidada) continue;
          out.push({
            empleadoNombre: l.empleadoNombre || '—',
            periodoNombre: p.nombre,
            periodoId: p.id,
            montoQ: Math.round(l.netoPagar),
            deudaId: l.deudaVinculadaId ?? null,
            saldoDeudaQ: deuda ? Math.round(deuda.saldoPendiente) : null,
            estadoDeuda: deuda ? deuda.estadoDeuda : null,
          });
        }
      }
      const totalQ = out.reduce((s, r) => s + r.montoQ, 0);
      return {
        totalDiferimientos: out.length,
        montoTotalDiferidoQ: totalQ,
        diferimientos: out,
      };
    },
  }),

  // ===========================================================================
  // F-038.4: Pagos PENDIENTES vs DIFERIDOS (vista consolidada cross-período)
  // ===========================================================================

  getPagosPendientes: tool({
    description:
      'Empleados con planilla APROBADA pero pago aún no registrado (fricción de caja TEMPORAL — ' +
      'el dueño va a pagar pronto, NO es deuda formal). Lista cada empleado con departamento, ' +
      'monto neto, período, días desde aprobación y nivel de alerta ' +
      '(normal <5d · amarilla 5-9d · roja 10+d). ' +
      'NO incluye DIFERIDOS (esos son decisión formal de no pagar y ya generaron deuda formal — ' +
      'consultá esas vía getKPIsDeudas categoría empleados). ' +
      'USAR cuando el usuario pregunte "¿quiénes me faltan de pagar?", "¿qué tengo pendiente?", ' +
      '"¿hay planillas atrasadas?".',
    parameters: z.object({}),
    execute: async () => {
      const pendientes = await getPagosPendientes();
      return {
        total: pendientes.length,
        montoTotalQ: Math.round(pendientes.reduce((s, p) => s + p.netoAPagar, 0)),
        empleados: pendientes.map(p => ({
          nombre: p.empleadoNombre,
          departamento: p.departamento,
          netoAPagarQ: Math.round(p.netoAPagar),
          periodo: p.periodoNombre,
          diasPendiente: p.diasPendiente,
          alerta: p.alerta,
        })),
      };
    },
  }),

  getKPIsPagosPendientes: tool({
    description:
      'Resumen consolidado de pagos pendientes a empleados: total esperando, monto total Q, ' +
      'cantidad de alertas amarillas (5-9 días) y rojas (10+ días), promedio de días pendiente, ' +
      'y breakdown por período. ' +
      'USAR para "¿cuánto debo en quincenas no pagadas?", "¿cuántos empleados están esperando?", ' +
      '"¿tengo alertas críticas en planilla?".',
    parameters: z.object({}),
    execute: async () => await getKPIsPagosPendientes(),
  }),

  getPlanillaPorCentroCosto: tool({
    description:
      'F-042: distribución de la planilla MENSUAL agrupada por Centro de Costo (Polígrafo, ' +
      'Socioeconómico, TalentTrack, Ventas, Administración, etc.). Por cada CC devuelve cantidad ' +
      'de empleados activos, salarios base, prestaciones (IGSS+Bono14+Aguinaldo+Vac+Indem), ' +
      'costo total mensual con prestaciones, costo total anual proyectado (*12) y porcentaje ' +
      'de prestaciones sobre salarios. Ordenado por costoTotalMensual DESC. ' +
      'CRÍTICO para CFO: permite calcular margen real por línea de negocio ' +
      '(facturación CC / planilla CC). ' +
      'USAR cuando el usuario pregunte: "¿cuánto cuesta la planilla de Polígrafo/Socioeconómico/etc.?", ' +
      '"¿qué centro tiene más costo de planilla?", "¿cómo se reparte la planilla por línea?", ' +
      '"¿cuál es el costo anual de planilla de X?".',
    parameters: z.object({}),
    execute: async () => await getPlanillaPorCentroCosto(),
  }),

  getResumenSalariosPendientesConsolidado: tool({
    description:
      'F-042: resumen CONSOLIDADO de salarios pendientes diferenciando dos buckets distintos: ' +
      '(a) PENDIENTES = planilla aprobada sin pago registrado todavía (fricción TEMPORAL de caja — ' +
      'el dueño todavía piensa pagar, no es deuda formal); ' +
      '(b) DIFERIDOS = decisión formal de no pagar esa quincena, ya generaron deuda en /deudas con ' +
      'Tipo_Documento="Salario Pendiente". Cada bucket trae cantidad, monto total y lista de ' +
      'empleados (con departamento + centro de costo). También expone totalConsolidado = pendientes + diferidos. ' +
      'USAR cuando el usuario pregunte: "¿cuántos salarios pendientes tengo?", "¿qué planillas debo?", ' +
      '"¿cuál es mi exposición total con empleados?", "salarios sin pagar". ' +
      'RESPONDER SIEMPRE diferenciando los dos buckets — son cosas distintas operacionalmente.',
    parameters: z.object({}),
    execute: async () => await getResumenSalariosPendientesConsolidado(),
  }),

  getHistorialEdicionesFactura: tool({
    description:
      'F-044: log de ediciones no-contables de una factura específica (número, fecha emisión, observaciones). ' +
      'Devuelve lista de entradas con timestamp, email del editor y los cambios concretos ("campo: antes → después"). ' +
      'NO incluye anulaciones ni cobros — solo ediciones del módulo F-044. ' +
      'USAR cuando el usuario pregunte: "¿quién editó la factura X?", "¿cuándo se cambió el número?", ' +
      '"¿cuál era el número original?", "¿qué cambios tiene esta factura?". ' +
      'Requiere el record ID de Airtable (rec...).',
    parameters: z.object({
      facturaId: z.string().describe('Record ID de la factura en Airtable (rec...).'),
    }),
    execute: async (input) => {
      const entradas = await getHistorialEdicionesFactura(input.facturaId);
      return {
        facturaId: input.facturaId,
        cantidad: entradas.length,
        entradas,
      };
    },
  }),

  getNotasCreditoFactura: tool({
    description:
      'F-045: lista las notas de crédito vinculadas a una factura específica, con estado, motivo, monto y fechas. ' +
      'NCs activas reducen el saldo cobrable de la factura. ' +
      'USAR cuando el usuario pregunte: "¿qué NCs tiene la factura X?", "¿le emití alguna NC a esta factura?", ' +
      '"¿cuál es el saldo después de NCs?". Requiere el record ID de la factura.',
    parameters: z.object({
      facturaId: z.string().describe('Record ID de la factura (rec...).'),
    }),
    execute: async (input) => {
      const todas = await getNotasCredito();
      const ncs = todas.filter(n => n.facturaId === input.facturaId);
      return {
        facturaId: input.facturaId,
        cantidad: ncs.length,
        notas: ncs.map(n => ({
          numeroNC: n.numeroNC,
          fechaEmision: n.fechaEmision,
          monto: n.monto,
          motivo: n.motivo,
          estado: n.estado,
          emitidaPor: n.emitidaPor,
          aprobadaPor: n.aprobadaPor,
        })),
      };
    },
  }),

  getKPIsNotasCredito: tool({
    description:
      'F-045: KPIs anuales de notas de crédito — total activas del año + monto, pendientes de aprobación + monto, ' +
      'anuladas del año + monto, agrupación por motivo y por cliente (top 10). ' +
      'CRÍTICO para hablar de "facturado neto" = facturado bruto - montoActivasAnio. ' +
      'USAR cuando el usuario pregunte: "¿cuántas NCs emití este año?", "¿cuánto suman las NCs?", ' +
      '"¿cuál es mi facturado neto?", "¿por qué motivo emito más NCs?", "¿qué cliente tiene más NCs?".',
    parameters: z.object({}),
    execute: async () => await getKPIsNotasCredito(),
  }),

  getNotasCreditoPendientesAprobacion: tool({
    description:
      'F-045: NCs en estado "Pendiente Aprobación" (todas las > Q5,000 que esperan aprobación de admin). ' +
      'Solo admin puede aprobarlas — el frontend ya bloquea para otros roles. ' +
      'USAR cuando admin pregunte "¿qué NCs tengo pendientes de aprobar?", "¿hay NCs esperando mi visto bueno?".',
    parameters: z.object({}),
    execute: async () => {
      const ncs = await getNotasCreditoPendientesAprobacion();
      return {
        cantidad: ncs.length,
        montoTotal: ncs.reduce((s, n) => s + n.monto, 0),
        notas: ncs.map(n => ({
          numeroNC: n.numeroNC,
          fechaEmision: n.fechaEmision,
          cliente: n.clienteNombre,
          factura: n.facturaNumero,
          monto: n.monto,
          motivo: n.motivo,
          emitidaPor: n.emitidaPor,
        })),
      };
    },
  }),
} as const;

export type AiToolName = keyof typeof aiTools;
