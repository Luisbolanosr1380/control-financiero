/**
 * DETALLE DIGITAL (029) · contenido firmado y su huella — PURO (sin IO, sin secretos). SOLO SERVIDOR por usar node:crypto
 * (la huella corta para mostrar vive en publico.ts, que sí va al navegador).
 *
 * La huella (`documento_hash`) es el sha256 del JSON canónico de la versión que se envía: correlativo, versión,
 * NIT, las líneas (identificadas por su componente, con persona, servicio, categoría, territorio y monto) y los
 * totales. Se calcula al emitir el link (queda en el link), se recalcula al responder (si no coincide, el detalle
 * cambió entre el envío y la respuesta: se rechaza y hay que reenviar) y es la "huella" que imprime el PDF.
 */
import { createHash } from 'node:crypto';

export interface LineaFirmable { componenteId: string; persona: string; servicio: string; categoria: string; territorio: string; monto: number }
export interface DocumentoFirmable { correlativo: string; version: number; nit: string; lineas: LineaFirmable[]; subtotal: number; iva: number; total: number }

const r2 = (n: number) => Math.round(Number(n) * 100) / 100;
const t = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** JSON canónico: claves fijas en orden fijo, líneas ordenadas por componente, montos a 2 decimales. */
export function canonicoDocumento(d: DocumentoFirmable): string {
  const lineas = [...d.lineas].map(l => ({ componenteId: t(l.componenteId), persona: t(l.persona), servicio: t(l.servicio), categoria: t(l.categoria), territorio: t(l.territorio), monto: r2(l.monto) }))
    .sort((a, b) => a.componenteId.localeCompare(b.componenteId));
  return JSON.stringify({ correlativo: t(d.correlativo), version: Number(d.version), nit: t(d.nit), lineas, subtotal: r2(d.subtotal), iva: r2(d.iva), total: r2(d.total) });
}

export const hashDocumento = (d: DocumentoFirmable): string => createHash('sha256').update(canonicoDocumento(d), 'utf8').digest('hex');
export { huellaCorta } from './publico';
