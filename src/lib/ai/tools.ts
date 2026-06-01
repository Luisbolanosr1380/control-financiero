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
import { getTopDeudores } from '@/lib/db/kpis';
import { getAnalisisClientes } from '@/lib/db/clientes-analisis';
import { getAnaliticaIngresos, getFacturadoPorRango, type FiltroNaturaleza } from '@/lib/db/analitica';
import { getProyeccionMesActual } from '@/lib/db/proyecciones';
import { getKPIsDeudas, getDeudas, getAcreedores, clasificarPasivo } from '@/lib/db/deudas';
import { getPagosPorDeuda, getPagosPorAcreedor, getPagosRecientes } from '@/lib/db/pagos-deudas';
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
} as const;

export type AiToolName = keyof typeof aiTools;
