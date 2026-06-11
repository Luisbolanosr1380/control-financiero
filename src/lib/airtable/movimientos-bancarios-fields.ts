/**
 * F-050.1 — Field IDs de la tabla MOVIMIENTOS_BANCARIOS.
 *
 * OJO con caracteres invisibles (lección F-047.2 y F-049):
 *  - El field "REFERENCIA " termina con ESPACIO en Airtable.
 *  - El field "ADJUNTO " termina con ESPACIO en Airtable.
 *  Como leemos/escribimos por field ID con returnFieldsByFieldId: true,
 *  esto NO nos afecta — pero queda documentado.
 *
 * 'periodo' es singleLineText (NO link). Guardar el STRING del nombre
 * del período (ej: "Q1-junio-2026"), no el record ID.
 */

export const MOVIMIENTOS_BANCARIOS_TABLE_ID = 'tblaa3KXSD0z47PkC';

export const MOVIMIENTOS_BANCARIOS_FIELDS = {
  mov_id:             'fldjWgXVq9qm4qejJ',
  banco:              'fldDyNJ9YgSMDPLzE',
  fecha:              'fldAEFT2a2x3NfpD3',
  tipo:               'fld7snJlZqLjHekxy',
  concepto:           'fld364ySCOv4LTfyx',
  referencia:         'fldERVLdBsFqRJXnB',   // "REFERENCIA " (espacio al final)
  monto:              'fldL0rVpDWCZwMX7A',
  periodo:            'fldrUQy6ADznktsYU',
  conciliado:         'fld80sS8EInd9CfZi',
  asiento:            'fldYCscPQBkGRKHNH',
  categoria_sugerida: 'fldHPXntAczdUvhiI',
  adjunto:            'flddTU4lFfr1oUwKu',   // "ADJUNTO " (espacio al final)
} as const;
