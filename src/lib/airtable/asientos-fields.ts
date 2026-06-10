/**
 * F-050 — Field IDs de ASIENTOS y PARTIDAS.
 *
 * Asiento = encabezado del libro diario. Partidas = líneas Dr/Cr.
 * Regla contable: sum(debe) === sum(haber) por asiento.
 */

export const ASIENTOS_TABLE_ID = 'tblBrFzHGpxHyoeF0';

export const ASIENTOS_FIELDS = {
  no_asiento:    'fldeGCtktcElcvfEn',
  asiento_ref:   'fldzpEUF4b9WolXSM',
  fecha_asiento: 'fldj1lEVKCsjFAhQ2',
  periodo:       'fldWIkB78Y3skc0vo',
  origen:        'fldm9KibxXxQkoai6',
  centro_costo:  'flddDKVeL9C4ig6Qk',
  proveedor:     'fldldH2ILN1pv5MBP',
  banco:         'fldKi81xxvROQC7k3',
  descripcion:   'fldQ6yHmQmLpFjCyV',
  adjunto:       'fldZ2UPTBX37vOkDn',
  partidas:      'fldYBwQgIuJBQGfO5',
  gastos:        'fldYNh51L5e6ovSQs',
} as const;

export type AsientoFieldKey = keyof typeof ASIENTOS_FIELDS;

/** Valores conocidos del singleSelect ORIGEN en ASIENTOS. */
export type OrigenAsiento = 'FACTURA COMPRA' | 'FACTURA VENTA' | 'PAGO' | 'COBRO' | 'AJUSTE' | string;

export const PARTIDAS_TABLE_ID = 'tbleYuPiXYtrYc43p';

export const PARTIDAS_FIELDS = {
  asiento:           'fldKBI5dgzbSaYKOc',
  cuenta:            'fldC2wSmPd0Z1VRKG',
  centro_costo:      'fldBF0ERcn4cuMDa6',
  descripcion_linea: 'fldCnrH8KsKtlP33c',
  debe:              'fldJkiHfxrQMuGoF8',
  haber:             'fldGm27bYeiZQHW61',
  moneda:            'fldPRAWqZ5HKNYFjF',
  tc:                'fldvj5Q89Kanw3AaO',
  periodo:           'fld0RqzBDeX8lavcf',
  proveedor:         'fldCfbgPVZOYabzzg',
  banco:             'fldHXs45mg6nvNiUf',
} as const;

export type PartidaFieldKey = keyof typeof PARTIDAS_FIELDS;
