/**
 * AUROS — guardas sobre la respuesta del modelo. PURO.
 *
 * "NUNCA inventás números" no puede depender solo del prompt: si el modelo
 * responde montos sin haber llamado ninguna tool en el turno, y esos montos
 * tampoco estaban en la conversación previa, la ruta fuerza una ronda de tools.
 */
import type { CoreMessage } from 'ai';

/** Montos "Q…" de la respuesta que no aparecen en ningún mensaje previo de la conversación. */
export function cifrasNuevas(texto: string, historial: CoreMessage[]): string[] {
  const MONTO = /Q\s?\d[\d,]*(?:\.\d+)?/g;
  const normal = (c: string) => c.replace(/^Q\s?/, '').replace(/,/g, '').replace(/\.0+$/, '');
  const previas = new Set(historial.flatMap(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).match(MONTO) ?? []).map(normal));
  // Q0 también cuenta: "cerró en Q0" sin haber consultado nada es tan inventado como cualquier otro monto.
  return (texto.match(MONTO) ?? []).filter(c => !previas.has(normal(c)));
}
