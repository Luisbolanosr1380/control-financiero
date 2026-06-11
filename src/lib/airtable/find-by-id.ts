/**
 * F-050.3 — Helpers de lectura segura por record ID.
 *
 * `airtable(...).find(id)` lee los campos por NOMBRE, no por field ID, así
 * que `record.fields[fldXXX]` siempre devuelve undefined. Para leer por
 * field ID (regla F-047.2) usamos `.select()` + filterByFormula con
 * `RECORD_ID()` — esa función SÍ existe en la sintaxis de fórmulas y su
 * operando no es un field reference, así que NO sufre la limitación de
 * F-050.2 (los `{fldXXX}` en filterByFormula devuelven 0 records).
 *
 * `selectValue()` normaliza valores de singleSelect: el SDK los devuelve
 * a veces como string y a veces como `{id, name, color}` según la versión
 * y el endpoint. Sin esta normalización, comparar `estatus === 'Pendiente'`
 * puede fallar silenciosamente.
 */

import { airtable } from '@/lib/db/airtable';

export interface FoundRecord {
  id: string;
  fields: Record<string, unknown>;
}

export async function findRecordById(tableId: string, recordId: string): Promise<FoundRecord | null> {
  if (!airtable) return null;
  try {
    const records = await airtable(tableId)
      .select({
        returnFieldsByFieldId: true,
        filterByFormula: `RECORD_ID() = '${recordId}'`,
        maxRecords: 1,
      })
      .all();
    if (records.length === 0) return null;
    return { id: records[0].id, fields: records[0].fields as Record<string, unknown> };
  } catch {
    return null;
  }
}

/** Normaliza un campo singleSelect que puede llegar como string o `{id, name, color}`. */
export function selectValue(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'name' in v) {
    const n = (v as { name?: unknown }).name;
    return typeof n === 'string' ? n : '';
  }
  return '';
}
