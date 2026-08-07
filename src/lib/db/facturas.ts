import { airtable, USE_MOCK, TABLES } from './airtable';
import { obtenerFechaHoyGuatemala } from "../utils/fechas";
import { formatInTimeZone } from 'date-fns-tz';
import { consolidateRecords, F } from './mappers';
import { dataSource, writeSource } from '../config/data-source';
import { sbFacturasRecords } from '../supabase/records';
import { supabase } from '../supabase/client';
import { nuevoIdEscritura, uuidRequerido, uuidOpcional, actualizarPorAppId } from '../supabase/writes';
import { invalidarBridge } from '../supabase/id-bridge';
import { INVOICES as MOCK_INVOICES } from '../mock-data';
import type { Invoice, InvoiceEstadoBruto } from '../types';
import type { FieldSet } from 'airtable';

/* ===== Rama Supabase (MIGRACIÓN CAPA 2 · Fase 1) =====
 * sbFacturasRecords() devuelve pseudo-records con los mismos nombres de
 * campo que Airtable, ya ordenados por FECHA_EMISION desc. Los filtros que
 * en Airtable van por filterByFormula acá se aplican en JS con la misma
 * semántica (los volúmenes son chicos: ~1100 líneas).
 */

type RecordLike = { id: string; fields: Record<string, unknown> };

/** Equivalente JS de filtroToFormula() — evalúa sobre el record CRUDO. */
function pasaFiltroRaw(filtro: FiltroTabFactura | undefined, f: Record<string, unknown>): boolean {
  const e = String(f[F.ESTADO] ?? '').toUpperCase().trim();
  const v = String(f[F.ESTATUS_COBRANZA] ?? '').toUpperCase().trim();
  switch (filtro) {
    case 'cartera_total': return e === 'EMITIDA' || e === 'PENDIENTE' || e === 'COBRADO PARCIAL';
    case 'por_cobrar':    return e === 'EMITIDA' || e === 'COBRADO PARCIAL';
    case 'vencidas':      return (e === 'EMITIDA' || e === 'COBRADO PARCIAL') && v === 'VENCIDA';
    case 'pendientes':    return e === 'PENDIENTE';
    case 'parciales':     return e === 'COBRADO PARCIAL';
    case 'cobradas':      return e === 'COBRADO' || e === 'COBRADA';
    case 'anuladas':      return e === 'ANULADO' || e === 'ANULADA';
    case 'refacturadas':  return e === 'REFACTURADO' || e === 'REFACTURADA';
    case 'todas':
    default:              return true;
  }
}

export async function getFacturas(filters?: {
  status?: Invoice['status'];
  custId?: string;
  line?: string;
}): Promise<Invoice[]> {
  if ((USE_MOCK || !airtable) && dataSource('facturas_clientes') !== 'supabase') {
    let result = [...MOCK_INVOICES];
    if (filters?.status) result = result.filter(i => i.status === filters.status);
    if (filters?.custId) result = result.filter(i => i.custId === filters.custId);
    if (filters?.line)   result = result.filter(i => i.line === filters.line);
    return result;
  }

  try {
    // F-034: sin maxRecords. `.all()` pagina hasta agotar (eachPage interno).
    // Antes el cap de 2000 cortaba líneas: 888 facturas consolidadas pueden
    // tener > 2000 líneas (multi-línea), bajando count visible a ~757.
    const records: RecordLike[] = dataSource('facturas_clientes') === 'supabase'
      ? await sbFacturasRecords()
      : (await airtable!(TABLES.FACTURAS)
          .select({ sort: [{ field: 'FECHA_EMISION', direction: 'desc' }] })
          .all()).map(r => ({ id: r.id, fields: r.fields as Record<string, unknown> }));

    let invoices = consolidateRecords(records.map(r => ({ id: r.id, fields: r.fields as FieldSet })));

    if (filters?.status) invoices = invoices.filter(i => i.status === filters.status);
    if (filters?.custId) invoices = invoices.filter(i => i.custId === filters.custId);
    if (filters?.line)   invoices = invoices.filter(i => i.lineas.some(l => l.line === filters.line));

    return invoices;
  } catch (err) {
    console.error('Error fetching facturas:', err);
    return MOCK_INVOICES;
  }
}

export async function getFactura(id: string): Promise<Invoice | null> {
  const facturas = await getFacturas();
  return facturas.find(f => f.id === id) ?? null;
}

/* ===== F-033: dataset liviano para agregados en headers ===== */

/**
 * Versión mínima de Invoice: solo lo necesario para clasificar (tab + filtros)
 * y para sumas. Se usa para que los headers paginados muestren el TOTAL real
 * (cantidad + suma) bajo filtros, independiente de cuántos rows estén
 * cargados visualmente.
 */
export interface InvoiceLiviano {
  id: string;
  noFactura: string;
  custId: string;
  total: number;
  estadoBruto: InvoiceEstadoBruto;
  vencida: boolean;
  numLineas: number;   // F-034.2: líneas crudas que se consolidaron en esta factura
  /** F-044: si fue editada, ISO datetime del último cambio (para mostrar ✏️ en lista). */
  fechaUltimaEdicion?: string;
  /** F-044: email del último editor — usado en el tooltip del ✏️. */
  editadoPor?: string;
  /**
   * F-BF-002d: desglose de TOTAL por CENTRO_COSTO. Una factura multi-línea
   * puede mezclar centros (poco frecuente, pero ocurre). Acá guardamos
   * cuánto va a cada uno para poder filtrar por línea de negocio sin
   * sobre-atribuir el TOTAL completo a un solo CC. Si una línea no tiene
   * CC, su monto se agrupa bajo `''`.
   *
   * Sin filtro de líneas, los callers usan `total` como antes.
   */
  montoPorCC: Record<string, number>;
}

const norm = (e: unknown) => String(e ?? '').toUpperCase().trim();
function brutoFromEstado(estado: unknown): InvoiceEstadoBruto {
  const s = norm(estado);
  if (s === 'COBRADO PARCIAL')                    return 'cobrado_parcial';
  if (s === 'COBRADO' || s === 'COBRADA')         return 'cobrado';
  if (s === 'ANULADO' || s === 'ANULADA')         return 'anulado';
  if (s === 'REFACTURADO' || s === 'REFACTURADA') return 'refacturado';
  if (s === 'PENDIENTE')                          return 'pendiente';
  if (s === 'EMITIDA' || s === 'EMITIDO')         return 'emitida';
  return 'otro';
}

/**
 * Trae TODAS las facturas con solo los campos mínimos para clasificar y sumar.
 * Consolida por NO.FACTURA (anuladas y refacturadas se mantienen como records
 * separados, mismo criterio que consolidateRecords). Pensada para los headers
 * agregados de F-033 — ~890 records → ~300-500ms.
 */
export async function getFacturasLiviano(args: { mes?: string; desde?: string; hasta?: string } = {}): Promise<InvoiceLiviano[]> {
  // Mock: filtra en JS según el set de args provisto.
  if ((USE_MOCK || !airtable) && dataSource('facturas_clientes') !== 'supabase') {
    return MOCK_INVOICES
      .filter(i => !args.mes   || (i.fechaEmision ?? '').slice(0, 7) === args.mes)
      .filter(i => !args.desde || (i.fechaEmision ?? '') >= args.desde)
      .filter(i => !args.hasta || (i.fechaEmision ?? '') <= args.hasta)
      .map(i => {
        // F-BF-002d: el mock no tiene CC reales — atribuimos todo al
        // bucket vacío así los filtros por CC devuelven 0 en mock,
        // coherente con "no hay datos reales".
        const montoPorCC: Record<string, number> = { '': i.total };
        return {
          id: i.id, noFactura: i.noFactura, custId: i.custId, total: i.total,
          estadoBruto: i.estadoBruto, vencida: i.vencida,
          numLineas: i.lineas?.length ?? 1,
          montoPorCC,
        };
      });
  }
  try {
    // F-034: sin maxRecords — `.all()` agota todas las páginas.
    // F-044 fail-soft: pedimos también los campos de auditoría para mostrar
    // el ✏️ en la lista. Si los campos aún no existen en Airtable, la query
    // falla con INVALID_FIELD_NAME; ahí caemos al set base y seguimos.
    // F-BF-002a/c: filtro server-side por mes (YYYY-MM) o por rango
    // [desde, hasta] sobre FECHA_EMISION. Si vienen ambos, se aplica AND.
    const FIELDS_BASE = [F.NO_FACTURA, F.TOTAL, F.ESTADO, F.ESTATUS_COBRANZA, F.CLIENTE, F.FECHA_EMISION, F.CENTRO_COSTO];
    const FIELDS_CON_AUDIT = [...FIELDS_BASE, F.EDITADO_POR, F.FECHA_ULTIMA_EDIT];
    const partes: string[] = [];
    if (args.mes) {
      partes.push(`DATETIME_FORMAT({FECHA_EMISION}, 'YYYY-MM') = "${args.mes.replace(/"/g, '')}"`);
    }
    if (args.desde) {
      partes.push(`IS_AFTER({FECHA_EMISION}, DATEADD(DATETIME_PARSE("${args.desde.replace(/"/g, '')}"), -1, 'days'))`);
    }
    if (args.hasta) {
      partes.push(`IS_BEFORE({FECHA_EMISION}, DATEADD(DATETIME_PARSE("${args.hasta.replace(/"/g, '')}"), 1, 'days'))`);
    }
    const filterByFormula = partes.length === 0 ? undefined
      : partes.length === 1 ? partes[0]
      : `AND(${partes.join(',')})`;
    let records: ReadonlyArray<{ id: string; fields: FieldSet | Record<string, unknown> }>;
    if (dataSource('facturas_clientes') === 'supabase') {
      // Mismo filtro que la fórmula: mes exacto o rango [desde, hasta] inclusive.
      // La ruta Airtable de liviano NO ordena → orden por record id (ASCII).
      records = (await sbFacturasRecords())
        .filter(r => {
          const fecha = String(r.fields[F.FECHA_EMISION] ?? '').slice(0, 10);
          if (args.mes && fecha.slice(0, 7) !== args.mes) return false;
          if (args.desde && !(fecha >= args.desde)) return false;
          if (args.hasta && !(fecha <= args.hasta)) return false;
          return true;
        })
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    } else {
      try {
        records = await airtable!(TABLES.FACTURAS).select({ fields: FIELDS_CON_AUDIT, ...(filterByFormula ? { filterByFormula } : {}) }).all();
      } catch {
        records = await airtable!(TABLES.FACTURAS).select({ fields: FIELDS_BASE, ...(filterByFormula ? { filterByFormula } : {}) }).all();
      }
    }

    type Row = { id: string; fields: Record<string, unknown> };
    // Bucket key igual a consolidateRecords: anuladas/refacturadas como rows individuales.
    const PRIO: Record<InvoiceEstadoBruto, number> = {
      cobrado_parcial: 6, pendiente: 5, emitida: 4, cobrado: 3, anulado: 1, refacturado: 0, otro: 0,
    };
    const buckets = new Map<string, { records: Row[]; brutos: InvoiceEstadoBruto[] }>();
    for (const r of records) {
      const row: Row = { id: r.id, fields: r.fields as Record<string, unknown> };
      const bruto = brutoFromEstado(row.fields[F.ESTADO]);
      const nf = String(row.fields[F.NO_FACTURA] ?? row.id);
      const key = bruto === 'anulado' || bruto === 'refacturado'
        ? `${nf}__${bruto}__${row.id}`
        : nf;
      const b = buckets.get(key) ?? { records: [] as Row[], brutos: [] };
      b.records.push(row);
      b.brutos.push(bruto);
      buckets.set(key, b);
    }

    const out: InvoiceLiviano[] = [];
    for (const [, bucket] of buckets) {
      const principal = bucket.records.reduce((a, b) =>
        Number(b.fields[F.TOTAL] ?? 0) > Number(a.fields[F.TOTAL] ?? 0) ? b : a,
      );
      const brutoDominante = bucket.brutos.reduce((acc, b) =>
        PRIO[b] > PRIO[acc] ? b : acc, bucket.brutos[0],
      );
      const vencida = (brutoDominante === 'emitida' || brutoDominante === 'pendiente')
        && bucket.records.some(r => norm(r.fields[F.ESTATUS_COBRANZA]) === 'VENCIDA');
      const total = bucket.records.reduce((s, r) => s + Number(r.fields[F.TOTAL] ?? 0), 0);

      // F-BF-002d: desglose de TOTAL por CENTRO_COSTO. CENTRO_COSTO es un
      // linked record → string[]. Tomamos el primer id de cada línea
      // (en este schema cada línea es 1 CC). Líneas sin CC → key vacío.
      const montoPorCC: Record<string, number> = {};
      for (const r of bucket.records) {
        const ccArr = r.fields[F.CENTRO_COSTO] as string[] | undefined;
        const ccId = Array.isArray(ccArr) && ccArr.length > 0 ? String(ccArr[0]) : '';
        const monto = Number(r.fields[F.TOTAL] ?? 0);
        montoPorCC[ccId] = (montoPorCC[ccId] ?? 0) + monto;
      }

      out.push({
        id: principal.id,
        noFactura: String(principal.fields[F.NO_FACTURA] ?? principal.id),
        custId: String((principal.fields[F.CLIENTE] as string[] | undefined)?.[0] ?? ''),
        total,
        estadoBruto: brutoDominante,
        vencida,
        numLineas: bucket.records.length,
        montoPorCC,
        editadoPor:         principal.fields[F.EDITADO_POR]       ? String(principal.fields[F.EDITADO_POR])       : undefined,
        fechaUltimaEdicion: principal.fields[F.FECHA_ULTIMA_EDIT] ? String(principal.fields[F.FECHA_ULTIMA_EDIT]) : undefined,
      });
    }
    return out;
  } catch (err) {
    console.error('Error fetching facturas liviano:', err);
    return [];
  }
}

/* ===== F-REPORTE-FACTURACION: dataset para el reporte de facturación emitida ===== */

/** Porción de una factura atribuible a un centro de costo (una fila cruda = una línea/CC). */
export interface LineaCCReporte {
  ccId: string;      // record-id del CENTRO_COSTO ('' si la línea no tiene)
  total: number;
  subtotal: number;
  iva: number;
}

/**
 * Factura consolidada con lo necesario para el reporte de facturación
 * emitida: fecha, montos con desglose subtotal/IVA y la porción por
 * centro de costo (para filtrar por línea sin sobre-atribuir el TOTAL,
 * mismo criterio que InvoiceLiviano.montoPorCC pero con subtotal/IVA).
 * Incluye TODOS los estados — el caller decide qué excluir (el reporte
 * excluye anuladas/refacturadas y las cuenta aparte).
 */
export interface FacturaReporte {
  id: string;
  noFactura: string;
  custId: string;
  /** YYYY-MM-DD del principal ('' si la factura no tiene fecha — existe 1 fila basura). */
  fecha: string;
  estadoBruto: InvoiceEstadoBruto;
  total: number;
  subtotal: number;
  iva: number;
  lineasCC: LineaCCReporte[];
  numLineas: number;
}

/**
 * Trae TODAS las facturas consolidadas (sin filtro de fecha — ~1100 líneas,
 * volumen chico) con los campos del reporte. Misma regla de bucket que
 * getFacturasLiviano/consolidateRecords: anuladas y refacturadas quedan
 * como rows individuales, no se consolidan con las activas.
 */
export async function getFacturasReporte(): Promise<FacturaReporte[]> {
  if ((USE_MOCK || !airtable) && dataSource('facturas_clientes') !== 'supabase') {
    return MOCK_INVOICES.map(i => ({
      id: i.id,
      noFactura: i.noFactura,
      custId: i.custId,
      fecha: (i.fechaEmision ?? '').slice(0, 10),
      estadoBruto: i.estadoBruto,
      total: i.total,
      subtotal: i.total,
      iva: 0,
      lineasCC: [{ ccId: '', total: i.total, subtotal: i.total, iva: 0 }],
      numLineas: i.lineas?.length ?? 1,
    }));
  }
  try {
    const FIELDS = [F.NO_FACTURA, F.FECHA_EMISION, F.CLIENTE, F.CENTRO_COSTO, F.SUBTOTAL, F.IVA, F.TOTAL, F.ESTADO];
    const records: ReadonlyArray<{ id: string; fields: FieldSet | Record<string, unknown> }> =
      dataSource('facturas_clientes') === 'supabase'
        ? await sbFacturasRecords()
        : await airtable!(TABLES.FACTURAS).select({ fields: FIELDS }).all();

    type Row = { id: string; fields: Record<string, unknown> };
    const buckets = new Map<string, { records: Row[]; brutos: InvoiceEstadoBruto[] }>();
    for (const r of records) {
      const row: Row = { id: r.id, fields: r.fields as Record<string, unknown> };
      const bruto = brutoFromEstado(row.fields[F.ESTADO]);
      const nf = String(row.fields[F.NO_FACTURA] ?? row.id);
      const key = bruto === 'anulado' || bruto === 'refacturado'
        ? `${nf}__${bruto}__${row.id}`
        : nf;
      const b = buckets.get(key) ?? { records: [] as Row[], brutos: [] };
      b.records.push(row);
      b.brutos.push(bruto);
      buckets.set(key, b);
    }

    const PRIO: Record<InvoiceEstadoBruto, number> = {
      cobrado_parcial: 6, pendiente: 5, emitida: 4, cobrado: 3, anulado: 1, refacturado: 0, otro: 0,
    };
    const out: FacturaReporte[] = [];
    for (const [, bucket] of buckets) {
      const principal = bucket.records.reduce((a, b) =>
        Number(b.fields[F.TOTAL] ?? 0) > Number(a.fields[F.TOTAL] ?? 0) ? b : a,
      );
      const brutoDominante = bucket.brutos.reduce((acc, b) =>
        PRIO[b] > PRIO[acc] ? b : acc, bucket.brutos[0],
      );
      const lineasCC: LineaCCReporte[] = bucket.records.map(r => {
        const total = Number(r.fields[F.TOTAL] ?? 0);
        const iva = Number(r.fields[F.IVA] ?? 0);
        // SUBTOTAL en Airtable era fórmula (= TOTAL - IVA); si falta, se deriva.
        const subtotalRaw = Number(r.fields[F.SUBTOTAL] ?? NaN);
        const subtotal = Number.isFinite(subtotalRaw) ? subtotalRaw : total - iva;
        const ccArr = r.fields[F.CENTRO_COSTO] as string[] | undefined;
        return {
          ccId: Array.isArray(ccArr) && ccArr.length > 0 ? String(ccArr[0]) : '',
          total, subtotal, iva,
        };
      });
      out.push({
        id: principal.id,
        noFactura: String(principal.fields[F.NO_FACTURA] ?? principal.id),
        custId: String((principal.fields[F.CLIENTE] as string[] | undefined)?.[0] ?? ''),
        fecha: String(principal.fields[F.FECHA_EMISION] ?? '').slice(0, 10),
        estadoBruto: brutoDominante,
        total: lineasCC.reduce((s, l) => s + l.total, 0),
        subtotal: lineasCC.reduce((s, l) => s + l.subtotal, 0),
        iva: lineasCC.reduce((s, l) => s + l.iva, 0),
        lineasCC,
        numLineas: bucket.records.length,
      });
    }
    return out;
  } catch (err) {
    console.error('Error fetching facturas reporte:', err);
    return [];
  }
}

/* ===== F-BF-002b/c: Top clientes — agregación reutilizable =====
 * La lógica vive en src/lib/facturacion/top-clientes.ts (una sola
 * fuente de verdad para la card UI y para las Auros tools). Acá
 * dejamos un re-export con el shape histórico (`TopClienteMes`,
 * `totalMesQ`, `cantidadFacturas`) para no romper /facturacion.
 */

import { computeTopClientesRango } from '@/lib/facturacion/top-clientes';

export type TopClienteMes = import('@/lib/facturacion/top-clientes').TopClienteItem;

export function computeTopClientesDelMes(
  livianas: InvoiceLiviano[],
  clientes: { id: string; name: string; short?: string }[],
  topN = 5,
): { items: TopClienteMes[]; totalMesQ: number; cantidadFacturas: number } {
  const r = computeTopClientesRango(livianas, clientes, topN);
  return {
    items: r.items,
    totalMesQ: r.totalFacturadoRango,
    cantidadFacturas: r.numFacturasValidas,
  };
}

/* ===== Paginación (F-022 + F-034 filtros server-side por tab) ===== */

export interface GetFacturasPaginaResult {
  invoices: Invoice[];
  hayMas: boolean;
  ultimaFecha: string | null;   // FECHA_EMISION de la última invoice del batch (para next page)
}

// F-034: tabs del listado /facturacion mapeados a filterByFormula de Airtable.
// El filtro se aplica al server para que tabs chicos (Pendientes=5, Refacturadas=1)
// no dependan de la ventana de paginación FECHA_EMISION desc.
// TRIM(UPPER(...)) protege contra trailing spaces y mayúsculas inconsistentes
// en el singleSelect ESTADO de Airtable (se vieron 'PENDIENTE ' con espacio).
export type FiltroTabFactura =
  | 'todas'
  | 'cartera_total'
  | 'por_cobrar'
  | 'vencidas'
  | 'pendientes'
  | 'parciales'
  | 'cobradas'
  | 'anuladas'
  | 'refacturadas';

function filtroToFormula(filtro: FiltroTabFactura | undefined): string {
  const E = `TRIM(UPPER({${F.ESTADO}}))`;
  const V = `TRIM(UPPER({${F.ESTATUS_COBRANZA}}))`;
  // F-035:
  //   - cartera_total = EMITIDA + PENDIENTE + COBRADO PARCIAL (todo lo no liquidado)
  //   - por_cobrar    = EMITIDA + COBRADO PARCIAL (cobranza activa, sin pendientes internos)
  //   - vencidas      = subset de por_cobrar con Estatus_Cobranza = VENCIDA
  //   - parciales     = solo COBRADO PARCIAL
  switch (filtro) {
    case 'cartera_total': return `OR(${E}='EMITIDA',${E}='PENDIENTE',${E}='COBRADO PARCIAL')`;
    case 'por_cobrar':    return `OR(${E}='EMITIDA',${E}='COBRADO PARCIAL')`;
    case 'vencidas':      return `AND(OR(${E}='EMITIDA',${E}='COBRADO PARCIAL'),${V}='VENCIDA')`;
    case 'pendientes':    return `${E}='PENDIENTE'`;
    case 'parciales':     return `${E}='COBRADO PARCIAL'`;
    case 'cobradas':      return `OR(${E}='COBRADO',${E}='COBRADA')`;
    case 'anuladas':      return `OR(${E}='ANULADO',${E}='ANULADA')`;
    case 'refacturadas':  return `OR(${E}='REFACTURADO',${E}='REFACTURADA')`;
    case 'todas':
    default:              return '';
  }
}

// F-034: predicado equivalente al filtroToFormula para mock data y para
// reusar en el client cuando filtra livianas localmente.
export function predicadoFiltro(filtro: FiltroTabFactura | undefined) {
  const enCobranzaActiva = (e: InvoiceEstadoBruto) => e === 'emitida' || e === 'cobrado_parcial';
  return (i: { estadoBruto: InvoiceEstadoBruto; vencida: boolean }): boolean => {
    switch (filtro) {
      case 'cartera_total': return enCobranzaActiva(i.estadoBruto) || i.estadoBruto === 'pendiente';
      case 'por_cobrar':    return enCobranzaActiva(i.estadoBruto);
      case 'vencidas':      return enCobranzaActiva(i.estadoBruto) && i.vencida;
      case 'pendientes':    return i.estadoBruto === 'pendiente';
      case 'parciales':     return i.estadoBruto === 'cobrado_parcial';
      case 'cobradas':      return i.estadoBruto === 'cobrado';
      case 'anuladas':      return i.estadoBruto === 'anulado';
      case 'refacturadas':  return i.estadoBruto === 'refacturado';
      case 'todas':
      default:              return true;
    }
  };
}

/**
 * Trae las últimas N facturas consolidadas, ordenadas por FECHA_EMISION desc.
 * F-034: acepta `filtro` opcional para filtrar por tab al nivel de Airtable.
 * Una factura puede ser multi-línea: sobre-fetchea records para garantizar `limit` facturas.
 */
export async function getFacturasPagina(args: { limit?: number; before?: string; filtro?: FiltroTabFactura; mes?: string } = {}): Promise<GetFacturasPaginaResult> {
  const limit = args.limit ?? 50;
  const mes = args.mes; // 'YYYY-MM' opcional (F-BF-002a)

  if (dataSource('facturas_clientes') === 'supabase') {
    try {
      // Los filtros de la fórmula Airtable se replican en JS sobre el record
      // crudo, ANTES de consolidar (misma semántica que el server-side filter).
      const raw = (await sbFacturasRecords()).filter(r => {
        if (!pasaFiltroRaw(args.filtro, r.fields)) return false;
        const fecha = String(r.fields[F.FECHA_EMISION] ?? '').slice(0, 10);
        if (mes && fecha.slice(0, 7) !== mes) return false;
        if (args.before && !(fecha < args.before)) return false;
        return true;
      });
      const invoices = consolidateRecords(raw.map(r => ({ id: r.id, fields: r.fields as FieldSet })));
      const page = invoices.slice(0, limit);
      return {
        invoices: page,
        hayMas: invoices.length > limit,
        ultimaFecha: page[page.length - 1]?.fechaEmision ?? null,
      };
    } catch (err) {
      console.error('Error fetching facturas pagina (supabase):', err);
      return { invoices: [], hayMas: false, ultimaFecha: null };
    }
  }

  if (USE_MOCK || !airtable) {
    const mock = [...MOCK_INVOICES]
      .filter(predicadoFiltro(args.filtro))
      .filter(i => !mes || (i.fechaEmision ?? '').slice(0, 7) === mes)
      .sort((a, b) => (b.fechaEmision ?? '').localeCompare(a.fechaEmision ?? ''));
    const filtered = args.before ? mock.filter(i => (i.fechaEmision ?? '') < args.before!) : mock;
    const page = filtered.slice(0, limit);
    return {
      invoices: page,
      hayMas: filtered.length > limit,
      ultimaFecha: page[page.length - 1]?.fechaEmision ?? null,
    };
  }

  try {
    // Sin maxRecords cuando hay filtro estrecho (pendientes/refacturadas): traen pocos
    // records y el SDK pagina hasta agotar. Para 'todas'/'cobradas' mantenemos un cap
    // generoso por seguridad (no romper la primera carga si el dataset crece sin tope).
    const filtroFormula = filtroToFormula(args.filtro);
    const conFiltroEstrecho = !!filtroFormula || !!mes;
    const overFetch = conFiltroEstrecho ? undefined : Math.min(5000, limit * 4 + 100);
    const select: Parameters<ReturnType<typeof airtable>['select']>[0] = {
      sort: [{ field: 'FECHA_EMISION', direction: 'desc' }],
    };
    if (overFetch) select.maxRecords = overFetch;
    const partes: string[] = [];
    if (filtroFormula) partes.push(filtroFormula);
    if (mes) {
      // F-BF-002a: comparación YYYY-MM directa sobre FECHA_EMISION.
      // DATETIME_FORMAT respeta el valor del campo Date sin convertir TZ.
      const mesEsc = mes.replace(/"/g, '');
      partes.push(`DATETIME_FORMAT({FECHA_EMISION}, 'YYYY-MM') = "${mesEsc}"`);
    }
    if (args.before) {
      const beforeEsc = args.before.replace(/"/g, '');
      partes.push(`IS_BEFORE({FECHA_EMISION}, DATETIME_PARSE("${beforeEsc}"))`);
    }
    if (partes.length === 1) select.filterByFormula = partes[0];
    else if (partes.length > 1) select.filterByFormula = `AND(${partes.join(',')})`;

    const records = await airtable(TABLES.FACTURAS).select(select).all();
    const invoices = consolidateRecords(records.map(r => ({ id: r.id, fields: r.fields })));
    // Ya vienen sorted desc por la query
    const page = invoices.slice(0, limit);
    const hayMas = invoices.length > limit || (overFetch !== undefined && records.length === overFetch);
    const ultimaFecha = page[page.length - 1]?.fechaEmision ?? null;
    return { invoices: page, hayMas, ultimaFecha };
  } catch (err) {
    console.error('Error fetching facturas pagina:', err);
    return { invoices: [], hayMas: false, ultimaFecha: null };
  }
}

/**
 * Cuenta el total de facturas que aparecerían en el listado consolidado (para "Mostrando N de X").
 * Trae solo los campos NO.FACTURA y ESTADO (más liviano que el fetch completo).
 */
export async function getFacturasCountTotal(): Promise<number> {
  const src = dataSource('facturas_clientes');
  if (src !== 'supabase' && (USE_MOCK || !airtable)) return MOCK_INVOICES.length;
  try {
    // F-034: sin maxRecords (agota todas las páginas).
    const records: ReadonlyArray<{ id: string; fields: FieldSet | Record<string, unknown> }> =
      src === 'supabase'
        ? await sbFacturasRecords()
        : await airtable!(TABLES.FACTURAS)
            .select({ fields: [F.NO_FACTURA, F.ESTADO] })
            .all();
    const noAnulNoFactura = new Set<string>();
    let anuladasYRef = 0;   // cada una cuenta individual (no se consolidan)
    for (const r of records) {
      const est = String(r.fields[F.ESTADO] ?? '').toUpperCase().trim();
      if (est === 'ANULADO' || est === 'ANULADA' || est === 'REFACTURADO' || est === 'REFACTURADA') {
        anuladasYRef += 1;
      } else {
        noAnulNoFactura.add(String(r.fields[F.NO_FACTURA] ?? r.id));
      }
    }
    return noAnulNoFactura.size + anuladasYRef;
  } catch (err) {
    console.error('Error contando facturas:', err);
    return 0;
  }
}

export interface NewFacturaLine {
  centroCostoId: string;
  total: number;   // monto CON IVA (como en la factura SAT)
  iva: number;     // IVA extraído del total
}

export interface NewFacturaInput {
  noFactura: string;
  custId: string;
  fechaEmision: string;
  lineas: NewFacturaLine[];
}

export interface CreateFacturaResult {
  noFactura: string;
  recordsCreados: number;
  recordIdPrincipal: string;   // record de mayor monto (para adjuntar el PDF)
}

export async function createFactura(input: NewFacturaInput): Promise<CreateFacturaResult> {
  if ((USE_MOCK || !airtable) && writeSource('facturacion') !== 'supabase') {
    throw new Error('createFactura: Airtable no está configurado.');
  }
  if (!input.noFactura?.trim()) throw new Error('NO.FACTURA es requerido.');
  if (!input.custId)            throw new Error('Cliente es requerido.');
  if (!input.lineas?.length)    throw new Error('Se requiere al menos una línea.');

  // ═══ FASE 3 — EMISIÓN EN SUPABASE ═══
  // Todas las líneas en UN insert masivo (una sentencia = atómico).
  if (writeSource('facturacion') === 'supabase') {
    const sb = supabase();
    if (!sb) throw new Error('Supabase no está configurado.');
    const nf = input.noFactura.trim();
    const { data: existentes, error: errDup } = await sb.from('facturas_clientes')
      .select('id').eq('no_factura', nf).limit(1);
    if (errDup) throw new Error(errDup.message);
    if (existentes && existentes.length > 0) {
      throw new Error(`La factura ${nf} ya existe. No se creó para evitar un duplicado.`);
    }
    const clienteUuid = await uuidRequerido('clientes', input.custId, 'createFactura (cliente)');
    const ccUuid = new Map<string, string>();
    for (const l of input.lineas) {
      if (!ccUuid.has(l.centroCostoId)) {
        ccUuid.set(l.centroCostoId, await uuidRequerido('centros_costo', l.centroCostoId, 'createFactura (CC)'));
      }
    }
    const round2sb = (x: number) => Math.round(x * 100) / 100;
    const filas = input.lineas.map(l => ({
      airtable_id: nuevoIdEscritura(),
      no_factura: nf,
      cliente_id: clienteUuid,
      centro_costo_id: ccUuid.get(l.centroCostoId),
      fecha_emision: input.fechaEmision,
      total: l.total,
      iva: l.iva,
      // SUBTOTAL en Airtable era fórmula (= TOTAL - IVA): se materializa acá.
      subtotal: round2sb(l.total - l.iva),
      estado: 'EMITIDA',
    }));
    const { data: creadas, error } = await sb.from('facturas_clientes')
      .insert(filas).select('airtable_id, total');
    if (error) throw new Error(`createFactura (supabase): ${error.message}`);
    invalidarBridge('facturas_clientes');
    let maxIdx = 0;
    for (let i = 1; i < input.lineas.length; i++) {
      if (input.lineas[i].total > input.lineas[maxIdx].total) maxIdx = i;
    }
    return {
      noFactura: nf,
      recordsCreados: creadas?.length ?? filas.length,
      recordIdPrincipal: filas[maxIdx]?.airtable_id ?? filas[0].airtable_id,
    };
  }

  try {
    // Evitar duplicado silencioso: ¿ya existe ese NO.FACTURA?
    const noFacturaEsc = input.noFactura.replace(/"/g, '\\"');
    const existentes = await airtable!(TABLES.FACTURAS)
      .select({ filterByFormula: `{${F.NO_FACTURA}} = "${noFacturaEsc}"`, maxRecords: 1 })
      .all();
    if (existentes.length > 0) {
      throw new Error(`La factura ${input.noFactura} ya existe en Airtable. No se creó para evitar un duplicado.`);
    }

    const payload = input.lineas.map(l => ({
      fields: {
        [F.NO_FACTURA]:    input.noFactura,
        [F.CLIENTE]:       [input.custId],
        [F.CENTRO_COSTO]:  [l.centroCostoId],
        [F.FECHA_EMISION]: input.fechaEmision,
        [F.TOTAL]:         l.total,   // monto con IVA. SUBTOTAL es fórmula (= TOTAL - IVA): no se escribe
        [F.IVA]:           l.iva,
        [F.ESTADO]:        'EMITIDA',
      },
    }));

    // Airtable crea máximo 10 records por llamada. El orden se preserva.
    const createdIds: string[] = [];
    for (let i = 0; i < payload.length; i += 10) {
      const lote = payload.slice(i, i + 10);
      const res = await airtable!(TABLES.FACTURAS).create(lote);
      createdIds.push(...res.map(r => r.id));
    }

    // Principal = línea de mayor total (mismo orden que input.lineas)
    let maxIdx = 0;
    for (let i = 1; i < input.lineas.length; i++) {
      if (input.lineas[i].total > input.lineas[maxIdx].total) maxIdx = i;
    }

    return {
      noFactura: input.noFactura,
      recordsCreados: createdIds.length,
      recordIdPrincipal: createdIds[maxIdx] ?? createdIds[0] ?? '',
    };
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : `Error creando factura: ${String(err)}`);
  }
}

export interface AnularFacturaResult {
  ok: boolean;
  noFactura: string;
  recordsActualizados: number;
  recordsTotal: number;
  fallidos?: string[];   // record ids que no se pudieron actualizar (anulación parcial)
  error?: string;
  // F-036: cuando se bloquea por cobros activos.
  bloqueadoPorCobros?: { numCobrosActivos: number; numRecordsActivos: number; montoTotalActivo: number };
}

/**
 * Anula TODAS las filas (líneas) de una factura por NO.FACTURA en una operación.
 *
 * F-032 parte C: acepta `motivoTipo` opcional.
 * - 'Refacturación' → ESTADO = 'REFACTURADO' (será sustituida por otra factura).
 * - 'Error en datos' o 'Cancelación del cliente' o cualquier otro → ESTADO = 'ANULADO'.
 *
 * Si hay motivo (texto libre o motivoTipo), se anexa a Observaciones: con la fecha.
 * Las anuladas y refacturadas quedan fuera de tabs activos via consolidateRecords.
 */
export type MotivoAnulacion = 'Error en datos' | 'Cancelación del cliente' | 'Refacturación';

export async function anularFactura(
  noFactura: string,
  motivo?: string,
  motivoTipo?: MotivoAnulacion,
): Promise<AnularFacturaResult> {
  if (!airtable && writeSource('facturacion') !== 'supabase') throw new Error('Airtable no está configurado.');
  const nf = (noFactura ?? '').trim();
  if (!nf) return { ok: false, noFactura: nf, recordsActualizados: 0, recordsTotal: 0, error: 'NO.FACTURA es requerido.' };

  // ═══ FASE 3 — ANULACIÓN EN SUPABASE ═══
  if (writeSource('facturacion') === 'supabase') {
    try {
      const todas = await sbFacturasRecords();
      const records = todas.filter(r => String(r.fields[F.NO_FACTURA] ?? '') === nf);
      if (records.length === 0) {
        return { ok: false, noFactura: nf, recordsActualizados: 0, recordsTotal: 0, error: `No se encontró la factura ${nf}.` };
      }
      const esRefacturacion = motivoTipo === 'Refacturación';
      if (!esRefacturacion) {
        const { contarCobrosActivosDeFactura } = await import('./cobros');
        const chk = await contarCobrosActivosDeFactura(nf);
        if (chk.numCobrosActivos > 0) {
          return {
            ok: false, noFactura: nf, recordsActualizados: 0, recordsTotal: records.length,
            error: `La factura ${nf} tiene ${chk.numCobrosActivos} cobro(s) activo(s) por Q${chk.montoTotalActivo.toFixed(2)}. Anulá los cobros primero, después podrás anular la factura.`,
            bloqueadoPorCobros: chk,
          };
        }
      }
      const estadoTarget = esRefacturacion ? 'REFACTURADO' : 'ANULADO';
      const verbo = esRefacturacion ? 'Refacturado' : 'Anulado';
      const fechaAnulacion = obtenerFechaHoyGuatemala();
      const etiqueta = motivoTipo
        ? motivo?.trim() ? `${motivoTipo} — ${motivo.trim()}` : motivoTipo
        : motivo?.trim() ?? '';
      const nota = etiqueta ? `[${verbo} ${fechaAnulacion}: ${etiqueta}]` : `[${verbo} ${fechaAnulacion}]`;

      const actualizados: string[] = [];
      const fallidos: string[] = [];
      for (const r of records) {
        try {
          const existing = String(r.fields[F.OBSERVACIONES] ?? '').trim();
          await actualizarPorAppId('facturas_clientes', r.id, {
            estado: estadoTarget,
            observaciones: existing ? `${existing}\n${nota}` : nota,
          });
          actualizados.push(r.id);
        } catch (err) {
          console.error('Error anulando línea (supabase):', err);
          fallidos.push(r.id);
        }
      }
      return {
        ok: fallidos.length === 0,
        noFactura: nf,
        recordsActualizados: actualizados.length,
        recordsTotal: records.length,
        fallidos: fallidos.length > 0 ? fallidos : undefined,
        error: fallidos.length > 0
          ? `Anulación parcial: ${actualizados.length}/${records.length} líneas. Revisá Supabase.`
          : undefined,
      };
    } catch (err) {
      return { ok: false, noFactura: nf, recordsActualizados: 0, recordsTotal: 0, error: err instanceof Error ? err.message : String(err) };
    }
  }

  try {
    const esc = nf.replace(/"/g, '\\"');
    const records = await airtable!(TABLES.FACTURAS)
      .select({ filterByFormula: `{${F.NO_FACTURA}} = "${esc}"`, maxRecords: 100 })
      .all();

    if (records.length === 0) {
      return { ok: false, noFactura: nf, recordsActualizados: 0, recordsTotal: 0, error: `No se encontró la factura ${nf}.` };
    }

    // F-036: bloquear si hay cobros activos. Refacturación NO bloquea — el flujo
    // de refacturar puede tener cobros que se transfieren a la factura nueva.
    const esRefacturacion = motivoTipo === 'Refacturación';
    if (!esRefacturacion) {
      const { contarCobrosActivosDeFactura } = await import('./cobros');
      const check = await contarCobrosActivosDeFactura(nf);
      if (check.numCobrosActivos > 0) {
        return {
          ok: false, noFactura: nf, recordsActualizados: 0, recordsTotal: records.length,
          error: `La factura ${nf} tiene ${check.numCobrosActivos} cobro(s) activo(s) por Q${check.montoTotalActivo.toFixed(2)}. Anulá los cobros primero, después podrás anular la factura.`,
          bloqueadoPorCobros: check,
        };
      }
    }

    const estadoTarget = esRefacturacion ? 'REFACTURADO' : 'ANULADO';
    const verbo = esRefacturacion ? 'Refacturado' : 'Anulado';

    const fechaAnulacion = obtenerFechaHoyGuatemala();
    // El motivoTipo se incluye explícito en la nota cuando se eligió uno;
    // un motivo libre adicional se agrega después del ":".
    const etiqueta = motivoTipo
      ? motivo?.trim()
        ? `${motivoTipo} — ${motivo.trim()}`
        : motivoTipo
      : motivo?.trim() ?? '';
    const nota = etiqueta
      ? `[${verbo} ${fechaAnulacion}: ${etiqueta}]`
      : `[${verbo} ${fechaAnulacion}]`;

    const payloads = records.map(r => {
      const existing = String(r.fields[F.OBSERVACIONES] ?? '').trim();
      const newObs = existing ? `${existing}\n${nota}` : nota;
      return {
        id: r.id,
        fields: {
          [F.ESTADO]: estadoTarget,
          [F.OBSERVACIONES]: newObs,
        },
      };
    });

    // Batch update: máx 10 records por llamada
    const actualizados: string[] = [];
    const fallidos: string[] = [];
    for (let i = 0; i < payloads.length; i += 10) {
      const lote = payloads.slice(i, i + 10);
      try {
        const res = await airtable!(TABLES.FACTURAS).update(lote);
        actualizados.push(...res.map(r => r.id));
      } catch (err) {
        console.error('Error en lote de anulación:', err);
        fallidos.push(...lote.map(p => p.id));
      }
    }

    return {
      ok: fallidos.length === 0,
      noFactura: nf,
      recordsActualizados: actualizados.length,
      recordsTotal: records.length,
      fallidos: fallidos.length > 0 ? fallidos : undefined,
      error: fallidos.length > 0
        ? `Anulación parcial: ${actualizados.length}/${records.length} líneas. Revisá en Airtable.`
        : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      noFactura: nf,
      recordsActualizados: 0,
      recordsTotal: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ============================================================
 * F-044 — Edición no-contable de facturas
 *
 * Decisión CFO: solo se editan NÚMERO, FECHA EMISIÓN y OBSERVACIONES. Para
 * cambiar monto/cliente/IVA hay que anular + refacturar (flujo separado).
 *
 * Multi-línea: una factura con N records (mismo NO.FACTURA) se actualiza en
 * batch — todos los records reciben los mismos cambios para mantener la
 * consolidación coherente.
 *
 * Audit fail-soft: los 3 campos nuevos (Editado_Por, Fecha_Ultima_Edicion,
 * Historial_Ediciones) van en una SEGUNDA llamada. Si Stark aún no los
 * agregó, el cambio funcional se aplica de todas formas y solo se pierde
 * el log — devolvemos un aviso al UI para que lo muestre.
 * ============================================================ */

export interface CambiosFacturaPermitidos {
  numeroFactura?: string;
  fechaEmision?: string;      // YYYY-MM-DD
  observaciones?: string;
}

export interface EditarFacturaResult {
  ok: boolean;
  facturaId: string;
  numeroAnterior?: string;
  numeroNuevo?: string;
  recordsActualizados: number;
  recordsTotal: number;
  auditoriaPersistida: boolean;   // false si los campos no existen en Airtable
  error?: string;
  duplicado?: {                   // si el NO.FACTURA nuevo ya existe en otra factura activa
    noFactura: string;
    facturaId: string;
    estadoBruto: InvoiceEstadoBruto;
  };
}

/** Compone una entrada de historial line-by-line: "[YYYY-MM-DD HH:mm] email: campo: 'antes' → 'después'". */
function formatearEntradaHistorial(usuarioEmail: string, cambios: Array<{ campo: string; antes: string; despues: string }>): string {
  const ts = formatInTimeZone(new Date(), 'America/Guatemala', "yyyy-MM-dd HH:mm");
  const cuerpo = cambios.map(c => `${c.campo}: '${c.antes}' → '${c.despues}'`).join('; ');
  return `[${ts}] ${usuarioEmail}: ${cuerpo}`;
}

/** Lee los records de una factura por su NO.FACTURA actual (excluye ANULADO/REFACTURADO). */
async function leerRecordsDeFactura(noFactura: string): Promise<Array<{ id: string; fields: Record<string, unknown> }>> {
  if (!airtable) throw new Error('Airtable no está configurado.');
  const esc = noFactura.replace(/"/g, '\\"');
  const records = await airtable(TABLES.FACTURAS)
    .select({ filterByFormula: `{${F.NO_FACTURA}} = "${esc}"`, maxRecords: 100 })
    .all();
  return records
    .map(r => ({ id: r.id, fields: r.fields as Record<string, unknown> }))
    .filter(r => {
      const e = String(r.fields[F.ESTADO] ?? '').toUpperCase().trim();
      return e !== 'ANULADO' && e !== 'ANULADA' && e !== 'REFACTURADO' && e !== 'REFACTURADA';
    });
}

export async function editarFacturaNoContable(
  facturaId: string,
  cambios: CambiosFacturaPermitidos,
  usuarioEmail: string,
): Promise<EditarFacturaResult> {
  if (!airtable) {
    return { ok: false, facturaId, recordsActualizados: 0, recordsTotal: 0, auditoriaPersistida: false, error: 'Airtable no está configurado.' };
  }

  // Whitelist estricta: cualquier campo no contemplado se ignora.
  const hayCambios = !!(cambios.numeroFactura ?? cambios.fechaEmision ?? cambios.observaciones);
  if (!hayCambios) {
    return { ok: false, facturaId, recordsActualizados: 0, recordsTotal: 0, auditoriaPersistida: false, error: 'No hay cambios para guardar.' };
  }

  // ═══ FASE 3 — EDICIÓN NO-CONTABLE EN SUPABASE ═══
  if (writeSource('facturacion') === 'supabase') {
    try {
      const todas = await sbFacturasRecords();
      const principal = todas.find(r => r.id === facturaId);
      if (!principal) {
        return { ok: false, facturaId, recordsActualizados: 0, recordsTotal: 0, auditoriaPersistida: false, error: 'Factura no encontrada.' };
      }
      const numeroAnterior = String(principal.fields[F.NO_FACTURA] ?? '').trim();
      const fechaAnterior = String(principal.fields[F.FECHA_EMISION] ?? '').slice(0, 10);
      const obsAnteriores = String(principal.fields[F.OBSERVACIONES] ?? '');
      const estadoP = String(principal.fields[F.ESTADO] ?? '').toUpperCase().trim();
      if (estadoP === 'ANULADO' || estadoP === 'ANULADA' || estadoP === 'REFACTURADO' || estadoP === 'REFACTURADA') {
        return { ok: false, facturaId, numeroAnterior, recordsActualizados: 0, recordsTotal: 0, auditoriaPersistida: false, error: `No se puede editar una factura ${estadoP.toLowerCase()}.` };
      }
      const esActiva = (r: { fields: Record<string, unknown> }) => {
        const e = String(r.fields[F.ESTADO] ?? '').toUpperCase().trim();
        return e !== 'ANULADO' && e !== 'ANULADA' && e !== 'REFACTURADO' && e !== 'REFACTURADA';
      };
      const records = todas.filter(r => String(r.fields[F.NO_FACTURA] ?? '').trim() === numeroAnterior && esActiva(r));
      if (records.length === 0) {
        return { ok: false, facturaId, numeroAnterior, recordsActualizados: 0, recordsTotal: 0, auditoriaPersistida: false, error: `No se encontraron líneas activas para la factura ${numeroAnterior}.` };
      }
      const numeroNuevo = cambios.numeroFactura?.trim();
      if (numeroNuevo && numeroNuevo !== numeroAnterior) {
        const colision = todas.find(r => String(r.fields[F.NO_FACTURA] ?? '').trim() === numeroNuevo && esActiva(r));
        if (colision) {
          return {
            ok: false, facturaId, numeroAnterior, numeroNuevo,
            recordsActualizados: 0, recordsTotal: records.length, auditoriaPersistida: false,
            error: `El número ${numeroNuevo} ya está en uso por otra factura activa. Solo podés reutilizarlo si la otra está anulada o refacturada.`,
            duplicado: { noFactura: numeroNuevo, facturaId: colision.id, estadoBruto: 'emitida' },
          };
        }
      }
      const patch: Record<string, unknown> = {};
      if (numeroNuevo && numeroNuevo !== numeroAnterior)                 patch.no_factura = numeroNuevo;
      if (cambios.fechaEmision && cambios.fechaEmision !== fechaAnterior) patch.fecha_emision = cambios.fechaEmision;
      if (cambios.observaciones !== undefined && cambios.observaciones !== obsAnteriores) patch.observaciones = cambios.observaciones;
      if (Object.keys(patch).length === 0) {
        return { ok: false, facturaId, numeroAnterior, recordsActualizados: 0, recordsTotal: records.length, auditoriaPersistida: false, error: 'Los valores enviados son idénticos a los actuales.' };
      }
      const actualizados: string[] = [];
      for (const r of records) {
        await actualizarPorAppId('facturas_clientes', r.id, patch);
        actualizados.push(r.id);
      }
      // Auditoría en el principal (columna historial_ediciones — Fase 3
      // cierra el gap de Fase 1).
      const cambiosLog: Array<{ campo: string; antes: string; despues: string }> = [];
      if (numeroNuevo && numeroNuevo !== numeroAnterior)                       cambiosLog.push({ campo: 'numeroFactura',  antes: numeroAnterior, despues: numeroNuevo });
      if (cambios.fechaEmision && cambios.fechaEmision !== fechaAnterior)      cambiosLog.push({ campo: 'fechaEmision',   antes: fechaAnterior,  despues: cambios.fechaEmision });
      if (cambios.observaciones !== undefined && cambios.observaciones !== obsAnteriores) cambiosLog.push({ campo: 'observaciones', antes: obsAnteriores.slice(0, 40) + (obsAnteriores.length > 40 ? '…' : ''), despues: cambios.observaciones.slice(0, 40) + (cambios.observaciones.length > 40 ? '…' : '') });
      const historialAnterior = String(principal.fields[F.HISTORIAL_EDIT] ?? '');
      const nuevaEntrada = formatearEntradaHistorial(usuarioEmail, cambiosLog);
      let auditoriaPersistida = false;
      try {
        await actualizarPorAppId('facturas_clientes', principal.id, {
          editado_por: usuarioEmail,
          fecha_ultima_edicion: new Date().toISOString(),
          historial_ediciones: historialAnterior ? `${historialAnterior}\n${nuevaEntrada}` : nuevaEntrada,
        });
        auditoriaPersistida = true;
      } catch (err) {
        console.warn('FASE 3: auditoría no persistida:', err instanceof Error ? err.message : err);
      }
      return {
        ok: true, facturaId, numeroAnterior,
        numeroNuevo: numeroNuevo && numeroNuevo !== numeroAnterior ? numeroNuevo : numeroAnterior,
        recordsActualizados: actualizados.length,
        recordsTotal: records.length,
        auditoriaPersistida,
      };
    } catch (err) {
      return { ok: false, facturaId, recordsActualizados: 0, recordsTotal: 0, auditoriaPersistida: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (!airtable) {
    return { ok: false, facturaId, recordsActualizados: 0, recordsTotal: 0, auditoriaPersistida: false, error: 'Airtable no está configurado.' };
  }
  try {
    // 1) Cargar el record principal para descubrir NO.FACTURA actual + bucket.
    const principalRec = await airtable(TABLES.FACTURAS).find(facturaId).catch(() => null);
    if (!principalRec) {
      return { ok: false, facturaId, recordsActualizados: 0, recordsTotal: 0, auditoriaPersistida: false, error: 'Factura no encontrada.' };
    }
    const numeroAnterior = String(principalRec.fields[F.NO_FACTURA] ?? '').trim();
    const fechaAnterior = String(principalRec.fields[F.FECHA_EMISION] ?? '').slice(0, 10);
    const obsAnteriores = String(principalRec.fields[F.OBSERVACIONES] ?? '');
    const estadoBrutoPrincipal = String(principalRec.fields[F.ESTADO] ?? '').toUpperCase().trim();
    if (estadoBrutoPrincipal === 'ANULADO' || estadoBrutoPrincipal === 'ANULADA' || estadoBrutoPrincipal === 'REFACTURADO' || estadoBrutoPrincipal === 'REFACTURADA') {
      return { ok: false, facturaId, numeroAnterior, recordsActualizados: 0, recordsTotal: 0, auditoriaPersistida: false, error: `No se puede editar una factura ${estadoBrutoPrincipal.toLowerCase()}.` };
    }

    const records = await leerRecordsDeFactura(numeroAnterior);
    if (records.length === 0) {
      return { ok: false, facturaId, numeroAnterior, recordsActualizados: 0, recordsTotal: 0, auditoriaPersistida: false, error: `No se encontraron líneas activas para la factura ${numeroAnterior}.` };
    }

    // 2) Si el número cambia: validar duplicado contra una factura ACTIVA distinta.
    const numeroNuevo = cambios.numeroFactura?.trim();
    if (numeroNuevo && numeroNuevo !== numeroAnterior) {
      const esc = numeroNuevo.replace(/"/g, '\\"');
      const colisiones = await airtable(TABLES.FACTURAS)
        .select({ filterByFormula: `{${F.NO_FACTURA}} = "${esc}"`, maxRecords: 50 })
        .all();
      const colisionActiva = colisiones.find(r => {
        const e = String(r.fields[F.ESTADO] ?? '').toUpperCase().trim();
        return e !== 'ANULADO' && e !== 'ANULADA' && e !== 'REFACTURADO' && e !== 'REFACTURADA';
      });
      if (colisionActiva) {
        return {
          ok: false,
          facturaId,
          numeroAnterior,
          numeroNuevo,
          recordsActualizados: 0,
          recordsTotal: records.length,
          auditoriaPersistida: false,
          error: `El número ${numeroNuevo} ya está en uso por otra factura activa. Solo podés reutilizarlo si la otra está anulada o refacturada.`,
          duplicado: {
            noFactura: numeroNuevo,
            facturaId: colisionActiva.id,
            estadoBruto: 'emitida',   // no nos importa el sub-estado, solo que está activa
          },
        };
      }
    }

    // 3) Construir el patch funcional (sin auditoría todavía).
    const patchFuncional: Record<string, string> = {};
    if (numeroNuevo && numeroNuevo !== numeroAnterior)               patchFuncional[F.NO_FACTURA]    = numeroNuevo;
    if (cambios.fechaEmision && cambios.fechaEmision !== fechaAnterior) patchFuncional[F.FECHA_EMISION] = cambios.fechaEmision;
    if (cambios.observaciones !== undefined && cambios.observaciones !== obsAnteriores) patchFuncional[F.OBSERVACIONES] = cambios.observaciones;

    if (Object.keys(patchFuncional).length === 0) {
      return { ok: false, facturaId, numeroAnterior, recordsActualizados: 0, recordsTotal: records.length, auditoriaPersistida: false, error: 'Los valores enviados son idénticos a los actuales.' };
    }

    // 4) UPDATE funcional (batch de 10). Aplica a TODOS los records del bucket
    // para mantener consolidateRecords coherente (multi-línea).
    const payloadsFuncional = records.map(r => ({ id: r.id, fields: { ...patchFuncional } }));
    const actualizados: string[] = [];
    for (let i = 0; i < payloadsFuncional.length; i += 10) {
      const lote = payloadsFuncional.slice(i, i + 10);
      const res = await airtable(TABLES.FACTURAS).update(lote);
      actualizados.push(...res.map(r => r.id));
    }

    // 5) UPDATE auditoría — separado, fail-soft. Solo al principal (el resto
    // del bucket consolida desde el principal).
    const cambiosLog: Array<{ campo: string; antes: string; despues: string }> = [];
    if (numeroNuevo && numeroNuevo !== numeroAnterior)                       cambiosLog.push({ campo: 'numeroFactura',  antes: numeroAnterior, despues: numeroNuevo });
    if (cambios.fechaEmision && cambios.fechaEmision !== fechaAnterior)      cambiosLog.push({ campo: 'fechaEmision',   antes: fechaAnterior,  despues: cambios.fechaEmision });
    if (cambios.observaciones !== undefined && cambios.observaciones !== obsAnteriores) cambiosLog.push({ campo: 'observaciones', antes: obsAnteriores.slice(0, 40) + (obsAnteriores.length > 40 ? '…' : ''), despues: cambios.observaciones.slice(0, 40) + (cambios.observaciones.length > 40 ? '…' : '') });

    const historialAnterior = String(principalRec.fields[F.HISTORIAL_EDIT] ?? '');
    const nuevaEntrada = formatearEntradaHistorial(usuarioEmail, cambiosLog);
    const historialNuevo = historialAnterior ? `${historialAnterior}\n${nuevaEntrada}` : nuevaEntrada;

    let auditoriaPersistida = false;
    try {
      await airtable(TABLES.FACTURAS).update([{
        id: principalRec.id,
        fields: {
          [F.EDITADO_POR]:        usuarioEmail,
          [F.FECHA_ULTIMA_EDIT]:  new Date().toISOString(),
          [F.HISTORIAL_EDIT]:     historialNuevo,
        },
      }]);
      auditoriaPersistida = true;
    } catch (err) {
      // Los campos de auditoría aún no existen en Airtable. El cambio funcional
      // ya se aplicó — solo perdemos el log.
      console.warn('F-044: auditoría no persistida (campos posiblemente ausentes):', err instanceof Error ? err.message : err);
    }

    return {
      ok: true,
      facturaId,
      numeroAnterior,
      numeroNuevo: numeroNuevo && numeroNuevo !== numeroAnterior ? numeroNuevo : numeroAnterior,
      recordsActualizados: actualizados.length,
      recordsTotal: records.length,
      auditoriaPersistida,
    };
  } catch (err) {
    return {
      ok: false,
      facturaId,
      recordsActualizados: 0,
      recordsTotal: 0,
      auditoriaPersistida: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface EntradaHistorialEdicion {
  fecha: string;       // ISO datetime tal como lo guardamos
  usuario: string;
  cambios: string;     // texto crudo tras el "email:" (puede listar varios campos)
}

/** Parsea el long-text Historial_Ediciones en entradas estructuradas. */
export function parsearHistorialEdiciones(raw: string | undefined): EntradaHistorialEdicion[] {
  if (!raw) return [];
  // Formato: "[YYYY-MM-DD HH:mm] email: cambios…" — una línea por entrada.
  const RE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\] ([^:]+): (.+)$/;
  return raw.split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      const m = RE.exec(l);
      if (!m) return null;
      return { fecha: m[1], usuario: m[2].trim(), cambios: m[3].trim() };
    })
    .filter((x): x is EntradaHistorialEdicion => x !== null)
    .reverse();   // más recientes primero
}

export async function getHistorialEdicionesFactura(facturaId: string): Promise<EntradaHistorialEdicion[]> {
  if (dataSource('facturas_clientes') === 'supabase') {
    // FASE 3: la columna historial_ediciones ya existe (03_fase2_gaps.sql)
    // y la edición en Supabase la escribe.
    try {
      const sb = supabase();
      if (!sb) return [];
      const { data } = await sb.from('facturas_clientes')
        .select('historial_ediciones').eq('airtable_id', facturaId).limit(1);
      return parsearHistorialEdiciones(String((data?.[0] as { historial_ediciones?: string } | undefined)?.historial_ediciones ?? ''));
    } catch {
      return [];
    }
  }
  if (!airtable) return [];
  try {
    const rec = await airtable(TABLES.FACTURAS).find(facturaId);
    return parsearHistorialEdiciones(String(rec.fields[F.HISTORIAL_EDIT] ?? ''));
  } catch {
    return [];
  }
}
