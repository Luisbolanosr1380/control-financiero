/**
 * F-049 PARTE B — Parser de facturas DTE (Guatemala, SAT formal).
 *
 * Porting fiel de parseGT_DTE_() del Apps Script. La lógica, el orden de
 * los fallbacks y los regexes se mantienen idénticos para que las pruebas
 * existentes de Stark contra el Script sigan dando el mismo resultado.
 */

import {
  AVOID_BIG_IDS,
  bestMoneyAfter,
  bestMoneyAfterAvoidFromBottom,
  cap1,
  cap2,
  capNear,
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

export function parseGT_DTE(text: string): FacturaParseada {
  const t = String(text || '');
  const tNo = removeDiacritics(t);

  // --- 1) Emisor / Receptor
  const proveedor_nit = normalizeNitGT(cap1(t, /Nit\s*Emisor[:\s]*([0-9A-Z\-]+)/i));
  let proveedor_nombre = pick(
    capNear(t, /(NOMBRE\s*COMERCIAL|RAZ[ÓO]N\s*SOCIAL)[:\s]*([A-ZÁÉÍÓÚÑ0-9\.\- &]+)/i, 2),
    cap1(t, /([A-ZÁÉÍÓÚÑ\.,\-\s&]+)\s+N[UÚ]MERO\s+DE\s+AUTORIZACI[ÓO]N/i),
  ) || '';
  proveedor_nombre = proveedor_nombre.trim();

  const cliente_nit = normalizeNitGT(cap1(t, /NIT\s*Receptor[:\s]*([0-9A-Z\-]+|CF)/i));

  // --- 2) Serie y Número
  const serie = pick(
    cap1(t, /Serie[:\s]*([A-Z0-9\-]+)/i),
    cap1(t, /\bSERIE\s*[:\s]*([A-Z0-9\-]+)/i),
  );
  const numero = pick(
    cap1(t, /N[úu]mero\s+de\s+DTE[:\s]*([A-Z0-9\-]+)/i),
    cap2(t, /(No\.|N[úu]mero|N°)[:\s]*([A-Z0-9\-]+)/i),
  );

  // --- 3) Fecha de emisión
  const fechaLinea = pick(
    cap1(t, /Fecha\s+y\s+hora\s+de\s+emisi[óo]n[:\s]*([^\n\r]+)/i),
    cap1(t, /Fecha\s+de\s+emisi[óo]n[:\s]*([^\n\r]+)/i),
  );
  const mDate = (fechaLinea || '').match(
    /\b(\d{2}-(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)-\d{4}|\d{2}[\/-]\d{2}[\/-]\d{4}|\d{4}-\d{2}-\d{2})\b/i,
  );
  const fecha_emision = normalizeFechaISO(mDate ? mDate[1] : fechaLinea);

  // --- 4) Moneda
  let monedaRaw = cap1(t, /Moneda[:\s]*([A-Z]{2,3})/i);
  if (!monedaRaw) monedaRaw = /\bGTQ\b|\bQ\b/i.test(t) ? 'Q' : /\bUSD\b|US\$|\$/i.test(t) ? 'USD' : 'Q';
  if (monedaRaw.toUpperCase() === 'GTQ') monedaRaw = 'Q';
  const moneda: 'Q' | 'USD' = monedaRaw.toUpperCase() === 'USD' ? 'USD' : 'Q';

  // --- 5) Subtotal e IVA (primero, para validar TOTAL)
  let subtotal: number | null = bestMoneyAfter(tNo, [
    /\bSUBTOTAL\b/i,
    /VALOR\s+ANTES\s+DE\s+IMPUESTOS/i,
  ]);

  // IVA: desde abajo para evitar encabezados / columnas
  let iva: number | null = bestMoneyAfterAvoidFromBottom(
    tNo,
    [/\bIVA\b/i, /IMPUESTO\s+AL\s+VALOR\s+AGREGADO/i, /IVA\s*12%/i],
    null,
  );

  // --- 6) TOTAL (prioridad: etiquetas → total por IVA → fallback)
  const candBlock = totalFromTotalsBlock(tNo); // "TOTALES"
  const candTotal = bestMoneyAfterAvoidFromBottom(
    tNo,
    [/TOTAL\s+A\s+PAGAR/i, /TOTAL\s+GENERAL/i, /\bTOTAL\b/i],
    /IVA/i,
  );
  const candCol = bestMoneyAfterAvoidFromBottom(tNo, [/TOTAL\s*\(\s*Q\s*\)/i], /IVA/i);
  const candIVA = Number.isFinite(iva) && (iva as number) > 0 ? totalFromIvaExactCents(iva) : null;

  // Preferir lo que dice el documento (validado contra IVA/SUBTOTAL).
  let total: number | null = pickConsistentTotal([candBlock, candTotal, candCol], iva, subtotal);

  // Si no hubo etiqueta válida, usar el total reconstruido desde IVA.
  if (!(total && isFinite(total)) && Number.isFinite(candIVA)) {
    total = candIVA;
  }

  // Último recurso: mayor monto en las últimas 50 líneas (sin "IVA", evitando IDs).
  if (!(total && isFinite(total))) {
    total = maxMoneyTailExcludingIva(tNo, AVOID_BIG_IDS, 50);
  }
  total = total != null ? round2(total) : 0;

  // (opcional) completar subtotal si falta y tenemos IVA + TOTAL.
  if (!Number.isFinite(subtotal) && Number.isFinite(iva) && Number.isFinite(total)) {
    subtotal = round2((total as number) - (iva as number));
  }

  // Completa IVA si falta y hay subtotal/total.
  if (!Number.isFinite(iva) && Number.isFinite(subtotal) && Number.isFinite(total)) {
    const diff = round2((total as number) - (subtotal as number));
    if (diff >= 0 && diff <= (total as number)) iva = diff;
  }
  // Aproxima IVA si no hubo subtotal pero sí total y el doc menciona IVA/12%.
  if (!Number.isFinite(subtotal) && /IVA|12%/i.test(t) && Number.isFinite(total) && !Number.isFinite(iva)) {
    const maybeSub = (total as number) / 1.12;
    iva = round2((total as number) - maybeSub);
  }

  return {
    proveedor_nombre,
    proveedor_nit,
    cliente_nit,
    serie: (serie || '').trim(),
    numero: (numero || '').trim(),
    fecha_emision,
    moneda,
    subtotal: Number.isFinite(subtotal) ? round2(subtotal) : null,
    iva: Number.isFinite(iva) ? round2(iva) : 0,
    total: Number.isFinite(total) ? round2(total) : 0,
    pais: 'GT',
    tipo_doc: 'Factura GT (DTE)',
  };
}
