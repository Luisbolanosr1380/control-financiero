'use server';

/**
 * PRESUPUESTO — server actions. Permiso en la PRIMERA línea de cada una
 * (matriz de lib/auth/roles.ts):
 *  · presupuesto (admin, contador): crear, precargar, editar celdas, limpiar, aprobar, archivar.
 *  · reabrir_presupuesto (admin): reabrir un aprobado (queda en el log).
 *  · ver_presupuesto (todos): leer; las páginas lo exigen al cargar.
 */
import { revalidatePath } from 'next/cache';
import { autorizar } from '@/lib/auth/guard';
import {
  aprobarPresupuesto, archivarPresupuesto, crearPresupuesto, editarCeldas, limpiarCeldas,
  precargarPresupuesto, reabrirPresupuesto, type Resultado,
} from '@/lib/db/presupuesto';
import type { AjustesPrecarga } from '@/lib/presupuesto/modelo';

const revalidar = (id?: string) => { revalidatePath('/presupuesto'); if (id) revalidatePath(`/presupuesto/${id}`); };
const ajustesSeguros = (a: AjustesPrecarga | undefined): AjustesPrecarga => ({
  globalPct: Number.isFinite(a?.globalPct) ? Number(a!.globalPct) : 0,
  porClasePct: a?.porClasePct,
  porLineaPct: a?.porLineaPct,
});

export async function crearPresupuestoAction(input: { anio: number; nombre?: string; modo: 'blanco' | 'precarga'; ajustes?: AjustesPrecarga }): Promise<Resultado<{ id: string }>> {
  const permiso = await autorizar('presupuesto');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await crearPresupuesto({ ...input, ajustes: ajustesSeguros(input.ajustes), usuario: permiso.email });
  if (r.ok) revalidar(r.id);
  return r;
}

export async function precargarPresupuestoAction(input: { id: string; ajustes: AjustesPrecarga }): Promise<Resultado<{ celdas: number }>> {
  const permiso = await autorizar('presupuesto');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await precargarPresupuesto({ id: input.id, ajustes: ajustesSeguros(input.ajustes), usuario: permiso.email });
  if (r.ok) revalidar(input.id);
  return r;
}

export async function editarCeldasAction(input: { id: string; cambios: Array<{ orden: number; centroId: string; mes: number; monto: number }> }): Promise<Resultado<{ celdas: number }>> {
  const permiso = await autorizar('presupuesto');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await editarCeldas({ ...input, usuario: permiso.email });
  if (r.ok) revalidar(input.id);
  return r;
}

export async function limpiarCeldasAction(input: { id: string; centroId: string | null }): Promise<Resultado> {
  const permiso = await autorizar('presupuesto');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await limpiarCeldas({ ...input, usuario: permiso.email });
  if (r.ok) revalidar(input.id);
  return r;
}

export async function aprobarPresupuestoAction(id: string): Promise<Resultado> {
  const permiso = await autorizar('presupuesto');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await aprobarPresupuesto({ id, usuario: permiso.email });
  if (r.ok) revalidar(id);
  return r;
}

export async function reabrirPresupuestoAction(input: { id: string; motivo: string }): Promise<Resultado> {
  const permiso = await autorizar('reabrir_presupuesto');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await reabrirPresupuesto({ ...input, usuario: permiso.email });
  if (r.ok) revalidar(input.id);
  return r;
}

export async function archivarPresupuestoAction(id: string): Promise<Resultado> {
  const permiso = await autorizar('presupuesto');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await archivarPresupuesto({ id, usuario: permiso.email });
  if (r.ok) revalidar(id);
  return r;
}
