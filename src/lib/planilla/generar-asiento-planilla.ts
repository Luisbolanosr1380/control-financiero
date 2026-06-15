/**
 * F-056.2 — Generador real del asiento de planilla (multi-empresa).
 *
 * Convierte el módulo de proyección F-056 (proyectar-asiento.ts) en el
 * generador que ESCRIBE ASIENTO + PARTIDAS a Airtable. Mientras
 * GENERAR_ASIENTO_PLANILLA=false (default), el motor calcula y devuelve
 * el preview en seco; con flag on, persiste.
 *
 * Reglas del contador (jun-2026):
 *  1. IGSS patronal va en el MISMO asiento de la quincena.
 *  2. Cr Banco directo (no contra "sueldos por pagar"). Σ que sale del
 *     banco = base de gasto (ordinario + bonif + extra + comisiones +
 *     otros ingresos + IGSS patronal estimado de la quincena).
 *  3. Nómina operativa = costo de ventas (5-x); admin = gasto (6-x).
 *
 * Estructura del asiento:
 *   Por cada combinación (cuenta_nomina, centro_costo) con monto > 0:
 *     Dr  cuenta_nomina   [Σ base_gasto del grupo]   centro_costo
 *   Por cada empresa intercompany con líneas (HIT/Poligrafy/BYDSA):
 *     Dr  1-1-3-3-x CxC [empresa]   [Σ neto_pagar de sus líneas]
 *   Cr  Cuenta_Contable del Banco   [Σ Dr]
 *
 * Idempotencia: si la planilla ya tiene un asiento de ORIGEN='PLANILLA'
 * vinculado al período + quincena, abortar. Una planilla = un asiento.
 *
 * Reglas honradas:
 *  · F-041: comparación de strings YYYY-MM-DD para fechas.
 *  · F-047.2: lectura/escritura por field ID con returnFieldsByFieldId.
 *  · F-BF-004: paginación completa sin cap.
 */

import { airtable } from '@/lib/db/airtable';
import {
  ASIENTOS_TABLE_ID,
  ASIENTOS_FIELDS,
  PARTIDAS_TABLE_ID,
  PARTIDAS_FIELDS,
  type OrigenAsiento,
} from '@/lib/airtable/asientos-fields';
import { BANCOS_TABLE_ID, BANCOS_FIELDS } from '@/lib/airtable/bancos-fields';
import { getCuentas } from '@/lib/db/cuentas';
import {
  CXC_INTERCOMPANY,
  type EmpresaIntercompany,
} from '@/lib/contabilidad/cuentas-sistema';
import {
  GENERAR_ASIENTO_PLANILLA,
  ORIGEN_ASIENTO_PLANILLA,
  CUENTAS_NOMINA_GOLDEN_POR_CC,
  PREFIJOS_NOMINA_GOLDEN,
} from './planilla-config';
import {
  normalizarEmpresa,
  esGolden,
  type EmpresaEmpleadora,
} from '@/lib/empleados/empresa';
import { TABLES } from '@/lib/db/airtable';

const round2 = (n: number) => Math.round(n * 100) / 100;

/* =========================================================================
 * Tipos públicos
 * ========================================================================= */

export interface LineaPlanillaInput {
  /** record-id de la línea de PLANILLA. */
  id: string;
  empleadoId: string;
  centroCostoId?: string;
  ordinario: number;
  bonificacion: number;
  extraordinario: number;
  comisiones: number;
  otrosIngresos: number;
  igssLaboral: number;
  isr: number;
  netoPagar: number;
}

export interface EmpleadoInput {
  id: string;
  nombre: string;
  empresaEmpleadora?: EmpresaEmpleadora | string;
  /** IGSS patronal MENSUAL del empleado. Se divide /2 para la quincena. */
  igssPatronal: number;
  /** Centro de costo del empleado (override si la línea no lo tiene). */
  centroCostoId?: string;
}

export interface GenerarAsientoPlanillaInput {
  /** record-id del PERIODO (PERIODOS table). */
  periodoId: string;
  /** "Q1-junio-2026" — nombre legible. Usado en descripción y validaciones. */
  periodoNombre: string;
  /** Fecha del asiento (YYYY-MM-DD). Default: último día del mes del período. */
  fechaAsiento: string;
  /** Líneas de planilla a contabilizar. */
  lineas: LineaPlanillaInput[];
  /** Empleados (id → empresa + CC + IGSS patronal). */
  empleados: EmpleadoInput[];
  /** record-id del BANCO desde el que se paga (su CUENTA_CONTABLE es el Cr). */
  bancoId: string;
}

export type CategoriaDebito = 'nomina_golden' | 'cxc_intercompany';

export interface PartidaPlanillaProyectada {
  tipo: 'Dr' | 'Cr';
  categoria: CategoriaDebito | 'banco';
  cuentaContableId: string;
  cuentaCodigo: string;
  centroCostoId?: string;
  empresa?: EmpresaEmpleadora;
  montoQ: number;
  descripcion: string;
  /** Cantidad de líneas que aportan a este Dr. Para auditoría. */
  numLineas?: number;
}

export interface PreviewAsientoPlanilla {
  periodoNombre: string;
  fechaAsiento: string;
  bancoId: string;
  /** Cuenta contable del banco (Cr). */
  cuentaBancoId: string;
  cuentaBancoCodigo: string;
  partidas: PartidaPlanillaProyectada[];
  totalDr: number;
  totalCr: number;
  balanceado: boolean;
  /** Si la planilla YA tiene un asiento contabilizado en este período. */
  yaContabilizada: boolean;
  /** ID del asiento existente si yaContabilizada=true. */
  asientoExistenteId?: string;
  advertencias: string[];
  /** Desglose por empresa empleadora para banner UI. */
  porEmpresa: Array<{ empresa: EmpresaEmpleadora; totalQ: number; numLineas: number }>;
}

export type ResultadoGeneracion =
  | { ok: true; previa: PreviewAsientoPlanilla; asientoId: string; numPartidas: number; }
  | { ok: false; previa?: PreviewAsientoPlanilla; error: string; };

/* =========================================================================
 * Helpers de Airtable
 * ========================================================================= */

const arrFirst = (v: unknown): string => {
  if (Array.isArray(v) && v.length > 0) {
    const x = v[0];
    if (typeof x === 'string') return x;
    if (x && typeof x === 'object' && 'id' in (x as object)) return String((x as { id?: unknown }).id ?? '');
  }
  return '';
};
const selectName = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'name' in (v as object)) return String((v as { name?: unknown }).name ?? '');
  return '';
};

/**
 * Devuelve la cuenta_contable (recordId) del banco. Reusa el patrón
 * de generar-asiento-factura-compra: select + filterByFormula con
 * RECORD_ID() (fórmula function, NO field reference) + returnFieldsByFieldId.
 */
async function cuentaContableDelBanco(bancoId: string): Promise<{ id: string; codigo: string }> {
  if (!airtable) throw new Error('Airtable no está configurado.');
  const records = await airtable(BANCOS_TABLE_ID)
    .select({
      returnFieldsByFieldId: true,
      filterByFormula: `RECORD_ID() = '${bancoId}'`,
      maxRecords: 1,
    })
    .all();
  if (records.length === 0) throw new Error(`Banco ${bancoId} no encontrado.`);
  const link = (records[0].fields as Record<string, unknown>)[BANCOS_FIELDS.cuenta_contable];
  const cuentaId = arrFirst(link);
  if (!cuentaId) {
    throw new Error(`Banco ${bancoId} sin CUENTA_CONTABLE configurada. Asignala en BANCOS antes de generar el asiento.`);
  }
  // Resolver código.
  const todas = await getCuentas();
  const cuenta = todas.find(c => c.id === cuentaId);
  return { id: cuentaId, codigo: cuenta?.codigo ?? '' };
}

/**
 * Idempotencia: ¿ya existe un asiento de ORIGEN='PLANILLA' vinculado al
 * período dado? Buscamos en ASIENTOS por origen + periodo (link).
 */
async function asientoExistenteParaPeriodo(periodoId: string): Promise<string | null> {
  if (!airtable) return null;
  try {
    const records = await airtable(ASIENTOS_TABLE_ID)
      .select({ returnFieldsByFieldId: true })
      .all();
    for (const r of records) {
      const f = r.fields as Record<string, unknown>;
      const origen = selectName(f[ASIENTOS_FIELDS.origen]).trim();
      if (origen !== ORIGEN_ASIENTO_PLANILLA) continue;
      const periodoLink = f[ASIENTOS_FIELDS.periodo];
      if (Array.isArray(periodoLink) && periodoLink.length > 0) {
        const linkId = arrFirst(periodoLink);
        if (linkId === periodoId) return r.id;
      }
    }
    return null;
  } catch (err) {
    console.warn('F-056.2 asientoExistenteParaPeriodo falló:', err instanceof Error ? err.message : err);
    return null;
  }
}

/* =========================================================================
 * Mapeo CC → cuenta de nómina Golden
 * ========================================================================= */

interface CuentaNominaGolden { recordId: string; codigo: string; nombre: string; }

async function resolverCuentasNominaGolden(): Promise<{
  porCCNombre: Map<string, CuentaNominaGolden>;
  administrativo: CuentaNominaGolden | undefined;
}> {
  // Las 3 operativas vienen hardcoded en PLANILLA_CONFIG (recordIds del brief).
  // 6-1-1 (Administrativo) se resuelve por prefijo en runtime.
  const todas = await getCuentas();
  const porPrefijo = (pfx: string): CuentaNominaGolden | undefined => {
    const c = todas.find(x => x.codigo.startsWith(pfx));
    return c ? { recordId: c.id, codigo: c.codigo, nombre: c.nombre } : undefined;
  };
  const admin = porPrefijo(PREFIJOS_NOMINA_GOLDEN.ADMINISTRATIVO);

  // Mapa por NOMBRE NORMALIZADO de CC para resolver desde el centro de
  // costo del empleado/línea. Tolerante a renames de "Poligrafía" vs
  // "Poligrafia" — match por inclusión sin acentos.
  const porCCNombre = new Map<string, CuentaNominaGolden>();
  porCCNombre.set('poligraf',  { ...CUENTAS_NOMINA_GOLDEN_POR_CC.POLIGRAFIA });
  porCCNombre.set('socio',     { ...CUENTAS_NOMINA_GOLDEN_POR_CC.SOCIOECONOMICOS });
  porCCNombre.set('talent',    { ...CUENTAS_NOMINA_GOLDEN_POR_CC.TALENTTRACK });
  if (admin) porCCNombre.set('admin', admin);

  return { porCCNombre, administrativo: admin };
}

/* =========================================================================
 * Construcción del preview
 * ========================================================================= */

interface ContextoConstruccion {
  empleadosById: Map<string, EmpleadoInput>;
  cuentasGolden: Map<string, CuentaNominaGolden>;
  administrativo: CuentaNominaGolden | undefined;
  centroNombrePorId: Map<string, string>;
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function cuentaGoldenParaCC(ccNombre: string, ctx: ContextoConstruccion): CuentaNominaGolden | undefined {
  const n = normalizar(ccNombre);
  if (!n) return ctx.administrativo;
  for (const [key, cuenta] of ctx.cuentasGolden) {
    if (n.includes(key)) return cuenta;
  }
  return ctx.administrativo;
}

/**
 * Base del gasto por línea (lo que Dr a la cuenta de nómina):
 *   ordinario + bonificación + extraordinario + comisiones + otros
 *   ingresos + IGSS patronal estimado de la quincena (igssPatronal/2).
 *
 * Cr Banco = lo mismo (banco directo: empleado recibe NETO_PAGAR;
 * IGSS laboral + ISR salen del mismo banco a las instituciones).
 *
 * Para líneas INTERCOMPANY el monto del Dr es solo netoPagar (la
 * empresa hermana reembolsa lo que Golden adelantó al empleado; el
 * IGSS patronal/laboral lo lleva la empresa hermana en su libro).
 */
function baseGastoGolden(linea: LineaPlanillaInput, emp: EmpleadoInput | undefined): number {
  const sueldoBruto =
      linea.ordinario
    + linea.bonificacion
    + linea.extraordinario
    + linea.comisiones
    + linea.otrosIngresos;
  const igssPatronalQuincena = (emp?.igssPatronal ?? 0) / 2;
  return round2(sueldoBruto + igssPatronalQuincena);
}

interface GrupoDebito {
  tipo: 'nomina_golden' | 'cxc_intercompany';
  cuentaId: string;
  cuentaCodigo: string;
  centroCostoId?: string;
  empresa?: EmpresaEmpleadora;
  monto: number;
  numLineas: number;
}

function construirGrupos(
  input: GenerarAsientoPlanillaInput,
  ctx: ContextoConstruccion,
): { grupos: GrupoDebito[]; advertencias: string[]; porEmpresa: PreviewAsientoPlanilla['porEmpresa'] } {
  const advertencias: string[] = [];
  const grupos = new Map<string, GrupoDebito>();
  const aggEmpresa = new Map<EmpresaEmpleadora, { totalQ: number; numLineas: number }>();

  for (const linea of input.lineas) {
    const emp = ctx.empleadosById.get(linea.empleadoId);
    if (!emp) {
      advertencias.push(`Empleado ${linea.empleadoId} no resuelto — línea omitida.`);
      continue;
    }
    const empresa = normalizarEmpresa(emp.empresaEmpleadora);

    if (esGolden(empresa)) {
      const base = baseGastoGolden(linea, emp);
      if (base <= 0) continue;
      const ccId = linea.centroCostoId || emp.centroCostoId || '';
      const ccNombre = ccId ? (ctx.centroNombrePorId.get(ccId) ?? '') : '';
      const cuenta = cuentaGoldenParaCC(ccNombre, ctx);
      if (!cuenta) {
        advertencias.push(`Empleado ${emp.nombre}: sin cuenta de nómina Golden mapeada (CC="${ccNombre || '(sin CC)'}") — línea omitida.`);
        continue;
      }
      // Pendiente / sin CC → Administrativo + advertencia.
      if (!ccId || /pendient/i.test(ccNombre)) {
        advertencias.push(`Empleado ${emp.nombre} tiene CC vacío o "Pendiente" — se carga a Administrativo. Reasignar el CC antes de aprobar.`);
      }

      const key = `golden|${cuenta.recordId}|${ccId}`;
      const g = grupos.get(key) ?? {
        tipo:           'nomina_golden' as const,
        cuentaId:       cuenta.recordId,
        cuentaCodigo:   cuenta.codigo,
        centroCostoId:  ccId || undefined,
        monto:          0,
        numLineas:      0,
      };
      g.monto = round2(g.monto + base);
      g.numLineas += 1;
      grupos.set(key, g);

      const agg = aggEmpresa.get(empresa) ?? { totalQ: 0, numLineas: 0 };
      agg.totalQ = round2(agg.totalQ + base);
      agg.numLineas += 1;
      aggEmpresa.set(empresa, agg);
    } else {
      // Intercompany: Dr CxC por monto NETO_PAGAR (lo que Golden adelanta).
      const monto = round2(linea.netoPagar);
      if (monto <= 0) continue;
      const conf = (CXC_INTERCOMPANY as Record<string, typeof CXC_INTERCOMPANY[EmpresaIntercompany]>)[empresa];
      if (!conf) {
        advertencias.push(`Empleado ${emp.nombre} (${empresa}) sin cuenta CxC intercompany mapeada — línea omitida.`);
        continue;
      }
      const key = `cxc|${conf.recordId}`;
      const g = grupos.get(key) ?? {
        tipo:           'cxc_intercompany' as const,
        cuentaId:       conf.recordId,
        cuentaCodigo:   conf.codigo,
        empresa,
        monto:          0,
        numLineas:      0,
      };
      g.monto = round2(g.monto + monto);
      g.numLineas += 1;
      grupos.set(key, g);

      const agg = aggEmpresa.get(empresa) ?? { totalQ: 0, numLineas: 0 };
      agg.totalQ = round2(agg.totalQ + monto);
      agg.numLineas += 1;
      aggEmpresa.set(empresa, agg);
    }
  }

  // Orden estable: nómina Golden primero (por código), luego intercompany.
  const lista = [...grupos.values()].sort((a, b) => {
    if (a.tipo !== b.tipo) return a.tipo === 'nomina_golden' ? -1 : 1;
    return a.cuentaCodigo.localeCompare(b.cuentaCodigo);
  });

  const porEmpresa: PreviewAsientoPlanilla['porEmpresa'] = [];
  for (const [empresa, v] of aggEmpresa) {
    porEmpresa.push({ empresa, totalQ: v.totalQ, numLineas: v.numLineas });
  }
  porEmpresa.sort((a, b) => {
    const ga = esGolden(a.empresa) ? 0 : 1;
    const gb = esGolden(b.empresa) ? 0 : 1;
    if (ga !== gb) return ga - gb;
    return a.empresa.localeCompare(b.empresa);
  });

  return { grupos: lista, advertencias, porEmpresa };
}

/* =========================================================================
 * Centros de costo: cargar nombres
 * ========================================================================= */

async function leerCentrosNombre(): Promise<Map<string, string>> {
  if (!airtable) return new Map();
  try {
    const records = await airtable(TABLES.CENTROS_COSTO).select({ fields: ['NOMBRE'] }).all();
    const m = new Map<string, string>();
    for (const r of records) {
      const f = r.fields as Record<string, unknown>;
      m.set(r.id, String(f.NOMBRE ?? '').trim());
    }
    return m;
  } catch (err) {
    console.warn('F-056.2 leerCentrosNombre falló:', err instanceof Error ? err.message : err);
    return new Map();
  }
}

/* =========================================================================
 * API: PREVIEW (sin escribir)
 * ========================================================================= */

export async function previewAsientoPlanilla(input: GenerarAsientoPlanillaInput): Promise<PreviewAsientoPlanilla> {
  const advertencias: string[] = [];

  const [
    { porCCNombre, administrativo },
    cuentaBanco,
    centroNombrePorId,
    asientoExistenteId,
  ] = await Promise.all([
    resolverCuentasNominaGolden(),
    cuentaContableDelBanco(input.bancoId).catch(err => {
      advertencias.push(err instanceof Error ? err.message : String(err));
      return { id: '', codigo: '' };
    }),
    leerCentrosNombre(),
    asientoExistenteParaPeriodo(input.periodoId),
  ]);

  if (!administrativo) {
    advertencias.push('Cuenta administrativa 6-1-1 no encontrada en CUENTAS. Crearla antes de generar.');
  }

  const ctx: ContextoConstruccion = {
    empleadosById:   new Map(input.empleados.map(e => [e.id, e])),
    cuentasGolden:   porCCNombre,
    administrativo,
    centroNombrePorId,
  };

  const { grupos, advertencias: advGrupos, porEmpresa } = construirGrupos(input, ctx);
  advertencias.push(...advGrupos);

  // Construir partidas Dr.
  const partidas: PartidaPlanillaProyectada[] = [];
  for (const g of grupos) {
    if (g.monto <= 0) continue;
    partidas.push({
      tipo:             'Dr',
      categoria:        g.tipo,
      cuentaContableId: g.cuentaId,
      cuentaCodigo:     g.cuentaCodigo,
      centroCostoId:    g.centroCostoId,
      empresa:          g.empresa,
      montoQ:           g.monto,
      descripcion:      g.tipo === 'nomina_golden'
                          ? `Sueldos ${g.cuentaCodigo} — ${input.periodoNombre} (${g.numLineas} ${g.numLineas === 1 ? 'empleado' : 'empleados'})`
                          : `Quincena ${input.periodoNombre} por cuenta de ${g.empresa} (${g.numLineas} ${g.numLineas === 1 ? 'empleado' : 'empleados'})`,
      numLineas:        g.numLineas,
    });
  }
  const totalDr = round2(partidas.reduce((s, p) => s + p.montoQ, 0));

  // Cr Banco por el total.
  if (cuentaBanco.id && totalDr > 0) {
    partidas.push({
      tipo:             'Cr',
      categoria:        'banco',
      cuentaContableId: cuentaBanco.id,
      cuentaCodigo:     cuentaBanco.codigo,
      montoQ:           totalDr,
      descripcion:      `Pago planilla ${input.periodoNombre} — banco directo`,
    });
  }

  const totalCr = round2(partidas.filter(p => p.tipo === 'Cr').reduce((s, p) => s + p.montoQ, 0));
  const balanceado = Math.abs(totalDr - totalCr) <= 0.01;
  if (!balanceado && partidas.length > 0) {
    advertencias.push(`Asiento NO balanceado: Dr=${totalDr} ≠ Cr=${totalCr}. Revisar antes de generar.`);
  }
  if (asientoExistenteId) {
    advertencias.push(`Este período ya tiene un asiento ORIGEN=${ORIGEN_ASIENTO_PLANILLA} vinculado (${asientoExistenteId}). Idempotencia: no se debe regenerar.`);
  }

  return {
    periodoNombre:        input.periodoNombre,
    fechaAsiento:         input.fechaAsiento,
    bancoId:              input.bancoId,
    cuentaBancoId:        cuentaBanco.id,
    cuentaBancoCodigo:    cuentaBanco.codigo,
    partidas,
    totalDr,
    totalCr,
    balanceado,
    yaContabilizada:      !!asientoExistenteId,
    asientoExistenteId:   asientoExistenteId ?? undefined,
    advertencias,
    porEmpresa,
  };
}

/* =========================================================================
 * API: GENERAR (escribe — guardada por flag)
 * ========================================================================= */

export async function generarAsientoPlanilla(input: GenerarAsientoPlanillaInput): Promise<ResultadoGeneracion> {
  if (!airtable) {
    return { ok: false, error: 'Airtable no está configurado.' };
  }
  if (!GENERAR_ASIENTO_PLANILLA) {
    return { ok: false, error: 'Generación deshabilitada: GENERAR_ASIENTO_PLANILLA=false. Pendiente validar el primer asiento con el contador.' };
  }

  const previa = await previewAsientoPlanilla(input);
  if (previa.yaContabilizada) {
    return { ok: false, previa, error: `Idempotencia: este período ya está contabilizado (asiento ${previa.asientoExistenteId}).` };
  }
  if (!previa.balanceado || previa.totalDr <= 0) {
    return { ok: false, previa, error: previa.totalDr <= 0 ? 'Sin partidas para escribir.' : `Asiento no balanceado (Dr=${previa.totalDr} ≠ Cr=${previa.totalCr}).` };
  }
  if (previa.partidas.length === 0) {
    return { ok: false, previa, error: 'Sin partidas para escribir.' };
  }

  // 1) Crear ASIENTO.
  type AField = string | number | string[] | undefined;
  const origen: OrigenAsiento = ORIGEN_ASIENTO_PLANILLA;
  const fieldsAsiento: Record<string, AField> = {
    [ASIENTOS_FIELDS.asiento_ref]:   `PLA-${input.periodoNombre}`,
    [ASIENTOS_FIELDS.fecha_asiento]: input.fechaAsiento,
    [ASIENTOS_FIELDS.periodo]:       [input.periodoId],
    [ASIENTOS_FIELDS.origen]:        origen,
    [ASIENTOS_FIELDS.descripcion]:   `Planilla ${input.periodoNombre}`,
  };

  let asientoId = '';
  try {
    const creados = (await (airtable(ASIENTOS_TABLE_ID).create as unknown as (
      records: Array<{ fields: Record<string, AField> }>,
      opts: { typecast: boolean },
    ) => Promise<Array<{ id: string }>>)([{ fields: fieldsAsiento }], { typecast: true }));
    asientoId = creados[0].id;
  } catch (err) {
    return { ok: false, previa, error: `Error creando ASIENTO: ${err instanceof Error ? err.message : String(err)}` };
  }

  // 2) Crear PARTIDAS (en lotes de 10).
  const payloads = previa.partidas.map(p => {
    const f: Record<string, AField> = {
      [PARTIDAS_FIELDS.asiento]:           [asientoId],
      [PARTIDAS_FIELDS.cuenta]:            [p.cuentaContableId],
      [PARTIDAS_FIELDS.descripcion_linea]: p.descripcion,
      [PARTIDAS_FIELDS.debe]:              p.tipo === 'Dr' ? p.montoQ : 0,
      [PARTIDAS_FIELDS.haber]:             p.tipo === 'Cr' ? p.montoQ : 0,
      [PARTIDAS_FIELDS.moneda]:            'Q',
      [PARTIDAS_FIELDS.tc]:                1,
      // PARTIDAS.periodo es singleLineText (F-050.5): pasar el NOMBRE del
      // período, no el recordId.
      [PARTIDAS_FIELDS.periodo]:           input.periodoNombre,
    };
    if (p.centroCostoId) f[PARTIDAS_FIELDS.centro_costo] = [p.centroCostoId];
    return { fields: f };
  });

  const partidasIds: string[] = [];
  try {
    for (let i = 0; i < payloads.length; i += 10) {
      const lote = payloads.slice(i, i + 10);
      const creadas = (await (airtable(PARTIDAS_TABLE_ID).create as unknown as (
        records: Array<{ fields: Record<string, AField> }>,
        opts: { typecast: boolean },
      ) => Promise<Array<{ id: string }>>)(lote, { typecast: true }));
      for (const r of creadas) partidasIds.push(r.id);
    }
  } catch (err) {
    // Rollback: borrar partidas creadas + el asiento, en ese orden.
    try {
      if (partidasIds.length > 0) await airtable(PARTIDAS_TABLE_ID).destroy(partidasIds);
    } catch (e) {
      console.warn('F-056.2 rollback partidas falló:', e instanceof Error ? e.message : e);
    }
    try {
      await airtable(ASIENTOS_TABLE_ID).destroy([asientoId]);
    } catch (e) {
      console.warn('F-056.2 rollback ASIENTO falló — queda huérfano:', e instanceof Error ? e.message : e);
      return {
        ok: false, previa,
        error: `Error creando PARTIDAS y rollback falló — ASIENTO ${asientoId} requiere limpieza manual: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    return { ok: false, previa, error: `Error creando PARTIDAS (rollback ok): ${err instanceof Error ? err.message : String(err)}` };
  }

  // 3) Vincular las líneas de PLANILLA al ASIENTO recién creado.
  //    Si falla, NO hacer rollback — el asiento contable ya está bien;
  //    el vínculo es metadata. Logueamos y reportamos.
  try {
    const FL_ASIENTO_NAME = 'ASIENTO';  // field name en PLANILLA (legacy; los IDs aún no están en código)
    const lineaUpdates = input.lineas.map(l => ({ id: l.id, fields: { [FL_ASIENTO_NAME]: [asientoId] } }));
    for (let i = 0; i < lineaUpdates.length; i += 10) {
      await airtable(TABLES.PLANILLA).update(lineaUpdates.slice(i, i + 10), { typecast: true });
    }
  } catch (err) {
    console.warn('F-056.2 vínculo PLANILLA→ASIENTO falló (asiento OK):', err instanceof Error ? err.message : err);
  }

  return { ok: true, previa, asientoId, numPartidas: partidasIds.length };
}
