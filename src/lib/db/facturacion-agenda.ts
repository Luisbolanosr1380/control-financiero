/**
 * FACTURACIÓN AGENDA (migración 016) — lectura y escritura en Supabase.
 *
 * Trae de la Agenda de Golden los expedientes de evaluación, los clasifica
 * contra el mapeo de clientes (`cliente_externo`) y el tarifario (motor de
 * `src/lib/tarifario/`), los deja en `facturacion_expediente` (cola "Por
 * facturar"), emite la factura en financiero (RPC `facturacion_agenda_emitir`:
 * factura + detalle + vínculo en UNA transacción) y escribe de vuelta a la
 * Agenda SOLO el cobro (`POST /facturas`, `POST /lote`).
 *
 * Consistencia (brief §7): si la factura quedó creada pero la Agenda falló, el
 * expediente queda con `writeback_estado` 'pendiente' / 'conflicto' / 'error'
 * (nunca "facturado en Agenda") y se puede reintentar sin duplicar la factura.
 * Un 409 no se reintenta en loop: se vuelve a leer el expediente y se decide.
 */
import { supabase, fetchAll } from '@/lib/supabase/client';
import { nuevoIdEscritura, rpc, uuidOpcional, uuidRequerido } from '@/lib/supabase/writes';
import { nitComparable, nitEsPlaceholder } from '@/lib/clientes/nit';
import { nombresDe } from '@/lib/clientes/buscar';
import { conIva, normalizarTexto } from '@/lib/tarifario/canon';
import { indiceAlias, nombreBase, resolverNit } from '@/lib/tarifario/lookup';
import { obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';
import { configAgenda } from '@/lib/facturacion-agenda/config';
import { AgendaApiError, crearAgendaApi, idsDe, resumirCuerpo, type AgendaApi, type LogSaliente } from '@/lib/facturacion-agenda/agenda-api';
import { armarFactura, centroPorServicio, clasificarExpediente, conPrecio, expedienteALocal, montoParaAgenda, type ContextoPrecio } from '@/lib/facturacion-agenda/mapeo';
import { agruparPorCliente, kpisPorFacturar, parseClave, type GrupoCliente, type KpisPorFacturar } from '@/lib/facturacion-agenda/resumen';
import { ETIQUETA_ESTADO_TARIFA, ETIQUETA_WRITEBACK, FUENTE_AGENDA, type ClienteExterno, type EmpresaNoFactura, type ComponentePrecio, type DetalleFacturaExpediente, type EstadoTarifa, type ExpedienteAgenda, type ExpedienteLocal, type SyncEstado, type WritebackEstado } from '@/lib/facturacion-agenda/tipos';
import { getTarifario } from './tarifario';
import { getClientes } from './clientes';
import { getCentrosCostoActivos, type CentroCosto } from './centros';
import type { Customer } from '@/lib/types';

const FUENTE = FUENTE_AGENDA;

// ── Filas ───────────────────────────────────────────────────────────────────

interface ExpRow {
  id: string; fuente: string; id_externo: string; empresa_id_externo: string | null; empresa_nombre_externo: string | null; nit_resuelto: string | null; cliente_id: string | null;
  persona: string | null; puesto: string | null; solicitante: string | null; tipo_prueba: string | null; categoria_prueba: string | null; proceso_solicitado: string | null; depto_visita: string | null;
  tipo_cobrado: string | null; categoria_canon: string | null; territorio_resuelto: string | null; fecha_ingreso: string | null; fecha_entrega: string | null; status_proceso: string | null;
  terminado: boolean; cancelado: boolean; eliminado: boolean; en_vista_facturacion: boolean | null;
  status_cobro_externo: string | null; estatus_pago_externo: string | null; monto_externo: number | string | null; numero_factura_externo: string | null; fecha_factura_externo: string | null; cobro_megapaca: number | string | null; costo_visita: number | string | null;
  monto_calculado: number | string | null; estado_tarifa: EstadoTarifa; detalle_tarifa: string | null; componentes: ComponentePrecio[] | null;
  creado_en_externo: string | null; actualizado_en_externo: string | null;
  factura_id: string | null; factura_app_id: string | null; no_factura: string | null; facturado_en: string | null; facturado_por: string | null;
  writeback_estado: WritebackEstado | null; writeback_detalle: string | null; writeback_en: string | null; cobro_writeback_estado: string | null; cobro_writeback_detalle: string | null;
  detalle_id?: string | null;
  raw: unknown; updated_at: string | null;
}
const num = (v: number | string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));
const txt = (v: string | null | undefined): string => v ?? '';
/** `actualizadoEn` exacto del raw guardado (la Agenda compara el string que ella misma mandó). */
const crudoDe = (raw: unknown): string | null => { const v = raw && typeof raw === 'object' ? (raw as { actualizadoEn?: unknown }).actualizadoEn : null; return typeof v === 'string' && v ? v : null; };
const siActualizadoEnDe = (r: { actualizadoEnExternoCrudo: string | null; actualizadoEnExterno: string | null }): string | undefined => r.actualizadoEnExternoCrudo ?? r.actualizadoEnExterno ?? undefined;

export const rowToLocal = (r: ExpRow): ExpedienteLocal => ({
  id: r.id, fuente: r.fuente, idExterno: r.id_externo, empresaIdExterno: txt(r.empresa_id_externo), empresaNombreExterno: txt(r.empresa_nombre_externo), nitResuelto: r.nit_resuelto, clienteId: r.cliente_id,
  persona: txt(r.persona), puesto: txt(r.puesto), solicitante: txt(r.solicitante), tipoPrueba: txt(r.tipo_prueba), categoriaPrueba: txt(r.categoria_prueba), procesoSolicitado: txt(r.proceso_solicitado), deptoVisita: txt(r.depto_visita),
  tipoCobrado: txt(r.tipo_cobrado), categoriaCanon: txt(r.categoria_canon), territorioResuelto: txt(r.territorio_resuelto), fechaIngreso: r.fecha_ingreso, fechaEntrega: r.fecha_entrega, statusProceso: txt(r.status_proceso),
  terminado: !!r.terminado, cancelado: !!r.cancelado, eliminado: !!r.eliminado, enVistaFacturacion: r.en_vista_facturacion,
  statusCobroExterno: r.status_cobro_externo, estatusPagoExterno: r.estatus_pago_externo, montoExterno: num(r.monto_externo), numeroFacturaExterno: r.numero_factura_externo, fechaFacturaExterno: r.fecha_factura_externo, cobroMegapaca: num(r.cobro_megapaca), costoVisita: num(r.costo_visita),
  montoCalculado: num(r.monto_calculado), estadoTarifa: r.estado_tarifa, detalleTarifa: txt(r.detalle_tarifa), componentes: Array.isArray(r.componentes) ? r.componentes : [],
  creadoEnExterno: r.creado_en_externo, actualizadoEnExterno: r.actualizado_en_externo, actualizadoEnExternoCrudo: crudoDe(r.raw) ?? r.actualizado_en_externo,
  facturaId: r.factura_id, facturaAppId: r.factura_app_id, noFactura: r.no_factura, facturadoEn: r.facturado_en, facturadoPor: r.facturado_por,
  writebackEstado: r.writeback_estado, writebackDetalle: r.writeback_detalle, writebackEn: r.writeback_en, cobroWritebackEstado: r.cobro_writeback_estado, cobroWritebackDetalle: r.cobro_writeback_detalle,
  detalleId: r.detalle_id ?? null,
  updatedAt: r.updated_at,
});

type FilaEspejo = ReturnType<typeof expedienteALocal> & { clienteId: string | null; raw: unknown };
const espejoARow = (l: FilaEspejo): Record<string, unknown> => ({
  fuente: FUENTE, id_externo: l.idExterno, empresa_id_externo: l.empresaIdExterno || null, empresa_nombre_externo: l.empresaNombreExterno || null, nit_resuelto: l.nitResuelto, cliente_id: l.clienteId,
  persona: l.persona || null, puesto: l.puesto || null, solicitante: l.solicitante || null, tipo_prueba: l.tipoPrueba || null, categoria_prueba: l.categoriaPrueba || null, proceso_solicitado: l.procesoSolicitado || null, depto_visita: l.deptoVisita || null,
  tipo_cobrado: l.tipoCobrado || null, categoria_canon: l.categoriaCanon || null, territorio_resuelto: l.territorioResuelto || null, fecha_ingreso: l.fechaIngreso, fecha_entrega: l.fechaEntrega, status_proceso: l.statusProceso || null,
  terminado: l.terminado, cancelado: l.cancelado, eliminado: l.eliminado, en_vista_facturacion: l.enVistaFacturacion,
  status_cobro_externo: l.statusCobroExterno, estatus_pago_externo: l.estatusPagoExterno, monto_externo: l.montoExterno, numero_factura_externo: l.numeroFacturaExterno, fecha_factura_externo: l.fechaFacturaExterno, cobro_megapaca: l.cobroMegapaca, costo_visita: l.costoVisita,
  monto_calculado: l.montoCalculado, estado_tarifa: l.estadoTarifa, detalle_tarifa: l.detalleTarifa || null, componentes: l.componentes,
  creado_en_externo: l.creadoEnExterno, actualizado_en_externo: l.actualizadoEnExterno, raw: l.raw, updated_at: new Date().toISOString(),
});

type Consulta = { range(a: number, b: number): PromiseLike<{ data: unknown; error: { message: string } | null }> };
/** Agota la paginación de PostgREST (cap de 1000) para una consulta con filtros arbitrarios. */
async function paginar<T>(hacer: () => Consulta, contexto: string): Promise<T[]> {
  const PAGE = 1000; const out: T[] = [];
  for (let p = 0; ; p++) {
    const { data, error } = await hacer().range(p * PAGE, p * PAGE + PAGE - 1);
    if (error) throw new Error(`${contexto}: ${error.message}`);
    const rows = (data ?? []) as T[]; out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Como paginar(), pero si la columna detalle_id no existe (sin 019) reintenta sin ella. */
async function paginarTolerante<T>(hacer: () => Consulta, contexto: string): Promise<T[]> {
  try { return await paginar<T>(hacer, contexto); }
  catch (e) { if (/detalle_id/.test(e instanceof Error ? e.message : String(e))) return []; throw e; }
}

/** true si la 016 está aplicada en esta base. */
export async function facturacionAgendaDisponible(): Promise<boolean> {
  const sb = supabase(); if (!sb) return false;
  const { error } = await sb.from('facturacion_expediente').select('id').limit(1);
  return !error;
}

// ── Mapeo de clientes ───────────────────────────────────────────────────────

interface MapeoRow { id: string; fuente: string; empresa_id_externo: string; empresa_nombre_externo: string | null; nit: string; cliente_id: string | null; activo: boolean; creado_por: string | null; no_factura?: boolean | null; motivo_no_factura?: string | null; updated_at?: string | null }
const rowToMapeo = (r: MapeoRow): ClienteExterno => ({ id: r.id, fuente: r.fuente, empresaIdExterno: r.empresa_id_externo, empresaNombreExterno: r.empresa_nombre_externo ?? '', nit: r.nit, clienteId: r.cliente_id, activo: !!r.activo, creadoPor: r.creado_por ?? '', noFactura: !!r.no_factura, motivoNoFactura: r.motivo_no_factura ?? '' });

export async function getMapeos(): Promise<ClienteExterno[]> {
  try { return (await fetchAll<MapeoRow>('cliente_externo', { eq: { fuente: FUENTE } })).map(rowToMapeo); } catch { return []; }
}

export const nitPorEmpresa = (mapeos: readonly ClienteExterno[]): Map<string, string> => new Map(mapeos.filter(m => m.activo && m.nit && !m.noFactura).map(m => [m.empresaIdExterno, m.nit]));
/** 018: empresas marcadas "no se factura" → motivo. */
export const noFacturaPorEmpresa = (mapeos: readonly ClienteExterno[]): Map<string, string> => new Map(mapeos.filter(m => m.activo && m.noFactura).map(m => [m.empresaIdExterno, m.motivoNoFactura]));

export interface Contexto extends ContextoPrecio { mapeos: ClienteExterno[]; clienteUuidPorEmpresa: Map<string, string> }
export async function cargarContexto(): Promise<Contexto> {
  const [tarifas, mapeos] = await Promise.all([getTarifario(), getMapeos()]);
  return { tarifas, mapeos, nitPorEmpresa: nitPorEmpresa(mapeos), noFacturaEmpresas: noFacturaPorEmpresa(mapeos), clienteUuidPorEmpresa: new Map(mapeos.filter(m => m.activo && m.clienteId && !m.noFactura).map(m => [m.empresaIdExterno, m.clienteId!])) };
}

export type MapeoResult = { ok: true; nit: string; clienteNombre: string; reclasificados: number } | { ok: false; error: string };

/** Mapea una empresa de la Agenda a un cliente de financiero (por su id de app) y re-resuelve sus expedientes. */
export async function guardarMapeo(input: { empresaIdExterno: string; empresaNombreExterno?: string; clienteAppId: string }, actor: string): Promise<MapeoResult> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
  const empresaId = String(input.empresaIdExterno ?? '').trim();
  if (!empresaId) return { ok: false, error: 'Falta la empresa de la Agenda.' };
  const cliente = (await getClientes()).find(c => c.id === input.clienteAppId);
  if (!cliente) return { ok: false, error: 'El cliente elegido no existe.' };
  if (cliente.activo === false) return { ok: false, error: `El cliente ${cliente.name} está inactivo.` };
  const nit = nitComparable(cliente.nit);
  if (nitEsPlaceholder(nit)) return { ok: false, error: `El cliente ${cliente.name} no tiene NIT: cargáselo antes de mapearlo (el tarifario va por NIT).` };
  const clienteUuid = await uuidOpcional('clientes', input.clienteAppId);
  const { error } = await sb.from('cliente_externo').upsert({
    fuente: FUENTE, empresa_id_externo: empresaId, empresa_nombre_externo: (input.empresaNombreExterno ?? '').trim() || null,
    nit, cliente_id: clienteUuid, activo: true, creado_por: actor, no_factura: false, motivo_no_factura: null, updated_at: new Date().toISOString(),
  }, { onConflict: 'fuente,empresa_id_externo' });
  if (error) return { ok: false, error: `No se pudo guardar el mapeo: ${error.message}` };
  const reclasificados = await reclasificar({ empresaIdExterno: empresaId });
  return { ok: true, nit, clienteNombre: cliente.name, reclasificados };
}

export type NoFacturaResult = { ok: true; reclasificados: number; estado: 'marcada' | 'quitada' } | { ok: false; error: string };

export interface EmpresaRef { empresaIdExterno: string; empresaNombreExterno?: string }
export type LoteResult = { ok: true; aplicadas: number; reclasificados: number; nit?: string; clienteNombre?: string } | { ok: false; error: string };

const empresasValidas = (empresas: readonly EmpresaRef[]): EmpresaRef[] => {
  const vistos = new Set<string>(); const out: EmpresaRef[] = [];
  for (const e of empresas ?? []) { const id = String(e?.empresaIdExterno ?? '').trim(); if (id && !vistos.has(id)) { vistos.add(id); out.push({ empresaIdExterno: id, empresaNombreExterno: (e.empresaNombreExterno ?? '').trim() }); } }
  return out;
};

/** MASIVO: mapea varias empresas de la Agenda al MISMO cliente (Walmart/… → la matriz) en un solo write y re-resuelve todas de una. */
export async function guardarMapeoLote(input: { empresas: EmpresaRef[]; clienteAppId: string }, actor: string): Promise<LoteResult> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
  const empresas = empresasValidas(input.empresas);
  if (!empresas.length) return { ok: false, error: 'Elegí al menos una empresa.' };
  if (empresas.length > 500) return { ok: false, error: 'Hasta 500 empresas por lote.' };
  const cliente = (await getClientes()).find(c => c.id === input.clienteAppId);
  if (!cliente) return { ok: false, error: 'El cliente elegido no existe.' };
  if (cliente.activo === false) return { ok: false, error: `El cliente ${cliente.name} está inactivo.` };
  const nit = nitComparable(cliente.nit);
  if (nitEsPlaceholder(nit)) return { ok: false, error: `El cliente ${cliente.name} no tiene NIT: cargáselo antes de mapearlo (el tarifario va por NIT).` };
  const clienteUuid = await uuidOpcional('clientes', input.clienteAppId);
  const ahora = new Date().toISOString();
  const { error } = await sb.from('cliente_externo').upsert(empresas.map(e => ({
    fuente: FUENTE, empresa_id_externo: e.empresaIdExterno, empresa_nombre_externo: e.empresaNombreExterno || null,
    nit, cliente_id: clienteUuid, activo: true, creado_por: actor, no_factura: false, motivo_no_factura: null, updated_at: ahora,
  })), { onConflict: 'fuente,empresa_id_externo' });
  if (error) return { ok: false, error: `No se pudo guardar el mapeo: ${error.message}` };
  const reclasificados = await reclasificar({ empresasIdExterno: empresas.map(e => e.empresaIdExterno) });
  return { ok: true, aplicadas: empresas.length, reclasificados, nit, clienteNombre: cliente.name };
}

/** MASIVO: marca varias empresas como "no se factura" con UN motivo; conserva el mapeo que tuvieran. */
export async function marcarNoFacturaLote(input: { empresas: EmpresaRef[]; motivo?: string }, actor: string): Promise<LoteResult> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
  const empresas = empresasValidas(input.empresas);
  if (!empresas.length) return { ok: false, error: 'Elegí al menos una empresa.' };
  if (empresas.length > 500) return { ok: false, error: 'Hasta 500 empresas por lote.' };
  const motivo = String(input.motivo ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
  const previos = new Map((await getMapeos()).map(m => [m.empresaIdExterno, m]));
  const ahora = new Date().toISOString();
  const { error } = await sb.from('cliente_externo').upsert(empresas.map(e => { const p = previos.get(e.empresaIdExterno); return {
    fuente: FUENTE, empresa_id_externo: e.empresaIdExterno, empresa_nombre_externo: e.empresaNombreExterno || p?.empresaNombreExterno || null,
    nit: p?.nit ?? '', cliente_id: p?.clienteId ?? null, activo: true, creado_por: actor, no_factura: true, motivo_no_factura: motivo || null, updated_at: ahora,
  }; }), { onConflict: 'fuente,empresa_id_externo' });
  if (error) return { ok: false, error: /no_factura/.test(error.message) ? 'Falta aplicar la migración 018_agenda_no_factura en esta base.' : `No se pudo marcar: ${error.message}` };
  const reclasificados = await reclasificar({ empresasIdExterno: empresas.map(e => e.empresaIdExterno) });
  return { ok: true, aplicadas: empresas.length, reclasificados };
}

/**
 * 018: marca una empresa de la Agenda como "no se factura" por este flujo (interna /
 * intercompany / reclutamiento = Fase A). Todos sus expedientes, presentes y futuros, pasan
 * a 'excluido_no_factura'. Si ya estaba mapeada a un NIT, el mapeo se conserva para
 * cuando se quite la marca. Reversible con quitarNoFactura().
 */
export async function marcarNoFactura(input: { empresaIdExterno: string; empresaNombreExterno?: string; motivo?: string }, actor: string): Promise<NoFacturaResult> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
  const empresaId = String(input.empresaIdExterno ?? '').trim();
  if (!empresaId) return { ok: false, error: 'Falta la empresa de la Agenda.' };
  const motivo = String(input.motivo ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
  const previo = (await getMapeos()).find(m => m.empresaIdExterno === empresaId);
  const { error } = await sb.from('cliente_externo').upsert({
    fuente: FUENTE, empresa_id_externo: empresaId, empresa_nombre_externo: (input.empresaNombreExterno ?? '').trim() || previo?.empresaNombreExterno || null,
    nit: previo?.nit ?? '', cliente_id: previo?.clienteId ?? null, activo: true, creado_por: actor, no_factura: true, motivo_no_factura: motivo || null, updated_at: new Date().toISOString(),
  }, { onConflict: 'fuente,empresa_id_externo' });
  if (error) return { ok: false, error: /no_factura/.test(error.message) ? 'Falta aplicar la migración 018_agenda_no_factura en esta base.' : `No se pudo marcar la empresa: ${error.message}` };
  const reclasificados = await reclasificar({ empresaIdExterno: empresaId });
  return { ok: true, reclasificados, estado: 'marcada' };
}

/** 018: quita la marca "no se factura": la empresa vuelve a su mapeo (si lo tenía) o a "cliente sin mapear". */
export async function quitarNoFactura(empresaIdExterno: string, actor: string): Promise<NoFacturaResult> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
  const empresaId = String(empresaIdExterno ?? '').trim();
  const previo = (await getMapeos()).find(m => m.empresaIdExterno === empresaId);
  if (!previo || !previo.noFactura) return { ok: false, error: 'La empresa no está marcada como "no se factura".' };
  const { error } = await sb.from('cliente_externo').update({ no_factura: false, motivo_no_factura: null, activo: !!previo.nit, creado_por: actor, updated_at: new Date().toISOString() }).eq('fuente', FUENTE).eq('empresa_id_externo', empresaId);
  if (error) return { ok: false, error: `No se pudo quitar la marca: ${error.message}` };
  const reclasificados = await reclasificar({ empresaIdExterno: empresaId });
  return { ok: true, reclasificados, estado: 'quitada' };
}

// ── Espejo de expedientes ───────────────────────────────────────────────────

/** Guarda (upsert por fuente + id_externo) las filas espejo. NO toca factura_id ni los estados de write-back. */
export async function upsertExpedientes(filas: FilaEspejo[]): Promise<number> {
  const sb = supabase(); if (!sb) throw new Error('Supabase no está configurado.');
  let n = 0;
  for (let i = 0; i < filas.length; i += 200) {
    const lote = filas.slice(i, i + 200).map(espejoARow);
    const { error } = await sb.from('facturacion_expediente').upsert(lote, { onConflict: 'fuente,id_externo' });
    if (error) throw new Error(`facturacion_expediente upsert: ${error.message}`);
    n += lote.length;
  }
  return n;
}

/** Clasifica (mapeo + tarifario) y guarda expedientes tal como vienen de la Agenda. */
export async function procesarExpedientes(exps: readonly ExpedienteAgenda[], ctx: Contexto): Promise<number> {
  const filas: FilaEspejo[] = [];
  for (const e of exps) {
    if (!e || typeof e !== 'object' || !e.id) continue;
    const c = clasificarExpediente(e, ctx);
    filas.push({ ...expedienteALocal(e, c), clienteId: ctx.clienteUuidPorEmpresa.get(String(e.empresa?.id ?? '')) ?? null, raw: e });
  }
  return filas.length ? upsertExpedientes(filas) : 0;
}

/**
 * Re-resuelve contra el mapeo y el tarifario ACTUALES los expedientes sin factura
 * (a partir del `raw` guardado). Así un "sin tarifa" se resuelve solo cuando el
 * CFO carga la tarifa, y un "cliente sin mapear" al mapear la empresa.
 */
export async function reclasificar(filtro: { empresaIdExterno?: string; empresasIdExterno?: string[]; /** solo los expedientes ya resueltos a este NIT (tras tocar su tarifario) */ nit?: string } = {}, ctxDado?: Contexto): Promise<number> {
  const sb = supabase(); if (!sb) return 0;
  const ctx = ctxDado ?? await cargarContexto();
  const rows = await paginar<{ id_externo: string; raw: ExpedienteAgenda | null; estado_tarifa: EstadoTarifa; monto_calculado: number | string | null; nit_resuelto: string | null; detalle_tarifa: string | null }>(() => {
    // Solo la cola (terminados vigentes sin factura): lo demás se vuelve a clasificar cuando la Agenda lo cambie (sync).
    let q = sb.from('facturacion_expediente').select('id_externo, raw, estado_tarifa, monto_calculado, nit_resuelto, detalle_tarifa').eq('fuente', FUENTE).is('factura_id', null).eq('terminado', true).eq('cancelado', false).eq('eliminado', false).order('id_externo');
    if (filtro.empresaIdExterno) q = q.eq('empresa_id_externo', filtro.empresaIdExterno);
    if (filtro.empresasIdExterno) q = q.in('empresa_id_externo', filtro.empresasIdExterno);
    if (filtro.nit) q = q.eq('nit_resuelto', filtro.nit);
    return q;
  }, 'reclasificar');
  const cambiados: ExpedienteAgenda[] = [];
  for (const r of rows) {
    if (!r.raw || typeof r.raw !== 'object') continue;
    const c = clasificarExpediente(r.raw, ctx);
    if (c.estado !== r.estado_tarifa || (c.monto ?? null) !== num(r.monto_calculado) || (c.nit ?? null) !== (r.nit_resuelto ?? null) || c.detalle !== (r.detalle_tarifa ?? '')) cambiados.push(r.raw);
  }
  return cambiados.length ? procesarExpedientes(cambiados, ctx) : 0;
}

export interface FiltroExpedientes { nit?: string; empresaIdExterno?: string; noFactura?: string; idsExternos?: string[]; detalleId?: string }

export async function listarExpedientesLocal(f: FiltroExpedientes = {}): Promise<ExpedienteLocal[]> {
  const sb = supabase(); if (!sb) return [];
  try {
    const rows = await paginar<ExpRow>(() => {
      let q = sb.from('facturacion_expediente').select('*').eq('fuente', FUENTE).order('fecha_ingreso', { ascending: false, nullsFirst: false }).order('id_externo');
      if (f.nit) q = q.eq('nit_resuelto', f.nit);
      if (f.empresaIdExterno) q = q.eq('empresa_id_externo', f.empresaIdExterno);
      if (f.noFactura) q = q.eq('no_factura', f.noFactura);
      if (f.idsExternos) q = q.in('id_externo', f.idsExternos);
      if (f.detalleId) q = q.eq('detalle_id', f.detalleId);
      return q;
    }, 'facturacion_expediente');
    return rows.map(rowToLocal);
  } catch (e) { console.error('listarExpedientesLocal:', e); return []; }
}

// ── Sync ────────────────────────────────────────────────────────────────────

interface SyncRow { fuente: string; ultimo_actualizado_en: string | null; ultima_corrida: string | null; ultimo_resultado: string | null; expedientes_leidos: number | null; corridas: number | null }

export async function getSyncEstado(): Promise<SyncEstado | null> {
  const sb = supabase(); if (!sb) return null;
  const { data, error } = await sb.from('facturacion_sync_estado').select('*').eq('fuente', FUENTE).maybeSingle();
  if (error || !data) return null;
  const r = data as SyncRow;
  return { fuente: r.fuente, ultimoActualizadoEn: r.ultimo_actualizado_en, ultimaCorrida: r.ultima_corrida, ultimoResultado: r.ultimo_resultado ?? '', expedientesLeidos: r.expedientes_leidos, corridas: r.corridas ?? 0 };
}

async function guardarSyncEstado(patch: Partial<Omit<SyncRow, 'fuente'>>): Promise<void> {
  const sb = supabase(); if (!sb) return;
  const { error } = await sb.from('facturacion_sync_estado').upsert({ fuente: FUENTE, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'fuente' });
  if (error) console.error('facturacion_sync_estado:', error.message);
}

export async function registrarLog(l: LogSaliente & { actor?: string }): Promise<void> {
  const sb = supabase(); if (!sb) return;
  const { error } = await sb.from('facturacion_log').insert({
    fuente: FUENTE, accion: l.accion, metodo: l.metodo, ruta: l.ruta.slice(0, 500), expedientes: l.expedientes ?? null, status_http: l.statusHttp, ok: l.ok,
    detalle: l.detalle ? l.detalle.slice(0, 1000) : null, duracion_ms: l.duracionMs, actor: l.actor ?? null,
  });
  if (error) console.error('facturacion_log:', error.message);
}

/** Cliente del API para este deploy (null sin llave). Todas las llamadas quedan en facturacion_log. */
export function apiAgenda(opts: { actor?: string; fetchImpl?: typeof fetch; esperar?: (ms: number) => Promise<void>; maxIntentos?: number } = {}): AgendaApi | null {
  const cfg = configAgenda();
  if (!cfg.apiKey) return null;
  return crearAgendaApi({ baseUrl: cfg.url, apiKey: cfg.apiKey, fetchImpl: opts.fetchImpl, esperar: opts.esperar, maxIntentos: opts.maxIntentos, log: l => registrarLog({ ...l, actor: opts.actor }) });
}

export interface ResultadoSync { ok: boolean; leidos: number; paginas: number; hasta: string | null; reclasificados: number; omitido?: string; error?: string }

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);

/**
 * Trae de la Agenda lo que cambió (cambiadosDesde = último actualizadoEn procesado;
 * primera vez: desde = FACTURACION_AGENDA_DESDE), página por página, guardando
 * cada página antes de pedir la siguiente. Nunca reconstruye desde un resultado truncado.
 */
export async function sincronizarAgenda(opts: { actor?: string; api?: AgendaApi } = {}): Promise<ResultadoSync> {
  const vacio: ResultadoSync = { ok: true, leidos: 0, paginas: 0, hasta: null, reclasificados: 0 };
  if (!(await facturacionAgendaDisponible())) return { ...vacio, ok: false, error: 'Falta la migración 016_facturacion_agenda en esta base.' };
  const api = opts.api ?? apiAgenda({ actor: opts.actor ?? 'cron' });
  if (!api) return { ...vacio, omitido: 'Este deploy no tiene FACTURACION_API_KEY_AGENDA: no se toca la Agenda.' };
  const cfg = configAgenda();
  const [ctx, estado] = await Promise.all([cargarContexto(), getSyncEstado()]);
  const incremental = !!estado?.ultimoActualizadoEn;
  let hasta: string | null = estado?.ultimoActualizadoEn ?? null;
  let leidos = 0, paginas = 0;
  const base: Record<string, string | number> = incremental
    ? { cambiadosDesde: new Date(ms(hasta) - 1000).toISOString(), incluirEliminados: 'true', porPagina: cfg.porPagina }
    : { desde: cfg.desdeInicial, incluirEliminados: 'true', porPagina: cfg.porPagina };
  try {
    for (let pagina = 1; pagina <= 1000; pagina++) {
      const r = await api.listarExpedientes({ ...base, pagina });
      paginas++;
      const exps = Array.isArray(r?.expedientes) ? r.expedientes : [];
      if (!exps.length) break;
      leidos += await procesarExpedientes(exps, ctx);
      for (const e of exps) if (e.actualizadoEn && (!hasta || ms(e.actualizadoEn) > ms(hasta))) hasta = e.actualizadoEn;
      if (incremental) await guardarSyncEstado({ ultimo_actualizado_en: hasta });   // reanudable: con cambiadosDesde vienen del más viejo al más nuevo
      if (pagina >= Number(r.paginas ?? 1)) break;
    }
    const reclasificados = await reclasificar({}, ctx);
    await guardarSyncEstado({ ultimo_actualizado_en: hasta, ultima_corrida: new Date().toISOString(), ultimo_resultado: `ok · ${leidos} expediente(s) en ${paginas} página(s)${reclasificados ? ` · ${reclasificados} re-resueltos` : ''}`, expedientes_leidos: leidos, corridas: (estado?.corridas ?? 0) + 1 });
    return { ok: true, leidos, paginas, hasta, reclasificados };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await guardarSyncEstado({ ultima_corrida: new Date().toISOString(), ultimo_resultado: `error tras ${leidos} expediente(s): ${error}`.slice(0, 500), expedientes_leidos: leidos, corridas: (estado?.corridas ?? 0) + 1 });
    return { ok: false, leidos, paginas, hasta, reclasificados: 0, error };
  }
}

// ── Pantalla ────────────────────────────────────────────────────────────────

const razonPorNitDe = (clientes: readonly Customer[]): Map<string, string> => {
  const m = new Map<string, string>();
  for (const c of clientes) { const k = nitComparable(c.nit); if (k && !nitEsPlaceholder(k) && c.activo !== false && !m.has(k)) m.set(k, c.name); }
  return m;
};

/**
 * Cliente de financiero para los buscadores del mapeo. Además del nombre y el NIT lleva
 * (020) la razón social, el nombre comercial, las marcas y los nombres con los que ya
 * aparece en la Agenda: el buscador encuentra al cliente por cualquiera de ellos.
 */
export interface ClienteSlim { id: string; name: string; nit: string; razonSocial?: string; nombreComercial?: string; aliases?: string[]; nombresAgenda?: string[] }

/** NIT comparable → nombres de la Agenda ya mapeados a ese NIT (para buscar "banco cuscatlan" y dar con CUSCATLAN TCU). Las marcadas "no se factura" no cuentan. */
const nombresAgendaPorNit = (mapeos: readonly ClienteExterno[]): Map<string, string[]> => {
  const m = new Map<string, string[]>();
  for (const x of mapeos) {
    if (!x.activo || x.noFactura || !x.nit || !x.empresaNombreExterno) continue;
    const l = m.get(x.nit) ?? []; if (!l.includes(x.empresaNombreExterno)) l.push(x.empresaNombreExterno); m.set(x.nit, l);
  }
  return m;
};
const slimDe = (c: Customer, agenda?: Map<string, string[]>): ClienteSlim => {
  const s: ClienteSlim = { id: c.id, name: c.name, nit: c.nit };
  if (c.razonSocial && c.razonSocial !== c.name) s.razonSocial = c.razonSocial;
  if (c.nombreComercial) s.nombreComercial = c.nombreComercial;
  if (c.aliases?.length) s.aliases = c.aliases;
  const na = agenda?.get(nitComparable(c.nit)); if (na?.length) s.nombresAgenda = na;
  return s;
};

export type ReresolverResult = { ok: true; reclasificados: number } | { ok: false; error: string };

/** "Re-resolver precios": re-clasifica toda la cola local contra mapeo + tarifario actuales. No toca la Agenda. */
export async function reresolverPrecios(): Promise<ReresolverResult> {
  if (!supabase()) return { ok: false, error: 'Supabase no está configurado.' };
  try { return { ok: true, reclasificados: await reclasificar() }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
const DETALLES_VACIOS = (): VistaPorFacturar['detalles'] => ({ borrador: { n: 0, total: 0 }, enviada: { n: 0, total: 0 }, aprobada: { n: 0, total: 0 }, facturada: { n: 0, total: 0 }, anulada: { n: 0, total: 0 } });

export interface VistaPorFacturar {
  /** Solo clientes con expedientes en cola resueltos o sin tarifa (nunca el universo). */
  grupos: GrupoCliente[];
  kpis: KpisPorFacturar;
  sync: SyncEstado | null;
  /** Filas en el espejo (todas, solo como referencia). */
  total: number;
  sinMapear: { expedientes: number; empresas: number };
  /** 018: empresas marcadas "no se factura" con su motivo y cuántos expedientes tienen. */
  noFacturan: EmpresaNoFactura[];
  /** Clientes activos de financiero (id de app, nombre, NIT) para el selector de "Mapear todas a un cliente". */
  clientes: ClienteSlim[];
  /** 019: detalles de facturación por estado (tablero "pendientes de aprobación"). */
  detalles: Record<'borrador' | 'enviada' | 'aprobada' | 'facturada' | 'anulada', { n: number; total: number }>;
  /** true si los agregados vinieron de la RPC de la 017 (SQL); false = fallback con consultas livianas. */
  agregadoEnSql: boolean;
}

interface ConteoEstado { estado_tarifa: EstadoTarifa; total: number; en_cola: number; empresas_en_cola: number }
interface GrupoRpc { nit_resuelto: string; empresa_id_externo: string | null; empresa_nombre_externo: string | null; listos: number; total_sin_iva: number | string; sin_tarifa: number; con_megapaca: number; en_detalle?: number; fecha_mas_antigua: string | null }
interface FacturadoRpc { nit_resuelto: string | null; facturados: number; writeback_pendiente: number; con_megapaca: number }
interface NoFacturaRpc { empresa_id_externo: string; empresa_nombre_externo: string | null; motivo_no_factura: string | null; creado_por: string | null; updated_at: string | null; expedientes: number }
interface DetalleRpc { estado: string; n: number; total: number | string }
interface ResumenRpc { conteos: ConteoEstado[]; grupos: GrupoRpc[]; facturados: FacturadoRpc[]; total: number; excluidos: number; /** 018 */ excluidos_no_factura?: number; no_facturan?: NoFacturaRpc[]; /** 019 */ detalles?: DetalleRpc[] }

const rpcNoExiste = (e: { code?: string; message: string }) => e.code === 'PGRST202' || /could not find the function|function .* does not exist/i.test(e.message);
/** Filtro PostgREST de "en cola" (misma regla que enCola()). */
const COBRO_PENDIENTE_OR = 'status_cobro_externo.is.null,status_cobro_externo.in.("PENDIENTE","SIN_STATUS","")';
/** Lo mínimo que usamos de un builder de PostgREST (los métodos devuelven `this`); el tipo real es demasiado profundo para inferirlo acá. */
interface Filtrable { eq(col: string, v: unknown): this; is(col: string, v: null): this; or(filtros: string): this; in(col: string, vals: unknown[]): this; not(col: string, op: string, v: unknown): this; order(col: string): this }
type QCola = Filtrable & Consulta & PromiseLike<{ count: number | null; error: { message: string } | null }>;
const enColaSql = <T extends Filtrable>(q: T): T => q.eq('terminado', true).eq('cancelado', false).eq('eliminado', false).is('factura_id', null).or(COBRO_PENDIENTE_OR);
const vigenteSql = <T extends Filtrable>(q: T): T => q.eq('terminado', true).eq('cancelado', false).eq('eliminado', false);
const ESTADOS: EstadoTarifa[] = ['resuelta', 'sin_tarifa', 'cliente_sin_mapear', 'excluido_psicometrica', 'excluido_no_factura'];

/** Fallback sin la 017: los mismos agregados con consultas livianas (counts por HEAD + solo las filas de la cola facturable). */
async function resumenSinRpc(sb: NonNullable<ReturnType<typeof supabase>>): Promise<ResumenRpc> {
  const sel = (cols: string, head = false): QCola => (head ? sb.from('facturacion_expediente').select('id', { count: 'exact', head: true }) : sb.from('facturacion_expediente').select(cols)).eq('fuente', FUENTE) as unknown as QCola;
  const cuenta = async (arma: (q: QCola) => QCola): Promise<number> => { const { count, error } = await arma(sel('id', true)); if (error) throw new Error(error.message); return count ?? 0; };
  const conteos: ConteoEstado[] = [];
  for (const estado of ESTADOS) {
    const [total, en_cola] = await Promise.all([cuenta(q => q.eq('estado_tarifa', estado)), cuenta(q => enColaSql(q.eq('estado_tarifa', estado)))]);
    conteos.push({ estado_tarifa: estado, total, en_cola, empresas_en_cola: 0 });
  }
  const sinMapear = await paginar<{ empresa_id_externo: string | null }>(() => enColaSql(sel('empresa_id_externo').eq('estado_tarifa', 'cliente_sin_mapear')).order('id_externo'), 'sin mapear');
  const c = conteos.find(x => x.estado_tarifa === 'cliente_sin_mapear'); if (c) c.empresas_en_cola = new Set(sinMapear.map(r => r.empresa_id_externo ?? '')).size;
  const colaRows = await paginarTolerante<{ nit_resuelto: string | null; empresa_id_externo: string | null; empresa_nombre_externo: string | null; estado_tarifa: EstadoTarifa; monto_calculado: number | string | null; cobro_megapaca: number | string | null; fecha_ingreso: string | null; detalle_id?: string | null }>(() =>
    enColaSql(sel('nit_resuelto, empresa_id_externo, empresa_nombre_externo, estado_tarifa, monto_calculado, cobro_megapaca, fecha_ingreso, detalle_id').in('estado_tarifa', ['resuelta', 'sin_tarifa'])).order('id_externo'), 'cola');
  const grupos = new Map<string, GrupoRpc>();
  for (const r of colaRows) {
    if (!r.nit_resuelto) continue;
    const g = grupos.get(r.nit_resuelto) ?? { nit_resuelto: r.nit_resuelto, empresa_id_externo: r.empresa_id_externo, empresa_nombre_externo: r.empresa_nombre_externo, listos: 0, total_sin_iva: 0, sin_tarifa: 0, con_megapaca: 0, en_detalle: 0, fecha_mas_antigua: null };
    if (r.detalle_id) g.en_detalle = (g.en_detalle ?? 0) + 1;
    if (r.estado_tarifa === 'resuelta' && Number(r.monto_calculado ?? 0) > 0) { g.listos++; g.total_sin_iva = Math.round((Number(g.total_sin_iva) + Number(r.monto_calculado)) * 100) / 100; }
    if (r.estado_tarifa === 'sin_tarifa') g.sin_tarifa++;
    if (Number(r.cobro_megapaca ?? 0) > 0) g.con_megapaca++;
    if (r.fecha_ingreso && (!g.fecha_mas_antigua || r.fecha_ingreso < g.fecha_mas_antigua)) g.fecha_mas_antigua = r.fecha_ingreso;
    grupos.set(r.nit_resuelto, g);
  }
  const factRows = await paginar<{ nit_resuelto: string | null; writeback_estado: string | null; cobro_megapaca: number | string | null }>(() => vigenteSql(sel('nit_resuelto, writeback_estado, cobro_megapaca').not('factura_id', 'is', null)).order('id_externo'), 'facturados');
  const fact = new Map<string, FacturadoRpc>();
  for (const r of factRows) {
    const k = r.nit_resuelto ?? '';
    const f = fact.get(k) ?? { nit_resuelto: r.nit_resuelto, facturados: 0, writeback_pendiente: 0, con_megapaca: 0 };
    f.facturados++; if (!r.writeback_estado || !['confirmado', 'omitido'].includes(r.writeback_estado)) f.writeback_pendiente++; if (Number(r.cobro_megapaca ?? 0) > 0) f.con_megapaca++;
    fact.set(k, f);
  }
  const [total, excluidos, excluidosNoFactura] = await Promise.all([cuenta(q => q), cuenta(q => vigenteSql(q.eq('estado_tarifa', 'excluido_psicometrica'))), cuenta(q => vigenteSql(q.eq('estado_tarifa', 'excluido_no_factura')))]);
  const noFacturan: NoFacturaRpc[] = [];
  for (const m of (await getMapeos()).filter(m => m.activo && m.noFactura)) {
    noFacturan.push({ empresa_id_externo: m.empresaIdExterno, empresa_nombre_externo: m.empresaNombreExterno, motivo_no_factura: m.motivoNoFactura, creado_por: m.creadoPor, updated_at: null, expedientes: await cuenta(q => vigenteSql(q.eq('estado_tarifa', 'excluido_no_factura').eq('empresa_id_externo', m.empresaIdExterno))) });
  }
  noFacturan.sort((a, b) => b.expedientes - a.expedientes || (a.empresa_nombre_externo ?? '').localeCompare(b.empresa_nombre_externo ?? '', 'es'));
  const detalles: DetalleRpc[] = [];
  try {
    const { data } = await sb.from('detalle_facturacion').select('estado, total').eq('fuente', FUENTE).limit(5000);
    for (const d of (data ?? []) as { estado: string; total: number | string }[]) { const x = detalles.find(y => y.estado === d.estado) ?? (detalles.push({ estado: d.estado, n: 0, total: 0 }), detalles[detalles.length - 1]); x.n++; x.total = Math.round((Number(x.total) + Number(d.total)) * 100) / 100; }
  } catch { /* sin la 019 */ }
  return { conteos, grupos: [...grupos.values()], facturados: [...fact.values()], total, excluidos, excluidos_no_factura: excluidosNoFactura, no_facturan: noFacturan, detalles };
}

/**
 * Lista "Por facturar" SIN cargar el espejo: agregados por SQL (RPC de la 017) o, si
 * falta, consultas livianas. Solo entran a la pantalla los clientes con expedientes en
 * cola resueltos / sin tarifa; sin mapear y psicométricas se CUENTAN, no se cargan.
 */
export async function vistaPorFacturar(opts: { sinRpc?: boolean } = {}): Promise<VistaPorFacturar> {
  const sb = supabase();
  const vacio: VistaPorFacturar = { grupos: [], kpis: kpisPorFacturar([]), sync: null, total: 0, sinMapear: { expedientes: 0, empresas: 0 }, noFacturan: [], clientes: [], detalles: DETALLES_VACIOS(), agregadoEnSql: false };
  if (!sb) return vacio;
  const [clientes, sync, mapeos] = await Promise.all([getClientes(), getSyncEstado(), getMapeos().catch(() => [] as ClienteExterno[])]);
  let r: ResumenRpc | null = null; let enSql = false;
  if (!opts.sinRpc) {
    const { data, error } = await sb.rpc('facturacion_agenda_resumen', { p_fuente: FUENTE });
    if (!error && data) { r = data as ResumenRpc; enSql = true; }
    else if (error && !rpcNoExiste(error)) console.error('facturacion_agenda_resumen:', error.message);
  }
  if (!r) r = await resumenSinRpc(sb);
  const razon = razonPorNitDe(clientes);
  const porNit = new Map<string, GrupoCliente>();
  const base = (nit: string | null, emp: string | null, nombreExt: string | null): GrupoCliente => ({
    clave: nit ? `n-${nit}` : `e-${emp ?? ''}`, nit, empresaIdExterno: emp ?? '', nombre: (nit && razon.get(nit)) || nombreExt || emp || '—', nombreExterno: nombreExt ?? '',
    expedientes: 0, listos: 0, totalSinIva: 0, totalConIva: 0, sinTarifa: 0, sinMapear: 0, facturados: 0, writebackPendiente: 0, conMegapaca: 0, enDetalle: 0, fechaIngresoMasAntigua: null,
  });
  for (const g of r.grupos) {
    const x = porNit.get(g.nit_resuelto) ?? base(g.nit_resuelto, g.empresa_id_externo, g.empresa_nombre_externo);
    x.listos += Number(g.listos); x.totalSinIva = Math.round((x.totalSinIva + Number(g.total_sin_iva)) * 100) / 100; x.sinTarifa += Number(g.sin_tarifa); x.conMegapaca += Number(g.con_megapaca); x.enDetalle += Number(g.en_detalle ?? 0);
    x.expedientes += Number(g.listos) + Number(g.sin_tarifa);
    if (g.fecha_mas_antigua && (!x.fechaIngresoMasAntigua || g.fecha_mas_antigua < x.fechaIngresoMasAntigua)) x.fechaIngresoMasAntigua = g.fecha_mas_antigua;
    porNit.set(g.nit_resuelto, x);
  }
  for (const f of r.facturados) {
    const x = porNit.get(f.nit_resuelto ?? '');   // solo suma a clientes que ya están en la lista: la lista es "por facturar"
    if (!x) continue;
    x.facturados += Number(f.facturados); x.writebackPendiente += Number(f.writeback_pendiente); x.expedientes += Number(f.facturados);
  }
  const grupos = [...porNit.values()].map(g => ({ ...g, totalConIva: conIva(g.totalSinIva).total }));
  const peso = (g: GrupoCliente) => (g.sinTarifa ? 0 : g.listos ? 1 : 2);
  grupos.sort((a, b) => peso(a) - peso(b) || b.totalSinIva - a.totalSinIva || a.nombre.localeCompare(b.nombre, 'es'));
  const c = (e: EstadoTarifa) => r!.conteos.find(x => x.estado_tarifa === e);
  const listos = grupos.reduce((s, g) => s + g.listos, 0);
  const totalSinIva = Math.round(grupos.reduce((s, g) => s + g.totalSinIva, 0) * 100) / 100;
  const kpis: KpisPorFacturar = {
    listos, totalSinIva, totalConIva: conIva(totalSinIva).total,
    sinTarifa: Number(c('sin_tarifa')?.en_cola ?? 0),
    sinMapear: Number(c('cliente_sin_mapear')?.en_cola ?? 0),
    excluidos: Number(r.excluidos ?? 0),
    excluidosNoFactura: Number(r.excluidos_no_factura ?? 0),
    facturados: r.facturados.reduce((s, f) => s + Number(f.facturados), 0),
    writebackPendiente: r.facturados.reduce((s, f) => s + Number(f.writeback_pendiente), 0),
    clientes: grupos.length,
    clientesSinMapear: Number(c('cliente_sin_mapear')?.empresas_en_cola ?? 0),
  };
  const noFacturan: EmpresaNoFactura[] = (r.no_facturan ?? []).map(n => ({ empresaIdExterno: n.empresa_id_externo, empresaNombreExterno: n.empresa_nombre_externo ?? '', motivo: n.motivo_no_factura ?? '', expedientes: Number(n.expedientes ?? 0), marcadoPor: n.creado_por ?? '', marcadoEn: n.updated_at ?? null }));
  const agenda = nombresAgendaPorNit(mapeos);
  const clientesSlim: ClienteSlim[] = clientes.filter(c => c.activo !== false).map(c => slimDe(c, agenda));
  const detalles = DETALLES_VACIOS();
  for (const d of r.detalles ?? []) { const k = d.estado as keyof typeof detalles; if (detalles[k]) detalles[k] = { n: Number(d.n), total: Number(d.total) }; }
  return { grupos, kpis, sync, total: Number(r.total ?? 0), sinMapear: { expedientes: kpis.sinMapear, empresas: kpis.clientesSinMapear }, noFacturan, clientes: clientesSlim, detalles, agregadoEnSql: enSql };
}

export interface EmpresaSinMapear { empresaIdExterno: string; empresaNombreExterno: string; expedientes: number; fechaMasAntigua: string | null; fechaMasReciente: string | null }
export interface PaginaSinMapear { filas: EmpresaSinMapear[]; totalEmpresas: number; totalExpedientes: number; limite: number; desde: number; agregadoEnSql: boolean }

/** Empresas de la Agenda sin mapear (en cola), agregadas por empresa, con búsqueda y paginación. On demand. */
export async function empresasSinMapear(opts: { q?: string; limite?: number; desde?: number; sinRpc?: boolean } = {}): Promise<PaginaSinMapear> {
  const sb = supabase();
  const limite = Math.min(Math.max(Number(opts.limite ?? 25), 1), 1000), desde = Math.max(Number(opts.desde ?? 0), 0);
  const q = String(opts.q ?? '').trim().slice(0, 80).replace(/[%_\\]/g, m => `\\${m}`);
  const vacio: PaginaSinMapear = { filas: [], totalEmpresas: 0, totalExpedientes: 0, limite, desde, agregadoEnSql: false };
  if (!sb) return vacio;
  if (!opts.sinRpc) {
    const { data, error } = await sb.rpc('facturacion_agenda_sin_mapear', { p_fuente: FUENTE, p_q: q, p_limit: limite, p_offset: desde });
    if (!error && data) {
      const d = data as { total_empresas: number; total_expedientes: number; filas: { empresa_id_externo: string; empresa_nombre_externo: string | null; expedientes: number; fecha_mas_antigua: string | null; fecha_mas_reciente: string | null }[] };
      return { filas: (d.filas ?? []).map(f => ({ empresaIdExterno: f.empresa_id_externo, empresaNombreExterno: f.empresa_nombre_externo ?? '', expedientes: Number(f.expedientes), fechaMasAntigua: f.fecha_mas_antigua, fechaMasReciente: f.fecha_mas_reciente })), totalEmpresas: Number(d.total_empresas ?? 0), totalExpedientes: Number(d.total_expedientes ?? 0), limite, desde, agregadoEnSql: true };
    }
    if (error && !rpcNoExiste(error)) console.error('facturacion_agenda_sin_mapear:', error.message);
  }
  // Fallback sin la 017: solo 3 columnas de las filas sin mapear en cola, agregadas en memoria.
  const rows = await paginar<{ empresa_id_externo: string | null; empresa_nombre_externo: string | null; fecha_ingreso: string | null }>(() =>
    enColaSql((sb.from('facturacion_expediente').select('empresa_id_externo, empresa_nombre_externo, fecha_ingreso').eq('fuente', FUENTE) as unknown as QCola).eq('estado_tarifa', 'cliente_sin_mapear')).order('id_externo'), 'sin mapear');
  const emp = new Map<string, EmpresaSinMapear>();
  for (const r of rows) {
    const k = r.empresa_id_externo ?? '';
    const e = emp.get(k) ?? { empresaIdExterno: k, empresaNombreExterno: r.empresa_nombre_externo ?? '', expedientes: 0, fechaMasAntigua: null, fechaMasReciente: null };
    e.expedientes++; if (!e.empresaNombreExterno && r.empresa_nombre_externo) e.empresaNombreExterno = r.empresa_nombre_externo;
    if (r.fecha_ingreso) { if (!e.fechaMasAntigua || r.fecha_ingreso < e.fechaMasAntigua) e.fechaMasAntigua = r.fecha_ingreso; if (!e.fechaMasReciente || r.fecha_ingreso > e.fechaMasReciente) e.fechaMasReciente = r.fecha_ingreso; }
    emp.set(k, e);
  }
  const qn = normalizarTexto(opts.q ?? '');
  const filt = [...emp.values()].filter(e => !qn || normalizarTexto(e.empresaNombreExterno).includes(qn) || normalizarTexto(e.empresaIdExterno).includes(qn)).sort((a, b) => b.expedientes - a.expedientes || a.empresaNombreExterno.localeCompare(b.empresaNombreExterno, 'es'));
  return { filas: filt.slice(desde, desde + limite), totalEmpresas: filt.length, totalExpedientes: filt.reduce((s, e) => s + e.expedientes, 0), limite, desde, agregadoEnSql: false };
}

export interface GrupoDetalle {
  clave: string; nit: string | null; empresaIdExterno: string; nombre: string; nombreExterno: string;
  grupo: GrupoCliente | null; expedientes: ExpedienteLocal[]; cliente: ClienteSlim | null; sugerencias: ClienteSlim[]; clientes: ClienteSlim[]; centros: CentroCosto[];
  /** 018: la empresa está marcada "no se factura" (motivo y quién). */
  noFactura: { motivo: string; marcadoPor: string } | null;
}

export async function getGrupo(clave: string): Promise<GrupoDetalle | null> {
  const p = parseClave(clave); if (!p) return null;
  const exps = await listarExpedientesLocal(p.tipo === 'nit' ? { nit: p.nit } : { empresaIdExterno: p.empresaId });
  if (!exps.length) return null;
  const [clientes, centros, mapeos] = await Promise.all([getClientes(), getCentrosCostoActivos(), getMapeos()]);
  const marca = mapeos.find(m => m.activo && m.noFactura && m.empresaIdExterno === exps[0].empresaIdExterno);
  const agenda = nombresAgendaPorNit(mapeos);
  const slim = (c: Customer): ClienteSlim => slimDe(c, agenda);
  const activos = clientes.filter(c => c.activo !== false);
  const razon = razonPorNitDe(clientes);
  const grupo = agruparPorCliente(exps, razon)[0] ?? null;
  const nombreExterno = exps.find(e => e.empresaNombreExterno)?.empresaNombreExterno ?? '';
  let cliente: ClienteSlim | null = null; let sugerencias: ClienteSlim[] = [];
  if (p.tipo === 'nit') {
    const c = activos.find(x => nitComparable(x.nit) === p.nit) ?? clientes.find(x => nitComparable(x.nit) === p.nit);
    cliente = c ? slim(c) : null;
  } else if (nombreExterno) {
    // Sugerencias para mapear: el alias del tarifario/catálogo (motor existente) + "contiene" sin tildes sobre TODOS los
    // nombres del cliente (nombre, razón social, nombre comercial, marcas —020— y nombres de la Agenda ya mapeados).
    // Así la Agenda "CALZADO CHICOTE" sugiere "Distribuidora Suprema" si esa marca está en sus aliases. Exacto primero.
    const tarifas = await getTarifario().catch(() => []);
    const slims = activos.map(slim);
    const nitSug = resolverNit({ empresa: nombreExterno }, indiceAlias(tarifas, slims.flatMap(s => nombresDe(s).map(nombre => ({ nombre, nit: s.nit })))));
    const base = nombreBase(nombreExterno);
    const puntuadas: Array<{ s: ClienteSlim; p: number }> = [];
    for (const s of slims) {
      const nombres = nombresDe(s).map(nombreBase).filter(Boolean);
      const porNit = !!nitSug && nitComparable(s.nit) === nitSug;
      const exacto = !!base && nombres.some(nb => nb === base);
      const contiene = !!base && nombres.some(nb => nb.includes(base) || (nb.length >= 4 && base.includes(nb)));
      const p = exacto ? 3 : porNit ? 2 : contiene ? 1 : 0;
      if (p) puntuadas.push({ s, p });
    }
    sugerencias = puntuadas.sort((a, b) => b.p - a.p || a.s.name.localeCompare(b.s.name, 'es')).slice(0, 8).map(x => x.s);
  }
  return {
    clave, nit: p.tipo === 'nit' ? p.nit : null, empresaIdExterno: exps[0].empresaIdExterno, nombre: grupo?.nombre ?? cliente?.name ?? nombreExterno, nombreExterno,
    grupo, expedientes: exps, cliente, sugerencias, clientes: activos.map(slim), centros,
    noFactura: marca ? { motivo: marca.motivoNoFactura, marcadoPor: marca.creadoPor } : null,
  };
}

// ── Emitir la factura ───────────────────────────────────────────────────────

export interface EmitirInput { idsExternos: string[]; noFactura: string; fechaEmision: string; /** tipo de prueba canónico → centro de costo (id de app) elegido en el diálogo */ centroPorTipo?: Record<string, string>; /** 019: detalle APROBADO por el cliente del que salen exactamente estos expedientes (obligatorio). */ detalleId?: string }
export interface WritebackResultado { estado: WritebackEstado; detalle: string }
export type EmitirResult =
  | { ok: true; noFactura: string; facturaAppId: string; expedientes: number; lineas: number; subtotal: number; iva: number; total: number; writeback: WritebackResultado }
  | { ok: false; error: string };

export async function emitirFacturaAgenda(input: EmitirInput, actor: string, opts: { api?: AgendaApi } = {}): Promise<EmitirResult> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
  const nf = String(input.noFactura ?? '').trim();
  if (!nf) return { ok: false, error: 'El número de factura (SAT/FEL) es requerido.' };
  if (nf.length > 60) return { ok: false, error: 'El número de factura no puede pasar de 60 caracteres.' };
  const fecha = String(input.fechaEmision ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) return { ok: false, error: 'La fecha de la factura debe ser AAAA-MM-DD.' };
  if (fecha > obtenerFechaHoyGuatemala()) return { ok: false, error: 'La fecha de la factura no puede ser futura.' };
  const ids = [...new Set((input.idsExternos ?? []).map(s => String(s).trim()).filter(Boolean))];
  if (!ids.length) return { ok: false, error: 'Elegí al menos un expediente.' };
  if (ids.length > 200) return { ok: false, error: 'Una factura cubre hasta 200 expedientes (límite de la Agenda).' };

  const exps = await listarExpedientesLocal({ idsExternos: ids });
  if (exps.length !== ids.length) return { ok: false, error: 'Algún expediente ya no está en la cola: recargá la pantalla.' };
  // 019: todo lo de la Agenda se factura desde un DETALLE aprobado por el cliente, y con exactamente sus expedientes.
  if (!input.detalleId) return { ok: false, error: 'Los expedientes de la Agenda se facturan desde un detalle de facturación aprobado por el cliente.' };
  const { data: det, error: errDet } = await sb!.from('detalle_facturacion').select('id, estado, correlativo').eq('id', input.detalleId).maybeSingle();
  const detalle = det as { id: string; estado: string; correlativo: string } | null;
  if (errDet || !detalle) return { ok: false, error: 'El detalle de facturación no existe.' };
  if (detalle.estado !== 'aprobada') return { ok: false, error: `El detalle ${detalle.correlativo} está en "${detalle.estado}": solo se factura un detalle aprobado por el cliente.` };
  const enDetalle = await listarExpedientesLocal({ detalleId: detalle.id });
  const setDet = new Set(enDetalle.map(e => e.idExterno));
  if (enDetalle.length !== ids.length || !ids.every(id => setDet.has(id))) return { ok: false, error: `La factura debe cubrir exactamente los ${enDetalle.length} expedientes del detalle ${detalle.correlativo}.` };
  for (const e of exps) {
    if (!conPrecio(e)) return { ok: false, error: `${e.persona || e.idExterno}: ${e.facturaId ? `ya está en la factura ${e.noFactura}` : ETIQUETA_ESTADO_TARIFA[e.estadoTarifa] + (e.estadoTarifa === 'resuelta' ? ' (sin monto o con cobro ya resuelto en la Agenda)' : '')}. Solo se facturan expedientes resueltos y en cola.` };
  }
  const nits = new Set(exps.map(e => e.nitResuelto));
  if (nits.size !== 1 || !exps[0].nitResuelto) return { ok: false, error: 'Una factura es de UN cliente: los expedientes elegidos pertenecen a clientes distintos.' };
  const nit = exps[0].nitResuelto;

  // Cliente de financiero: el del mapeo (uuid) o el activo con ese NIT.
  const mapeo = (await getMapeos()).find(m => m.activo && m.empresaIdExterno === exps[0].empresaIdExterno);
  let clienteUuid = mapeo?.clienteId ?? null;
  if (!clienteUuid) {
    const c = (await getClientes()).find(x => x.activo !== false && nitComparable(x.nit) === nit);
    if (!c) return { ok: false, error: `El NIT ${nit} no tiene un cliente activo en financiero.` };
    clienteUuid = await uuidRequerido('clientes', c.id, 'emitirFacturaAgenda (cliente)');
  }

  const centros = await getCentrosCostoActivos();
  const centroDe = (tipo: string) => input.centroPorTipo?.[tipo] || centroPorServicio(tipo, centros);
  const f = armarFactura(exps, centroDe);
  if (f.sinCentro.length) return { ok: false, error: `Elegí el centro de costo para: ${f.sinCentro.join(', ')}.` };
  const ccUuid = new Map<string, string>();
  for (const id of new Set(f.detalle.map(d => d.centroCostoId))) {
    if (!centros.some(c => c.id === id)) return { ok: false, error: 'El centro de costo elegido no está activo.' };
    ccUuid.set(id, await uuidRequerido('centros_costo', id, 'emitirFacturaAgenda (CC)'));
  }
  const cfg = configAgenda();
  const wbInicial: WritebackEstado = cfg.writeback && cfg.apiKey ? 'pendiente' : 'omitido';
  let r: { factura_id: string; factura_app_id: string; no_factura: string; lineas: number; expedientes: number };
  try {
    r = await rpc('facturacion_agenda_emitir', {
      p_actor: actor,
      p_factura: { no_factura: nf, cliente_id: clienteUuid, fecha_emision: fecha, writeback_estado: wbInicial },
      p_lineas: f.lineas.map(l => ({ airtable_id: nuevoIdEscritura(), centro_costo_id: ccUuid.get(l.centroCostoId), subtotal: l.subtotal, iva: l.iva, total: l.total })),
      p_detalle: f.detalle.map(d => ({ id_externo: d.idExterno, tipo_prueba: d.tipoPrueba, categoria: d.categoria, territorio: d.territorio, monto: d.monto, centro_costo_id: ccUuid.get(d.centroCostoId) })),
    }, ['facturas_clientes']);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/FACTURA_DUPLICADA/.test(m)) return { ok: false, error: `La factura ${nf} ya existe. No se creó para evitar un duplicado.` };
    if (/EXPEDIENTE_NO_FACTURABLE|EXPEDIENTE_DESCONOCIDO/.test(m)) return { ok: false, error: 'Algún expediente cambió mientras facturabas (ya tiene factura o dejó de estar resuelto). Recargá y volvé a elegir.' };
    return { ok: false, error: m };
  }
  const writeback: WritebackResultado = wbInicial === 'omitido'
    ? { estado: 'omitido', detalle: cfg.apiKey ? 'FACTURAR_WRITEBACK está apagado: la factura quedó en financiero y NO se escribió a la Agenda.' : 'Este deploy no tiene llave de la Agenda: la factura quedó solo en financiero.' }
    : await escribirFacturaEnAgenda(nf, actor, { api: opts.api });
  return { ok: true, noFactura: r.no_factura, facturaAppId: r.factura_app_id, expedientes: r.expedientes, lineas: r.lineas, subtotal: f.subtotal, iva: f.iva, total: f.total, writeback };
}

// ── Write-back a la Agenda ──────────────────────────────────────────────────

async function marcarWriteback(idsExternos: string[], estado: WritebackEstado, detalle: string, devueltos: readonly ExpedienteAgenda[] = [], extra: Record<string, unknown> = {}): Promise<void> {
  const sb = supabase(); if (!sb || !idsExternos.length) return;
  const ahora = new Date().toISOString();
  const porId = new Map(devueltos.filter(d => d?.id).map(d => [d.id, d]));
  const base = { writeback_estado: estado, writeback_detalle: detalle.slice(0, 500), writeback_en: ahora, updated_at: ahora, ...extra };
  const sinEspejo = idsExternos.filter(id => !porId.has(id));
  if (sinEspejo.length) { const { error } = await sb.from('facturacion_expediente').update(base).eq('fuente', FUENTE).in('id_externo', sinEspejo); if (error) console.error('marcarWriteback:', error.message); }
  for (const id of idsExternos.filter(id => porId.has(id))) {
    const d = porId.get(id)!; const cobro = d.cobro ?? {};
    const { error } = await sb.from('facturacion_expediente').update({
      ...base, status_cobro_externo: cobro.statusCobro ?? null, estatus_pago_externo: cobro.estatusPago ?? null, monto_externo: cobro.monto ?? null,
      numero_factura_externo: cobro.numeroFactura ?? null, fecha_factura_externo: cobro.fechaFactura ?? null, cobro_megapaca: cobro.cobroMegapaca ?? null,
      actualizado_en_externo: d.actualizadoEn ?? null, raw: d,
    }).eq('fuente', FUENTE).eq('id_externo', id);
    if (error) console.error('marcarWriteback:', error.message);
  }
}

/** Vuelve a leer expedientes de la Agenda y refresca el espejo (sin tocar factura ni write-back). */
async function releer(ids: readonly string[], api: AgendaApi, ctx?: Contexto): Promise<Map<string, ExpedienteAgenda | 'no_existe'>> {
  const c = ctx ?? await cargarContexto();
  const out = new Map<string, ExpedienteAgenda | 'no_existe'>();
  for (const id of ids) {
    try { const e = await api.leerExpediente(id); if (e?.id) { await procesarExpedientes([e], c); out.set(id, e); } }
    catch (err) { if (err instanceof AgendaApiError && err.status === 404) out.set(id, 'no_existe'); else throw err; }
  }
  return out;
}

/**
 * POST /facturas con los expedientes de la factura que todavía no están confirmados
 * en la Agenda (todo o nada del lado de ellos). Maneja 409 (no reintenta: re-lee y
 * deja 'conflicto'), 404 (saca el expediente de la cola), 500 (registra hasta dónde
 * llegó), 503/429 agotados y red (quedan 'pendiente' para reintentar).
 */
export async function escribirFacturaEnAgenda(noFactura: string, actor: string, opts: { api?: AgendaApi; soloIds?: string[] } = {}): Promise<WritebackResultado> {
  const api = opts.api ?? apiAgenda({ actor });
  const rows = (await listarExpedientesLocal({ noFactura })).filter(r => !r.eliminado && r.writebackEstado && ['pendiente', 'conflicto', 'error'].includes(r.writebackEstado) && (!opts.soloIds || opts.soloIds.includes(r.idExterno)));
  if (!rows.length) return { estado: 'confirmado', detalle: 'No hay expedientes pendientes de enviar a la Agenda.' };
  const ids = rows.map(r => r.idExterno);
  if (!api) { await marcarWriteback(ids, 'omitido', 'Sin llave de la Agenda en este deploy.'); return { estado: 'omitido', detalle: ETIQUETA_WRITEBACK.omitido }; }
  const sb = supabase()!;
  const { data: fac } = await sb.from('facturas_clientes').select('fecha_emision').eq('no_factura', noFactura).limit(1).maybeSingle();
  const fechaFactura = String((fac as { fecha_emision?: string } | null)?.fecha_emision ?? obtenerFechaHoyGuatemala());
  const cfg = configAgenda();
  const body = { numeroFactura: noFactura, fechaFactura, statusCobro: 'FACTURADO', expedientes: rows.map(r => ({ id: r.idExterno, monto: montoParaAgenda(r.montoCalculado ?? 0, cfg.montoModo), ...(siActualizadoEnDe(r) ? { siActualizadoEn: siActualizadoEnDe(r) } : {}) })) };
  try {
    const r = await api.crearFactura(body);
    const devueltos = Array.isArray(r.body?.expedientes) ? r.body.expedientes : [];
    await marcarWriteback(ids, 'confirmado', `Confirmado en Agenda (${r.status}) · ${ids.length} expediente(s) FACTURADO`, devueltos,
      devueltos.length ? {} : { status_cobro_externo: 'FACTURADO', numero_factura_externo: noFactura, fecha_factura_externo: fechaFactura });
    return { estado: 'confirmado', detalle: `${ids.length} expediente(s) marcados FACTURADO en la Agenda con la factura ${noFactura}.` };
  } catch (e) {
    if (!(e instanceof AgendaApiError)) throw e;
    const det = resumirCuerpo(e.body);
    if (e.status === 409) {
      await marcarWriteback(ids, 'conflicto', `409 · ${det}`);
      await releer(ids, api).catch(() => null);
      return { estado: 'conflicto', detalle: 'La Agenda rechazó la factura porque algún expediente cambió desde que se leyó (409). Se volvieron a leer: revisá el estado actual y reintentá el envío. No se reintenta solo.' };
    }
    if (e.status === 404) {
      const texto = JSON.stringify(e.body ?? '');
      const faltan = ids.filter(id => texto.includes(id));
      if (faltan.length) await marcarWriteback(faltan, 'error', `404 · el expediente ya no existe en la Agenda`, [], { eliminado: true });
      const resto = ids.filter(id => !faltan.includes(id));
      if (resto.length) await marcarWriteback(resto, 'pendiente', `404 en otro expediente de la misma factura · ${det}`);
      return { estado: 'error', detalle: `La Agenda ya no tiene ${faltan.length ? faltan.length + ' expediente(s)' : 'alguno de los expedientes'} (404): se sacaron de la cola. Los demás quedan pendientes de reintentar.` };
    }
    if (e.status === 500) {
      const hechos = idsDe((e.body as { actualizados?: unknown } | null)?.actualizados).filter(id => ids.includes(id));
      if (hechos.length) await marcarWriteback(hechos, 'confirmado', `Confirmado (la Agenda lo registró antes de fallar) · ${det}`, [], { status_cobro_externo: 'FACTURADO', numero_factura_externo: noFactura, fecha_factura_externo: fechaFactura });
      const resto = ids.filter(id => !hechos.includes(id));
      if (resto.length) await marcarWriteback(resto, 'pendiente', `500 · ${det}`);
      return { estado: resto.length ? 'pendiente' : 'confirmado', detalle: `La Agenda falló a medias (500): ${hechos.length} confirmado(s), ${resto.length} pendiente(s). Reintentá el envío: no se re-facturan los ya hechos.` };
    }
    const estado: WritebackEstado = e.status === 400 || e.status === 401 ? 'error' : 'pendiente';
    await marcarWriteback(ids, estado, `${e.status || 'red'} · ${det}`);
    return { estado, detalle: estado === 'error' ? `La Agenda rechazó el pedido (${e.status}): ${det}` : `La Agenda no respondió (${e.status || 'red'}). La factura quedó en financiero; reintentá el envío más tarde.` };
  }
}

/**
 * Reintento del write-back de una factura: re-lee cada expediente pendiente, da por
 * confirmado lo que la Agenda ya tenga facturado con este número, marca conflicto si
 * lo tiene con OTRO número, saca lo que ya no existe y vuelve a postear el resto.
 */
export async function reintentarWriteback(noFactura: string, actor: string, opts: { api?: AgendaApi } = {}): Promise<WritebackResultado & { confirmadosPrevios: number; conflictos: number; enviados: number }> {
  const api = opts.api ?? apiAgenda({ actor });
  const base = { confirmadosPrevios: 0, conflictos: 0, enviados: 0 };
  if (!api) return { ...base, estado: 'omitido', detalle: 'Este deploy no tiene llave de la Agenda.' };
  const rows = (await listarExpedientesLocal({ noFactura })).filter(r => !r.eliminado && r.writebackEstado && ['pendiente', 'conflicto', 'error', 'omitido'].includes(r.writebackEstado));
  if (!rows.length) return { ...base, estado: 'confirmado', detalle: 'Todos los expedientes de esta factura ya están confirmados en la Agenda.' };
  const ctx = await cargarContexto();
  const leidos = await releer(rows.map(r => r.idExterno), api, ctx);
  const aEnviar: string[] = [];
  for (const r of rows) {
    const e = leidos.get(r.idExterno);
    if (e === 'no_existe') { await marcarWriteback([r.idExterno], 'error', '404 · el expediente ya no existe en la Agenda', [], { eliminado: true }); continue; }
    if (!e) { aEnviar.push(r.idExterno); continue; }
    const numAgenda = String(e.cobro?.numeroFactura ?? '').trim();
    if (numAgenda && numAgenda.toUpperCase() === noFactura.toUpperCase()) { base.confirmadosPrevios++; await marcarWriteback([r.idExterno], 'confirmado', 'La Agenda ya tenía este expediente facturado con este número.', [e]); continue; }
    if (numAgenda) { base.conflictos++; await marcarWriteback([r.idExterno], 'conflicto', `La Agenda tiene este expediente facturado con OTRO número: ${numAgenda}. Resolvé a mano.`, [e]); continue; }
    aEnviar.push(r.idExterno);
  }
  if (!aEnviar.length) return { ...base, estado: base.conflictos ? 'conflicto' : 'confirmado', detalle: base.conflictos ? `${base.conflictos} expediente(s) facturado(s) en la Agenda con otro número: hay que resolverlo a mano.` : 'Todo confirmado.' };
  // Los que vamos a enviar quedan 'pendiente' con el actualizadoEn fresco que acabamos de leer.
  await marcarWriteback(aEnviar, 'pendiente', 'Reintento: expediente re-leído, listo para enviar.');
  const r = await escribirFacturaEnAgenda(noFactura, actor, { api, soloIds: aEnviar });
  return { ...base, enviados: r.estado === 'confirmado' ? aEnviar.length : 0, ...r };
}

/**
 * Cobro de vuelta (brief §8): cuando financiero cobra por completo una factura con
 * expedientes de la Agenda, empuja PAGADO con POST /lote (siActualizadoEn). Lo que
 * cambia la propia API no se avisa de vuelta → no hay loop. Nunca lanza.
 */
export async function notificarCobroAgenda(noFactura: string, actor: string, opts: { api?: AgendaApi } = {}): Promise<{ enviados: number; estado: 'omitido' | 'nada' | 'confirmado' | 'conflicto' | 'error'; detalle: string }> {
  try {
    const cfg = configAgenda();
    if (!cfg.writeback) return { enviados: 0, estado: 'omitido', detalle: 'FACTURAR_WRITEBACK apagado.' };
    const api = opts.api ?? apiAgenda({ actor });
    if (!api) return { enviados: 0, estado: 'omitido', detalle: 'Sin llave.' };
    const rows = (await listarExpedientesLocal({ noFactura })).filter(r => !r.eliminado && r.writebackEstado === 'confirmado' && r.cobroWritebackEstado !== 'confirmado');
    if (!rows.length) return { enviados: 0, estado: 'nada', detalle: 'La factura no tiene expedientes de la Agenda pendientes de marcar PAGADO.' };
    const sb = supabase()!; const ahora = new Date().toISOString();
    const ids = rows.map(r => r.idExterno);
    try {
      const r = await api.lote(rows.map(x => ({ id: x.idExterno, statusCobro: 'PAGADO', estatusPago: 'PAGADO', ...(siActualizadoEnDe(x) ? { siActualizadoEn: siActualizadoEnDe(x) } : {}) })));
      const devueltos = Array.isArray(r.body?.expedientes) ? r.body.expedientes : [];
      const porId = new Map(devueltos.map(d => [d.id, d]));
      for (const id of ids) {
        const d = porId.get(id); const cobro = d?.cobro ?? { statusCobro: 'PAGADO', estatusPago: 'PAGADO' };
        await sb.from('facturacion_expediente').update({ cobro_writeback_estado: 'confirmado', cobro_writeback_detalle: `PAGADO en Agenda (${r.status})`, cobro_writeback_en: ahora, status_cobro_externo: cobro.statusCobro ?? 'PAGADO', estatus_pago_externo: cobro.estatusPago ?? 'PAGADO', ...(d ? { actualizado_en_externo: d.actualizadoEn ?? null, raw: d } : {}), updated_at: ahora }).eq('fuente', FUENTE).eq('id_externo', id);
      }
      return { enviados: ids.length, estado: 'confirmado', detalle: `${ids.length} expediente(s) marcados PAGADO en la Agenda.` };
    } catch (e) {
      const esApi = e instanceof AgendaApiError;
      const estado = esApi && e.status === 409 ? 'conflicto' : 'error';
      const det = esApi ? `${e.status || 'red'} · ${resumirCuerpo(e.body)}` : (e instanceof Error ? e.message : String(e));
      await sb.from('facturacion_expediente').update({ cobro_writeback_estado: estado, cobro_writeback_detalle: det.slice(0, 500), cobro_writeback_en: ahora, updated_at: ahora }).eq('fuente', FUENTE).in('id_externo', ids);
      if (estado === 'conflicto' && esApi) await releer(ids, e.status === 409 ? (opts.api ?? apiAgenda({ actor }))! : api).catch(() => null);
      return { enviados: 0, estado, detalle: estado === 'conflicto' ? 'La Agenda cambió el expediente antes del cobro (409): se volvió a leer; el PAGADO queda pendiente de revisar.' : `No se pudo marcar PAGADO en la Agenda: ${det}` };
    }
  } catch (e) {
    return { enviados: 0, estado: 'error', detalle: e instanceof Error ? e.message : String(e) };
  }
}

// ── Detalle de factura ──────────────────────────────────────────────────────

interface DetRow { id: string; no_factura: string; id_externo: string; tipo_prueba: string | null; categoria: string | null; territorio: string | null; monto: number | string; centro_costo_id: string | null; persona: string | null }

export interface ProcesosDeFactura { detalle: DetalleFacturaExpediente[]; expedientes: ExpedienteLocal[]; subtotal: number; writeback: { confirmados: number; pendientes: number; conflictos: number; errores: number; omitidos: number }; /** 019: el detalle de facturación (pre-liquidación) del que salió, para "Imprimir detalle". */ detalleFacturacion: { id: string; correlativo: string; aprobadoPor: string; aprobadaEn: string | null } | null }

/** Qué procesos de la Agenda cubre una factura de financiero (vacío si no viene de la Agenda o falta la 016). */
export async function procesosDeFactura(noFactura: string): Promise<ProcesosDeFactura | null> {
  const nf = (noFactura ?? '').trim(); if (!nf) return null;
  try {
    // Primero el detalle: si la 016 no está en esta base (o la factura no viene de la Agenda) se corta acá, sin ruido en el log.
    const rows = await fetchAll<DetRow>('factura_detalle_expediente', { eq: { no_factura: nf }, order: { column: 'created_at', ascending: true } });
    if (!rows.length) return null;
    const exps = await listarExpedientesLocal({ noFactura: nf });
    const centros = await fetchAll<{ id: string; nombre: string | null }>('centros_costo', { select: 'id, nombre' });
    const nombreCC = new Map(centros.map(c => [c.id, (c.nombre ?? '').trim()]));
    const detalle = rows.map(r => ({ id: r.id, noFactura: r.no_factura, idExterno: r.id_externo, tipoPrueba: r.tipo_prueba ?? '', categoria: r.categoria ?? '', territorio: r.territorio ?? '', monto: Number(r.monto), centroCostoId: r.centro_costo_id, centroNombre: (r.centro_costo_id && nombreCC.get(r.centro_costo_id)) || '', persona: r.persona ?? '' }));
    const wb = { confirmados: 0, pendientes: 0, conflictos: 0, errores: 0, omitidos: 0 };
    for (const e of exps) { if (e.writebackEstado === 'confirmado') wb.confirmados++; else if (e.writebackEstado === 'conflicto') wb.conflictos++; else if (e.writebackEstado === 'error') wb.errores++; else if (e.writebackEstado === 'omitido') wb.omitidos++; else wb.pendientes++; }
    let detalleFacturacion: ProcesosDeFactura['detalleFacturacion'] = null;
    try { const { data } = await supabase()!.from('detalle_facturacion').select('id, correlativo, aprobado_por, aprobada_en').eq('no_factura', nf).maybeSingle(); const d = data as { id: string; correlativo: string; aprobado_por: string | null; aprobada_en: string | null } | null; if (d) detalleFacturacion = { id: d.id, correlativo: d.correlativo, aprobadoPor: d.aprobado_por ?? '', aprobadaEn: d.aprobada_en }; } catch { /* sin la 019 */ }
    return { detalle, expedientes: exps, subtotal: Math.round(detalle.reduce((s, d) => s + d.monto, 0) * 100) / 100, writeback: wb, detalleFacturacion };
  } catch { return null; }
}

// ── Webhook ─────────────────────────────────────────────────────────────────

/** Registra el id del aviso; false si ya se había recibido (ignorar el repetido). */
export async function registrarEventoWebhook(id: string, tipo: string, ocurrido: string | null): Promise<boolean> {
  const sb = supabase(); if (!sb) return false;
  const { error } = await sb.from('facturacion_webhook_evento').insert({ id, fuente: FUENTE, tipo: tipo || null, ocurrido: ocurrido && !Number.isNaN(Date.parse(ocurrido)) ? ocurrido : null });
  if (!error) return true;
  if (error.code === '23505') return false;
  throw new Error(`facturacion_webhook_evento: ${error.message}`);
}

export const etiquetaEstadoCobro = (s: string | null | undefined): string => (s ? normalizarTexto(s) : 'Sin estado');
