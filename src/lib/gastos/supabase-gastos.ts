/**
 * FASE 2.3 — Flujo de GASTOS contra Supabase.
 *
 * Este módulo concentra la variante Supabase de todo el pipeline F-049/F-050:
 * bandeja FACTURAS_IN (leer/crear/anular/dedupe), proveedor por NIT, período
 * contable, y la aprobación (ASIENTO + PARTIDAS + GASTO + update de la
 * FACTURA_IN) vía la RPC transaccional `fase2_aprobar_gasto` — si cualquier
 * parte falla, Postgres revierte TODO (adiós al rollback manual en cascada
 * de F-050).
 *
 * Convenciones:
 *  - Hacia la app siempre viajan record-ids estilo Airtable (airtable_id,
 *    incluidos los sintéticos 'sbw…'). Los uuid viven solo acá.
 *  - moneda: la UI usa 'Q'/'USD'; el enum Postgres usa 'GTQ'/'USD'.
 */

import { supabase, fetchAll } from '@/lib/supabase/client';
import { rpc, insertar, actualizarPorAppId, uuidRequerido, uuidOpcional, nuevoIdEscritura } from '@/lib/supabase/writes';
import { uuidDe, airtableIdDe, invalidarBridge } from '@/lib/supabase/id-bridge';
import { CUENTAS_SISTEMA } from '@/lib/contabilidad/cuentas-sistema';
import type { FacturaIn } from '@/lib/db/facturas-in';
import type { PeriodoResolucion } from '@/lib/gastos/services/resolver-periodo-contable';

const round2 = (n: number) => Math.round(n * 100) / 100;
const monedaEnum = (m: 'Q' | 'USD' | string): 'GTQ' | 'USD' => (m === 'USD' ? 'USD' : 'GTQ');

type Row = Record<string, unknown>;
const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/* ============================================================
 * FACTURAS_IN — bandeja
 * ============================================================ */

export function rowToFacturaIn(r: Row): FacturaIn {
  return {
    id: s(r.airtable_id),
    proveedorNombre: s(r.proveedor_nombre).trim(),
    proveedorNit:    s(r.proveedor_nit).trim(),
    serie:           s(r.serie),
    numero:          s(r.numero),
    fechaEmision:    s(r.fecha_emision),
    moneda:          s(r.moneda_texto) || 'Q',
    subtotal:        n(r.subtotal),
    iva:             n(r.iva),
    total:           n(r.total),
    pais:            s(r.pais),
    tipoDoc:         s(r.tipo_doc),
    estatus:         s(r.estado) || 'Pendiente',
    fuente:          s(r.fuente),
    textoOcr:        s(r.texto_ocr),
    subidoPor:       s(r.subido_por),
    fechaSubida:     s(r.fecha_subida),
    archivoUrl:      s(r.archivo_url) || undefined,
    archivoNombre:   s(r.archivo_nombre) || undefined,
    docKey:          s(r.doc_key) || undefined,
    fileHash:        s(r.file_hash) || undefined,
    confianzaExtraccion: typeof r.confianza_extraccion === 'number' || typeof r.confianza_extraccion === 'string'
      ? Number(r.confianza_extraccion)
      : undefined,
    datosNormalizados:   s(r.datos_normalizados) || undefined,
    datosNormalizadosOk: r.datos_normalizados_ok === true,
  };
}

export async function sbGetFacturasIn(): Promise<FacturaIn[]> {
  const rows = await fetchAll<Row>('facturas_in', {
    order: { column: 'fecha_subida', ascending: false },
  });
  return rows.map(rowToFacturaIn);
}

export async function sbGetFacturaInPorId(appId: string): Promise<FacturaIn | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb.from('facturas_in').select('*').eq('airtable_id', appId).limit(1);
  return data?.[0] ? rowToFacturaIn(data[0] as Row) : null;
}

export async function sbCheckDuplicate(campo: 'file_hash' | 'doc_key', valor: string): Promise<{ existe: boolean; recordId?: string }> {
  if (!valor) return { existe: false };
  const sb = supabase();
  if (!sb) return { existe: false };
  const { data } = await sb.from('facturas_in').select('airtable_id').eq(campo, valor).limit(1);
  return data?.[0] ? { existe: true, recordId: String((data[0] as Row).airtable_id) } : { existe: false };
}

export interface CrearFacturaInInput {
  fuente: string;
  fileHash: string;
  docKey?: string;
  proveedorNombre?: string;
  proveedorNit?: string;
  serie?: string;
  numero?: string;
  fechaEmision?: string;
  moneda?: string;                 // 'Q' | 'USD'
  subtotal?: number;
  iva?: number;
  total?: number;
  pais?: string;
  tipoDoc?: string;
  otrosImpuestos?: number;
  textoOcr?: string;
  datosNormalizados?: string;
  datosNormalizadosOk?: boolean;
  subidoPor: string;
  fechaSubida: string;             // ISO
  confianzaExtraccion?: number;
}

export async function sbCrearFacturaIn(input: CrearFacturaInInput): Promise<{ appId: string; uuid: string }> {
  const res = await insertar('facturas_in', {
    fuente:              input.fuente,
    file_hash:           input.fileHash,
    doc_key:             input.docKey ?? null,
    proveedor_nombre:    input.proveedorNombre ?? null,
    proveedor_nit:       input.proveedorNit ?? null,
    serie:               input.serie ?? null,
    numero:              input.numero ?? null,
    fecha_emision:       input.fechaEmision || null,
    moneda_texto:        input.moneda ?? 'Q',
    subtotal:            input.subtotal ?? null,
    iva:                 input.iva ?? null,
    total:               input.total ?? null,
    monto:               input.total ?? null,      // columna legacy del schema 01
    pais:                input.pais ?? null,
    tipo_doc:            input.tipoDoc ?? null,
    otros_impuestos:     input.otrosImpuestos ?? null,
    texto_ocr:           input.textoOcr ?? null,
    datos_normalizados:  input.datosNormalizados ?? null,
    datos_normalizados_ok: input.datosNormalizadosOk ?? false,
    estado:              'Pendiente',
    subido_por:          input.subidoPor,
    fecha_subida:        input.fechaSubida,
    confianza_extraccion: input.confianzaExtraccion ?? null,
  });
  return { appId: res.airtable_id, uuid: res.id };
}

export async function sbAnularFacturaIn(appId: string, datosNormalizados: string): Promise<void> {
  await actualizarPorAppId('facturas_in', appId, {
    estado: 'Anulada',
    datos_normalizados: datosNormalizados,
  });
}

export async function sbActualizarArchivoFacturaIn(appId: string, url: string, nombre: string): Promise<void> {
  await actualizarPorAppId('facturas_in', appId, { archivo_url: url, archivo_nombre: nombre });
}

/* ============================================================
 * PROVEEDORES — buscar/crear por NIT + hábitos F-052
 * ============================================================ */

function normalizarNit(x: string): string {
  return String(x ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export async function sbBuscarProveedorPorNit(nit: string): Promise<{ existe: boolean; recordId?: string; nombre?: string }> {
  const nitNorm = normalizarNit(nit);
  if (!nitNorm) return { existe: false };
  const rows = await fetchAll<Row>('proveedores', { select: 'airtable_id, nombre, nit' });
  const hit = rows.find(r => normalizarNit(s(r.nit)) === nitNorm);
  return hit ? { existe: true, recordId: s(hit.airtable_id), nombre: s(hit.nombre) } : { existe: false };
}

export async function sbBuscarOCrearProveedor(input: {
  nit: string;
  nombreSugerido: string;
  emailSugerido?: string;
  telefonoSugerido?: string;
  direccionSugerida?: string;
}): Promise<{ recordId: string; nombre: string; esNuevo: boolean }> {
  const nitNorm = normalizarNit(input.nit);
  if (!nitNorm) throw new Error('NIT vacío — no se puede buscar/crear proveedor.');
  const existente = await sbBuscarProveedorPorNit(nitNorm);
  if (existente.existe) {
    return { recordId: existente.recordId!, nombre: existente.nombre ?? input.nombreSugerido, esNuevo: false };
  }
  const nombreLimpio = (input.nombreSugerido ?? '').trim();
  if (!nombreLimpio) throw new Error('Nombre sugerido vacío — no se puede crear proveedor sin nombre.');
  const res = await insertar('proveedores', {
    nombre:    nombreLimpio,
    nit:       nitNorm,
    email:     input.emailSugerido?.trim() || null,
    telefono:  input.telefonoSugerido?.trim() || null,
    direccion: input.direccionSugerida?.trim() || null,
    activo:    true,
  });
  return { recordId: res.airtable_id, nombre: nombreLimpio, esNuevo: true };
}

/** Aprendizaje pasivo F-052/F-052.1: guarda cuenta/CC habitual del proveedor. */
export async function sbAprenderHabitualProveedor(args: {
  proveedorAppId: string;
  cuentaAppId?: string;
  centroCostoAppId?: string;
}): Promise<void> {
  const cambios: Record<string, unknown> = {};
  if (args.cuentaAppId) {
    cambios.cuenta_gasto_habitual_id = await uuidOpcional('cuentas', args.cuentaAppId);
  }
  if (args.centroCostoAppId) {
    cambios.centro_costo_habitual_id = await uuidOpcional('centros_costo', args.centroCostoAppId);
  }
  if (Object.keys(cambios).length === 0) return;
  await actualizarPorAppId('proveedores', args.proveedorAppId, cambios);
}

/* ============================================================
 * PERÍODO CONTABLE (F-050.4, semántica idéntica)
 * ============================================================ */

export async function sbResolverPeriodoContable(fechaEmision: string): Promise<PeriodoResolucion> {
  if (!/^\d{4}-\d{2}-\d{2}/.test(fechaEmision)) {
    throw new Error(`Fecha inválida: "${fechaEmision}" (esperado YYYY-MM-DD).`);
  }
  const objetivo = fechaEmision.slice(0, 7);
  const rows = await fetchAll<Row>('periodos', { select: 'airtable_id, periodo, estado' });
  const hit = rows.find(r => s(r.periodo).trim() === objetivo);
  if (hit) {
    const estado = s(hit.estado).toLowerCase().trim();
    if (estado === 'cerrado' || estado === 'closed') {
      throw new Error(`El período ${objetivo} está cerrado — no se pueden registrar gastos en él.`);
    }
    return { recordId: s(hit.airtable_id), nombrePeriodo: objetivo, ajustado: false };
  }
  // Crear el período abierto (mismas fechas que F-050.4).
  const [y, m] = objetivo.split('-').map(Number);
  const ultimoDia = new Date(y, m, 0).getDate();
  const res = await insertar('periodos', {
    periodo:      objetivo,
    fecha_inicio: `${objetivo}-01`,
    fecha_fin:    `${objetivo}-${String(ultimoDia).padStart(2, '0')}`,
    estado:       'Abierto',
    notas:        'Creado automáticamente por el sistema (F-050.4)',
  });
  return { recordId: res.airtable_id, nombrePeriodo: objetivo, ajustado: false };
}

/* ============================================================
 * APROBACIÓN — asiento + partidas + gasto + factura_in (RPC atómica)
 * ============================================================ */

async function siguienteAsientoRefSb(prefijo: string): Promise<string> {
  const rows = await fetchAll<Row>('asientos', { select: 'asiento_ref' });
  let max = 0;
  for (const r of rows) {
    const ref = s(r.asiento_ref);
    if (!ref.startsWith(prefijo)) continue;
    const nn = Number(ref.slice(prefijo.length));
    if (Number.isFinite(nn) && nn > max) max = nn;
  }
  return `${prefijo}${String(max + 1).padStart(3, '0')}`;
}

async function cuentaContableDelBancoSb(bancoAppId: string): Promise<string> {
  const sb = supabase();
  if (!sb) throw new Error('Supabase no está configurado.');
  const { data, error } = await sb.from('bancos')
    .select('cuenta_contable_id')
    .eq('airtable_id', bancoAppId)
    .limit(1);
  if (error) throw new Error(`bancos: ${error.message}`);
  const cuentaUuid = (data?.[0] as Row | undefined)?.cuenta_contable_id as string | null | undefined;
  if (!cuentaUuid) {
    throw new Error('Banco sin cuenta contable configurada. Asignar CUENTA_CONTABLE al banco antes de aprobar la factura.');
  }
  return cuentaUuid;
}

export interface SbAprobarGastoInput {
  facturaInAppId: string;
  fechaEmision: string;
  periodo: PeriodoResolucion;        // recordId = airtable_id del período
  centroCostoAppId: string;
  proveedorAppId: string;
  proveedorNombre: string;
  proveedorEsInternacional: boolean;
  cuentaGastoAppId: string;
  baseSinIva: number;
  iva: number;
  total: number;
  moneda: 'Q' | 'USD';
  tipoCambio: number;
  metodoPago: 'Contado' | 'Plazo';
  bancoAppId?: string;
  fechaPago?: string;
  fechaVencimiento?: string;
  referenciaPago?: string;
  tipoOperativo: string;             // Operativo | No Operativo
  serie: string;
  numero: string;
  descripcion: string;
  aprobadoPor: string;
  fechaAprobacion: string;           // ISO datetime
}

export interface SbAprobarGastoResult {
  gastoId: string;                   // app-id ('sbw…')
  asientoId: string;
  asientoRef: string;
}

export async function sbAprobarGasto(input: SbAprobarGastoInput): Promise<SbAprobarGastoResult> {
  // Resolución de uuids (la app habla en record-ids).
  const [facturaInUuid, ccUuid, proveedorUuid, cuentaGastoUuid, periodoUuid] = await Promise.all([
    uuidRequerido('facturas_in', input.facturaInAppId, 'aprobarGasto'),
    uuidRequerido('centros_costo', input.centroCostoAppId, 'aprobarGasto'),
    uuidRequerido('proveedores', input.proveedorAppId, 'aprobarGasto'),
    uuidRequerido('cuentas', input.cuentaGastoAppId, 'aprobarGasto'),
    uuidRequerido('periodos', input.periodo.recordId, 'aprobarGasto'),
  ]);
  const bancoUuid = input.bancoAppId ? await uuidRequerido('bancos', input.bancoAppId, 'aprobarGasto') : null;

  const base = round2(input.baseSinIva);
  const iva = round2(input.iva);
  const total = round2(input.total);
  const moneda = monedaEnum(input.moneda);

  // Partidas — misma estructura contable que generarAsientoFacturaCompra.
  const partidas: Array<Record<string, unknown>> = [];
  partidas.push({
    cuenta_id: cuentaGastoUuid,
    centro_costo_id: ccUuid,
    descripcion_linea: `Compra ${input.proveedorNombre} ${input.serie}-${input.numero}`,
    debe: base, haber: 0, moneda, tipo_cambio: input.tipoCambio,
    periodo: input.periodo.nombrePeriodo, proveedor_id: proveedorUuid,
  });
  if (iva > 0) {
    const ivaUuid = await uuidRequerido('cuentas', CUENTAS_SISTEMA.IVA_CREDITO_FISCAL.recordId, 'aprobarGasto (IVA)');
    partidas.push({
      cuenta_id: ivaUuid,
      centro_costo_id: ccUuid,
      descripcion_linea: `IVA crédito fiscal ${input.serie}-${input.numero}`,
      debe: iva, haber: 0, moneda, tipo_cambio: input.tipoCambio,
      periodo: input.periodo.nombrePeriodo, proveedor_id: proveedorUuid,
    });
  }
  if (input.metodoPago === 'Contado') {
    if (!bancoUuid) throw new Error('bancoId requerido si metodoPago=Contado.');
    const cuentaBancoUuid = await cuentaContableDelBancoSb(input.bancoAppId!);
    partidas.push({
      cuenta_id: cuentaBancoUuid,
      centro_costo_id: ccUuid,
      descripcion_linea: `Pago a ${input.proveedorNombre}`,
      debe: 0, haber: total, moneda, tipo_cambio: input.tipoCambio,
      periodo: input.periodo.nombrePeriodo, proveedor_id: proveedorUuid, banco_id: bancoUuid,
    });
  } else {
    const cxpAppId = input.proveedorEsInternacional
      ? CUENTAS_SISTEMA.CXP_PROVEEDORES_INTERNACIONALES.recordId
      : CUENTAS_SISTEMA.CXP_PROVEEDORES_NACIONALES.recordId;
    const cxpUuid = await uuidRequerido('cuentas', cxpAppId, 'aprobarGasto (CxP)');
    partidas.push({
      cuenta_id: cxpUuid,
      centro_costo_id: ccUuid,
      descripcion_linea: `Por pagar a ${input.proveedorNombre}`,
      debe: 0, haber: total, moneda, tipo_cambio: input.tipoCambio,
      periodo: input.periodo.nombrePeriodo, proveedor_id: proveedorUuid,
    });
  }

  const gasto = {
    proveedor_id: proveedorUuid,
    cuenta_gasto_id: cuentaGastoUuid,
    centro_costo_id: ccUuid,
    periodo_id: periodoUuid,
    fecha: input.fechaEmision,
    base, iva, total,
    metodo_pago: input.metodoPago,
    estado: input.metodoPago === 'Contado' ? 'Pagado' : 'Por pagar',
    banco_id: bancoUuid ?? '',
    referencia_pago: input.referenciaPago?.trim() ?? '',
    fecha_vencimiento: input.metodoPago === 'Plazo' ? (input.fechaVencimiento ?? '') : '',
    tipo_operativo: input.tipoOperativo,
    descripcion: input.descripcion,
    fecha_aprobacion: input.fechaAprobacion,
    aprobado_por: input.aprobadoPor,
  };

  // Correlativo + RPC atómica. El unique index de asiento_ref nos protege
  // de races: si dos aprobaciones piden el mismo número, la segunda recibe
  // ASIENTO_DUPLICADO y reintenta con el siguiente.
  const prefijo = `FC-${input.periodo.nombrePeriodo}-`;
  let ultimoError: unknown;
  for (let intento = 0; intento < 3; intento++) {
    const asientoRef = await siguienteAsientoRefSb(prefijo);
    const asiento = {
      asiento_ref: asientoRef,
      fecha_asiento: input.fechaEmision,
      periodo_id: periodoUuid,
      origen: 'FACTURA COMPRA',
      centro_costo_id: ccUuid,
      proveedor_id: proveedorUuid,
      banco_id: input.metodoPago === 'Contado' && bancoUuid ? bancoUuid : '',
      descripcion: input.descripcion,
    };
    try {
      const res = await rpc<{
        asiento_id: string;
        asiento_airtable_id: string;
        gasto_airtable_id: string;
      }>('fase2_aprobar_gasto', {
        p_asiento: asiento,
        p_partidas: partidas,
        p_gasto: gasto,
        p_factura_in_id: facturaInUuid,
      }, ['asientos', 'partidas', 'gastos', 'facturas_in']);
      return {
        gastoId: res.gasto_airtable_id,
        asientoId: res.asiento_airtable_id,
        asientoRef,
      };
    } catch (err) {
      ultimoError = err;
      if (err instanceof Error && err.message.includes('ASIENTO_DUPLICADO')) continue;
      throw err;
    }
  }
  throw ultimoError instanceof Error ? ultimoError : new Error('No se pudo generar el asiento (correlativo).');
}

/** Movimiento bancario de conciliación (fail-soft — se llama tras aprobar). */
export async function sbCrearMovimientoBancario(args: {
  bancoAppId: string;
  fecha: string;
  monto: number;
  concepto: string;
  referencia?: string;
  periodoNombre: string;
  asientoAppId: string;
}): Promise<void> {
  const bancoUuid = await uuidRequerido('bancos', args.bancoAppId, 'movimientoBancario');
  const asientoUuid = await uuidRequerido('asientos', args.asientoAppId, 'movimientoBancario');
  await insertar('movimientos_bancarios', {
    banco_id: bancoUuid,
    fecha: args.fecha,
    monto: args.monto,
    descripcion: args.concepto,
    referencia: args.referencia?.trim() || null,
    conciliado: false,
    asiento_id: asientoUuid,
    tipo: 'Egreso',
    periodo: args.periodoNombre,
  });
}

/* Reexports internos útiles para el validador de staging. */
export const _internals = { siguienteAsientoRefSb, cuentaContableDelBancoSb };
export { uuidDe, airtableIdDe, invalidarBridge, nuevoIdEscritura };
