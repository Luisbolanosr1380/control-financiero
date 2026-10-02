/**
 * MULTI-EMPRESA · Bloque 1-C — Line-keys derivadas de la base.
 *
 * Antes: mappers.ts hardcodeaba CC_ID_TO_LINE con los rec-ids de Golden
 * (una empresa nueva con sus propios CCs caía SIEMPRE al default). Ahora
 * el mapa CC→línea se construye leyendo la tabla centros_costo de la
 * base DE ESTE deploy y derivando la línea por NOMBRE — la misma
 * heurística que ya era el fallback del mapper, así Golden produce
 * EXACTAMENTE el mismo mapeo que el hardcode (verificado contra sus 6
 * CCs reales, incluido 'Pendiente' → default, como antes).
 *
 * El mapper es sync (recordToRaw) → el mapa vive en un cache de módulo
 * que los entry-points async siembran con asegurarMapaLineas() antes de
 * consolidar. Si el cache no está (primer render frío), el mapper cae a
 * la derivación por nombre solo si recibe texto, y al default si recibe
 * un id desconocido — igual que el comportamiento histórico.
 */

import type { LineKey } from '../types';

/** Deriva la línea desde el NOMBRE del centro de costo (heurística F-032). */
export function derivarLineKey(nombre: string): LineKey | null {
  const s = (nombre ?? '').toLowerCase();
  if (s.includes('polígraf') || s.includes('poligraf')) return 'poligrafo';
  if (s.includes('socio'))  return 'socio';
  if (s.includes('talent')) return 'talenttrack';
  if (s.includes('admin'))  return 'administrativo';
  return null;   // sin match — el caller decide el default
}

export const LINE_KEY_DEFAULT: LineKey = 'poligrafo';

let cache: Map<string, LineKey> | null = null;
let cacheExpira = 0;
const TTL_MS = 5 * 60_000;

/**
 * Siembra (o refresca) el mapa ccId→línea desde la base. Llamar en los
 * entry-points async antes de usar el mapper sync. Fail-soft: si la
 * lectura falla, se conserva el cache previo (o queda vacío y el mapper
 * usa su fallback).
 */
export async function asegurarMapaLineas(): Promise<Map<string, LineKey>> {
  if (cache && Date.now() < cacheExpira) return cache;
  try {
    // Import dinámico: evita ciclo mappers ↔ db y no carga supabase en
    // contextos que solo usan la heurística pura.
    const { getCentrosCosto } = await import('../db/centros');
    const centros = await getCentrosCosto();
    const m = new Map<string, LineKey>();
    for (const c of centros) {
      const linea = derivarLineKey(c.nombre);
      if (linea) m.set(c.id, linea);
    }
    cache = m;
    cacheExpira = Date.now() + TTL_MS;
  } catch (err) {
    console.error('asegurarMapaLineas: no se pudo leer centros_costo (se usa el cache/fallback):', err);
    cache = cache ?? new Map();
  }
  return cache;
}

/** Lookup sync contra el cache (para el mapper). null si no está mapeado. */
export function lineKeyDeCC(ccId: string): LineKey | null {
  return cache?.get(ccId) ?? null;
}

/** Solo para tests/probes: fija el cache sin tocar la base. */
export function __setMapaLineas(m: Map<string, LineKey> | null): void {
  cache = m;
  cacheExpira = m ? Date.now() + TTL_MS : 0;
}
