/**
 * F-057 — Field IDs de ACTIVOS_FIJOS.
 *
 * Tabla creada en la fase prep de F-057. Soporta el motor de depreciación
 * lineal mensual:
 *  · COSTO − VALOR_RESIDUAL = base depreciable.
 *  · cuotaMensual = baseDepreciable / VIDA_UTIL_MESES.
 *  · Depreciacion_Acumulada se actualiza al generar el asiento.
 *  · Valor_en_Libros = COSTO − Deprec_Acum (formula en Airtable).
 *
 * Plano FISCAL (Tasa_Fiscal_Anual_% + Depreciacion_Fiscal_Acum) está
 * bloqueado por el contador (tasas Ley ISR). El motor lo calcula en
 * paralelo SOLO si la tasa está cargada; si no, advierte sin romper.
 *
 * Regla F-047.2: lectura/escritura por field ID.
 */

export const ACTIVOS_FIJOS_TABLE_ID = 'tblrqN4QDVHE2dyDM';

export const ACTIVOS_FIJOS_FIELDS = {
  name:                       'fldlcasyPEYgK6RCy',  // singleLineText
  categoria:                  'fldTHa0wn0rVQmkEd',  // singleSelect
  fecha_adquisicion:          'fldum7G2Ag9QMIpjW',  // date
  costo:                      'fldTbqf4fO17y4oTP',  // currency
  valor_residual:             'fldjzdZi5bj6EGXUA',  // currency
  vida_util_meses:            'fldgSGsFUJD3Scg9B',  // number (contable)
  centro_costo:               'fldQSJBS2f1ilSkJk',  // link a CENTROS_COSTO
  cuenta_activo:              'fldaf0Q4f13005dVz',  // link a CUENTAS
  cuenta_depreciacion:        'fld1s0vHIJpToYHpQ',  // link a CUENTAS (gasto 6-6-x)
  depreciacion_acumulada:     'fldSSEvazgCs09TmX',  // currency
  valor_en_libros:            'fldumI0cZIH16bISW',  // formula COSTO - Deprec_Acum
  tasa_fiscal_anual_pct:      'fldA7nIwZlai6yb4w',  // percent (🔒 contador)
  depreciacion_fiscal_acum:   'fldUuB0tzj1haKSZQ',  // currency (plano fiscal)
  estado:                     'fldHvNb0hFrHx9vek',  // singleSelect
  notas:                      'fldQoLQgozxeTudVg',
} as const;

export type EstadoActivo =
  | 'Activo'
  | 'Totalmente depreciado'
  | 'Dado de baja'
  | 'Vendido'
  | string;
