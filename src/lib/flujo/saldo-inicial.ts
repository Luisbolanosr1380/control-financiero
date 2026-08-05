/**
 * F-051 — Saldo inicial estimado para el cash-flow planner.
 *
 * V1: el cálculo combinado por BANCOS.SALDO_INICIAL + MOVIMIENTOS_BANCARIOS
 * no es confiable mientras la conciliación bancaria no esté completa. Por eso:
 *  - `getSaldoInicialEstimado()` devuelve `null` cuando no hay datos confiables.
 *  - La UI tiene un input manual con persistencia en localStorage que prevalece
 *    sobre el estimado.
 *
 * Lo que hacemos es sumar los SALDO_INICIAL de bancos activos sin tocar los
 * movimientos. Es un "valor de partida" — la UI lo muestra como sugerencia.
 */

import { airtable, TABLES } from '@/lib/db/airtable';
import { getBancosActivos } from '@/lib/db/bancos';

/** Suma SALDO_INICIAL de BANCOS activos. null si nada confiable. */
export async function getSaldoInicialBancos(): Promise<{ totalQ: number; cuentas: number } | null> {
  const { dataSource } = await import('@/lib/config/data-source');
  if (dataSource('bancos') === 'supabase') {
    const { fetchAll } = await import('@/lib/supabase/client');
    const rows = await fetchAll<Record<string, unknown>>('bancos', {
      select: 'saldo_inicial, activo, moneda',
    });
    let total = 0, count = 0;
    for (const r of rows) {
      if (r.activo !== true) continue;
      if (String(r.moneda ?? 'GTQ') !== 'GTQ') continue;
      const saldo = Number(r.saldo_inicial ?? 0);
      if (Number.isFinite(saldo)) { total += saldo; count++; }
    }
    return count === 0 ? null : { totalQ: total, cuentas: count };
  }
  if (!airtable) return null;
  try {
    const bancos = await getBancosActivos();
    if (bancos.length === 0) return null;
    // Re-leemos para sacar SALDO_INICIAL — `getBancosActivos` no expone ese campo todavía.
    const records = await airtable(TABLES.BANCOS)
      .select({ fields: ['NOMBRE_CUENTA', 'BANCO', 'SALDO_INICIAL', 'ACTIVO', 'MONEDA'] })
      .all();
    let total = 0;
    let count = 0;
    for (const r of records) {
      const f = r.fields as Record<string, unknown>;
      if (!f.ACTIVO) continue;
      const moneda = String(f.MONEDA ?? 'Q').toUpperCase();
      if (moneda !== 'Q' && moneda !== 'GTQ') continue;
      const saldo = Number(f.SALDO_INICIAL ?? 0);
      if (Number.isFinite(saldo)) {
        total += saldo;
        count++;
      }
    }
    if (count === 0) return null;
    return { totalQ: total, cuentas: count };
  } catch (err) {
    console.warn('F-051 getSaldoInicialBancos falló:', err instanceof Error ? err.message : err);
    return null;
  }
}
