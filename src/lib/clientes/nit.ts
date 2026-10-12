/**
 * NIT — comparación entre clientes. PURO (sin IO): lo usan la capa de datos,
 * el modal de alta (cliente), la lista y el validador.
 *
 * Dos clientes activos con el MISMO NIT suelen ser el mismo cliente cargado
 * dos veces (la migración sufrió justo eso), pero no siempre: por eso es un
 * AVISO con confirmación, no un índice único. Quedan fuera del aviso los
 * NIT que se repiten legítimamente: vacío/null, el placeholder "0" y "CF".
 */

/** Solo dígitos y letras, en mayúsculas: "1234567-8" ≡ "12345678" ≡ "1234567 8". */
export const nitComparable = (nit: string | null | undefined): string =>
  String(nit ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');

/** Vacío, "0" (placeholder) o "CF" (consumidor final): se repiten legítimamente. */
export const nitEsPlaceholder = (nitComparado: string): boolean =>
  nitComparado === '' || /^0+$/.test(nitComparado) || nitComparado === 'CF';

export interface ClienteNit { id: string; name: string; nit: string | null | undefined; activo?: boolean }

/** Otro cliente ACTIVO con el mismo NIT comparable (o null). `excluirId` = el cliente que se está editando. */
export function buscarNitDuplicado<T extends ClienteNit>(nit: string | null | undefined, clientes: readonly T[], excluirId?: string): T | null {
  const n = nitComparable(nit);
  if (nitEsPlaceholder(n)) return null;
  return clientes.find(c => c.id !== excluirId && c.activo !== false && nitComparable(c.nit) === n) ?? null;
}

/** id → nombre del OTRO cliente activo que comparte el NIT (para la señal en la lista). */
export function clientesConNitCompartido<T extends ClienteNit>(clientes: readonly T[]): Map<string, string> {
  const porNit = new Map<string, T[]>();
  for (const c of clientes) {
    if (c.activo === false) continue;
    const n = nitComparable(c.nit);
    if (nitEsPlaceholder(n)) continue;
    (porNit.get(n) ?? porNit.set(n, []).get(n)!).push(c);
  }
  const out = new Map<string, string>();
  for (const grupo of porNit.values()) {
    if (grupo.length < 2) continue;
    for (const c of grupo) out.set(c.id, grupo.filter(o => o.id !== c.id).map(o => o.name).join(', '));
  }
  return out;
}

export const AVISO_NIT = (nombre: string) => `Ya existe un cliente con este NIT: ${nombre}`;
