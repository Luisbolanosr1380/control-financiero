// ============================================================
// Módulo de Deudas y Pasivos (F-027)
// Lee DEUDAS (134 records) y ACREEDORES (18). Stock del momento.
// JOINs en código (Airtable no expone lookup name del acreedor en DEUDAS).
// ============================================================

import { airtable, USE_MOCK, TABLES } from './airtable';

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
  CLAVE:            'Clave_Deuda',               // formula
  ACREEDOR:         'Acreedor',                  // link
  NOMBRE_DEUDA:     'Nombre_Deuda / Código',
  TIPO_DOC:         'Tipo_Documento',
  ESTADO:           'Estado',
  ESTADO_DEUDA:     'Estado_Deuda',              // formula
  FECHA_EMI:        'Fecha_Emision',
  FECHA_VENC:       'Fecha_Vencimiento',
  FECHA_VENC_REAL:  'Fecha_Vencimiento_Real',    // formula
  DIAS_VENCER:      'Dias_a_Vencer',             // formula
  VENCIDA:          'Vencida?',                  // formula 0/1
  MONEDA:           'Moneda',
  TIPO_CAMBIO:      'Tipo_Cambio',
  MONTO_ORIG:       'Monto_Original',
  MONTO_GTQ:        'Monto_GTQ',                 // formula
  TOTAL_PAGADO:     'Total_Pagado',              // rollup
  SALDO:            'Saldo_Pendiente',           // formula
  CENTRO_COSTO:     'Centro_Costo',              // link
  TASA_INTERES:     'Tasa_Interes',
  PCT_AVANCE:       '%_Avance',                  // formula
  DIAS_MORA:        'Dias_en_Mora',              // formula
  SEMAFORO:         'Semaforo_Vencimiento',      // formula con emoji
  MORA_ACUM:        'Mora_Acumulada',            // formula
  NUM_PAGOS:        'Num_Pagos',                 // rollup
  NOTAS:            'Notas',
  NO_INCLUIR:       'No Incluir',                // checkbox
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
export type CategoriaPasivo = 'externa' | 'socios' | 'ex_empleados' | 'asesores_relacionados';

export const CATEGORIAS_PASIVO: readonly CategoriaPasivo[] = ['externa', 'socios', 'ex_empleados', 'asesores_relacionados'];

export function clasificarPasivo(tipoAcreedor: string, esParteRelacionada: boolean): CategoriaPasivo {
  if (tipoAcreedor === 'Socio' || esParteRelacionada) return 'socios';
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
  const recs = await airtable(TABLES.CENTROS_COSTO)
    .select({ fields: ['NOMBRE'], maxRecords: 500 })
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
    const recs = await airtable(TABLES.ACREEDORES)
      .select({ maxRecords: 500 })
      .all();
    return recs.map(r => acreedorFromRecord({ id: r.id, fields: r.fields as Record<string, unknown> }));
  } catch (err) {
    console.error('Error fetching acreedores:', err);
    return [];
  }
}

export async function getDeudas(filtros: DeudasFiltros = {}): Promise<Deuda[]> {
  if (USE_MOCK || !airtable) return [];
  try {
    const [recs, acreedores, centrosById] = await Promise.all([
      airtable(TABLES.DEUDAS).select({ maxRecords: 500 }).all(),
      getAcreedores(),
      getCentrosNombreById(),
    ]);
    const acreedoresById = new Map(acreedores.map(a => [a.id, a]));

    let deudas = recs
      .filter(r => !bool((r.fields as Record<string, unknown>)[FD.NO_INCLUIR]))
      .map(r => deudaFromRecord({ id: r.id, fields: r.fields as Record<string, unknown> }, acreedoresById, centrosById));

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
    const [rec, acreedores, centrosById] = await Promise.all([
      airtable(TABLES.DEUDAS).find(id),
      getAcreedores(),
      getCentrosNombreById(),
    ]);
    if (!rec) return null;
    const acreedoresById = new Map(acreedores.map(a => [a.id, a]));
    return deudaFromRecord({ id: rec.id, fields: rec.fields as Record<string, unknown> }, acreedoresById, centrosById);
  } catch (err) {
    console.error('Error fetching deuda:', err);
    return null;
  }
}

const VENTANA_PROXIMOS_DIAS = 30;

export async function getKPIsDeudas(): Promise<KPIsDeudas> {
  const deudas = await getDeudas();
  const vigentes = deudas.filter(d => d.saldoPendiente > 0);

  const totalPasivo = vigentes.reduce((s, d) => s + d.saldoPendiente, 0);

  const porCategoria: KPIsDeudas['porCategoria'] = {
    externa:               { monto: 0, cantidad: 0 },
    socios:                { monto: 0, cantidad: 0 },
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
