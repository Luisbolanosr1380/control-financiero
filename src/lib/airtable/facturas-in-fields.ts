/**
 * F-049 — Field IDs y choices de la tabla FACTURAS_IN.
 *
 * Source of truth para escrituras y lecturas. Aprendizaje F-047.2: nunca leer
 * por nombre. Los nombres en Airtable cambian sin previo aviso y caracteres
 * invisibles (espacios al final, mayúsculas) generan bugs silenciosos.
 *
 * Patrón de uso:
 *   .select({ returnFieldsByFieldId: true }) en lecturas, y
 *   record.fields[FACTURAS_IN_FIELDS.total] en accesos.
 *
 * Escrituras: armar el objeto con las claves de FACTURAS_IN_FIELDS y pasar
 * { typecast: true } para que Airtable auto-cree opciones de singleSelect
 * que aún no existen (Sistema, USD, Factura GT, etc.).
 */

export const FACTURAS_IN_TABLE_ID = 'tbldQdN2YWlHxRf59';

export const FACTURAS_IN_FIELDS = {
  id:                    'fldMNP4wYwo32dj3O',
  fuente:                'fldnnPkVovX6OtBZJ',
  archivo_url:           'fldWD5qV7JxJiYwgn',
  file_hash:             'fldQcjLdC6PMf9VGP',
  doc_key:               'fldwdJeLsnK3uSBFP',
  proveedor_nombre:      'fldPWex70g1n0hjeZ',
  proveedor_nit:         'fldnHbzYuuIiTcQci',
  serie:                 'fldidm9ewWCm2n08p',
  numero:                'fldH3bnVQZWy91Rsb',
  fecha_emision:         'fld5Onf44oyliQRzx',
  moneda:                'fldK78peGq0SAiP4s',
  subtotal:              'fldulNP0PwFuTgKtu',
  iva:                   'fldBoEF8dFBirJ4BB',
  total:                 'fldY5bzxFUr3Zg75C',
  pais:                  'fldx0uMYVqsdnMAUd',
  tipo_doc:              'fldSnF9iRk3sOP74P',
  estatus:               'fldUel2FfrnDEvkkl',
  otros_impuestos:       'fld9K8QZlido77ybR',
  texto_ocr:             'fldNdlyrSOLClDRLh',
  datos_normalizados:    'fldB2saBmcCKNf6c1',
  datos_normalizados_ok: 'fldFeJIucdd8xAhIA',
  // F-049 nuevos (creados vía MCP el 5 jun 2026).
  archivo_adjunto:       'fldGDBdjCtYRf9Dga',
  subido_por:            'fldhYFRFIdSacyOMe',
  fecha_subida:          'fldR7tWYAaza7VCoq',
} as const;

export type FacturaInFieldKey = keyof typeof FACTURAS_IN_FIELDS;

/**
 * Choices confirmadas vía MCP. Las omitidas se auto-crean cuando se escribe
 * con `typecast: true` (Sistema, USD, Factura GT, etc.).
 */
export const FACTURAS_IN_CHOICES = {
  estatus: {
    Pendiente: 'seljQ6SyhYGuluPo3',
  },
  fuente: {
    Drive: 'selUhuZoNXeyi32yw',
  },
  moneda: {
    Q: 'selSCt7oLy8GpcGWf',
  },
  tipo_doc: {
    'Factura GT (DTE)': 'seltcR88elmRSuOkx',
  },
} as const;

/** Estatus operativos válidos (los que la app sabe manejar). */
export type EstatusFacturaIn = 'Pendiente' | 'Validada' | 'Anulada';
