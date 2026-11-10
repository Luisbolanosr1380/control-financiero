// ============================================================
// F-COBRANZA → CENTRO DE COBROS (033): capa de compatibilidad.
//
// La bitácora vieja (gestiones_cobro + gestion_facturas) se migró al
// historial unificado `cobranza_evento` (migración 033). Estas funciones
// conservan la forma que usan Pendientes y la tool de Auros, pero leen y
// escriben SOLO en el historial nuevo: no quedan dos formas de registrar.
// ============================================================

import { supabase } from '../supabase/client';
import { diasEntre, sumarDias, type CanalCobranza } from '@/lib/cobranza/estado';
import { clienteUuid, getEventos, getResumenCobranza, registrarGestion, type ResumenCobranza } from './cobranza';
import { obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';

export const CANALES_GESTION = ['Llamada', 'WhatsApp', 'Email', 'Visita', 'Otro'] as const;
export type CanalGestion = (typeof CANALES_GESTION)[number];
const CANAL_NUEVO: Record<CanalGestion, CanalCobranza> = { Llamada: 'llamada', WhatsApp: 'whatsapp', Email: 'correo', Visita: 'visita', Otro: 'nota' };
const CANAL_VIEJO: Record<CanalCobranza, CanalGestion> = { llamada: 'Llamada', whatsapp: 'WhatsApp', correo: 'Email', visita: 'Visita', reunion: 'Visita', nota: 'Otro' };

export interface GestionCobro {
  id: string; custId: string; fechaGestion: string; usuario: string; canal: CanalGestion; contactoCliente?: string; comentario: string;
  fechaPagoPromesa?: string; proximoSeguimiento?: string; facturas: Array<{ facturaId: string; noFactura: string; fechaPromesa?: string }>; createdAt: string;
}
export interface CrearGestionCobroInput {
  custId: string; usuario: string; canal: CanalGestion; contactoCliente?: string; comentario: string; fechaGestion?: string; fechaPagoPromesa?: string; proximoSeguimiento?: string;
  facturas?: Array<{ facturaId: string; fechaPromesa?: string }>;
}
export type CrearGestionCobroResult = { ok: true; gestionId: string; mensaje: string } | { ok: false; error: string };
export type ResumenGestiones = ResumenCobranza;

/** Registra en el historial nuevo. La promesa (general o por factura) va como evento `promesa`; sin seguimiento → en 7 días (la regla de oro lo exige). */
export async function crearGestionCobro(input: CrearGestionCobroInput): Promise<CrearGestionCobroResult> {
  const comentario = (input.comentario ?? '').trim();
  if (!comentario) return { ok: false, error: 'El comentario es requerido — es el corazón de la bitácora.' };
  if (!input.custId) return { ok: false, error: 'Cliente requerido.' };
  if (!(CANALES_GESTION as readonly string[]).includes(input.canal)) return { ok: false, error: `Canal inválido: "${input.canal}".` };
  const hoy = obtenerFechaHoyGuatemala();
  // facturas: ids de app (línea principal) → número de factura
  const facturas: string[] = [];
  const sb = supabase();
  if (sb && input.facturas?.length) {
    const { data } = await sb.from('facturas_clientes').select('airtable_id, no_factura').in('airtable_id', input.facturas.map(f => f.facturaId));
    for (const r of (data ?? []) as { airtable_id: string; no_factura: string | null }[]) if (r.no_factura) facturas.push(r.no_factura.trim());
  }
  const promesa = input.facturas?.find(f => f.fechaPromesa)?.fechaPromesa ?? input.fechaPagoPromesa ?? null;
  const r = await registrarGestion(input.custId, {
    canal: CANAL_NUEVO[input.canal], resultado: promesa ? 'promesa' : 'contactado', comentario, contactoTexto: input.contactoCliente?.trim() ?? '', facturas,
    promesaFecha: promesa, promesaMonto: null, proximoSeguimiento: input.proximoSeguimiento || (promesa ? sumarDias(promesa, 1) : sumarDias(hoy, 7)), fecha: input.fechaGestion ?? null,
  }, input.usuario.toLowerCase().trim());
  return r.ok ? { ok: true, gestionId: r.gestionId, mensaje: 'Gestión registrada en el historial de cobranza.' } : r;
}

/** Histórico de gestiones de un cliente (forma vieja) desde el historial nuevo. */
export async function getGestionesCliente(custId: string): Promise<GestionCobro[]> {
  const uuid = await clienteUuid(custId); if (!uuid) return [];
  const eventos = await getEventos(uuid);
  return eventos.filter(e => e.tipo === 'gestion').map(e => {
    const promesa = eventos.find(p => p.tipo === 'promesa' && p.gestionId === e.id);
    return {
      id: e.id, custId, fechaGestion: e.fecha.slice(0, 10), usuario: e.creadoPor, canal: CANAL_VIEJO[e.canal ?? 'nota'], contactoCliente: e.contactoNombre || e.contactoTexto || undefined,
      comentario: e.comentario, fechaPagoPromesa: promesa?.fechaPromesa ?? undefined, proximoSeguimiento: e.proximoSeguimiento ?? undefined,
      facturas: e.facturas.map(nf => ({ facturaId: nf, noFactura: nf, fechaPromesa: promesa?.fechaPromesa ?? undefined })), createdAt: e.fecha,
    };
  });
}

/** Todas las gestiones (tool de Auros), más reciente primero. */
export async function getGestionesCobro(): Promise<GestionCobro[]> {
  const sb = supabase(); if (!sb) return [];
  const [{ data: evs }, { data: cls }] = await Promise.all([
    sb.from('cobranza_evento').select('*, contacto:cliente_contacto(nombre)').in('tipo', ['gestion', 'promesa']).order('fecha', { ascending: false }).limit(2000),
    sb.from('clientes').select('id, airtable_id').limit(5000),
  ]);
  const app = new Map(((cls ?? []) as { id: string; airtable_id: string | null }[]).map(c => [c.id, c.airtable_id ?? c.id]));
  const rows = (evs ?? []) as Record<string, unknown>[];
  const promesaDe = new Map(rows.filter(r => r.tipo === 'promesa' && r.gestion_id).map(r => [String(r.gestion_id), String(r.fecha_promesa ?? '')]));
  return rows.filter(r => r.tipo === 'gestion').map(r => ({
    id: String(r.id), custId: app.get(String(r.cliente_id)) ?? String(r.cliente_id), fechaGestion: String(r.fecha).slice(0, 10), usuario: String(r.creado_por ?? ''), canal: CANAL_VIEJO[(r.canal as CanalCobranza) ?? 'nota'],
    contactoCliente: String((r.contacto as { nombre?: string } | null)?.nombre || r.contacto_texto || '') || undefined, comentario: String(r.comentario ?? ''), fechaPagoPromesa: promesaDe.get(String(r.id)) || undefined,
    proximoSeguimiento: (r.proximo_seguimiento as string | null) ?? undefined, facturas: (Array.isArray(r.facturas) ? r.facturas.map(String) : []).map(nf => ({ facturaId: nf, noFactura: nf })), createdAt: String(r.fecha),
  }));
}

/** Resumen por cliente (id de app) y por NÚMERO de factura para /facturacion/pendientes. */
export async function getResumenGestiones(): Promise<ResumenGestiones> { return getResumenCobranza(); }

export const _diasEntre = diasEntre;
