'use server';

/**
 * CONCILIACIÓN BANCARIA — server actions.
 * Permisos (matriz de lib/auth/roles.ts, validados en la PRIMERA línea):
 *  · ver: todos los roles.
 *  · registrar_movimiento (manual / CSV): admin, contador, auxiliar.
 *  · conciliar (conciliar, deshacer, contabilizar, borrar movimiento):
 *    admin y contador — separación de funciones: quien carga el banco
 *    no es quien concilia.
 */

import { revalidatePath } from 'next/cache';
import { autorizar, exigir } from '@/lib/auth/guard';
import {
  borrarMovimiento, conciliar, contabilizarMovimiento, crearMovimientoManual,
  deshacerConciliacion, importarMovimientos, previsualizarImportacion,
  type NuevoMovimiento, type PreviewImportacion,
} from '@/lib/db/conciliacion';
import type { MovimientoImportado } from '@/lib/conciliacion/csv';

type Resultado = { ok: true; mensaje: string } | { ok: false; error: string };
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));
const revalidar = () => revalidatePath('/conciliacion');

export async function crearMovimientoAction(input: NuevoMovimiento): Promise<Resultado> {
  const permiso = await autorizar('registrar_movimiento');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  try {
    await crearMovimientoManual(input, permiso.email);
    revalidar();
    return { ok: true, mensaje: 'Movimiento registrado.' };
  } catch (e) { return { ok: false, error: err(e) }; }
}

export async function previsualizarImportacionAction(bancoId: string, filas: MovimientoImportado[]): Promise<{ ok: true; preview: PreviewImportacion } | { ok: false; error: string }> {
  const permiso = await autorizar('registrar_movimiento');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  try {
    return { ok: true, preview: await previsualizarImportacion(bancoId, filas) };
  } catch (e) { return { ok: false, error: err(e) }; }
}

export async function importarMovimientosAction(bancoId: string, filas: MovimientoImportado[]): Promise<Resultado> {
  const permiso = await autorizar('registrar_movimiento');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  try {
    const r = await importarMovimientos(bancoId, filas, permiso.email);
    revalidar();
    return { ok: true, mensaje: `${r.nuevos.length} movimiento(s) nuevo(s) importado(s) · ${r.duplicados.length} duplicado(s) omitido(s)${r.errores.length ? ` · ${r.errores.length} fila(s) con error` : ''}.` };
  } catch (e) { return { ok: false, error: err(e) }; }
}

export async function borrarMovimientoAction(movimientoId: string): Promise<Resultado> {
  const permiso = await autorizar('conciliar');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  try {
    await borrarMovimiento(movimientoId);
    revalidar();
    return { ok: true, mensaje: 'Movimiento borrado.' };
  } catch (e) { return { ok: false, error: err(e) }; }
}

export async function conciliarAction(input: { movimientoId: string; docKeys: string[]; ajuste?: { cuentaId: string; descripcion?: string } | null }): Promise<Resultado> {
  const permiso = await autorizar('conciliar');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await conciliar({ ...input, usuario: permiso.email });
  if (r.ok) revalidar();
  return r;
}

export async function deshacerConciliacionAction(movimientoId: string, motivo: string): Promise<Resultado> {
  const permiso = await autorizar('conciliar');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await deshacerConciliacion(movimientoId, permiso.email, motivo);
  if (r.ok) revalidar();
  return r;
}

export async function contabilizarMovimientoAction(input: { movimientoId: string; cuentaId: string; descripcion?: string }): Promise<Resultado> {
  const permiso = await autorizar('conciliar');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await contabilizarMovimiento({ ...input, usuario: permiso.email });
  if (r.ok) revalidar();
  return r;
}

/** Solo lectura: para el exportador (lo usa la UI con los datos ya cargados). */
export async function verificarAccesoConciliacionAction(): Promise<boolean> {
  await exigir('ver');
  return true;
}
