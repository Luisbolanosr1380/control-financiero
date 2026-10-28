'use server';

import { revalidatePath } from 'next/cache';
import { autorizar } from '@/lib/auth/guard';
import {
  emitirFacturaAgenda, guardarMapeo, reintentarWriteback, sincronizarAgenda,
  type EmitirInput, type EmitirResult, type MapeoResult, type ResultadoSync, type WritebackResultado,
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

export async function mapearClienteAction(input: { empresaIdExterno: string; empresaNombreExterno?: string; clienteAppId: string }): Promise<MapeoResult> {
  const permiso = await autorizar('facturar_agenda');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await guardarMapeo(input, permiso.email);
  if (r.ok) revalidatePath('/por-facturar', 'layout');
  return r;
}

/** Emite la factura (número y fecha reales de SAT/FEL) y escribe el cobro de vuelta a la Agenda. */
export async function emitirFacturaAgendaAction(input: EmitirInput): Promise<EmitirResult> {
  const permiso = await autorizar('facturar_agenda');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await emitirFacturaAgenda(input, permiso.email);
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
