/**
 * F-049 — Tipo común que devuelve el parser (DTE o genérico).
 *
 * Espejo del schema mínimo necesario para landear en FACTURAS_IN con
 * estatus Pendiente. Campos derivados (doc_key, file_hash) NO van acá —
 * se computan en el pipeline.
 */

export interface FacturaParseada {
  proveedor_nombre: string;
  proveedor_nit: string;
  cliente_nit: string;
  serie: string;
  numero: string;
  /** Formato canónico YYYY-MM-DD. Vacío si el parser no pudo extraerla. */
  fecha_emision: string;
  moneda: 'Q' | 'USD';
  subtotal: number | null;
  iva: number;
  total: number;
  pais: 'GT';
  tipo_doc: 'Factura GT (DTE)' | 'Factura GT';
}
