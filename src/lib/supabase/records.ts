/**
 * MIGRACIÓN CAPA 2 · Fase 1 — Adapter Supabase → "pseudo-records" Airtable.
 *
 * Cada fetcher devuelve `{ id, fields }[]` donde:
 *  - `id` es el airtable_id original (la UI y los motores siguen viendo rec…).
 *  - `fields` usa los MISMOS nombres de campo de Airtable (o field IDs donde
 *    la lectura usa returnFieldsByFieldId), links como arrays de airtable_id.
 *  - Los campos fórmula de Airtable que NO se migraron (Estatus_Cobranza,
 *    Dias vencidos, Semaforo, IGSS patronal, etc.) se RECALCULAN acá con la
 *    misma semántica.
 *
 * Así, las funciones de /lib/db/* reusan sus mappers existentes sin cambios:
 * mismo shape de salida, cero divergencia de lógica (regla de oro Fase 1).
 *
 * Gaps conocidos (columnas que no existen en el schema Postgres — ver
 * supabase/03_fase2_gaps.sql):
 *  - ADJUNTO/boletas/constancias (attachments; URLs de Airtable expiran).
 *  - FACTURAS.Historial_Ediciones (2 filas), COBROS.Cobro_Grupo_ID y
 *    Estado_Cobro (vacíos hoy), PAGOS.Estado_Pago (vacío hoy),
 *    PLANILLA.DEUDA_VINCULADA (vacío hoy).
 *  - OBLIGACIONES.por_cuenta_de='Otra' (2 filas → el enum las guardó como
 *    'Golden Talent'; requiere ALTER TYPE en Fase 2).
 */

import { fetchAll } from './client';
import { obtenerFechaHoyGuatemala, diferenciaDias } from '../utils/fechas';
import { CUENTAS_FIELDS } from '../contabilidad/cuentas-sistema';
import { OBLIGACIONES_RECURRENTES_FIELDS as FO } from '../airtable/obligaciones-recurrentes-fields';

export interface PseudoRecord {
  id: string;
  fields: Record<string, unknown>;
}

type Row = Record<string, unknown>;

const s = (v: unknown): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const t = String(v);
  return t === '' ? undefined : t;
};
const n = (v: unknown): number | undefined => {
  if (v === null || v === undefined) return undefined;
  const x = Number(v);
  return Number.isFinite(x) ? x : undefined;
};
/** link Airtable: array con el airtable_id del padre (o ausente). */
const link = (rel: unknown): string[] | undefined => {
  const at = (rel as { airtable_id?: string } | null)?.airtable_id;
  return at ? [at] : undefined;
};
/** quita claves undefined para imitar a Airtable (campos vacíos NO vienen). */
function compact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v === '') continue;
    out[k] = v;
  }
  return out;
}
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Airtable (sin sort explícito) devuelve los records ordenados por record
 *  id ASCII — replicamos para que listas y paginación coincidan. */
const porId = (a: PseudoRecord, b: PseudoRecord) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Orden 'fecha desc' de Airtable: el desempate del sort de Airtable es el
 *  createdTime del record (verificado contra el API) — lo persistimos en
 *  created_at durante el resync. Se aplica sobre las FILAS crudas. */
function ordenarFechaDesc<T extends Row>(rows: T[], colFecha: string): T[] {
  // Comparaciones ASCII puras (NO localeCompare: la colación ICU ordena
  // 'reco…' antes que 'recW…' y Airtable usa orden binario de ids).
  const asc = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  return rows.sort((a, b) => {
    const fa = String(a[colFecha] ?? '');
    const fb = String(b[colFecha] ?? '');
    if (fa !== fb) return asc(fb, fa);
    const ca = String(a.created_at ?? '');
    const cb = String(b.created_at ?? '');
    if (ca !== cb) return asc(ca, cb);
    return asc(String(a.airtable_id), String(b.airtable_id));
  });
}

/** Mimetiza el objeto de error que el API de Airtable devuelve en fórmulas
 *  rotas (String(...) → '[object Object]', Number(...) → NaN, igual que el
 *  record real). */
const ERROR_FORMULA = { error: '#ERROR' } as const;

/* ============================================================
 * NIVEL 0 — catálogos
 * ============================================================ */

export async function sbCentrosCostoRecords(): Promise<PseudoRecord[]> {
  const rows = await fetchAll<Row>('centros_costo');
  const out: PseudoRecord[] = rows.map(r => ({
    id: String(r.airtable_id),
    fields: compact({
      NOMBRE: s(r.nombre),
      ACTIVO: r.activo === true ? true : undefined,   // checkbox: false = ausente
      Naturaleza: s(r.naturaleza),
    }),
  }));
  return out.sort(porId);
}

export async function sbCuentasRecords(): Promise<PseudoRecord[]> {
  const rows = await fetchAll<Row>('cuentas');
  const out: PseudoRecord[] = rows.map(r => ({
    id: String(r.airtable_id),
    fields: compact({
      [CUENTAS_FIELDS.codigo_path]:   s(r.codigo_path),
      [CUENTAS_FIELDS.nombre]:        s(r.nombre),
      [CUENTAS_FIELDS.nivel]:         n(r.nivel),
      [CUENTAS_FIELDS.activo]:        r.activo === true ? true : undefined,
      [CUENTAS_FIELDS.naturaleza_er]: s(r.naturaleza_er),
      [CUENTAS_FIELDS.naturaleza_bs]: s(r.naturaleza_bs),
    }),
  }));
  return out.sort(porId);
}

export async function sbClientesRecords(): Promise<PseudoRecord[]> {
  const rows = await fetchAll<Row>('clientes');
  const out: PseudoRecord[] = rows.map(r => ({
    id: String(r.airtable_id),
    fields: compact({
      'Nombre de la Empresa': s(r.nombre_empresa),
      'Razón social':         s(r.razon_social),
      'NIt':                  s(r.nit),
      'Email cobros':         s(r.email_cobros),
      'Dias Credito':         n(r.dias_credito),
      'Contexto_Comercial':   s(r.contexto_comercial),
    }),
  }));
  return out.sort(porId);
}

export async function sbBancosRecords(): Promise<PseudoRecord[]> {
  const rows = await fetchAll<Row>('bancos');
  const out: PseudoRecord[] = rows.map(r => ({
    id: String(r.airtable_id),
    fields: compact({
      NOMBRE_CUENTA: s(r.nombre_cuenta),
      BANCO:         s(r.banco),
      NUMERO_CUENTA: s(r.numero_cuenta),
      // El singleSelect de Airtable guarda 'Q'; el enum Postgres 'GTQ'.
      MONEDA:        r.moneda === 'GTQ' ? 'Q' : s(r.moneda),
      ACTIVO:        r.activo === true ? true : undefined,
    }),
  }));
  return out.sort(porId);
}

export async function sbPeriodosRecords(): Promise<PseudoRecord[]> {
  const rows = await fetchAll<Row>('periodos');
  const out: PseudoRecord[] = rows.map(r => ({
    id: String(r.airtable_id),
    fields: compact({
      PERIODO:          s(r.periodo),
      FECHA_INICIO:     s(r.fecha_inicio),
      FECHA_FIN:        s(r.fecha_fin),
      ESTADO:           s(r.estado),
      APROBADO_POR:     s(r.aprobado_por),
      FECHA_APROBACION: s(r.fecha_aprobacion),
      PAGADO_POR:       s(r.pagado_por),
      FECHA_CIERRE:     s(r.fecha_cierre),
    }),
  }));
  return out.sort(porId);
}

export async function sbAcreedoresRecords(): Promise<PseudoRecord[]> {
  const rows = await fetchAll<Row>('acreedores', {
    select: '*, cuenta:cuentas!acreedores_cuenta_contable_id_fkey(airtable_id, nombre)',
  });
  const out: PseudoRecord[] = rows.map(r => {
    const cuentaNombre = (r.cuenta as { nombre?: string } | null)?.nombre;
    return {
      id: String(r.airtable_id),
      fields: compact({
        'Nombre_Acreedor':       s(r.nombre_acreedor),
        'Acreedor_Nombre_Legal': s(r.nombre_legal),
        'Tipo Producto':         s(r.tipo_producto),
        'Tipo_Acreedor':         s(r.tipo_acreedor),
        'Es_Parte_Relacionada':  r.es_parte_relacionada === true ? true : undefined,
        'Total_Deuda_Inicial':   n(r.total_deuda_inicial),
        'Moneda':                r.moneda === 'GTQ' ? 'Q' : s(r.moneda),
        'Estatus':               s(r.estatus),
        'NOMBRE (from Cuenta_Contable)': cuentaNombre ? [cuentaNombre] : undefined,
        'Notas':                 s(r.notas),
      }),
    };
  });
  return out.sort(porId);
}

/* ============================================================
 * DEUDAS — fórmulas de vencimiento recalculadas
 * ============================================================ */

export async function sbDeudasRecords(opts: { soloIncluidas?: boolean } = {}): Promise<PseudoRecord[]> {
  const hoy = obtenerFechaHoyGuatemala();
  const rows = await fetchAll<Row>('deudas', {
    select: '*, acreedor:acreedores(airtable_id, nombre_legal), centro:centros_costo(airtable_id)',
    ...(opts.soloIncluidas ? { eq: { no_incluir: false } } : {}),
  });
  const out: PseudoRecord[] = rows.map(r => {
    const fechaVencReal = s(r.fecha_vencimiento_real);
    // Réplica de las fórmulas de Airtable (basadas en Fecha_Vencimiento_Real;
    // sin fecha → 'Vence hoy' / Vigente / sin días, verificado contra el CSV).
    const diasAVencer = fechaVencReal ? -diferenciaDias(fechaVencReal, hoy) : undefined;
    const vencida = diasAVencer !== undefined && diasAVencer < 0;
    const semaforo = diasAVencer === undefined ? '🟠 Vence hoy'
      : diasAVencer < 0   ? '🔴 Vencida'
      : diasAVencer === 0 ? '🟠 Vence hoy'
      : diasAVencer <= 7  ? '🟡 Por vencer (≤7 días)'
      :                     '🟢 Al día';
    const montoOriginal = n(r.monto_original) ?? 0;
    const tipoCambio = n(r.tipo_cambio) ?? 1;
    const montoGTQ = round2(montoOriginal * tipoCambio);
    return {
      id: String(r.airtable_id),
      fields: compact({
        'Clave_Deuda':            s(r.clave_deuda),
        'Acreedor':               link(r.acreedor),
        'Nombre_Deuda / Código':  s(r.nombre_deuda),
        'Tipo_Documento':         s(r.tipo_documento),
        'Estado':                 s(r.estado),
        'Estado_Deuda':           vencida ? 'Vencida' : 'Vigente',
        'Fecha_Emision':          s(r.fecha_emision),
        'Fecha_Vencimiento_Real': fechaVencReal,
        'Dias_a_Vencer':          diasAVencer,
        'Vencida?':               vencida ? 1 : 0,
        'Moneda':                 s(r.moneda),
        'Tipo_Cambio':            tipoCambio,
        'Monto_Original':         montoOriginal,
        'IVA':                    n(r.iva),
        'Monto_GTQ':              montoGTQ,
        // El rollup Total_Pagado de Airtable está roto (siempre 0) — la app
        // recalcula desde PAGOS_PROVEEDORES (recomputeFromPagos). Replicamos.
        'Total_Pagado':           0,
        'Saldo_Pendiente':        montoGTQ,
        'Centro_Costo':           link(r.centro),
        'Tasa_Interes':           0,
        '%_Avance':               0,
        'Dias_en_Mora':           vencida && diasAVencer !== undefined ? -diasAVencer : 0,
        'Semaforo_Vencimiento':   semaforo,
        'Mora_Acumulada':         0,
        'Num_Pagos':              0,
        'Notas':                  s(r.notas),
        'No Incluir':             r.no_incluir === true ? true : undefined,
        'Dia_Pago_Fijo':          n(r.dia_pago_fijo),
        // Lookup Acreedor_Corto = Acreedor_Nombre_Legal (verificado vs API).
        'Acreedor_Corto':         (r.acreedor as { nombre_legal?: string } | null)?.nombre_legal
          ? [(r.acreedor as { nombre_legal: string }).nombre_legal]
          : undefined,
        // Fecha_Vencimiento: columna pendiente de DDL (03_fase2_gaps.sql);
        // hasta entonces r.fecha_vencimiento llega undefined y el campo se omite.
        'Fecha_Vencimiento':      s(r.fecha_vencimiento),
      }),
    };
  });
  return out.sort(porId);
}

/* ============================================================
 * FACTURAS_CLIENTES — vencimiento / estatus cobranza / asiento_ref
 * ============================================================ */

interface FacturaRow extends Row {
  cliente: { airtable_id: string; dias_credito: number | null } | null;
  centro: { airtable_id: string } | null;
}

function sumarISO(fechaISO: string, dias: number): string {
  const [y, m, d] = fechaISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}

export async function sbFacturasRecords(): Promise<PseudoRecord[]> {
  const hoy = obtenerFechaHoyGuatemala();
  const [rows, cobros] = await Promise.all([
    fetchAll<FacturaRow>('facturas_clientes', {
      select: '*, cliente:clientes(airtable_id, dias_credito), centro:centros_costo(airtable_id)',
      order: { column: 'fecha_emision', ascending: false },
    }),
    fetchAll<Row>('cobros_clientes', { select: 'factura_id, monto_cobrado' }),
  ]);
  // Cobrado por línea de factura (para Saldo_Por_Cobrar de COBRADO PARCIAL).
  const cobradoPorFactura = new Map<string, number>();
  for (const c of cobros) {
    const fid = c.factura_id as string | null;
    if (!fid) continue;
    cobradoPorFactura.set(fid, (cobradoPorFactura.get(fid) ?? 0) + (n(c.monto_cobrado) ?? 0));
  }

  // Orden Airtable: FECHA_EMISION desc, desempate por createdTime.
  ordenarFechaDesc(rows, 'fecha_emision');
  return rows.map(r => {
    const fechaEmision = s(r.fecha_emision);
    // Dias_Credito_Num (fórmula Airtable): días de crédito del cliente o 0.
    const diasCredito = r.cliente?.dias_credito ?? 0;
    const fechaVence = fechaEmision !== undefined ? sumarISO(fechaEmision, diasCredito) : undefined;
    // Fórmula 'Dias vencidos' (verificada vs API): BLANK solo para ANULADO
    // (REFACTURADO sí calcula); NaN sin fecha; si no, hoy - vencimiento
    // (negativos ok).
    const estadoCanon = String(r.estado ?? '').toUpperCase().trim();
    const esAnulada = estadoCanon === 'ANULADO' || estadoCanon === 'ANULADA';
    const diasVencidos = !fechaVence ? Number.NaN
      : esAnulada ? undefined
      : diferenciaDias(fechaVence, hoy);
    const total = n(r.total) ?? 0;
    const cobrado = cobradoPorFactura.get(String(r.id)) ?? 0;
    const fechaUltimaEdicion = r.fecha_ultima_edicion
      ? new Date(String(r.fecha_ultima_edicion)).toISOString()
      : undefined;
    return {
      id: String(r.airtable_id),
      fields: compact({
        'FACTURA_ID':          n(r.factura_id_legacy) ?? s(r.factura_id_legacy),
        'NO.FACTURA':          s(r.no_factura),
        'FECHA_EMISION':       fechaEmision,
        // Sin fecha de emisión las fórmulas de Airtable devuelven objetos de
        // error / NaN — los emitimos igual para que los mappers produzcan
        // exactamente lo mismo.
        'Fecha vencimiento':   fechaVence ?? ERROR_FORMULA,
        'CLIENTE ':            link(r.cliente),
        'CENTRO_COSTO':        link(r.centro),
        'SUBTOTAL':            n(r.subtotal),
        'IVA':                 n(r.iva),
        'TOTAL':               n(r.total),
        'Saldo_Por_Cobrar':    round2(Math.max(0, total - cobrado)),
        'ESTADO':              s(r.estado),
        'Estatus_Cobranza':    diasVencidos !== undefined && diasVencidos > 0 ? 'VENCIDA' : 'POR VENCER',
        'Dias vencidos':       diasVencidos,
        'ASIENTO_REF':         fechaEmision
          ? `ASI-FAC-${fechaEmision.slice(0, 7).replace('-', '')}-${String(r.airtable_id).slice(-6)}`
          : ERROR_FORMULA,
        'Observaciones:':      s(r.observaciones),
        'Editado_Por':         s(r.editado_por),
        'Fecha_Ultima_Edicion': fechaUltimaEdicion,
        // 'ADJUNTO ' y 'Historial_Ediciones': gaps conocidos (ver header).
      }),
    };
  });
}

/* ============================================================
 * COBROS_CLIENTES
 * ============================================================ */

interface CobroRow extends Row {
  factura: {
    airtable_id: string;
    no_factura: string | null;
    cliente: { airtable_id: string } | null;
  } | null;
  banco: { airtable_id: string } | null;
}

export async function sbCobrosRecords(): Promise<PseudoRecord[]> {
  const rows = await fetchAll<CobroRow>('cobros_clientes', {
    select: '*, factura:facturas_clientes(airtable_id, no_factura, cliente:clientes(airtable_id)), banco:bancos!cobros_clientes_cuenta_banco_id_fkey(airtable_id)',
    order: { column: 'fecha_cobro', ascending: false },
  });
  ordenarFechaDesc(rows, 'fecha_cobro');
  return rows.map(r => {
    const montoCobrado = n(r.monto_cobrado) ?? 0;
    const tipoCambio = n(r.tipo_cambio) ?? 1;
    return {
      id: String(r.airtable_id),
      fields: compact({
        'Fecha_Cobro':      s(r.fecha_cobro),
        'Factura Cliente':  link(r.factura),
        'Monto_Cobrado':    n(r.monto_cobrado),
        'Cuenta_Banco':     link(r.banco),
        'Método':           s(r.metodo),
        'Moneda':           s(r.moneda),
        'Tipo_Cambio':      tipoCambio,
        'Estado':           s(r.estado),
        'Referencia':       s(r.referencia),
        'NO.FACTURA (from Factura Cliente)': r.factura?.no_factura ? [r.factura.no_factura] : undefined,
        'CLIENTE  (from Factura Cliente)':   r.factura?.cliente?.airtable_id ? [r.factura.cliente.airtable_id] : undefined,
        'Monto_Retencion_IVA': n(r.monto_retencion_iva) || undefined,
        'Monto_Retencion_ISR': n(r.monto_retencion_isr) || undefined,
        'Monto_Cobro_GTQ':  round2(montoCobrado * tipoCambio),
        'Fecha_Anulacion':  s(r.fecha_anulacion),
        'Motivo_Anulacion': s(r.motivo_anulacion),
        'Anulado_Por':      s(r.anulado_por),
        // Cobro_Grupo_ID / Estado_Cobro / Constancia_Retencion: no existen en
        // el schema (vacíos en Airtable hoy) — ausencia = grupo legacy/Activo.
      }),
    };
  });
}

/* ============================================================
 * PAGOS_PROVEEDORES
 * ============================================================ */

export async function sbPagosRecords(): Promise<PseudoRecord[]> {
  const rows = await fetchAll<Row>('pagos_proveedores', {
    select: '*, deuda:deudas(airtable_id), banco:bancos!pagos_proveedores_cuenta_banco_id_fkey(airtable_id, nombre_cuenta)',
  });
  const out: PseudoRecord[] = rows.map(r => ({
    id: String(r.airtable_id),
    fields: compact({
      'Deuda':            link(r.deuda),
      'Fecha_Pago':       s(r.fecha_pago),
      // En Airtable Cuenta_Banco de PAGOS es singleSelect (name), no link.
      'Cuenta_Banco':     (r.banco as { nombre_cuenta?: string } | null)?.nombre_cuenta,
      'Moneda':           s(r.moneda),
      'Tipo_Cambio':      n(r.tipo_cambio),
      'Monto_Pago':       n(r.monto_pago),
      'Monto_Comision':   n(r.monto_comision) || undefined,
      'Monto_Mora':       n(r.monto_mora) || undefined,
      'Monto_Interes':    n(r.monto_interes) || undefined,
      'Metodo':           s(r.metodo),
      'Referencia':       s(r.referencia),
      'Estado':           s(r.estado),
      'Notas':            s(r.notas),
      'Fecha_Anulacion':  s(r.fecha_anulacion),
      'Motivo_Anulacion': s(r.motivo_anulacion),
      // Estado_Pago: columna inexistente (vacía en Airtable) → Activo.
    }),
  }));
  return out.sort(porId);
}

/* ============================================================
 * EMPLEADOS — fórmulas de provisiones recalculadas
 * ============================================================ */

const PCT = {
  IGSS_PATRONAL: 0.1267,
  BONO14:        0.0833,
  AGUINALDO:     0.0833,
  VACACIONES:    0.0417,
  INDEMNIZACION: 0.0972,
} as const;
const HORAS_MES = 240;

export async function sbEmpleadosRecords(): Promise<PseudoRecord[]> {
  const rows = await fetchAll<Row>('empleados', {
    select: '*, centro:centros_costo(airtable_id), acreedor:acreedores(airtable_id)',
  });
  const out: PseudoRecord[] = rows.map(r => {
    const sm = n(r.salario_mensual) ?? 0;
    // Las fórmulas de Airtable NO redondean (verificado vs API: Salario
    // Total 6653.628828); el redondeo era solo formato de display.
    const igss       = sm * PCT.IGSS_PATRONAL;
    const bono14     = sm * PCT.BONO14;
    const aguinaldo  = sm * PCT.AGUINALDO;
    const vacaciones = sm * PCT.VACACIONES;
    const indem      = sm * PCT.INDEMNIZACION;
    // 'Salario Total' de Airtable es condicional: SERVICIOS PROFESIONALES
    // (por factura) no carga prestaciones (verificado vs API).
    const esServiciosProf = String(r.tipo_contrato ?? '').trim().toUpperCase() === 'SERVICIOS PROFESIONALES';
    const salarioTotal = esServiciosProf ? sm : sm + igss + bono14 + aguinaldo + vacaciones + indem;
    return {
      id: String(r.airtable_id),
      fields: compact({
        'NOMBRE':           s(r.nombre),
        'CENTROS_COSTO':    link(r.centro),
        'No_DOCUMENTO':     n(r.no_documento) ?? s(r.no_documento),
        'STATUS_LABORANDO': s(r.status_laborando),
        'FECHA_INGRESO':    s(r.fecha_ingreso),
        'Fecha_Salida':     s(r.fecha_salida),
        'Motivo_Salida':    s(r.motivo_salida),
        'SEDE':             r.sede ? [String(r.sede)] : undefined,   // multipleSelect
        'ID_PUESTO':        s(r.id_puesto),
        'DEPARTAMENTO':     s(r.departamento),
        'BANCO':            s(r.banco) ? [String(r.banco)] : undefined,
        'CUENTA_BANCARIA':  s(r.cuenta_bancaria),
        'Salario Actual':   n(r.salario_actual),
        'Bonificacion':     n(r.bonificacion),
        'Bono Variable':    n(r.bono_variable),
        'Salario Mensual':  sm || undefined,
        'Cuota Patronal (IGSS) -12.67%': igss || undefined,
        'Bono 14 - 8.33%':               bono14 || undefined,
        'Aguinaldo - 8.33%':             aguinaldo || undefined,
        'Vacaciones - 4.17%':            vacaciones || undefined,
        'Indemnizacion -9.72%':          indem || undefined,
        'Salario Total':                 salarioTotal || undefined,
        'Costo x Hora':                  sm ? salarioTotal / HORAS_MES : undefined,
        'TIPO DE CONTRATO': s(r.tipo_contrato),
        'Acreedor_Vinculado': link(r.acreedor),
        'EMPRESA_EMPLEADORA': s(r.empresa_empleadora),
      }),
    };
  });
  return out.sort(porId);
}

/* ============================================================
 * PLANILLA
 * ============================================================ */

export async function sbPlanillaRecords(): Promise<PseudoRecord[]> {
  const rows = await fetchAll<Row>('planilla', {
    select: '*, periodo:periodos(airtable_id), empleado:empleados(airtable_id), centro:centros_costo(airtable_id)',
  });
  const out: PseudoRecord[] = rows.map(r => ({
    id: String(r.airtable_id),
    fields: compact({
      'PLANILLA_ID':       n(r.planilla_id_legacy) ?? s(r.planilla_id_legacy),
      'PERIODO':           link(r.periodo),
      'EMPLEADO ':         link(r.empleado),
      'CENTROS_COSTO':     link(r.centro),
      'FECHA_PAGO':        s(r.fecha_pago),
      'ORDINARIO':         n(r.ordinario) || undefined,
      'BONIFICACIÓN ':     n(r.bonificacion) || undefined,
      'EXTRAORDINARIO ':   n(r.extraordinario) || undefined,
      'COMISIONES ':       n(r.comisiones) || undefined,
      'OTROS_INGRESOS':    n(r.otros_ingresos) || undefined,
      'IGSS':              n(r.igss) || undefined,
      'ISR':               n(r.isr) || undefined,
      'OTROS_DOCUMENTOS':  n(r.otros_documentos) || undefined,
      'NETO_PAGAR':        n(r.neto_pagar) || undefined,
      'ESTADO_PAGO':       s(r.estado_pago),
      'NOTAS':             s(r.notas),
      'FECHA_PAGO_REGISTRADA': s(r.fecha_pago_registrada),
      // DEUDA_VINCULADA / FECHA_DIFERIMIENTO / FECHA_CANCELACION /
      // MOTIVO_CANCELACION / 'ADJUNTO ' (boleta): gaps de schema — vacíos
      // en Airtable hoy salvo 2 boletas PDF (ver 03_fase2_gaps.sql).
    }),
  }));
  return out.sort(porId);
}

/* ============================================================
 * NOTAS_CREDITO
 * ============================================================ */

export async function sbNotasCreditoRecords(): Promise<PseudoRecord[]> {
  const rows = await fetchAll<Row>('notas_credito', {
    select: '*, factura:facturas_clientes(airtable_id, no_factura), cliente:clientes(airtable_id, razon_social)',
    order: { column: 'fecha_emision', ascending: false },
  });
  ordenarFechaDesc(rows, 'fecha_emision');
  return rows.map(r => ({
    id: String(r.airtable_id),
    fields: compact({
      'Numero_NC':     s(r.numero_nc),
      'Factura':       link(r.factura),
      'Cliente':       link(r.cliente),
      'Fecha_Emision': s(r.fecha_emision),
      'Monto':         n(r.monto),
      'Motivo':        s(r.motivo),
      'Descripcion':   s(r.descripcion),
      'Estado':        s(r.estado),
      'Emitida_Por':   s(r.emitida_por),
      // OJO: los lookups 'NO.FACTURA (from Factura)' y 'Razón social (from
      // Cliente)' NO existen hoy en la tabla de Airtable (la lectura recibe
      // '' y la UI muestra vacío). NO los emitimos para mantener el output
      // idéntico; cuando se creen en Airtable, activarlos acá con el join.
      // Fecha_Creacion / Aprobada_Por / anulación / Adjunto: vacíos en
      // Airtable hoy y sin columna en el schema (ver 03_fase2_gaps.sql).
    }),
  }));
}

/* ============================================================
 * OBLIGACIONES_RECURRENTES (lectura por field ID)
 * ============================================================ */

export async function sbObligacionesRecords(): Promise<PseudoRecord[]> {
  const rows = await fetchAll<Row>('obligaciones_recurrentes', {
    select: [
      '*',
      'proveedor:proveedores(airtable_id)',
      'acreedor:acreedores(airtable_id)',
      'centro:centros_costo(airtable_id)',
      'cuenta:cuentas!obligaciones_recurrentes_cuenta_contable_id_fkey(airtable_id)',
      'banco:bancos!obligaciones_recurrentes_banco_pago_id_fkey(airtable_id)',
    ].join(', '),
  });
  const out: PseudoRecord[] = rows.map(r => ({
    id: String(r.airtable_id),
    fields: compact({
      [FO.nombre]:          s(r.nombre),
      [FO.tipo]:            s(r.tipo),
      [FO.monto_estimado]:  n(r.monto_estimado),
      [FO.dia_pago]:        n(r.dia_pago),
      [FO.frecuencia]:      s(r.frecuencia),
      [FO.prioridad]:       s(r.prioridad),
      [FO.proveedor]:       link(r.proveedor),
      [FO.acreedor]:        link(r.acreedor),
      [FO.centro_costo]:    link(r.centro),
      [FO.cuenta_contable]: link(r.cuenta),
      [FO.banco_pago]:      link(r.banco),
      [FO.mes_referencia]:  s(r.mes_referencia),
      [FO.activo]:          r.activo === true ? true : undefined,
      [FO.notas]:           s(r.notas),
      [FO.fecha_inicio]:    s(r.fecha_inicio),
      [FO.fecha_fin]:       s(r.fecha_fin),
      // Gap conocido: 2 filas eran 'Otra' en Airtable; el enum Postgres las
      // guardó como 'Golden Talent' (ALTER TYPE pendiente — Fase 2).
      [FO.por_cuenta_de]:   s(r.por_cuenta_de),
    }),
  }));
  return out.sort(porId);
}
