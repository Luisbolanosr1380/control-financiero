/**
 * F-ETIQUETAS — validador de staging del sistema de etiquetas
 * (facturas Y gastos, catálogo compartido, puentes por tipo).
 *
 * PRERREQUISITO: aplicar supabase/migrations/008_etiquetas_documentos.sql
 * en la base destino (la aplica el usuario — el conector no hace DDL).
 *
 * Uso: npx tsx scripts/validate-etiquetas.ts [golden|hit]
 *   golden (default) → credenciales de .env.local
 *   hit              → base de High Impact Talent
 *
 * Crea documentos de PRUEBA mínimos (factura, factura_in + gasto),
 * los etiqueta, valida todo el ciclo y BORRA todo al final.
 */
import fs from 'node:fs';
import path from 'node:path';

// Credenciales por base: golden ← .env.local, hit ← .env.hit.vercel
// (gitignorado — las llaves NUNCA van en este script).
const base = process.argv[2] ?? 'golden';
const ENV_POR_BASE: Record<string, string> = { golden: '.env.local', hit: '.env.hit.vercel' };
const envFile = ENV_POR_BASE[base];
if (!envFile) { console.error('Uso: npx tsx scripts/validate-etiquetas.ts [golden|hit]'); process.exit(1); }
const forzar = base === 'hit';   // hit debe PISAR lo que haya en el entorno
for (const line of fs.readFileSync(path.join(process.cwd(), envFile), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('=');
  if (forzar || !(k.trim() in process.env)) process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}

let pass = 0, fail = 0;
const ok = (cond: boolean, msg: string) => { if (cond) { pass++; console.log(`  🟢 ${msg}`); } else { fail++; console.log(`  🔴 ${msg}`); } };

(async () => {
  console.log(`\n== F-ETIQUETAS · staging en ${base.toUpperCase()} ==\n`);
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase();
  if (!sb) { console.error('Supabase no configurado'); process.exit(1); }

  // 0. ¿Existen las 3 tablas? (GET real — un HEAD 404 no reporta error en supabase-js)
  for (const t of ['etiquetas', 'factura_etiquetas', 'gasto_etiquetas']) {
    const { error } = await sb.from(t).select('*').limit(1);
    if (error) {
      console.error(`✗ La tabla ${t} no existe todavía: ${error.message}`);
      console.error('  → Aplicá supabase/migrations/008_etiquetas_documentos.sql y volvé a correr.');
      process.exit(1);
    }
  }
  console.log('0. Tablas etiquetas / factura_etiquetas / gasto_etiquetas existen 🟢');

  const {
    obtenerOCrearEtiqueta, setEtiquetasDocumento, getEtiquetasDeDocumento,
    getEtiquetasPorDocumento, getEtiquetasPorFacturaIn, getUsoEtiquetas,
    editarEtiqueta, borrarEtiqueta, getEtiquetas,
  } = await import('../src/lib/db/etiquetas');

  const TS = String(process.hrtime.bigint());
  const MARCA = `TEST-ETIQ-${TS}`;
  const FACT_ID = `sbwtestetiqf${TS.slice(-8)}`;
  const GASTO_ID = `sbwtestetiqg${TS.slice(-8)}`;
  const FIN_ID = `sbwtestetiqi${TS.slice(-8)}`;

  // Documentos staging mínimos (todas las columnas son nullable salvo id).
  const { error: eF } = await sb.from('facturas_clientes').insert({
    airtable_id: FACT_ID, no_factura: MARCA, estado: 'ANULADO', total: 0, observaciones: MARCA,
  });
  const { data: finRow, error: eI } = await sb.from('facturas_in').insert({
    airtable_id: FIN_ID, proveedor_nombre: MARCA, estado: 'descartada',
  }).select('id').single();
  const { error: eG0 } = eI ? { error: eI } : await sb.from('gastos').insert({
    airtable_id: GASTO_ID, descripcion: MARCA, estado: 'Anulado', monto: 123.45, factura_in_id: finRow?.id,
  });
  if (eF || eI || eG0) {
    console.error('✗ No se pudieron crear los documentos staging:', (eF ?? eI ?? eG0)?.message);
    process.exit(1);
  }
  console.log('   documentos staging creados (factura + factura_in + gasto)');

  const limpiar = async () => {
    const { data: testEtiqs } = await sb.from('etiquetas').select('id').like('nombre', `${MARCA}%`);
    for (const e of testEtiqs ?? []) await sb.from('etiquetas').delete().eq('id', e.id);
    await sb.from('gastos').delete().eq('airtable_id', GASTO_ID);
    await sb.from('facturas_in').delete().eq('airtable_id', FIN_ID);
    await sb.from('facturas_clientes').delete().eq('airtable_id', FACT_ID);
  };

  try {
    console.log('1. Crear y reusar etiquetas');
    const a = await obtenerOCrearEtiqueta(`${MARCA} Iglesia`);
    ok(!!a.id && a.nombre === `${MARCA} Iglesia`, 'obtenerOCrearEtiqueta crea con el nombre limpio');
    const a2 = await obtenerOCrearEtiqueta(`  ${MARCA.toLowerCase()}   IGLESIA `);
    ok(a2.id === a.id, 'reuso case/espacios-insensible (no duplica)');
    const a3 = await obtenerOCrearEtiqueta(`${MARCA} iglesía`);
    ok(a3.id === a.id, 'reuso acento-insensible (iglesía ≡ Iglesia)');

    console.log('2. Etiquetar la factura');
    const setF = await setEtiquetasDocumento('factura', FACT_ID, [`${MARCA} Iglesia`, `${MARCA} Donación`]);
    ok(setF.length === 2, 'set de 2 etiquetas en la factura (crea la que faltaba)');
    const deF = await getEtiquetasDeDocumento('factura', FACT_ID);
    ok(deF.length === 2, 'getEtiquetasDeDocumento devuelve las 2');
    const mapaF = await getEtiquetasPorDocumento('factura');
    ok((mapaF[FACT_ID] ?? []).length === 2, 'el mapa por documento incluye la factura con 2');

    console.log('3. Reemplazo del set (delete + insert)');
    await setEtiquetasDocumento('factura', FACT_ID, [`${MARCA} Donación`]);
    const deF2 = await getEtiquetasDeDocumento('factura', FACT_ID);
    ok(deF2.length === 1 && deF2[0].nombre === `${MARCA} Donación`, 'queda solo Donación tras reemplazar');

    console.log('4. Etiquetar el gasto (misma etiqueta compartida)');
    await setEtiquetasDocumento('gasto', GASTO_ID, [`${MARCA} Donación`]);
    const deG = await getEtiquetasDeDocumento('gasto', GASTO_ID);
    ok(deG.length === 1, 'el gasto quedó etiquetado');
    const don = (await getEtiquetas()).find(e => e.nombre === `${MARCA} Donación`)!;
    const uso = await getUsoEtiquetas();
    ok(uso[don.id]?.facturas === 1 && uso[don.id]?.gastos === 1, 'uso cuenta 1 factura + 1 gasto para Donación');

    console.log('5. Bandeja de gastos: etiquetas vía factura_in (embed con FK hint)');
    const mapaFin = await getEtiquetasPorFacturaIn();
    ok((mapaFin[FIN_ID] ?? []).some(e => e.id === don.id), 'la factura_in hereda las etiquetas de su gasto');

    console.log('6. Gestión: renombrar, color, choque y borrado en cascada');
    const ren = await editarEtiqueta(don.id, { nombre: `${MARCA} Donaciones 2026`, color: '#b45309' });
    ok(ren.ok, 'renombrar + color ok');
    const don2 = (await getEtiquetas()).find(e => e.id === don.id)!;
    ok(don2.nombre === `${MARCA} Donaciones 2026` && don2.color === '#b45309', 'nombre y color persisten');
    const choque = await editarEtiqueta(a.id, { nombre: `${MARCA} donaciones 2026` });
    ok(!choque.ok, 'renombrar a un nombre ya existente se bloquea');
    const del = await borrarEtiqueta(don.id);
    ok(del.ok, 'borrarEtiqueta ok');
    const { count: puentesF } = await sb.from('factura_etiquetas').select('*', { count: 'exact', head: false }).eq('etiqueta_id', don.id);
    const { count: puentesG } = await sb.from('gasto_etiquetas').select('*', { count: 'exact', head: false }).eq('etiqueta_id', don.id);
    ok((puentesF ?? 0) === 0 && (puentesG ?? 0) === 0, 'los puentes cayeron en cascada');
    const { data: docF } = await sb.from('facturas_clientes').select('airtable_id').eq('airtable_id', FACT_ID);
    const { data: docG } = await sb.from('gastos').select('airtable_id').eq('airtable_id', GASTO_ID);
    ok((docF ?? []).length === 1 && (docG ?? []).length === 1, 'los documentos NO se tocaron');

    console.log('7. Tool de Auros');
    await setEtiquetasDocumento('gasto', GASTO_ID, [`${MARCA} Iglesia`]);
    const { aiTools } = await import('../src/lib/ai/tools');
    const ejecutar = (aiTools.getPorEtiqueta as unknown as {
      execute: (i: { etiqueta?: string }, o: Record<string, unknown>) => Promise<Record<string, unknown>>;
    }).execute;
    const res = await ejecutar({ etiqueta: `${MARCA} iglesia` }, {});
    const gastosTool = res.gastos as { cantidad: number; total_Q: number } | undefined;
    ok(res.etiqueta === `${MARCA} Iglesia` && (gastosTool?.cantidad ?? 0) >= 1 && (gastosTool?.total_Q ?? 0) >= 123,
      'getPorEtiqueta resuelve el nombre y trae el gasto con su total');
  } finally {
    await limpiar();
  }

  // Cleanup verificado.
  const { data: resEt } = await sb.from('etiquetas').select('id').like('nombre', `${MARCA}%`);
  const { data: resF } = await sb.from('facturas_clientes').select('id').eq('airtable_id', FACT_ID);
  const { data: resG } = await sb.from('gastos').select('id').eq('airtable_id', GASTO_ID);
  const { data: resI } = await sb.from('facturas_in').select('id').eq('airtable_id', FIN_ID);
  ok((resEt ?? []).length + (resF ?? []).length + (resG ?? []).length + (resI ?? []).length === 0, 'staging limpiado (0 filas TEST)');

  console.log(`\n== ${base.toUpperCase()}: ${pass} 🟢 / ${fail} 🔴 ==\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
