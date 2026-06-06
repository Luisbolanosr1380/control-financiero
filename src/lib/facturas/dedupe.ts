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
 * filterByFormula es soportado por Airtable sobre singleLineText pero la
 * codificación de comillas escapadas a veces falla. Fallback: traer todos
 * los hashes/doc_keys del año actual y filtrar en JS. El volumen esperado
 * (cientos por año, no miles) lo aguanta sin estrategia más sofisticada.
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

  try {
    // Intento con filterByFormula primero (mucho más rápido cuando funciona).
    const esc = valor.replace(/"/g, '\\"');
    const records = await airtable(FACTURAS_IN_TABLE_ID)
      .select({
        filterByFormula: `{${fieldId}} = "${esc}"`,
        maxRecords: 1,
        returnFieldsByFieldId: true,
      })
      .all();
    if (records.length > 0) return { existe: true, recordId: records[0].id };
    return { existe: false };
  } catch {
    // Fallback: traer y filtrar en JS. La filterByFormula puede fallar si
    // hay caracteres especiales en `valor` o si Airtable no acepta el field
    // ID dentro de la fórmula. El listado completo de hashes pesa poco.
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
}

export async function checkDuplicateByHash(hash: string): Promise<DuplicateCheck> {
  return buscarPorCampo(FACTURAS_IN_FIELDS.file_hash, hash);
}

export async function checkDuplicateByDocKey(docKey: string): Promise<DuplicateCheck> {
  return buscarPorCampo(FACTURAS_IN_FIELDS.doc_key, docKey);
}
