/**
 * F-059 — Field IDs de BS_SNAPSHOT (persistencia opcional, fase 2).
 *
 * Cuando un período se CIERRA, se congelan las líneas del Balance
 * General (una fila por línea de MAPEO_BS) para que el histórico no
 * cambie aunque se toquen asientos viejos.
 *
 * IMPORTANTE: `linea` es link a MAPEO_BS (recordId), NO texto. Y
 * `monto_q` es currency, NO string.
 *
 * V1 calcula siempre en vivo; los snapshots se llenan al cerrar.
 */

export const BS_SNAPSHOT_TABLE_ID = 'tblY7FOZrnL537lLH';

export const BS_SNAPSHOT_FIELDS = {
  periodo:      'fldmuLiDmhjgtpEyb',   // singleLineText "YYYY-MM"
  linea:        'fldtG3X5VqF0rV0Hm',   // link a MAPEO_BS (no texto)
  monto_q:      'fldkvOOlZDwsyqdoM',   // currency
  orden:        'flddrszPm0wUtjkE9',   // number
  centro_costo: 'fld36Fm7qlpDnj34R',   // link
  cerrado:      'fldMVkcbBk7bkEn1t',   // checkbox
} as const;
