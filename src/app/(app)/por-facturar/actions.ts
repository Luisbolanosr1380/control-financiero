'use server';

import { revalidatePath } from 'next/cache';
import { autorizar, exigir } from '@/lib/auth/guard';
import { anularDetalle, crearDetalle, facturarDetalle, marcarAprobada, marcarEnviada, type DetalleResult, type FacturarDetalleResult, editarEncabezadoDetalle, quitarLineaDetalle, responderNotaDetalle } from '@/lib/db/detalle-facturacion';
import { emitirLinkDetalle, revocarLinkDetalle, type EmitirLinkResult } from '@/lib/db/detalle-link';
import { headers } from 'next/headers';
import type { CanalAprobacion } from '@/lib/facturacion-agenda/detalle';
import {
  empresasSinMapear, guardarMapeo, guardarMapeoLote, marcarNoFactura, marcarNoFacturaLote, quitarNoFactura, reintentarWriteback, reresolverPrecios, sincronizarAgenda,
  type EmpresaRef, type LoteResult, type NoFacturaResult, type PaginaSinMapear, type EmitirResult, type MapeoResult, type ReresolverResult, type ResultadoSync, type WritebackResultado,
} from '@/lib/db/facturacion-agenda';

function revalidar() {
  revalidatePath('/por-facturar', 'layout');
  revalidatePath('/facturacion', 'layout');
  revalidatePath('/dashboard');
  revalidatePath('/clientes');
}

/** FACTURACIÓN AGENDA: traer de la Agenda, mapear clientes, facturar y reintentar el write-back = 'facturar_agenda' (admin y contador). */
export async function sincronizarAgendaAction(): Promise<ResultadoSync> {
  const permiso = await autorizar('facturar_agenda');
  if (!permiso.ok) return { ok: false, leidos: 0, paginas: 0, hasta: null, reclasificados: 0, error: permiso.error };
  const r = await sincronizarAgenda({ actor: permiso.email });
  revalidatePath('/por-facturar', 'layout');
  return r;
}

/**
 * "Re-resolver precios": vuelve a clasificar la cola LOCAL contra el mapeo y el tarifario
 * actuales, sin ir a la Agenda (más liviano que "Traer ahora", que hace el sync completo).
 */
export async function reresolverPreciosAction(): Promise<ReresolverResult> {
  const permiso = await autorizar('facturar_agenda');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await reresolverPrecios();
  if (r.ok) revalidatePath('/por-facturar', 'layout');
  return r;
}

export async function mapearClienteAction(input: { empresaIdExterno: string; empresaNombreExterno?: string; clienteAppId: string }): Promise<MapeoResult> {
  const permiso = await autorizar('facturar_agenda');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await guardarMapeo(input, permiso.email);
  if (r.ok) revalidatePath('/por-facturar', 'layout');
  return r;
}

/** 019/024: generar el DETALLE (pre-liquidación) en borrador con las PRUEBAS seleccionadas; las reserva. */
export async function crearDetalleAction(input: { idsExternos?: string[]; componenteIds?: string[]; notas?: string; /** 028 */ titulo?: string; dirigidoA?: string }): Promise<DetalleResult> {
  const permiso = await autorizar('facturar_agenda');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await crearDetalle(input, permiso.email);
  if (r.ok) revalidatePath('/por-facturar', 'layout');
  return r;
}

/** borrador → enviada (se mandó al cliente). */
export async function marcarEnviadaAction(id: string): Promise<DetalleResult> {
  const permiso = await autorizar('facturar_agenda');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await marcarEnviada(id, permiso.email);
  if (r.ok) revalidatePath('/por-facturar', 'layout');
  return r;
}

/** 028: título del corte y "dirigido a" del detalle (editable mientras no esté facturado ni anulado). */
export async function editarEncabezadoDetalleAction(id: string, input: { titulo?: string | null; dirigidoA?: string | null }): Promise<DetalleResult> {
  const permiso = await autorizar('facturar_agenda');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await editarEncabezadoDetalle(id, input, permiso.email);
  if (r.ok) revalidatePath('/por-facturar', 'layout');
  return r;
}

/** enviada → aprobada: quién aprobó del lado del cliente y por qué canal. */
export async function marcarAprobadaAction(id: string, input: { aprobadoPor: string; canal?: CanalAprobacion }): Promise<DetalleResult> {
  const permiso = await autorizar('facturar_agenda');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await marcarAprobada(id, input, permiso.email);
  if (r.ok) revalidatePath('/por-facturar', 'layout');
  return r;
}

/** Anula el detalle y libera sus expedientes (vuelven a la cola). */
export async function anularDetalleAction(id: string, motivo: string): Promise<DetalleResult> {
  const permiso = await autorizar('facturar_agenda');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await anularDetalle(id, motivo, permiso.email);
  if (r.ok) revalidatePath('/por-facturar', 'layout');
  return r;
}

/** aprobada → facturada: emite la factura (número y fecha reales de SAT/FEL) y escribe el cobro de vuelta a la Agenda. */
export async function facturarDetalleAction(id: string, input: { noFactura: string; fechaEmision: string; centroPorTipo?: Record<string, string> }): Promise<FacturarDetalleResult> {
  const permiso = await autorizar('facturar_agenda');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await facturarDetalle(id, input, permiso.email);
  if (r.ok) revalidar();
  return r;
}

export type ReintentoResult = WritebackResultado | { estado: 'error'; detalle: string };

export async function reintentarWritebackAction(noFactura: string): Promise<ReintentoResult> {
  const permiso = await autorizar('facturar_agenda');
  if (!permiso.ok) return { estado: 'error', detalle: permiso.error };
  const r = await reintentarWriteback(noFactura, permiso.email);
  revalidar();
  return r;
}

/** Pestaña "Sin mapear": empresas de la Agenda agregadas en SQL, paginadas y on demand (consultar = 'ver'). */
export async function empresasSinMapearAction(q: string, pagina: number, limite = 25): Promise<PaginaSinMapear> {
  await exigir('ver');
  const lim = Math.min(Math.max(Number(limite) || 25, 1), 100);
  return empresasSinMapear({ q, limite: lim, desde: (Math.max(Number(pagina) || 1, 1) - 1) * lim });
}

/** 018: marcar una empresa de la Agenda como "no se factura" por este flujo (sale de la cola; reversible). */
export async function marcarNoFacturaAction(input: { empresaIdExterno: string; empresaNombreExterno?: string; motivo?: string }): Promise<NoFacturaResult> {
  const permiso = await autorizar('facturar_agenda');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await marcarNoFactura(input, permiso.email);
  if (r.ok) revalidatePath('/por-facturar', 'layout');
  return r;
}

export async function quitarNoFacturaAction(empresaIdExterno: string): Promise<NoFacturaResult> {
  const permiso = await autorizar('facturar_agenda');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await quitarNoFactura(empresaIdExterno, permiso.email);
  if (r.ok) revalidatePath('/por-facturar', 'layout');
  return r;
}

/** MASIVO: mapear varias empresas de la Agenda al mismo cliente (un solo write + re-resolución). */
export async function mapearClientesLoteAction(input: { empresas: EmpresaRef[]; clienteAppId: string }): Promise<LoteResult> {
  const permiso = await autorizar('facturar_agenda');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await guardarMapeoLote(input, permiso.email);
  if (r.ok) revalidatePath('/por-facturar', 'layout');
  return r;
}

/** MASIVO: marcar varias empresas como "no se factura" con un motivo. */
export async function marcarNoFacturaLoteAction(input: { empresas: EmpresaRef[]; motivo?: string }): Promise<LoteResult> {
  const permiso = await autorizar('facturar_agenda');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await marcarNoFacturaLote(input, permiso.email);
  if (r.ok) revalidatePath('/por-facturar', 'layout');
  return r;
}

/** Todas las empresas del filtro actual (para "seleccionar todo el filtro": Walmart en 3 clics). */
export async function empresasSinMapearTodasAction(q: string): Promise<EmpresaRef[]> {
  await exigir('ver');
  const r = await empresasSinMapear({ q, limite: 1000, desde: 0 });
  return r.filas.map(f => ({ empresaIdExterno: f.empresaIdExterno, empresaNombreExterno: f.empresaNombreExterno }));
}

/** 029: base pública del deploy para armar el link (APP_URL si está; si no, el host de la petición). */
async function baseUrlPublica(): Promise<string> {
  const fija = String(process.env.APP_URL ?? '').trim().replace(/\/$/, '');
  if (/^https?:\/\//.test(fija)) return fija;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/** 029: "Enviar al cliente" / "Enviar versión corregida": link de aprobación + correo (o texto para copiar). */
export async function enviarDetalleAction(id: string, input: { destinatarios: string[]; cc?: string[]; asunto?: string; mensaje?: string }): Promise<EmitirLinkResult> {
  const permiso = await autorizar('facturar_agenda');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await emitirLinkDetalle(id, { email: permiso.email, nombre: permiso.nombre }, { ...input, baseUrl: await baseUrlPublica() });
  if (r.ok) revalidatePath('/por-facturar', 'layout');
  return r;
}

/** 029: revoca el link vigente del detalle (el cliente ya no puede responder con él). */
export async function revocarLinkDetalleAction(id: string, motivo?: string): Promise<{ ok: true; revocados: number } | { ok: false; error: string }> {
  const permiso = await autorizar('facturar_agenda');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await revocarLinkDetalle(id, permiso.email, motivo);
  if (r.ok) revalidatePath('/por-facturar', 'layout');
  return r;
}

/** 029: quita una línea del detalle (vuelve a la cola; opcionalmente diferida al próximo mes). */
export async function quitarLineaDetalleAction(id: string, componenteId: string, input: { motivo?: string; diferirHasta?: string | null }): Promise<DetalleResult> {
  const permiso = await autorizar('facturar_agenda');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await quitarLineaDetalle(id, componenteId, input, permiso.email);
  if (r.ok) revalidatePath('/por-facturar', 'layout');
  return r;
}

/** 029: respuesta de Golden a la nota del cliente en una línea. */
export async function responderNotaDetalleAction(id: string, componenteId: string, respuesta: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const permiso = await autorizar('facturar_agenda');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await responderNotaDetalle(id, componenteId, respuesta, permiso.email);
  if (r.ok) revalidatePath('/por-facturar', 'layout');
  return r;
}
