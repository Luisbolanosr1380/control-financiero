/**
 * F-059 — Field IDs de MAPEO_BS (estructura del Balance General).
 *
 * Gemelo de MAPEO_ER. Mismos tipos de línea ("Suma cuentas" /
 * "Calculada"). El motor de Balance General lee esta tabla para saber
 * qué cuentas suma cada línea y con qué signo.
 *
 * Particularidades documentadas:
 *  · `linea` viene con saltos de línea sucios en algunos records
 *    (lección histórica de Airtable singleLineText). SIEMPRE .trim()
 *    al leer.
 *  · `signo` también puede venir como "\n+\n" o "\n–\n". SIEMPRE
 *    normalizar con .trim() antes de comparar.
 *  · `cuentas` (link a CUENTAS) es el mecanismo real. `prefijos`
 *    es fallback documentado para futuro.
 *
 * Regla F-047.2: lectura por field ID con returnFieldsByFieldId.
 */

export const MAPEO_BS_TABLE_ID = 'tblFTdnObEZMwe99M';

export const MAPEO_BS_FIELDS = {
  linea:              'fldaLtW65UcxZVrCS',  // singleLineText (TRIM)
  orden:              'fldLeRSv5PZAX0mEn',  // number
  tipo:               'fldEfpoKwsufc2cYU',  // singleSelect: "Suma cuentas" | "Calculada"
  cuentas:            'fldXp5597W8nYrgQz',  // link a CUENTAS
  signo:              'fldh7C4vhALMq2OQk',  // singleLineText "+"/"–" (TRIM)
  prefijos:           'fldiHzU7OYzsHele4',  // singleLineText (fallback)
  centro_costo_fijo:  'fldRELZWas6EOlJCQ',  // link a CENTROS_COSTO, opcional
  bs_snapshot:        'fldaHHwNlrv9QQfYL',  // link a BS_SNAPSHOT (back-link)
} as const;

export type TipoLineaMapeoBS = 'Suma cuentas' | 'Calculada';
export type SignoLineaBS     = '+' | '–' | '';
