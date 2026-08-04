/**
 * Puente de IDs — airtable_id ↔ uuid por tabla.
 *
 * El código de la app pasa recordIds de Airtable (rec…). Durante la
 * transición, las funciones Supabase aceptan airtable_id de entrada y
 * devuelven airtable_id en los shapes de salida — el uuid es interno.
 *
 * Los catálogos son chicos (cuentas 245, centros 6, clientes 316…), así que
 * cacheamos el mapeo completo en memoria con un TTL corto. `react.cache`
 * no aplica acá porque también usamos esto fuera del render (diff script).
 */

import { fetchAll } from './client';

interface BridgeEntry {
  byAirtable: Map<string, string>;   // airtable_id → uuid
  byUuid: Map<string, string>;       // uuid → airtable_id
  fetchedAt: number;
}

const TTL_MS = 60_000;
const cache = new Map<string, BridgeEntry>();

async function loadBridge(tabla: string): Promise<BridgeEntry> {
  const hit = cache.get(tabla);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit;
  const rows = await fetchAll<{ id: string; airtable_id: string | null }>(tabla, {
    select: 'id, airtable_id',
  });
  const byAirtable = new Map<string, string>();
  const byUuid = new Map<string, string>();
  for (const r of rows) {
    if (!r.airtable_id) continue;
    byAirtable.set(r.airtable_id, r.id);
    byUuid.set(r.id, r.airtable_id);
  }
  const entry = { byAirtable, byUuid, fetchedAt: Date.now() };
  cache.set(tabla, entry);
  return entry;
}

/** uuid de Postgres para un airtable_id (rec…), o null si no existe. */
export async function uuidDe(tabla: string, airtableId: string): Promise<string | null> {
  if (!airtableId) return null;
  const b = await loadBridge(tabla);
  return b.byAirtable.get(airtableId) ?? null;
}

/** airtable_id (rec…) para un uuid de Postgres, o null. */
export async function airtableIdDe(tabla: string, uuid: string): Promise<string | null> {
  if (!uuid) return null;
  const b = await loadBridge(tabla);
  return b.byUuid.get(uuid) ?? null;
}

/** Mapa completo uuid → airtable_id (para joins masivos en memoria). */
export async function mapaUuidAirtable(tabla: string): Promise<Map<string, string>> {
  return (await loadBridge(tabla)).byUuid;
}

/** Invalidar el cache (tests / después de escribir). */
export function invalidarBridge(tabla?: string): void {
  if (tabla) cache.delete(tabla);
  else cache.clear();
}
