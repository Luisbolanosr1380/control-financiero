/**
 * F-058 — Field IDs de MAPEO_ER (estructura del Estado de Resultados).
 *
 * MAPEO_ER es la tabla DATA-DRIVEN que define las líneas del ER y qué
 * cuentas suma cada una. Reordenar líneas o agregar nuevas se hace en
 * Airtable, NO en código.
 *
 * Regla F-047.2: lectura por field ID con returnFieldsByFieldId.
 *
 * Tipos de línea:
 *  · "Suma cuentas" — agrega el saldo del set `cuentas` con `signo` +/–.
 *  · "Calculada"    — subtotal derivado de otras líneas (UB, EBITDA,
 *                    U.Operativa, U.Neta). El motor las computa por
 *                    fórmula, NO leen cuentas. `signo` viene vacío.
 */

export const MAPEO_ER_TABLE_ID = 'tbl9VZjNwuR52Aamh';

export const MAPEO_ER_FIELDS = {
  linea:             'fld8rfaAj7hU4zVTd',   // singleLineText
  orden:             'fldiM0T1y5oBabTRh',   // number
  tipo:              'fldpXXAO0jpeICRR5',   // singleSelect: "Suma cuentas" | "Calculada"
  cuentas:           'fldrrNu4GqNMYQKha',   // link a CUENTAS (mecanismo real hoy)
  signo:             'fld52LvTRvM9DewxK',   // singleSelect: "+" | "–"
  prefijos:          'fldGxXmJkzJrg09pL',   // singleLineText (fallback futuro, hoy vacío)
  centro_costo_fijo: 'fldjZc4YZgHDvEiz0',   // link a CENTROS_COSTO, opcional
} as const;

export type TipoLineaMapeo = 'Suma cuentas' | 'Calculada';
export type SignoLinea     = '+' | '–' | '';
