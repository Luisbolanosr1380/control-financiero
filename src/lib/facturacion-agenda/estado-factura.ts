/**
 * ESTADO DE FACTURA · definición única de "factura cobrada" (026). Puro.
 *
 * `facturas_clientes.estado` se guarda A PROPÓSITO con un espacio al final ("COBRADO ", "COBRADO PARCIAL ",
 * "PENDIENTE "), igual que en Airtable. Toda comparación pasa por `estadoFacturaCanon` (trim + upper):
 * nunca comparar el estado crudo. Espejo de la función SQL `facturacion_factura_cobrada` (026): una factura
 * está cobrada cuando TODAS sus líneas vivas (no ANULADO / REFACTURADO) están COBRADO/COBRADA y hay al
 * menos una. CONTABILIZADO no es estado de factura en estas bases (es de movimientos bancarios), así que
 * no cuenta como cobrado; si algún día aparece, se agrega acá y en la función SQL.
 */

export const ESTADOS_FACTURA_COBRADA = ['COBRADO', 'COBRADA'] as const;
/** Líneas que no cuentan al decidir si la factura está cobrada (anuladas / refacturadas). */
export const ESTADOS_FACTURA_INACTIVA = ['ANULADO', 'ANULADA', 'REFACTURADO', 'REFACTURADA'] as const;

export const estadoFacturaCanon = (estado: unknown): string => String(estado ?? '').trim().toUpperCase();

export const esLineaCobrada = (estado: unknown): boolean => (ESTADOS_FACTURA_COBRADA as readonly string[]).includes(estadoFacturaCanon(estado));
export const esLineaInactiva = (estado: unknown): boolean => (ESTADOS_FACTURA_INACTIVA as readonly string[]).includes(estadoFacturaCanon(estado));

/** true si la factura (todas sus líneas) está cobrada: al menos una línea cobrada y ninguna viva sin cobrar. */
export function facturaCobrada(estadosLineas: readonly unknown[]): boolean {
  const vivas = estadosLineas.filter(e => !esLineaInactiva(e));
  return vivas.length > 0 && vivas.every(esLineaCobrada);
}

/** Números de factura cobrados a partir de las líneas `{ no_factura, estado }` (agrupa por número). */
export function facturasCobradas(lineas: readonly { no_factura: string; estado: unknown }[]): Set<string> {
  const porFactura = new Map<string, unknown[]>();
  for (const l of lineas) { const arr = porFactura.get(l.no_factura) ?? []; arr.push(l.estado); porFactura.set(l.no_factura, arr); }
  return new Set([...porFactura].filter(([, estados]) => facturaCobrada(estados)).map(([nf]) => nf));
}
