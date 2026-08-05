/**
 * F-057 — Motor de depreciación lineal mensual.
 *
 * Alimenta:
 *  · El PPE neto del Balance General (F-059) — cada cuota suma a la
 *    cuenta de depreciación acumulada, que es contra-activo.
 *  · La línea "Depreciación y Amortización" del Estado de Resultados
 *    (F-058, orden 260) — el gasto del mes.
 *
 * Modelo:
 *  · Línea recta: cuota = (COSTO − VALOR_RESIDUAL) / VIDA_UTIL_MESES.
 *  · No se deprecia antes del mes de FECHA_ADQUISICION.
 *  · La depreciación acumulada NUNCA supera la base depreciable —
 *    última cuota se ajusta al residuo.
 *  · Plano FISCAL (Tasa_Fiscal_Anual_%) corre en paralelo SOLO si la
 *    tasa está cargada; si no, advierte. La fiscal usa COSTO sobre 12
 *    meses como una cuota mensual conservadora (Ley ISR detalle queda
 *    para el contador).
 *  · Idempotencia: el motor no aplica de hecho — la guarda es del
 *    caller (preview vs generador real). El generador con flag debe
 *    re-leer ASIENTOS y abortar si ya existe uno con
 *    ORIGEN='DEPRECIACION' para ese periodo.
 *
 * Función PURA por diseño: lee Airtable pero no escribe. La generación
 * real del asiento queda atrás del flag GENERAR_ASIENTO_DEPRECIACION
 * (depreciacion-config.ts).
 *
 * Reglas honradas:
 *  · F-041: comparación de strings YYYY-MM.
 *  · F-047.2: field IDs estrictos.
 *  · F-BF-004: paginación completa sin cap.
 */

import { airtable } from '@/lib/db/airtable';
import { dataSource } from '@/lib/config/data-source';
import { fetchAll } from '@/lib/supabase/client';

type RowSb = Record<string, unknown>;
const atIdDep = (rel: unknown): string => String((rel as { airtable_id?: string } | null)?.airtable_id ?? '');
import {
  ACTIVOS_FIJOS_TABLE_ID,
  ACTIVOS_FIJOS_FIELDS,
} from '@/lib/airtable/activos-fijos-fields';
import { ASIENTOS_TABLE_ID, ASIENTOS_FIELDS } from '@/lib/airtable/asientos-fields';
import {
  CUENTAS_TABLE_ID,
  CUENTAS_FIELDS,
  DEPRECIACION_ACUMULADA,
} from '@/lib/contabilidad/cuentas-sistema';
import { ORIGEN_ASIENTO_DEPRECIACION } from '@/lib/contabilidad/depreciacion-config';

const round2 = (n: number) => Math.round(n * 100) / 100;

/* =========================================================================
 * Helpers
 * ========================================================================= */

const arrFirst = (v: unknown): string => {
  if (Array.isArray(v) && v.length > 0) {
    const x = v[0];
    if (typeof x === 'string') return x;
    if (x && typeof x === 'object' && 'id' in (x as object)) return String((x as { id?: unknown }).id ?? '');
  }
  return '';
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

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function ultimoDiaDelMes(periodo: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(periodo);
  if (!m) return periodo;
  const y = Number(m[1]);
  const mi = Number(m[2]);
  // new Date(y, mi, 0) = día 0 del mes SIGUIENTE = último del actual.
  // Constructor local, sin shift UTC (F-041).
  const ultimo = new Date(y, mi, 0).getDate();
  return `${m[1]}-${m[2]}-${String(ultimo).padStart(2, '0')}`;
}

/* =========================================================================
 * Tipos públicos
 * ========================================================================= */

export interface CuotaActivo {
  activoId: string;
  nombre: string;
  categoria: string;
  costo: number;
  valorResidual: number;
  baseDepreciable: number;
  vidaUtilMeses: number;
  cuotaTeoricaMensual: number;
  /** Cuota efectiva del mes — ajustada si llega al tope. */
  cuotaMes: number;
  depreciacionAcumuladaAntes: number;
  depreciacionAcumuladaDespues: number;
  valorEnLibrosAntes: number;
  valorEnLibrosDespues: number;
  cuentaActivoId?: string;
  /** Cuenta de gasto (Dr): 6-6-x. La que el activo tiene seteada. */
  cuentaGastoId?: string;
  cuentaGastoCodigo?: string;
  /** Cuenta de depreciación ACUMULADA (Cr) — mapeada por categoría. */
  cuentaAcumuladaId: string;
  cuentaAcumuladaCodigo: string;
  centroCostoId?: string;
  estado: string;
  /** Tras esta cuota, ¿el activo queda totalmente depreciado? */
  llegaAlTope: boolean;
  /** Cuota fiscal mensual (solo si Tasa_Fiscal está cargada). null si no. */
  cuotaFiscalMes: number | null;
  /** Advertencias específicas del activo (vida útil = 0, sin cuenta, etc.). */
  advertencias: string[];
}

export interface PartidaProyectada {
  tipo: 'Dr' | 'Cr';
  cuentaContableId: string;
  cuentaCodigo: string;
  /** Centro de costo solo aplica al Dr — el Cr de acumulada no lleva CC. */
  centroCostoId?: string;
  montoQ: number;
  descripcion: string;
}

export interface DepreciacionMes {
  periodo: string;
  /** Último día del periodo — fecha del asiento. */
  fechaAsiento: string;
  cuotaTotalQ: number;
  cuotaFiscalTotalQ: number;
  activosDepreciando: number;
  activosTotalmenteDepreciados: number;
  activos: CuotaActivo[];
  /** Partidas agrupadas por cuenta para el asiento consolidado. */
  partidasProyectadas: PartidaProyectada[];
  balanceado: boolean;
  /** Asiento ya existe en el período (idempotencia). */
  yaGeneradoEnPeriodo: boolean;
  advertencias: string[];
}

export interface CalcularDepreciacionInput {
  periodo: string;
}

/* =========================================================================
 * Mapeo CATEGORIA → cuenta deprec. acumulada destino
 *
 * La fuente más confiable es el CÓDIGO de Cuenta_Activo del activo:
 *  · prefijo 1-2-2-1 (Cómputo)    → 1-2-2-1 acum cómputo.
 *  · prefijo 1-2-2-*              → 1-2-2-9 catch-all PPE.
 *  · prefijo 1-2-4-1              → 1-2-4-1 amort software.
 *  · prefijo 1-2-4-2              → 1-2-4-2 amort licencias.
 *  · prefijo 1-2-4-*              → 1-2-4-1 default software.
 *
 * Fallback por CATEGORIA (texto del singleSelect) si no podemos resolver
 * por código: "computo"/"computadora" → cómputo; "software" → software;
 * "licencia" → licencias; resto → otras PPE.
 * ========================================================================= */

function mapearCuentaAcumulada(args: {
  cuentaActivoCodigo: string;
  categoria: string;
}): typeof DEPRECIACION_ACUMULADA[keyof typeof DEPRECIACION_ACUMULADA] {
  const codigo = args.cuentaActivoCodigo.trim();
  if (codigo.startsWith('1-2-2-1')) return DEPRECIACION_ACUMULADA.COMPUTO_PPE;
  if (codigo.startsWith('1-2-2'))   return DEPRECIACION_ACUMULADA.OTRAS_PPE;
  if (codigo.startsWith('1-2-4-1')) return DEPRECIACION_ACUMULADA.SOFTWARE;
  if (codigo.startsWith('1-2-4-2')) return DEPRECIACION_ACUMULADA.LICENCIAS;
  if (codigo.startsWith('1-2-4'))   return DEPRECIACION_ACUMULADA.SOFTWARE;

  const cat = normalizar(args.categoria);
  if (cat.includes('comput')) return DEPRECIACION_ACUMULADA.COMPUTO_PPE;
  if (cat.includes('softw'))  return DEPRECIACION_ACUMULADA.SOFTWARE;
  if (cat.includes('licen'))  return DEPRECIACION_ACUMULADA.LICENCIAS;
  return DEPRECIACION_ACUMULADA.OTRAS_PPE;
}

/* =========================================================================
 * Lecturas
 * ========================================================================= */

interface ActivoRaw {
  id: string;
  nombre: string;
  categoria: string;
  fechaAdquisicion: string;
  costo: number;
  valorResidual: number;
  vidaUtilMeses: number;
  centroCostoId?: string;
  cuentaActivoId?: string;
  cuentaDepreciacionId?: string;
  depreciacionAcumulada: number;
  tasaFiscalAnualPct: number | null;
  depreciacionFiscalAcumulada: number;
  estado: string;
}

async function leerActivos(): Promise<ActivoRaw[]> {
  if (dataSource('activos_fijos') === 'supabase') {
    const rows = await fetchAll<RowSb>('activos_fijos', {
      select: '*, centro:centros_costo(airtable_id), cta_act:cuentas!activos_fijos_cuenta_activo_id_fkey(airtable_id), cta_dep:cuentas!activos_fijos_cuenta_depreciacion_id_fkey(airtable_id)',
    });
    return rows.map(r => ({
      id: String(r.airtable_id),
      nombre: String(r.nombre_activo ?? '').trim(),
      categoria: String(r.categoria ?? '').trim(),
      fechaAdquisicion: String(r.fecha_adquisicion ?? '').slice(0, 10),
      costo: Number(r.costo ?? 0),
      valorResidual: Number(r.valor_residual ?? 0),
      vidaUtilMeses: Number(r.vida_util_meses ?? 0),
      centroCostoId: atIdDep(r.centro) || undefined,
      cuentaActivoId: atIdDep(r.cta_act) || undefined,
      cuentaDepreciacionId: atIdDep(r.cta_dep) || undefined,
      depreciacionAcumulada: Number(r.depreciacion_acumulada ?? 0),
      tasaFiscalAnualPct: r.tasa_fiscal_anual === null || r.tasa_fiscal_anual === undefined ? null : Number(r.tasa_fiscal_anual),
      depreciacionFiscalAcumulada: Number(r.depreciacion_fiscal_acum ?? 0),
      estado: String(r.estado ?? '').trim(),
    }));
  }
  if (!airtable) return [];
  try {
    const records = await airtable(ACTIVOS_FIJOS_TABLE_ID)
      .select({ returnFieldsByFieldId: true })
      .all();
    const out: ActivoRaw[] = [];
    for (const r of records) {
      const f = r.fields as Record<string, unknown>;
      const tasaRaw = f[ACTIVOS_FIJOS_FIELDS.tasa_fiscal_anual_pct];
      const tasa = tasaRaw == null || tasaRaw === '' ? null : Number(tasaRaw);
      out.push({
        id:                            r.id,
        nombre:                        str(f[ACTIVOS_FIJOS_FIELDS.name]).trim(),
        categoria:                     selectName(f[ACTIVOS_FIJOS_FIELDS.categoria]).trim(),
        fechaAdquisicion:              str(f[ACTIVOS_FIJOS_FIELDS.fecha_adquisicion]).slice(0, 10),
        costo:                         num(f[ACTIVOS_FIJOS_FIELDS.costo]),
        valorResidual:                 num(f[ACTIVOS_FIJOS_FIELDS.valor_residual]),
        vidaUtilMeses:                 num(f[ACTIVOS_FIJOS_FIELDS.vida_util_meses]),
        centroCostoId:                 arrFirst(f[ACTIVOS_FIJOS_FIELDS.centro_costo]) || undefined,
        cuentaActivoId:                arrFirst(f[ACTIVOS_FIJOS_FIELDS.cuenta_activo]) || undefined,
        cuentaDepreciacionId:          arrFirst(f[ACTIVOS_FIJOS_FIELDS.cuenta_depreciacion]) || undefined,
        depreciacionAcumulada:         num(f[ACTIVOS_FIJOS_FIELDS.depreciacion_acumulada]),
        tasaFiscalAnualPct:            Number.isFinite(tasa as number) ? (tasa as number) : null,
        depreciacionFiscalAcumulada:   num(f[ACTIVOS_FIJOS_FIELDS.depreciacion_fiscal_acum]),
        estado:                        selectName(f[ACTIVOS_FIJOS_FIELDS.estado]).trim(),
      });
    }
    return out;
  } catch (err) {
    console.warn('F-057 leerActivos falló:', err instanceof Error ? err.message : err);
    return [];
  }
}

interface CuentaMin {
  id: string;
  codigo: string;
  nombre: string;
}

async function leerCuentas(): Promise<Map<string, CuentaMin>> {
  if (dataSource('cuentas') === 'supabase') {
    const rows = await fetchAll<RowSb>('cuentas', { select: 'airtable_id, codigo_path, nombre' });
    const m = new Map<string, CuentaMin>();
    for (const r of rows) {
      m.set(String(r.airtable_id), {
        id: String(r.airtable_id),
        codigo: String(r.codigo_path ?? '').trim(),
        nombre: String(r.nombre ?? '').trim(),
      });
    }
    return m;
  }
  if (!airtable) return new Map();
  try {
    const records = await airtable(CUENTAS_TABLE_ID)
      .select({ returnFieldsByFieldId: true })
      .all();
    const m = new Map<string, CuentaMin>();
    for (const r of records) {
      const f = r.fields as Record<string, unknown>;
      m.set(r.id, {
        id:     r.id,
        codigo: str(f[CUENTAS_FIELDS.codigo_path]).trim(),
        nombre: str(f[CUENTAS_FIELDS.nombre]).trim(),
      });
    }
    return m;
  } catch (err) {
    console.warn('F-057 leerCuentas falló:', err instanceof Error ? err.message : err);
    return new Map();
  }
}

/**
 * Idempotencia: ¿ya existe un asiento con ORIGEN='DEPRECIACION' en
 * el período? Si sí, marcamos `yaGeneradoEnPeriodo: true` y el flag
 * de generación debe abortar.
 *
 * Lee ASIENTOS y filtra en JS por field ID (ORIGEN + PERIODO).
 */
async function existeAsientoDepreciacionEnPeriodo(periodo: string): Promise<boolean> {
  if (dataSource('asientos') === 'supabase') {
    const rows = await fetchAll<RowSb>('asientos', { select: 'origen, fecha_asiento' });
    return rows.some(r =>
      String(r.origen ?? '').trim() === ORIGEN_ASIENTO_DEPRECIACION &&
      String(r.fecha_asiento ?? '').slice(0, 7) === periodo);
  }
  if (!airtable) return false;
  try {
    const records = await airtable(ASIENTOS_TABLE_ID)
      .select({ returnFieldsByFieldId: true })
      .all();
    for (const r of records) {
      const f = r.fields as Record<string, unknown>;
      const origen = selectName(f[ASIENTOS_FIELDS.origen]).trim();
      if (origen !== ORIGEN_ASIENTO_DEPRECIACION) continue;
      // ASIENTOS.periodo es multipleRecordLinks (link a PERIODOS).
      // No matcheamos por nombre — usamos el rango de fecha del
      // asiento contra el periodo "YYYY-MM" como prueba secundaria.
      const fecha = str(f[ASIENTOS_FIELDS.fecha_asiento]).slice(0, 7);
      if (fecha === periodo) return true;
    }
    return false;
  } catch (err) {
    console.warn('F-057 existeAsientoDepreciacionEnPeriodo falló:', err instanceof Error ? err.message : err);
    return false;
  }
}

/* =========================================================================
 * Cálculo de la cuota de un activo
 * ========================================================================= */

interface ContextoCalculo {
  periodo: string;
  cuentas: Map<string, CuentaMin>;
}

function calcularCuotaActivo(a: ActivoRaw, ctx: ContextoCalculo): CuotaActivo {
  const advertencias: string[] = [];

  const cuentaActivo = a.cuentaActivoId ? ctx.cuentas.get(a.cuentaActivoId) : undefined;
  const cuentaGasto  = a.cuentaDepreciacionId ? ctx.cuentas.get(a.cuentaDepreciacionId) : undefined;
  const acum = mapearCuentaAcumulada({
    cuentaActivoCodigo: cuentaActivo?.codigo ?? '',
    categoria: a.categoria,
  });

  // 1) Base depreciable.
  const baseDepreciable = round2(a.costo - a.valorResidual);
  if (baseDepreciable <= 0) {
    advertencias.push('Base depreciable ≤ 0 (COSTO ≤ VALOR_RESIDUAL).');
  }
  if (!(a.vidaUtilMeses > 0)) {
    advertencias.push('VIDA_UTIL_MESES inválida (debe ser > 0).');
  }
  if (!a.fechaAdquisicion) {
    advertencias.push('FECHA_ADQUISICION vacía — no se puede determinar inicio.');
  }
  if (!cuentaGasto) {
    advertencias.push('Cuenta_Depreciacion del activo no está seteada — falta cuenta de gasto (Dr).');
  }

  // 2) Cuota teórica mensual.
  const cuotaTeoricaMensual = a.vidaUtilMeses > 0 ? round2(baseDepreciable / a.vidaUtilMeses) : 0;

  // 3) ¿El periodo es anterior a la adquisición? No depreciar.
  const periodoAdq = a.fechaAdquisicion.slice(0, 7);
  const yaAdquirido = !!periodoAdq && periodoAdq <= ctx.periodo;

  // 4) Tope: deprec_acum no debe superar baseDepreciable.
  const depAcumAntes = round2(a.depreciacionAcumulada);
  const restante = round2(Math.max(0, baseDepreciable - depAcumAntes));
  let cuotaMes = 0;
  if (yaAdquirido && cuotaTeoricaMensual > 0 && restante > 0.01) {
    cuotaMes = round2(Math.min(cuotaTeoricaMensual, restante));
  }
  const depAcumDespues = round2(depAcumAntes + cuotaMes);
  const llegaAlTope = cuotaMes > 0 && depAcumDespues >= round2(baseDepreciable) - 0.01;

  // 5) Valor en libros.
  const valorEnLibrosAntes   = round2(a.costo - depAcumAntes);
  const valorEnLibrosDespues = round2(a.costo - depAcumDespues);

  // 6) Plano fiscal: cuota_mes_fiscal = COSTO * tasa / 12. Conservador;
  //    el contador puede refinar la fórmula (Ley ISR detalle) sin tocar
  //    el motor — solo cambia la tasa.
  let cuotaFiscalMes: number | null = null;
  if (yaAdquirido && a.tasaFiscalAnualPct != null && a.tasaFiscalAnualPct > 0) {
    // En Airtable el campo "percent" llega como 0.10 (10%), no 10.
    const tasa = a.tasaFiscalAnualPct > 1 ? a.tasaFiscalAnualPct / 100 : a.tasaFiscalAnualPct;
    const cuotaFiscalTeorica = round2((a.costo * tasa) / 12);
    const restanteFiscal = round2(Math.max(0, a.costo - a.depreciacionFiscalAcumulada));
    cuotaFiscalMes = round2(Math.min(cuotaFiscalTeorica, restanteFiscal));
    if (cuotaFiscalMes < 0) cuotaFiscalMes = 0;
  } else if (yaAdquirido) {
    advertencias.push('Tasa fiscal pendiente (contador) — plano fiscal sin calcular.');
  }

  return {
    activoId: a.id,
    nombre: a.nombre,
    categoria: a.categoria,
    costo: a.costo,
    valorResidual: a.valorResidual,
    baseDepreciable,
    vidaUtilMeses: a.vidaUtilMeses,
    cuotaTeoricaMensual,
    cuotaMes,
    depreciacionAcumuladaAntes:    depAcumAntes,
    depreciacionAcumuladaDespues:  depAcumDespues,
    valorEnLibrosAntes,
    valorEnLibrosDespues,
    cuentaActivoId:        a.cuentaActivoId,
    cuentaGastoId:         a.cuentaDepreciacionId,
    cuentaGastoCodigo:     cuentaGasto?.codigo,
    cuentaAcumuladaId:     acum.recordId,
    cuentaAcumuladaCodigo: acum.codigo,
    centroCostoId:         a.centroCostoId,
    estado:                a.estado || 'Activo',
    llegaAlTope,
    cuotaFiscalMes,
    advertencias,
  };
}

/* =========================================================================
 * Consolidación de partidas (Dr/Cr agrupadas por cuenta)
 * ========================================================================= */

function proyectarPartidas(cuotas: readonly CuotaActivo[]): PartidaProyectada[] {
  // Agrupar Dr por (cuenta de gasto + centro de costo) — el CC del Dr
  // permite distribución por línea de negocio. Cr agrupado por cuenta
  // de acumulada (no lleva CC).
  type AggDr = { cuentaId: string; cuentaCodigo: string; centroCostoId?: string; monto: number; activos: number };
  type AggCr = { cuentaId: string; cuentaCodigo: string; monto: number; activos: number };
  const drMap = new Map<string, AggDr>();
  const crMap = new Map<string, AggCr>();

  for (const c of cuotas) {
    if (c.cuotaMes <= 0) continue;
    if (!c.cuentaGastoId || !c.cuentaGastoCodigo) continue;  // sin Dr: se reporta en advertencias

    const keyDr = `${c.cuentaGastoId}|${c.centroCostoId ?? ''}`;
    const dr = drMap.get(keyDr) ?? {
      cuentaId: c.cuentaGastoId,
      cuentaCodigo: c.cuentaGastoCodigo,
      centroCostoId: c.centroCostoId,
      monto: 0,
      activos: 0,
    };
    dr.monto = round2(dr.monto + c.cuotaMes);
    dr.activos += 1;
    drMap.set(keyDr, dr);

    const keyCr = c.cuentaAcumuladaId;
    const cr = crMap.get(keyCr) ?? {
      cuentaId: c.cuentaAcumuladaId,
      cuentaCodigo: c.cuentaAcumuladaCodigo,
      monto: 0,
      activos: 0,
    };
    cr.monto = round2(cr.monto + c.cuotaMes);
    cr.activos += 1;
    crMap.set(keyCr, cr);
  }

  const out: PartidaProyectada[] = [];
  for (const dr of drMap.values()) {
    out.push({
      tipo: 'Dr',
      cuentaContableId: dr.cuentaId,
      cuentaCodigo:     dr.cuentaCodigo,
      centroCostoId:    dr.centroCostoId,
      montoQ:           dr.monto,
      descripcion:      `Depreciación del mes (${dr.activos} ${dr.activos === 1 ? 'activo' : 'activos'})`,
    });
  }
  for (const cr of crMap.values()) {
    out.push({
      tipo: 'Cr',
      cuentaContableId: cr.cuentaId,
      cuentaCodigo:     cr.cuentaCodigo,
      montoQ:           cr.monto,
      descripcion:      `Depreciación acumulada — ${cr.cuentaCodigo} (${cr.activos} ${cr.activos === 1 ? 'activo' : 'activos'})`,
    });
  }
  return out;
}

/* =========================================================================
 * API pública
 * ========================================================================= */

export async function calcularDepreciacionMes(input: CalcularDepreciacionInput): Promise<DepreciacionMes> {
  const periodo = input.periodo.slice(0, 7);

  const [activos, cuentas, yaGenerado] = await Promise.all([
    leerActivos(),
    leerCuentas(),
    existeAsientoDepreciacionEnPeriodo(periodo),
  ]);

  // Filtramos: solo activos en estado "Activo" generan cuota. Los otros
  // estados (Totalmente depreciado, Dado de baja, Vendido) los reportamos
  // en el agregado pero con cuotaMes=0.
  const ctx: ContextoCalculo = { periodo, cuentas };
  const cuotas = activos
    .filter(a => normalizar(a.estado) === 'activo' || a.estado === '')
    .map(a => calcularCuotaActivo(a, ctx));

  const activosDepreciando = cuotas.filter(c => c.cuotaMes > 0).length;
  const activosTotalmenteDepreciados = cuotas.filter(c => c.cuotaMes === 0 && c.depreciacionAcumuladaAntes >= round2(c.baseDepreciable) - 0.01).length;
  const cuotaTotalQ = round2(cuotas.reduce((s, c) => s + c.cuotaMes, 0));
  const cuotaFiscalTotalQ = round2(cuotas.reduce((s, c) => s + (c.cuotaFiscalMes ?? 0), 0));

  const partidasProyectadas = proyectarPartidas(cuotas);
  const totalDr = round2(partidasProyectadas.filter(p => p.tipo === 'Dr').reduce((s, p) => s + p.montoQ, 0));
  const totalCr = round2(partidasProyectadas.filter(p => p.tipo === 'Cr').reduce((s, p) => s + p.montoQ, 0));
  const balanceado = Math.abs(totalDr - totalCr) <= 0.01;

  const advertencias: string[] = [];
  if (yaGenerado) {
    advertencias.push(`Ya existe un asiento con ORIGEN='${ORIGEN_ASIENTO_DEPRECIACION}' en ${periodo}. Idempotencia: no se debe generar otro.`);
  }
  if (cuotas.some(c => c.advertencias.length > 0) && cuotaTotalQ === 0) {
    advertencias.push('Los activos del catálogo tienen advertencias y la cuota total es 0. Revisar configuración antes de generar.');
  }
  if (!balanceado && partidasProyectadas.length > 0) {
    advertencias.push(`Partidas proyectadas NO balanceadas: Dr=${totalDr} ≠ Cr=${totalCr}.`);
  }
  if (cuotas.some(c => c.advertencias.includes('Tasa fiscal pendiente (contador) — plano fiscal sin calcular.'))) {
    advertencias.push('Tasa fiscal pendiente del contador — plano fiscal incompleto (no bloquea el contable).');
  }

  return {
    periodo,
    fechaAsiento: ultimoDiaDelMes(periodo),
    cuotaTotalQ,
    cuotaFiscalTotalQ,
    activosDepreciando,
    activosTotalmenteDepreciados,
    activos: cuotas,
    partidasProyectadas,
    balanceado,
    yaGeneradoEnPeriodo: yaGenerado,
    advertencias,
  };
}
