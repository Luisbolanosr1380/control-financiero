'use server';

/**
 * F-050 — Bootstrap del modal de revisión.
 *
 * Carga en paralelo las 3 listas que el form necesita: centros de costo
 * activos, cuentas de gasto, bancos activos con cuenta contable configurada.
 *
 * Se invoca una vez al abrir el modal y el resultado se mantiene en estado
 * local del componente. No revalida.
 *
 * F-050.2: el check de "banco tiene cuenta_contable" se hace con UNA sola
 * query usando returnFieldsByFieldId:true. Antes hacíamos N `.find()` (uno
 * por banco) y `.find()` NO acepta returnFieldsByFieldId, así que leía por
 * nombre de campo — devolvía undefined silenciosamente y todos los bancos
 * caían a `bancosSinCuenta` aunque CUENTA_CONTABLE estuviera poblado.
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
  bancos: OpcionSelector[];        // con cuenta_contable configurada
  bancosSinCuenta: OpcionSelector[]; // para warning informativo
}

/**
 * F-050.2: lee el link cuenta_contable de todos los bancos en una sola
 * query con returnFieldsByFieldId. Normaliza el shape del campo
 * multipleRecordLinks (puede llegar como `string[]` o `{id}[]` según
 * versión del SDK).
 */
async function mapaCuentaContablePorBanco(): Promise<Map<string, string | undefined>> {
  const m = new Map<string, string | undefined>();
  if (!airtable) return m;
  try {
    const records = await airtable(BANCOS_TABLE_ID)
      .select({ returnFieldsByFieldId: true })
      .all();
    for (const r of records) {
      const link = (r.fields as Record<string, unknown>)[BANCOS_FIELDS.cuenta_contable];
      let cuentaId: string | undefined;
      if (Array.isArray(link) && link.length > 0) {
        const first = link[0];
        cuentaId = typeof first === 'string'
          ? first
          : (first && typeof first === 'object' && 'id' in (first as object)
              ? String((first as { id?: unknown }).id ?? '')
              : undefined);
      }
      m.set(r.id, cuentaId || undefined);
    }
  } catch (err) {
    console.warn('F-050.2: mapaCuentaContablePorBanco falló:', err instanceof Error ? err.message : err);
  }
  return m;
}

export async function cargarOpcionesModalAction(): Promise<OpcionesModal> {
  const [centros, cuentas, bancos, mapaCuentaPorBanco] = await Promise.all([
    getCentrosCostoActivos(),
    getCuentasGasto(),
    getBancosActivos(),
    mapaCuentaContablePorBanco(),
  ]);

  const centrosCosto: OpcionSelector[] = centros.map(c => ({
    id: c.id,
    label: c.nombre,
  }));

  const cuentasGasto: OpcionSelector[] = cuentas
    .filter(c => c.codigo || c.nombre)
    .map(c => ({
      id: c.id,
      label: c.codigo ? `${c.codigo} · ${c.nombre}` : c.nombre,
      hint: c.codigo,
    }));

  const bancosConCuenta: OpcionSelector[] = [];
  const bancosSinCuenta: OpcionSelector[] = [];
  for (const b of bancos) {
    const label = b.nombreCuenta || b.banco || b.id;
    if (mapaCuentaPorBanco.get(b.id)) {
      bancosConCuenta.push({ id: b.id, label });
    } else {
      bancosSinCuenta.push({ id: b.id, label });
    }
  }

  return {
    centrosCosto,
    cuentasGasto,
    bancos: bancosConCuenta,
    bancosSinCuenta,
  };
}
