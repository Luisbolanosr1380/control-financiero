/**
 * MIGRACIÓN CAPA 2 — Flag por tabla: ¿de dónde lee la app?
 *
 * Cada función de datos consulta su flag con `dataSource(tabla)` y despacha
 * al backend correcto. Rollback instantáneo: volver el valor a 'airtable'.
 *
 * Reglas:
 *  - Fase 1 = SOLO lecturas. Las escrituras siguen yendo a Airtable
 *    independientemente de este flag (Fase 2 las migrará con transacciones).
 *  - No flipear una tabla a 'supabase' sin diff limpio
 *    (scripts/diff-datasource.ts).
 *
 * Override para el script de diff (NO usar en la app):
 *  - DATA_SOURCE_FORCE=airtable|supabase fuerza TODAS las tablas.
 */

export type Backend = 'airtable' | 'supabase';

export type TablaMigrable =
  | 'centros_costo'
  | 'cuentas'
  | 'bancos'
  | 'periodos'
  | 'clientes'
  | 'acreedores'
  | 'deudas'
  | 'facturas_clientes'
  | 'cobros_clientes'
  | 'pagos_proveedores'
  | 'empleados'
  | 'planilla'
  | 'obligaciones_recurrentes'
  | 'notas_credito';

export const DATA_SOURCE: Record<TablaMigrable, Backend> = {
  // Flipeadas con diff limpio (scripts/diff-datasource.ts, 2026-08-04):
  centros_costo:            'supabase',
  cuentas:                  'supabase',   // 3 códigos reasignados documentados (5-1-x-2 dup → 5-1-x-3)
  bancos:                   'supabase',
  periodos:                 'supabase',
  clientes:                 'supabase',
  acreedores:               'supabase',
  cobros_clientes:          'supabase',   // + fix: cobros multi-factura ahora sí aparecen en el detalle
  pagos_proveedores:        'supabase',
  empleados:                'supabase',
  planilla:                 'supabase',   // gap menor: 2 boletas PDF (adjuntos) — regenerables
  notas_credito:            'supabase',
  deudas:                   'supabase',   // 03_fase2_gaps.sql corrido + resync — diff limpio 2026-08-04
  obligaciones_recurrentes: 'supabase',   // enum con 'Otra' + 2 filas corregidas — diff limpio 2026-08-04
  // Pendiente:
  facturas_clientes:        'airtable',   // ADJUNTO (~1022 PDFs) sin migrar a Storage todavía
};

/** Backend efectivo para una tabla (respeta el override del diff script). */
export function dataSource(tabla: TablaMigrable): Backend {
  const force = process.env.DATA_SOURCE_FORCE;
  if (force === 'airtable' || force === 'supabase') return force;
  return DATA_SOURCE[tabla];
}
