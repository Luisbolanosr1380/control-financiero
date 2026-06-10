'use server';

/**
 * F-050 — Bootstrap del modal de revisión.
 *
 * Carga en paralelo las 3 listas que el form necesita: centros de costo
 * activos, cuentas de gasto, bancos activos con cuenta contable configurada.
 *
 * Se invoca una vez al abrir el modal y el resultado se mantiene en estado
 * local del componente. No revalida.
 */

import { airtable } from '@/lib/db/airtable';
import { getCentrosCostoActivos } from '@/lib/db/centros';
import { getBancosActivos } from '@/lib/db/bancos';
import { getCuentasGasto } from '@/lib/db/cuentas';
import { BANCOS_TABLE_ID, BANCOS_FIELDS } from '@/lib/airtable/bancos-fields';

export interface OpcionSelector {
  id: string;
  label: string;
  hint?: string;
}

export interface OpcionesModal {
  centrosCosto: OpcionSelector[];
  cuentasGasto: OpcionSelector[];
  bancos: OpcionSelector[];        // solo los que tienen cuenta_contable configurada
  bancosSinCuenta: OpcionSelector[]; // para mostrar warning informativo
}

/** Lee el field cuenta_contable de cada banco; devuelve true si tiene al menos uno. */
async function tieneCuentaContable(bancoId: string): Promise<boolean> {
  if (!airtable) return false;
  try {
    const r = await airtable(BANCOS_TABLE_ID).find(bancoId);
    const link = (r.fields as Record<string, unknown>)[BANCOS_FIELDS.cuenta_contable] as string[] | undefined;
    return !!(link && link.length > 0);
  } catch {
    return false;
  }
}

export async function cargarOpcionesModalAction(): Promise<OpcionesModal> {
  const [centros, cuentas, bancos] = await Promise.all([
    getCentrosCostoActivos(),
    getCuentasGasto(),
    getBancosActivos(),
  ]);

  // Centros de costo
  const centrosCosto: OpcionSelector[] = centros.map(c => ({
    id: c.id,
    label: c.nombre,
  }));

  // Cuentas de gasto
  const cuentasGasto: OpcionSelector[] = cuentas
    .filter(c => c.codigo || c.nombre)
    .map(c => ({
      id: c.id,
      label: c.codigo ? `${c.codigo} · ${c.nombre}` : c.nombre,
      hint: c.codigo,
    }));

  // Bancos: separamos los con/sin cuenta contable.
  const bancosConCuenta: OpcionSelector[] = [];
  const bancosSinCuenta: OpcionSelector[] = [];
  const checks = await Promise.all(bancos.map(b => tieneCuentaContable(b.id)));
  bancos.forEach((b, i) => {
    const label = b.nombreCuenta || b.banco || b.id;
    if (checks[i]) {
      bancosConCuenta.push({ id: b.id, label });
    } else {
      bancosSinCuenta.push({ id: b.id, label });
    }
  });

  return {
    centrosCosto,
    cuentasGasto,
    bancos: bancosConCuenta,
    bancosSinCuenta,
  };
}
