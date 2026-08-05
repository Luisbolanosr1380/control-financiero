/**
 * F-058 — Motor de Estado de Resultados desde PARTIDAS reales.
 *
 * Una sola fuente de verdad: el libro diario (ASIENTOS + PARTIDAS) +
 * MAPEO_ER (la estructura del ER vive en datos, no en código).
 *
 * Lo que SÍ hace este módulo:
 *  · Lee PARTIDAS del período con paginación completa (F-BF-004) y
 *    field IDs estrictos (F-047.2).
 *  · Agrupa por cuenta y calcula saldo natural por NATURALEZA_ER.
 *  · Resuelve cada línea de MAPEO_ER ("Suma cuentas" → suma con signo;
 *    "Calculada" → fórmulas declarativas por orden).
 *  · Devuelve 3 columnas comparativas (mes, mes-1, YTD) con variación.
 *  · Modo "fiscal" vs "operativo" — el operativo excluye partidas cuyo
 *    gasto origen tiene TIPO_OPERATIVO="No Operativo".
 *  · Control de integridad: Σdebe = Σhaber (tolerancia 0.01).
 *
 * Lo que NO hace (queda fuera de scope):
 *  · Escribir snapshots a ER_SNAPSHOT (fase 2 al cerrar período).
 *  · Balance General (F-059).
 *  · Depreciación (F-057) que alimenta la línea 260.
 *
 * Reglas honradas:
 *  · F-041: comparación de strings YYYY-MM, sin Date para zonas.
 *  · F-050.2: filterByFormula usa nombres de campo cuando aplica, NO
 *    field IDs. Acá filtramos en JS por field ID después de traer todo.
 *  · F-BF-004: sin maxRecords — `.all()` agota la paginación interna.
 */

import { airtable } from '@/lib/db/airtable';
import { dataSource } from '@/lib/config/data-source';
import { fetchAll } from '@/lib/supabase/client';

type RowSb = Record<string, unknown>;
const atId = (rel: unknown): string => String((rel as { airtable_id?: string } | null)?.airtable_id ?? '');
import { PARTIDAS_TABLE_ID, PARTIDAS_FIELDS, ASIENTOS_TABLE_ID } from '@/lib/airtable/asientos-fields';
import { MAPEO_ER_TABLE_ID, MAPEO_ER_FIELDS, type SignoLinea, type TipoLineaMapeo } from '@/lib/airtable/mapeo-er-fields';
import { CUENTAS_TABLE_ID, CUENTAS_FIELDS } from '@/lib/contabilidad/cuentas-sistema';
import { GASTOS_TABLE_ID, GASTOS_FIELDS } from '@/lib/airtable/gastos-fields';

const round2 = (n: number) => Math.round(n * 100) / 100;

/* =========================================================================
 * Tipos públicos
 * ========================================================================= */

export type ModoER = 'fiscal' | 'operativo';

export interface LineaER {
  /** Nombre de la línea desde MAPEO_ER (ej "Ingresos Polígrafia"). */
  nombre: string;
  /** Orden visual (asc) que ordena la tabla y ubica los subtotales. */
  orden: number;
  /** "Suma cuentas" (lee del libro) o "Calculada" (subtotal por fórmula). */
  tipo: TipoLineaMapeo;
  /** Signo aplicado a la suma (solo para "Suma cuentas"; '' para calculadas). */
  signo: SignoLinea;
  /** Monto del mes seleccionado. */
  mes: number;
  /** Monto del mes anterior (periodo − 1). */
  mesAnterior: number;
  /** Acumulado del año (enero → periodo, inclusive). */
  ytd: number;
  /** Variación mes vs mes anterior (mes − mesAnterior). */
  variacion: number;
  /** Variación % mes vs mes anterior. null si mesAnterior es 0. */
  variacionPct: number | null;
  /** IDs de cuentas incluidas en la suma (debug + tooltip UI). */
  cuentasIncluidas: string[];
}

export interface ControlIntegridad {
  totalDebe: number;
  totalHaber: number;
  /** |Dr − Cr| ≤ 0.01. */
  cuadra: boolean;
  diferencia: number;
}

export interface Margenes {
  /** Margen bruto = U.Bruta / Ingresos Netos × 100. null si ingresos = 0. */
  brutoPct:     number | null;
  /** Margen operativo = U.Operativa / Ingresos Netos × 100. */
  operativoPct: number | null;
  /** Margen neto = U.Neta / Ingresos Netos × 100. */
  netoPct:      number | null;
}

export interface EstadoResultados {
  periodo: string;
  periodoAnterior: string;
  modo: ModoER;
  centroCostoId?: string;
  lineas: LineaER[];
  margenes: Margenes;
  control: ControlIntegridad;
  /** Mensajes para mostrar en la UI (ej: balance no cuadra, mapeo vacío…). */
  advertencias: string[];
  /** Conteos para el estado vacío elegante. */
  conteos: { partidasMes: number; partidasMesAnterior: number; partidasYTD: number };
}

export interface GenerarERInput {
  /** YYYY-MM. */
  periodo: string;
  centroCostoId?: string;
  modo?: ModoER;
}

/* =========================================================================
 * Helpers de fecha (string YYYY-MM, F-041)
 * ========================================================================= */

function mesAnteriorDe(periodo: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo);
  if (!m) return periodo;
  let y = Number(m[1]);
  let mm = Number(m[2]) - 1;
  if (mm < 1) { mm = 12; y -= 1; }
  return `${y}-${String(mm).padStart(2, '0')}`;
}

/** Genera la lista de meses YTD: enero del año del periodo → periodo inclusive. */
function mesesYTD(periodo: string): string[] {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo);
  if (!m) return [periodo];
  const y = Number(m[1]);
  const hasta = Number(m[2]);
  const out: string[] = [];
  for (let i = 1; i <= hasta; i++) out.push(`${y}-${String(i).padStart(2, '0')}`);
  return out;
}

/* =========================================================================
 * Lectura por field ID
 * ========================================================================= */

const arrFirst = (v: unknown): string => {
  if (Array.isArray(v) && v.length > 0) {
    const x = v[0];
    if (typeof x === 'string') return x;
    if (x && typeof x === 'object' && 'id' in (x as object)) return String((x as { id?: unknown }).id ?? '');
  }
  return '';
};
const arrAll = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  return v.map(x => {
    if (typeof x === 'string') return x;
    if (x && typeof x === 'object' && 'id' in (x as object)) return String((x as { id?: unknown }).id ?? '');
    return '';
  }).filter(Boolean);
};
const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const selectName = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'name' in (v as object)) return String((v as { name?: unknown }).name ?? '');
  return '';
};
const str = (v: unknown): string => String(v ?? '');

/* =========================================================================
 * 1) PARTIDAS — lectura del libro
 * ========================================================================= */

interface PartidaCruda {
  id: string;
  cuentaId: string;
  centroCostoId: string;
  debe: number;
  haber: number;
  periodo: string;
  asientoId: string;
}

async function leerPartidasDelPeriodo(periodos: readonly string[]): Promise<PartidaCruda[]> {
  if (periodos.length === 0) return [];
  if (dataSource('partidas') === 'supabase') {
    const setPeriodos = new Set(periodos);
    const rows = await fetchAll<RowSb>('partidas', {
      select: 'airtable_id, debe, haber, periodo, cuenta:cuentas(airtable_id), centro:centros_costo(airtable_id), asiento:asientos(airtable_id)',
    });
    return rows
      .filter(r => setPeriodos.has(String(r.periodo ?? '').trim()))
      .map(r => ({
        id: String(r.airtable_id),
        cuentaId: atId(r.cuenta),
        centroCostoId: atId(r.centro),
        debe: Number(r.debe ?? 0),
        haber: Number(r.haber ?? 0),
        periodo: String(r.periodo ?? '').trim(),
        asientoId: atId(r.asiento),
      }));
  }
  if (!airtable) return [];
  try {
    // F-BF-004: sin maxRecords — `.all()` agota la paginación interna.
    // F-050.2: filterByFormula con FIELD ID NO funciona; usamos los
    // valores del campo periodo (string "YYYY-MM") por NOMBRE.
    const esc = periodos.map(p => `"${p.replace(/"/g, '')}"`).join(',');
    const records = await airtable(PARTIDAS_TABLE_ID)
      .select({
        returnFieldsByFieldId: true,
        // El campo periodo de PARTIDAS es texto plano "YYYY-MM" (singleLineText).
        // Su nombre real en Airtable es "periodo" (campo de planilla compartida).
        // Si el filtro fallara silenciosamente, caer a leer todo y filtrar en JS.
        filterByFormula: `OR(${periodos.map(p => `{periodo}="${p.replace(/"/g, '')}"`).join(',')})`,
      })
      .all()
      .catch(async () => {
        // Fallback defensivo: traer todo y filtrar en JS por field ID.
        void esc;
        return await airtable!(PARTIDAS_TABLE_ID)
          .select({ returnFieldsByFieldId: true })
          .all();
      });
    const setPeriodos = new Set(periodos);
    const out: PartidaCruda[] = [];
    for (const r of records) {
      const f = r.fields as Record<string, unknown>;
      const periodo = str(f[PARTIDAS_FIELDS.periodo]).trim();
      if (!setPeriodos.has(periodo)) continue;
      out.push({
        id:            r.id,
        cuentaId:      arrFirst(f[PARTIDAS_FIELDS.cuenta]),
        centroCostoId: arrFirst(f[PARTIDAS_FIELDS.centro_costo]),
        debe:          num(f[PARTIDAS_FIELDS.debe]),
        haber:         num(f[PARTIDAS_FIELDS.haber]),
        periodo,
        asientoId:     arrFirst(f[PARTIDAS_FIELDS.asiento]),
      });
    }
    return out;
  } catch (err) {
    console.warn('F-058 leerPartidasDelPeriodo falló:', err instanceof Error ? err.message : err);
    return [];
  }
}

/* =========================================================================
 * 2) CUENTAS — para saldo natural por NATURALEZA_ER
 * ========================================================================= */

interface CuentaMeta {
  id: string;
  codigo: string;
  naturalezaEsAcreedora: boolean;
}

async function leerCuentasMeta(): Promise<Map<string, CuentaMeta>> {
  if (dataSource('cuentas') === 'supabase') {
    const rows = await fetchAll<RowSb>('cuentas', { select: 'airtable_id, codigo_path, naturaleza_er' });
    const m = new Map<string, CuentaMeta>();
    for (const r of rows) {
      const id = String(r.airtable_id);
      const codigo = String(r.codigo_path ?? '').trim();
      const naturaleza = String(r.naturaleza_er ?? '').trim().toLowerCase();
      m.set(id, { id, codigo, naturalezaEsAcreedora: naturaleza ? naturaleza.startsWith('acre') : codigo.startsWith('4') });
    }
    return m;
  }
  if (!airtable) return new Map();
  try {
    // F-BF-004 + F-047.2: sin cap, field IDs.
    const records = await airtable(CUENTAS_TABLE_ID)
      .select({ returnFieldsByFieldId: true })
      .all();
    const m = new Map<string, CuentaMeta>();
    for (const r of records) {
      const f = r.fields as Record<string, unknown>;
      const codigo = str(f[CUENTAS_FIELDS.codigo_path]).trim();
      // NATURALEZA_ER (singleSelect) — field ID nuevo, fldbcwjsLuBYTIhtV.
      // Si no está poblado, derivamos por primer dígito de codigo_path:
      //   4 → ingreso (acreedora)
      //   5/6 → costo/gasto (deudora)
      //   1/2/3 → BG, no aplica a ER, default deudora pero no se usará.
      const naturaleza = selectName(f[CUENTAS_FIELDS.naturaleza_er]).trim().toLowerCase();
      const naturalezaEsAcreedora = naturaleza
        ? naturaleza.startsWith('acre')
        : codigo.startsWith('4');
      m.set(r.id, { id: r.id, codigo, naturalezaEsAcreedora });
    }
    return m;
  } catch (err) {
    console.warn('F-058 leerCuentasMeta falló:', err instanceof Error ? err.message : err);
    return new Map();
  }
}

/* =========================================================================
 * 3) MAPEO_ER — estructura del ER
 * ========================================================================= */

interface LineaMapeo {
  id: string;
  nombre: string;
  orden: number;
  tipo: TipoLineaMapeo;
  signo: SignoLinea;
  cuentasLink: string[];
  prefijos: string;
  centroCostoFijo?: string;
}

async function leerMapeoER(): Promise<LineaMapeo[]> {
  if (dataSource('mapeo_er') === 'supabase') {
    // cuentasLink via tabla puente mapeo_er_cuentas (embed M2M de PostgREST).
    const rows = await fetchAll<RowSb>('mapeo_er', { select: '*, cuentas(airtable_id)' });
    const out: LineaMapeo[] = rows.map(r => {
      const tipoRaw = String(r.tipo ?? '').trim();
      const signoRaw = String(r.signo ?? '').trim();
      return {
        id: String(r.airtable_id),
        nombre: String(r.linea ?? '').trim(),
        orden: Number(r.orden ?? 0),
        tipo: (tipoRaw === 'Calculada' ? 'Calculada' : 'Suma cuentas') as TipoLineaMapeo,
        signo: (signoRaw === '+' || signoRaw === '–' ? signoRaw : '') as SignoLinea,
        cuentasLink: Array.isArray(r.cuentas) ? (r.cuentas as Array<{ airtable_id?: string }>).map(c => String(c.airtable_id ?? '')).filter(Boolean) : [],
        prefijos: String(r.prefijos ?? '').trim(),
        centroCostoFijo: undefined,   // vacío en los 25 mapeos (verificado)
      };
    });
    out.sort((a, b) => a.orden - b.orden);
    return out;
  }
  if (!airtable) return [];
  try {
    const records = await airtable(MAPEO_ER_TABLE_ID)
      .select({ returnFieldsByFieldId: true })
      .all();
    const out: LineaMapeo[] = [];
    for (const r of records) {
      const f = r.fields as Record<string, unknown>;
      const tipoRaw = selectName(f[MAPEO_ER_FIELDS.tipo]).trim();
      const tipo: TipoLineaMapeo = tipoRaw === 'Calculada' ? 'Calculada' : 'Suma cuentas';
      const signoRaw = selectName(f[MAPEO_ER_FIELDS.signo]).trim();
      const signo: SignoLinea = signoRaw === '+' || signoRaw === '–' ? (signoRaw as SignoLinea) : '';
      out.push({
        id:               r.id,
        nombre:           str(f[MAPEO_ER_FIELDS.linea]).trim(),
        orden:            num(f[MAPEO_ER_FIELDS.orden]),
        tipo,
        signo,
        cuentasLink:      arrAll(f[MAPEO_ER_FIELDS.cuentas]),
        prefijos:         str(f[MAPEO_ER_FIELDS.prefijos]).trim(),
        centroCostoFijo:  arrFirst(f[MAPEO_ER_FIELDS.centro_costo_fijo]) || undefined,
      });
    }
    out.sort((a, b) => a.orden - b.orden);
    return out;
  } catch (err) {
    console.warn('F-058 leerMapeoER falló:', err instanceof Error ? err.message : err);
    return [];
  }
}

/* =========================================================================
 * 4) Set de asientos "No Operativo" para modo operativo
 * ========================================================================= */

async function asientosNoOperativos(): Promise<Set<string>> {
  if (dataSource('gastos') === 'supabase') {
    const rows = await fetchAll<RowSb>('gastos', {
      select: 'tipo_operativo, asiento:asientos(airtable_id)',
    });
    const set = new Set<string>();
    for (const r of rows) {
      if (String(r.tipo_operativo ?? '').trim() !== 'No Operativo') continue;
      const a = atId(r.asiento);
      if (a) set.add(a);
    }
    return set;
  }
  if (!airtable) return new Set();
  try {
    const records = await airtable(GASTOS_TABLE_ID)
      .select({ returnFieldsByFieldId: true })
      .all();
    const set = new Set<string>();
    for (const r of records) {
      const f = r.fields as Record<string, unknown>;
      const tipo = selectName(f[GASTOS_FIELDS.tipo_operativo]).trim();
      if (tipo !== 'No Operativo') continue;
      const asientoId = arrFirst(f[GASTOS_FIELDS.asiento]);
      if (asientoId) set.add(asientoId);
    }
    void ASIENTOS_TABLE_ID;  // export usado por el motor de gastos; lo mantenemos vinculado.
    return set;
  } catch (err) {
    console.warn('F-058 asientosNoOperativos falló:', err instanceof Error ? err.message : err);
    return new Set();
  }
}

/* =========================================================================
 * 5) Saldo natural por cuenta
 * ========================================================================= */

function saldoNaturalPorCuenta(
  partidas: readonly PartidaCruda[],
  cuentasMeta: Map<string, CuentaMeta>,
): Map<string, number> {
  // saldo bruto: Σdebe − Σhaber. Para cuentas acreedoras (ingresos), el
  // saldo natural queda negativo con esa fórmula; invertimos el signo
  // para presentarlo como monto positivo.
  const brutos = new Map<string, number>();
  for (const p of partidas) {
    if (!p.cuentaId) continue;
    const actual = brutos.get(p.cuentaId) ?? 0;
    brutos.set(p.cuentaId, actual + p.debe - p.haber);
  }
  const out = new Map<string, number>();
  for (const [cuentaId, bruto] of brutos) {
    const meta = cuentasMeta.get(cuentaId);
    const natural = meta?.naturalezaEsAcreedora ? -bruto : bruto;
    out.set(cuentaId, round2(natural));
  }
  return out;
}

/* =========================================================================
 * 6) Resolver una línea "Suma cuentas"
 * ========================================================================= */

function resolverSumaCuentas(
  linea: LineaMapeo,
  saldos: Map<string, number>,
  cuentasMeta: Map<string, CuentaMeta>,
): { monto: number; cuentasIncluidas: string[] } {
  // Mecanismo 1 (real hoy): link explícito a cuentas.
  let cuentaIds = linea.cuentasLink.filter(Boolean);

  // Mecanismo 2 (fallback): prefijo string sobre codigo_path. Hoy
  // vacío en la data, pero el motor lo soporta para futuro.
  if (cuentaIds.length === 0 && linea.prefijos) {
    const prefijos = linea.prefijos
      .split(/[,;\s]+/)
      .map(p => p.trim())
      .filter(Boolean);
    cuentaIds = [...cuentasMeta.values()]
      .filter(c => prefijos.some(p => c.codigo.startsWith(p)))
      .map(c => c.id);
  }

  let sumaBruta = 0;
  for (const id of cuentaIds) {
    sumaBruta += saldos.get(id) ?? 0;
  }
  const factor = linea.signo === '–' ? -1 : 1;
  return { monto: round2(sumaBruta * factor), cuentasIncluidas: cuentaIds };
}

/* =========================================================================
 * 7) Líneas "Calculada" — fórmulas declarativas por rango de orden
 *
 * Reglas (basadas en MAPEO_ER y su orden):
 *   Ingresos Brutos   = Σ líneas Suma con orden ∈ [10, 60]
 *   Descuentos y NC   = Σ líneas Suma con orden = 70 (su signo ya es –)
 *   Ingresos Netos    = Ingresos Brutos + Descuentos/NC (este último ya negativo)
 *   Costo de Ventas   = Σ líneas Suma con orden ∈ [110, 160]
 *   UTILIDAD BRUTA    = Ingresos Netos − Costo de Ventas
 *   Gastos Operativos = Σ líneas Suma con orden ∈ [210, 240]
 *   EBITDA            = U.Bruta − Gastos Operativos (excluye fin., depreciación, ISR)
 *   Depreciación      = Σ líneas Suma con orden = 260
 *   UTILIDAD OPERATIVA= EBITDA − Depreciación
 *   Gastos Financieros= Σ líneas Suma con orden = 250
 *   ISR               = Σ líneas Suma con orden = 270
 *   Otros Gastos      = Σ líneas Suma con orden = 280
 *   UTILIDAD NETA     = U.Operativa − Financieros − ISR − Otros Gastos
 *
 * Si el orden de MAPEO_ER cambia, modificar los rangos acá. Heurística
 * documentada en el comentario del módulo y arriba de cada bloque.
 * ========================================================================= */

function sumarRango(montosPorOrden: Map<number, number>, desde: number, hasta: number): number {
  let s = 0;
  for (const [orden, monto] of montosPorOrden) {
    if (orden >= desde && orden <= hasta) s += monto;
  }
  return round2(s);
}

function montoExacto(montosPorOrden: Map<number, number>, orden: number): number {
  return round2(montosPorOrden.get(orden) ?? 0);
}

interface SubtotalesER {
  ingresosBrutos: number;
  descuentosNC: number;
  ingresosNetos: number;
  costoVentas: number;
  utilidadBruta: number;
  gastosOperativos: number;
  ebitda: number;
  depreciacion: number;
  utilidadOperativa: number;
  gastosFinancieros: number;
  isr: number;
  otrosGastos: number;
  utilidadNeta: number;
}

function calcularSubtotales(montosPorOrden: Map<number, number>): SubtotalesER {
  const ingresosBrutos    = sumarRango(montosPorOrden, 10, 60);
  // 70 ya viene con signo '–' aplicado por resolverSumaCuentas (monto ya negativo).
  const descuentosNC      = montoExacto(montosPorOrden, 70);
  const ingresosNetos     = round2(ingresosBrutos + descuentosNC);
  const costoVentas       = sumarRango(montosPorOrden, 110, 160);
  const utilidadBruta     = round2(ingresosNetos - costoVentas);
  const gastosOperativos  = sumarRango(montosPorOrden, 210, 240);
  const ebitda            = round2(utilidadBruta - gastosOperativos);
  const depreciacion      = montoExacto(montosPorOrden, 260);
  const utilidadOperativa = round2(ebitda - depreciacion);
  const gastosFinancieros = montoExacto(montosPorOrden, 250);
  const isr               = montoExacto(montosPorOrden, 270);
  const otrosGastos       = montoExacto(montosPorOrden, 280);
  const utilidadNeta      = round2(utilidadOperativa - gastosFinancieros - isr - otrosGastos);
  return {
    ingresosBrutos, descuentosNC, ingresosNetos,
    costoVentas, utilidadBruta,
    gastosOperativos, ebitda,
    depreciacion, utilidadOperativa,
    gastosFinancieros, isr, otrosGastos, utilidadNeta,
  };
}

/** Mapea un nombre de línea "Calculada" al subtotal correspondiente. */
function valorCalculada(nombre: string, subt: SubtotalesER): number {
  const n = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (n.includes('ingresos netos'))                       return subt.ingresosNetos;
  if (n.includes('utilidad bruta'))                       return subt.utilidadBruta;
  if (n.includes('ebitda'))                               return subt.ebitda;
  if (n.includes('utilidad operativa') || n.includes('utilidad de operacion')) return subt.utilidadOperativa;
  if (n.includes('utilidad neta'))                        return subt.utilidadNeta;
  if (n.includes('costo de ventas'))                      return subt.costoVentas;
  if (n.includes('gastos operativos'))                    return subt.gastosOperativos;
  return 0;
}

/* =========================================================================
 * 8) Orquestador por período individual (devuelve montos por orden)
 * ========================================================================= */

interface ResultadoPeriodo {
  /** mapa: orden → monto del rubro "Suma cuentas" o calculada. */
  montosPorOrden: Map<number, number>;
  /** cuentasIncluidas por orden, para tooltip de la línea. */
  cuentasPorOrden: Map<number, string[]>;
  /** Σ Dr y Σ Cr para control de integridad. */
  totalDebe: number;
  totalHaber: number;
  numPartidas: number;
  subtotales: SubtotalesER;
}

function calcularPeriodo(
  partidasDelPeriodo: readonly PartidaCruda[],
  mapeo: readonly LineaMapeo[],
  cuentasMeta: Map<string, CuentaMeta>,
): ResultadoPeriodo {
  const totalDebe  = round2(partidasDelPeriodo.reduce((s, p) => s + p.debe, 0));
  const totalHaber = round2(partidasDelPeriodo.reduce((s, p) => s + p.haber, 0));
  const saldos = saldoNaturalPorCuenta(partidasDelPeriodo, cuentasMeta);

  // Resolver primero todas las líneas "Suma cuentas" → mapa por orden.
  const montosPorOrden = new Map<number, number>();
  const cuentasPorOrden = new Map<number, string[]>();
  for (const linea of mapeo) {
    if (linea.tipo !== 'Suma cuentas') continue;
    const r = resolverSumaCuentas(linea, saldos, cuentasMeta);
    montosPorOrden.set(linea.orden, r.monto);
    cuentasPorOrden.set(linea.orden, r.cuentasIncluidas);
  }

  // Calcular subtotales con todas las "Suma cuentas" en la mano.
  const subtotales = calcularSubtotales(montosPorOrden);

  // Ahora resolvemos las "Calculada" y las metemos al mismo mapa por orden.
  for (const linea of mapeo) {
    if (linea.tipo !== 'Calculada') continue;
    montosPorOrden.set(linea.orden, valorCalculada(linea.nombre, subtotales));
    cuentasPorOrden.set(linea.orden, []);
  }

  return {
    montosPorOrden,
    cuentasPorOrden,
    totalDebe,
    totalHaber,
    numPartidas: partidasDelPeriodo.length,
    subtotales,
  };
}

/* =========================================================================
 * 9) API pública
 * ========================================================================= */

export async function generarEstadoResultados(input: GenerarERInput): Promise<EstadoResultados> {
  const periodo = input.periodo.slice(0, 7);
  const modo: ModoER = input.modo ?? 'fiscal';
  const periodoAnterior = mesAnteriorDe(periodo);
  const periodosYTD = mesesYTD(periodo);

  // Cargas en paralelo. Mapeo y cuentas son ligeros; partidas pueden ser
  // muchas (pero del mes — volumen acotado). En modo operativo agregamos
  // la query de gastos para el set de asientos no-operativos.
  const [mapeo, cuentasMeta, partidasYTD, noOpAsientos] = await Promise.all([
    leerMapeoER(),
    leerCuentasMeta(),
    leerPartidasDelPeriodo(periodosYTD),
    modo === 'operativo' ? asientosNoOperativos() : Promise.resolve(new Set<string>()),
  ]);

  const advertencias: string[] = [];
  if (mapeo.length === 0) {
    advertencias.push('MAPEO_ER vacío. Configurar las líneas en Airtable antes de generar el ER.');
  }

  // Filtros: por centro de costo (si viene) y por modo operativo.
  const filtrar = (p: PartidaCruda): boolean => {
    if (input.centroCostoId && p.centroCostoId !== input.centroCostoId) return false;
    if (modo === 'operativo' && p.asientoId && noOpAsientos.has(p.asientoId)) return false;
    return true;
  };
  const partidasFiltradasYTD     = partidasYTD.filter(filtrar);
  const partidasMes              = partidasFiltradasYTD.filter(p => p.periodo === periodo);
  const partidasMesAnterior      = partidasFiltradasYTD.filter(p => p.periodo === periodoAnterior);

  const resMes      = calcularPeriodo(partidasMes,         mapeo, cuentasMeta);
  const resMesAnt   = calcularPeriodo(partidasMesAnterior, mapeo, cuentasMeta);
  const resYTD      = calcularPeriodo(partidasFiltradasYTD, mapeo, cuentasMeta);

  // Construir filas en el orden de MAPEO_ER.
  const lineas: LineaER[] = mapeo.map(linea => {
    const mes      = resMes.montosPorOrden.get(linea.orden) ?? 0;
    const mesAnt   = resMesAnt.montosPorOrden.get(linea.orden) ?? 0;
    const ytd      = resYTD.montosPorOrden.get(linea.orden) ?? 0;
    const variacion = round2(mes - mesAnt);
    const variacionPct = Math.abs(mesAnt) > 0.01
      ? round2((variacion / Math.abs(mesAnt)) * 100)
      : null;
    return {
      nombre: linea.nombre,
      orden:  linea.orden,
      tipo:   linea.tipo,
      signo:  linea.signo,
      mes, mesAnterior: mesAnt, ytd, variacion, variacionPct,
      cuentasIncluidas: resMes.cuentasPorOrden.get(linea.orden) ?? [],
    };
  });

  // Márgenes sobre Ingresos Netos del mes.
  const marg = (num: number, den: number): number | null =>
    Math.abs(den) > 0.01 ? round2((num / den) * 100) : null;
  const margenes: Margenes = {
    brutoPct:     marg(resMes.subtotales.utilidadBruta,     resMes.subtotales.ingresosNetos),
    operativoPct: marg(resMes.subtotales.utilidadOperativa, resMes.subtotales.ingresosNetos),
    netoPct:      marg(resMes.subtotales.utilidadNeta,      resMes.subtotales.ingresosNetos),
  };

  const diferencia = round2(resMes.totalDebe - resMes.totalHaber);
  const control: ControlIntegridad = {
    totalDebe:  resMes.totalDebe,
    totalHaber: resMes.totalHaber,
    cuadra:     Math.abs(diferencia) <= 0.01,
    diferencia,
  };
  if (!control.cuadra && resMes.numPartidas > 0) {
    advertencias.push(`Balance de comprobación NO cuadra en ${periodo}: Σdebe=${control.totalDebe} Σhaber=${control.totalHaber} (Δ=${diferencia}).`);
  }

  return {
    periodo,
    periodoAnterior,
    modo,
    centroCostoId: input.centroCostoId,
    lineas,
    margenes,
    control,
    advertencias,
    conteos: {
      partidasMes:         resMes.numPartidas,
      partidasMesAnterior: resMesAnt.numPartidas,
      partidasYTD:         resYTD.numPartidas,
    },
  };
}
