/* eslint-disable no-console */
/**
 * F-034.1 — Auditoría de paginación contra Airtable real.
 *
 * Lee toda la tabla FACTURAS_CLIENTES con eachPage manual (sin maxRecords)
 * y reporta:
 *   - Total de líneas (records crudos).
 *   - Distribución por ESTADO (con espacios visibles).
 *   - Facturas únicas (por NO.FACTURA).
 *   - Facturas únicas por ESTADO.
 *   - Records sin ESTADO o sin NO.FACTURA.
 *
 * Luego invoca cada función pública de src/lib/db/facturas.ts y compara
 * los conteos contra el ground truth de la lectura raw.
 *
 * Uso: npx tsx scripts/audit-facturas.ts
 */

// Env se carga via `node --env-file=.env.local --import tsx scripts/audit-facturas.ts`
// (Node 20.6+ soporta --env-file nativo). Esto debe pasar ANTES de cualquier
// import que dependa de process.env (como ../src/lib/db/airtable.ts).
import Airtable from 'airtable';

if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
  console.error('AIRTABLE_API_KEY y AIRTABLE_BASE_ID son requeridos.');
  process.exit(1);
}

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const TABLE = 'FACTURAS_CLIENTES';

async function lecturaRaw() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('PARTE A — Lectura RAW de FACTURAS_CLIENTES');
  console.log('═══════════════════════════════════════════════════════');
  const todos: { id: string; fields: Record<string, unknown> }[] = [];
  await base(TABLE).select({ pageSize: 100 }).eachPage((records, fetchNextPage) => {
    for (const r of records) todos.push({ id: r.id, fields: r.fields as Record<string, unknown> });
    fetchNextPage();
  });

  console.log(`\nTotal LÍNEAS (records crudos): ${todos.length}`);

  // ESTADO con espacios visibles
  const porEstadoLineas = new Map<string, number>();
  const porEstadoNoFacturaUnica = new Map<string, Set<string>>();
  for (const r of todos) {
    const estado = r.fields['ESTADO'];
    const keyLinea =
      estado === undefined ? '__UNDEFINED__'
      : estado === null ? '__NULL__'
      : typeof estado === 'string' ? JSON.stringify(estado)
      : String(estado);
    porEstadoLineas.set(keyLinea, (porEstadoLineas.get(keyLinea) || 0) + 1);

    const nf = String(r.fields['NO.FACTURA'] ?? '__SIN_NUM__');
    if (!porEstadoNoFacturaUnica.has(keyLinea)) porEstadoNoFacturaUnica.set(keyLinea, new Set());
    porEstadoNoFacturaUnica.get(keyLinea)!.add(nf);
  }

  console.log('\nDistribución LÍNEAS por ESTADO (JSON-stringified para ver espacios):');
  for (const [estado, n] of [...porEstadoLineas.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${estado.padEnd(30)} → ${n} líneas`);
  }

  console.log('\nFacturas únicas (NO.FACTURA distinct) por ESTADO:');
  for (const [estado, set] of [...porEstadoNoFacturaUnica.entries()].sort((a, b) => b[1].size - a[1].size)) {
    console.log(`  ${estado.padEnd(30)} → ${set.size} NO.FACTURA únicos`);
  }

  const numerosTodos = new Set<string>();
  for (const r of todos) numerosTodos.add(String(r.fields['NO.FACTURA'] ?? `__rec__${r.id}`));
  console.log(`\nTotal NO.FACTURA únicos (todas estados): ${numerosTodos.size}`);

  // Records sin ESTADO
  const sinEstado = todos.filter(r => r.fields['ESTADO'] === undefined || r.fields['ESTADO'] === null || r.fields['ESTADO'] === '');
  console.log(`\nRecords SIN ESTADO: ${sinEstado.length}`);
  for (const r of sinEstado.slice(0, 10)) {
    console.log(`  ${r.id} · NO.FACTURA=${r.fields['NO.FACTURA']} · FECHA=${r.fields['FECHA_EMISION']}`);
  }

  // Records sin NO.FACTURA
  const sinNF = todos.filter(r => !r.fields['NO.FACTURA']);
  console.log(`\nRecords SIN NO.FACTURA: ${sinNF.length}`);
  for (const r of sinNF.slice(0, 10)) {
    console.log(`  ${r.id} · ESTADO=${r.fields['ESTADO']} · FECHA=${r.fields['FECHA_EMISION']}`);
  }

  return { totalLineas: todos.length, totalNoFacturasUnicas: numerosTodos.size, porEstadoNoFacturaUnica };
}

async function probarFunciones(
  truth: { totalLineas: number; totalNoFacturasUnicas: number },
  facturas: typeof import('../src/lib/db/facturas'),
) {
  const { getFacturas, getFacturasLiviano, getFacturasCountTotal, getFacturasPagina } = facturas;
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('PARTE C — Invocación de funciones públicas');
  console.log('═══════════════════════════════════════════════════════');

  const t0 = Date.now();

  const f = await getFacturas();
  console.log(`\ngetFacturas()                              → ${f.length} facturas consolidadas`);

  const liv = await getFacturasLiviano();
  console.log(`getFacturasLiviano()                       → ${liv.length} facturas livianas`);

  const count = await getFacturasCountTotal();
  console.log(`getFacturasCountTotal()                    → ${count}`);

  const tabs: import('../src/lib/db/facturas').FiltroTabFactura[] = [
    'todas', 'cartera_total', 'por_cobrar', 'vencidas', 'pendientes',
    'cobradas', 'anuladas', 'refacturadas',
  ];
  for (const t of tabs) {
    const pag = await getFacturasPagina({ limit: 50, filtro: t });
    console.log(`getFacturasPagina({filtro:'${t}'}, 50)     → page=${pag.invoices.length} · hayMas=${pag.hayMas} · ultimaFecha=${pag.ultimaFecha}`);
  }

  console.log(`\n(funciones tardaron ${Date.now() - t0}ms en total)`);

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('PARTE D — Comparación contra ground truth');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Ground truth:   ${truth.totalLineas} líneas · ${truth.totalNoFacturasUnicas} NO.FACTURA únicos`);
  console.log(`getFacturas:    ${f.length}     facturas consolidadas`);
  console.log(`getFacturasLiv: ${liv.length}   livianas`);

  // Distribución de getFacturasLiviano por estadoBruto
  const distLiv = new Map<string, { facturas: number; lineas: number }>();
  for (const i of liv) {
    const cur = distLiv.get(i.estadoBruto) ?? { facturas: 0, lineas: 0 };
    cur.facturas += 1;
    cur.lineas += i.numLineas;
    distLiv.set(i.estadoBruto, cur);
  }
  console.log('\nLivianas por estadoBruto (facturas consolidadas / líneas crudas):');
  for (const [e, n] of [...distLiv.entries()].sort((a, b) => b[1].facturas - a[1].facturas)) {
    console.log(`  ${e.padEnd(15)} → ${n.facturas} facturas (${n.lineas} líneas)`);
  }
}

(async () => {
  try {
    const truth = await lecturaRaw();
    // Dynamic import — el módulo airtable.ts lee process.env al evaluar; si
    // se importa estático arriba del archivo, se evalúa antes de que --env-file
    // termine de poblar process.env (timing en Node 25 ESM). Dynamic import
    // hace que se evalúe después de la carga raw.
    const facturas = await import('../src/lib/db/facturas');
    await probarFunciones(truth, facturas);
    process.exit(0);
  } catch (e) {
    console.error('Audit falló:', e);
    process.exit(2);
  }
})();
