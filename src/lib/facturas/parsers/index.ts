/**
 * F-049 — Selector DTE vs genérico.
 *
 * Heurística confirmada en el brief y en el wrapper `parseFactura()` del
 * Apps Script (codigo.gs): si el documento dice "Número de DTE" o "Nit
 * Emisor", es DTE; cualquier otro caso cae al parser genérico.
 *
 * Las implementaciones reales viven en parser-dte.ts y parser-generico.ts.
 * `buildDocKey` se re-exporta desde utils.ts (donde está la versión
 * canónica con cascada por completitud de datos).
 */

import { parseGT_DTE } from './parser-dte';
import { parseFacturaGenerica } from './parser-generico';
import type { FacturaParseada } from './types';

export { parseGT_DTE } from './parser-dte';
export { parseFacturaGenerica } from './parser-generico';
export { buildDocKey } from './utils';
export type { FacturaParseada };

export function parseFactura(text: string): FacturaParseada {
  const t = String(text || '');
  if (/N[úu]mero\s+de\s+DTE/i.test(t) || /Nit\s*Emisor/i.test(t)) {
    return parseGT_DTE(t);
  }
  return parseFacturaGenerica(t);
}
