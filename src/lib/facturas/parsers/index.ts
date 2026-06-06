/**
 * F-049 — Selector DTE vs genérico. Implementación REAL pendiente de PARTE B.
 *
 * Hasta que el código Apps Script (parseGT_DTE.gs, codigo.gs, utils.gs) sea
 * portado fielmente a TypeScript, este módulo expone un stub que lanza para
 * que el server action de PARTE E falle de forma explícita (en vez de
 * silenciosamente con campos vacíos). Cuando PARTE B esté lista, las
 * implementaciones reales viven en parser-dte.ts y parser-generico.ts y la
 * heurística de selección queda intacta.
 */

import type { FacturaParseada } from './types';

const PARSER_NO_IMPLEMENTADO =
  'F-049 PARTE B pendiente: el parser DTE/genérico aún no está portado desde el Apps Script. ' +
  'Subir facturas falla intencionalmente hasta que parseGT_DTE.gs y codigo.gs estén en TS.';

/**
 * Devuelve el parser que corresponde según el texto OCR. Heurística confirmada
 * en el brief F-049: si el documento dice "Número de DTE" o "Nit Emisor", es DTE;
 * cualquier otro caso cae al parser genérico.
 */
export function parseFactura(text: string): FacturaParseada {
  if (/N[úu]mero\s+de\s+DTE/i.test(text) || /Nit\s*Emisor/i.test(text)) {
    return parseGT_DTE(text);
  }
  return parseFacturaGenerica(text);
}

export function parseGT_DTE(_text: string): FacturaParseada {
  throw new Error(PARSER_NO_IMPLEMENTADO);
}

export function parseFacturaGenerica(_text: string): FacturaParseada {
  throw new Error(PARSER_NO_IMPLEMENTADO);
}

/**
 * doc_key estable para dedupe lógico (mismo DTE descargado dos veces aunque
 * el PDF sea byte-distinto). Combinación canónica del Apps Script:
 *   NIT_normalizado | serie | numero | fecha | total con 2 decimales
 */
export function buildDocKey(meta: FacturaParseada): string {
  const nit = (meta.proveedor_nit ?? '').replace(/\s+/g, '').toUpperCase();
  const total = Number.isFinite(meta.total) ? meta.total.toFixed(2) : '0.00';
  return `${nit}|${meta.serie}|${meta.numero}|${meta.fecha_emision}|${total}`;
}

export type { FacturaParseada };
