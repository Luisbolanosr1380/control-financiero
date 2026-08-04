/**
 * FASE 2 — Helper de escritura a Supabase.
 *
 * Reglas:
 *  - La UI y las server actions siguen hablando en record ids de la app
 *    (airtable_id, incluidos los sintéticos 'sbw…' de filas nacidas en
 *    Supabase). Acá se resuelven a uuid ANTES de insertar; las FK se
 *    guardan como uuid.
 *  - Operaciones multi-tabla → funciones RPC de Postgres
 *    (supabase/04_fase2_writes.sql): una llamada = una transacción.
 *    Si falla cualquier parte, NADA se escribe.
 *  - Después de escribir, invalidar el id-bridge para que las filas
 *    nuevas resuelvan de inmediato.
 */

import { supabase } from './client';
import { uuidDe, invalidarBridge } from './id-bridge';

/** id sintético estilo Airtable para filas creadas del lado TS (single inserts). */
export function nuevoIdEscritura(): string {
  return 'sbw' + crypto.randomUUID().replace(/-/g, '').slice(0, 14);
}

/** airtable_id/record-id de la app → uuid. Lanza si no resuelve. */
export async function uuidRequerido(tabla: string, appId: string, contexto: string): Promise<string> {
  const u = await uuidDe(tabla, appId);
  if (!u) throw new Error(`${contexto}: id "${appId}" no existe en ${tabla} (Supabase).`);
  return u;
}

/** airtable_id/record-id → uuid o null (para FKs opcionales). */
export async function uuidOpcional(tabla: string, appId?: string | null): Promise<string | null> {
  if (!appId) return null;
  return uuidDe(tabla, appId);
}

/** Llama una función RPC de Postgres (transaccional). Lanza en error. */
export async function rpc<T = Record<string, unknown>>(
  fn: string,
  args: Record<string, unknown>,
  tablasAfectadas: string[] = [],
): Promise<T> {
  const sb = supabase();
  if (!sb) throw new Error('Supabase no está configurado (SUPABASE_URL / SUPABASE_SERVICE_KEY).');
  const { data, error } = await sb.rpc(fn, args);
  if (error) {
    // Errores de negocio de las RPCs (ASIENTO_DUPLICADO, ASIENTO_NO_BALANCEADO…)
    // llegan como message — propagarlos legibles.
    throw new Error(`${fn}: ${error.message}`);
  }
  for (const t of tablasAfectadas) invalidarBridge(t);
  return data as T;
}

/** INSERT simple de una fila (una tabla, atómico por naturaleza). */
export async function insertar(
  tabla: string,
  fila: Record<string, unknown>,
): Promise<{ id: string; airtable_id: string }> {
  const sb = supabase();
  if (!sb) throw new Error('Supabase no está configurado.');
  const conId = { airtable_id: nuevoIdEscritura(), ...fila };
  const { data, error } = await sb.from(tabla).insert(conId).select('id, airtable_id').single();
  if (error) throw new Error(`insert ${tabla}: ${error.message}`);
  invalidarBridge(tabla);
  return data as { id: string; airtable_id: string };
}

/** UPDATE por airtable_id (fila existente de la app). */
export async function actualizarPorAppId(
  tabla: string,
  appId: string,
  cambios: Record<string, unknown>,
): Promise<void> {
  const sb = supabase();
  if (!sb) throw new Error('Supabase no está configurado.');
  const { error, data } = await sb.from(tabla)
    .update({ ...cambios, updated_at: new Date().toISOString() })
    .eq('airtable_id', appId)
    .select('id');
  if (error) throw new Error(`update ${tabla}: ${error.message}`);
  if (!data || data.length === 0) throw new Error(`update ${tabla}: id "${appId}" no encontrado.`);
}
