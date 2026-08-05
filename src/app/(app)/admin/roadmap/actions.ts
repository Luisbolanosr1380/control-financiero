'use server';

import { revalidatePath } from 'next/cache';
import { currentUser } from '@clerk/nextjs/server';
import { getRolUsuario } from '@/lib/auth/allowlist';
import {
  crearRoadmapItem, editarRoadmapItem,
  type CrearRoadmapItemInput, type EditarRoadmapItemInput, type RoadmapMutationResult,
} from '@/lib/db/roadmap';

async function guardAdmin(): Promise<{ ok: false; error: string } | null> {
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress ?? '';
  if (getRolUsuario(email) !== 'admin') return { ok: false, error: 'Solo admin puede tocar el roadmap.' };
  return null;
}

export async function crearRoadmapItemAction(input: CrearRoadmapItemInput): Promise<RoadmapMutationResult> {
  const guard = await guardAdmin();
  if (guard) return guard;
  const res = await crearRoadmapItem(input);
  if (res.ok) revalidatePath('/admin/roadmap');
  return res;
}

export async function editarRoadmapItemAction(itemId: string, cambios: EditarRoadmapItemInput): Promise<RoadmapMutationResult> {
  const guard = await guardAdmin();
  if (guard) return guard;
  const res = await editarRoadmapItem(itemId, cambios);
  if (res.ok) revalidatePath('/admin/roadmap');
  return res;
}
