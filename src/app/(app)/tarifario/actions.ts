'use server';

import { revalidatePath } from 'next/cache';
import { autorizar, exigir } from '@/lib/auth/guard';
import {
  activarTarifa, aprobarTarifa, crearTarifa, editarTarifa, resolverTarifaExpediente, verificarDuplicadoTarifa,
  type TarifaInput, type TarifaResult,
} from '@/lib/db/tarifario';
import type { Expediente, ResultadoLookup } from '@/lib/tarifario/lookup';

/** TARIFARIO: crear / editar / aprobar / desactivar = 'catalogos' (admin y contador). Consultar = 'ver'. */
export async function crearTarifaAction(input: TarifaInput): Promise<TarifaResult> {
  const permiso = await autorizar('catalogos');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await crearTarifa(input, permiso.email);
  if (r.ok) revalidatePath('/tarifario');
  return r;
}

export async function editarTarifaAction(id: string, cambios: { monto?: number; anio?: string; razonSocial?: string }): Promise<TarifaResult> {
  const permiso = await autorizar('catalogos');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await editarTarifa(id, cambios);
  if (r.ok) revalidatePath('/tarifario');
  return r;
}

export async function aprobarTarifaAction(id: string): Promise<TarifaResult> {
  const permiso = await autorizar('catalogos');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await aprobarTarifa(id, permiso.email);
  if (r.ok) revalidatePath('/tarifario');
  return r;
}

export async function activarTarifaAction(id: string, activo: boolean): Promise<TarifaResult> {
  const permiso = await autorizar('catalogos');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await activarTarifa(id, activo);
  if (r.ok) revalidatePath('/tarifario');
  return r;
}

/** Aviso en el form antes de guardar (el servidor lo revalida al crear). */
export async function verificarDuplicadoTarifaAction(nueva: { nit: string; tipoPrueba: string; categoria: string; territorio: string }, excluirId?: string): Promise<{ id: string; descripcion: string } | null> {
  await exigir('ver');
  return verificarDuplicadoTarifa(nueva, excluirId);
}

/** Motor de lookup desde un expediente (empresa o NIT + tipo + categoría + territorio). */
export async function resolverTarifaAction(exp: Expediente): Promise<ResultadoLookup> {
  await exigir('ver');
  return resolverTarifaExpediente(exp);
}
