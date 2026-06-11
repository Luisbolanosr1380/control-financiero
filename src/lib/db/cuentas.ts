/**
 * F-050 — Lectura de la tabla CUENTAS para el selector del modal.
 *
 * Field IDs reales confirmados via MCP. Usamos returnFieldsByFieldId:true
 * para ser inmunes a renames en Airtable. El filtro de cuentas de gasto
 * se hace server-side con filterByFormula por prefijo de codigo_path
 * (5- o 6-) y activo=TRUE(). El TRIM es crítico porque algunos
 * codigo_path tienen "\n" al inicio/fin.
 */

import { airtable, USE_MOCK } from './airtable';
import { CUENTAS_TABLE_ID, CUENTAS_FIELDS } from '@/lib/contabilidad/cuentas-sistema';

export interface Cuenta {
  id: string;
  codigo: string;
  nombre: string;
}

const arrFirst = (v: unknown): string => Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');

export async function getCuentas(): Promise<Cuenta[]> {
  if (USE_MOCK || !airtable) return [];
  try {
    const records = await airtable(CUENTAS_TABLE_ID)
      .select({ returnFieldsByFieldId: true })
      .all();
    const lista: Cuenta[] = records.map(r => {
      const f = r.fields as Record<string, unknown>;
      return {
        id: r.id,
        codigo: arrFirst(f[CUENTAS_FIELDS.codigo_path]).trim(),
        nombre: arrFirst(f[CUENTAS_FIELDS.nombre]).trim(),
      };
    });
    lista.sort((a, b) => a.codigo.localeCompare(b.codigo));
    return lista;
  } catch (err) {
    console.warn('F-050 cuentas: lectura falló:', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Cuentas de gasto: filtrado server-side por prefijo de codigo_path
 * ("5-" o "6-") y activo=TRUE(). El TRIM es crítico porque algunos
 * codigo_path tienen "\n" al inicio y fin.
 */
export async function getCuentasGasto(): Promise<Cuenta[]> {
  if (USE_MOCK || !airtable) return [];
  try {
    const records = await airtable(CUENTAS_TABLE_ID)
      .select({
        returnFieldsByFieldId: true,
        filterByFormula: `AND(
    OR(LEFT(TRIM({${CUENTAS_FIELDS.codigo_path}}), 2)="5-",
       LEFT(TRIM({${CUENTAS_FIELDS.codigo_path}}), 2)="6-"),
    {${CUENTAS_FIELDS.activo}}=TRUE()
  )`,
      })
      .all();
    const lista: Cuenta[] = records.map(r => {
      const f = r.fields as Record<string, unknown>;
      return {
        id: r.id,
        codigo: arrFirst(f[CUENTAS_FIELDS.codigo_path]).trim(),
        nombre: arrFirst(f[CUENTAS_FIELDS.nombre]).trim(),
      };
    });
    lista.sort((a, b) => a.codigo.localeCompare(b.codigo));
    return lista;
  } catch (err) {
    console.warn('F-050 cuentas gasto: lectura falló:', err instanceof Error ? err.message : err);
    return [];
  }
}
