import { airtable, USE_MOCK, TABLES } from './airtable';
import { F } from './mappers';
import { getBancos } from './bancos';
import type { Payment } from '../types';

const MOCK_PAYMENTS: Payment[] = [];

export async function getCobros(): Promise<Payment[]> {
  if (USE_MOCK || !airtable) return MOCK_PAYMENTS;
  return MOCK_PAYMENTS;
}

/* ============================================================
 * Listado paginado de cobros (F-023)
 * Multi-línea: una factura multi-línea genera N records en COBROS_CLIENTES.
 * Consolidamos por (NO.FACTURA, Fecha_Cobro) para mostrar 1 cobro por factura.
 * ============================================================ */

export interface CobroListado {
  key: string;                   // 'noFactura|fecha' — único por cobro consolidado
  noFactura: string;
  fechaCobro: string;            // 'YYYY-MM-DD'
  custId: string;
  monto: number;                 // suma de Monto_Cobrado de las N líneas
  bancoNombre: string;           // resuelto desde BANCOS (NOMBRE_CUENTA o BANCO)
  metodo: string;
  moneda: string;
  tipoCambio: number;
  referencia: string;
  estado: string;                // 'Pendiente' | 'Conciliado'
  numLineas: number;             // cuántos records de COBROS lo componen
  recordIds: string[];           // ids de COBROS_CLIENTES
}

export interface GetCobrosPaginaResult {
  cobros: CobroListado[];
  hayMas: boolean;
  ultimaFecha: string | null;    // del último cobro del batch (cursor para next page)
}

// Campos de COBROS_CLIENTES (escribibles + lookups que usamos para leer)
const FC_READ = {
  FECHA:        'Fecha_Cobro',
  FACTURA:      'Factura Cliente',
  MONTO:        'Monto_Cobrado',
  CUENTA_BANCO: 'Cuenta_Banco',
  METODO:       'Método',
  MONEDA:       'Moneda',
  TIPO_CAMBIO:  'Tipo_Cambio',
  ESTADO:       'Estado',
  REFERENCIA:   'Referencia',
  NO_FACTURA:   'NO.FACTURA (from Factura Cliente)',
  CLIENTE:      'CLIENTE  (from Factura Cliente)',   // 2 espacios entre CLIENTE y (from
} as const;

interface RawCobro {
  recordId: string;
  fecha: string;
  noFactura: string;
  custId: string;
  monto: number;
  bancoId: string;
  metodo: string;
  moneda: string;
  tipoCambio: number;
  referencia: string;
  estado: string;
}

function recordToRaw(record: { id: string; fields: Record<string, unknown> }): RawCobro {
  const f = record.fields;
  const arrFirst = (v: unknown) => Array.isArray(v) ? String(v[0] ?? '') : '';
  return {
    recordId:   record.id,
    fecha:      String(f[FC_READ.FECHA] ?? ''),
    noFactura:  arrFirst(f[FC_READ.NO_FACTURA]),
    custId:     arrFirst(f[FC_READ.CLIENTE]),
    monto:      Number(f[FC_READ.MONTO] ?? 0),
    bancoId:    arrFirst(f[FC_READ.CUENTA_BANCO]),
    metodo:     String(f[FC_READ.METODO] ?? ''),
    moneda:     String(f[FC_READ.MONEDA] ?? ''),
    tipoCambio: Number(f[FC_READ.TIPO_CAMBIO] ?? 1),
    referencia: String(f[FC_READ.REFERENCIA] ?? ''),
    estado:     String(f[FC_READ.ESTADO] ?? ''),
  };
}

function consolidarCobros(raws: RawCobro[], bancoNombreById: Map<string, string>): CobroListado[] {
  const buckets = new Map<string, RawCobro[]>();
  for (const r of raws) {
    // Solo agrupar si hay noFactura y fecha; si faltan, key por recordId (no se mezcla)
    const key = r.noFactura && r.fecha ? `${r.noFactura}|${r.fecha}` : `__rec__${r.recordId}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(r);
  }
  const out: CobroListado[] = [];
  for (const [key, rows] of buckets) {
    const head = rows[0];
    out.push({
      key,
      noFactura:   head.noFactura,
      fechaCobro:  head.fecha,
      custId:      head.custId,
      monto:       rows.reduce((s, r) => s + r.monto, 0),
      bancoNombre: bancoNombreById.get(head.bancoId) || head.bancoId || '—',
      metodo:      head.metodo,
      moneda:      head.moneda,
      tipoCambio:  head.tipoCambio,
      referencia:  head.referencia,
      estado:      head.estado,
      numLineas:   rows.length,
      recordIds:   rows.map(r => r.recordId),
    });
  }
  // Ordenar por fecha desc dentro de la página
  out.sort((a, b) => (b.fechaCobro || '').localeCompare(a.fechaCobro || ''));
  return out;
}

export async function getCobrosPagina(args: { limit?: number; before?: string } = {}): Promise<GetCobrosPaginaResult> {
  const limit = args.limit ?? 50;
  if (USE_MOCK || !airtable) return { cobros: [], hayMas: false, ultimaFecha: null };

  try {
    const overFetch = Math.min(2000, limit * 3 + 50);
    const select: Parameters<ReturnType<typeof airtable>['select']>[0] = {
      sort: [{ field: FC_READ.FECHA, direction: 'desc' }],
      maxRecords: overFetch,
    };
    if (args.before) {
      const esc = args.before.replace(/"/g, '');
      select.filterByFormula = `IS_BEFORE({${FC_READ.FECHA}}, DATETIME_PARSE("${esc}"))`;
    }
    const [records, bancos] = await Promise.all([
      airtable(TABLES.COBROS).select(select).all(),
      getBancos(),
    ]);
    const bancoNombreById = new Map(bancos.map(b => [b.id, b.nombreCuenta || b.banco || b.id]));

    const raws = records.map(r => recordToRaw({ id: r.id, fields: r.fields as Record<string, unknown> }));
    const consolidados = consolidarCobros(raws, bancoNombreById);
    const page = consolidados.slice(0, limit);
    const hayMas = consolidados.length > limit || records.length === overFetch;
    const ultimaFecha = page[page.length - 1]?.fechaCobro ?? null;
    return { cobros: page, hayMas, ultimaFecha };
  } catch (err) {
    console.error('Error fetching cobros pagina:', err);
    return { cobros: [], hayMas: false, ultimaFecha: null };
  }
}

/**
 * Trae TODOS los cobros consolidados desde Airtable (no paginado).
 * Pensado para reportes/analítica/AI tools que necesitan agregar por período.
 * NOTA: getCobros() devuelve mock data por compatibilidad histórica; esta
 * función es la que hay que usar para datos reales.
 */
export async function getCobrosCompletos(): Promise<CobroListado[]> {
  if (USE_MOCK || !airtable) return [];
  try {
    const [records, bancos] = await Promise.all([
      airtable(TABLES.COBROS)
        .select({ sort: [{ field: FC_READ.FECHA, direction: 'desc' }], maxRecords: 5000 })
        .all(),
      getBancos(),
    ]);
    const bancoNombreById = new Map(bancos.map(b => [b.id, b.nombreCuenta || b.banco || b.id]));
    const raws = records.map(r => recordToRaw({ id: r.id, fields: r.fields as Record<string, unknown> }));
    return consolidarCobros(raws, bancoNombreById);
  } catch (err) {
    console.error('Error fetching cobros completos:', err);
    return [];
  }
}

/** Cuenta total de cobros consolidados (única (NO.FACTURA, Fecha_Cobro)). */
export async function getCobrosCountTotal(): Promise<number> {
  if (USE_MOCK || !airtable) return 0;
  try {
    const records = await airtable(TABLES.COBROS)
      .select({ fields: [FC_READ.FECHA, FC_READ.NO_FACTURA], maxRecords: 2000 })
      .all();
    const claves = new Set<string>();
    for (const r of records) {
      const f = r.fields as Record<string, unknown>;
      const fecha = String(f[FC_READ.FECHA] ?? '');
      const nf = Array.isArray(f[FC_READ.NO_FACTURA]) ? String((f[FC_READ.NO_FACTURA] as unknown[])[0] ?? '') : '';
      if (nf && fecha) claves.add(`${nf}|${fecha}`);
      else claves.add(`__rec__${r.id}`);
    }
    return claves.size;
  } catch (err) {
    console.error('Error contando cobros:', err);
    return 0;
  }
}

/* ============================================================
 * Registrar cobro contra una factura (F-007)
 * - TODO O NADA: el monto = TOTAL de la factura, sin parciales.
 * - Multi-línea: crea 1 record por línea (Monto_Cobrado = TOTAL de la línea).
 *   La última línea absorbe el residuo de redondeo para que la suma cuadre.
 * - Actualiza ESTADO de TODAS las filas a 'COBRADO ' (con espacio final).
 * ============================================================ */

export type MetodoCobro = 'Transferencia' | 'Cheque' | 'Efectivo' | 'Tarjeta';
export type MonedaCobro = 'GTQ' | 'USD';

// Campos editables de COBROS_CLIENTES
const FC = {
  FECHA:        'Fecha_Cobro',
  FACTURA:      'Factura Cliente',
  MONTO:        'Monto_Cobrado',
  CUENTA_BANCO: 'Cuenta_Banco',
  METODO:       'Método',
  MONEDA:       'Moneda',
  TIPO_CAMBIO:  'Tipo_Cambio',
  ESTADO:       'Estado',
  REFERENCIA:   'Referencia',
} as const;

export interface RegistrarCobroInput {
  noFactura: string;
  fecha: string;            // 'YYYY-MM-DD'
  bancoId: string;          // record id BANCOS
  metodo: MetodoCobro;
  moneda?: MonedaCobro;     // default 'GTQ'
  tipoCambio?: number;      // default 1
  referencia?: string;
}

export interface RegistrarCobroResult {
  ok: boolean;
  noFactura: string;
  totalCobrado: number;
  cobrosCreados: number;
  recordsActualizados: number;
  fallidos?: { cobrosLote?: number[]; estadoIds?: string[] };
  error?: string;
}

const estadoCanon = (e: unknown) => String(e ?? '').toUpperCase().trim();
const round2 = (n: number) => Math.round(n * 100) / 100;

export async function registrarCobro(input: RegistrarCobroInput): Promise<RegistrarCobroResult> {
  if (!airtable) throw new Error('Airtable no está configurado.');

  const nf = (input.noFactura ?? '').trim();
  if (!nf)               return fail(nf, 'NO.FACTURA es requerido.');
  if (!input.bancoId)    return fail(nf, 'Cuenta de banco es requerida.');
  if (!input.metodo)     return fail(nf, 'Método de cobro es requerido.');
  if (!input.fecha)      return fail(nf, 'Fecha del cobro es requerida.');

  const moneda     = input.moneda     ?? 'GTQ';
  const tipoCambio = input.tipoCambio ?? 1;

  try {
    // 1) Filas de la factura (excluye ANULADAS/REFACTURADAS — esas no se cobran)
    const esc = nf.replace(/"/g, '\\"');
    const records = await airtable(TABLES.FACTURAS)
      .select({ filterByFormula: `{${F.NO_FACTURA}} = "${esc}"`, maxRecords: 100 })
      .all();
    if (records.length === 0) {
      return fail(nf, `No se encontró la factura ${nf}.`);
    }

    const activas = records.filter(r => {
      const e = estadoCanon(r.fields[F.ESTADO]);
      return e !== 'ANULADO' && e !== 'ANULADA' && e !== 'REFACTURADO' && e !== 'REFACTURADA';
    });
    if (activas.length === 0) {
      return fail(nf, `La factura ${nf} está completamente anulada o refacturada. No se puede cobrar.`);
    }

    // 2) Validar ESTADO: solo EMITIDA o PENDIENTE pueden cobrarse
    const noCobrables: string[] = [];
    for (const r of activas) {
      const e = estadoCanon(r.fields[F.ESTADO]);
      if (e !== 'EMITIDA' && e !== 'PENDIENTE') noCobrables.push(e || '(vacío)');
    }
    if (noCobrables.length > 0) {
      const u = [...new Set(noCobrables)].join(', ');
      return fail(nf, `La factura no se puede cobrar — alguna línea está en estado "${u}". Solo EMITIDA o PENDIENTE son cobrables.`);
    }

    // 3) TOTAL de la factura y 4) distribución proporcional con residuo en la última
    const lineas = activas.map(r => ({
      id:    r.id,
      total: Number(r.fields[F.TOTAL] ?? 0),
    }));
    const totalFactura = round2(lineas.reduce((s, l) => s + l.total, 0));
    if (totalFactura <= 0) {
      return fail(nf, `La factura tiene TOTAL cero — no hay nada que cobrar.`);
    }

    let asignado = 0;
    const cobrosPlan = lineas.map((l, i) => {
      let monto: number;
      if (i === lineas.length - 1) {
        // Última: residuo exacto para que la suma sea = totalFactura
        monto = round2(totalFactura - asignado);
      } else {
        monto = round2(l.total);
        asignado += monto;
      }
      return { facturaId: l.id, monto };
    });

    // 5) Crear N records en COBROS_CLIENTES (batch 10)
    const cobroFields = (facturaId: string, monto: number) => ({
      fields: {
        [FC.FECHA]:        input.fecha,
        [FC.FACTURA]:      [facturaId],
        [FC.MONTO]:        monto,
        [FC.CUENTA_BANCO]: [input.bancoId],
        [FC.METODO]:       input.metodo,
        [FC.MONEDA]:       moneda,
        [FC.TIPO_CAMBIO]:  tipoCambio,
        [FC.ESTADO]:       'Pendiente',
        ...(input.referencia ? { [FC.REFERENCIA]: input.referencia.trim() } : {}),
      },
    });

    const payloadCobros = cobrosPlan.map(p => cobroFields(p.facturaId, p.monto));
    const cobrosCreados: string[] = [];
    const lotesFallidos: number[] = [];
    for (let i = 0; i < payloadCobros.length; i += 10) {
      const lote = payloadCobros.slice(i, i + 10);
      try {
        const res = await airtable(TABLES.COBROS).create(lote);
        cobrosCreados.push(...res.map(r => r.id));
      } catch (err) {
        console.error('Error creando lote de cobros:', err);
        lotesFallidos.push(i);
      }
    }

    if (cobrosCreados.length === 0) {
      return fail(nf, 'No se pudo crear ningún record de cobro en COBROS_CLIENTES. La factura NO se marcó como cobrada.');
    }

    // 6) Actualizar ESTADO de las filas activas a 'COBRADO ' (CON ESPACIO FINAL)
    const updates = activas.map(r => ({
      id: r.id,
      fields: { [F.ESTADO]: 'COBRADO ' },   // exacto del singleSelect
    }));
    const estadoActualizados: string[] = [];
    const estadoFallidos: string[] = [];
    for (let i = 0; i < updates.length; i += 10) {
      const lote = updates.slice(i, i + 10);
      try {
        const res = await airtable(TABLES.FACTURAS).update(lote);
        estadoActualizados.push(...res.map(r => r.id));
      } catch (err) {
        console.error('Error actualizando ESTADO a COBRADO:', err);
        estadoFallidos.push(...lote.map(p => p.id));
      }
    }

    const ok = lotesFallidos.length === 0 && estadoFallidos.length === 0;
    return {
      ok,
      noFactura: nf,
      totalCobrado: totalFactura,
      cobrosCreados: cobrosCreados.length,
      recordsActualizados: estadoActualizados.length,
      fallidos: ok ? undefined : {
        cobrosLote: lotesFallidos.length > 0 ? lotesFallidos : undefined,
        estadoIds:  estadoFallidos.length > 0 ? estadoFallidos : undefined,
      },
      error: ok ? undefined : `Cobro parcial: ${cobrosCreados.length} cobro(s) creado(s), ${estadoActualizados.length}/${activas.length} líneas en COBRADO. Revisá Airtable.`,
    };
  } catch (err) {
    return fail(nf, err instanceof Error ? err.message : String(err));
  }
}

function fail(noFactura: string, error: string): RegistrarCobroResult {
  return { ok: false, noFactura, totalCobrado: 0, cobrosCreados: 0, recordsActualizados: 0, error };
}
