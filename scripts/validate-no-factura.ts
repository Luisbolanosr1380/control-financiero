/**
 * NO.FACTURA con espacios — validador.
 *
 *  A. Estático: lectura recortada en records.ts, comparación recortada en
 *     ambos lados en cobros.ts (sbCobrosDeNoFactura / fetchLineasFactura) y
 *     en facturas.ts, fórmulas Airtable con TRIM(), escritura recortada,
 *     migración 012 con limpieza + trigger y sin delete/drop/begin/commit.
 *  B. E2E en la base indicada (datos de prueba, limpiados): una factura con
 *     un espacio heredado (insertada directo, como la dejó el import) se
 *     encuentra por su número limpio en la lista, en pendientes de cobro y
 *     al registrar un cobro; sus 2 líneas se consolidan en UNA factura
 *     aunque una tenga el espacio; createFactura guarda el número recortado.
 *     Si la 012 ya está aplicada, el trigger recorta al insertar y se dice.
 *
 * Uso: npx tsx --conditions=react-server scripts/validate-no-factura.ts [hit|golden] [--sin-e2e]
 */
import fs from 'node:fs';
import path from 'node:path';

const base = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'hit';
const envFile = base === 'hit' ? '.env.hit.vercel' : '.env.local';
for (const line of fs.readFileSync(path.join(process.cwd(), envFile), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('=');
  if (base === 'hit' || !(k.trim() in process.env)) process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  🟢 ${m}`); } else { fail++; console.log(`  🔴 ${m}`); } };
const fin = () => { console.log(`\n== ${pass} 🟢 / ${fail} 🔴 ==\n`); process.exit(fail ? 1 : 0); };
const leer = (p: string) => fs.readFileSync(p, 'utf8');

(async () => {
  console.log('\nA. Estático');
  const rec = leer('src/lib/supabase/records.ts');
  ok(/'NO\.FACTURA':\s+s\(r\.no_factura\)\?\.trim\(\)/.test(rec) && /r\.factura\?\.no_factura\?\.trim\(\) \? \[r\.factura\.no_factura\.trim\(\)\]/.test(rec),
    'records.ts: NO.FACTURA se recorta al leer (facturas y el lookup de cobros) — un solo punto para todos los lectores Supabase');
  const cob = leer('src/lib/db/cobros.ts');
  const fn = (nombre: string) => { const i = cob.indexOf(`async function ${nombre}`); return cob.slice(i, cob.indexOf('\n}\n', i)); };
  ok(/const nf = noFactura\.trim\(\)/.test(fn('sbCobrosDeNoFactura')) && /_lookupFirst\([^)]*\)\.trim\(\) === nf/.test(fn('sbCobrosDeNoFactura')), 'sbCobrosDeNoFactura: compara recortado en ambos lados');
  ok(/const nf = noFactura\.trim\(\)/.test(fn('fetchLineasFactura')) && /\?\? ''\)\.trim\(\) === nf/.test(fn('fetchLineasFactura')) && /TRIM\(\{\$\{F\.NO_FACTURA\}\}\) = /.test(fn('fetchLineasFactura')),
    'fetchLineasFactura: recortado en ambos lados (Supabase) y TRIM() en la fórmula de Airtable');
  const fac = leer('src/lib/db/facturas.ts');
  ok(!/\{\$\{F\.NO_FACTURA\}\} = "/.test(fac) && (fac.match(/TRIM\(\{\$\{F\.NO_FACTURA\}\}\) = /g) ?? []).length >= 4, 'facturas.ts: ninguna fórmula Airtable compara NO.FACTURA exacto (todas con TRIM())');
  ok(!/NO_FACTURA\] \?\? ''\) === /.test(fac) && !/NO_FACTURA\] \?\? row\.id\);/.test(fac), 'facturas.ts: sin comparaciones ni claves de consolidación sin recortar');
  ok(/const nf = input\.noFactura\.trim\(\);\s+\/\/ nunca entra un espacio/.test(fac) && /\[F\.NO_FACTURA\]:\s+nf,/.test(fac) && /no_factura: nf,/.test(fac), 'createFactura: guarda el número recortado en Supabase y en Airtable');
  const mig = leer('supabase/migrations/012_no_factura_sin_espacios.sql');
  // Se ignoran comentarios y los cuerpos $$…$$ (el begin/end de plpgsql no es una transacción).
  const sinCom = mig.replace(/--[^\n]*/g, '').replace(/\$\$[\s\S]*?\$\$/g, '$$…$$');
  ok(!/\b(drop|begin|commit)\b/i.test(sinCom) && !/^\s*delete\b/im.test(sinCom), '012 sin drop/delete/begin/commit como sentencias (pasa por el runner y el conector)');
  ok(/update facturas_clientes\s+set no_factura = no_factura_limpio\(no_factura\)/.test(mig) && /create or replace trigger trg_facturas_clientes_no_factura\s+before insert or update of no_factura on facturas_clientes/.test(mig) && /chr\(160\)/.test(mig),
    '012: limpieza idempotente + trigger BEFORE INSERT/UPDATE que recorta (incluye tab, CR/LF y U+00A0)');
  ok(fs.existsSync('scripts/limpiar-no-factura.ts') && /dry-run/.test(leer('scripts/limpiar-no-factura.ts')) && /--aplicar/.test(leer('scripts/limpiar-no-factura.ts')), 'script de limpieza con dry-run por defecto');

  if (process.argv.includes('--sin-e2e')) return fin();

  console.log(`\nB. E2E en ${base.toUpperCase()}`);
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const STAMP = Date.now().toString(36);
  const TAG = `E2E-NF-${STAMP}`;
  const NF = `${TAG}-1`;
  const creados: Array<[string, string]> = [];
  const crear = async (tabla: string, fila: Record<string, unknown>) => {
    const { data, error } = await sb.from(tabla).insert(fila).select('id').single();
    if (error) throw new Error(`${tabla}: ${error.message}`);
    creados.push([tabla, String(data.id)]); return String(data.id);
  };
  try {
    const cli = await crear('clientes', { airtable_id: `sbwnf${STAMP}`, razon_social: `${TAG} CLIENTE`, nombre_empresa: `${TAG} CLIENTE`, dias_credito: 30 });
    const { data: ccs } = await sb.from('centros_costo').select('id').eq('activo', true).limit(2);
    const cc = (ccs ?? []).map(c => String((c as { id: string }).id));
    const banco = await crear('bancos', { airtable_id: `sbwnfb${STAMP}`, nombre_cuenta: `${TAG} Monetaria`, banco: 'E2E', moneda: 'GTQ', activo: true });
    // Dos líneas de la MISMA factura: una limpia y una con el espacio heredado (insert directo, como la dejó el import).
    const lSucia = await crear('facturas_clientes', { airtable_id: `sbwnf${STAMP}a`, no_factura: ` ${NF}`, cliente_id: cli, centro_costo_id: cc[0], fecha_emision: '2026-09-20', total: 1120, subtotal: 1000, iva: 120, estado: 'EMITIDA' });
    await crear('facturas_clientes', { airtable_id: `sbwnf${STAMP}b`, no_factura: NF, cliente_id: cli, centro_costo_id: cc[1] ?? cc[0], fecha_emision: '2026-09-20', total: 560, subtotal: 500, iva: 60, estado: 'EMITIDA' });
    const { data: raw } = await sb.from('facturas_clientes').select('no_factura').eq('id', lSucia).single();
    const triggerActivo = (raw as { no_factura: string }).no_factura === NF;
    console.log(`     · fila insertada directo con " ${NF}": en la base quedó "${(raw as { no_factura: string }).no_factura}" → ${triggerActivo ? 'la 012 YA está aplicada (el trigger recortó): se prueba igual el código de lectura' : 'sin trigger (012 no aplicada): la fila queda sucia, el código debe tolerarla'}`);

    const { getFacturas } = await import('../src/lib/db/facturas');
    const { getFacturasPendientesCobro } = await import('../src/lib/db/facturas-pendientes');
    const { registrarCobro } = await import('../src/lib/db/cobros');
    const lista = (await getFacturas()).filter(f => f.noFactura.includes(TAG));
    ok(lista.length === 1 && lista[0].noFactura === NF && Math.round(lista[0].total) === 1680 && lista[0].lineas.length === 2,
      `getFacturas: las 2 líneas se consolidan en UNA factura "${lista[0]?.noFactura}" de Q${lista[0]?.total} con ${lista[0]?.lineas.length} líneas (antes la línea con espacio era otra "factura")`);
    const pend = (await getFacturasPendientesCobro()).filas.filter(f => f.noFactura.includes(TAG));
    ok(pend.length === 1 && pend[0].noFactura === NF && Math.round(pend[0].saldo) === 1680, `pendientes de cobro: una sola factura ${pend[0]?.noFactura} con saldo Q${pend[0]?.saldo}`);
    const r = await registrarCobro({ noFactura: NF, fecha: '2026-10-01', componentes: [{ monto: 1680, metodo: 'Transferencia', bancoId: `sbwnfb${STAMP}`, referencia: `REF-${STAMP}` }] });
    ok(r.ok && r.cobrosCreados >= 1 && Math.round(r.saldoNuevo) === 0 && r.estadoNuevo === 'COBRADO',
      `registrarCobro("${NF}") encuentra la factura y la cobra completa: ${r.ok ? `${r.cobrosCreados} cobro(s), saldo ${r.saldoNuevo}, ${r.estadoNuevo}` : r.error}`);
    const { data: cobros } = await sb.from('cobros_clientes').select('id, factura_id').like('referencia', `REF-${STAMP}%`);
    for (const c of cobros ?? []) creados.push(['cobros_clientes', String((c as { id: string }).id)]);
    const { data: estados } = await sb.from('facturas_clientes').select('estado').like('no_factura', `%${NF}`);
    ok((estados ?? []).length === 2 && (estados ?? []).every(e => /COBRADO/i.test(String((e as { estado: string }).estado))), 'las 2 líneas (incluida la que tenía el espacio) pasan a COBRADO');

    const { createFactura } = await import('../src/lib/db/facturas');
    const nf2 = `  ${TAG}-2 `;
    const c2 = await createFactura({ noFactura: nf2, custId: `sbwnf${STAMP}`, fechaEmision: '2026-09-21', lineas: [{ centroCostoId: (await sb.from('centros_costo').select('airtable_id').eq('id', cc[0]).single()).data!.airtable_id as string, total: 112, iva: 12 }] });
    const { data: f2 } = await sb.from('facturas_clientes').select('id, no_factura').eq('no_factura', `${TAG}-2`).maybeSingle();
    if (f2) creados.push(['facturas_clientes', String((f2 as { id: string }).id)]);
    ok(c2.noFactura === `${TAG}-2` && !!f2, `createFactura("${nf2}") guarda "${(f2 as { no_factura?: string } | null)?.no_factura}" (recortado)`);
    const dup = await createFactura({ noFactura: ` ${TAG}-2`, custId: `sbwnf${STAMP}`, fechaEmision: '2026-09-21', lineas: [{ centroCostoId: 'x', total: 1, iva: 0 }] }).then(() => false).catch(e => /ya existe/.test(String(e.message)));
    ok(dup, 'el control de duplicados también recorta: " E2E-NF-…-2" se reconoce como la misma factura');
  } catch (e) {
    ok(false, `error: ${e instanceof Error ? e.message : e}`);
  } finally {
    for (const t of ['cobros_clientes', 'facturas_clientes', 'bancos', 'clientes']) {
      const ids = creados.filter(([x]) => x === t).map(([, id]) => id);
      if (ids.length) { const { error } = await sb.from(t).delete().in('id', ids); if (error) console.log(`     ✗ ${t}: ${error.message}`); }
    }
    const [{ count: c1 }, { count: c2 }, { count: c3 }] = await Promise.all([
      sb.from('facturas_clientes').select('id', { count: 'exact', head: true }).like('no_factura', `%${TAG}%`),
      sb.from('clientes').select('id', { count: 'exact', head: true }).like('razon_social', `${TAG}%`),
      sb.from('cobros_clientes').select('id', { count: 'exact', head: true }).like('referencia', `REF-${STAMP}%`),
    ]);
    ok((c1 ?? 0) + (c2 ?? 0) + (c3 ?? 0) === 0, `limpieza verificada: 0 filas con ${TAG}`);
    fin();
  }
})();
