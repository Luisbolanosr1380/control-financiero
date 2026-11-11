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
import { editarPlantilla, editarRegla, enviarEstadoCuenta, enviarRecordatorio, getEstadoCuenta, omitirRecordatorio, type DatosEstadoCuenta, type EnvioInput, type EnvioResult } from '@/lib/db/cobranza-recordatorios';
import type { Plantilla, ReglaRecordatorio } from '@/lib/cobranza/recordatorios';

const revalidar = (idApp?: string) => { revalidatePath('/cobranza'); revalidatePath('/cobranza/recordatorios'); if (idApp) revalidatePath(`/cobranza/${idApp}`); revalidatePath('/facturacion/pendientes'); revalidatePath('/facturacion'); revalidatePath('/facturacion/[id]', 'page'); };   // SEGUIMIENTO DE COBRO: la lista y la factura se refrescan al guardar

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

/* ───────────── CENTRO DE COBROS · PR 2 (035): recordatorios y estado de cuenta ───────────── */

/** Manda UN recordatorio propuesto. Nada sale sin esta acción; el servidor vuelve a calcular el borrador y a exigir el motivo si está bloqueado. */
export async function enviarRecordatorioAction(id: string, input: EnvioInput): Promise<EnvioResult> {
  const permiso = await autorizar('gestionar_cobranza');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await enviarRecordatorio(String(id ?? '').slice(0, 300), input, { email: permiso.email, nombre: permiso.nombre });
  revalidar();
  return r;
}

/** «Enviar seleccionados»: uno por uno, en orden; devuelve el resultado de cada uno (lo que no salió queda explicado). */
export async function enviarRecordatoriosAction(items: Array<{ id: string; input: EnvioInput }>): Promise<Array<{ id: string; resultado: EnvioResult }>> {
  const permiso = await autorizar('gestionar_cobranza');
  if (!permiso.ok) return (items ?? []).slice(0, 50).map(i => ({ id: i.id, resultado: { ok: false as const, error: permiso.error } }));
  const out: Array<{ id: string; resultado: EnvioResult }> = [];
  for (const i of (items ?? []).slice(0, 50)) out.push({ id: i.id, resultado: await enviarRecordatorio(String(i.id ?? '').slice(0, 300), i.input, { email: permiso.email, nombre: permiso.nombre }) });
  revalidar();
  return out;
}

export async function omitirRecordatorioAction(clienteUuid: string, regla: string, hasta: string, motivo: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const permiso = await autorizar('gestionar_cobranza');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await omitirRecordatorio(clienteUuid, regla, hasta, motivo, permiso.email);
  if (r.ok) revalidar();
  return r;
}

/** El estado de cuenta y el correo propuesto para el modal de la ficha (solo lectura). */
export async function prepararEstadoCuentaAction(idApp: string): Promise<{ ok: true; datos: DatosEstadoCuenta } | { ok: false; error: string }> {
  const permiso = await autorizar('ver_cobranza');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const datos = await getEstadoCuenta(String(idApp ?? '').slice(0, 120), { email: permiso.email, nombre: permiso.nombre });
  return datos ? { ok: true, datos } : { ok: false, error: 'El cliente no existe.' };
}

export async function enviarEstadoCuentaAction(idApp: string, input: EnvioInput): Promise<EnvioResult> {
  const permiso = await autorizar('gestionar_cobranza');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await enviarEstadoCuenta(idApp, input, { email: permiso.email, nombre: permiso.nombre });
  revalidar(idApp);
  return r;
}

/** Plantillas y reglas: admin y contador (configurar_cobranza). */
export async function editarPlantillaCobranzaAction(clave: string, input: { asunto?: string; cuerpo?: string; nombre?: string }): Promise<{ ok: true; plantilla: Plantilla } | { ok: false; error: string }> {
  const permiso = await autorizar('configurar_cobranza');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await editarPlantilla(clave, input, permiso.email);
  if (r.ok) { revalidatePath('/cobranza/plantillas'); revalidatePath('/cobranza/recordatorios'); }
  return r;
}

export async function editarReglaCobranzaAction(clave: string, input: { activo?: boolean; dias?: number; cadaDias?: number | null }): Promise<{ ok: true; regla: ReglaRecordatorio } | { ok: false; error: string }> {
  const permiso = await autorizar('configurar_cobranza');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await editarRegla(clave, input, permiso.email);
  if (r.ok) { revalidatePath('/cobranza/plantillas'); revalidatePath('/cobranza/recordatorios'); revalidatePath('/cobranza'); }
  return r;
}
