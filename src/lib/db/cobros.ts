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
  // F-035: agregados de retención para badge en /cobros.
  retencionIVA: number;
  retencionISR: number;
  tieneRetencion: boolean;
  // F-035.1: URL de la primera constancia adjunta del grupo (si la hay).
  constanciaUrl: string | null;
  tieneConstancia: boolean;
  // F-036: estado de anulación del grupo. Un grupo se considera "Anulado"
  // cuando TODOS sus records están en Estado_Cobro=Anulado.
  estadoCobro: 'Activo' | 'Anulado';
  fechaAnulacion?: string;
  motivoAnulacion?: string;
  anuladoPor?: string;
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
  RET_IVA:      'Monto_Retencion_IVA',
  RET_ISR:      'Monto_Retencion_ISR',
  CONSTANCIA:   'Constancia_Retencion',
  GRUPO_ID:     'Cobro_Grupo_ID',
  // F-036: campos de anulación.
  ESTADO_COBRO:     'Estado_Cobro',
  FECHA_ANULACION:  'Fecha_Anulacion',
  MOTIVO_ANULACION: 'Motivo_Anulacion',
  ANULADO_POR:      'Anulado_Por',
} as const;

/** F-036: cobro activo = Estado_Cobro != 'Anulado'. Vacío se trata como Activo
 *  para compat con cobros pre-F-036 que no tenían el campo. */
function esCobroActivoFields(f: Record<string, unknown>): boolean {
  const e = String(f[FC_READ.ESTADO_COBRO] ?? '').trim().toUpperCase();
  return e !== 'ANULADO';
}

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
  retencionIVA: number;
  retencionISR: number;
  grupoId: string;
  constanciaUrl: string | null;
  // F-036.
  estadoCobro: 'Activo' | 'Anulado';
  fechaAnulacion: string;
  motivoAnulacion: string;
  anuladoPor: string;
}

function recordToRaw(record: { id: string; fields: Record<string, unknown> }): RawCobro {
  const f = record.fields;
  const arrFirst = (v: unknown) => Array.isArray(v) ? String(v[0] ?? '') : '';
  const constancia = Array.isArray(f[FC_READ.CONSTANCIA])
    ? (f[FC_READ.CONSTANCIA] as Array<{ url?: string }>)[0]
    : undefined;
  const estadoCobroRaw = String(f[FC_READ.ESTADO_COBRO] ?? '').trim();
  const estadoCobro: 'Activo' | 'Anulado' = estadoCobroRaw.toUpperCase() === 'ANULADO' ? 'Anulado' : 'Activo';
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
    retencionIVA: Number(f[FC_READ.RET_IVA] ?? 0),
    retencionISR: Number(f[FC_READ.RET_ISR] ?? 0),
    grupoId:    String(f[FC_READ.GRUPO_ID] ?? ''),
    constanciaUrl: constancia?.url ?? null,
    estadoCobro,
    fechaAnulacion:  String(f[FC_READ.FECHA_ANULACION] ?? ''),
    motivoAnulacion: String(f[FC_READ.MOTIVO_ANULACION] ?? ''),
    anuladoPor:      String(f[FC_READ.ANULADO_POR] ?? ''),
  };
}

function consolidarCobros(raws: RawCobro[], bancoNombreById: Map<string, string>): CobroListado[] {
  // F-035: ahora consolidamos por Cobro_Grupo_ID cuando existe (un evento de
  // cobro con N componentes + N líneas). Cobros viejos sin grupo siguen el
  // patrón legacy (noFactura+fecha agrupa multi-línea de un cobro único).
  const buckets = new Map<string, RawCobro[]>();
  for (const r of raws) {
    let key: string;
    if (r.grupoId) {
      key = r.grupoId;
    } else if (r.noFactura && r.fecha) {
      key = `${r.noFactura}|${r.fecha}`;
    } else {
      key = `__rec__${r.recordId}`;
    }
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(r);
  }
  const out: CobroListado[] = [];
  for (const [key, rows] of buckets) {
    // El "head" debería ser un componente bancario si existe (no retención),
    // así el método y banco mostrados en /cobros son los reales del cobro.
    const head = rows.find(r => r.metodo !== 'Retención IVA' && r.metodo !== 'Retención ISR') ?? rows[0];
    const retencionIVA = rows.reduce((s, r) => s + r.retencionIVA, 0);
    const retencionISR = rows.reduce((s, r) => s + r.retencionISR, 0);
    const constanciaUrl = rows.find(r => r.constanciaUrl)?.constanciaUrl ?? null;
    // F-036: grupo anulado = TODOS sus records están anulados. Mientras quede
    // un record activo, el grupo no es "anulado" (escenario poco común porque
    // anularCobro marca todos a la vez, pero la lógica es defensiva).
    const todosAnulados = rows.every(r => r.estadoCobro === 'Anulado');
    const muestraAnulado = rows.find(r => r.estadoCobro === 'Anulado');
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
      retencionIVA,
      retencionISR,
      tieneRetencion: retencionIVA > 0 || retencionISR > 0,
      constanciaUrl,
      tieneConstancia: !!constanciaUrl,
      estadoCobro: todosAnulados ? 'Anulado' : 'Activo',
      fechaAnulacion:  muestraAnulado?.fechaAnulacion || undefined,
      motivoAnulacion: muestraAnulado?.motivoAnulacion || undefined,
      anuladoPor:      muestraAnulado?.anuladoPor || undefined,
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
 * Registrar cobro contra una factura (F-007 + F-035 multi-componente)
 *
 * F-035: el cobro acepta N componentes (transferencia + retención IVA +
 * retención ISR, etc.). La suma de componentes puede ser MENOR al saldo
 * pendiente (cobro parcial) → ESTADO de la factura pasa a 'COBRADO PARCIAL '
 * en vez de 'COBRADO '. Cada componente genera 1 record por línea con
 * Cobro_Grupo_ID común para reagrupar visualmente.
 *
 * Retenciones (Monto_Retencion_IVA / Monto_Retencion_ISR) son crédito
 * fiscal — su Monto_Cobrado cuenta hacia el saldo (el cliente la enteró
 * a SAT por nosotros) y el campo Monto_Retencion_* se llena con el mismo
 * monto para que el reporte de /retenciones lo sume aparte.
 * ============================================================ */

export type MetodoBanco     = 'Transferencia' | 'Cheque' | 'Efectivo' | 'Tarjeta';
export type MetodoRetencion = 'Retención IVA' | 'Retención ISR';
export type MetodoCobro     = MetodoBanco | MetodoRetencion;
export type MonedaCobro     = 'GTQ' | 'USD';

const METODOS_BANCO: readonly MetodoCobro[] = ['Transferencia', 'Cheque', 'Efectivo', 'Tarjeta'];
const esMetodoRetencion = (m: MetodoCobro): m is MetodoRetencion =>
  m === 'Retención IVA' || m === 'Retención ISR';

// Campos editables de COBROS_CLIENTES
const FC = {
  FECHA:        'Fecha_Cobro',
  FACTURA:      'Factura Cliente',
  MONTO:        'Monto_Cobrado',
  CUENTA_BANCO: 'Cuenta_Banco',
  METODO:       'Método',
  MONEDA:       'Moneda',
  TIPO_CAMBIO:  'Tipo_Cambio',
  // F-036.
  ESTADO_COBRO:     'Estado_Cobro',
  FECHA_ANULACION:  'Fecha_Anulacion',
  MOTIVO_ANULACION: 'Motivo_Anulacion',
  ANULADO_POR:      'Anulado_Por',
  ESTADO:       'Estado',
  REFERENCIA:   'Referencia',
  RET_IVA:      'Monto_Retencion_IVA',
  RET_ISR:      'Monto_Retencion_ISR',
  GRUPO_ID:     'Cobro_Grupo_ID',
} as const;

export interface ComponenteCobro {
  monto: number;
  metodo: MetodoCobro;
  bancoId?: string;     // requerido SI metodo NO es retención
  referencia?: string;  // ref bancaria o número de constancia de retención
  notas?: string;
}

export interface RegistrarCobroInput {
  noFactura: string;
  fecha: string;                  // 'YYYY-MM-DD'
  componentes: ComponenteCobro[]; // 1..N
  moneda?: MonedaCobro;
  tipoCambio?: number;
}

export interface DesgloseComponentes {
  transferencia: number;
  cheque: number;
  efectivo: number;
  tarjeta: number;
  retencionIVA: number;
  retencionISR: number;
}

export interface RegistrarCobroResult {
  ok: boolean;
  noFactura: string;
  grupoId: string;
  totalCobrado: number;
  saldoAnterior: number;
  saldoNuevo: number;
  estadoNuevo: 'COBRADO' | 'COBRADO PARCIAL' | '';
  cobrosCreados: number;
  recordsActualizados: number;
  desglose: DesgloseComponentes;
  // F-035.1: IDs creados por componente, en el mismo orden que input.componentes.
  // Permite a la action subir la constancia al primer record de cada componente.
  componentesRecordIds: string[][];
  fallidos?: { cobrosLote?: number[]; estadoIds?: string[] };
  error?: string;
}

const estadoCanon = (e: unknown) => String(e ?? '').toUpperCase().trim();
const round2 = (n: number) => Math.round(n * 100) / 100;
const SALDO_TOLERANCIA = 0.01;   // tolerancia de redondeo para considerar saldo=0

function nuevoGrupoId(noFactura: string): string {
  // Único por evento: timestamp YYYYMMDDhhmmss + slug de factura + 4 random hex
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const slug = noFactura.replace(/[^A-Za-z0-9]/g, '').slice(-12) || 'FACT';
  const rnd = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `G-${ts}-${slug}-${rnd}`;
}

function desgloseVacio(): DesgloseComponentes {
  return { transferencia: 0, cheque: 0, efectivo: 0, tarjeta: 0, retencionIVA: 0, retencionISR: 0 };
}

export async function registrarCobro(input: RegistrarCobroInput): Promise<RegistrarCobroResult> {
  if (!airtable) throw new Error('Airtable no está configurado.');

  const nf = (input.noFactura ?? '').trim();
  if (!nf)                                    return fail(nf, 'NO.FACTURA es requerido.');
  if (!input.fecha)                           return fail(nf, 'Fecha del cobro es requerida.');
  if (!input.componentes || input.componentes.length === 0) {
    return fail(nf, 'Al menos un componente de cobro es requerido.');
  }

  // Validación por componente
  for (let i = 0; i < input.componentes.length; i++) {
    const c = input.componentes[i];
    if (!(c.monto > 0))         return fail(nf, `Componente #${i + 1}: monto debe ser mayor a 0.`);
    if (!c.metodo)              return fail(nf, `Componente #${i + 1}: método es requerido.`);
    if (!esMetodoRetencion(c.metodo) && !c.bancoId) {
      return fail(nf, `Componente #${i + 1} (${c.metodo}): cuenta de banco es requerida.`);
    }
    if (esMetodoRetencion(c.metodo) && c.bancoId) {
      return fail(nf, `Componente #${i + 1} (${c.metodo}): las retenciones no llevan banco — quitalo.`);
    }
  }

  const moneda     = input.moneda     ?? 'GTQ';
  const tipoCambio = input.tipoCambio ?? 1;

  try {
    // 1) Filas de la factura
    const esc = nf.replace(/"/g, '\\"');
    const records = await airtable(TABLES.FACTURAS)
      .select({ filterByFormula: `{${F.NO_FACTURA}} = "${esc}"`, maxRecords: 100 })
      .all();
    if (records.length === 0) return fail(nf, `No se encontró la factura ${nf}.`);

    // Activas = no anuladas/refacturadas
    const activas = records.filter(r => {
      const e = estadoCanon(r.fields[F.ESTADO]);
      return e !== 'ANULADO' && e !== 'ANULADA' && e !== 'REFACTURADO' && e !== 'REFACTURADA';
    });
    if (activas.length === 0) {
      return fail(nf, `La factura ${nf} está completamente anulada o refacturada. No se puede cobrar.`);
    }

    // F-035: ESTADO permitido para cobrar = EMITIDA, PENDIENTE, COBRADO PARCIAL.
    // Si ya está COBRADO al 100%, no se puede.
    const noCobrables: string[] = [];
    for (const r of activas) {
      const e = estadoCanon(r.fields[F.ESTADO]);
      if (e !== 'EMITIDA' && e !== 'PENDIENTE' && e !== 'COBRADO PARCIAL') {
        noCobrables.push(e || '(vacío)');
      }
    }
    if (noCobrables.length > 0) {
      const u = [...new Set(noCobrables)].join(', ');
      return fail(nf, `La factura no se puede cobrar — alguna línea está en estado "${u}". Solo EMITIDA, PENDIENTE o COBRADO PARCIAL son cobrables.`);
    }

    // 2) Total de la factura
    const lineas = activas.map(r => ({ id: r.id, total: Number(r.fields[F.TOTAL] ?? 0) }));
    const totalFactura = round2(lineas.reduce((s, l) => s + l.total, 0));
    if (totalFactura <= 0) return fail(nf, `La factura tiene TOTAL cero — no hay nada que cobrar.`);

    // 3) Saldo pendiente actual = totalFactura - suma de Monto_Cobrado de cobros previos
    //    ACTIVOS (F-036). Cobros anulados se excluyen del saldo.
    //    No confiamos en Saldo_Por_Cobrar de Airtable: era buggy en su fórmula.
    const cobrosPreviosRecords = await airtable(TABLES.COBROS)
      .select({
        filterByFormula: `{${FC_READ.NO_FACTURA}} = "${esc}"`,
        fields: [FC_READ.MONTO, FC_READ.ESTADO_COBRO],
      })
      .all();
    const cobradoPrevio = round2(
      cobrosPreviosRecords
        .filter(r => esCobroActivoFields(r.fields as Record<string, unknown>))
        .reduce((s, r) => s + Number((r.fields as Record<string, unknown>)[FC_READ.MONTO] ?? 0), 0)
    );
    const saldoAnterior = round2(totalFactura - cobradoPrevio);
    if (saldoAnterior <= SALDO_TOLERANCIA) {
      return fail(nf, `La factura ${nf} ya está cobrada por completo (saldo Q${saldoAnterior.toFixed(2)}).`);
    }

    // 4) Validar suma componentes <= saldo
    const sumaComponentes = round2(input.componentes.reduce((s, c) => s + c.monto, 0));
    if (sumaComponentes - saldoAnterior > SALDO_TOLERANCIA) {
      return fail(nf, `Excede el saldo pendiente: cobro Q${sumaComponentes.toFixed(2)} > saldo Q${saldoAnterior.toFixed(2)}.`);
    }

    // 5) Grupo id único para correlacionar todos los records de este evento
    const grupoId = nuevoGrupoId(nf);

    // 6) Para CADA componente, distribuir su monto entre las N líneas activas.
    //    Distribución proporcional al total de la línea sobre el total de factura,
    //    residuo en la última línea para que la suma sea exacta.
    type CobroPlan = {
      facturaLineId: string;
      monto: number;
      componente: ComponenteCobro;
      componenteIdx: number;
    };
    const cobrosPlan: CobroPlan[] = [];
    input.componentes.forEach((c, cidx) => {
      let asignado = 0;
      lineas.forEach((l, i) => {
        let monto: number;
        if (i === lineas.length - 1) {
          monto = round2(c.monto - asignado);
        } else {
          // Proporción = totalLinea / totalFactura
          monto = round2((c.monto * l.total) / totalFactura);
          asignado += monto;
        }
        if (monto > 0) cobrosPlan.push({ facturaLineId: l.id, monto, componente: c, componenteIdx: cidx });
      });
    });

    // 7) Crear records (batch 10)
    const cobroFields = (p: CobroPlan) => {
      const c = p.componente;
      const isRet = esMetodoRetencion(c.metodo);
      return {
        fields: {
          [FC.FECHA]:        input.fecha,
          [FC.FACTURA]:      [p.facturaLineId],
          [FC.MONTO]:        p.monto,
          [FC.METODO]:       c.metodo,
          [FC.MONEDA]:       moneda,
          [FC.TIPO_CAMBIO]:  tipoCambio,
          [FC.ESTADO]:       'Pendiente',
          [FC.ESTADO_COBRO]: 'Activo',   // F-036
          [FC.GRUPO_ID]:     grupoId,
          ...(isRet ? {} : { [FC.CUENTA_BANCO]: [c.bancoId!] }),
          ...(c.referencia ? { [FC.REFERENCIA]: c.referencia.trim() } : {}),
          ...(c.metodo === 'Retención IVA' ? { [FC.RET_IVA]: p.monto } : {}),
          ...(c.metodo === 'Retención ISR' ? { [FC.RET_ISR]: p.monto } : {}),
        },
      };
    };

    const payloadCobros = cobrosPlan.map(cobroFields);
    const cobrosCreados: string[] = [];
    const lotesFallidos: number[] = [];
    // F-035.1: rastrear qué records corresponden a qué componente para subir
    // la constancia después al primero de cada uno.
    const componentesRecordIds: string[][] = input.componentes.map(() => []);
    for (let i = 0; i < payloadCobros.length; i += 10) {
      const lote = payloadCobros.slice(i, i + 10);
      const slicePlan = cobrosPlan.slice(i, i + 10);
      try {
        const res = await airtable(TABLES.COBROS).create(lote);
        res.forEach((rec, k) => {
          cobrosCreados.push(rec.id);
          componentesRecordIds[slicePlan[k].componenteIdx].push(rec.id);
        });
      } catch (err) {
        console.error('Error creando lote de cobros:', err);
        lotesFallidos.push(i);
      }
    }

    if (cobrosCreados.length === 0) {
      return fail(nf, 'No se pudo crear ningún record de cobro en COBROS_CLIENTES. La factura NO se actualizó.');
    }

    // 8) Saldo nuevo + estado destino
    const saldoNuevo  = round2(saldoAnterior - sumaComponentes);
    const liquidaTodo = saldoNuevo <= SALDO_TOLERANCIA;
    const estadoNuevo: 'COBRADO' | 'COBRADO PARCIAL' = liquidaTodo ? 'COBRADO' : 'COBRADO PARCIAL';
    // Valores EXACTOS del singleSelect (con espacio final)
    const estadoAirtable = liquidaTodo ? 'COBRADO ' : 'COBRADO PARCIAL ';

    // 9) Update ESTADO de todas las líneas activas
    const updates = activas.map(r => ({ id: r.id, fields: { [F.ESTADO]: estadoAirtable } }));
    const estadoActualizados: string[] = [];
    const estadoFallidos: string[] = [];
    for (let i = 0; i < updates.length; i += 10) {
      const lote = updates.slice(i, i + 10);
      try {
        const res = await airtable(TABLES.FACTURAS).update(lote);
        estadoActualizados.push(...res.map(r => r.id));
      } catch (err) {
        console.error('Error actualizando ESTADO:', err);
        estadoFallidos.push(...lote.map(p => p.id));
      }
    }

    // 10) Desglose
    const desglose = desgloseVacio();
    for (const c of input.componentes) {
      if (c.metodo === 'Transferencia') desglose.transferencia += c.monto;
      else if (c.metodo === 'Cheque')   desglose.cheque         += c.monto;
      else if (c.metodo === 'Efectivo') desglose.efectivo       += c.monto;
      else if (c.metodo === 'Tarjeta')  desglose.tarjeta        += c.monto;
      else if (c.metodo === 'Retención IVA') desglose.retencionIVA += c.monto;
      else if (c.metodo === 'Retención ISR') desglose.retencionISR += c.monto;
    }

    const ok = lotesFallidos.length === 0 && estadoFallidos.length === 0;
    return {
      ok,
      noFactura: nf,
      grupoId,
      totalCobrado: sumaComponentes,
      saldoAnterior,
      saldoNuevo,
      estadoNuevo,
      cobrosCreados: cobrosCreados.length,
      recordsActualizados: estadoActualizados.length,
      desglose,
      componentesRecordIds,
      fallidos: ok ? undefined : {
        cobrosLote: lotesFallidos.length > 0 ? lotesFallidos : undefined,
        estadoIds:  estadoFallidos.length > 0 ? estadoFallidos : undefined,
      },
      error: ok ? undefined : `Cobro parcial: ${cobrosCreados.length} cobro(s) creado(s), ${estadoActualizados.length}/${activas.length} líneas actualizadas. Revisá Airtable.`,
    };
  } catch (err) {
    return fail(nf, err instanceof Error ? err.message : String(err));
  }
}

function fail(noFactura: string, error: string): RegistrarCobroResult {
  return {
    ok: false,
    noFactura,
    grupoId: '',
    totalCobrado: 0,
    saldoAnterior: 0,
    saldoNuevo: 0,
    estadoNuevo: '',
    cobrosCreados: 0,
    recordsActualizados: 0,
    desglose: desgloseVacio(),
    componentesRecordIds: [],
    error,
  };
}

/* ============================================================
 * F-035: cobros agrupados por Cobro_Grupo_ID (un evento de cobro)
 * ============================================================ */

export interface ComponenteCobroLeido {
  recordId: string;
  metodo: string;
  monto: number;
  bancoNombre: string | null;
  bancoId: string | null;
  referencia: string;
  retencionIVA: number;
  retencionISR: number;
  constanciaUrl?: string;
  constanciaNombre?: string;
}

export interface GrupoCobro {
  grupoId: string;           // 'G-...' o '__legacy__<recordId>' para cobros viejos sin grupo
  fecha: string;
  noFactura: string;
  totalCobrado: number;      // suma Monto_Cobrado de los componentes
  totalRetencionIVA: number;
  totalRetencionISR: number;
  componentes: ComponenteCobroLeido[];
  tieneRetencion: boolean;
  // F-036.
  estadoCobro: 'Activo' | 'Anulado';
  fechaAnulacion?: string;
  motivoAnulacion?: string;
  anuladoPor?: string;
}

const FC_FULL = {
  ...FC_READ,
  CONST:     'Constancia_Retencion',
} as const;

export async function getCobrosDeFactura(noFactura: string): Promise<GrupoCobro[]> {
  if (!airtable) return [];
  const nf = (noFactura ?? '').trim();
  if (!nf) return [];
  const esc = nf.replace(/"/g, '\\"');
  try {
    const [records, bancos] = await Promise.all([
      airtable(TABLES.COBROS)
        .select({
          filterByFormula: `{${FC_FULL.NO_FACTURA}} = "${esc}"`,
          sort: [{ field: FC_FULL.FECHA, direction: 'desc' }],
        })
        .all(),
      getBancos(),
    ]);
    const bancoNombreById = new Map(bancos.map(b => [b.id, b.nombreCuenta || b.banco || b.id]));

    // Agrupar por Cobro_Grupo_ID; cobros viejos sin grupo se tratan como singleton.
    type Row = { id: string; fields: Record<string, unknown> };
    const grupos = new Map<string, { fecha: string; nf: string; rows: Row[] }>();
    for (const r of records) {
      const row: Row = { id: r.id, fields: r.fields as Record<string, unknown> };
      const gid = String(row.fields[FC_FULL.GRUPO_ID] ?? '').trim();
      const fecha = String(row.fields[FC_FULL.FECHA] ?? '');
      const key = gid || `__legacy__${row.id}`;
      const bucket = grupos.get(key) ?? { fecha, nf, rows: [] as Row[] };
      bucket.rows.push(row);
      // mantener la fecha más temprana del grupo (más confiable que la primera)
      if (!bucket.fecha || (fecha && fecha < bucket.fecha)) bucket.fecha = fecha;
      grupos.set(key, bucket);
    }

    const out: GrupoCobro[] = [];
    for (const [grupoId, bucket] of grupos) {
      const componentes: ComponenteCobroLeido[] = bucket.rows.map(r => {
        const f = r.fields as Record<string, unknown>;
        const bancoId = Array.isArray(f[FC_FULL.CUENTA_BANCO])
          ? String((f[FC_FULL.CUENTA_BANCO] as unknown[])[0] ?? '')
          : '';
        const attach = Array.isArray(f[FC_FULL.CONST])
          ? (f[FC_FULL.CONST] as Array<{ url?: string; filename?: string }>)[0]
          : undefined;
        return {
          recordId:    r.id,
          metodo:      String(f[FC_FULL.METODO] ?? ''),
          monto:       Number(f[FC_FULL.MONTO] ?? 0),
          bancoId:     bancoId || null,
          bancoNombre: bancoId ? (bancoNombreById.get(bancoId) ?? bancoId) : null,
          referencia:  String(f[FC_FULL.REFERENCIA] ?? ''),
          retencionIVA: Number(f[FC_FULL.RET_IVA] ?? 0),
          retencionISR: Number(f[FC_FULL.RET_ISR] ?? 0),
          constanciaUrl:    attach?.url,
          constanciaNombre: attach?.filename,
        };
      });
      const totalCobrado    = componentes.reduce((s, c) => s + c.monto, 0);
      const totalRetIVA     = componentes.reduce((s, c) => s + c.retencionIVA, 0);
      const totalRetISR     = componentes.reduce((s, c) => s + c.retencionISR, 0);
      // F-036: grupo anulado = TODOS los records anulados.
      const todosAnulados = bucket.rows.every(r => !esCobroActivoFields(r.fields));
      const algunAnulado  = bucket.rows.find(r => !esCobroActivoFields(r.fields));
      out.push({
        grupoId,
        fecha: bucket.fecha,
        noFactura: nf,
        totalCobrado,
        totalRetencionIVA: totalRetIVA,
        totalRetencionISR: totalRetISR,
        componentes,
        tieneRetencion: totalRetIVA > 0 || totalRetISR > 0,
        estadoCobro: todosAnulados ? 'Anulado' : 'Activo',
        fechaAnulacion:  algunAnulado ? String(algunAnulado.fields[FC_FULL.FECHA_ANULACION] ?? '') || undefined : undefined,
        motivoAnulacion: algunAnulado ? String(algunAnulado.fields[FC_FULL.MOTIVO_ANULACION] ?? '') || undefined : undefined,
        anuladoPor:      algunAnulado ? String(algunAnulado.fields[FC_FULL.ANULADO_POR] ?? '') || undefined : undefined,
      });
    }
    out.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    return out;
  } catch (err) {
    console.error('Error leyendo cobros de factura:', err);
    return [];
  }
}

/* ============================================================
 * F-035: lectura del saldo pendiente para mostrar en el modal
 * ============================================================ */

export interface SaldoFactura {
  noFactura: string;
  totalFactura: number;
  cobradoPrevio: number;
  saldoPendiente: number;
  estado: string;
}

export async function getSaldoPendiente(noFactura: string): Promise<SaldoFactura | null> {
  if (!airtable) return null;
  const nf = (noFactura ?? '').trim();
  if (!nf) return null;
  const esc = nf.replace(/"/g, '\\"');
  try {
    const [facturaRecords, cobrosRecords] = await Promise.all([
      airtable(TABLES.FACTURAS)
        .select({ filterByFormula: `{${F.NO_FACTURA}} = "${esc}"`, maxRecords: 100 })
        .all(),
      airtable(TABLES.COBROS)
        .select({ filterByFormula: `{${FC_READ.NO_FACTURA}} = "${esc}"`, fields: [FC_READ.MONTO, FC_READ.ESTADO_COBRO] })
        .all(),
    ]);
    if (facturaRecords.length === 0) return null;
    const activas = facturaRecords.filter(r => {
      const e = estadoCanon(r.fields[F.ESTADO]);
      return e !== 'ANULADO' && e !== 'ANULADA' && e !== 'REFACTURADO' && e !== 'REFACTURADA';
    });
    if (activas.length === 0) return null;
    const totalFactura = round2(activas.reduce((s, r) => s + Number(r.fields[F.TOTAL] ?? 0), 0));
    // F-036: solo cobros ACTIVOS reducen el saldo.
    const cobradoPrevio = round2(
      cobrosRecords
        .filter(r => esCobroActivoFields(r.fields as Record<string, unknown>))
        .reduce((s, r) => s + Number((r.fields as Record<string, unknown>)[FC_READ.MONTO] ?? 0), 0)
    );
    const saldoPendiente = round2(Math.max(0, totalFactura - cobradoPrevio));
    // Estado consolidado: si alguna línea está COBRADO PARCIAL gana sobre EMITIDA/PENDIENTE
    const estados = activas.map(r => estadoCanon(r.fields[F.ESTADO]));
    const estado = estados.includes('COBRADO PARCIAL') ? 'COBRADO PARCIAL'
                 : estados.includes('PENDIENTE')       ? 'PENDIENTE'
                 : estados.includes('EMITIDA')         ? 'EMITIDA'
                 : estados[0] ?? '';
    return { noFactura: nf, totalFactura, cobradoPrevio, saldoPendiente, estado };
  } catch (err) {
    console.error('Error leyendo saldo pendiente:', err);
    return null;
  }
}

/* ============================================================
 * F-036: anular un cobro (todos los records con Cobro_Grupo_ID=grupoId)
 * y recomputar el saldo + ESTADO de la factura asociada.
 *
 * NUNCA elimina records — solo marca Estado_Cobro=Anulado con motivo,
 * fecha y email del usuario. Recalcula desde cero los cobros ACTIVOS
 * restantes y reasigna el ESTADO de las líneas de la factura.
 * ============================================================ */

export interface AnularCobroResult {
  ok: boolean;
  grupoId: string;
  noFactura: string;
  cobrosAnulados: number;
  saldoAnterior: number;
  saldoNuevo: number;
  estadoNuevo: 'EMITIDA' | 'COBRADO PARCIAL' | 'COBRADO' | '';
  error?: string;
}

export async function anularCobro(grupoId: string, motivo: string, usuarioEmail: string): Promise<AnularCobroResult> {
  const empty = (error: string): AnularCobroResult => ({
    ok: false, grupoId, noFactura: '', cobrosAnulados: 0,
    saldoAnterior: 0, saldoNuevo: 0, estadoNuevo: '', error,
  });

  if (!airtable) return empty('Airtable no está configurado.');
  if (!grupoId?.trim()) return empty('grupoId requerido.');
  if (!motivo?.trim())  return empty('El motivo de anulación es requerido.');
  if (grupoId.startsWith('__legacy__')) {
    // Cobros pre-F-035 (sin grupo real). Soportamos anular UN record por id.
    // Caller debe pasar el recordId real, no el alias legacy.
    return empty('Cobro legacy: pasar el recordId concreto en vez del alias __legacy__.');
  }

  try {
    // 1) Records del grupo
    const esc = grupoId.replace(/"/g, '\\"');
    const records = await airtable(TABLES.COBROS)
      .select({ filterByFormula: `{${FC_READ.GRUPO_ID}} = "${esc}"` })
      .all();
    if (records.length === 0) return empty(`No se encontraron cobros con grupo ${grupoId}.`);

    // Detectar la factura (NO.FACTURA es lookup; usamos el linked record Factura Cliente).
    const facturaIds = new Set<string>();
    let noFactura = '';
    for (const r of records) {
      const linked = r.fields[FC_READ.FACTURA];
      if (Array.isArray(linked)) for (const id of linked) facturaIds.add(String(id));
      if (!noFactura) {
        const lookup = r.fields[FC_READ.NO_FACTURA];
        if (Array.isArray(lookup)) noFactura = String(lookup[0] ?? '');
      }
    }
    if (facturaIds.size === 0 || !noFactura) {
      return empty('No se pudo identificar la factura asociada al grupo de cobros.');
    }

    // Si TODOS los records ya están anulados, no hay nada que hacer.
    const yaAnulados = records.every(r => !esCobroActivoFields(r.fields as Record<string, unknown>));
    if (yaAnulados) return empty('El cobro ya estaba anulado.');

    // 2) Marcar como Anulado
    const hoy = new Date().toISOString().slice(0, 10);
    const updates = records.map(r => ({
      id: r.id,
      fields: {
        [FC.ESTADO_COBRO]:     'Anulado',
        [FC.FECHA_ANULACION]:  hoy,
        [FC.MOTIVO_ANULACION]: motivo.trim(),
        [FC.ANULADO_POR]:      (usuarioEmail ?? '').trim() || 'sistema',
      },
    }));
    const anulados: string[] = [];
    for (let i = 0; i < updates.length; i += 10) {
      const lote = updates.slice(i, i + 10);
      const res = await airtable(TABLES.COBROS).update(lote);
      anulados.push(...res.map(r => r.id));
    }

    // 3) Traer TODAS las líneas activas de la factura para recalcular saldo + ESTADO.
    const escNF = noFactura.replace(/"/g, '\\"');
    const [facturaRecords, todosCobros] = await Promise.all([
      airtable(TABLES.FACTURAS)
        .select({ filterByFormula: `{${F.NO_FACTURA}} = "${escNF}"`, maxRecords: 100 })
        .all(),
      airtable(TABLES.COBROS)
        .select({
          filterByFormula: `{${FC_READ.NO_FACTURA}} = "${escNF}"`,
          fields: [FC_READ.MONTO, FC_READ.ESTADO_COBRO],
        })
        .all(),
    ]);
    const lineasActivas = facturaRecords.filter(r => {
      const e = estadoCanon(r.fields[F.ESTADO]);
      return e !== 'ANULADO' && e !== 'ANULADA' && e !== 'REFACTURADO' && e !== 'REFACTURADA';
    });
    if (lineasActivas.length === 0) {
      return {
        ok: true, grupoId, noFactura,
        cobrosAnulados: anulados.length,
        saldoAnterior: 0, saldoNuevo: 0, estadoNuevo: '',
      };
    }

    const totalFactura = round2(lineasActivas.reduce((s, r) => s + Number(r.fields[F.TOTAL] ?? 0), 0));
    const cobradoActivo = round2(
      todosCobros
        .filter(r => esCobroActivoFields(r.fields as Record<string, unknown>))
        .reduce((s, r) => s + Number((r.fields as Record<string, unknown>)[FC_READ.MONTO] ?? 0), 0)
    );
    const saldoNuevo = round2(Math.max(0, totalFactura - cobradoActivo));
    const saldoAnterior = round2(saldoNuevo + records.reduce((s, r) => s + Number((r.fields as Record<string, unknown>)[FC_READ.MONTO] ?? 0), 0));

    // 4) Estado destino. Si no quedó nada cobrado, volvemos a EMITIDA (no recuperamos
    //    PENDIENTE original — ese estado se decide aparte por flujo interno y es raro).
    let estadoNuevo: 'EMITIDA' | 'COBRADO PARCIAL' | 'COBRADO' = 'EMITIDA';
    let estadoAirtable = 'EMITIDA';
    if (saldoNuevo <= SALDO_TOLERANCIA) {
      estadoNuevo = 'COBRADO';
      estadoAirtable = 'COBRADO ';
    } else if (cobradoActivo > 0) {
      estadoNuevo = 'COBRADO PARCIAL';
      estadoAirtable = 'COBRADO PARCIAL ';
    } else {
      estadoNuevo = 'EMITIDA';
      estadoAirtable = 'EMITIDA';
    }

    // 5) Update ESTADO de todas las líneas activas
    const facturaUpdates = lineasActivas.map(r => ({ id: r.id, fields: { [F.ESTADO]: estadoAirtable } }));
    for (let i = 0; i < facturaUpdates.length; i += 10) {
      const lote = facturaUpdates.slice(i, i + 10);
      await airtable(TABLES.FACTURAS).update(lote);
    }

    return {
      ok: true,
      grupoId,
      noFactura,
      cobrosAnulados: anulados.length,
      saldoAnterior,
      saldoNuevo,
      estadoNuevo,
    };
  } catch (err) {
    return empty(err instanceof Error ? err.message : String(err));
  }
}

/** F-036: para cobros legacy (sin Cobro_Grupo_ID, hechos pre-F-035), aceptamos
 *  anular por recordId. Misma lógica de recompute. */
export async function anularCobroLegacy(recordId: string, motivo: string, usuarioEmail: string): Promise<AnularCobroResult> {
  const empty = (error: string): AnularCobroResult => ({
    ok: false, grupoId: `__legacy__${recordId}`, noFactura: '', cobrosAnulados: 0,
    saldoAnterior: 0, saldoNuevo: 0, estadoNuevo: '', error,
  });
  if (!airtable) return empty('Airtable no está configurado.');
  if (!recordId) return empty('recordId requerido.');
  if (!motivo?.trim()) return empty('Motivo requerido.');

  try {
    const record = await airtable(TABLES.COBROS).find(recordId);
    if (!esCobroActivoFields(record.fields as Record<string, unknown>)) {
      return empty('El cobro ya estaba anulado.');
    }
    const linked = record.fields[FC_READ.FACTURA];
    const noFLookup = record.fields[FC_READ.NO_FACTURA];
    const noFactura = Array.isArray(noFLookup) ? String(noFLookup[0] ?? '') : '';
    if (!Array.isArray(linked) || !noFactura) return empty('Cobro sin factura asociada.');

    const hoy = new Date().toISOString().slice(0, 10);
    await airtable(TABLES.COBROS).update([{
      id: recordId,
      fields: {
        [FC.ESTADO_COBRO]:     'Anulado',
        [FC.FECHA_ANULACION]:  hoy,
        [FC.MOTIVO_ANULACION]: motivo.trim(),
        [FC.ANULADO_POR]:      (usuarioEmail ?? '').trim() || 'sistema',
      },
    }]);

    // Reusar la lógica de recompute manualmente
    const escNF = noFactura.replace(/"/g, '\\"');
    const [facturaRecords, todosCobros] = await Promise.all([
      airtable(TABLES.FACTURAS).select({ filterByFormula: `{${F.NO_FACTURA}} = "${escNF}"`, maxRecords: 100 }).all(),
      airtable(TABLES.COBROS).select({ filterByFormula: `{${FC_READ.NO_FACTURA}} = "${escNF}"`, fields: [FC_READ.MONTO, FC_READ.ESTADO_COBRO] }).all(),
    ]);
    const lineasActivas = facturaRecords.filter(r => {
      const e = estadoCanon(r.fields[F.ESTADO]);
      return e !== 'ANULADO' && e !== 'ANULADA' && e !== 'REFACTURADO' && e !== 'REFACTURADA';
    });
    const totalFactura = round2(lineasActivas.reduce((s, r) => s + Number(r.fields[F.TOTAL] ?? 0), 0));
    const cobradoActivo = round2(
      todosCobros
        .filter(r => esCobroActivoFields(r.fields as Record<string, unknown>))
        .reduce((s, r) => s + Number((r.fields as Record<string, unknown>)[FC_READ.MONTO] ?? 0), 0)
    );
    const saldoNuevo = round2(Math.max(0, totalFactura - cobradoActivo));
    const montoAnulado = Number(record.fields[FC_READ.MONTO] ?? 0);
    const saldoAnterior = round2(saldoNuevo + montoAnulado);

    let estadoNuevo: 'EMITIDA' | 'COBRADO PARCIAL' | 'COBRADO' = 'EMITIDA';
    let estadoAirtable = 'EMITIDA';
    if (saldoNuevo <= SALDO_TOLERANCIA) { estadoNuevo = 'COBRADO'; estadoAirtable = 'COBRADO '; }
    else if (cobradoActivo > 0)         { estadoNuevo = 'COBRADO PARCIAL'; estadoAirtable = 'COBRADO PARCIAL '; }

    const facturaUpdates = lineasActivas.map(r => ({ id: r.id, fields: { [F.ESTADO]: estadoAirtable } }));
    for (let i = 0; i < facturaUpdates.length; i += 10) {
      await airtable(TABLES.FACTURAS).update(facturaUpdates.slice(i, i + 10));
    }

    return {
      ok: true,
      grupoId: `__legacy__${recordId}`,
      noFactura,
      cobrosAnulados: 1,
      saldoAnterior,
      saldoNuevo,
      estadoNuevo,
    };
  } catch (err) {
    return empty(err instanceof Error ? err.message : String(err));
  }
}

/* ============================================================
 * F-036: contar cobros activos de una factura (para bloquear anulación)
 * ============================================================ */

export interface CobrosActivosCheck {
  numCobrosActivos: number;    // grupos
  numRecordsActivos: number;
  montoTotalActivo: number;
}

export async function contarCobrosActivosDeFactura(noFactura: string): Promise<CobrosActivosCheck> {
  const empty = { numCobrosActivos: 0, numRecordsActivos: 0, montoTotalActivo: 0 };
  if (!airtable) return empty;
  const nf = (noFactura ?? '').trim();
  if (!nf) return empty;
  try {
    const esc = nf.replace(/"/g, '\\"');
    const records = await airtable(TABLES.COBROS)
      .select({
        filterByFormula: `{${FC_READ.NO_FACTURA}} = "${esc}"`,
        fields: [FC_READ.MONTO, FC_READ.ESTADO_COBRO, FC_READ.GRUPO_ID],
      })
      .all();
    const activos = records.filter(r => esCobroActivoFields(r.fields as Record<string, unknown>));
    const grupos = new Set<string>();
    let monto = 0;
    for (const r of activos) {
      const f = r.fields as Record<string, unknown>;
      const g = String(f[FC_READ.GRUPO_ID] ?? '').trim() || `__legacy__${r.id}`;
      grupos.add(g);
      monto += Number(f[FC_READ.MONTO] ?? 0);
    }
    return {
      numCobrosActivos: grupos.size,
      numRecordsActivos: activos.length,
      montoTotalActivo: round2(monto),
    };
  } catch (err) {
    console.error('Error contando cobros activos:', err);
    return empty;
  }
}
