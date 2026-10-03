'use server';

/**
 * F-ETIQUETAS — server actions compartidas (facturas y gastos).
 * Leer/asignar: cualquier usuario con rol. Gestión (renombrar/color/
 * borrar): solo admin.
 */

import { revalidatePath } from 'next/cache';
import { currentUser } from '@clerk/nextjs/server';
import { getRolUsuario } from '@/lib/auth/allowlist';
import {
  getEtiquetas, getEtiquetasDeDocumento, setEtiquetasDocumento,
  editarEtiqueta, borrarEtiqueta,
  type Etiqueta, type TipoDocumentoEtiqueta,
} from '@/lib/db/etiquetas';

async function rolActual() {
  const user = await currentUser();
  return getRolUsuario(user?.emailAddresses?.[0]?.emailAddress ?? '');
}

export async function getEtiquetasAction(): Promise<Etiqueta[]> {
  return getEtiquetas();
}

export async function getEtiquetasDeDocumentoAction(
  tipo: TipoDocumentoEtiqueta, docAppId: string,
): Promise<Etiqueta[]> {
  return getEtiquetasDeDocumento(tipo, docAppId);
}

export async function setEtiquetasDocumentoAction(
  tipo: TipoDocumentoEtiqueta, docAppId: string, nombres: string[],
): Promise<{ ok: true; etiquetas: Etiqueta[] } | { ok: false; error: string }> {
  if (!(await rolActual())) return { ok: false, error: 'Usuario no autorizado.' };
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
  if ((await rolActual()) !== 'admin') return { ok: false, error: 'Solo admin gestiona etiquetas.' };
  const res = await editarEtiqueta(id, cambios);
  if (res.ok) { revalidatePath('/admin/catalogos'); revalidatePath('/facturacion', 'layout'); }
  return res;
}

export async function borrarEtiquetaAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if ((await rolActual()) !== 'admin') return { ok: false, error: 'Solo admin gestiona etiquetas.' };
  const res = await borrarEtiqueta(id);
  if (res.ok) { revalidatePath('/admin/catalogos'); revalidatePath('/facturacion', 'layout'); }
  return res;
}
