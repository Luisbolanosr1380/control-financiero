/**
 * F-049.2 PARTE B — Validación cruzada Gemini vs parser regex.
 *
 * El parser regex (F-049 PARTE B) NO se elimina. Acá lo usamos como
 * "segundo opinador" sobre el texto OCR para detectar cuándo Gemini
 * inventó o erró un campo. Si ambos coinciden en NIT, fecha, total, serie
 * y número, marcamos `datos_normalizados_ok=true` para que F-050 sepa qué
 * facturas pueden auto-aprobarse sin revisión humana.
 *
 * Tolerancia: 0.02 en total (acumulación de redondeo). Strings comparados
 * exactos (uppercase para serie por convención).
 */

import { parseFactura } from './parsers';
import type { FacturaParseada } from './parsers/types';
import type { FacturaExtraida } from './gemini-extractor';

export interface ValidacionCruzada {
  total_match: boolean;
  nit_match: boolean;
  fecha_match: boolean;
  serie_match: boolean;
  numero_match: boolean;
  notas: string[];
}

const TOLERANCIA_TOTAL = 0.02;

export function validarConRegex(extraida: FacturaExtraida): ValidacionCruzada {
  const parsedRegex: FacturaParseada = parseFactura(extraida.texto_ocr_completo);
  const datos = extraida.datos;

  const result: ValidacionCruzada = {
    total_match: Math.abs((parsedRegex.total || 0) - datos.total) < TOLERANCIA_TOTAL,
    nit_match: parsedRegex.proveedor_nit === datos.proveedor_nit,
    fecha_match: parsedRegex.fecha_emision === datos.fecha_emision,
    serie_match: (parsedRegex.serie || '').toUpperCase() === (datos.serie || '').toUpperCase(),
    numero_match: parsedRegex.numero === datos.numero,
    notas: [],
  };

  if (!result.total_match) {
    result.notas.push(`Discrepancia en total: Gemini=${datos.total}, Regex=${parsedRegex.total}`);
  }
  if (!result.nit_match && parsedRegex.proveedor_nit) {
    result.notas.push(`Discrepancia en NIT: Gemini=${datos.proveedor_nit}, Regex=${parsedRegex.proveedor_nit}`);
  }
  if (!result.fecha_match && parsedRegex.fecha_emision) {
    result.notas.push(`Discrepancia en fecha: Gemini=${datos.fecha_emision}, Regex=${parsedRegex.fecha_emision}`);
  }
  if (!result.serie_match && parsedRegex.serie) {
    result.notas.push(`Discrepancia en serie: Gemini=${datos.serie}, Regex=${parsedRegex.serie}`);
  }
  if (!result.numero_match && parsedRegex.numero) {
    result.notas.push(`Discrepancia en número: Gemini=${datos.numero}, Regex=${parsedRegex.numero}`);
  }

  return result;
}

/**
 * Helper para la decisión `datos_normalizados_ok`: true si TODOS los
 * matches booleanos son true (las notas no afectan; son explicación).
 */
export function todosLosMatches(v: ValidacionCruzada): boolean {
  return v.total_match && v.nit_match && v.fecha_match && v.serie_match && v.numero_match;
}
