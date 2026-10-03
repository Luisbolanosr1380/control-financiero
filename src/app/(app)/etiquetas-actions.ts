'use server';

/**
 * F-ETIQUETAS — server actions compartidas (facturas y gastos).
 * Leer: cualquier rol. Asignar: quien registra (admin/contador/auxiliar).
 * Gestión (renombrar/color/borrar): catálogos (admin/contador).
 */

import { revalidatePath } from 'next/cache';
import { autorizar, exigir } from '@/lib/auth/guard';
import {
  getEtiquetas, getEtiquetasDeDocumento, setEtiquetasDocumento,
  editarEtiqueta, borrarEtiqueta,
  type Etiqueta, type TipoDocumentoEtiqueta,
} from '@/lib/db/etiquetas';

export async function getEtiquetasAction(): Promise<Etiqueta[]> {
  await exigir('ver');
  return getEtiquetas();
}

export async function getEtiquetasDeDocumentoAction(
  tipo: TipoDocumentoEtiqueta, docAppId: string,
): Promise<Etiqueta[]> {
  await exigir('ver');
  return getEtiquetasDeDocumento(tipo, docAppId);
}

export async function setEtiquetasDocumentoAction(
  tipo: TipoDocumentoEtiqueta, docAppId: string, nombres: string[],
): Promise<{ ok: true; etiquetas: Etiqueta[] } | { ok: false; error: string }> {
  const permiso = await autorizar('etiquetar');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  try {
    const etiquetas = await setEtiquetasDocumento(tipo, docAppId, nombres);
    revalidatePath('/facturacion', 'layout');
    revalidatePath('/gastos');
    return { ok: true, etiquetas };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function editarEtiquetaAction(
  id: string, cambios: { nombre?: string; color?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const permiso = await autorizar('catalogos');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const res = await editarEtiqueta(id, cambios);
  if (res.ok) { revalidatePath('/admin/catalogos'); revalidatePath('/facturacion', 'layout'); }
  return res;
}

export async function borrarEtiquetaAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const permiso = await autorizar('catalogos');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const res = await borrarEtiqueta(id);
  if (res.ok) { revalidatePath('/admin/catalogos'); revalidatePath('/facturacion', 'layout'); }
  return res;
}
