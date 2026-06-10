/**
 * F-050 — Buscar proveedor por NIT exacto o crearlo con datos sugeridos.
 *
 * El NIT se normaliza a uppercase + solo [0-9A-Z] (consistente con
 * normalizeNitGT del parser de F-049). Eso significa que "8056376-K" y
 * "8056376K" matchearían el mismo proveedor.
 *
 * `typecast: true` al crear absorbe el caso de que `activo` esté definido
 * como singleSelect ("Sí"/"No") en lugar de checkbox boolean.
 */

import { airtable } from '@/lib/db/airtable';
import { PROVEEDORES_TABLE_ID, PROVEEDORES_FIELDS } from '@/lib/airtable/proveedores-fields';

export interface ProveedorResolucion {
  recordId: string;
  nombre: string;
  esNuevo: boolean;
}

export interface BuscarOCrearProveedorInput {
  nit: string;
  nombreSugerido: string;
  emailSugerido?: string;
  telefonoSugerido?: string;
  direccionSugerida?: string;
}

function normalizarNit(s: string): string {
  return String(s ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export async function buscarOCrearProveedor(
  input: BuscarOCrearProveedorInput,
): Promise<ProveedorResolucion> {
  if (!airtable) throw new Error('Airtable no está configurado.');
  const nitNorm = normalizarNit(input.nit);
  if (!nitNorm) throw new Error('NIT vacío — no se puede buscar/crear proveedor.');

  // Buscar por NIT exacto.
  const existentes = await airtable(PROVEEDORES_TABLE_ID)
    .select({
      returnFieldsByFieldId: true,
      fields: [PROVEEDORES_FIELDS.nit, PROVEEDORES_FIELDS.nombre],
    })
    .all();

  for (const r of existentes) {
    const nitRecord = String(r.fields[PROVEEDORES_FIELDS.nit] ?? '');
    if (normalizarNit(nitRecord) === nitNorm) {
      const nombre = String(r.fields[PROVEEDORES_FIELDS.nombre] ?? '');
      return { recordId: r.id, nombre, esNuevo: false };
    }
  }

  // No existe → crear.
  const nombreLimpio = (input.nombreSugerido ?? '').trim();
  if (!nombreLimpio) {
    throw new Error('Nombre sugerido vacío — no se puede crear proveedor sin nombre.');
  }

  type AField = string | number | boolean | undefined;
  const fields: Record<string, AField> = {
    [PROVEEDORES_FIELDS.nombre]:    nombreLimpio,
    [PROVEEDORES_FIELDS.nit]:       nitNorm,
    [PROVEEDORES_FIELDS.activo]:    true,
  };
  if (input.emailSugerido)     fields[PROVEEDORES_FIELDS.email]     = input.emailSugerido.trim();
  if (input.telefonoSugerido)  fields[PROVEEDORES_FIELDS.telefono]  = input.telefonoSugerido.trim();
  if (input.direccionSugerida) fields[PROVEEDORES_FIELDS.direccion] = input.direccionSugerida.trim();

  const created = (await (airtable(PROVEEDORES_TABLE_ID).create as unknown as (
    records: Array<{ fields: Record<string, AField> }>,
    opts: { typecast: boolean },
  ) => Promise<Array<{ id: string }>>)([{ fields }], { typecast: true }));

  return { recordId: created[0].id, nombre: nombreLimpio, esNuevo: true };
}

/** Lectura ligera para la UI: ¿existe ya un proveedor con este NIT? */
export async function buscarProveedorPorNit(nit: string): Promise<{ existe: boolean; recordId?: string; nombre?: string }> {
  if (!airtable) return { existe: false };
  const nitNorm = normalizarNit(nit);
  if (!nitNorm) return { existe: false };
  try {
    const all = await airtable(PROVEEDORES_TABLE_ID)
      .select({ returnFieldsByFieldId: true, fields: [PROVEEDORES_FIELDS.nit, PROVEEDORES_FIELDS.nombre] })
      .all();
    for (const r of all) {
      const nitRecord = String(r.fields[PROVEEDORES_FIELDS.nit] ?? '');
      if (normalizarNit(nitRecord) === nitNorm) {
        return { existe: true, recordId: r.id, nombre: String(r.fields[PROVEEDORES_FIELDS.nombre] ?? '') };
      }
    }
    return { existe: false };
  } catch {
    return { existe: false };
  }
}
