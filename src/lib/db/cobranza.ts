/**
 * CENTRO DE COBROS (033) · contactos de cobro, condiciones del cliente, historial unificado (cobranza_evento),
 * bandeja del día y ficha de cobranza. Solo lee facturas y cobros (nunca los escribe). Las reglas viven en
 * src/lib/cobranza/estado.ts (puro) y en cobranza_estado_factura / cobranza_cerrar_promesas (SQL).
 */
import { supabase } from '@/lib/supabase/client';
import { uuidOpcional } from '@/lib/supabase/writes';
import { obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';
import { getFacturasPendientesCobro, type FacturaPendiente } from './facturas-pendientes';
import { armarBandeja, diasEntre, estadoFactura, resumenUnaLinea, sumarDias, validarGestion, type CanalCobranza, type ClienteBandeja, type EstadoFactura, type EstadoPromesa, type FormaPago, type GestionInput, type ItemBandeja, type ResultadoGestion, type RolContacto, type TipoEvento } from '@/lib/cobranza/estado';

/* ───────────── tipos ───────────── */

export interface ContactoCobro {
  id: string; clienteUuid: string; nombre: string; cargo: string; rol: RolContacto; correo: string; telefono: string; whatsapp: string;
  preferido: boolean; notas: string; activo: boolean; origen: string; creadoPor: string; createdAt: string; desactivadoEn: string | null;
}
export interface CondicionesCobro {
  diasCredito: number; diaPago: string; reqOrdenCompra: boolean; reqContrasena: boolean; reqContrasenaNota: string; reqPortal: boolean; portalUrl: string; portalUsuario: string;
  reqDetalleAprobado: boolean; formaPago: FormaPago | null; instruccionesCobro: string; responsableCobro: string;
}
export interface AdjuntoCobranza { id: string; eventoId: string; nombre: string; mime: string; bytes: number; subidoPor: string; subidoEn: string }
export interface EventoCobranza {
  id: string; clienteUuid: string; tipo: TipoEvento; origen: 'manual' | 'automatico'; fecha: string; canal: CanalCobranza | null;
  contactoId: string | null; contactoNombre: string; contactoTexto: string; resultado: ResultadoGestion | null; comentario: string; facturas: string[];
  monto: number | null; fechaPromesa: string | null; promesaEstado: EstadoPromesa | null; proximoSeguimiento: string | null; seguimientoHechoEn: string | null;
  disputaMotivo: string; datos: Record<string, unknown>; gestionId: string | null; creadoPor: string; adjuntos: AdjuntoCobranza[];
}
interface ClienteRow { id: string; airtable_id: string | null; nombre_empresa: string | null; razon_social: string | null; nit: string | null; dias_credito: number | null; dia_pago: string | null; req_orden_compra: boolean | null; req_contrasena: boolean | null; req_contrasena_nota: string | null; req_portal: boolean | null; portal_url: string | null; portal_usuario: string | null; req_detalle_aprobado: boolean | null; forma_pago: string | null; instrucciones_cobro: string | null; responsable_cobro: string | null; activo: boolean | null }

const SELECT_CLIENTE = 'id, airtable_id, nombre_empresa, razon_social, nit, dias_credito, dia_pago, req_orden_compra, req_contrasena, req_contrasena_nota, req_portal, portal_url, portal_usuario, req_detalle_aprobado, forma_pago, instrucciones_cobro, responsable_cobro, activo';
const esUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);
const n2 = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;

const rowToContacto = (r: Record<string, unknown>): ContactoCobro => ({
  id: String(r.id), clienteUuid: String(r.cliente_id), nombre: String(r.nombre ?? ''), cargo: String(r.cargo ?? ''), rol: (r.rol as RolContacto) ?? 'otro', correo: String(r.correo ?? ''), telefono: String(r.telefono ?? ''), whatsapp: String(r.whatsapp ?? ''),
  preferido: r.preferido === true, notas: String(r.notas ?? ''), activo: r.activo !== false, origen: String(r.origen ?? 'manual'), creadoPor: String(r.creado_por ?? ''), createdAt: String(r.created_at ?? ''), desactivadoEn: (r.desactivado_en as string | null) ?? null,
});
const rowToCondiciones = (r: ClienteRow): CondicionesCobro => ({
  diasCredito: Number(r.dias_credito ?? 0), diaPago: String(r.dia_pago ?? ''), reqOrdenCompra: r.req_orden_compra === true, reqContrasena: r.req_contrasena === true, reqContrasenaNota: String(r.req_contrasena_nota ?? ''),
  reqPortal: r.req_portal === true, portalUrl: String(r.portal_url ?? ''), portalUsuario: String(r.portal_usuario ?? ''), reqDetalleAprobado: r.req_detalle_aprobado === true,
  formaPago: r.forma_pago === 'transferencia' || r.forma_pago === 'cheque' || r.forma_pago === 'deposito' ? r.forma_pago : null, instruccionesCobro: String(r.instrucciones_cobro ?? ''), responsableCobro: String(r.responsable_cobro ?? ''),
});
const rowToEvento = (r: Record<string, unknown>): EventoCobranza => ({
  id: String(r.id), clienteUuid: String(r.cliente_id), tipo: r.tipo as TipoEvento, origen: (r.origen as 'manual' | 'automatico') ?? 'manual', fecha: String(r.fecha ?? ''), canal: (r.canal as CanalCobranza | null) ?? null,
  contactoId: (r.contacto_id as string | null) ?? null, contactoNombre: String((r.contacto as { nombre?: string } | null)?.nombre ?? ''), contactoTexto: String(r.contacto_texto ?? ''), resultado: (r.resultado as ResultadoGestion | null) ?? null,
  comentario: String(r.comentario ?? ''), facturas: Array.isArray(r.facturas) ? r.facturas.map(String) : [], monto: r.monto == null ? null : n2(r.monto), fechaPromesa: (r.fecha_promesa as string | null) ?? null, promesaEstado: (r.promesa_estado as EstadoPromesa | null) ?? null,
  proximoSeguimiento: (r.proximo_seguimiento as string | null) ?? null, seguimientoHechoEn: (r.seguimiento_hecho_en as string | null) ?? null, disputaMotivo: String(r.disputa_motivo ?? ''), datos: (r.datos as Record<string, unknown>) ?? {}, gestionId: (r.gestion_id as string | null) ?? null, creadoPor: String(r.creado_por ?? ''),
  adjuntos: Array.isArray(r.adjuntos) ? (r.adjuntos as Record<string, unknown>[]).map(a => ({ id: String(a.id), eventoId: String(r.id), nombre: String(a.nombre ?? ''), mime: String(a.mime ?? ''), bytes: Number(a.bytes ?? 0), subidoPor: String(a.subido_por ?? ''), subidoEn: String(a.subido_en ?? '') })) : [],
});
const SELECT_EVENTO = '*, contacto:cliente_contacto(nombre), adjuntos:cobranza_adjunto(id, nombre, mime, bytes, subido_por, subido_en)';

/** id de app (airtable_id) o uuid → uuid del cliente. */
export async function clienteUuid(idApp: string): Promise<string | null> {
  if (!idApp) return null;
  if (esUuid(idApp)) return idApp;
  if (idApp.startsWith('n-')) { const sb = supabase(); if (!sb) return null; const nit = idApp.slice(2).trim(); const { data } = await sb.from('clientes').select('id, activo').eq('nit', nit).order('activo', { ascending: false }).limit(1).maybeSingle(); return (data as { id?: string } | null)?.id ?? null; }
  return uuidOpcional('clientes', idApp);
}
export async function getClienteRow(uuid: string): Promise<ClienteRow | null> {
  const sb = supabase(); if (!sb || !esUuid(uuid)) return null;
  const { data } = await sb.from('clientes').select(SELECT_CLIENTE).eq('id', uuid).maybeSingle();
  return (data as ClienteRow | null) ?? null;
}
export const nombreCliente = (r: Pick<ClienteRow, 'nombre_empresa' | 'razon_social'> | null | undefined): string => String(r?.nombre_empresa || r?.razon_social || '').trim();

/* ───────────── eventos ───────────── */

export async function getEventos(uuid: string, opts: { limite?: number } = {}): Promise<EventoCobranza[]> {
  const sb = supabase(); if (!sb || !esUuid(uuid)) return [];
  const { data, error } = await sb.from('cobranza_evento').select(SELECT_EVENTO).eq('cliente_id', uuid).order('fecha', { ascending: false }).order('created_at', { ascending: false }).limit(opts.limite ?? 1000);
  if (error) { console.error('cobranza_evento:', error.message); return []; }
  return ((data ?? []) as Record<string, unknown>[]).map(rowToEvento);
}

export type RegistrarGestionResult = { ok: true; gestionId: string; promesaId: string | null } | { ok: false; error: string };

/** Registra una gestión (y su promesa, si la hubo). Los seguimientos pendientes anteriores del cliente quedan hechos: la gestión nueva los reemplaza. */
export async function registrarGestion(idApp: string, input: GestionInput, actor: string): Promise<RegistrarGestionResult> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
  const uuid = await clienteUuid(idApp); if (!uuid) return { ok: false, error: 'El cliente no existe.' };
  const hoy = obtenerFechaHoyGuatemala();
  const v = validarGestion(input, hoy); if (!v.ok) return v;
  const g = v.gestion;
  if (g.contactoId) {
    const { data: c } = await sb.from('cliente_contacto').select('id, nombre').eq('id', g.contactoId).eq('cliente_id', uuid).maybeSingle();
    if (!c) return { ok: false, error: 'El contacto no es de este cliente.' };
    if (!g.contactoTexto) g.contactoTexto = String((c as { nombre?: string }).nombre ?? '');
  }
  const fecha = g.fecha && g.fecha < hoy ? `${g.fecha}T18:00:00.000Z` : new Date().toISOString();
  const { data, error } = await sb.from('cobranza_evento').insert({
    cliente_id: uuid, tipo: 'gestion', origen: 'manual', fecha, canal: g.canal, contacto_id: g.contactoId, contacto_texto: g.contactoTexto || null, resultado: g.resultado, comentario: g.comentario || null,
    facturas: g.facturas, monto: g.promesaMonto, fecha_promesa: g.promesaFecha, proximo_seguimiento: g.proximoSeguimiento, disputa_motivo: g.disputaMotivo || null, creado_por: actor,
  }).select('id').single();
  if (error || !data) return { ok: false, error: /does not exist|Could not find|schema cache/i.test(error?.message ?? '') ? 'Falta aplicar la migración 033 en esta base.' : `No se pudo registrar la gestión: ${error?.message ?? 'sin respuesta'}` };
  const gestionId = String((data as { id: string }).id);
  let promesaId: string | null = null;
  if (g.resultado === 'promesa' && g.promesaFecha) {
    // la promesa anterior pendiente de las mismas facturas queda reprogramada por esta
    await sb.from('cobranza_evento').update({ promesa_estado: 'reprogramada', promesa_cerrada_en: new Date().toISOString() }).eq('cliente_id', uuid).eq('tipo', 'promesa').eq('promesa_estado', 'pendiente').overlaps('facturas', g.facturas.length ? g.facturas : ['__ninguna__']);
    const { data: p } = await sb.from('cobranza_evento').insert({ cliente_id: uuid, tipo: 'promesa', origen: 'manual', fecha, contacto_id: g.contactoId, contacto_texto: g.contactoTexto || null, facturas: g.facturas, monto: g.promesaMonto, fecha_promesa: g.promesaFecha, promesa_estado: 'pendiente', gestion_id: gestionId, creado_por: actor }).select('id').single();
    promesaId = p ? String((p as { id: string }).id) : null;
  }
  await sb.from('cobranza_evento').update({ seguimiento_hecho_en: new Date().toISOString() }).eq('cliente_id', uuid).eq('tipo', 'gestion').neq('id', gestionId).is('seguimiento_hecho_en', null).not('proximo_seguimiento', 'is', null);
  return { ok: true, gestionId, promesaId };
}

/** Marca un seguimiento como hecho sin registrar gestión (p. ej. ya no aplica). */
export async function marcarSeguimientoHecho(eventoId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = supabase(); if (!sb || !esUuid(eventoId)) return { ok: false, error: 'El seguimiento no existe.' };
  const { error } = await sb.from('cobranza_evento').update({ seguimiento_hecho_en: new Date().toISOString() }).eq('id', eventoId).eq('tipo', 'gestion');
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Evento automático (factura emitida, cobro recibido, detalle, cambio de condición). Fail-soft: nunca rompe la operación que lo origina. */
export async function registrarEventoAutomatico(cliente: { uuid?: string | null; idApp?: string | null; noFactura?: string | null }, ev: { tipo: TipoEvento; comentario?: string; facturas?: string[]; monto?: number | null; datos?: Record<string, unknown>; actor?: string; fecha?: string }): Promise<string | null> {
  try {
    const sb = supabase(); if (!sb) return null;
    let uuid = cliente.uuid && esUuid(cliente.uuid) ? cliente.uuid : null;
    if (!uuid && cliente.idApp) uuid = await clienteUuid(cliente.idApp);
    if (!uuid && cliente.noFactura) { const { data } = await sb.from('facturas_clientes').select('cliente_id').eq('no_factura', cliente.noFactura).not('cliente_id', 'is', null).limit(1).maybeSingle(); uuid = (data as { cliente_id?: string } | null)?.cliente_id ?? null; }
    if (!uuid) return null;
    const { data, error } = await sb.from('cobranza_evento').insert({ cliente_id: uuid, tipo: ev.tipo, origen: 'automatico', fecha: ev.fecha ?? new Date().toISOString(), comentario: ev.comentario ?? null, facturas: ev.facturas ?? [], monto: ev.monto ?? null, datos: ev.datos ?? {}, creado_por: ev.actor ?? 'sistema' }).select('id').single();
    if (error) { console.error('cobranza_evento automático:', error.message.slice(0, 120)); return null; }
    return String((data as { id: string }).id);
  } catch (e) { console.error('registrarEventoAutomatico:', e instanceof Error ? e.message : String(e)); return null; }
}

/** Las promesas se cierran solas (cumplida con el cobro, incumplida al pasar la fecha). Fail-soft. */
export async function cerrarPromesas(): Promise<{ cumplidas: number; incumplidas: number }> {
  try { const sb = supabase(); if (!sb) return { cumplidas: 0, incumplidas: 0 }; const { data } = await sb.rpc('cobranza_cerrar_promesas', { p_hoy: obtenerFechaHoyGuatemala() }); const r = (data ?? {}) as { cumplidas?: number; incumplidas?: number }; return { cumplidas: Number(r.cumplidas ?? 0), incumplidas: Number(r.incumplidas ?? 0) }; }
  catch { return { cumplidas: 0, incumplidas: 0 }; }
}

/* ───────────── contactos ───────────── */

export async function getContactos(uuid: string, opts: { incluirInactivos?: boolean } = {}): Promise<ContactoCobro[]> {
  const sb = supabase(); if (!sb || !esUuid(uuid)) return [];
  let q = sb.from('cliente_contacto').select('*').eq('cliente_id', uuid).order('preferido', { ascending: false }).order('activo', { ascending: false }).order('created_at');
  if (!opts.incluirInactivos) q = q.eq('activo', true);
  const { data, error } = await q;
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map(rowToContacto);
}
export interface ContactoInput { nombre: string; cargo?: string; rol: string; correo?: string; telefono?: string; whatsapp?: string; preferido?: boolean; notas?: string }
const limpiarContacto = (i: ContactoInput): { ok: true; c: Required<ContactoInput> } | { ok: false; error: string } => {
  const nombre = String(i.nombre ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (nombre.length < 2) return { ok: false, error: 'El nombre del contacto es obligatorio.' };
  const rol = ['pagos', 'cuentas_por_pagar', 'aprobador', 'solicitante', 'otro'].includes(i.rol) ? i.rol : 'otro';
  const correo = String(i.correo ?? '').trim().toLowerCase().slice(0, 200);
  if (correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return { ok: false, error: 'El correo no es válido.' };
  return { ok: true, c: { nombre, cargo: String(i.cargo ?? '').trim().slice(0, 120), rol, correo, telefono: String(i.telefono ?? '').trim().slice(0, 40), whatsapp: String(i.whatsapp ?? '').trim().slice(0, 40), preferido: i.preferido === true, notas: String(i.notas ?? '').trim().slice(0, 500) } };
};
export async function crearContacto(idApp: string, input: ContactoInput, actor: string): Promise<{ ok: true; contacto: ContactoCobro } | { ok: false; error: string }> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
  const uuid = await clienteUuid(idApp); if (!uuid) return { ok: false, error: 'El cliente no existe.' };
  const v = limpiarContacto(input); if (!v.ok) return v;
  if (v.c.preferido) await sb.from('cliente_contacto').update({ preferido: false, updated_at: new Date().toISOString() }).eq('cliente_id', uuid).eq('preferido', true);
  const { data, error } = await sb.from('cliente_contacto').insert({ cliente_id: uuid, nombre: v.c.nombre, cargo: v.c.cargo || null, rol: v.c.rol, correo: v.c.correo || null, telefono: v.c.telefono || null, whatsapp: v.c.whatsapp || null, preferido: v.c.preferido, notas: v.c.notas || null, origen: 'manual', creado_por: actor }).select('*').single();
  if (error || !data) return { ok: false, error: error?.message ?? 'No se pudo crear el contacto.' };
  await registrarEventoAutomatico({ uuid }, { tipo: 'cambio_condicion', comentario: `Contacto nuevo: ${v.c.nombre}${v.c.cargo ? ` (${v.c.cargo})` : ''}${v.c.preferido ? ' · preferido' : ''}`, actor, datos: { contacto: v.c.nombre, accion: 'crear' } });
  return { ok: true, contacto: rowToContacto(data as Record<string, unknown>) };
}
export async function editarContacto(contactoId: string, input: ContactoInput, actor: string): Promise<{ ok: true; contacto: ContactoCobro } | { ok: false; error: string }> {
  const sb = supabase(); if (!sb || !esUuid(contactoId)) return { ok: false, error: 'El contacto no existe.' };
  const v = limpiarContacto(input); if (!v.ok) return v;
  const { data: prev } = await sb.from('cliente_contacto').select('*').eq('id', contactoId).maybeSingle();
  if (!prev) return { ok: false, error: 'El contacto no existe.' };
  const uuid = String((prev as { cliente_id: string }).cliente_id);
  if (v.c.preferido) await sb.from('cliente_contacto').update({ preferido: false, updated_at: new Date().toISOString() }).eq('cliente_id', uuid).eq('preferido', true).neq('id', contactoId);
  const { data, error } = await sb.from('cliente_contacto').update({ nombre: v.c.nombre, cargo: v.c.cargo || null, rol: v.c.rol, correo: v.c.correo || null, telefono: v.c.telefono || null, whatsapp: v.c.whatsapp || null, preferido: v.c.preferido, notas: v.c.notas || null, updated_at: new Date().toISOString() }).eq('id', contactoId).select('*').single();
  if (error || !data) return { ok: false, error: error?.message ?? 'No se pudo editar el contacto.' };
  await registrarEventoAutomatico({ uuid }, { tipo: 'cambio_condicion', comentario: `Contacto editado: ${v.c.nombre}`, actor, datos: { contacto: v.c.nombre, accion: 'editar' } });
  return { ok: true, contacto: rowToContacto(data as Record<string, unknown>) };
}
/** Cuando el cliente cambia de persona: se desactiva, no se borra (el historial sigue diciendo con quién se habló). */
export async function desactivarContacto(contactoId: string, actor: string, motivo?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = supabase(); if (!sb || !esUuid(contactoId)) return { ok: false, error: 'El contacto no existe.' };
  const { data, error } = await sb.from('cliente_contacto').update({ activo: false, preferido: false, desactivado_en: new Date().toISOString(), desactivado_por: actor, updated_at: new Date().toISOString() }).eq('id', contactoId).eq('activo', true).select('cliente_id, nombre').maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'El contacto ya estaba inactivo.' };
  const d = data as { cliente_id: string; nombre: string };
  await registrarEventoAutomatico({ uuid: d.cliente_id }, { tipo: 'cambio_condicion', comentario: `Contacto desactivado: ${d.nombre}${motivo ? ` · ${motivo.slice(0, 200)}` : ''}`, actor, datos: { contacto: d.nombre, accion: 'desactivar' } });
  return { ok: true };
}

/* ───────────── condiciones ───────────── */

export type CondicionesInput = Partial<Omit<CondicionesCobro, 'diasCredito'>>;
export async function editarCondiciones(idApp: string, input: CondicionesInput, actor: string): Promise<{ ok: true; condiciones: CondicionesCobro } | { ok: false; error: string }> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
  const uuid = await clienteUuid(idApp); if (!uuid) return { ok: false, error: 'El cliente no existe.' };
  const prev = await getClienteRow(uuid); if (!prev) return { ok: false, error: 'El cliente no existe.' };
  const portalUrl = String(input.portalUrl ?? '').trim().slice(0, 300);
  if (portalUrl && !/^https?:\/\//i.test(portalUrl)) return { ok: false, error: 'La URL del portal tiene que empezar con http:// o https://.' };
  const formaPago = input.formaPago === 'transferencia' || input.formaPago === 'cheque' || input.formaPago === 'deposito' ? input.formaPago : null;
  const responsable = String(input.responsableCobro ?? '').trim().toLowerCase().slice(0, 200);
  const patch = {
    dia_pago: String(input.diaPago ?? '').trim().slice(0, 120) || null, req_orden_compra: input.reqOrdenCompra === true, req_contrasena: input.reqContrasena === true, req_contrasena_nota: String(input.reqContrasenaNota ?? '').trim().slice(0, 300) || null,
    req_portal: input.reqPortal === true, portal_url: portalUrl || null, portal_usuario: String(input.portalUsuario ?? '').trim().slice(0, 200) || null, req_detalle_aprobado: input.reqDetalleAprobado === true,
    forma_pago: formaPago, instrucciones_cobro: String(input.instruccionesCobro ?? '').trim().slice(0, 2000) || null, responsable_cobro: responsable || null, updated_at: new Date().toISOString(),
  };
  const { data, error } = await sb.from('clientes').update(patch).eq('id', uuid).select(SELECT_CLIENTE).single();
  if (error || !data) return { ok: false, error: /column .* does not exist|schema cache/i.test(error?.message ?? '') ? 'Falta aplicar la migración 033 en esta base.' : error?.message ?? 'No se pudo guardar.' };
  const antes = rowToCondiciones(prev), ahora = rowToCondiciones(data as ClienteRow);
  const cambios = (Object.keys(ahora) as (keyof CondicionesCobro)[]).filter(k => k !== 'diasCredito' && String(antes[k] ?? '') !== String(ahora[k] ?? ''));
  if (cambios.length) await registrarEventoAutomatico({ uuid }, { tipo: 'cambio_condicion', comentario: `Condiciones de cobro: ${cambios.join(', ')}`, actor, datos: { cambios } });
  return { ok: true, condiciones: ahora };
}

/* ───────────── datos compartidos: facturas abiertas + eventos por cliente ───────────── */

interface Agrupado { facturas: FacturaPendiente[]; eventos: EventoCobranza[] }

function clienteBandejaDe(row: ClienteRow, fp: FacturaPendiente[], eventos: EventoCobranza[], contactos: ContactoCobro[], hoy: string): ClienteBandeja {
  const gest = eventos.filter(e => e.tipo === 'gestion').sort((a, b) => b.fecha.localeCompare(a.fecha));
  const g = gest[0];
  const pref = contactos.find(c => c.activo && c.preferido) ?? contactos.find(c => c.activo) ?? null;
  return {
    clienteId: row.airtable_id ?? row.id, clienteUuid: row.id, nombre: nombreCliente(row) || `NIT ${row.nit ?? ''}`, responsable: row.responsable_cobro || null,
    facturas: fp.map(f => ({ noFactura: f.noFactura, facturaId: f.id, saldo: f.saldo, total: f.total, fechaEmision: f.fechaEmision, diasCredito: f.diasCredito, parcial: f.esParcial, cedida: !!f.cedida })),
    contactoPreferido: pref ? { id: pref.id, nombre: pref.nombre, correo: pref.correo || null, telefono: pref.telefono || null, whatsapp: pref.whatsapp || null } : null,
    ultimaGestion: g ? { fecha: g.fecha, canal: g.canal ?? 'nota', contacto: g.contactoNombre || g.contactoTexto, resultado: g.resultado ?? 'contactado', comentario: g.comentario } : null,
    promesas: eventos.filter(e => e.tipo === 'promesa' && e.fechaPromesa && (e.promesaEstado === 'pendiente' || e.promesaEstado === 'incumplida')).map(e => ({ id: e.id, fecha: e.fechaPromesa!, monto: e.monto, estado: e.promesaEstado!, facturas: e.facturas })),
    seguimientos: gest.filter(e => e.proximoSeguimiento && !e.seguimientoHechoEn).map(e => ({ id: e.id, fecha: e.proximoSeguimiento!, resultado: e.resultado ?? 'contactado', comentario: e.comentario })).filter(s => s.fecha <= sumarDias(hoy, 3650)),
  };
}

/** Estado calculado de cada factura abierta (espejo del SQL) con la última promesa / gestión que la cubre. */
export function estadosDeFacturas(fp: FacturaPendiente[], eventos: EventoCobranza[], hoy: string): Record<string, EstadoFactura> {
  const out: Record<string, EstadoFactura> = {};
  const promesas = eventos.filter(e => e.tipo === 'promesa' && e.fechaPromesa).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const gestiones = eventos.filter(e => e.tipo === 'gestion').sort((a, b) => b.fecha.localeCompare(a.fecha));
  for (const f of fp) {
    const p = promesas.find(e => e.facturas.length === 0 || e.facturas.includes(f.noFactura));
    const g = gestiones.find(e => e.facturas.length === 0 || e.facturas.includes(f.noFactura));
    out[f.noFactura] = estadoFactura({ fechaEmision: f.fechaEmision, diasCredito: f.diasCredito, cobrada: false, parcial: f.esParcial, ultimaPromesa: p ? { fecha: p.fechaPromesa!, estado: p.promesaEstado ?? 'pendiente' } : null, ultimaGestion: g?.resultado ? { resultado: g.resultado } : null }, hoy);
  }
  return out;
}

async function cargarAgrupado(): Promise<{ pend: Awaited<ReturnType<typeof getFacturasPendientesCobro>>; clientes: ClienteRow[]; porUuid: Map<string, Agrupado>; contactos: Map<string, ContactoCobro[]> }> {
  const sb = supabase();
  const [pend, clientesData, eventosData, contactosData] = await Promise.all([
    getFacturasPendientesCobro(),
    sb ? sb.from('clientes').select(SELECT_CLIENTE).limit(5000) : Promise.resolve({ data: [] as ClienteRow[] }),
    sb ? sb.from('cobranza_evento').select(SELECT_EVENTO).in('tipo', ['gestion', 'promesa']).order('fecha', { ascending: false }).limit(5000) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    sb ? sb.from('cliente_contacto').select('*').eq('activo', true).limit(5000) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const clientes = ((clientesData.data ?? []) as ClienteRow[]);
  const porApp = new Map(clientes.map(c => [c.airtable_id ?? c.id, c]));
  const porUuid = new Map<string, Agrupado>();
  const ag = (u: string) => { const x = porUuid.get(u) ?? { facturas: [], eventos: [] }; porUuid.set(u, x); return x; };
  for (const f of pend.filas) { const c = porApp.get(f.custId); if (c) ag(c.id).facturas.push(f); }
  for (const r of (eventosData.data ?? []) as Record<string, unknown>[]) { const e = rowToEvento(r); ag(e.clienteUuid).eventos.push(e); }
  const contactos = new Map<string, ContactoCobro[]>();
  for (const r of (contactosData.data ?? []) as Record<string, unknown>[]) { const c = rowToContacto(r); contactos.set(c.clienteUuid, [...(contactos.get(c.clienteUuid) ?? []), c]); }
  return { pend, clientes, porUuid, contactos };
}

/* ───────────── bandeja ───────────── */

export interface KpisBandeja { carteraTotal: number; vencida: number; masDe60: number; promesasSemana: number; promesasSemanaN: number; cumplidasMes: number; cerradasMes: number; pctCumplidas: number | null; clientesConCartera: number }
export interface ClienteLiteBandeja { clienteId: string; nombre: string; contactos: ContactoCobro[]; facturas: Array<{ noFactura: string; saldo: number; diasVencidos: number }> }
export interface DatosBandeja { hoy: string; items: ItemBandeja[]; kpis: KpisBandeja; misClientes: boolean; responsables: string[]; cerradas: { cumplidas: number; incumplidas: number }; /** contactos y facturas de los clientes que aparecen (para el formulario rápido) */ clientes: Record<string, ClienteLiteBandeja> }

export async function getDatosBandeja(opts: { email: string; rol: string; soloMios?: boolean }): Promise<DatosBandeja> {
  const cerradas = await cerrarPromesas();
  const hoy = obtenerFechaHoyGuatemala();
  const { pend, clientes, porUuid, contactos } = await cargarAgrupado();
  const porUuidCliente = new Map(clientes.map(c => [c.id, c]));
  const lista: ClienteBandeja[] = [];
  for (const [uuid, a] of porUuid) { const row = porUuidCliente.get(uuid); if (!row) continue; lista.push(clienteBandejaDe(row, a.facturas, a.eventos, contactos.get(uuid) ?? [], hoy)); }
  // «mis clientes» por defecto para el rol cobranza (+ los sin responsable); admin y contador ven todo
  const soloMios = opts.soloMios ?? opts.rol === 'cobranza';
  const visibles = soloMios ? lista.filter(c => !c.responsable || c.responsable.toLowerCase() === opts.email.toLowerCase()) : lista;
  const items = armarBandeja(visibles, hoy);
  const abiertas = pend.filas.filter(f => !f.cedida);
  const semanaFin = sumarDias(hoy, 7), mes = hoy.slice(0, 7);
  const todasPromesas = [...porUuid.values()].flatMap(a => a.eventos.filter(e => e.tipo === 'promesa'));
  const promesasSemana = todasPromesas.filter(p => p.promesaEstado === 'pendiente' && p.fechaPromesa && p.fechaPromesa >= hoy && p.fechaPromesa <= semanaFin);
  const cerradasMes = todasPromesas.filter(p => (p.promesaEstado === 'cumplida' || p.promesaEstado === 'incumplida') && (p.datos as { promesa_cerrada_en?: string }).promesa_cerrada_en !== undefined ? false : (p.promesaEstado === 'cumplida' || p.promesaEstado === 'incumplida') && (p.fechaPromesa ?? '').startsWith(mes));
  const cumplidasMes = cerradasMes.filter(p => p.promesaEstado === 'cumplida');
  const kpis: KpisBandeja = {
    carteraTotal: n2(abiertas.reduce((s, f) => s + f.saldo, 0)), vencida: n2(abiertas.filter(f => f.vencida).reduce((s, f) => s + f.saldo, 0)), masDe60: n2(abiertas.filter(f => f.diasVencidos > 60).reduce((s, f) => s + f.saldo, 0)),
    promesasSemana: n2(promesasSemana.reduce((s, p) => s + (p.monto ?? 0), 0)), promesasSemanaN: promesasSemana.length, cumplidasMes: cumplidasMes.length, cerradasMes: cerradasMes.length,
    pctCumplidas: cerradasMes.length ? Math.round((cumplidasMes.length / cerradasMes.length) * 100) : null, clientesConCartera: new Set(abiertas.map(f => f.custId)).size,
  };
  const clientesLite: Record<string, ClienteLiteBandeja> = {};
  for (const c of visibles) if (items.some(i => i.clienteId === c.clienteId)) clientesLite[c.clienteId] = { clienteId: c.clienteId, nombre: c.nombre, contactos: (contactos.get(c.clienteUuid) ?? []).filter(x => x.activo), facturas: c.facturas.filter(f => !f.cedida).map(f => ({ noFactura: f.noFactura, saldo: f.saldo, diasVencidos: diasEntre(sumarDias(f.fechaEmision, f.diasCredito), hoy) })) };
  return { hoy, items, kpis, misClientes: soloMios, responsables: [...new Set(clientes.map(c => c.responsable_cobro).filter((x): x is string => !!x))].sort(), cerradas, clientes: clientesLite };
}

/* ───────────── ficha ───────────── */

export interface FacturaAbiertaFicha extends FacturaPendiente { estadoCobro: EstadoFactura }
export interface FichaCobranza {
  hoy: string; clienteId: string; clienteUuid: string; nombre: string; nit: string; condiciones: CondicionesCobro; contactos: ContactoCobro[];
  facturas: FacturaAbiertaFicha[]; eventos: EventoCobranza[]; resumen: string; saldo: number; vencido: number; proximoSeguimiento: string | null;
  ultimoContactoPorContacto: Record<string, string>; promesaVigente: { fecha: string; monto: number | null; facturas: string[] } | null;
}
export async function getFichaCobranza(idApp: string): Promise<FichaCobranza | null> {
  const uuid = await clienteUuid(idApp); if (!uuid) return null;
  const row = await getClienteRow(uuid); if (!row) return null;
  await cerrarPromesas();
  const hoy = obtenerFechaHoyGuatemala();
  const [pend, eventos, contactos] = await Promise.all([getFacturasPendientesCobro(), getEventos(uuid), getContactos(uuid, { incluirInactivos: true })]);
  const mias = pend.filas.filter(f => f.custId === (row.airtable_id ?? row.id)).sort((a, b) => b.diasVencidos - a.diasVencidos);
  const estados = estadosDeFacturas(mias, eventos, hoy);
  const cb = clienteBandejaDe(row, mias, eventos, contactos, hoy);
  const ultimoContactoPorContacto: Record<string, string> = {};
  for (const e of eventos) if (e.tipo === 'gestion' && e.contactoId && !ultimoContactoPorContacto[e.contactoId]) ultimoContactoPorContacto[e.contactoId] = e.fecha;
  const vigente = cb.promesas.filter(p => p.estado === 'pendiente' && p.fecha >= hoy).sort((a, b) => a.fecha.localeCompare(b.fecha))[0] ?? null;
  const abiertas = mias.filter(f => !f.cedida);
  return {
    hoy, clienteId: row.airtable_id ?? row.id, clienteUuid: uuid, nombre: nombreCliente(row) || `NIT ${row.nit ?? ''}`, nit: String(row.nit ?? ''), condiciones: rowToCondiciones(row), contactos,
    facturas: mias.map(f => ({ ...f, estadoCobro: estados[f.noFactura] })), eventos, resumen: resumenUnaLinea(cb, hoy),
    saldo: n2(abiertas.reduce((s, f) => s + f.saldo, 0)), vencido: n2(abiertas.filter(f => f.vencida).reduce((s, f) => s + f.saldo, 0)),
    proximoSeguimiento: cb.seguimientos.sort((a, b) => a.fecha.localeCompare(b.fecha))[0]?.fecha ?? null, ultimoContactoPorContacto,
    promesaVigente: vigente ? { fecha: vigente.fecha, monto: vigente.monto, facturas: vigente.facturas } : null,
  };
}

/* ───────────── compatibilidad: resumen para Pendientes y la tool de Auros ───────────── */

export interface ResumenCobranza {
  porCliente: Record<string, { ultimaGestion: string; diasDesdeUltima: number; numGestiones: number; fechaPagoPromesa?: string; promesaVencida: boolean; proximoSeguimiento?: string }>;
  porFactura: Record<string, { fechaPromesa: string; promesaVencida: boolean }>;
}
/** Resumen por cliente (id de app) y por número de factura desde el historial nuevo (reemplaza al de gestiones_cobro). */
export async function getResumenCobranza(): Promise<ResumenCobranza> {
  const sb = supabase(); const out: ResumenCobranza = { porCliente: {}, porFactura: {} };
  if (!sb) return out;
  const hoy = obtenerFechaHoyGuatemala();
  const [{ data: evs }, { data: cls }] = await Promise.all([
    sb.from('cobranza_evento').select('id, cliente_id, tipo, fecha, facturas, fecha_promesa, promesa_estado, proximo_seguimiento, seguimiento_hecho_en').in('tipo', ['gestion', 'promesa']).order('fecha', { ascending: false }).limit(5000),
    sb.from('clientes').select('id, airtable_id').limit(5000),
  ]);
  const app = new Map(((cls ?? []) as { id: string; airtable_id: string | null }[]).map(c => [c.id, c.airtable_id ?? c.id]));
  for (const r of (evs ?? []) as Record<string, unknown>[]) {
    const cid = app.get(String(r.cliente_id)) ?? String(r.cliente_id); const fecha = String(r.fecha).slice(0, 10);
    if (r.tipo === 'gestion') {
      const a = out.porCliente[cid];
      if (!a) out.porCliente[cid] = { ultimaGestion: fecha, diasDesdeUltima: Math.max(0, diasEntre(fecha, hoy)), numGestiones: 1, promesaVencida: false, proximoSeguimiento: !r.seguimiento_hecho_en && r.proximo_seguimiento ? String(r.proximo_seguimiento) : undefined };
      else { a.numGestiones++; if (!a.proximoSeguimiento && !r.seguimiento_hecho_en && r.proximo_seguimiento) a.proximoSeguimiento = String(r.proximo_seguimiento); }
    } else if (r.tipo === 'promesa' && (r.promesa_estado === 'pendiente' || r.promesa_estado === 'incumplida') && r.fecha_promesa) {
      const fp = String(r.fecha_promesa), vencida = r.promesa_estado === 'incumplida' || fp < hoy;
      const a = out.porCliente[cid] ?? (out.porCliente[cid] = { ultimaGestion: fecha, diasDesdeUltima: Math.max(0, diasEntre(fecha, hoy)), numGestiones: 0, promesaVencida: false });
      if (!a.fechaPagoPromesa) { a.fechaPagoPromesa = fp; a.promesaVencida = vencida; }
      for (const nf of (Array.isArray(r.facturas) ? r.facturas.map(String) : [])) if (!out.porFactura[nf]) out.porFactura[nf] = { fechaPromesa: fp, promesaVencida: vencida };
    }
  }
  return out;
}
