/**
 * Cliente Supabase — SOLO server-side.
 *
 * Usa SUPABASE_SERVICE_KEY (service role): NUNCA importar este módulo desde
 * un client component. Todo acceso pasa por server components / server
 * actions / route handlers, igual que el cliente Airtable actual.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null | undefined;

export function supabase(): SupabaseClient | null {
  if (_client !== undefined) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn('⚠️ SUPABASE_URL / SUPABASE_SERVICE_KEY no configurados — lecturas supabase deshabilitadas');
    _client = null;
    return _client;
  }
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

/**
 * Fetch paginado completo (sin caps — lección F-BF-004). PostgREST corta en
 * ~1000 filas por request; esto agota todas las páginas.
 */
export async function fetchAll<T = Record<string, unknown>>(
  tabla: string,
  opts: {
    select?: string;
    /** filtros eq simples: { col: valor } */
    eq?: Record<string, string | number | boolean>;
    /** ordenar por columna (para replicar sorts de Airtable) */
    order?: { column: string; ascending: boolean };
  } = {},
): Promise<T[]> {
  const sb = supabase();
  if (!sb) return [];
  const PAGE = 1000;
  const out: T[] = [];
  for (let page = 0; ; page++) {
    let q = sb.from(tabla).select(opts.select ?? '*');
    if (opts.eq) for (const [k, v] of Object.entries(opts.eq)) q = q.eq(k, v);
    if (opts.order) q = q.order(opts.order.column, { ascending: opts.order.ascending, nullsFirst: false });
    // Orden secundario estable para que la paginación no duplique/omita filas.
    q = q.order('id', { ascending: true });
    const { data, error } = await q.range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`supabase ${tabla}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}
