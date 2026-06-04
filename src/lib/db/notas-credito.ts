/**
 * F-045 — Módulo de Notas de Crédito.
 *
 * Principio contable: la factura ES INMUTABLE. Su TOTAL nunca cambia. Una NC
 * es un evento POSTERIOR que reduce el saldo pendiente cobrable. Los reportes
 * deben distinguir "facturado bruto" (suma de TOTALES) de "facturado neto"
 * (bruto - NCs activas).
 *
 * Decisiones:
 *  - Tabla NOTAS_CREDITO separada. Stark crea los campos según el brief.
 *  - Correlativo "NC-YYYY-NNN" generado por MAX+1 al emitir (sin tabla
 *    CONTROL_CORRELATIVOS — throughput muy bajo, race aceptable).
 *  - NCs ≤ Q5,000: estado inicial 'Activa' (auto-aprobada).
 *    NCs > Q5,000: estado inicial 'Pendiente Aprobación' (admin la activa).
 *  - Si una NC consume todo el saldo, las líneas de la factura pasan a
 *    COBRADO en Airtable. Al anular una NC, se devuelve el ESTADO previo
 *    (COBRADO PARCIAL si hubo cobros, EMITIDA si no).
 *  - Fail-soft: si la tabla NOTAS_CREDITO no existe (Stark no la creó aún),
 *    las lecturas devuelven [] / null y las escrituras devuelven error claro.
 */

import { airtable, USE_MOCK, TABLES } from './airtable';
import { F } from './mappers';
import { obtenerFechaHoyGuatemala } from '../utils/fechas';

const round2 = (n: number) => Math.round(n * 100) / 100;

export const UMBRAL_APROBACION_NC = 5000;

/* ============================================================
 * Tipos públicos
 * ============================================================ */

export type EstadoNotaCredito = 'Borrador' | 'Pendiente Aprobación' | 'Aprobada' | 'Activa' | 'Anulada';

export type MotivoNC =
  | 'Descuento posterior'
  | 'Devolución parcial de servicio'
  | 'Error de monto al alza'
  | 'Bonificación al cliente'
  | 'Ajuste de cuenta'
  | 'Otro';

export const MOTIVOS_NC: readonly MotivoNC[] = [
  'Descuento posterior',
  'Devolución parcial de servicio',
  'Error de monto al alza',
  'Bonificación al cliente',
  'Ajuste de cuenta',
  'Otro',
];

export interface NotaCredito {
  id: string;
  numeroNC: string;
  facturaId: string;
  facturaNumero: string;
  clienteId: string;
  clienteNombre: string;
  fechaEmision: string;
  monto: number;
  motivo: MotivoNC;
  descripcion: string;
  estado: EstadoNotaCredito;
  emitidaPor: string;
  fechaCreacion: string;
  aprobadaPor?: string;
  fechaAprobacion?: string;
  motivoAnulacion?: string;
  fechaAnulacion?: string;
  anuladaPor?: string;
  adjuntoUrl?: string;
  adjuntoNombre?: string;
}

/* ============================================================
 * Mapeo Airtable
 * ============================================================ */

const NF = {
  NUMERO:       'Numero_NC',
  FACTURA:      'Factura',
  CLIENTE:      'Cliente',
  FECHA_EMI:    'Fecha_Emision',
  MONTO:        'Monto',
  MOTIVO:       'Motivo',
  DESCRIPCION:  'Descripcion',
  ESTADO:       'Estado',
  EMITIDA_POR:  'Emitida_Por',
  FECHA_CREAC:  'Fecha_Creacion',
  APROBADA_POR: 'Aprobada_Por',
  FECHA_APROB:  'Fecha_Aprobacion',
  MOTIVO_ANUL:  'Motivo_Anulacion',
  FECHA_ANUL:   'Fecha_Anulacion',
  ANULADA_POR:  'Anulada_Por',
  ADJUNTO:      'Adjunto',
  // Lookups desde linked records (resuelven nombre/numero sin queries extra)
  FACTURA_NO:   'NO.FACTURA (from Factura)',
  CLIENTE_NOMBRE: 'Razón social (from Cliente)',
} as const;

function estadoFromAirtable(v: unknown): EstadoNotaCredito {
  const s = String(v ?? '').trim();
  if (s === 'Borrador' || s === 'Pendiente Aprobación' || s === 'Aprobada' || s === 'Activa' || s === 'Anulada') {
    return s as EstadoNotaCredito;
  }
  return 'Borrador';
}

function motivoFromAirtable(v: unknown): MotivoNC {
  const s = String(v ?? '').trim();
  if (MOTIVOS_NC.includes(s as MotivoNC)) return s as MotivoNC;
  return 'Otro';
}

const str = (v: unknown): string => Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function recordToNC(r: { id: string; fields: Record<string, unknown> }): NotaCredito {
  const f = r.fields;
  const adjuntos = f[NF.ADJUNTO] as Array<{ url?: string; filename?: string }> | undefined;
  const adjunto = adjuntos?.[0];
  return {
    id: r.id,
    numeroNC: String(f[NF.NUMERO] ?? ''),
    facturaId: str(f[NF.FACTURA]),
    facturaNumero: str(f[NF.FACTURA_NO]),
    clienteId: str(f[NF.CLIENTE]),
    clienteNombre: str(f[NF.CLIENTE_NOMBRE]),
    fechaEmision: String(f[NF.FECHA_EMI] ?? ''),
    monto: round2(num(f[NF.MONTO])),
    motivo: motivoFromAirtable(f[NF.MOTIVO]),
    descripcion: String(f[NF.DESCRIPCION] ?? ''),
    estado: estadoFromAirtable(f[NF.ESTADO]),
    emitidaPor: String(f[NF.EMITIDA_POR] ?? ''),
    fechaCreacion: String(f[NF.FECHA_CREAC] ?? ''),
    aprobadaPor: f[NF.APROBADA_POR] ? String(f[NF.APROBADA_POR]) : undefined,
    fechaAprobacion: f[NF.FECHA_APROB] ? String(f[NF.FECHA_APROB]) : undefined,
    motivoAnulacion: f[NF.MOTIVO_ANUL] ? String(f[NF.MOTIVO_ANUL]) : undefined,
    fechaAnulacion: f[NF.FECHA_ANUL] ? String(f[NF.FECHA_ANUL]) : undefined,
    anuladaPor: f[NF.ANULADA_POR] ? String(f[NF.ANULADA_POR]) : undefined,
    adjuntoUrl: adjunto?.url,
    adjuntoNombre: adjunto?.filename,
  };
}

/* ============================================================
 * Lectura
 * ============================================================ */

/** Todas las NCs (todas las activas + históricas). Devuelve [] si la tabla no existe. */
export async function getNotasCredito(): Promise<NotaCredito[]> {
  if (USE_MOCK || !airtable) return [];
  try {
    const records = await airtable(TABLES.NOTAS_CREDITO)
      .select({ sort: [{ field: NF.FECHA_EMI, direction: 'desc' }] })
      .all();
    return records.map(r => recordToNC({ id: r.id, fields: r.fields as Record<string, unknown> }));
  } catch (err) {
    // Fail-soft: tabla no existe aún o no accesible.
    console.warn('F-045: getNotasCredito() no pudo leer NOTAS_CREDITO:', err instanceof Error ? err.message : err);
    return [];
  }
}

export async function getNotaCreditoPorId(id: string): Promise<NotaCredito | null> {
  if (!airtable) return null;
  try {
    const r = await airtable(TABLES.NOTAS_CREDITO).find(id);
    return recordToNC({ id: r.id, fields: r.fields as Record<string, unknown> });
  } catch {
    return null;
  }
}

export async function getNotasCreditoFactura(facturaId: string): Promise<NotaCredito[]> {
  const todas = await getNotasCredito();
  return todas.filter(n => n.facturaId === facturaId);
}

export async function getNotasCreditoPendientesAprobacion(): Promise<NotaCredito[]> {
  const todas = await getNotasCredito();
  return todas.filter(n => n.estado === 'Pendiente Aprobación');
}

/** Suma de NCs ACTIVAS de una factura — único impacto contable sobre saldo. */
export async function montoNCsActivasDeFactura(facturaId: string): Promise<number> {
  const ncs = await getNotasCreditoFactura(facturaId);
  return round2(ncs.filter(n => n.estado === 'Activa').reduce((s, n) => s + n.monto, 0));
}

/* ============================================================
 * KPIs
 * ============================================================ */

export interface KPIsNotasCredito {
  anio: number;
  totalActivas: number;
  montoActivasAnio: number;
  pendientesAprobacion: number;
  montoPendientesAprobacion: number;
  anuladasAnio: number;
  montoAnuladasAnio: number;
  porMotivo: Array<{ motivo: MotivoNC; cantidad: number; monto: number }>;
  porCliente: Array<{ clienteId: string; clienteNombre: string; cantidad: number; monto: number }>;
}

export async function getKPIsNotasCredito(): Promise<KPIsNotasCredito> {
  const todas = await getNotasCredito();
  const anio = Number(obtenerFechaHoyGuatemala().slice(0, 4));
  const delAnio = todas.filter(n => n.fechaEmision.startsWith(String(anio)));

  const activas = delAnio.filter(n => n.estado === 'Activa');
  const pendientes = todas.filter(n => n.estado === 'Pendiente Aprobación');
  const anuladas = delAnio.filter(n => n.estado === 'Anulada');

  const motivoMap = new Map<MotivoNC, { cantidad: number; monto: number }>();
  for (const n of activas) {
    const m = motivoMap.get(n.motivo) ?? { cantidad: 0, monto: 0 };
    m.cantidad += 1;
    m.monto += n.monto;
    motivoMap.set(n.motivo, m);
  }
  const porMotivo = [...motivoMap.entries()]
    .map(([motivo, v]) => ({ motivo, cantidad: v.cantidad, monto: round2(v.monto) }))
    .sort((a, b) => b.monto - a.monto);

  const cliMap = new Map<string, { nombre: string; cantidad: number; monto: number }>();
  for (const n of activas) {
    const k = n.clienteId || '__sin_cliente__';
    const c = cliMap.get(k) ?? { nombre: n.clienteNombre || '—', cantidad: 0, monto: 0 };
    c.cantidad += 1;
    c.monto += n.monto;
    cliMap.set(k, c);
  }
  const porCliente = [...cliMap.entries()]
    .map(([clienteId, v]) => ({ clienteId, clienteNombre: v.nombre, cantidad: v.cantidad, monto: round2(v.monto) }))
    .sort((a, b) => b.monto - a.monto);

  return {
    anio,
    totalActivas: activas.length,
    montoActivasAnio: round2(activas.reduce((s, n) => s + n.monto, 0)),
    pendientesAprobacion: pendientes.length,
    montoPendientesAprobacion: round2(pendientes.reduce((s, n) => s + n.monto, 0)),
    anuladasAnio: anuladas.length,
    montoAnuladasAnio: round2(anuladas.reduce((s, n) => s + n.monto, 0)),
    porMotivo,
    porCliente: porCliente.slice(0, 10),
  };
}

/* ============================================================
 * Correlativo NC-YYYY-NNN
 * ============================================================ */

const RE_NC = /^NC-(\d{4})-(\d{3,})$/;

export async function obtenerSiguienteNumeroNC(): Promise<string> {
  const anio = Number(obtenerFechaHoyGuatemala().slice(0, 4));
  const prefijo = `NC-${anio}-`;
  const todas = await getNotasCredito();
  let max = 0;
  for (const n of todas) {
    const m = RE_NC.exec(n.numeroNC);
    if (!m) continue;
    if (Number(m[1]) !== anio) continue;
    const num = Number(m[2]);
    if (Number.isFinite(num) && num > max) max = num;
  }
  return `${prefijo}${String(max + 1).padStart(3, '0')}`;
}

/* ============================================================
 * Mutaciones
 * ============================================================ */

export interface CrearNotaCreditoInput {
  facturaId: string;
  fechaEmision: string;       // YYYY-MM-DD
  monto: number;
  motivo: MotivoNC;
  descripcion: string;
}

export interface CrearNotaCreditoResult {
  ok: boolean;
  notaCreditoId?: string;
  numeroNC?: string;
  estadoInicial?: EstadoNotaCredito;
  requirioAprobacion?: boolean;
  facturaActualizada?: boolean;   // true si emisión activa dejó saldo=0 y pasamos factura a COBRADO
  error?: string;
}

/** Trae los records de FACTURAS_CLIENTES de una factura por record-id del principal. */
async function leerRecordsDeFacturaPorPrincipalId(facturaId: string): Promise<{ records: Array<{ id: string; fields: Record<string, unknown> }>; total: number; estados: string[]; numeroFactura: string }> {
  if (!airtable) throw new Error('Airtable no está configurado.');
  const principal = await airtable(TABLES.FACTURAS).find(facturaId);
  const noFactura = String(principal.fields[F.NO_FACTURA] ?? '').trim();
  if (!noFactura) throw new Error('La factura no tiene NO.FACTURA.');
  const esc = noFactura.replace(/"/g, '\\"');
  const all = await airtable(TABLES.FACTURAS)
    .select({ filterByFormula: `{${F.NO_FACTURA}} = "${esc}"`, maxRecords: 100 })
    .all();
  const lineas = all
    .map(r => ({ id: r.id, fields: r.fields as Record<string, unknown> }))
    .filter(r => {
      const e = String(r.fields[F.ESTADO] ?? '').toUpperCase().trim();
      return e !== 'ANULADO' && e !== 'ANULADA' && e !== 'REFACTURADO' && e !== 'REFACTURADA';
    });
  const total = lineas.reduce((s, r) => s + Number(r.fields[F.TOTAL] ?? 0), 0);
  const estados = lineas.map(r => String(r.fields[F.ESTADO] ?? '').toUpperCase().trim());
  return { records: lineas, total: round2(total), estados, numeroFactura: noFactura };
}

/** Suma cobros ACTIVOS de una factura (capital). Reusa el mismo predicado que cobros.ts. */
async function sumarCobrosActivos(noFactura: string): Promise<number> {
  if (!airtable) return 0;
  const esc = noFactura.replace(/"/g, '\\"');
  const cobros = await airtable(TABLES.COBROS)
    .select({ filterByFormula: `{NO.FACTURA (from Factura Cliente)} = "${esc}"` })
    .all();
  const activos = cobros.filter(r => {
    const estado = String((r.fields as Record<string, unknown>)['Estado_Cobro'] ?? '').toLowerCase();
    return estado === '' || estado === 'activo';
  });
  // Monto_Cobro_GTQ es el campo de monto del cobro (capital, sin retenciones).
  return round2(activos.reduce((s, r) => s + Number((r.fields as Record<string, unknown>)['Monto_Cobro_GTQ'] ?? 0), 0));
}

/** Recalcula ESTADO de las líneas de la factura tras emitir/anular una NC. */
async function aplicarEstadoTrasSaldo(facturaId: string, motivo: 'nc-activada' | 'nc-anulada'): Promise<boolean> {
  if (!airtable) return false;
  try {
    const { records, total, numeroFactura } = await leerRecordsDeFacturaPorPrincipalId(facturaId);
    if (records.length === 0) return false;
    const cobrado = await sumarCobrosActivos(numeroFactura);
    const ncsActivas = await montoNCsActivasDeFactura(facturaId);
    const saldoNeto = round2(Math.max(0, total - cobrado - ncsActivas));

    // Nuevo estado para las líneas:
    //   saldoNeto = 0     → COBRADO   (factura saldada, sea por cobro o por NC)
    //   cobrado > 0       → COBRADO PARCIAL
    //   resto              → EMITIDA
    const nuevoEstado = saldoNeto <= 0.01 ? 'COBRADO'
                       : cobrado > 0      ? 'COBRADO PARCIAL'
                       :                    'EMITIDA';

    const updates = records.map(r => ({ id: r.id, fields: { [F.ESTADO]: nuevoEstado } }));
    for (let i = 0; i < updates.length; i += 10) {
      await airtable(TABLES.FACTURAS).update(updates.slice(i, i + 10));
    }
    return true;
  } catch (err) {
    console.warn(`F-045: aplicarEstadoTrasSaldo (${motivo}) falló:`, err instanceof Error ? err.message : err);
    return false;
  }
}

export async function crearNotaCredito(input: CrearNotaCreditoInput, usuarioEmail: string): Promise<CrearNotaCreditoResult> {
  if (!airtable) return { ok: false, error: 'Airtable no está configurado.' };
  if (!input.facturaId)             return { ok: false, error: 'Falta la factura.' };
  if (!input.fechaEmision)          return { ok: false, error: 'Falta la fecha de emisión.' };
  if (!(input.monto > 0))           return { ok: false, error: 'El monto debe ser mayor a 0.' };
  if (!input.descripcion?.trim())   return { ok: false, error: 'La descripción es requerida.' };
  if (!MOTIVOS_NC.includes(input.motivo)) return { ok: false, error: 'Motivo inválido.' };

  try {
    // 1) Validar factura no anulada/refacturada y obtener total real.
    const { total, numeroFactura, records } = await leerRecordsDeFacturaPorPrincipalId(input.facturaId);
    if (records.length === 0) {
      return { ok: false, error: `La factura está anulada o refacturada — no se pueden emitir NCs.` };
    }
    // Cliente: tomar el primero del bucket (todos tienen el mismo CLIENTE).
    const clienteIdLinks = records[0]?.fields[F.CLIENTE] as string[] | undefined;
    const clienteId = clienteIdLinks?.[0];

    // 2) Validar saldo. Monto NC no puede exceder saldo neto disponible
    // (total - cobros activos - NCs activas previas).
    const cobrado = await sumarCobrosActivos(numeroFactura);
    const ncsPrevias = await montoNCsActivasDeFactura(input.facturaId);
    const saldoDisponible = round2(Math.max(0, total - cobrado - ncsPrevias));
    if (input.monto > saldoDisponible + 0.01) {
      return { ok: false, error: `La NC (Q${input.monto.toFixed(2)}) excede el saldo pendiente disponible (Q${saldoDisponible.toFixed(2)}).` };
    }
    if (input.monto > total + 0.01) {
      return { ok: false, error: `La NC no puede exceder el TOTAL de la factura.` };
    }

    // 3) Generar correlativo y estado inicial.
    const numeroNC = await obtenerSiguienteNumeroNC();
    const requiereAprob = input.monto > UMBRAL_APROBACION_NC;
    const estadoInicial: EstadoNotaCredito = requiereAprob ? 'Pendiente Aprobación' : 'Activa';

    type AField = string | number | string[] | undefined;
    const fields: Record<string, AField> = {
      [NF.NUMERO]:      numeroNC,
      [NF.FACTURA]:     [input.facturaId],
      [NF.FECHA_EMI]:   input.fechaEmision,
      [NF.MONTO]:       input.monto,
      [NF.MOTIVO]:      input.motivo,
      [NF.DESCRIPCION]: input.descripcion.trim(),
      [NF.ESTADO]:      estadoInicial,
      [NF.EMITIDA_POR]: usuarioEmail,
    };
    if (clienteId) fields[NF.CLIENTE] = [clienteId];

    const created = await airtable(TABLES.NOTAS_CREDITO).create(fields);
    let facturaActualizada = false;
    if (estadoInicial === 'Activa') {
      facturaActualizada = await aplicarEstadoTrasSaldo(input.facturaId, 'nc-activada');
    }

    return {
      ok: true,
      notaCreditoId: created.id,
      numeroNC,
      estadoInicial,
      requirioAprobacion: requiereAprob,
      facturaActualizada,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface AprobarNCResult {
  ok: boolean;
  facturaActualizada?: boolean;
  error?: string;
}

export async function aprobarNotaCredito(ncId: string, usuarioEmail: string, esAdmin: boolean): Promise<AprobarNCResult> {
  if (!airtable) return { ok: false, error: 'Airtable no está configurado.' };
  if (!esAdmin)  return { ok: false, error: 'Solo un administrador puede aprobar notas de crédito.' };
  try {
    const nc = await getNotaCreditoPorId(ncId);
    if (!nc) return { ok: false, error: 'Nota de crédito no encontrada.' };
    if (nc.estado !== 'Pendiente Aprobación') {
      return { ok: false, error: `La NC está en estado ${nc.estado} — solo se aprueban las 'Pendiente Aprobación'.` };
    }
    await airtable(TABLES.NOTAS_CREDITO).update([{
      id: ncId,
      fields: {
        [NF.ESTADO]:       'Activa',
        [NF.APROBADA_POR]: usuarioEmail,
        [NF.FECHA_APROB]:  obtenerFechaHoyGuatemala(),
      },
    }]);
    const facturaActualizada = await aplicarEstadoTrasSaldo(nc.facturaId, 'nc-activada');
    return { ok: true, facturaActualizada };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface AnularNCResult {
  ok: boolean;
  facturaActualizada?: boolean;
  error?: string;
}

export async function anularNotaCredito(ncId: string, motivoAnulacion: string, usuarioEmail: string): Promise<AnularNCResult> {
  if (!airtable) return { ok: false, error: 'Airtable no está configurado.' };
  if (!motivoAnulacion?.trim()) return { ok: false, error: 'El motivo de anulación es requerido.' };
  try {
    const nc = await getNotaCreditoPorId(ncId);
    if (!nc) return { ok: false, error: 'Nota de crédito no encontrada.' };
    if (nc.estado !== 'Activa' && nc.estado !== 'Aprobada') {
      return { ok: false, error: `La NC está en estado ${nc.estado} — solo se anulan las Activas o Aprobadas.` };
    }
    await airtable(TABLES.NOTAS_CREDITO).update([{
      id: ncId,
      fields: {
        [NF.ESTADO]:      'Anulada',
        [NF.MOTIVO_ANUL]: motivoAnulacion.trim(),
        [NF.FECHA_ANUL]:  obtenerFechaHoyGuatemala(),
        [NF.ANULADA_POR]: usuarioEmail,
      },
    }]);
    // Recalcular ESTADO de la factura (saldo subió de vuelta).
    const facturaActualizada = await aplicarEstadoTrasSaldo(nc.facturaId, 'nc-anulada');
    return { ok: true, facturaActualizada };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
