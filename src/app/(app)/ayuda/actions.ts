'use server';

/**
 * F-046 — Server actions del Centro de Ayuda.
 *
 * Las mutaciones (crear / editar / desactivar) están gateadas por
 * `rol === 'admin'`. La lectura por tag (usada por el HelpButton) está
 * abierta a cualquier usuario autenticado.
 */

import { revalidatePath } from 'next/cache';
import { currentUser } from '@clerk/nextjs/server';
import {
  crearArticulo,
  editarArticulo,
  desactivarArticulo,
  getArticulosPorTag,
  type Articulo,
  type ArticuloMutationResult,
  type CrearArticuloInput,
  type EditarArticuloInput,
} from '@/lib/db/ayuda';
import { autorizar, exigir } from '@/lib/auth/guard';

function revalidarTodo() {
  revalidatePath('/ayuda');
  revalidatePath('/ayuda', 'layout');     // alcanza /ayuda/[slug]
}

/** El Centro de Ayuda es configuración de la empresa → solo admin. */
async function exigirAdmin() {
  return autorizar('configurar_empresa');
}

export async function crearArticuloAction(input: CrearArticuloInput): Promise<ArticuloMutationResult> {
  const auth = await exigirAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };
  const result = await crearArticulo(input, auth.email);
  if (result.ok) revalidarTodo();
  return result;
}

export async function editarArticuloAction(id: string, cambios: EditarArticuloInput): Promise<ArticuloMutationResult> {
  const auth = await exigirAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };
  const result = await editarArticulo(id, cambios, auth.email);
  if (result.ok) revalidarTodo();
  return result;
}

export async function desactivarArticuloAction(id: string): Promise<ArticuloMutationResult> {
  const auth = await exigirAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };
  const result = await desactivarArticulo(id, auth.email);
  if (result.ok) revalidarTodo();
  return result;
}

/** Lectura por tag para el HelpButton — abierta a cualquier usuario autenticado. */
export async function buscarArticulosPorTagAction(tag: string): Promise<Articulo[]> {
  await exigir('ver');
  const user = await currentUser();
  if (!user) return [];
  return getArticulosPorTag(tag);
}
