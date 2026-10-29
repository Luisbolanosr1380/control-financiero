'use server';

import { revalidatePath } from 'next/cache';
import { autorizar, exigir } from '@/lib/auth/guard';
import {
  activarTarifa, aprobarTarifa, aprobarTarifasPorNit, crearTarifa, editarTarifa, generarTarifasCliente, listarHistorialTarifa, planGenerarTarifas, resolverTarifaExpediente, verificarDuplicadoTarifa,
  type AprobarLoteResult, type GenerarResult, type PlanGenerarCliente, type TarifaInput, type TarifaResult,
} from '@/lib/db/tarifario';
import type { HistorialTarifa } from '@/lib/tarifario/antiguedad';
import type { Expediente, ResultadoLookup } from '@/lib/tarifario/lookup';

/** TARIFARIO: crear / editar / aprobar / desactivar = 'catalogos' (admin y contador). Consultar = 'ver'. */
export async function crearTarifaAction(input: TarifaInput): Promise<TarifaResult> {
  const permiso = await autorizar('catalogos');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await crearTarifa(input, permiso.email);
  if (r.ok) revalidatePath('/tarifario', 'layout');
  return r;
}

/** `motivo` (opcional, ej. "ajuste anual") viaja al trigger de la bitácora por la RPC. */
export async function editarTarifaAction(id: string, cambios: { monto?: number; anio?: string; razonSocial?: string; motivo?: string }): Promise<TarifaResult> {
  const permiso = await autorizar('catalogos');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const { motivo, ...resto } = cambios;
  const r = await editarTarifa(id, resto, permiso.email, motivo);
  if (r.ok) revalidatePath('/tarifario', 'layout');
  return r;
}

export async function aprobarTarifaAction(id: string): Promise<TarifaResult> {
  const permiso = await autorizar('catalogos');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await aprobarTarifa(id, permiso.email);
  if (r.ok) revalidatePath('/tarifario', 'layout');
  return r;
}

export async function activarTarifaAction(id: string, activo: boolean): Promise<TarifaResult> {
  const permiso = await autorizar('catalogos');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await activarTarifa(id, activo, permiso.email);
  if (r.ok) revalidatePath('/tarifario', 'layout');
  return r;
}

/** Aprobar en lote las pendientes (no Q0) de un cliente: mismo permiso que aprobar una. */
export async function aprobarTarifasPorNitAction(nit: string): Promise<AprobarLoteResult> {
  const permiso = await autorizar('catalogos');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await aprobarTarifasPorNit(nit, permiso.email);
  if (r.ok) { revalidatePath('/tarifario'); revalidatePath(`/tarifario/${encodeURIComponent(nit)}`); }
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

/** Línea de tiempo de una tarifa ("ver histórico"): consultar = 'ver'. */
export async function historialTarifaAction(id: string): Promise<HistorialTarifa[]> {
  await exigir('ver');
  return listarHistorialTarifa(id);
}

/** GENERAR TARIFAS: qué se crearía para un NIT (plantilla + lo que pide en la Agenda). Consultar = 'ver'. */
export async function planGenerarTarifasAction(nit: string, tiposExtra: string[] = []): Promise<PlanGenerarCliente | { error: string }> {
  await exigir('ver');
  return planGenerarTarifas(nit, { tiposExtra });
}

/** GENERAR TARIFAS: crea en Q0 las filas faltantes según la forma de cada servicio (mismo permiso que crear una). */
export async function generarTarifasClienteAction(input: { nit: string; razonSocial?: string; tiposExtra?: string[] }): Promise<GenerarResult> {
  const permiso = await autorizar('catalogos');
  if (!permiso.ok) return { ok: false, error: permiso.error };
  const r = await generarTarifasCliente(input, permiso.email);
  if (r.ok) { revalidatePath('/tarifario', 'layout'); revalidatePath('/por-facturar', 'layout'); }
  return r;
}
