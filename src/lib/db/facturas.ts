import { airtable, USE_MOCK, TABLES } from './airtable';
import { consolidateRecords, F } from './mappers';
import { INVOICES as MOCK_INVOICES } from '../mock-data';
import type { Invoice, InvoiceEstadoBruto } from '../types';

export async function getFacturas(filters?: {
  status?: Invoice['status'];
  custId?: string;
  line?: string;
}): Promise<Invoice[]> {
  if (USE_MOCK || !airtable) {
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
    const records = await airtable(TABLES.FACTURAS)
      .select({
        sort: [{ field: 'FECHA_EMISION', direction: 'desc' }],
      })
      .all();

    let invoices = consolidateRecords(records.map(r => ({ id: r.id, fields: r.fields })));

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
export async function getFacturasLiviano(): Promise<InvoiceLiviano[]> {
  if (USE_MOCK || !airtable) {
    return MOCK_INVOICES.map(i => ({
      id: i.id, noFactura: i.noFactura, custId: i.custId, total: i.total,
      estadoBruto: i.estadoBruto, vencida: i.vencida,
      numLineas: i.lineas?.length ?? 1,
    }));
  }
  try {
    // F-034: sin maxRecords — `.all()` agota todas las páginas.
    const records = await airtable(TABLES.FACTURAS)
      .select({
        fields: [F.NO_FACTURA, F.TOTAL, F.ESTADO, F.ESTATUS_COBRANZA, F.CLIENTE],
      })
      .all();

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

      out.push({
        id: principal.id,
        noFactura: String(principal.fields[F.NO_FACTURA] ?? principal.id),
        custId: String((principal.fields[F.CLIENTE] as string[] | undefined)?.[0] ?? ''),
        total,
        estadoBruto: brutoDominante,
        vencida,
        numLineas: bucket.records.length,
      });
    }
    return out;
  } catch (err) {
    console.error('Error fetching facturas liviano:', err);
    return [];
  }
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
export async function getFacturasPagina(args: { limit?: number; before?: string; filtro?: FiltroTabFactura } = {}): Promise<GetFacturasPaginaResult> {
  const limit = args.limit ?? 50;

  if (USE_MOCK || !airtable) {
    const mock = [...MOCK_INVOICES]
      .filter(predicadoFiltro(args.filtro))
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
    const conFiltroEstrecho = !!filtroFormula;
    const overFetch = conFiltroEstrecho ? undefined : Math.min(5000, limit * 4 + 100);
    const select: Parameters<ReturnType<typeof airtable>['select']>[0] = {
      sort: [{ field: 'FECHA_EMISION', direction: 'desc' }],
    };
    if (overFetch) select.maxRecords = overFetch;
    const partes: string[] = [];
    if (filtroFormula) partes.push(filtroFormula);
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
  if (USE_MOCK || !airtable) return MOCK_INVOICES.length;
  try {
    // F-034: sin maxRecords (agota todas las páginas).
    const records = await airtable(TABLES.FACTURAS)
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
  if (USE_MOCK || !airtable) {
    throw new Error('createFactura: Airtable no está configurado.');
  }
  if (!input.noFactura?.trim()) throw new Error('NO.FACTURA es requerido.');
  if (!input.custId)            throw new Error('Cliente es requerido.');
  if (!input.lineas?.length)    throw new Error('Se requiere al menos una línea.');

  try {
    // Evitar duplicado silencioso: ¿ya existe ese NO.FACTURA?
    const noFacturaEsc = input.noFactura.replace(/"/g, '\\"');
    const existentes = await airtable(TABLES.FACTURAS)
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
      const res = await airtable(TABLES.FACTURAS).create(lote);
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
  if (!airtable) throw new Error('Airtable no está configurado.');
  const nf = (noFactura ?? '').trim();
  if (!nf) return { ok: false, noFactura: nf, recordsActualizados: 0, recordsTotal: 0, error: 'NO.FACTURA es requerido.' };

  try {
    const esc = nf.replace(/"/g, '\\"');
    const records = await airtable(TABLES.FACTURAS)
      .select({ filterByFormula: `{${F.NO_FACTURA}} = "${esc}"`, maxRecords: 100 })
      .all();

    if (records.length === 0) {
      return { ok: false, noFactura: nf, recordsActualizados: 0, recordsTotal: 0, error: `No se encontró la factura ${nf}.` };
    }

    const esRefacturacion = motivoTipo === 'Refacturación';
    const estadoTarget = esRefacturacion ? 'REFACTURADO' : 'ANULADO';
    const verbo = esRefacturacion ? 'Refacturado' : 'Anulado';

    const fechaAnulacion = new Date().toISOString().slice(0, 10);
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
        const res = await airtable(TABLES.FACTURAS).update(lote);
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
