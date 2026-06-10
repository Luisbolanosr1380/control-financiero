/**
 * F-050 — Helper de composición de descripciones consistentes.
 *
 * Una descripción legible para el asiento contable que la contadora pueda
 * auditar a posteriori sin abrir el detalle. El formato es deliberadamente
 * verboso (pipe-separated) para que sea grep-able en exports a CSV.
 */

export interface DescripcionInput {
  proveedorNombre: string;
  serie: string;
  numero: string;
  fechaEmision: string;     // YYYY-MM-DD (constructor local en el caller)
  periodoNota?: string;     // Si el período original estaba cerrado y se ajustó.
}

export function composerDescripcion(opts: DescripcionInput): string {
  const partes = [
    `Compra ${opts.proveedorNombre || '(sin nombre)'}`,
    `Factura ${opts.serie || '—'}-${opts.numero || '—'}`,
    `Emitida ${opts.fechaEmision || '—'}`,
  ];
  if (opts.periodoNota) partes.push(opts.periodoNota);
  return partes.join(' | ');
}

/** Texto canónico para la nota de ajuste cuando el período original está cerrado. */
export function notaAjustePeriodo(periodoOriginal: string, periodoDestino: string): string {
  return `Devengado de ${periodoOriginal}, registrado en ${periodoDestino} por cierre contable`;
}
