'use server';

/**
 * F-051 parte B — CRUD de OBLIGACIONES_RECURRENTES.
 *
 * Reglas de validación:
 *  - nombre no vacío
 *  - tipo ∈ TIPOS_OBLIGACION
 *  - monto_estimado > 0
 *  - dia_pago 1..31
 *  - frecuencia ∈ FRECUENCIAS_OBLIGACION
 *  - prioridad  ∈ PRIORIDADES_OBLIGACION
 *
 * Writes con `typecast: true` para que las opciones de singleSelect
 * creadas (Renta/Servicio/etc.) se auto-añadan en Airtable si faltan.
 *
 * toggleActivo pausa/reactiva — nunca borramos. Una obligación pausada
 * NO genera eventos en el cash-flow planner (la lectura filtra activo=true).
 */

import { revalidatePath } from 'next/cache';
import { airtable } from '@/lib/db/airtable';
import {
  OBLIGACIONES_RECURRENTES_TABLE_ID,
  OBLIGACIONES_RECURRENTES_FIELDS as FO,
  TIPOS_OBLIGACION,
  FRECUENCIAS_OBLIGACION,
  PRIORIDADES_OBLIGACION,
  type TipoObligacion,
  type FrecuenciaObligacion,
  type PrioridadObligacion,
} from '@/lib/airtable/obligaciones-recurrentes-fields';
import {
  getObligacionesRecurrentes,
  type ObligacionRecurrente,
} from '@/lib/flujo/obligaciones';

export interface ObligacionInput {
  nombre: string;
  tipo: TipoObligacion;
  montoEstimado: number;
  diaPago: number;
  frecuencia: FrecuenciaObligacion;
  prioridad: PrioridadObligacion;
  proveedorId?: string;
  acreedorId?: string;
  centroCostoId?: string;
  cuentaContableId?: string;
  bancoPagoId?: string;
  mesReferencia?: string;     // YYYY-MM-01 (date) — solo para bimestral+
  activo?: boolean;
  notas?: string;
}

export type ObligacionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

function validarInput(input: ObligacionInput): string | null {
  const nombre = (input.nombre ?? '').trim();
  if (!nombre)                                        return 'El nombre es requerido.';
  if (!TIPOS_OBLIGACION.includes(input.tipo))         return `Tipo inválido (${input.tipo}).`;
  if (!(input.montoEstimado > 0))                     return 'El monto estimado debe ser mayor a 0.';
  if (!Number.isInteger(input.diaPago))               return 'El día de pago debe ser un entero.';
  if (input.diaPago < 1 || input.diaPago > 31)        return 'El día de pago debe estar entre 1 y 31.';
  if (!FRECUENCIAS_OBLIGACION.includes(input.frecuencia)) return `Frecuencia inválida (${input.frecuencia}).`;
  if (!PRIORIDADES_OBLIGACION.includes(input.prioridad))  return `Prioridad inválida (${input.prioridad}).`;
  if (input.mesReferencia && !/^\d{4}-\d{2}-\d{2}$/.test(input.mesReferencia)) {
    return 'mesReferencia debe ser YYYY-MM-DD.';
  }
  return null;
}

function fieldsDeInput(input: ObligacionInput): Record<string, unknown> {
  type AField = string | number | boolean | string[] | undefined;
  const f: Record<string, AField> = {
    [FO.nombre]:         input.nombre.trim(),
    [FO.tipo]:           input.tipo,
    [FO.monto_estimado]: input.montoEstimado,
    [FO.dia_pago]:       input.diaPago,
    [FO.frecuencia]:     input.frecuencia,
    [FO.prioridad]:      input.prioridad,
    [FO.activo]:         input.activo ?? true,
  };
  if (input.proveedorId)      f[FO.proveedor]       = [input.proveedorId];
  if (input.acreedorId)       f[FO.acreedor]        = [input.acreedorId];
  if (input.centroCostoId)    f[FO.centro_costo]    = [input.centroCostoId];
  if (input.cuentaContableId) f[FO.cuenta_contable] = [input.cuentaContableId];
  if (input.bancoPagoId)      f[FO.banco_pago]      = [input.bancoPagoId];
  if (input.mesReferencia)    f[FO.mes_referencia]  = input.mesReferencia;
  if (input.notas?.trim())    f[FO.notas]           = input.notas.trim();
  return f as Record<string, unknown>;
}

export async function listarObligaciones(): Promise<ObligacionRecurrente[]> {
  return getObligacionesRecurrentes(false);
}

export async function crearObligacion(input: ObligacionInput): Promise<ObligacionResult> {
  if (!airtable) return { ok: false, error: 'Airtable no está configurado.' };
  const err = validarInput(input);
  if (err) return { ok: false, error: err };

  try {
    const fields = fieldsDeInput(input);
    type AField = string | number | boolean | string[] | undefined;
    const created = (await (airtable(OBLIGACIONES_RECURRENTES_TABLE_ID).create as unknown as (
      records: Array<{ fields: Record<string, AField> }>,
      opts: { typecast: boolean },
    ) => Promise<Array<{ id: string }>>)([{ fields: fields as Record<string, AField> }], { typecast: true }));
    revalidatePath('/flujo');
    return { ok: true, id: created[0].id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function actualizarObligacion(id: string, input: ObligacionInput): Promise<ObligacionResult> {
  if (!airtable) return { ok: false, error: 'Airtable no está configurado.' };
  if (!id) return { ok: false, error: 'id requerido.' };
  const err = validarInput(input);
  if (err) return { ok: false, error: err };

  try {
    const fields = fieldsDeInput(input);
    type AField = string | number | boolean | string[] | undefined;
    await (airtable(OBLIGACIONES_RECURRENTES_TABLE_ID).update as unknown as (
      records: Array<{ id: string; fields: Record<string, AField> }>,
      opts: { typecast: boolean },
    ) => Promise<unknown>)([{ id, fields: fields as Record<string, AField> }], { typecast: true });
    revalidatePath('/flujo');
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function toggleActivoObligacion(id: string): Promise<ObligacionResult> {
  if (!airtable) return { ok: false, error: 'Airtable no está configurado.' };
  if (!id) return { ok: false, error: 'id requerido.' };
  try {
    const todas = await getObligacionesRecurrentes(false);
    const actual = todas.find(o => o.id === id);
    if (!actual) return { ok: false, error: 'No se encontró la obligación.' };
    await airtable(OBLIGACIONES_RECURRENTES_TABLE_ID).update([
      { id, fields: { [FO.activo]: !actual.activo } },
    ]);
    revalidatePath('/flujo');
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
