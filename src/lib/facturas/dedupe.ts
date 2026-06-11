/**
 * F-049 — Hashing y detección de duplicados en FACTURAS_IN.
 *
 * Dos niveles de dedupe:
 *  1. file_hash (SHA-256 del PDF crudo): cubre subir el mismo archivo dos
 *     veces, aunque con nombre distinto.
 *  2. doc_key (proveedor_nit + serie + numero + fecha + total): cubre el
 *     caso de tener el mismo DTE descargado dos veces (mismo contenido
 *     factual aunque el PDF sea byte-distinto, p.ej. firma temporal).
 *
 * F-050.2: traemos toda la tabla y filtramos en JS porque filterByFormula
 * NO acepta field IDs (solo nombres) y devuelve 0 records SILENCIOSAMENTE
 * cuando se le pasa un `{fldXXX}`. El volumen (cientos por año, no miles)
 * aguanta sin estrategia más sofisticada.
 */

import { createHash } from 'node:crypto';
import { airtable } from '@/lib/db/airtable';
import { FACTURAS_IN_TABLE_ID, FACTURAS_IN_FIELDS } from '@/lib/airtable/facturas-in-fields';

/** SHA-256 hex del contenido binario. Determinista y rápido (~1ms por MB). */
export function fileContentHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

interface DuplicateCheck {
  existe: boolean;
  recordId?: string;
}

async function buscarPorCampo(fieldId: string, valor: string): Promise<DuplicateCheck> {
  if (!airtable) return { existe: false };
  if (!valor) return { existe: false };

  // F-050.2: el path previo con filterByFormula `{fldXXX} = "..."` era un
  // bug latente. Airtable NO resuelve field IDs en fórmulas (solo nombres)
  // y devuelve 0 records SILENCIOSAMENTE — sin lanzar error. El try/catch
  // nunca disparaba, así que dedupe siempre retornaba `{ existe: false }`
  // y permitía crear duplicados. Ahora traemos todos y filtramos en JS:
  // el volumen de FACTURAS_IN es bajo (cientos por año) y solo leemos un
  // campo, así que la latencia es despreciable.
  try {
    const all = await airtable(FACTURAS_IN_TABLE_ID)
      .select({ returnFieldsByFieldId: true, fields: [fieldId] })
      .all();
    const hit = all.find(r => String(r.fields[fieldId] ?? '') === valor);
    return hit ? { existe: true, recordId: hit.id } : { existe: false };
  } catch {
    return { existe: false };
  }
}

export async function checkDuplicateByHash(hash: string): Promise<DuplicateCheck> {
  return buscarPorCampo(FACTURAS_IN_FIELDS.file_hash, hash);
}

export async function checkDuplicateByDocKey(docKey: string): Promise<DuplicateCheck> {
  return buscarPorCampo(FACTURAS_IN_FIELDS.doc_key, docKey);
}
