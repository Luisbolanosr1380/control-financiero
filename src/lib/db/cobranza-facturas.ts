/**
 * SEGUIMIENTO DE COBRO A LA VISTA (Facturación) · loaders. Solo LEE cobranza_evento, cliente_contacto, clientes y la
 * cartera abierta (getFacturasPendientesCobro, la misma de Cobros → Pendientes). Nunca escribe facturas ni cobros.
 *
 *  - getCarteraConSeguimiento(): toda la cartera abierta (todos los meses) con el estado de cobro, el badge, la promesa
 *    y la última nota de cada factura, con UNA consulta de cobranza para toda la página (los eventos de gestión, promesa
 *    y correo con el id de app del cliente embebido). Nada por fila.
 *  - getSeguimientoFactura(): lo que muestra la sección «Seguimiento de cobro» de /facturacion/[id].
 * Las reglas viven en src/lib/cobranza/seguimiento.ts (puro) y src/lib/cobranza/estado.ts (espejo del SQL 033).
 */
import { supabase } from '@/lib/supabase/client';
import { obtenerFechaHoyGuatemala } from '@/lib/utils/fechas';
import { getFacturasPendientesCobro, type FacturaPendiente } from './facturas-pendientes';
import { clienteUuid, getClienteRow, getContactos, getEventos, nombreCliente, type ContactoCobro, type EventoCobranza } from './cobranza';
import { kpiPromesasSemana, seguimientoDe, seguimientosPorFactura, type EventoLite, type SeguimientoFactura } from '@/lib/cobranza/seguimiento';
import type { CanalCobranza, EstadoPromesa, ResultadoGestion, TipoEvento } from '@/lib/cobranza/estado';
import type { Invoice } from '@/lib/types';

export const TIPOS_SEGUIMIENTO: TipoEvento[] = ['gestion', 'promesa', 'correo_enviado', 'correo_recibido', 'correo_copiado'];
const SELECT_LITE = 'id, cliente_id, tipo, fecha, canal, resultado, comentario, facturas, monto, fecha_promesa, promesa_estado, proximo_seguimiento, seguimiento_hecho_en, creado_por, contacto_texto, cliente:clientes(airtable_id), contacto:cliente_contacto(nombre)';

type FilaLite = { id: string; cliente_id: string; tipo: string; fecha: string; canal: string | null; resultado: string | null; comentario: string | null; facturas: string[] | null; monto: number | string | null; fecha_promesa: string | null; promesa_estado: string | null; proximo_seguimiento: string | null; seguimiento_hecho_en: string | null; creado_por: string | null; contacto_texto: string | null; cliente: { airtable_id: string | null } | null; contacto: { nombre: string | null } | null };

/** Los eventos de cobranza que pesan en la columna, en UNA consulta. La llave del cliente es su id de app (el mismo `custId` de la cartera). */
export async function getEventosParaCartera(): Promise<{ eventos: EventoLite[]; ms: number; error?: string }> {
  const sb = supabase(); if (!sb) return { eventos: [], ms: 0 };
  const t0 = Date.now();
  const { data, error } = await sb.from('cobranza_evento').select(SELECT_LITE).in('tipo', TIPOS_SEGUIMIENTO).order('fecha', { ascending: false }).limit(5000);
  const ms = Date.now() - t0;
  if (error) { console.error('cobranza_evento (cartera):', error.message); return { eventos: [], ms, error: error.message }; }
  const eventos = ((data ?? []) as unknown as FilaLite[]).map((r): EventoLite => ({
    id: String(r.id), clienteUuid: r.cliente?.airtable_id ?? String(r.cliente_id), tipo: r.tipo as TipoEvento, fecha: String(r.fecha), facturas: Array.isArray(r.facturas) ? r.facturas.map(String) : [],
    canal: (r.canal as CanalCobranza | null) ?? null, resultado: (r.resultado as ResultadoGestion | null) ?? null, comentario: String(r.comentario ?? ''), contactoNombre: String(r.contacto?.nombre ?? ''), contactoTexto: String(r.contacto_texto ?? ''), creadoPor: String(r.creado_por ?? ''),
    monto: r.monto == null ? null : Math.round(Number(r.monto) * 100) / 100, fechaPromesa: r.fecha_promesa, promesaEstado: (r.promesa_estado as EstadoPromesa | null) ?? null, proximoSeguimiento: r.proximo_seguimiento, seguimientoHechoEn: r.seguimiento_hecho_en,
  }));
  return { eventos, ms };
}

export interface FilaCartera extends FacturaPendiente { seguimiento: SeguimientoFactura }
export interface CarteraConSeguimiento {
  hoy: string; filas: FilaCartera[]; kpiPromesas: { n: number; monto: number };
  /** tiempos medidos (para el PR y el validador de rendimiento) */ ms: { cartera: number; cobranza: number; total: number }; consultasCobranza: number; error?: string;
}

/** Toda la cartera abierta con su seguimiento. Una consulta de cobranza para toda la página. */
export async function getCarteraConSeguimiento(): Promise<CarteraConSeguimiento> {
  const t0 = Date.now();
  const hoy = obtenerFechaHoyGuatemala();
  const [pend, ev] = await Promise.all([getFacturasPendientesCobro().then(p => ({ p, ms: Date.now() - t0 })), getEventosParaCartera()]);
  const segs = seguimientosPorFactura(pend.p.filas.map(f => ({ ...f, clienteUuid: f.custId, cobrada: false, parcial: f.esParcial })), ev.eventos, hoy);
  const filas: FilaCartera[] = pend.p.filas.map(f => ({ ...f, seguimiento: segs[f.noFactura] }));
  const saldos = Object.fromEntries(filas.map(f => [f.noFactura, f.saldo]));
  return { hoy, filas, kpiPromesas: kpiPromesasSemana(segs, saldos, hoy), ms: { cartera: pend.ms, cobranza: ev.ms, total: Date.now() - t0 }, consultasCobranza: 1, error: ev.error };
}

/* ───────────── la sección de la factura ───────────── */

export interface SeguimientoDeFactura {
  hoy: string; noFactura: string; clienteId: string; clienteUuid: string; clienteNombre: string; responsable: string; diasCredito: number; saldo: number;
  seguimiento: SeguimientoFactura; contactos: ContactoCobro[]; contactoPreferido: ContactoCobro | null;
  /** eventos que nombran esta factura (del más nuevo al más viejo) y los generales del cliente (sin facturas) */ eventosFactura: EventoCobranza[]; eventosCliente: EventoCobranza[];
}

export async function getSeguimientoFactura(inv: Invoice, saldo: number): Promise<SeguimientoDeFactura | null> {
  try {
    const uuid = await clienteUuid(inv.custId); if (!uuid) return null;
    const [row, eventos, contactos] = await Promise.all([getClienteRow(uuid), getEventos(uuid), getContactos(uuid)]);
    if (!row) return null;
    const hoy = obtenerFechaHoyGuatemala();
    const viva = inv.estadoBruto !== 'anulado' && inv.estadoBruto !== 'refacturado';
    const seg = seguimientoDe({ noFactura: inv.noFactura, clienteUuid: uuid, fechaEmision: inv.fechaEmision ?? '', diasCredito: Number(row.dias_credito ?? 0), cobrada: inv.estadoBruto === 'cobrado' || (viva && saldo <= 0), parcial: inv.estadoBruto === 'cobrado_parcial', viva }, eventos.filter(e => TIPOS_SEGUIMIENTO.includes(e.tipo)), hoy);
    const pref = contactos.find(c => c.preferido) ?? contactos[0] ?? null;
    return {
      hoy, noFactura: inv.noFactura, clienteId: row.airtable_id ?? row.id, clienteUuid: uuid, clienteNombre: nombreCliente(row), responsable: String(row.responsable_cobro ?? ''), diasCredito: Number(row.dias_credito ?? 0), saldo,
      seguimiento: seg, contactos, contactoPreferido: pref,
      eventosFactura: eventos.filter(e => e.facturas.includes(inv.noFactura)), eventosCliente: eventos.filter(e => e.facturas.length === 0),
    };
  } catch (e) { console.error('getSeguimientoFactura:', e instanceof Error ? e.message : String(e)); return null; }
}
