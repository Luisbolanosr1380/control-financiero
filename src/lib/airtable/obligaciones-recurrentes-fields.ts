/**
 * F-051 — Field IDs de OBLIGACIONES_RECURRENTES.
 *
 * Tabla creada vía MCP. Representa compromisos de pago RECURRENTES (renta,
 * tarjetas, servicios, suscripciones, impuestos) que se proyectan en el
 * cash-flow planner pero NO generan asientos contables hasta que llega la
 * factura real (F-049/F-050). Son PROYECCIÓN, no gasto.
 *
 * Regla F-047.2: leer y escribir SIEMPRE por field ID con returnFieldsByFieldId.
 */

export const OBLIGACIONES_RECURRENTES_TABLE_ID = 'tblODJxEUG8Rp3cPD';

export const OBLIGACIONES_RECURRENTES_FIELDS = {
  nombre:          'fldpxeAUgl6SuHFzK',  // primary
  tipo:            'fld6AWjsTQc3TXqL6',  // singleSelect
  monto_estimado:  'fld7l9lZUbVqjV3tR',  // currency
  dia_pago:        'fldYPY7dv87AhgzJp',  // number 1-31
  frecuencia:      'fldg5IYvin34iE86O',  // singleSelect
  prioridad:       'flduaniwzlucGEOcL',  // singleSelect
  proveedor:       'fld9gCMjiJWcCLKAd',  // link a PROVEEDORES
  acreedor:        'fldBKuhH2codhggQE',  // link a ACREEDORES
  centro_costo:    'fldYw5XLyTk7UIkzt',  // link a CENTROS_COSTO
  cuenta_contable: 'flduJ9RvSN09NEgKo',  // link a CUENTAS
  banco_pago:      'fldU5pr4D3nTEt2RB',  // link a BANCOS
  mes_referencia:  'fldNckZOZs4bEL1gV',  // date — ancla para ciclos >mensual
  activo:          'fldlKRRLjPvclokQe',  // checkbox
  notas:           'fldSgV1hYC0lsRGXX',  // long text
  // F-051.2: vigencia opcional. Si fecha_inicio existe, la obligación no
  // genera eventos antes de esa fecha. Si fecha_fin existe, no genera
  // después. Ambos vacíos = sin límite.
  fecha_inicio:    'fldQ3NnQ3HL4tp3U2',  // date opcional
  fecha_fin:       'fldzXwVWjr1CgDqdU',  // date opcional
  // F-051.6: empresa que asume el pago. HIT/Poligrafy son intercompany —
  // la plata sale de la caja de Golden pero contablemente no es gasto
  // propio (es CxC vs la otra empresa). Default Golden Talent.
  por_cuenta_de:   'fldkuLXmo2MsBLaof',  // singleSelect
} as const;

export type TipoObligacion = 'Renta' | 'Servicio' | 'Tarjeta' | 'Seguro' | 'Suscripción' | 'Impuesto' | 'Otro';
export const TIPOS_OBLIGACION: readonly TipoObligacion[] = [
  'Renta', 'Servicio', 'Tarjeta', 'Seguro', 'Suscripción', 'Impuesto', 'Otro',
];

export type FrecuenciaObligacion = 'Mensual' | 'Quincenal' | 'Bimestral' | 'Trimestral' | 'Anual';
export const FRECUENCIAS_OBLIGACION: readonly FrecuenciaObligacion[] = [
  'Mensual', 'Quincenal', 'Bimestral', 'Trimestral', 'Anual',
];

export type PrioridadObligacion = 'Crítica' | 'Alta' | 'Media' | 'Baja';
export const PRIORIDADES_OBLIGACION: readonly PrioridadObligacion[] = [
  'Crítica', 'Alta', 'Media', 'Baja',
];

/**
 * F-051.6: empresa que asume el pago.
 * - "Golden Talent" → gasto propio (default).
 * - "HIT" / "Poligrafy" → intercompany: la plata sale de la caja de
 *   Golden pero contablemente es CxC contra la otra empresa, NO gasto.
 *   El cash-flow planner igual lo cuenta porque la liquidez SÍ sale.
 * - "Otra" → fallback genérico.
 */
export type PorCuentaDe = 'Golden Talent' | 'HIT' | 'Poligrafy' | 'Otra';
export const POR_CUENTA_DE_OPCIONES: readonly PorCuentaDe[] = [
  'Golden Talent', 'HIT', 'Poligrafy', 'Otra',
];
export const POR_CUENTA_DE_DEFAULT: PorCuentaDe = 'Golden Talent';
