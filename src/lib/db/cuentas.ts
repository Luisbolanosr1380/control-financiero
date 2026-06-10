/**
 * F-050 — Lectura de la tabla CUENTAS para el selector del modal.
 *
 * STUB de coordinación: el brief reservó field IDs `TIPO_ESTADO` y
 * `NATURALEZA_ER` para filtrar cuentas de gasto, pero los IDs reales
 * están pendientes de confirmar via MCP. Mientras tanto cargamos TODAS
 * las cuentas con su código + nombre, y el modal permite que el usuario
 * filtre por código (search). Si Stark usa la convención GT estándar
 * (gastos suelen empezar con 5 o 6), el filtro será natural.
 *
 * Cuando los field IDs estén disponibles, ajustar `getCuentasGasto()`
 * para filtrar server-side por TIPO_ESTADO ⊃ "ER" y NATURALEZA_ER =
 * "Deudora".
 */

import { airtable, TABLES, USE_MOCK } from './airtable';

export interface Cuenta {
  id: string;
  codigo: string;
  nombre: string;
}

// Nombres legacy de los campos de CUENTAS. Si Stark renombró alguno, hay
// que ajustar acá. Cuando los field IDs estén disponibles, migrar a
// returnFieldsByFieldId.
const FC = {
  CODIGO: 'Codigo',
  NOMBRE: 'Nombre',
} as const;

const arrFirst = (v: unknown): string => Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');

export async function getCuentas(): Promise<Cuenta[]> {
  if (USE_MOCK || !airtable) return [];
  try {
    const records = await airtable(TABLES.CUENTAS).select().all();
    const lista: Cuenta[] = records.map(r => {
      const f = r.fields as Record<string, unknown>;
      return {
        id: r.id,
        codigo: arrFirst(f[FC.CODIGO]).trim(),
        nombre: arrFirst(f[FC.NOMBRE]).trim(),
      };
    });
    // Ordenamos por código (lexicográfico) para que el selector tenga
    // estructura predecible. La codificación tipo "5-1-1" se ordena bien
    // como string.
    lista.sort((a, b) => a.codigo.localeCompare(b.codigo));
    return lista;
  } catch (err) {
    console.warn('F-050 cuentas: lectura falló:', err instanceof Error ? err.message : err);
    return [];
  }
}

/** STUB: hasta tener field IDs para TIPO_ESTADO/NATURALEZA_ER, devuelve
 * todas las cuentas. El modal hace el filtro client-side por search. */
export async function getCuentasGasto(): Promise<Cuenta[]> {
  return getCuentas();
}
