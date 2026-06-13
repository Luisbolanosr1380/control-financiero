// ============================================================
// Módulo de Deudas y Pasivos (F-027)
// Lee DEUDAS (134 records) y ACREEDORES (18). Stock del momento.
// JOINs en código (Airtable no expone lookup name del acreedor en DEUDAS).
// ============================================================

import { airtable, USE_MOCK, TABLES } from './airtable';
import { obtenerFechaHoyGuatemala } from '../utils/fechas';

const FA = {
  NOMBRE:           'Nombre_Acreedor',           // formula
  NOMBRE_LEGAL:     'Acreedor_Nombre_Legal',
  TIPO_PRODUCTO:    'Tipo Producto',
  TIPO_ACREEDOR:    'Tipo_Acreedor',
  ES_RELACIONADA:   'Es_Parte_Relacionada',
  TOTAL_INICIAL:    'Total_Deuda_Inicial',       // rollup
  MONEDA:           'Moneda',
  ESTATUS:          'Estatus',
  CUENTA_NOMBRE:    'NOMBRE (from Cuenta_Contable)',
  NOTAS:            'Notas',
} as const;

const FD = {
  CLAVE:              'Clave_Deuda',               // formula
  ACREEDOR:           'Acreedor',                  // link
  NOMBRE_DEUDA:       'Nombre_Deuda / Código',
  TIPO_DOC:           'Tipo_Documento',
  ESTADO:             'Estado',
  ESTADO_DEUDA:       'Estado_Deuda',              // formula
  FECHA_EMI:          'Fecha_Emision',
  FECHA_DESEMBOLSO:   'Fecha_Desembolso',
  FECHA_PRIMER_CUOTA: 'Fecha_Primer_Cuota',
  PLAZO_MESES:        'Plazo_Meses',
  FECHA_VENC:         'Fecha_Vencimiento',
  FECHA_VENC_REAL:    'Fecha_Vencimiento_Real',    // formula
  DIAS_VENCER:        'Dias_a_Vencer',             // formula
  VENCIDA:            'Vencida?',                  // formula 0/1
  MONEDA:             'Moneda',
  TIPO_CAMBIO:        'Tipo_Cambio',
  MONTO_ORIG:         'Monto_Original',
  IVA:                'IVA',
  MONTO_GTQ:          'Monto_GTQ',                 // formula
  TOTAL_PAGADO:       'Total_Pagado',              // rollup
  SALDO:              'Saldo_Pendiente',           // formula
  CENTRO_COSTO:       'Centro_Costo',              // link
  TASA_INTERES:       'Tasa_Interes',
  INTERES_ANUAL:      'Interes_Anual_%',
  INTERES_MORA:       'Interes_Mora_%',
  TASA_COMISION:      'Tasa_Comision_%',
  IVA_COMISION:       'IVA_Comision_%',
  RESERVA:            'Reserva_%',
  DIA_PAGO_FIJO:      'Dia_Pago_Fijo',
  VENTANA_ALERTA:     'Ventana_Alerta_Dias',
  CON_RECURSO:        'Con_Recurso',
  SERIE:              'Serie',
  NUMERO:             'Numero',
  PCT_AVANCE:         '%_Avance',                  // formula
  DIAS_MORA:          'Dias_en_Mora',              // formula
  SEMAFORO:           'Semaforo_Vencimiento',      // formula con emoji
  MORA_ACUM:          'Mora_Acumulada',            // formula
  NUM_PAGOS:          'Num_Pagos',                 // rollup
  NOTAS:              'Notas',
  NO_INCLUIR:         'No Incluir',                // checkbox
  // F-BF-001: lookup multipleLookupValues con el alias corto del acreedor
  // (field ID fldGD0nqcu1STO815). Viene como array de strings.
  ACREEDOR_CORTO:     'Acreedor_Corto',
} as const;

// ============================================================
// Tipos públicos
// ============================================================

export interface Acreedor {
  id: string;
  nombre: string;                  // formula Nombre_Acreedor
  nombreLegal: string;
  tipoProducto: string;
  tipoAcreedor: string;
  esParteRelacionada: boolean;
  totalDeudaInicial: number;
  moneda: string;
  estatus: string;
  cuentaContable: string;
  notas: string;
}

/**
 * Categoría derivada del pasivo (4 buckets), pensada para distinguir la
 * naturaleza legal/operativa de la obligación. Mapea desde Tipo_Acreedor
 * + Es_Parte_Relacionada del acreedor:
 *  - 'socios'                → Tipo_Acreedor === 'Socio' OR Es_Parte_Relacionada === true
 *  - 'ex_empleados'          → Tipo_Acreedor === 'Ex-Empleado'
 *  - 'asesores_relacionados' → Tipo_Acreedor === 'Asesor Relacionado'
 *  - 'externa'               → el resto (bancos, fisco, tarjetas, proveedores).
 */
// F-037: 5ta categoría 'empleados' para salarios diferidos a empleados ACTIVOS.
// Ex-empleados es distinta (riesgo reputacional al ya no estar en la empresa).
export type CategoriaPasivo = 'externa' | 'socios' | 'empleados' | 'ex_empleados' | 'asesores_relacionados';

export const CATEGORIAS_PASIVO: readonly CategoriaPasivo[] = ['externa', 'socios', 'empleados', 'ex_empleados', 'asesores_relacionados'];

export function clasificarPasivo(tipoAcreedor: string, esParteRelacionada: boolean): CategoriaPasivo {
  if (tipoAcreedor === 'Socio' || esParteRelacionada) return 'socios';
  if (tipoAcreedor === 'Empleado')                   return 'empleados';     // F-037
  if (tipoAcreedor === 'Ex-Empleado')                return 'ex_empleados';
  if (tipoAcreedor === 'Asesor Relacionado')         return 'asesores_relacionados';
  return 'externa';
}

export interface Deuda {
  id: string;
  claveDeuda: string;
  nombreDeuda: string;
  acreedorId: string;
  acreedorNombre: string;
  /** F-BF-001: alias corto del acreedor (lookup `Acreedor_Corto`). Se usa
   * como segunda línea en el listado de /deudas para distinguir entre N
   * deudas del mismo acreedor. Cae a `acreedorNombre` si el lookup viene
   * vacío. */
  acreedorCorto: string;
  tipoAcreedor: string;
  esParteRelacionada: boolean;
  categoriaPasivo: CategoriaPasivo;
  tipoDocumento: string;
  centroCostoId: string;
  centroCostoNombre: string;
  estado: string;
  estadoDeuda: string;
  fechaEmision: string;
  fechaVencimiento: string;
  fechaVencimientoReal: string;
  diasAVencer: number;
  vencida: boolean;
  moneda: string;
  montoOriginal: number;
  montoGTQ: number;
  saldoPendiente: number;
  totalPagado: number;
  pctAvance: number;                // 0-100
  tasaInteres: number;              // 0-1 (Airtable percent)
  diasEnMora: number;
  semaforoVencimiento: string;
  moraAcumulada: number;
  numPagos: number;
  notas: string;
}

export interface DeudasFiltros {
  estado?: string;                  // singleSelect crudo, p.ej. "Pendiente"
  tipoDocumento?: string;
  acreedorId?: string;
  centroCostoId?: string;
  vencidasOnly?: boolean;
  categoria?: CategoriaPasivo;      // filtro nuevo (reemplaza soloSocios/soloExternas)
  /** @deprecated usar categoria='socios' */  soloSocios?: boolean;
  /** @deprecated usar categoria='externa' */ soloExternas?: boolean;
}

export interface KPIsDeudas {
  totalPasivo: number;
  porCategoria: Record<CategoriaPasivo, { monto: number; cantidad: number }>;
  vencidas: {
    cantidad: number;
    montoTotal: number;
    diasPromedioMora: number;
    deudaMasAntigua: number;
  };
  proximosVencimientos: { cantidad: number; montoTotal: number };
  porTipo: Array<{ tipo: string; saldo: number; cantidad: number }>;
  porAcreedor: Array<{ acreedor: string; saldo: number; categoria: CategoriaPasivo }>;
}

// ============================================================
// Helpers raw → tipado
// ============================================================

type AirRecord = { id: string; fields: Record<string, unknown> };

const arrFirst = (v: unknown): string => Array.isArray(v) ? String(v[0] ?? '') : '';
const arrFirstName = (v: unknown): string => {
  if (Array.isArray(v) && v[0]) {
    const x = v[0] as unknown;
    if (typeof x === 'object' && x !== null && 'name' in x) return String((x as { name: unknown }).name ?? '');
    return String(x ?? '');
  }
  return '';
};
const selectName = (v: unknown): string => {
  if (v && typeof v === 'object' && 'name' in (v as object)) return String((v as { name: unknown }).name ?? '');
  return typeof v === 'string' ? v : '';
};
const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => v == null ? '' : String(v);
const bool = (v: unknown): boolean => v === true || v === 1 || v === '1';

function acreedorFromRecord(r: AirRecord): Acreedor {
  const f = r.fields;
  // cuenta contable: lookup multipleLookupValues devuelve string[] o {linkedRecordIds, valuesByLinkedRecordId}
  let cuenta = '';
  const cv = f[FA.CUENTA_NOMBRE];
  if (Array.isArray(cv) && cv.length) cuenta = String(cv[0] ?? '');
  else if (typeof cv === 'string') cuenta = cv;
  else if (cv && typeof cv === 'object' && 'valuesByLinkedRecordId' in cv) {
    const vbr = (cv as { valuesByLinkedRecordId: Record<string, unknown> }).valuesByLinkedRecordId;
    const first = Object.values(vbr)[0];
    if (Array.isArray(first) && first[0]) cuenta = String(first[0] ?? '');
  }
  return {
    id: r.id,
    nombre:              str(f[FA.NOMBRE]),
    nombreLegal:         str(f[FA.NOMBRE_LEGAL]),
    tipoProducto:        selectName(f[FA.TIPO_PRODUCTO]),
    tipoAcreedor:        selectName(f[FA.TIPO_ACREEDOR]),
    esParteRelacionada:  bool(f[FA.ES_RELACIONADA]),
    totalDeudaInicial:   num(f[FA.TOTAL_INICIAL]),
    moneda:              selectName(f[FA.MONEDA]),
    estatus:             selectName(f[FA.ESTATUS]),
    cuentaContable:      cuenta,
    notas:               str(f[FA.NOTAS]),
  };
}

function deudaFromRecord(
  r: AirRecord,
  acreedoresById: Map<string, Acreedor>,
  centrosById: Map<string, string>,
): Deuda {
  const f = r.fields;
  const acreedorId = arrFirst(f[FD.ACREEDOR]);
  const ac = acreedoresById.get(acreedorId);
  const centroId = arrFirst(f[FD.CENTRO_COSTO]);

  const montoOriginal = num(f[FD.MONTO_ORIG]);
  const totalPagado   = num(f[FD.TOTAL_PAGADO]);
  const saldo         = num(f[FD.SALDO]);
  const pctAvanceRaw  = num(f[FD.PCT_AVANCE]);

  const tipoAcreedor = ac?.tipoAcreedor ?? '';
  const esParteRelacionada = ac?.esParteRelacionada ?? false;

  return {
    id:                  r.id,
    claveDeuda:          str(f[FD.CLAVE]),
    nombreDeuda:         str(f[FD.NOMBRE_DEUDA]),
    acreedorId,
    acreedorNombre:      ac?.nombre ?? arrFirstName(f[FD.ACREEDOR]),
    acreedorCorto:       arrFirstName(f[FD.ACREEDOR_CORTO]) || (ac?.nombre ?? arrFirstName(f[FD.ACREEDOR])),
    tipoAcreedor,
    esParteRelacionada,
    categoriaPasivo:     clasificarPasivo(tipoAcreedor, esParteRelacionada),
    tipoDocumento:       selectName(f[FD.TIPO_DOC]),
    centroCostoId:       centroId,
    centroCostoNombre:   centrosById.get(centroId) ?? arrFirstName(f[FD.CENTRO_COSTO]),
    estado:              selectName(f[FD.ESTADO]),
    estadoDeuda:         str(f[FD.ESTADO_DEUDA]),
    fechaEmision:        str(f[FD.FECHA_EMI]),
    fechaVencimiento:    str(f[FD.FECHA_VENC]),
    fechaVencimientoReal: str(f[FD.FECHA_VENC_REAL]),
    diasAVencer:         num(f[FD.DIAS_VENCER]),
    vencida:             num(f[FD.VENCIDA]) === 1,
    moneda:              selectName(f[FD.MONEDA]),
    montoOriginal,
    montoGTQ:            num(f[FD.MONTO_GTQ]),
    saldoPendiente:      saldo,
    totalPagado,
    // %_Avance viene como ratio 0–1 en algunas formulas; lo normalizo a 0–100
    pctAvance:           pctAvanceRaw > 1 ? pctAvanceRaw : pctAvanceRaw * 100,
    tasaInteres:         num(f[FD.TASA_INTERES]),
    diasEnMora:          num(f[FD.DIAS_MORA]),
    semaforoVencimiento: str(f[FD.SEMAFORO]),
    moraAcumulada:       num(f[FD.MORA_ACUM]),
    numPagos:            num(f[FD.NUM_PAGOS]),
    notas:               str(f[FD.NOTAS]),
  };
}

// ============================================================
// Loaders bases (cache de centros para el JOIN)
// ============================================================

let _centrosCache: Map<string, string> | null = null;
async function getCentrosNombreById(): Promise<Map<string, string>> {
  if (_centrosCache) return _centrosCache;
  if (USE_MOCK || !airtable) return new Map();
  // F-BF-004: sin maxRecords — `.all()` agota la paginación interna del SDK
  // (pageSize 100 hasta vaciar offsets). Hardcaps silenciosos truncan a medida
  // que las tablas crecen sin error visible.
  const recs = await airtable(TABLES.CENTROS_COSTO)
    .select({ fields: ['NOMBRE'] })
    .all();
  _centrosCache = new Map(recs.map(r => [r.id, String(r.fields.NOMBRE ?? '')]));
  return _centrosCache;
}

// ============================================================
// API pública
// ============================================================

export async function getAcreedores(): Promise<Acreedor[]> {
  if (USE_MOCK || !airtable) return [];
  try {
    // F-BF-004: sin maxRecords — paginación completa.
    const recs = await airtable(TABLES.ACREEDORES).select().all();
    return recs.map(r => acreedorFromRecord({ id: r.id, fields: r.fields as Record<string, unknown> }));
  } catch (err) {
    console.error('Error fetching acreedores:', err);
    return [];
  }
}

/**
 * Mapa deudaId → suma de Monto_Pago de PAGOS_PROVEEDORES vinculados.
 * Lo calculamos en código porque el rollup Total_Pagado de Airtable
 * no está sumando correctamente (verificado en smoke F-028). El rollup
 * Num_Pagos sí cuenta records bien, pero el de monto está mal apuntado.
 * Esto nos vuelve independientes de la configuración del rollup.
 */
async function getTotalPagadoPorDeuda(): Promise<Map<string, { suma: number; count: number }>> {
  if (USE_MOCK || !airtable) return new Map();
  try {
    // F-BF-004: sin maxRecords — PAGOS_PROVEEDORES crece con cada cuota
    // pagada (hipoteca = 240 cuotas en 1 ingreso), un cap de 5000 es una
    // bomba de tiempo silenciosa.
    const recs = await airtable(TABLES.PAGOS_PROVEEDORES)
      .select({ fields: ['Deuda', 'Monto_Pago'] })
      .all();
    const m = new Map<string, { suma: number; count: number }>();
    for (const r of recs) {
      const f = r.fields as Record<string, unknown>;
      const deudaIds = Array.isArray(f.Deuda) ? f.Deuda as string[] : [];
      const monto = Number(f.Monto_Pago ?? 0);
      for (const id of deudaIds) {
        const e = m.get(id) ?? { suma: 0, count: 0 };
        e.suma += monto;
        e.count += 1;
        m.set(id, e);
      }
    }
    return m;
  } catch {
    return new Map();
  }
}

export async function getDeudas(filtros: DeudasFiltros = {}): Promise<Deuda[]> {
  if (USE_MOCK || !airtable) return [];
  try {
    // F-BF-004:
    //  · Sin maxRecords — paginación completa de DEUDAS. El cap de 500
    //    estaba truncando silenciosamente con la incorporación de 240
    //    cuotas de hipoteca (134 → 374+ y subiendo).
    //  · Empujamos el filtro `No Incluir != TRUE()` al servidor para
    //    reducir volumen transferido (las cuotas históricas pagadas se
    //    marcan así). El filtro JS posterior queda como red de seguridad.
    const [recs, acreedores, centrosById, pagadosPorDeuda] = await Promise.all([
      airtable(TABLES.DEUDAS)
        .select({ filterByFormula: `OR({${FD.NO_INCLUIR}} = FALSE(), {${FD.NO_INCLUIR}} = BLANK())` })
        .all(),
      getAcreedores(),
      getCentrosNombreById(),
      getTotalPagadoPorDeuda(),
    ]);
    const acreedoresById = new Map(acreedores.map(a => [a.id, a]));

    let deudas = recs
      .filter(r => !bool((r.fields as Record<string, unknown>)[FD.NO_INCLUIR]))
      .map(r => deudaFromRecord({ id: r.id, fields: r.fields as Record<string, unknown> }, acreedoresById, centrosById))
      .map(d => recomputeFromPagos(d, pagadosPorDeuda.get(d.id)));

    if (filtros.estado)         deudas = deudas.filter(d => d.estado === filtros.estado);
    if (filtros.tipoDocumento)  deudas = deudas.filter(d => d.tipoDocumento === filtros.tipoDocumento);
    if (filtros.acreedorId)     deudas = deudas.filter(d => d.acreedorId === filtros.acreedorId);
    if (filtros.centroCostoId)  deudas = deudas.filter(d => d.centroCostoId === filtros.centroCostoId);
    if (filtros.vencidasOnly)   deudas = deudas.filter(d => d.vencida || d.diasEnMora > 0);
    if (filtros.categoria)      deudas = deudas.filter(d => d.categoriaPasivo === filtros.categoria);
    // Legacy flags (mantenidos por compatibilidad — usar `categoria` en su lugar)
    if (filtros.soloSocios)     deudas = deudas.filter(d => d.categoriaPasivo === 'socios');
    if (filtros.soloExternas)   deudas = deudas.filter(d => d.categoriaPasivo === 'externa');

    return deudas;
  } catch (err) {
    console.error('Error fetching deudas:', err);
    return [];
  }
}

export async function getDeudaPorId(id: string): Promise<Deuda | null> {
  if (USE_MOCK || !airtable) return null;
  try {
    const [rec, acreedores, centrosById, pagadosPorDeuda] = await Promise.all([
      airtable(TABLES.DEUDAS).find(id),
      getAcreedores(),
      getCentrosNombreById(),
      getTotalPagadoPorDeuda(),
    ]);
    if (!rec) return null;
    const acreedoresById = new Map(acreedores.map(a => [a.id, a]));
    const d = deudaFromRecord({ id: rec.id, fields: rec.fields as Record<string, unknown> }, acreedoresById, centrosById);
    return recomputeFromPagos(d, pagadosPorDeuda.get(d.id));
  } catch (err) {
    console.error('Error fetching deuda:', err);
    return null;
  }
}

/**
 * Recalcula totalPagado / saldoPendiente / pctAvance / numPagos / estadoDeuda
 * a partir de los pagos reales en PAGOS_PROVEEDORES (suma de Monto_Pago).
 * Si una deuda no tiene pagos, los rollups Airtable de 0 quedan como están.
 * Si Saldo_Pendiente queda en <=0.01, marcamos estadoDeuda='Liquidada'.
 */
function recomputeFromPagos(d: Deuda, agg: { suma: number; count: number } | undefined): Deuda {
  if (!agg || agg.count === 0) return d;
  const totalPagado = agg.suma;
  const saldoPendiente = Math.max(0, d.montoGTQ - totalPagado);
  const pctAvance = d.montoGTQ > 0 ? Math.min(100, (totalPagado / d.montoGTQ) * 100) : 0;
  const estadoDeuda = saldoPendiente <= 0.01 ? 'Liquidada' : d.estadoDeuda;
  return {
    ...d,
    totalPagado,
    saldoPendiente,
    pctAvance,
    numPagos: agg.count,
    estadoDeuda,
  };
}

const VENTANA_PROXIMOS_DIAS = 30;

export async function getKPIsDeudas(): Promise<KPIsDeudas> {
  const deudas = await getDeudas();
  const vigentes = deudas.filter(d => d.saldoPendiente > 0);

  const totalPasivo = vigentes.reduce((s, d) => s + d.saldoPendiente, 0);

  const porCategoria: KPIsDeudas['porCategoria'] = {
    externa:               { monto: 0, cantidad: 0 },
    socios:                { monto: 0, cantidad: 0 },
    empleados:             { monto: 0, cantidad: 0 },   // F-037
    ex_empleados:          { monto: 0, cantidad: 0 },
    asesores_relacionados: { monto: 0, cantidad: 0 },
  };
  for (const d of vigentes) {
    const b = porCategoria[d.categoriaPasivo];
    b.monto += d.saldoPendiente;
    b.cantidad += 1;
  }

  const venc = vigentes.filter(d => d.vencida || d.diasEnMora > 0);
  const sumaMora   = venc.reduce((s, d) => s + d.diasEnMora, 0);
  const masAntigua = venc.reduce((m, d) => Math.max(m, d.diasEnMora), 0);

  const proximos = vigentes.filter(d => !d.vencida && d.diasAVencer >= 0 && d.diasAVencer <= VENTANA_PROXIMOS_DIAS);

  const porTipoMap = new Map<string, { saldo: number; cantidad: number }>();
  for (const d of vigentes) {
    const k = d.tipoDocumento || 'Sin tipo';
    const a = porTipoMap.get(k) ?? { saldo: 0, cantidad: 0 };
    a.saldo += d.saldoPendiente; a.cantidad += 1;
    porTipoMap.set(k, a);
  }
  const porTipo = [...porTipoMap.entries()]
    .map(([tipo, v]) => ({ tipo, saldo: v.saldo, cantidad: v.cantidad }))
    .sort((a, b) => b.saldo - a.saldo);

  const porAcrMap = new Map<string, { saldo: number; categoria: CategoriaPasivo }>();
  for (const d of vigentes) {
    const k = d.acreedorNombre || 'Sin acreedor';
    const a = porAcrMap.get(k) ?? { saldo: 0, categoria: d.categoriaPasivo };
    a.saldo += d.saldoPendiente;
    porAcrMap.set(k, a);
  }
  const porAcreedor = [...porAcrMap.entries()]
    .map(([acreedor, v]) => ({ acreedor, saldo: v.saldo, categoria: v.categoria }))
    .sort((a, b) => b.saldo - a.saldo)
    .slice(0, 10);

  return {
    totalPasivo,
    porCategoria,
    vencidas: {
      cantidad: venc.length,
      montoTotal: venc.reduce((s, d) => s + d.saldoPendiente, 0),
      diasPromedioMora: venc.length ? sumaMora / venc.length : 0,
      deudaMasAntigua: masAntigua,
    },
    proximosVencimientos: {
      cantidad: proximos.length,
      montoTotal: proximos.reduce((s, d) => s + d.saldoPendiente, 0),
    },
    porTipo,
    porAcreedor,
  };
}

export async function getDeudasPorAcreedor(acreedorId: string): Promise<{ acreedor: Acreedor | null; deudas: Deuda[]; totalSaldo: number }> {
  const [acreedores, deudas] = await Promise.all([
    getAcreedores(),
    getDeudas({ acreedorId }),
  ]);
  const acreedor = acreedores.find(a => a.id === acreedorId) ?? null;
  const totalSaldo = deudas.reduce((s, d) => s + d.saldoPendiente, 0);
  return { acreedor, deudas, totalSaldo };
}

// ============================================================
// CRUD de deudas — F-029
// ============================================================

// Opciones del singleSelect Tipo_Documento. Snapshot del schema.
export const TIPOS_DOCUMENTO = [
  'Factura',
  'Préstamo',
  'Tarjeta',
  'Leasing',
  'Nota Débito',
  'Factoraje',
  'Reembolso',
  'Provisión',
  'Nota de Crédito',
  'Contrato/Pagaré',
  'Administrativo',
  'Obligación Seguridad Social',
  'Devengo de Nómina',
  'Estado de Cuenta',
] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

// Spec usa 'Q' | 'USD' en la UI, pero el singleSelect Moneda de DEUDAS
// guarda 'GTQ' / 'USD'. Helper para mapear.
export type MonedaDeudaUI = 'Q' | 'USD';
const monedaUItoAirtable = (m: MonedaDeudaUI): 'GTQ' | 'USD' => m === 'Q' ? 'GTQ' : 'USD';

export interface CrearDeudaInput {
  acreedorId: string;
  nombreDeuda?: string;
  tipoDocumento: TipoDocumento;
  centroCostoId?: string;
  fechaEmision: string;           // YYYY-MM-DD
  moneda: MonedaDeudaUI;
  tipoCambio?: number;            // default 1
  montoOriginal: number;
  notas?: string;

  // Específicos por tipo (todos opcionales; el form decide cuáles mostrar)
  limite?: number;
  ultimos4Tarjeta?: string;
  tasaInteresAnual?: number;      // como número entre 0–1 (10% = 0.1)
  diaPagoFijo?: number;           // 1–31
  plazoMeses?: number;
  fechaPrimerCuota?: string;
  fechaVencimiento?: string;
  tasaComision?: number;
  ivaComision?: number;
  reserva?: number;
  plazoDias?: number;
  conRecurso?: boolean;
  numeroFactura?: string;
  plazoCreditoDias?: number;
  periodoMes?: string;            // ej "2026-05"
}

export type CrearDeudaResult =
  | { ok: true;  deudaId: string; mensaje: string }
  | { ok: false; error: string };

export type EditarDeudaInput = Partial<Omit<CrearDeudaInput, 'acreedorId'>> & { acreedorId?: string };

export type EditarDeudaResult =
  | { ok: true;  mensaje: string }
  | { ok: false; error: string };

function calcularFechaVencimiento(args: { fechaEmision: string; plazoMeses?: number; plazoDias?: number; fechaVencimientoExplicita?: string }): string | null {
  if (args.fechaVencimientoExplicita) return args.fechaVencimientoExplicita;
  if (!args.fechaEmision) return null;
  const [y, m, d] = args.fechaEmision.split('-').map(Number);
  if (!y || !m || !d) return null;
  if (args.plazoMeses && args.plazoMeses > 0) {
    const base = new Date(Date.UTC(y, m - 1, d));
    base.setUTCMonth(base.getUTCMonth() + args.plazoMeses);
    return base.toISOString().slice(0, 10);
  }
  if (args.plazoDias && args.plazoDias > 0) {
    const base = new Date(Date.UTC(y, m - 1, d));
    base.setUTCDate(base.getUTCDate() + args.plazoDias);
    return base.toISOString().slice(0, 10);
  }
  return null;
}

export async function crearDeuda(input: CrearDeudaInput): Promise<CrearDeudaResult> {
  if (USE_MOCK || !airtable) return { ok: false, error: 'Airtable no está configurado.' };

  // Validaciones críticas
  if (!input.acreedorId)           return { ok: false, error: 'Acreedor es requerido.' };
  if (!input.tipoDocumento)        return { ok: false, error: 'Tipo de documento es requerido.' };
  if (!input.fechaEmision)         return { ok: false, error: 'Fecha de emisión es requerida.' };
  if (!(input.montoOriginal > 0))  return { ok: false, error: 'El monto original debe ser mayor a 0.' };
  const hoyISO = obtenerFechaHoyGuatemala();
  if (input.fechaEmision > hoyISO) return { ok: false, error: 'La fecha de emisión no puede ser futura.' };

  // Validar que el acreedor existe
  const acreedores = await getAcreedores();
  const ac = acreedores.find(a => a.id === input.acreedorId);
  if (!ac) return { ok: false, error: 'El acreedor seleccionado no existe.' };

  // Calcular fecha de vencimiento si no viene explícita
  const fechaVenc = calcularFechaVencimiento({
    fechaEmision: input.fechaEmision,
    plazoMeses:   input.plazoMeses,
    plazoDias:    input.plazoDias ?? input.plazoCreditoDias,
    fechaVencimientoExplicita: input.fechaVencimiento,
  });

  // Validar fecha de vencimiento > emisión (si la calculamos o vino)
  if (fechaVenc && fechaVenc < input.fechaEmision) {
    return { ok: false, error: 'La fecha de vencimiento no puede ser anterior a la emisión.' };
  }

  // Nombre de la deuda: usa el explícito, o construye uno legible
  const nombreDeuda = input.nombreDeuda?.trim() || (input.numeroFactura?.trim() ? `${input.tipoDocumento} ${input.numeroFactura.trim()}` : `${input.tipoDocumento} ${input.fechaEmision}`);

  try {
    type AField = string | number | boolean | string[] | undefined;
    const fields: Record<string, AField> = {
      [FD.ACREEDOR]:     [input.acreedorId],
      [FD.NOMBRE_DEUDA]: nombreDeuda,
      [FD.TIPO_DOC]:     input.tipoDocumento,
      [FD.ESTADO]:       'Pendiente',
      [FD.FECHA_EMI]:    input.fechaEmision,
      [FD.MONEDA]:       monedaUItoAirtable(input.moneda),
      [FD.TIPO_CAMBIO]:  input.tipoCambio ?? 1,
      [FD.MONTO_ORIG]:   input.montoOriginal,
    };
    if (input.centroCostoId)         fields[FD.CENTRO_COSTO]      = [input.centroCostoId];
    if (input.notas?.trim())         fields[FD.NOTAS]             = input.notas.trim();
    if (fechaVenc)                   fields[FD.FECHA_VENC]        = fechaVenc;
    if (input.plazoMeses)            fields[FD.PLAZO_MESES]       = input.plazoMeses;
    if (input.fechaPrimerCuota)      fields[FD.FECHA_PRIMER_CUOTA] = input.fechaPrimerCuota;
    if (typeof input.tasaInteresAnual === 'number') fields[FD.TASA_INTERES] = input.tasaInteresAnual;
    if (typeof input.tasaInteresAnual === 'number') fields[FD.INTERES_ANUAL] = input.tasaInteresAnual;
    if (typeof input.diaPagoFijo === 'number')      fields[FD.DIA_PAGO_FIJO] = input.diaPagoFijo;
    if (typeof input.tasaComision === 'number')     fields[FD.TASA_COMISION] = input.tasaComision;
    if (typeof input.ivaComision === 'number')      fields[FD.IVA_COMISION]  = input.ivaComision;
    if (typeof input.reserva === 'number')          fields[FD.RESERVA]       = input.reserva;
    if (typeof input.conRecurso === 'boolean')      fields[FD.CON_RECURSO]   = input.conRecurso;
    if (input.numeroFactura?.trim())                fields[FD.NUMERO]        = input.numeroFactura.trim();

    const created = await airtable(TABLES.DEUDAS).create(fields);
    return {
      ok: true,
      deudaId: created.id,
      mensaje: `Deuda "${nombreDeuda}" creada (saldo inicial Q${input.montoOriginal.toFixed(2)}).`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Error creando deuda:', msg);
    return { ok: false, error: `No se pudo crear la deuda en Airtable: ${msg}` };
  }
}

export async function editarDeuda(deudaId: string, input: EditarDeudaInput): Promise<EditarDeudaResult> {
  if (USE_MOCK || !airtable) return { ok: false, error: 'Airtable no está configurado.' };
  if (!deudaId) return { ok: false, error: 'deudaId es requerido.' };

  // Cargar la deuda actual para validaciones
  const deuda = await getDeudaPorId(deudaId);
  if (!deuda) return { ok: false, error: 'No se encontró la deuda.' };

  // Si hay pagos registrados, no permitir cambiar el tipo de documento
  if (input.tipoDocumento && input.tipoDocumento !== deuda.tipoDocumento && deuda.numPagos > 0) {
    return { ok: false, error: `No se puede cambiar el tipo de documento: la deuda ya tiene ${deuda.numPagos} pago(s) registrado(s). Cambiar el tipo alteraría la semántica del histórico.` };
  }

  // Validaciones de campos editados
  if (input.fechaEmision) {
    const hoyISO = obtenerFechaHoyGuatemala();
    if (input.fechaEmision > hoyISO) return { ok: false, error: 'La fecha de emisión no puede ser futura.' };
  }
  if (input.montoOriginal !== undefined && !(input.montoOriginal > 0)) {
    return { ok: false, error: 'El monto original debe ser mayor a 0.' };
  }
  if (input.acreedorId) {
    const acreedores = await getAcreedores();
    if (!acreedores.find(a => a.id === input.acreedorId)) {
      return { ok: false, error: 'El acreedor seleccionado no existe.' };
    }
  }

  // Recalcular vencimiento si cambia algún input relacionado
  const fechaEmiCambia = input.fechaEmision && input.fechaEmision !== deuda.fechaEmision;
  const debeRecalcVenc = input.fechaVencimiento !== undefined
    || input.plazoMeses !== undefined
    || input.plazoDias !== undefined
    || input.plazoCreditoDias !== undefined
    || fechaEmiCambia;
  const fechaVencFinal = debeRecalcVenc
    ? calcularFechaVencimiento({
        fechaEmision: input.fechaEmision ?? deuda.fechaEmision,
        plazoMeses:   input.plazoMeses,
        plazoDias:    input.plazoDias ?? input.plazoCreditoDias,
        fechaVencimientoExplicita: input.fechaVencimiento,
      })
    : null;

  if (fechaVencFinal && (input.fechaEmision ?? deuda.fechaEmision) > fechaVencFinal) {
    return { ok: false, error: 'La fecha de vencimiento no puede ser anterior a la emisión.' };
  }

  try {
    type AField = string | number | boolean | string[] | undefined;
    const fields: Record<string, AField> = {};
    if (input.acreedorId)            fields[FD.ACREEDOR]           = [input.acreedorId];
    if (input.nombreDeuda)           fields[FD.NOMBRE_DEUDA]       = input.nombreDeuda.trim();
    if (input.tipoDocumento)         fields[FD.TIPO_DOC]           = input.tipoDocumento;
    if (input.centroCostoId)         fields[FD.CENTRO_COSTO]       = [input.centroCostoId];
    if (input.fechaEmision)          fields[FD.FECHA_EMI]          = input.fechaEmision;
    if (input.moneda)                fields[FD.MONEDA]             = monedaUItoAirtable(input.moneda);
    if (input.tipoCambio !== undefined) fields[FD.TIPO_CAMBIO]     = input.tipoCambio;
    if (input.montoOriginal !== undefined) fields[FD.MONTO_ORIG]   = input.montoOriginal;
    if (input.notas !== undefined)   fields[FD.NOTAS]              = input.notas.trim();
    if (fechaVencFinal !== null)     fields[FD.FECHA_VENC]         = fechaVencFinal;
    if (input.plazoMeses !== undefined) fields[FD.PLAZO_MESES]     = input.plazoMeses;
    if (input.fechaPrimerCuota)      fields[FD.FECHA_PRIMER_CUOTA] = input.fechaPrimerCuota;
    if (input.tasaInteresAnual !== undefined) {
      fields[FD.TASA_INTERES]  = input.tasaInteresAnual;
      fields[FD.INTERES_ANUAL] = input.tasaInteresAnual;
    }
    if (input.diaPagoFijo !== undefined) fields[FD.DIA_PAGO_FIJO] = input.diaPagoFijo;
    if (input.tasaComision !== undefined) fields[FD.TASA_COMISION] = input.tasaComision;
    if (input.ivaComision !== undefined)  fields[FD.IVA_COMISION]  = input.ivaComision;
    if (input.reserva !== undefined)      fields[FD.RESERVA]       = input.reserva;
    if (input.conRecurso !== undefined)   fields[FD.CON_RECURSO]   = input.conRecurso;
    if (input.numeroFactura !== undefined) fields[FD.NUMERO]       = input.numeroFactura.trim();

    if (Object.keys(fields).length === 0) {
      return { ok: false, error: 'No se especificó ningún campo a editar.' };
    }

    await airtable(TABLES.DEUDAS).update(deudaId, fields);
    return { ok: true, mensaje: 'Deuda actualizada.' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Error editando deuda:', msg);
    return { ok: false, error: `No se pudo actualizar la deuda en Airtable: ${msg}` };
  }
}

/** Borra una deuda (uso administrativo / tests). Bloquea si tiene pagos. */
export async function eliminarDeuda(deudaId: string): Promise<{ ok: boolean; error?: string }> {
  if (USE_MOCK || !airtable) return { ok: false, error: 'Airtable no está configurado.' };
  const deuda = await getDeudaPorId(deudaId);
  if (!deuda) return { ok: false, error: 'No se encontró la deuda.' };
  if (deuda.numPagos > 0) return { ok: false, error: `No se puede borrar: la deuda tiene ${deuda.numPagos} pago(s).` };
  try {
    await airtable(TABLES.DEUDAS).destroy(deudaId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
