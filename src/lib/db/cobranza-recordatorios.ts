/**
 * CENTRO DE COBROS · PR 2 (035) · recordatorios propuestos y estado de cuenta — capa de datos (servidor).
 *
 * Lee: la cartera abierta con SALDO REAL (las mismas tres lecturas del #51: facturas con cliente, cobros activos y NC
 * activas → total − cobros − NC, como Identificar pago), las cesiones a factoraje (las cedidas no se recuerdan: las cobra
 * el financiador), clientes, contactos, los eventos de cobranza que pesan (gestión, promesa, correo enviado), las
 * omisiones, las reglas y las plantillas de la 035 y, para el estado de cuenta, los paquetes prepagados del NIT (034).
 * Escribe SOLO: el evento `correo_enviado` de cada envío (con el texto y el resultado de Resend), las omisiones y las
 * plantillas / reglas que edita admin o contador. Nunca facturas ni cobros. No hay cron: nada sale sin «Enviar».
 */
import { supabase } from '@/lib/supabase/client';
import { empresaConfig } from '@/lib/config/empresa';
import { configCorreo, correoConfigurado, enviarCorreo } from '@/lib/correo/resend';
import { obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';
import { consolidarParaBusqueda, leerFilasBusqueda } from './facturas-buscar';
import { getCesionesActivasPorFactura } from './factoraje-cesiones';
import { clienteUuid, getClienteRow, nombreCliente, registrarEventoAutomatico } from './cobranza';
import { correoCobranza } from '@/lib/cobranza/correo';
import {
  REGLAS_POR_DEFECTO, armarEstadoCuenta, destinatarioPropuesto, esPlantillaClave, esRegla, fechaLarga, proponerRecordatorios, renderPlantilla, resumenBorradores, validarEnvio, validarPlantilla, validarRegla,
  type Borrador, type ClienteRecordatorio, type ContactoRecordatorio, type EnvioPrevio, type EstadoCuenta, type FacturaRecordatorio, type PaqueteEC, type Plantilla, type PlantillaClave, type ReglaClave, type ReglaRecordatorio,
} from '@/lib/cobranza/recordatorios';
import type { EstadoPromesa, ResultadoGestion } from '@/lib/cobranza/estado';

const sinTabla = (m: string) => /does not exist|Could not find|schema cache/i.test(m);
const esUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);
const fmtQ = (n: number) => `Q${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ───────────── reglas y plantillas ───────────── */

type FilaRegla = { clave: string; nombre: string; descripcion: string | null; activo: boolean; dias: number; cada_dias: number | null; plantilla_clave: string };
type FilaPlantilla = { clave: string; nombre: string; descripcion: string | null; asunto: string; cuerpo: string; activo: boolean; updated_at: string | null; updated_por: string | null };

export async function getReglas(): Promise<{ reglas: ReglaRecordatorio[]; disponible: boolean }> {
  const sb = supabase(); if (!sb) return { reglas: REGLAS_POR_DEFECTO, disponible: false };
  const { data, error } = await sb.from('cobranza_regla_recordatorio').select('*').order('clave');
  if (error) { if (!sinTabla(error.message)) console.error('cobranza_regla_recordatorio:', error.message); return { reglas: REGLAS_POR_DEFECTO, disponible: false }; }
  const filas = ((data ?? []) as FilaRegla[]).filter(r => esRegla(r.clave)).map((r): ReglaRecordatorio => ({ clave: r.clave as ReglaClave, nombre: r.nombre, descripcion: r.descripcion ?? '', activo: r.activo !== false, dias: Number(r.dias), cadaDias: r.cada_dias == null ? null : Number(r.cada_dias), plantillaClave: r.plantilla_clave }));
  return { reglas: filas.length ? filas : REGLAS_POR_DEFECTO, disponible: true };
}
export async function getPlantillas(): Promise<Record<PlantillaClave, Plantilla> | null> {
  const sb = supabase(); if (!sb) return null;
  const { data, error } = await sb.from('cobranza_plantilla').select('*');
  if (error) { if (!sinTabla(error.message)) console.error('cobranza_plantilla:', error.message); return null; }
  const out = {} as Record<PlantillaClave, Plantilla>;
  for (const r of (data ?? []) as FilaPlantilla[]) if (esPlantillaClave(r.clave)) out[r.clave] = { clave: r.clave, nombre: r.nombre, descripcion: r.descripcion ?? '', asunto: r.asunto ?? '', cuerpo: r.cuerpo ?? '', activo: r.activo !== false, updatedAt: r.updated_at, updatedPor: r.updated_por ?? '' };
  return out;
}
export async function editarPlantilla(clave: string, input: { asunto?: string; cuerpo?: string; nombre?: string }, actor: string): Promise<{ ok: true; plantilla: Plantilla } | { ok: false; error: string }> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
  const v = validarPlantilla(clave, input); if (!v.ok) return v;
  const patch: Record<string, unknown> = { asunto: v.plantilla.asunto, cuerpo: v.plantilla.cuerpo, updated_at: new Date().toISOString(), updated_por: actor };
  if (v.plantilla.nombre) patch.nombre = v.plantilla.nombre;
  const { data, error } = await sb.from('cobranza_plantilla').update(patch).eq('clave', clave).select('*').single();
  if (error || !data) return { ok: false, error: sinTabla(error?.message ?? '') ? 'Falta aplicar la migración 035 en esta base.' : error?.message ?? 'No se pudo guardar.' };
  const r = data as FilaPlantilla;
  return { ok: true, plantilla: { clave: r.clave as PlantillaClave, nombre: r.nombre, descripcion: r.descripcion ?? '', asunto: r.asunto, cuerpo: r.cuerpo, activo: r.activo !== false, updatedAt: r.updated_at, updatedPor: r.updated_por ?? '' } };
}
export async function editarRegla(clave: string, input: { activo?: boolean; dias?: number; cadaDias?: number | null }, actor: string): Promise<{ ok: true; regla: ReglaRecordatorio } | { ok: false; error: string }> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
  if (!esRegla(clave)) return { ok: false, error: 'La regla no existe.' };
  const v = validarRegla(input); if (!v.ok) return v;
  const cada = clave === 'vencida' ? v.regla.cadaDias : null;   // solo la vencida se repite
  const { data, error } = await sb.from('cobranza_regla_recordatorio').update({ activo: v.regla.activo, dias: v.regla.dias, cada_dias: cada, updated_at: new Date().toISOString(), updated_por: actor }).eq('clave', clave).select('*').single();
  if (error || !data) return { ok: false, error: sinTabla(error?.message ?? '') ? 'Falta aplicar la migración 035 en esta base.' : error?.message ?? 'No se pudo guardar.' };
  const r = data as FilaRegla;
  return { ok: true, regla: { clave, nombre: r.nombre, descripcion: r.descripcion ?? '', activo: r.activo !== false, dias: Number(r.dias), cadaDias: r.cada_dias == null ? null : Number(r.cada_dias), plantillaClave: r.plantilla_clave } };
}

/* ───────────── carga de los clientes con cartera (saldo real) ───────────── */

interface ClienteRow { id: string; airtable_id: string | null; nombre_empresa: string | null; razon_social: string | null; nit: string | null; dias_credito: number | null; responsable_cobro: string | null; activo: boolean | null }
type FilaEvento = { id: string; cliente_id: string; tipo: string; fecha: string; resultado: string | null; facturas: string[] | null; monto: number | string | null; fecha_promesa: string | null; promesa_estado: string | null; datos: Record<string, unknown> | null };

export interface CargaRecordatorios { hoy: string; clientes: ClienteRecordatorio[]; porUuid: Map<string, ClienteRecordatorio>; filasCliente: Map<string, ClienteRow>; ms: number; disponible: boolean; error?: string }

/** Todo lo que hace falta para proponer (y para el estado de cuenta de cualquier cliente), en 7 lecturas en paralelo. */
export async function cargarRecordatorios(): Promise<CargaRecordatorios> {
  const t0 = Date.now();
  const hoy = obtenerFechaHoyGuatemala();
  const sb = supabase(); if (!sb) return { hoy, clientes: [], porUuid: new Map(), filasCliente: new Map(), ms: 0, disponible: false, error: 'Supabase no está configurado.' };
  try {
    const [{ filas, cobros, ncs }, cedidas, cl, ct, ev, om] = await Promise.all([
      leerFilasBusqueda(), getCesionesActivasPorFactura(),
      sb.from('clientes').select('id, airtable_id, nombre_empresa, razon_social, nit, dias_credito, responsable_cobro, activo').limit(5000),
      sb.from('cliente_contacto').select('id, cliente_id, nombre, rol, correo, preferido').eq('activo', true).limit(5000),
      sb.from('cobranza_evento').select('id, cliente_id, tipo, fecha, resultado, facturas, monto, fecha_promesa, promesa_estado, datos').in('tipo', ['gestion', 'promesa', 'correo_enviado']).order('fecha', { ascending: false }).limit(8000),
      sb.from('cobranza_recordatorio_omision').select('cliente_id, regla, hasta, motivo').gte('hasta', hoy).limit(2000),
    ]);
    const disponible = !om.error || !sinTabla(om.error.message);
    const clientes = (cl.data ?? []) as ClienteRow[];
    const porUuid = new Map<string, ClienteRecordatorio>();
    const filasCliente = new Map<string, ClienteRow>();
    const porApp = new Map<string, ClienteRow>();
    for (const r of clientes) { filasCliente.set(r.id, r); porApp.set(r.id, r); if (r.airtable_id) porApp.set(r.airtable_id, r); }
    const nodo = (r: ClienteRow): ClienteRecordatorio => { let x = porUuid.get(r.id); if (!x) { x = { clienteId: r.airtable_id ?? r.id, clienteUuid: r.id, nombre: nombreCliente(r) || `NIT ${r.nit ?? ''}`, nit: String(r.nit ?? '').trim(), responsable: r.responsable_cobro || null, contactos: [], facturas: [], promesas: [], gestiones: [], enviados: [], omisiones: [] }; porUuid.set(r.id, x); } return x; };
    for (const f of consolidarParaBusqueda(filas, cobros, ncs, hoy)) {
      if (f.cobrada || f.estado === 'anulada' || f.estado === 'refacturada' || f.saldo <= 0.005 || !f.clienteId) continue;
      const r = porApp.get(f.clienteId); if (!r) continue;
      nodo(r).facturas.push({ noFactura: f.noFactura, facturaId: f.id, saldo: f.saldo, total: f.total, cobrado: f.cobrado, ncs: f.ncs, fechaEmision: f.fechaEmision, fechaVencimiento: f.fechaVencimiento, diasVencida: f.diasVencida, cedida: !!cedidas[f.id] });
    }
    for (const c of (ct.data ?? []) as Array<{ id: string; cliente_id: string; nombre: string; rol: string; correo: string | null; preferido: boolean }>) { const r = filasCliente.get(c.cliente_id); if (r) nodo(r).contactos.push({ id: c.id, nombre: c.nombre, rol: c.rol, correo: String(c.correo ?? '').trim().toLowerCase(), preferido: c.preferido === true }); }
    for (const e of (ev.data ?? []) as FilaEvento[]) {
      const r = filasCliente.get(e.cliente_id); if (!r) continue;
      const x = nodo(r); const facturas = Array.isArray(e.facturas) ? e.facturas.map(String) : [];
      if (e.tipo === 'gestion' && e.resultado) x.gestiones.push({ fecha: e.fecha, resultado: e.resultado as ResultadoGestion, facturas });
      else if (e.tipo === 'promesa' && e.fecha_promesa) x.promesas.push({ id: e.id, fecha: e.fecha_promesa, monto: e.monto == null ? null : Math.round(Number(e.monto) * 100) / 100, estado: (e.promesa_estado as EstadoPromesa) ?? 'pendiente', facturas });
      else if (e.tipo === 'correo_enviado') {
        const d = (e.datos ?? {}) as { tipo?: string; regla?: string; promesaId?: string | null; resultado?: string };
        const regla = d.tipo === 'estado_cuenta' ? 'estado_cuenta' : esRegla(d.regla) ? d.regla : null;
        if (regla) x.enviados.push({ regla, facturas, fecha: e.fecha, promesaId: d.promesaId ?? null, resultado: d.resultado === 'enviado' ? 'enviado' : 'error' } as EnvioPrevio);
      }
    }
    for (const o of (om.data ?? []) as Array<{ cliente_id: string; regla: string; hasta: string; motivo: string | null }>) { const r = filasCliente.get(o.cliente_id); if (r && esRegla(o.regla)) nodo(r).omisiones.push({ regla: o.regla, hasta: o.hasta, motivo: o.motivo ?? '' }); }
    return { hoy, clientes: [...porUuid.values()], porUuid, filasCliente, ms: Date.now() - t0, disponible };
  } catch (e) {
    console.error('cargarRecordatorios:', e instanceof Error ? e.message : String(e));
    return { hoy, clientes: [], porUuid: new Map(), filasCliente: new Map(), ms: Date.now() - t0, disponible: false, error: 'No se pudo cargar la cartera: probá de nuevo.' };
  }
}

/* ───────────── los borradores de hoy ───────────── */

export interface BorradorPreparado extends Borrador { asunto: string; cuerpo: string }
export interface DatosRecordatorios {
  hoy: string; disponible: boolean; correoConfigurado: boolean; remitente: string; misClientes: boolean;
  borradores: BorradorPreparado[]; resumen: ReturnType<typeof resumenBorradores>; reglas: ReglaRecordatorio[]; plantillas: Record<PlantillaClave, Plantilla> | null;
  ms: number; error?: string;
}

function preparar(b: Borrador, reglas: ReglaRecordatorio[], plantillas: Record<PlantillaClave, Plantilla> | null): BorradorPreparado {
  const regla = reglas.find(r => r.clave === b.regla);
  const p = plantillas && esPlantillaClave(regla?.plantillaClave ?? '') ? plantillas[regla!.plantillaClave as PlantillaClave] : plantillas?.[b.regla];
  const datosPago = plantillas?.datos_pago ? renderPlantilla(plantillas.datos_pago.cuerpo, b.vars) : '';
  const vars = { ...b.vars, datos_pago: datosPago };   // {{estado_cuenta}} queda como marcador: la tabla se arma al enviar
  return { ...b, asunto: p ? renderPlantilla(p.asunto, vars) : `Recordatorio de pago · ${b.facturas.join(', ')}`, cuerpo: p ? renderPlantilla(p.cuerpo, vars) : '' };
}

export async function getDatosRecordatorios(opts: { email: string; nombre?: string; rol: string; soloMios?: boolean }): Promise<DatosRecordatorios> {
  const [carga, { reglas, disponible: hayReglas }, plantillas] = await Promise.all([cargarRecordatorios(), getReglas(), getPlantillas()]);
  const emp = empresaConfig();
  const remitente = opts.nombre || opts.email;
  const disponible = carga.disponible && hayReglas && !!plantillas;
  const soloMios = opts.soloMios ?? opts.rol === 'cobranza';
  const visibles = soloMios ? carga.clientes.filter(c => !c.responsable || c.responsable.toLowerCase() === opts.email.toLowerCase()) : carga.clientes;
  const borradores = disponible ? proponerRecordatorios(visibles, reglas, carga.hoy, { nombre: emp.nombre, nit: emp.nit }, remitente).map(b => preparar(b, reglas, plantillas)) : [];
  return { hoy: carga.hoy, disponible, correoConfigurado: correoConfigurado(), remitente, misClientes: soloMios, borradores, resumen: resumenBorradores(borradores), reglas, plantillas, ms: carga.ms, error: carga.error ?? (!disponible && !carga.error ? 'Falta aplicar la migración 035 en esta base: sin reglas ni plantillas no se proponen recordatorios.' : undefined) };
}

/* ───────────── estado de cuenta ───────────── */

async function paquetesDe(nit: string): Promise<PaqueteEC[]> {
  if (!nit) return [];
  try {
    const { listarPaquetes } = await import('./paquetes');
    return (await listarPaquetes(nit)).filter(p => p.estado !== 'cerrado').map(p => ({ correlativo: p.correlativo, nombre: p.nombre, usadas: p.lineas.reduce((s, l) => s + l.usadas, 0), cantidad: p.lineas.reduce((s, l) => s + l.cantidad, 0), remanente: p.lineas.reduce((s, l) => s + l.remanente, 0), venceEn: p.venceEn, estado: p.estado }));
  } catch { return []; }
}

function estadoCuentaDe(c: ClienteRecordatorio, row: ClienteRow | undefined, paquetes: PaqueteEC[], datosPago: string, hoy: string): EstadoCuenta {
  return armarEstadoCuenta({ clienteId: c.clienteId, clienteUuid: c.clienteUuid, nombre: c.nombre, nit: c.nit, diasCredito: Number(row?.dias_credito ?? 0) }, c.facturas, paquetes, datosPago, hoy);
}

export interface DatosEstadoCuenta { ec: EstadoCuenta; contactos: ContactoRecordatorio[]; destinatario: ContactoRecordatorio | null; cc: string[]; asunto: string; cuerpo: string; correoConfigurado: boolean; remitente: string; disponible: boolean }

/** El estado de cuenta de un cliente (id de app, uuid o n-<NIT>) con el correo propuesto para mandarlo. */
export async function getEstadoCuenta(idApp: string, actor: { email: string; nombre?: string }): Promise<DatosEstadoCuenta | null> {
  const uuid = await clienteUuid(idApp); if (!uuid) return null;
  const row = await getClienteRow(uuid); if (!row) return null;
  const [carga, plantillas] = await Promise.all([cargarRecordatorios(), getPlantillas()]);
  const emp = empresaConfig();
  const c = carga.porUuid.get(uuid) ?? { clienteId: row.airtable_id ?? row.id, clienteUuid: uuid, nombre: nombreCliente(row) || `NIT ${row.nit ?? ''}`, nit: String(row.nit ?? '').trim(), responsable: row.responsable_cobro || null, contactos: [], facturas: [], promesas: [], gestiones: [], enviados: [], omisiones: [] };
  if (!carga.porUuid.has(uuid)) { const { data } = await (supabase()!).from('cliente_contacto').select('id, nombre, rol, correo, preferido').eq('cliente_id', uuid).eq('activo', true); c.contactos = ((data ?? []) as Array<{ id: string; nombre: string; rol: string; correo: string | null; preferido: boolean }>).map(x => ({ id: x.id, nombre: x.nombre, rol: x.rol, correo: String(x.correo ?? '').trim().toLowerCase(), preferido: x.preferido === true })); }
  const remitente = actor.nombre || actor.email;
  const vars0 = { cliente: c.nombre, fecha: fechaLarga(carga.hoy), emisor: emp.nombre, nit_emisor: emp.nit, remitente };
  const datosPago = plantillas?.datos_pago ? renderPlantilla(plantillas.datos_pago.cuerpo, vars0) : '';
  const ec = estadoCuentaDe(c, carga.filasCliente.get(uuid) ?? { id: uuid, airtable_id: row.airtable_id, nombre_empresa: row.nombre_empresa, razon_social: row.razon_social, nit: row.nit, dias_credito: row.dias_credito, responsable_cobro: row.responsable_cobro, activo: row.activo }, await paquetesDe(c.nit), datosPago, carga.hoy);
  const { destinatario, posibles } = destinatarioPropuesto(c.contactos);
  const vars = { ...vars0, contacto: destinatario?.nombre ?? 'Estimados', facturas: ec.facturas.map(f => f.noFactura).join(', '), saldo: fmtQ(ec.totales.saldo), datos_pago: datosPago };
  const p = plantillas?.estado_cuenta;
  return { ec, contactos: posibles, destinatario, cc: c.responsable && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.responsable) ? [c.responsable.toLowerCase()] : [], asunto: p ? renderPlantilla(p.asunto, vars) : `Estado de cuenta · ${c.nombre}`, cuerpo: p ? renderPlantilla(p.cuerpo, vars) : '', correoConfigurado: correoConfigurado(), remitente, disponible: !!plantillas };
}

/* ───────────── enviar ───────────── */

export interface EnvioInput { para: string[] | string; cc?: string[] | string; asunto: string; cuerpo: string; forzarMotivo?: string }
export type EnvioResult = { ok: true; eventoId: string | null; modo: 'resend' | 'mock'; para: string[]; detalle: string } | { ok: false; error: string; eventoId?: string | null };

async function despachar(c: ClienteRecordatorio, row: ClienteRow | undefined, hoy: string, envio: { para: string[]; cc: string[]; asunto: string; cuerpo: string; forzarMotivo: string }, vars: Record<string, string>, meta: { tipo: 'recordatorio' | 'estado_cuenta'; regla: ReglaClave | null; promesaId: string | null; facturas: string[]; monto: number; bloqueo: string | null }, actor: { email: string; nombre?: string }): Promise<EnvioResult> {
  const emp = empresaConfig();
  const plantillas = await getPlantillas();
  const datosPago = plantillas?.datos_pago?.cuerpo ?? '';
  const ec = estadoCuentaDe(c, row, await paquetesDe(c.nit), renderPlantilla(datosPago, vars), hoy);
  const remitente = actor.nombre || actor.email;
  const correo = correoCobranza({ asunto: envio.asunto, cuerpo: envio.cuerpo, ec, datosPago, vars, emisor: emp.nombre, remitente });
  const cfg = configCorreo();
  if (!cfg.apiKey && !cfg.mock) return { ok: false, error: 'Correo no configurado en este deploy (falta RESEND_API_KEY): no se puede enviar.' };
  const res = await enviarCorreo({ para: envio.para, cc: envio.cc, respuestaA: actor.email, asunto: correo.asunto, html: correo.html, texto: correo.texto });
  const etiqueta = meta.tipo === 'estado_cuenta' ? 'Estado de cuenta' : `Recordatorio «${({ por_vencer: 'por vencer', vencida: 'vencida', promesa_incumplida: 'promesa incumplida', confirmacion_promesa: 'confirmación de promesa' } as Record<ReglaClave, string>)[meta.regla!]}»`;
  const datos = { tipo: meta.tipo, regla: meta.regla, promesaId: meta.promesaId, para: envio.para, cc: envio.cc, asunto: correo.asunto, cuerpo: correo.texto, modo: res.ok ? res.modo : res.modo, resultado: res.ok ? 'enviado' : 'error', proveedorId: res.ok ? res.id : null, error: res.ok ? null : res.error, forzadoMotivo: envio.forzarMotivo || null, bloqueo: meta.bloqueo, respuestaA: actor.email };
  const comentario = res.ok
    ? `${etiqueta} enviado a ${envio.para.join(', ')}${envio.cc.length ? ` (cc ${envio.cc.join(', ')})` : ''} · «${correo.asunto}»${envio.forzarMotivo ? ` · forzado: ${envio.forzarMotivo}` : ''}${res.modo === 'mock' ? ' · modo prueba' : ''}`
    : `${etiqueta} NO salió (${res.error}) · destinatarios ${envio.para.join(', ')}`;
  const eventoId = await registrarEventoAutomatico({ uuid: c.clienteUuid }, { tipo: 'correo_enviado', comentario, facturas: meta.facturas, monto: meta.monto || null, datos, actor: actor.email });
  if (!res.ok) return { ok: false, error: `El correo no salió: ${res.error}`, eventoId };
  return { ok: true, eventoId, modo: res.modo, para: envio.para, detalle: res.modo === 'mock' ? `Correo armado en modo prueba (sin Resend) para ${envio.para.join(', ')}.` : `Enviado a ${envio.para.join(', ')}${envio.cc.length ? ` con copia a ${envio.cc.join(', ')}` : ''}.` };
}

/** Manda UN recordatorio. El servidor vuelve a calcular el borrador (si ya no aplica, no sale) y vuelve a exigir el motivo si está bloqueado. */
export async function enviarRecordatorio(id: string, input: EnvioInput, actor: { email: string; nombre?: string }): Promise<EnvioResult> {
  const [carga, { reglas, disponible }] = await Promise.all([cargarRecordatorios(), getReglas()]);
  if (!carga.disponible || !disponible) return { ok: false, error: carga.error ?? 'Falta aplicar la migración 035 en esta base.' };
  const emp = empresaConfig();
  const b = proponerRecordatorios(carga.clientes, reglas, carga.hoy, { nombre: emp.nombre, nit: emp.nit }, actor.nombre || actor.email).find(x => x.id === id);
  if (!b) return { ok: false, error: 'Este recordatorio ya no aplica (se cobró, ya se envió o cambió la situación del cliente). Recargá la lista.' };
  const v = validarEnvio(input, !!b.bloqueo); if (!v.ok) return v;
  const c = carga.porUuid.get(b.clienteUuid)!;
  return despachar(c, carga.filasCliente.get(b.clienteUuid), carga.hoy, v.envio, b.vars, { tipo: 'recordatorio', regla: b.regla, promesaId: b.promesa?.id ?? null, facturas: b.facturas, monto: b.monto, bloqueo: b.bloqueo?.tipo ?? null }, actor);
}

/** Manda el estado de cuenta desde la ficha (sin regla: siempre se puede; también queda en el historial). */
export async function enviarEstadoCuenta(idApp: string, input: EnvioInput, actor: { email: string; nombre?: string }): Promise<EnvioResult> {
  const uuid = await clienteUuid(idApp); if (!uuid) return { ok: false, error: 'El cliente no existe.' };
  const v = validarEnvio(input, false); if (!v.ok) return v;
  const carga = await cargarRecordatorios();
  if (carga.error) return { ok: false, error: carga.error };
  const row = carga.filasCliente.get(uuid);
  const c = carga.porUuid.get(uuid) ?? (row ? { clienteId: row.airtable_id ?? row.id, clienteUuid: uuid, nombre: nombreCliente(row) || `NIT ${row.nit ?? ''}`, nit: String(row.nit ?? '').trim(), responsable: row.responsable_cobro || null, contactos: [], facturas: [], promesas: [], gestiones: [], enviados: [], omisiones: [] } : null);
  if (!c) return { ok: false, error: 'El cliente no existe.' };
  const emp = empresaConfig();
  const saldo = c.facturas.filter(f => !f.cedida).reduce((s, f) => s + f.saldo, 0);
  const vars = { cliente: c.nombre, contacto: c.contactos.find(x => v.envio.para.includes(x.correo))?.nombre ?? 'Estimados', facturas: c.facturas.filter(f => !f.cedida).map(f => f.noFactura).join(', '), saldo: fmtQ(saldo), fecha: fechaLarga(carga.hoy), emisor: emp.nombre, nit_emisor: emp.nit, remitente: actor.nombre || actor.email, fecha_vencimiento: '—', dias_vencida: '0', fecha_promesa: '—', monto_promesa: fmtQ(saldo) };
  return despachar(c, row, carga.hoy, v.envio, vars, { tipo: 'estado_cuenta', regla: null, promesaId: null, facturas: c.facturas.filter(f => !f.cedida).map(f => f.noFactura), monto: Math.round(saldo * 100) / 100, bloqueo: null }, actor);
}

/** «Omitir hasta»: el borrador de esa regla para ese cliente no se propone hasta la fecha (queda quién y por qué). */
export async function omitirRecordatorio(clienteUuid: string, regla: string, hasta: string, motivo: string, actor: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
  if (!esUuid(clienteUuid)) return { ok: false, error: 'El cliente no existe.' };
  if (!esRegla(regla)) return { ok: false, error: 'La regla no existe.' };
  const hoy = obtenerFechaHoyGuatemala();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hasta) || hasta < hoy) return { ok: false, error: 'Elegí hasta qué fecha omitirlo (hoy o después).' };
  const m = String(motivo ?? '').trim().slice(0, 300);
  if (m.length < 3) return { ok: false, error: 'Contá por qué se omite.' };
  const { error } = await sb.from('cobranza_recordatorio_omision').insert({ cliente_id: clienteUuid, regla, hasta, motivo: m, creado_por: actor });
  if (error) return { ok: false, error: sinTabla(error.message) ? 'Falta aplicar la migración 035 en esta base.' : error.message };
  return { ok: true };
}
