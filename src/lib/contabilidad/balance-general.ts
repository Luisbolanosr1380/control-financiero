/**
 * F-059 — Motor de Balance General + Balance de Comprobación.
 *
 * Gemelo del Estado de Resultados (F-058). Diferencia clave:
 *  · El ER suma partidas DEL PERÍODO (mes o YTD). El BALANCE
 *    ACUMULA TODAS las partidas desde el inicio del libro hasta la
 *    fecha de corte (inclusive). Las cuentas de balance arrastran
 *    saldo, no se "resetean" al cambiar de mes.
 *  · "Resultado del Ejercicio" del balance NO viene de partidas
 *    directamente: es la Utilidad Neta YTD del ER. Esa es la pieza
 *    que CONECTA los dos estados — el motor de F-058 se importa acá.
 *
 * Lo que SÍ hace:
 *  · leerPartidasHastaPeriodo(corte) — paginación completa, field IDs.
 *  · saldoNaturalPorCuentaBalance — usa NATURALEZA_BS o fallback 1/2/3.
 *  · Resolver líneas de MAPEO_BS con TRIM del signo (viene "\n+\n").
 *  · Conectar Resultado del Ejercicio (línea 65 por convención del
 *    catálogo) con la Utilidad Neta del ER YTD.
 *  · Ecuación contable: Total Activo = Total Pasivo + Capital.
 *  · Balance de Comprobación (trial balance): lista de TODAS las
 *    cuentas con movimiento + Σdebe + Σhaber + saldo. Σdebe = Σhaber
 *    es el control duro que prueba que el libro cuadra.
 *  · Filtro por centro de costo (opcional).
 *
 * Fuera de scope (documentado): persistencia a BS_SNAPSHOT al cerrar;
 * F-057 motor de depreciación que alimenta PPE neto / Intangibles;
 * asiento de apertura formal.
 *
 * Reglas honradas: F-041 (strings YYYY-MM), F-047.2 (field IDs),
 * F-BF-004 (sin maxRecords).
 */

import { airtable } from '@/lib/db/airtable';
import { PARTIDAS_TABLE_ID, PARTIDAS_FIELDS } from '@/lib/airtable/asientos-fields';
import {
  MAPEO_BS_TABLE_ID,
  MAPEO_BS_FIELDS,
  type SignoLineaBS,
  type TipoLineaMapeoBS,
} from '@/lib/airtable/mapeo-bs-fields';
import { CUENTAS_TABLE_ID, CUENTAS_FIELDS } from '@/lib/contabilidad/cuentas-sistema';
import { generarEstadoResultados } from '@/lib/contabilidad/estado-resultados';

const round2 = (n: number) => Math.round(n * 100) / 100;

/* =========================================================================
 * Tipos públicos
 * ========================================================================= */

export interface LineaBG {
  nombre: string;
  orden: number;
  tipo: TipoLineaMapeoBS;
  signo: SignoLineaBS;
  /** Saldo presentado (siempre positivo en presentación normal). */
  monto: number;
  /** Saldo a fin del mes anterior al corte, para comparativo. */
  montoAnterior: number;
  variacion: number;
  variacionPct: number | null;
  /** IDs de las cuentas que sumó esta línea (debug + tooltip). */
  cuentasIncluidas: string[];
}

export interface SubtotalesBG {
  totalActivo: number;
  totalPasivo: number;
  totalCapital: number;
  totalPasivoCapital: number;
  /** Resultado del Ejercicio (Utilidad Neta YTD del ER) — entra al Capital. */
  resultadoEjercicio: number;
}

export interface EcuacionContable {
  cuadra: boolean;
  diferencia: number;
}

export interface CuentaComprobacion {
  cuentaId: string;
  codigo: string;
  nombre: string;
  totalDebe: number;
  totalHaber: number;
  /** Σdebe − Σhaber (signo deudor positivo, acreedor negativo). */
  saldo: number;
}

export interface BalanceComprobacion {
  cuentas: CuentaComprobacion[];
  totalDebe: number;
  totalHaber: number;
  /** Σdebe = Σhaber (tolerancia 0.01). El control duro de auditoría. */
  cuadra: boolean;
  diferencia: number;
}

export interface BalanceGeneral {
  periodoCorte: string;
  periodoAnterior: string;
  centroCostoId?: string;
  lineas: LineaBG[];
  subtotales: SubtotalesBG;
  ecuacion: EcuacionContable;
  comprobacion: BalanceComprobacion;
  advertencias: string[];
  conteos: { partidasAcumuladas: number; cuentasConMovimiento: number };
}

export interface GenerarBGInput {
  periodoCorte: string;
  centroCostoId?: string;
}

/* =========================================================================
 * Helpers
 * ========================================================================= */

function mesAnteriorDe(periodo: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo);
  if (!m) return periodo;
  let y = Number(m[1]);
  let mm = Number(m[2]) - 1;
  if (mm < 1) { mm = 12; y -= 1; }
  return `${y}-${String(mm).padStart(2, '0')}`;
}

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

/**
 * F-059: el signo de MAPEO_BS viene a veces como "\n+\n" o "\n–\n"
 * (lección histórica de los singleLineText de Airtable). Normalizamos
 * a "+" | "–" | "" con TRIM agresivo y match flexible.
 */
function normalizarSigno(raw: unknown): SignoLineaBS {
  const s = str(raw).replace(/\s+/g, '').trim();
  if (s === '+') return '+';
  // "–" es U+2013 (en dash). También aceptamos "-" y "−" (U+2212).
  if (s === '–' || s === '-' || s === '−') return '–';
  return '';
}

/* =========================================================================
 * 1) Lectura de PARTIDAS hasta el corte
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

async function leerPartidasHastaPeriodo(periodoCorte: string): Promise<PartidaCruda[]> {
  if (!airtable) return [];
  try {
    // F-BF-004: sin maxRecords. Filtramos en JS por field ID
    // (filterByFormula con field IDs no resuelve — F-050.2).
    const records = await airtable(PARTIDAS_TABLE_ID)
      .select({ returnFieldsByFieldId: true })
      .all();
    const out: PartidaCruda[] = [];
    for (const r of records) {
      const f = r.fields as Record<string, unknown>;
      const periodo = str(f[PARTIDAS_FIELDS.periodo]).trim();
      // El campo periodo es "YYYY-MM"; comparación de strings (F-041).
      if (!periodo || periodo > periodoCorte) continue;
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
    console.warn('F-059 leerPartidasHastaPeriodo falló:', err instanceof Error ? err.message : err);
    return [];
  }
}

/* =========================================================================
 * 2) CUENTAS — saldo natural con NATURALEZA_BS
 * ========================================================================= */

interface CuentaMetaBS {
  id: string;
  codigo: string;
  nombre: string;
  /** Acreedora=true (pasivo/capital, también contra-activo). */
  naturalezaEsAcreedora: boolean;
}

async function leerCuentasMetaBS(): Promise<Map<string, CuentaMetaBS>> {
  if (!airtable) return new Map();
  try {
    const records = await airtable(CUENTAS_TABLE_ID)
      .select({ returnFieldsByFieldId: true })
      .all();
    const m = new Map<string, CuentaMetaBS>();
    for (const r of records) {
      const f = r.fields as Record<string, unknown>;
      const codigo = str(f[CUENTAS_FIELDS.codigo_path]).trim();
      const nombre = str(f[CUENTAS_FIELDS.nombre]).trim();
      const naturaleza = selectName(f[CUENTAS_FIELDS.naturaleza_bs]).trim().toLowerCase();
      const naturalezaEsAcreedora = naturaleza
        ? naturaleza.startsWith('acre')
        : codigo.startsWith('2') || codigo.startsWith('3');  // 2=Pasivo, 3=Capital
      m.set(r.id, { id: r.id, codigo, nombre, naturalezaEsAcreedora });
    }
    return m;
  } catch (err) {
    console.warn('F-059 leerCuentasMetaBS falló:', err instanceof Error ? err.message : err);
    return new Map();
  }
}

/* =========================================================================
 * 3) MAPEO_BS
 * ========================================================================= */

interface LineaMapeoBS {
  id: string;
  nombre: string;
  orden: number;
  tipo: TipoLineaMapeoBS;
  signo: SignoLineaBS;
  cuentasLink: string[];
  prefijos: string;
  centroCostoFijo?: string;
}

async function leerMapeoBS(): Promise<LineaMapeoBS[]> {
  if (!airtable) return [];
  try {
    const records = await airtable(MAPEO_BS_TABLE_ID)
      .select({ returnFieldsByFieldId: true })
      .all();
    const out: LineaMapeoBS[] = [];
    for (const r of records) {
      const f = r.fields as Record<string, unknown>;
      const tipoRaw = selectName(f[MAPEO_BS_FIELDS.tipo]).trim();
      const tipo: TipoLineaMapeoBS = tipoRaw === 'Calculada' ? 'Calculada' : 'Suma cuentas';
      out.push({
        id:               r.id,
        // F-059: TRIM agresivo de la línea — los singleLineText de MAPEO
        // a veces traen \n adentro (lección de los catálogos).
        nombre:           str(f[MAPEO_BS_FIELDS.linea]).replace(/\s+/g, ' ').trim(),
        orden:            num(f[MAPEO_BS_FIELDS.orden]),
        tipo,
        signo:            normalizarSigno(f[MAPEO_BS_FIELDS.signo]),
        cuentasLink:      arrAll(f[MAPEO_BS_FIELDS.cuentas]),
        prefijos:         str(f[MAPEO_BS_FIELDS.prefijos]).trim(),
        centroCostoFijo:  arrFirst(f[MAPEO_BS_FIELDS.centro_costo_fijo]) || undefined,
      });
    }
    out.sort((a, b) => a.orden - b.orden);
    return out;
  } catch (err) {
    console.warn('F-059 leerMapeoBS falló:', err instanceof Error ? err.message : err);
    return [];
  }
}

/* =========================================================================
 * 4) Saldo natural por cuenta (acumulado)
 * ========================================================================= */

interface SaldoCuenta {
  totalDebe: number;
  totalHaber: number;
  /** Σdebe − Σhaber. Signo NATURAL (positivo deudor / negativo acreedor). */
  saldoBruto: number;
  /** Presentación: positivo si la cuenta tiene saldo en su naturaleza. */
  saldoPresentado: number;
}

function saldosPorCuentaBalance(
  partidas: readonly PartidaCruda[],
  cuentasMeta: Map<string, CuentaMetaBS>,
): Map<string, SaldoCuenta> {
  const out = new Map<string, SaldoCuenta>();
  for (const p of partidas) {
    if (!p.cuentaId) continue;
    const actual = out.get(p.cuentaId) ?? { totalDebe: 0, totalHaber: 0, saldoBruto: 0, saldoPresentado: 0 };
    actual.totalDebe  += p.debe;
    actual.totalHaber += p.haber;
    out.set(p.cuentaId, actual);
  }
  for (const [cuentaId, s] of out) {
    const bruto = s.totalDebe - s.totalHaber;
    s.saldoBruto      = round2(bruto);
    s.totalDebe       = round2(s.totalDebe);
    s.totalHaber      = round2(s.totalHaber);
    const meta = cuentasMeta.get(cuentaId);
    s.saldoPresentado = round2(meta?.naturalezaEsAcreedora ? -bruto : bruto);
  }
  return out;
}

/* =========================================================================
 * 5) Resolver línea "Suma cuentas" del balance
 * ========================================================================= */

function resolverSumaCuentasBS(
  linea: LineaMapeoBS,
  saldos: Map<string, SaldoCuenta>,
  cuentasMeta: Map<string, CuentaMetaBS>,
): { monto: number; cuentasIncluidas: string[] } {
  let cuentaIds = linea.cuentasLink.filter(Boolean);

  // Fallback por prefijos (hoy vacío en la data; documentado para futuro).
  if (cuentaIds.length === 0 && linea.prefijos) {
    const prefijos = linea.prefijos
      .split(/[,;\s]+/)
      .map(p => p.trim())
      .filter(Boolean);
    cuentaIds = [...cuentasMeta.values()]
      .filter(c => prefijos.some(p => c.codigo.startsWith(p)))
      .map(c => c.id);
  }

  let suma = 0;
  for (const id of cuentaIds) {
    const s = saldos.get(id);
    if (s) suma += s.saldoPresentado;
  }
  // Signo de MAPEO_BS:
  //   "+" → suma directa (default).
  //   "–" → resta (contra-activos: deprec/amort acumulada).
  //   ""  → tratamos como "+" para no romper si quedó sin setear.
  const factor = linea.signo === '–' ? -1 : 1;
  return { monto: round2(suma * factor), cuentasIncluidas: cuentaIds };
}

/* =========================================================================
 * 6) Subtotales y ecuación contable
 *
 * Convención de orden basada en MAPEO_BS (anchor declarativo):
 *   1-9    Activo Corriente
 *   10-19  Activo No Corriente (PPE bruto, intangibles…)
 *   20-29  Contra-Activo (deprec/amort acumulada, signo '–')
 *   30-39  Pasivo Corriente
 *   40-49  Pasivo No Corriente
 *   50-59  Capital (social, reservas, utilidades retenidas)
 *   65     Resultado del Ejercicio (Calculada, viene del ER YTD)
 *
 * Subtotales/Calculadas:
 *   "Total Activo"           ≈ Σ líneas Suma con orden ∈ [1, 29] (signo ya
 *                              aplicado, los contra-activos restan).
 *   "Total Pasivo"           ≈ Σ líneas Suma con orden ∈ [30, 49].
 *   "Total Capital"          ≈ Σ líneas Suma con orden ∈ [50, 59] + Resultado.
 *   "Total Pasivo + Capital" = Total Pasivo + Total Capital.
 *
 * Tolerancia al renombrado: las "Calculada" se identifican por nombre
 * normalizado, no por orden estricto.
 * ========================================================================= */

function sumarRango(montosPorOrden: Map<number, number>, desde: number, hasta: number): number {
  let s = 0;
  for (const [orden, monto] of montosPorOrden) {
    if (orden >= desde && orden <= hasta) s += monto;
  }
  return round2(s);
}

function calcularSubtotalesBG(
  montosPorOrden: Map<number, number>,
  resultadoEjercicio: number,
): SubtotalesBG {
  const totalActivo        = sumarRango(montosPorOrden, 1, 29);
  const totalPasivo        = sumarRango(montosPorOrden, 30, 49);
  const capitalPropio      = sumarRango(montosPorOrden, 50, 59);
  const totalCapital       = round2(capitalPropio + resultadoEjercicio);
  const totalPasivoCapital = round2(totalPasivo + totalCapital);
  return { totalActivo, totalPasivo, totalCapital, totalPasivoCapital, resultadoEjercicio };
}

function valorCalculadaBG(nombre: string, subt: SubtotalesBG, resultadoEjercicio: number): number {
  const n = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (n.includes('total activo'))                                     return subt.totalActivo;
  if (n.includes('total pasivo + capital')
   || n.includes('total pasivo y capital'))                           return subt.totalPasivoCapital;
  if (n.includes('total pasivo'))                                     return subt.totalPasivo;
  if (n.includes('total capital'))                                    return subt.totalCapital;
  if (n.includes('resultado') && n.includes('ejercicio'))             return resultadoEjercicio;
  return 0;
}

/* =========================================================================
 * 7) Trial balance — control duro de auditoría
 * ========================================================================= */

function construirComprobacion(
  saldos: Map<string, SaldoCuenta>,
  cuentasMeta: Map<string, CuentaMetaBS>,
): BalanceComprobacion {
  const cuentas: CuentaComprobacion[] = [];
  let totalDebe = 0;
  let totalHaber = 0;
  for (const [cuentaId, s] of saldos) {
    if (s.totalDebe === 0 && s.totalHaber === 0) continue;
    const meta = cuentasMeta.get(cuentaId);
    cuentas.push({
      cuentaId,
      codigo:    meta?.codigo ?? '',
      nombre:    meta?.nombre ?? '',
      totalDebe:  s.totalDebe,
      totalHaber: s.totalHaber,
      saldo:      s.saldoBruto,
    });
    totalDebe  += s.totalDebe;
    totalHaber += s.totalHaber;
  }
  cuentas.sort((a, b) => (a.codigo || '').localeCompare(b.codigo || ''));
  const diferencia = round2(totalDebe - totalHaber);
  return {
    cuentas,
    totalDebe:  round2(totalDebe),
    totalHaber: round2(totalHaber),
    cuadra:     Math.abs(diferencia) <= 0.01,
    diferencia,
  };
}

/* =========================================================================
 * 8) Pipeline por período
 * ========================================================================= */

interface ResultadoPeriodoBG {
  montosPorOrden: Map<number, number>;
  cuentasPorOrden: Map<number, string[]>;
  saldos: Map<string, SaldoCuenta>;
  subtotales: SubtotalesBG;
  numPartidas: number;
}

function calcularPeriodoBG(
  partidasAcumuladas: readonly PartidaCruda[],
  mapeo: readonly LineaMapeoBS[],
  cuentasMeta: Map<string, CuentaMetaBS>,
  resultadoEjercicio: number,
): ResultadoPeriodoBG {
  const saldos = saldosPorCuentaBalance(partidasAcumuladas, cuentasMeta);

  const montosPorOrden  = new Map<number, number>();
  const cuentasPorOrden = new Map<number, string[]>();

  for (const linea of mapeo) {
    if (linea.tipo !== 'Suma cuentas') continue;
    const r = resolverSumaCuentasBS(linea, saldos, cuentasMeta);
    montosPorOrden.set(linea.orden, r.monto);
    cuentasPorOrden.set(linea.orden, r.cuentasIncluidas);
  }

  const subtotales = calcularSubtotalesBG(montosPorOrden, resultadoEjercicio);

  for (const linea of mapeo) {
    if (linea.tipo !== 'Calculada') continue;
    montosPorOrden.set(linea.orden, valorCalculadaBG(linea.nombre, subtotales, resultadoEjercicio));
    cuentasPorOrden.set(linea.orden, []);
  }

  return { montosPorOrden, cuentasPorOrden, saldos, subtotales, numPartidas: partidasAcumuladas.length };
}

/* =========================================================================
 * 9) API pública
 * ========================================================================= */

export async function generarBalanceGeneral(input: GenerarBGInput): Promise<BalanceGeneral> {
  const periodoCorte    = input.periodoCorte.slice(0, 7);
  const periodoAnterior = mesAnteriorDe(periodoCorte);

  // En paralelo: mapeo + cuentas + partidas (de toda la historia hasta
  // el corte) + utilidad neta YTD del ER. El ER ya hace su propia
  // paginación de partidas — pagar ese viaje vale por la conexión
  // entre estados, que es la pieza no-negociable.
  const [mapeo, cuentasMeta, partidasHastaCorte, partidasHastaAnterior, erCorte, erAnterior] = await Promise.all([
    leerMapeoBS(),
    leerCuentasMetaBS(),
    leerPartidasHastaPeriodo(periodoCorte),
    leerPartidasHastaPeriodo(periodoAnterior),
    // Sólo importa la Utilidad Neta YTD del modo fiscal — el balance
    // contable se monta sobre el universo completo de partidas.
    generarEstadoResultados({ periodo: periodoCorte,    modo: 'fiscal', centroCostoId: input.centroCostoId }),
    generarEstadoResultados({ periodo: periodoAnterior, modo: 'fiscal', centroCostoId: input.centroCostoId }),
  ]);

  const advertencias: string[] = [];
  if (mapeo.length === 0) advertencias.push('MAPEO_BS vacío. Configurar las líneas en Airtable antes de generar el balance.');

  // Filtro por CC.
  const filtrar = (p: PartidaCruda): boolean =>
    !input.centroCostoId || p.centroCostoId === input.centroCostoId;
  const acumuladasFiltradas = partidasHastaCorte.filter(filtrar);
  const acumuladasAnteriorF = partidasHastaAnterior.filter(filtrar);

  // Resultado del Ejercicio: Utilidad Neta YTD del ER del período de corte.
  // Lo extraemos por nombre normalizado para tolerancia a renombrados.
  const utilidadNetaCorte    = lineaERMonto(erCorte.lineas,    'utilidad neta', 'ytd') ?? 0;
  const utilidadNetaAnterior = lineaERMonto(erAnterior.lineas, 'utilidad neta', 'ytd') ?? 0;

  const resCorte    = calcularPeriodoBG(acumuladasFiltradas, mapeo, cuentasMeta, utilidadNetaCorte);
  const resAnterior = calcularPeriodoBG(acumuladasAnteriorF, mapeo, cuentasMeta, utilidadNetaAnterior);

  const lineas: LineaBG[] = mapeo.map(linea => {
    const monto      = resCorte.montosPorOrden.get(linea.orden) ?? 0;
    const montoAnt   = resAnterior.montosPorOrden.get(linea.orden) ?? 0;
    const variacion  = round2(monto - montoAnt);
    const variacionPct = Math.abs(montoAnt) > 0.01
      ? round2((variacion / Math.abs(montoAnt)) * 100)
      : null;
    return {
      nombre: linea.nombre,
      orden:  linea.orden,
      tipo:   linea.tipo,
      signo:  linea.signo,
      monto, montoAnterior: montoAnt, variacion, variacionPct,
      cuentasIncluidas: resCorte.cuentasPorOrden.get(linea.orden) ?? [],
    };
  });

  // Ecuación contable.
  const dif = round2(resCorte.subtotales.totalActivo - resCorte.subtotales.totalPasivoCapital);
  const ecuacion: EcuacionContable = {
    cuadra: Math.abs(dif) <= 0.01,
    diferencia: dif,
  };
  if (!ecuacion.cuadra && resCorte.numPartidas > 0) {
    advertencias.push(
      `Ecuación contable NO cuadra al corte ${periodoCorte}: ` +
      `Activo=${resCorte.subtotales.totalActivo} ≠ Pasivo+Capital=${resCorte.subtotales.totalPasivoCapital} ` +
      `(Δ=${dif}). Causa común: faltan asientos de apertura / saldos iniciales.`,
    );
  }

  // Balance de comprobación (al corte).
  const comprobacion = construirComprobacion(resCorte.saldos, cuentasMeta);
  if (!comprobacion.cuadra && resCorte.numPartidas > 0) {
    advertencias.push(
      `Balance de comprobación NO cuadra: Σdebe=${comprobacion.totalDebe} ≠ Σhaber=${comprobacion.totalHaber} ` +
      `(Δ=${comprobacion.diferencia}). Revisar asientos del libro antes de tomar decisiones.`,
    );
  }

  return {
    periodoCorte,
    periodoAnterior,
    centroCostoId: input.centroCostoId,
    lineas,
    subtotales: resCorte.subtotales,
    ecuacion,
    comprobacion,
    advertencias,
    conteos: {
      partidasAcumuladas:   resCorte.numPartidas,
      cuentasConMovimiento: comprobacion.cuentas.length,
    },
  };
}

/** Localiza una línea por nombre+columna y devuelve su monto. Tolera renames. */
function lineaERMonto(
  lineas: ReadonlyArray<{ nombre: string; mes: number; mesAnterior: number; ytd: number }>,
  needleNombre: string,
  columna: 'mes' | 'mesAnterior' | 'ytd',
): number | null {
  const q = needleNombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const l = lineas.find(x => x.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(q));
  if (!l) return null;
  return l[columna];
}
