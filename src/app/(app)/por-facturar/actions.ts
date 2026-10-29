'use server';

import { revalidatePath } from 'next/cache';
import { autorizar, exigir } from '@/lib/auth/guard';
import { anularDetalle, crearDetalle, facturarDetalle, marcarAprobada, marcarEnviada, type DetalleResult, type FacturarDetalleResult } from '@/lib/db/detalle-facturacion';
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

/** 019: generar el DETALLE (pre-liquidación) en borrador con los expedientes seleccionados; los reserva. */
export async function crearDetalleAction(input: { idsExternos: string[]; notas?: string }): Promise<DetalleResult> {
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
