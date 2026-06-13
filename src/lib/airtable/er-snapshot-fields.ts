/**
 * F-058 — Field IDs de ER_SNAPSHOT (persistencia opcional, fase 2).
 *
 * Cuando un período se CIERRA, se congelan las líneas calculadas del ER
 * (una fila por línea de MAPEO_ER) para que el histórico no cambie aunque
 * se toquen asientos viejos.
 *
 * IMPORTANTE: `linea` es link a MAPEO_ER (recordId), NO string. Y `monto_q`
 * es currency, NO string — pasar number directo al escribir.
 *
 * V1 calcula siempre en vivo; los snapshots se llenan al cerrar el período.
 */

export const ER_SNAPSHOT_TABLE_ID = 'tbl7wmipZE1FzlpKG';

export const ER_SNAPSHOT_FIELDS = {
  periodo:      'fldPZe6wh7UaKA1NS',   // singleLineText "YYYY-MM"
  centro_costo: 'fldwUZ9Tyigd6vSbK',   // link a CENTROS_COSTO
  linea:        'fld9aOaCExRRmuhfE',   // link a MAPEO_ER (NO texto)
  monto_q:      'flds6Oy9kW76YzsXo',   // currency (NO string)
  orden:        'fldAyTxK6S3JoCBQD',   // number
  cerrado:      'fldH87c39sxDoMi10',   // checkbox
} as const;
