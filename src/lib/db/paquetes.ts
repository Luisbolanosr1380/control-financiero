/**
 * PAQUETES PREPAGADOS (034) — capa de datos (servidor). Todo pasa por las RPC de la 034: crear (aplica los consumos del
 * cliente en la misma transacción), editar, cerrar, confirmar la aplicación retroactiva, vista previa, resumen y detalle.
 * `aplicarPaquetes` es lo que el sync / webhook / re-resolver llaman después de sincronizar las pruebas (fail-soft: sin la
 * 034 no rompe nada). Nunca se escribe un consumo desde acá: los decide paquete_aplicar_consumos.
 */
import { supabase } from '@/lib/supabase/client';
import { rpc, uuidRequerido } from '@/lib/supabase/writes';
import { nitComparable } from '@/lib/clientes/nit';
import { getClientes } from './clientes';
import { parseConsumo, parsePaquete, type Paquete, type PaqueteDetalle } from '@/lib/paquetes/paquete';

const sinTabla = (m: string) => /paquete/i.test(m) && /(does not exist|schema cache|not find)/i.test(m);

export async function paquetesDisponibles(): Promise<boolean> {
  const sb = supabase(); if (!sb) return false;
  const { error } = await sb.from('paquete').select('id', { count: 'exact', head: true });
  return !error;
}

/** Paquetes de un NIT (o todos), del más nuevo al más viejo, con líneas, usadas y remanente. [] sin la 034. */
export async function listarPaquetes(nit?: string | null): Promise<Paquete[]> {
  const sb = supabase(); if (!sb) return [];
  const { data, error } = await sb.rpc('paquete_resumen', { p_nit: nit ? nitComparable(nit) : null });
  if (error) { if (!sinTabla(error.message)) console.error('paquete_resumen:', error.message); return []; }
  return (Array.isArray(data) ? data : []).map(parsePaquete);
}

/** Paquetes vigentes por NIT (activo / agotado / vencido: los que la pantalla debe mostrar), para banners y badges. */
export async function paquetesPorNit(): Promise<Map<string, Paquete[]>> {
  const m = new Map<string, Paquete[]>();
  for (const p of await listarPaquetes()) { if (p.estado === 'cerrado') continue; m.set(p.nit, [...(m.get(p.nit) ?? []), p]); }
  return m;
}

export async function getPaqueteDetalle(id: string): Promise<PaqueteDetalle | null> {
  const sb = supabase(); if (!sb || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await sb.rpc('paquete_detalle', { p_id: id });
  if (error) { if (!sinTabla(error.message)) console.error('paquete_detalle:', error.message); return null; }
  const r = (data ?? {}) as { paquete?: unknown; consumos?: unknown[] };
  if (!r.paquete) return null;
  return { paquete: parsePaquete(r.paquete), consumos: (Array.isArray(r.consumos) ? r.consumos : []).map(parseConsumo) };
}

export interface LineaInput { servicio: string; categoria: string; territorio?: string | null; cantidad: number; precioUnitario: number }
export interface CrearPaqueteInput {
  nit: string; nombre: string; fechaInicio: string; venceEn?: string | null; umbralAviso?: number | null; noFactura?: string | null; notas?: string | null;
  /** la vista previa se confirmó: las pruebas ya terminadas desde fecha_inicio se descuentan */ retroactivoConfirmado?: boolean;
  lineas: LineaInput[];
}
export interface AplicadoPaquetes { consumidos: number; revertidos: number; avisos: Array<{ correlativo: string; aviso: 'por_agotarse' | 'agotado'; remanente: number }>; clientes: number }
export type CrearPaqueteResult = { ok: true; id: string; correlativo: string; aplicado: AplicadoPaquetes } | { ok: false; error: string };

const parseAplicado = (raw: unknown): AplicadoPaquetes => {
  const r = (raw ?? {}) as Record<string, unknown>;
  return { consumidos: Number(r.consumidos ?? 0), revertidos: Number(r.revertidos ?? 0), clientes: Number(r.clientes ?? 0), avisos: (Array.isArray(r.avisos) ? r.avisos : []).map(a => { const x = a as Record<string, unknown>; return { correlativo: String(x.correlativo ?? ''), aviso: (x.aviso === 'agotado' ? 'agotado' : 'por_agotarse') as 'agotado' | 'por_agotarse', remanente: Number(x.remanente ?? 0) }; }) };
};

const ERRORES: Array<[RegExp, string]> = [
  [/PAQUETE_SIN_NIT/, 'El paquete necesita el NIT del cliente.'], [/PAQUETE_SIN_NOMBRE/, 'Ponele un nombre al paquete.'], [/PAQUETE_SIN_FECHA_INICIO/, 'La fecha de inicio es requerida.'],
  [/PAQUETE_VENCE_ANTES_DE_INICIAR/, 'El vencimiento no puede ser anterior a la fecha de inicio.'], [/PAQUETE_SIN_LINEAS/, 'Agregá al menos una línea (servicio, categoría y cantidad).'],
  [/PAQUETE_LINEA_SIN_CANTIDAD/, 'Cada línea necesita una cantidad mayor a 0.'], [/PAQUETE_LINEA_SIN_SERVICIO/, 'Cada línea necesita un servicio.'], [/PAQUETE_LINEA_SIN_CATEGORIA/, 'Cada línea necesita una categoría (o UNICA).'],
  [/PAQUETE_LINEA_PRECIO_NEGATIVO/, 'El precio unitario no puede ser negativo.'], [/PAQUETE_NO_EXISTE/, 'El paquete no existe.'], [/PAQUETE_CERRADO/, 'El paquete está cerrado: no se edita ni se vuelve a aplicar.'],
];
const mensaje = (e: unknown): string => { const m = e instanceof Error ? e.message : String(e); for (const [re, t] of ERRORES) if (re.test(m)) return t; return sinTabla(m) ? 'Falta la migración 034 (paquetes prepagados) en esta base.' : m; };

async function clienteUuidPorNit(nit: string): Promise<string | null> {
  const k = nitComparable(nit);
  const c = (await getClientes()).filter(x => nitComparable(x.nit) === k).sort((a, b) => Number(b.activo !== false) - Number(a.activo !== false))[0];
  if (!c) return null;
  try { return await uuidRequerido('clientes', c.id, 'paquete (cliente)'); } catch { return null; }
}

export async function crearPaquete(input: CrearPaqueteInput, actor: string): Promise<CrearPaqueteResult> {
  if (!supabase()) return { ok: false, error: 'Supabase no está configurado.' };
  const nit = nitComparable(input.nit);
  if (!nit) return { ok: false, error: 'NIT inválido.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fechaInicio)) return { ok: false, error: 'La fecha de inicio debe ser AAAA-MM-DD.' };
  if (input.venceEn && !/^\d{4}-\d{2}-\d{2}$/.test(input.venceEn)) return { ok: false, error: 'El vencimiento debe ser AAAA-MM-DD.' };
  if (!input.lineas?.length) return { ok: false, error: 'Agregá al menos una línea.' };
  try {
    const r = await rpc<{ id: string; correlativo: string; aplicado: unknown }>('paquete_crear', {
      p_actor: actor,
      p_paquete: { nit, cliente_id: await clienteUuidPorNit(nit), nombre: input.nombre.trim(), fecha_inicio: input.fechaInicio, vence_en: input.venceEn || null, umbral_aviso: input.umbralAviso ?? null, no_factura: input.noFactura?.trim() || null, notas: input.notas?.trim() || null, retroactivo_confirmado: !!input.retroactivoConfirmado },
      p_lineas: input.lineas.map(l => ({ servicio: l.servicio, categoria: l.categoria || 'UNICA', territorio: l.territorio || null, cantidad: Math.round(l.cantidad), precio_unitario: Math.round((l.precioUnitario || 0) * 100) / 100 })),
    });
    return { ok: true, id: r.id, correlativo: r.correlativo, aplicado: parseAplicado(r.aplicado) };
  } catch (e) { return { ok: false, error: mensaje(e) }; }
}

export type PaqueteResult = { ok: true; paquete: Paquete } | { ok: false; error: string };
export async function editarPaquete(id: string, cambios: { nombre?: string; umbralAviso?: number; noFactura?: string | null; notas?: string | null; venceEn?: string | null }, actor: string): Promise<PaqueteResult> {
  try {
    const p: Record<string, unknown> = {};
    if (cambios.nombre !== undefined) p.nombre = cambios.nombre;
    if (cambios.umbralAviso !== undefined) p.umbral_aviso = cambios.umbralAviso;
    if (cambios.noFactura !== undefined) p.no_factura = cambios.noFactura;
    if (cambios.notas !== undefined) p.notas = cambios.notas;
    if (cambios.venceEn !== undefined) { if (cambios.venceEn && !/^\d{4}-\d{2}-\d{2}$/.test(cambios.venceEn)) return { ok: false, error: 'El vencimiento debe ser AAAA-MM-DD.' }; p.vence_en = cambios.venceEn || null; }
    await rpc('paquete_editar', { p_actor: actor, p_id: id, p_cambios: p });
    const paquete = (await listarPaquetes()).find(x => x.id === id);
    return paquete ? { ok: true, paquete } : { ok: false, error: 'El paquete no existe.' };
  } catch (e) { return { ok: false, error: mensaje(e) }; }
}
export async function cerrarPaquete(id: string, motivo: string, actor: string): Promise<PaqueteResult> {
  if (!motivo.trim()) return { ok: false, error: 'Decí por qué se cierra el paquete.' };
  try {
    await rpc('paquete_cerrar', { p_actor: actor, p_id: id, p_motivo: motivo.trim() });
    const paquete = (await listarPaquetes()).find(x => x.id === id);
    return paquete ? { ok: true, paquete } : { ok: false, error: 'El paquete no existe.' };
  } catch (e) { return { ok: false, error: mensaje(e) }; }
}
export async function confirmarRetroactivo(id: string, actor: string): Promise<{ ok: true; aplicado: AplicadoPaquetes } | { ok: false; error: string }> {
  try { const r = await rpc<unknown>('paquete_confirmar_retroactivo', { p_actor: actor, p_id: id }); return { ok: true, aplicado: parseAplicado(r) }; }
  catch (e) { return { ok: false, error: mensaje(e) }; }
}

export interface VistaPreviaLinea { n: number; servicio: string; categoria: string; territorio: string | null; cantidad: number; candidatas: number; tomaria: number; pruebas: Array<{ componenteId: string; persona: string; solicitante: string; idExterno: string; fecha: string; resultado: string; servicio: string; categoria: string; territorio: string }> }
/** Pruebas ya terminadas y sin facturar desde fecha_inicio que descontaría cada línea (solo lectura). */
export async function vistaPreviaPaquete(nit: string, fechaInicio: string, venceEn: string | null, lineas: LineaInput[]): Promise<VistaPreviaLinea[]> {
  const sb = supabase(); if (!sb) return [];
  const { data, error } = await sb.rpc('paquete_vista_previa', { p_nit: nitComparable(nit), p_fecha_inicio: fechaInicio, p_vence_en: venceEn || null, p_lineas: lineas.map(l => ({ servicio: l.servicio, categoria: l.categoria || 'UNICA', territorio: l.territorio || null, cantidad: Math.round(l.cantidad) })) });
  if (error) { if (!sinTabla(error.message)) console.error('paquete_vista_previa:', error.message); return []; }
  return (Array.isArray(data) ? data : []).map(x => { const r = x as Record<string, unknown>; return { n: Number(r.n ?? 0), servicio: String(r.servicio ?? ''), categoria: String(r.categoria ?? ''), territorio: r.territorio ? String(r.territorio) : null, cantidad: Number(r.cantidad ?? 0), candidatas: Number(r.candidatas ?? 0), tomaria: Number(r.tomaria ?? 0), pruebas: (Array.isArray(r.pruebas) ? r.pruebas : []).map(p => { const q = p as Record<string, unknown>; return { componenteId: String(q.componente_id ?? ''), persona: String(q.persona ?? ''), solicitante: String(q.solicitante ?? ''), idExterno: String(q.id_externo ?? ''), fecha: String(q.fecha ?? '').slice(0, 10), resultado: String(q.resultado ?? ''), servicio: String(q.servicio ?? ''), categoria: String(q.categoria ?? ''), territorio: String(q.territorio ?? '') }; }) }; });
}

/** Descuenta / revierte según el estado actual de las pruebas (la RPC decide). Fail-soft: sin la 034 devuelve null y no rompe el sync. */
export async function aplicarPaquetes(nit?: string | null, actor = 'sistema'): Promise<AplicadoPaquetes | null> {
  const sb = supabase(); if (!sb) return null;
  const { data, error } = await sb.rpc('paquete_aplicar_consumos', { p_nit: nit ? nitComparable(nit) : null, p_fuente: 'agenda', p_hoy: null, p_actor: actor });
  if (error) { if (!sinTabla(error.message)) console.error('paquete_aplicar_consumos:', error.message); return null; }
  return parseAplicado(data);
}

export interface FacturaAnticipo { noFactura: string; fechaEmision: string; total: number; clienteId: string | null; cliente: string; facturaAppId: string | null }
/** Busca la factura del anticipo por número exacto (consolidando las líneas): para enlazarla al paquete. */
export async function buscarFacturaAnticipo(numero: string): Promise<FacturaAnticipo | null> {
  const sb = supabase(); const nf = numero.trim(); if (!sb || !nf) return null;
  const { data, error } = await sb.from('facturas_clientes').select('no_factura, airtable_id, fecha_emision, total, estado, cliente:clientes(airtable_id, nombre_empresa, razon_social)').eq('no_factura', nf).order('total', { ascending: false });
  if (error || !data?.length) return null;
  const vivas = (data as unknown as Array<{ no_factura: string; airtable_id: string | null; fecha_emision: string | null; total: number | string | null; estado: string | null; cliente: { airtable_id: string | null; nombre_empresa: string | null; razon_social: string | null } | null }>).filter(r => !/ANULAD|REFACTURAD/i.test(String(r.estado ?? '')));
  if (!vivas.length) return null;
  const p = vivas[0];
  return { noFactura: p.no_factura, fechaEmision: String(p.fecha_emision ?? '').slice(0, 10), total: Math.round(vivas.reduce((s, r) => s + Number(r.total ?? 0), 0) * 100) / 100, clienteId: p.cliente?.airtable_id ?? null, cliente: String(p.cliente?.nombre_empresa || p.cliente?.razon_social || ''), facturaAppId: p.airtable_id };
}
