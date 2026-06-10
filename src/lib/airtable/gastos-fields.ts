/**
 * F-050 — Field IDs y constantes de la tabla GASTOS.
 *
 * Regla F-047.2: nunca por nombre. Patrón:
 *   .select({ returnFieldsByFieldId: true })
 *   record.fields[GASTOS_FIELDS.total]
 *
 * Escrituras: armar el objeto con las claves de GASTOS_FIELDS y pasar
 * `{ typecast: true }` para que Airtable auto-cree opciones nuevas de
 * singleSelect (TIPO_OPERATIVO, ESTADO, etc.).
 */

export const GASTOS_TABLE_ID = 'tblv6o6qA8fw3sH56';

export const GASTOS_FIELDS = {
  gasto_id:           'fldzbWb6BbODTXOAd',
  fecha:              'fldgtEqCaG9U6CDv7',
  proveedor:          'fldMElY6hQ2wkim2H',
  categoria_gasto:    'fld1852vRx0BDT1NA',  // link a CUENTAS
  base:               'fldLFVRGON7ypSjEO',
  iva:                'fldNnveuUyMwSdxWf',
  total:              'fldbXHLXiu8nj7Emy',
  metodo_pago:        'fldOzoByNMjs7pyxM',
  centro_costo:       'fldb7eMQF4VVLij5M',
  banco:              'fldzoHhveJWHx04nO',
  referencia_pago:    'fldOX5wAP2WYpVeLW',
  adjunto:            'fldhqRq3J9VUNnRdU',
  estado:             'fldVjs6xw57e4MNrM',
  asiento:            'fldIhosk4XmlABWPv',
  // F-050 nuevos (creados vía MCP el 6 jun 2026).
  tipo_operativo:     'fld3d259HPUGZwU2M',
  factura_in_origen:  'fldNxwic1fxMdZb0J',
  fecha_vencimiento:  'fldFgEKciWxBxeDqZ',
  motivo_anulacion:   'fld2HIbe6yL8Vr8jz',
  fecha_aprobacion:   'fldlP9V81OhrsKWt9',
  aprobado_por:       'fldMkq4XS8yCgyPF5',
} as const;

export type GastoFieldKey = keyof typeof GASTOS_FIELDS;

/** Valores válidos del singleSelect ESTADO en GASTOS. */
export type EstadoGasto = 'Por pagar' | 'Pagado' | 'Anulado' | string;

/** Valores válidos del singleSelect METODO_PAGO. */
export type MetodoPagoGasto = 'Contado' | 'Plazo';

/** Valores válidos del singleSelect TIPO_OPERATIVO. */
export type TipoOperativo = 'Operativo' | 'No Operativo';
