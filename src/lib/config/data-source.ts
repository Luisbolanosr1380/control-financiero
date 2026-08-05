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
  facturas_clientes:        'supabase',   // 14/14 — PDFs en Storage (1022/1022, script 06) + diff limpio
};

/** Backend efectivo para una tabla (respeta el override del diff script). */
export function dataSource(tabla: TablaMigrable): Backend {
  const force = process.env.DATA_SOURCE_FORCE;
  if (force === 'airtable' || force === 'supabase') return force;
  return DATA_SOURCE[tabla];
}

/* ════════════════════════════════════════════════════════════════
 * FASE 2 — flag de ESCRITURA por operación.
 *
 * Paralelo al de lectura: cada operación core se migra y valida UNA a
 * la vez; rollback = volver el valor a 'airtable'. Las escrituras no
 * cubiertas por estas operaciones (emitir factura, NC, CRUD de
 * empleados/deudas/acreedores…) siguen en Airtable hasta Fase 3.
 *
 * ORDEN DE FLIP SEGURO (acoplamiento lectura/escritura):
 *  - 'cobros' actualiza el ESTADO de FACTURAS → flipear cobros SOLO
 *    cuando la LECTURA de facturas_clientes ya esté en 'supabase'
 *    (Fase 2.5 adjuntos); si no, la UI no reflejaría el cobro.
 *  - 'adjuntos' (uploads) requiere el bucket de Storage creado
 *    (scripts 06_migrar_adjuntos_storage.py).
 * ════════════════════════════════════════════════════════════════ */

export type OperacionEscritura =
  | 'cobros'        // registrar/anular cobro + estado de factura
  | 'pagos'         // registrar/anular pago a deuda
  | 'gastos'        // bandeja facturas_in + aprobar (gasto+asiento+partidas)
  | 'planilla'      // asiento F-056.2 + workflow (períodos, líneas, boletas)
  | 'facturacion'   // emitir/editar/anular factura de venta + notas de crédito
  | 'empleados'     // CRUD empleados + acreedor vinculado + deuda salarial
  | 'deudas'        // CRUD deudas + crear acreedor
  | 'obligaciones'  // CRUD obligaciones recurrentes
  | 'sistema';      // uso_auros, ayuda (contenido/logs)

/**
 * FASE 3 — DEPENDENCIA CRÍTICA adjuntos ↔ registro padre:
 * los adjuntos NO tienen flag propio. `uploadAttachment` usa SIEMPRE el
 * backend de la operación dueña del registro destino (PDF de factura →
 * 'facturacion', constancia → 'cobros', boleta → 'planilla', PDF de
 * factura_in → 'gastos'). Así es IMPOSIBLE el cruce de backends
 * ("id no encontrado" por crear en uno y adjuntar en otro).
 *
 * ACOPLAMIENTO lectura/escritura: con la lectura 14/14 en 'supabase',
 * una operación que escriba en 'airtable' produce registros INVISIBLES
 * para la app. Rollback de una operación = volver su WRITE_SOURCE y las
 * lecturas de sus tablas a 'airtable' EN PAREJA.
 * Acoplamientos entre operaciones: 'planilla' (diferir) crea deudas vía
 * 'empleados'/'deudas'; flipear esas tres juntas.
 */
// Flipeadas 2026-08-04 con validate-writes.ts 49/49 🟢 (staging real con
// registros de prueba: atomicidad, idempotencia, balance, adjunto-de-una).
// El pase final en navegador es el gate humano; rollback por operación =
// esta línea a 'airtable' + las lecturas de sus tablas en pareja.
export const WRITE_SOURCE: Record<OperacionEscritura, Backend> = {
  cobros:       'supabase',
  pagos:        'supabase',
  gastos:       'supabase',
  planilla:     'supabase',
  facturacion:  'supabase',
  empleados:    'supabase',
  deudas:       'supabase',
  obligaciones: 'supabase',
  sistema:      'supabase',
};

/** Backend efectivo de escritura (override WRITE_SOURCE_FORCE para staging). */
export function writeSource(op: OperacionEscritura): Backend {
  const force = process.env.WRITE_SOURCE_FORCE;
  if (force === 'airtable' || force === 'supabase') return force;
  return WRITE_SOURCE[op];
}
