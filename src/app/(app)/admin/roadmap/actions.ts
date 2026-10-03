'use server';

import { revalidatePath } from 'next/cache';
import { autorizar } from '@/lib/auth/guard';
import {
  crearRoadmapItem, editarRoadmapItem,
  type CrearRoadmapItemInput, type EditarRoadmapItemInput, type RoadmapMutationResult,
} from '@/lib/db/roadmap';

export async function crearRoadmapItemAction(input: CrearRoadmapItemInput): Promise<RoadmapMutationResult> {
  const permiso = await autorizar('configurar_empresa');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const res = await crearRoadmapItem(input);
  if (res.ok) revalidatePath('/admin/roadmap');
  return res;
}

export async function editarRoadmapItemAction(itemId: string, cambios: EditarRoadmapItemInput): Promise<RoadmapMutationResult> {
  const permiso = await autorizar('configurar_empresa');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const res = await editarRoadmapItem(itemId, cambios);
  if (res.ok) revalidatePath('/admin/roadmap');
  return res;
}
