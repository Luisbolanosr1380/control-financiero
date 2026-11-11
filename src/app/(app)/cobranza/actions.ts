'use server';

/**
 * CENTRO DE COBROS (033) · acciones de la bandeja y la ficha. Cada una valida el permiso en el servidor:
 * ver_cobranza (leer) y gestionar_cobranza (registrar gestiones y promesas, contactos, condiciones, adjuntos).
 */
import { revalidatePath } from 'next/cache';
import { autorizar } from '@/lib/auth/guard';
import { crearContacto, desactivarContacto, editarCondiciones, editarContacto, marcarSeguimientoHecho, registrarGestion, type CondicionesInput, type ContactoCobro, type ContactoInput, type RegistrarGestionResult } from '@/lib/db/cobranza';
import { confirmarSubidaAdjuntos, prepararSubidaAdjuntos, type SubidaAdjunto } from '@/lib/db/cobranza-adjuntos';
import type { GestionInput } from '@/lib/cobranza/estado';
import type { CondicionesCobro } from '@/lib/db/cobranza';

const revalidar = (idApp?: string) => { revalidatePath('/cobranza'); if (idApp) revalidatePath(`/cobranza/${idApp}`); revalidatePath('/facturacion/pendientes'); };

export async function registrarGestionCobranzaAction(idApp: string, input: GestionInput): Promise<RegistrarGestionResult> {
  const permiso = await autorizar('gestionar_cobranza');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await registrarGestion(idApp, input, permiso.email);
  if (r.ok) revalidar(idApp);
  return r;
}

export async function marcarSeguimientoHechoAction(eventoId: string, idApp?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const permiso = await autorizar('gestionar_cobranza');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await marcarSeguimientoHecho(eventoId);
  if (r.ok) revalidar(idApp);
  return r;
}

export async function crearContactoCobroAction(idApp: string, input: ContactoInput): Promise<{ ok: true; contacto: ContactoCobro } | { ok: false; error: string }> {
  const permiso = await autorizar('gestionar_cobranza');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await crearContacto(idApp, input, permiso.email);
  if (r.ok) revalidar(idApp);
  return r;
}

export async function editarContactoCobroAction(contactoId: string, input: ContactoInput, idApp?: string): Promise<{ ok: true; contacto: ContactoCobro } | { ok: false; error: string }> {
  const permiso = await autorizar('gestionar_cobranza');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await editarContacto(contactoId, input, permiso.email);
  if (r.ok) revalidar(idApp);
  return r;
}

export async function desactivarContactoCobroAction(contactoId: string, idApp?: string, motivo?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const permiso = await autorizar('gestionar_cobranza');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await desactivarContacto(contactoId, permiso.email, motivo);
  if (r.ok) revalidar(idApp);
  return r;
}

export async function editarCondicionesCobroAction(idApp: string, input: CondicionesInput): Promise<{ ok: true; condiciones: CondicionesCobro } | { ok: false; error: string }> {
  const permiso = await autorizar('gestionar_cobranza');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await editarCondiciones(idApp, input, permiso.email);
  if (r.ok) revalidar(idApp);
  return r;
}

export async function prepararAdjuntosCobranzaAction(eventoId: string, archivos: Array<{ nombre: string; bytes: number; mime: string }>): Promise<{ ok: true; subidas: SubidaAdjunto[] } | { ok: false; error: string }> {
  const permiso = await autorizar('gestionar_cobranza');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  return prepararSubidaAdjuntos(eventoId, (archivos ?? []).slice(0, 5).map(a => ({ nombre: String(a.nombre ?? '').slice(0, 200), bytes: Number(a.bytes), mime: String(a.mime ?? '') })));
}

export async function confirmarAdjuntosCobranzaAction(eventoId: string, archivos: Array<{ path: string; nombre: string }>, idApp?: string): Promise<{ ok: true; adjuntos: Array<{ id: string; nombre: string; mime: string; bytes: number }> } | { ok: false; error: string }> {
  const permiso = await autorizar('gestionar_cobranza');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await confirmarSubidaAdjuntos(eventoId, archivos, permiso.email);
  if (r.ok) revalidar(idApp);
  return r;
}
