'use server';

/**
 * FACTORAJE — server actions. Permisos (matriz de lib/auth/roles.ts,
 * validados en la PRIMERA línea):
 *  · ver: todos.
 *  · ceder_factura (registrar la cesión, tracking): admin, contador, auxiliar.
 *  · factoraje (liberar / recomprar / pagada, contabilizar): admin y contador.
 *  · Crear el factoraje = alta de deuda → crearDeudaAction (gestionar_deudas,
 *    admin/contador) — se reutiliza, no se duplica.
 */

import { revalidatePath } from 'next/cache';
import { autorizar, exigir } from '@/lib/auth/guard';
import { cambiarEstadoCesion, cederFacturas, getFacturasCedibles, getPreviewAsiento, type EstadoCesion, type FacturaCedible, type Resultado } from '@/lib/db/factoraje';
import { GENERAR_ASIENTO_FACTORAJE } from '@/lib/factoraje/asiento-config';

const revalidar = () => { revalidatePath('/factoraje'); revalidatePath('/facturacion/pendientes'); revalidatePath('/deudas', 'layout'); };

export async function getFacturasCediblesAction(): Promise<FacturaCedible[]> {
  await exigir('ver');
  return getFacturasCedibles();
}

export async function cederFacturasAction(input: { factorajeId: string; items: Array<{ facturaId: string; montoCedido?: number; nota?: string }> }): Promise<Resultado> {
  const permiso = await autorizar('ceder_factura');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await cederFacturas({ ...input, usuario: permiso.email });
  if (r.ok) revalidar();
  return r;
}

export async function cambiarEstadoCesionAction(input: { cesionId: string; estado: Exclude<EstadoCesion, 'Cedida'>; nota?: string }): Promise<Resultado> {
  const permiso = await autorizar('factoraje');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await cambiarEstadoCesion({ ...input, usuario: permiso.email });
  if (r.ok) revalidar();
  return r;
}

export async function previewAsientoFactorajeAction(factorajeId: string) {
  const permiso = await autorizar('factoraje');
  if (!permiso.ok) return { ok: false as const, error: permiso.error };
  return getPreviewAsiento(factorajeId);
}

/**
 * Contabilizar el adelanto: la estructura existe (preview) pero la
 * generación está APAGADA (GENERAR_ASIENTO_FACTORAJE=false) hasta que el
 * contador valide el tratamiento con/sin recurso. Cuando se prenda, acá
 * va el RPC fase2_crear_asiento_con_partidas con asiento_ref idempotente.
 */
export async function contabilizarFactorajeAction(factorajeId: string): Promise<Resultado> {
  const permiso = await autorizar('factoraje');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  if (!GENERAR_ASIENTO_FACTORAJE) {
    return { ok: false, error: 'La contabilización del factoraje está apagada hasta que el contador valide la estructura del asiento (con recurso vs sin recurso). Podés ver la propuesta en "Ver asiento propuesto".' };
  }
  void factorajeId;
  return { ok: false, error: 'Generación no implementada: falta la estructura validada por el contador.' };
}
