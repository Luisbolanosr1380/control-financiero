/**
 * F-050 — Lectura de la tabla CUENTAS para el selector del modal.
 *
 * Field IDs reales confirmados via MCP. Usamos returnFieldsByFieldId:true
 * para ser inmunes a renames en Airtable.
 *
 * REGLA F-050.2 (extensión de F-047.2): `filterByFormula` de Airtable
 * NO resuelve field IDs `{fldXXX}` — solo resuelve NOMBRES de campo.
 * Por eso `getCuentasGasto()` reusa `getCuentas()` (lee toda la tabla)
 * y FILTRA EN JS por prefijo de codigo_path. Como los volúmenes son
 * bajos (232 records), el costo es despreciable.
 *
 * El campo "ACTIVO " (con espacio al final) está vacío en muchos records
 * porque Stark nunca marcó esos checkboxes. Implementamos un fallback
 * defensivo: si filtrar por activo=true deja la lista vacía, devolvemos
 * la lista sin ese filtro (solo prefijo). Si Stark eventualmente puebla
 * los checkboxes, el filtro se activa solo.
 */

import { airtable, USE_MOCK } from './airtable';
import { CUENTAS_TABLE_ID, CUENTAS_FIELDS } from '@/lib/contabilidad/cuentas-sistema';
import { dataSource } from '@/lib/config/data-source';
import { sbCuentasRecords } from '@/lib/supabase/records';

export interface Cuenta {
  id: string;
  codigo: string;
  nombre: string;
  activo: boolean;
}

const arrFirst = (v: unknown): string => Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');

export async function getCuentas(): Promise<Cuenta[]> {
  if (dataSource('cuentas') === 'supabase') {
    try {
      const records = await sbCuentasRecords();
      const lista: Cuenta[] = records.map(r => {
        const f = r.fields;
        return {
          id: r.id,
          codigo: arrFirst(f[CUENTAS_FIELDS.codigo_path]).trim(),
          nombre: arrFirst(f[CUENTAS_FIELDS.nombre]).trim(),
          activo: Boolean(f[CUENTAS_FIELDS.activo]),
        };
      });
      lista.sort((a, b) => a.codigo.localeCompare(b.codigo));
      return lista;
    } catch (err) {
      console.warn('cuentas (supabase): lectura falló:', err instanceof Error ? err.message : err);
      return [];
    }
  }
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
        activo: Boolean(f[CUENTAS_FIELDS.activo]),
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
 * Cuentas de gasto: prefijo de codigo_path "5-" o "6-".
 * Filtrado en JS (no en filterByFormula) — los field IDs no se resuelven
 * en la fórmula. Si quedan cuentas marcadas activo=true, se prefieren;
 * si NINGUNA tiene activo=true (caso real: Stark no marcó los checkboxes),
 * se devuelve la lista sin el filtro de activo.
 */
export async function getCuentasGasto(): Promise<Cuenta[]> {
  const todas = await getCuentas();
  const porPrefijo = todas.filter(c => /^[56]-/.test(c.codigo));
  const conActivo = porPrefijo.filter(c => c.activo);
  return conActivo.length > 0 ? conActivo : porPrefijo;
}
