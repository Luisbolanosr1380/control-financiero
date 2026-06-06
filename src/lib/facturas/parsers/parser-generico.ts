/**
 * F-049 PARTE B — Parser de facturas genéricas (no-DTE, Guatemala u otro).
 *
 * Porting fiel de parseFacturaGenerica_() de codigo.gs del Apps Script.
 *
 * Diferencia vs el Script: el hook `guessProveedorFromHeader_` que el .gs
 * llamaba con typeof check NO existe en los .gs originales (era una rama
 * opcional). En TS dejamos `proveedor_nombre = pick(...) || ''` sin esa
 * extensión; si más adelante se necesita, se agrega como parámetro.
 */

import {
  AVOID_BIG_IDS,
  bestMoneyAfter,
  bestMoneyAfterAvoidFromBottom,
  cap1,
  cap2,
  cap3,
  capNear,
  capSpanishDate,
  maxMoneyTailExcludingIva,
  normalizeFechaISO,
  normalizeNitGT,
  pick,
  pickConsistentTotal,
  removeDiacritics,
  round2,
  totalFromIvaExactCents,
  totalFromTotalsBlock,
} from './utils';
import type { FacturaParseada } from './types';

export function parseFacturaGenerica(text: string): FacturaParseada {
  const raw = String(text || '');
  const t = raw.replace(/\r/g, '');
  const tNo = removeDiacritics(t);

  // --- 1) Proveedor / Cliente (nombre y NIT)
  const proveedor_nit_raw = pick(
    capNear(t, /(EMISOR|PROVEEDOR|VENDEDOR|EMITENTE)\b[\s\S]{0,80}?NIT[:\s]*([0-9\-]+|CF)/i, 2),
    cap1(t, /NIT\s*(?:EMISOR|PROVEEDOR)[:\s]*([0-9\-]+|CF)/i),
    cap1(t, /NIT[:\s]*([0-9\-]+|CF)/i),
  );
  const cliente_nit_raw = pick(
    capNear(t, /(RECEPTOR|CLIENTE|COMPRADOR)\b[\s\S]{0,80}?NIT[:\s]*([0-9\-]+|CF)/i, 2),
    cap1(t, /NIT\s*(?:RECEPTOR|CLIENTE)[:\s]*([0-9\-]+|CF)/i),
  );
  const proveedor_nombre = pick(
    capNear(t, /(EMISOR|PROVEEDOR|VENDEDOR|EMITENTE)[:\s]*([A-ZÁÉÍÓÚÑ0-9\.\- &]+)/i, 2),
    capNear(t, /(NOMBRE\s*COMERCIAL|RAZ[ÓO]N\s*SOCIAL)[:\s]*([A-ZÁÉÍÓÚÑ0-9\.\- &]+)/i, 2),
  ) || '';

  // --- 2) Serie y Número
  const serie = pick(
    cap1(t, /\bSERIE[:\s]*([A-Z0-9\-]+)/i),
    cap1(t, /\bSERIE\s*([A-Z0-9\-]+)/i),
  );
  const numero =
    pick(
      cap2(t, /(No\.|N[úu]mero|N°)[:\s]*([A-Z0-9\-]+)/i),
      cap2(t, /(FACTURA|DOCUMENTO)\s*(No\.|N[úu]mero|N°)[:\s]*([A-Z0-9\-]+)/i),
      cap1(t, /\bFACTURA\s*(?:No\.|N[úu]mero|N°)[:\s]*([A-Z0-9\-]+)/i),
      cap1(t, /\bDOCUMENTO\s*(?:No\.|N[úu]mero|N°)[:\s]*([A-Z0-9\-]+)/i),
    ) ||
    cap3(t, /(SERIE)[:\s]*[A-Z0-9\-]+[\s\/\-_,]*?(No\.|N[úu]mero|N°)[:\s]*([A-Z0-9\-]+)/i);

  // --- 3) Fecha de emisión
  const fecha_raw = pick(
    cap1(t, /\b(\d{2}\/\d{2}\/\d{4})\b/),
    cap1(t, /\b(\d{4}-\d{2}-\d{2})\b/),
    cap1(t, /\b(\d{2}-\d{2}-\d{4})\b/),
    capSpanishDate(t),
  );
  const fecha_emision = normalizeFechaISO(fecha_raw);

  // --- 4) Subtotal e IVA primero (para validar el total más adelante)
  let subtotal: number | null = bestMoneyAfter(tNo, [
    /\bSUBTOTAL\b/i,
    /VALOR\s+ANTES\s+DE\s+IMPUESTOS/i,
  ]);

  const iva: number | null = bestMoneyAfter(tNo, [
    /\bIVA\b/i,
    /IMPUESTO\s+AL\s+VALOR\s+AGREGADO/i,
    /IVA\s*12%/i,
  ]);

  // --- 5) TOTAL (prioridad: bloque TOTALES → TOTAL(Q) desde abajo → TOTAL desde abajo → total a partir del IVA → fallback en "tail")
  const candBlock = totalFromTotalsBlock(tNo); // "TOTALES" (ventana 4 líneas)
  const candTotal = bestMoneyAfterAvoidFromBottom(
    tNo,
    [/TOTAL\s+A\s+PAGAR/i, /TOTAL\s+GENERAL/i, /\bTOTAL\b/i],
    /IVA/i,
  );
  const candCol = bestMoneyAfterAvoidFromBottom(tNo, [/TOTAL\s*\(\s*Q\s*\)/i], /IVA/i);
  const candIVA = Number.isFinite(iva) && (iva as number) > 0 ? totalFromIvaExactCents(iva) : null;

  // Preferir lo que dice el documento (validado contra IVA/SUBTOTAL)
  let total: number | null = pickConsistentTotal([candBlock, candTotal, candCol], iva, subtotal);

  // Si no hubo etiqueta válida, usa el total reconstruido desde IVA
  if (!(total && isFinite(total)) && Number.isFinite(candIVA)) {
    total = candIVA;
  }

  // Último recurso
  if (!(total && isFinite(total))) {
    total = maxMoneyTailExcludingIva(tNo, AVOID_BIG_IDS, 50);
  }
  total = total != null ? round2(total) : 0;

  // (opcional) completa subtotal si falta y tenemos IVA + TOTAL
  if (!Number.isFinite(subtotal) && Number.isFinite(iva) && Number.isFinite(total)) {
    subtotal = round2((total as number) - (iva as number));
  }

  // --- 6) Moneda
  const moneda: 'Q' | 'USD' = /\bQ(?![A-Za-z])|\bGTQ\b/i.test(t)
    ? 'Q'
    : /\bUSD\b|US\$|\$/i.test(t)
      ? 'USD'
      : 'Q';

  // --- 7) Salida
  return {
    proveedor_nombre: (proveedor_nombre || '').trim(),
    proveedor_nit: normalizeNitGT(proveedor_nit_raw),
    cliente_nit: normalizeNitGT(cliente_nit_raw),
    serie: (serie || '').trim(),
    numero: (numero || '').trim(),
    fecha_emision,
    moneda,
    subtotal: Number.isFinite(subtotal) ? round2(subtotal) : null,
    iva: Number.isFinite(iva) ? round2(iva) : 0,
    total: Number.isFinite(total) ? round2(total) : 0,
    pais: 'GT',
    tipo_doc: 'Factura GT',
  };
}
