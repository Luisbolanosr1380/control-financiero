/**
 * 013 · Número de autorización FEL en notas de crédito — validador.
 *
 *  A. Estático: migración 013 (add column if not exists, sin delete/drop),
 *     lectura (records.ts + NF + tipo), captura (form + crearNotaCredito),
 *     edición (editarAutorizacionFelNC + action con permiso 'anular'),
 *     display (columna, detalle, CSV) y buscador.
 *  B. E2E en la base indicada (datos de prueba, limpiados): emitir una NC SIN
 *     número funciona aunque la 013 no esté aplicada; con la 013: NC con
 *     número → se ve por getNotasCredito; editar el número de una NC ya
 *     emitida; quitarlo; formato inválido rechazado.
 *
 * Uso: npx tsx --conditions=react-server scripts/validate-nc-fel.ts [hit|golden] [--sin-e2e]
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
  const mig = leer('supabase/migrations/013_nc_autorizacion_fel.sql');
  const sinCom = mig.replace(/--[^\n]*/g, '');
  ok(/alter table notas_credito add column if not exists numero_autorizacion_fel text;/.test(mig) && !/\b(drop|delete|begin|commit)\b/i.test(sinCom), '013: add column if not exists, sin delete/drop/begin/commit');
  ok(/'Numero_Autorizacion_FEL':\s+s\(r\.numero_autorizacion_fel\)/.test(leer('src/lib/supabase/records.ts')), 'records.ts emite Numero_Autorizacion_FEL');
  const db = leer('src/lib/db/notas-credito.ts');
  ok(/AUTORIZACION_FEL: 'Numero_Autorizacion_FEL'/.test(db) && /numeroAutorizacionFel: string;/.test(db) && /numeroAutorizacionFel: String\(f\[NF\.AUTORIZACION_FEL\]/.test(db), 'NF + tipo NotaCredito + recordToNC');
  ok(/numeroAutorizacionFel\?: string;/.test(db) && /\{ numero_autorizacion_fel: normalizarAutorizacionFel\(input\.numeroAutorizacionFel\) \}/.test(db), 'crearNotaCredito guarda el número solo si viene (emitir sin número no depende de la 013)');
  ok(/export async function editarAutorizacionFelNC/.test(db) && /actualizarPorAppId\('notas_credito', ncId, \{ numero_autorizacion_fel: n \|\| null \}\)/.test(db), 'editarAutorizacionFelNC: setea/edita/quita en una NC existente');
  const acts = leer('src/app/(app)/facturacion/[id]/actions.ts');
  const i = acts.indexOf('export async function editarAutorizacionFelNCAction');
  ok(i > 0 && acts.slice(acts.indexOf('{\n', acts.indexOf(')', i)) + 2).trim().split('\n')[0].includes("autorizar('anular')"), "editarAutorizacionFelNCAction: primera línea autorizar('anular') (quien emite/edita NC)");
  ok(/numeroAutorizacionFel: numeroFel/.test(leer('src/components/facturas/emitir-nc-button.tsx')) && /No\. de autorización FEL/.test(leer('src/components/facturas/emitir-nc-button.tsx')), 'form de emisión: campo opcional "No. de autorización FEL"');
  const lista = leer('src/components/notas-credito/notas-credito-client.tsx');
  ok(/<th>Constancia FEL<\/th>/.test(lista) && /'Autorizacion_FEL'/.test(lista) && /n\.numeroAutorizacionFel,/.test(lista) && /n\.numeroAutorizacionFel\.toLowerCase\(\)\.includes\(q\)/.test(lista) && /colSpan=\{9\}/.test(lista),
    'lista: columna "Constancia FEL", CSV (header + filas), buscador, colSpan');
  ok(/<AutorizacionFel /.test(lista) && /<AutorizacionFel /.test(leer('src/components/facturas/notas-credito-section.tsx')) && /puedeEditar=\{puede\('anular'\)\}/.test(lista), 'edición inline en lista y en el detalle de factura, solo para quien puede emitir/editar NC');
  ok(!/window\.confirm|window\.prompt/.test(leer('src/components/notas-credito/autorizacion-fel.tsx')), 'editor inline sin diálogos del navegador');

  if (process.argv.includes('--sin-e2e')) return fin();

  console.log(`\nB. E2E en ${base.toUpperCase()}`);
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const { data: colRows } = await sb.from('notas_credito').select('numero_autorizacion_fel').limit(1);
  const col013 = Array.isArray(colRows);
  console.log(`     · columna numero_autorizacion_fel en ${base}: ${col013 ? 'SÍ (013 aplicada)' : 'NO (013 pendiente) — se prueba solo el camino sin número'}`);
  const { createFactura, getFacturas } = await import('../src/lib/db/facturas');
  const { crearNotaCredito, getNotasCredito, editarAutorizacionFelNC } = await import('../src/lib/db/notas-credito');
  const STAMP = Date.now().toString(36);
  const TAG = `E2E-FEL-${STAMP}`;
  const creados: Array<[string, string]> = [];
  try {
    const { data: cli, error: ec } = await sb.from('clientes').insert({ airtable_id: `sbwfel${STAMP}`, razon_social: `${TAG} CLIENTE`, nombre_empresa: `${TAG} CLIENTE`, activo: true }).select('id').single();
    if (ec) throw new Error(ec.message); creados.push(['clientes', String((cli as { id: string }).id)]);
    const { data: cc } = await sb.from('centros_costo').select('airtable_id').eq('activo', true).limit(1).single();
    const f = await createFactura({ noFactura: `${TAG}-F1`, custId: `sbwfel${STAMP}`, fechaEmision: '2026-09-01', lineas: [{ centroCostoId: (cc as { airtable_id: string }).airtable_id, total: 1120, iva: 120 }] });
    const fid = (await getFacturas()).find(x => x.noFactura === `${TAG}-F1`)!.id;
    const { data: fuuid } = await sb.from('facturas_clientes').select('id').eq('no_factura', `${TAG}-F1`); for (const r of fuuid ?? []) creados.push(['facturas_clientes', String((r as { id: string }).id)]);
    ok(!!f.noFactura && !!fid, `factura de prueba ${f.noFactura}`);

    const sin = await crearNotaCredito({ facturaId: fid, fechaEmision: '2026-09-05', monto: 100, motivo: 'Otro', descripcion: `${TAG} sin número` }, 'validador@fel');
    ok(sin.ok, `NC SIN número se emite ${col013 ? '' : 'aunque la 013 no esté aplicada '}: ${sin.ok ? sin.numeroNC : sin.error}`);
    const ncs1 = (await getNotasCredito()).filter(n => n.descripcion.startsWith(TAG));
    for (const n of ncs1) { const { data } = await sb.from('notas_credito').select('id').eq('airtable_id', n.id).single(); if (data) creados.push(['notas_credito', String((data as { id: string }).id)]); }
    ok(ncs1.length === 1 && ncs1[0].numeroAutorizacionFel === '', 'en la lista queda en blanco (no rompe nada)');

    if (col013) {
      const con = await crearNotaCredito({ facturaId: fid, fechaEmision: '2026-09-06', monto: 50, motivo: 'Otro', descripcion: `${TAG} con número`, numeroAutorizacionFel: ' a1b2c3d4-0000 0001 ' }, 'validador@fel');
      ok(con.ok, `NC CON número se emite: ${con.ok ? con.numeroNC : con.error}`);
      const ncs2 = (await getNotasCredito()).filter(n => n.descripcion.startsWith(TAG));
      for (const n of ncs2) { const { data } = await sb.from('notas_credito').select('id').eq('airtable_id', n.id).single(); if (data && !creados.some(([, id]) => id === String((data as { id: string }).id))) creados.push(['notas_credito', String((data as { id: string }).id)]); }
      const conNum = ncs2.find(n => n.descripcion.endsWith('con número'));
      ok(conNum?.numeroAutorizacionFel === 'A1B2C3D4-00000001', `se guarda normalizado (sin espacios, mayúsculas): ${conNum?.numeroAutorizacionFel}`);
      const sinNum = ncs2.find(n => n.descripcion.endsWith('sin número'))!;
      const ed = await editarAutorizacionFelNC(sinNum.id, 'ffff0000-11112222-3333');
      const tras = (await getNotasCredito()).find(n => n.id === sinNum.id);
      ok(ed.ok && tras?.numeroAutorizacionFel === 'FFFF0000-11112222-3333', `editar el número de una NC ya emitida (${sinNum.numeroNC}): ${tras?.numeroAutorizacionFel}`);
      const malo = await editarAutorizacionFelNC(sinNum.id, 'abc');
      ok(!malo.ok && /no parece un número de autorización FEL/.test(malo.error ?? ''), 'formato inválido ("abc") rechazado');
      const quitar = await editarAutorizacionFelNC(sinNum.id, '');
      ok(quitar.ok && (await getNotasCredito()).find(n => n.id === sinNum.id)?.numeroAutorizacionFel === '', 'vacío lo quita (vuelve a blanco)');
      const inexistente = await editarAutorizacionFelNC('sbw-no-existe', 'ABCDEFGH');
      ok(!inexistente.ok, 'NC inexistente → error claro');
    }
  } catch (e) {
    ok(false, `error: ${e instanceof Error ? e.message : e}`);
  } finally {
    for (const t of ['notas_credito', 'facturas_clientes', 'clientes']) {
      const ids = creados.filter(([x]) => x === t).map(([, id]) => id);
      if (ids.length) { const { error } = await sb.from(t).delete().in('id', ids); if (error) console.log(`     ✗ ${t}: ${error.message}`); }
    }
    const [{ count: c1 }, { count: c2 }, { count: c3 }] = await Promise.all([
      sb.from('notas_credito').select('id', { count: 'exact', head: true }).like('descripcion', `${TAG}%`),
      sb.from('facturas_clientes').select('id', { count: 'exact', head: true }).like('no_factura', `${TAG}%`),
      sb.from('clientes').select('id', { count: 'exact', head: true }).like('razon_social', `${TAG}%`),
    ]);
    ok((c1 ?? 0) + (c2 ?? 0) + (c3 ?? 0) === 0, `limpieza verificada: 0 filas ${TAG}`);
    fin();
  }
})();
