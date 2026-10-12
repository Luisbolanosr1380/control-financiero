/**
 * AVISO-NIT — validador.
 *
 *  A. Puro: normalización del NIT (solo dígitos/letras, mayúsculas),
 *     placeholders que no avisan (vacío, 0, CF), búsqueda del duplicado solo
 *     entre activos y excluyendo al que se edita, señal de NIT compartido.
 *  B. Estático: la action nueva valida permiso en la primera línea, el modal
 *     pide confirmación (no un confirm() del navegador), sin migración ni
 *     índice único sobre nit.
 *  C. E2E en la base indicada (datos de prueba, limpiados): crearCliente con
 *     el NIT de otro activo → pide confirmación; confirmado → crea; "0" y "CF"
 *     repetidos no avisan; inactivo no cuenta; la lista marca los que comparten.
 *
 * Uso: npx tsx --conditions=react-server scripts/validate-nit-duplicado.ts [hit|golden] [--sin-e2e]
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
  console.log('\nA. Lógica pura');
  const N = await import('../src/lib/clientes/nit');
  ok(N.nitComparable('1234567-8') === '12345678' && N.nitComparable(' 1234567 8 ') === '12345678' && N.nitComparable('123456-k') === '123456K' && N.nitComparable(null) === '',
    'normalización: solo dígitos/letras en mayúsculas ("1234567-8" ≡ "1234567 8"; verificador k → K)');
  ok(N.nitEsPlaceholder('') && N.nitEsPlaceholder('0') && N.nitEsPlaceholder('000') && N.nitEsPlaceholder('CF') && !N.nitEsPlaceholder('12345678'), 'placeholders que no avisan: vacío, 0, 000, CF');
  const cs = [
    { id: 'a', name: 'ALFA', nit: '1234567-8', activo: true },
    { id: 'b', name: 'BETA', nit: '0', activo: true }, { id: 'c', name: 'GAMA', nit: '0', activo: true },
    { id: 'd', name: 'DELTA', nit: 'cf', activo: true }, { id: 'e', name: 'EPSILON', nit: 'CF' },
    { id: 'f', name: 'FI (inactivo)', nit: '9999999-1', activo: false },
    { id: 'g', name: 'GAMMA2', nit: null }, { id: 'h', name: 'HACHE', nit: '' },
  ];
  ok(N.buscarNitDuplicado('12345678', cs)?.name === 'ALFA' && N.buscarNitDuplicado('1234567 8', cs)?.name === 'ALFA', 'mismo NIT con otro formato → encuentra a ALFA');
  ok(N.buscarNitDuplicado('1234567-8', cs, 'a') === null, 'editando a ALFA, su propio NIT no es duplicado (excluirId)');
  ok(N.buscarNitDuplicado('0', cs) === null && N.buscarNitDuplicado('CF', cs) === null && N.buscarNitDuplicado('', cs) === null && N.buscarNitDuplicado(null, cs) === null, '0, CF, vacío y null nunca avisan aunque se repitan');
  ok(N.buscarNitDuplicado('9999999-1', cs) === null, 'el NIT de un cliente INACTIVO no avisa');
  const comp = N.clientesConNitCompartido([...cs, { id: 'i', name: 'IOTA', nit: '12345678', activo: true }, { id: 'j', name: 'JOTA', nit: '9999999-1', activo: true }]);
  ok(comp.get('a') === 'IOTA' && comp.get('i') === 'ALFA' && !comp.has('b') && !comp.has('c') && !comp.has('d') && !comp.has('j') && !comp.has('f'),
    'señal de lista: ALFA↔IOTA comparten; 0/CF no; el inactivo no cuenta (JOTA queda sola)');

  console.log('\nB. Estático');
  const acts = leer('src/app/(app)/clientes/actions.ts');
  const i = acts.indexOf('export async function verificarNitClienteAction');
  ok(acts.slice(acts.indexOf('{\n', acts.indexOf(')', i)) + 2).trim().split('\n')[0].includes("exigir('ver')"), "verificarNitClienteAction: primera línea exigir('ver')");
  const modal = leer('src/components/clientes/modal-cliente-form.tsx');
  ok(/role="alertdialog"/.test(modal) && /Crear de todos modos/.test(modal) && !/window\.confirm/.test(modal) && /onBlur=\{revisarNit\}/.test(modal), 'modal: aviso al salir del campo + confirmación dentro del modal (sin confirm() del navegador)');
  const db = leer('src/lib/db/clientes.ts');
  ok(/confirmarNitDuplicado/.test(db) && /nitDuplicado: \{ clienteId: dupNit\.id, nombre: dupNit\.name \}/.test(db) && !/Ya existe un cliente con el NIT \$\{nit\}/.test(db), 'crearCliente: el NIT repetido pide confirmación en vez de bloquear');
  ok(!fs.readdirSync('supabase/migrations').some(f => /nit/i.test(f)) && !/unique.*nit/i.test(leer('src/lib/db/clientes.ts')), 'sin migración ni índice único sobre nit (0 y null son legítimos)');
  ok(/'Activo':\s+typeof r\.activo === 'boolean'/.test(leer('src/lib/supabase/records.ts')), 'records.ts expone activo (los inactivos no cuentan para el aviso)');

  if (process.argv.includes('--sin-e2e')) return fin();

  console.log(`\nC. E2E en ${base.toUpperCase()}`);
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const { crearCliente, verificarNitCliente, getClientes } = await import('../src/lib/db/clientes');
  const STAMP = Date.now().toString(36);
  const TAG = `E2E-NIT-${STAMP}`;
  const NIT = `${String(Date.now()).slice(-7)}-${'0123456789K'[Date.now() % 11]}`;
  const ids: string[] = [];
  const uuidDe = async (appId: string) => String((await sb.from('clientes').select('id').eq('airtable_id', appId).single()).data!.id);
  try {
    const a = await crearCliente({ nombreEmpresa: `${TAG} ALFA`, nit: NIT });
    ok(a.ok, `cliente ALFA con NIT ${NIT}: ${a.ok ? a.mensaje : a.error}`);
    if (!a.ok) throw new Error(a.error);
    ids.push(await uuidDe(a.clienteId));
    const sinGuion = NIT.replace('-', '');
    const b1 = await crearCliente({ nombreEmpresa: `${TAG} BETA`, nit: sinGuion });
    ok(!b1.ok && !!b1.nitDuplicado && b1.nitDuplicado.nombre === `${TAG} ALFA` && /Ya existe un cliente con este NIT/.test(b1.error),
      `BETA con el mismo NIT sin guion → pide confirmación: "${b1.ok ? '' : b1.error}"`);
    const v = await verificarNitCliente(` ${sinGuion} `);
    ok(v?.nombre === `${TAG} ALFA`, 'verificarNitCliente (el aviso al salir del campo) devuelve a ALFA');
    ok((await verificarNitCliente(NIT, a.clienteId)) === null, 'editando a ALFA (excluirId) su NIT no avisa');
    const b2 = await crearCliente({ nombreEmpresa: `${TAG} BETA`, nit: sinGuion, confirmarNitDuplicado: true });
    ok(b2.ok, `BETA confirmado → se crea: ${b2.ok ? b2.mensaje : b2.error}`);
    if (b2.ok) ids.push(await uuidDe(b2.clienteId));
    const todos = await getClientes();
    const { clientesConNitCompartido } = await import('../src/lib/clientes/nit');
    const comp = clientesConNitCompartido(todos);
    ok(comp.get(a.clienteId) === `${TAG} BETA` && (b2.ok && comp.get(b2.clienteId) === `${TAG} ALFA`), 'señal de la lista: ALFA y BETA marcados como "NIT compartido"');
    // El placeholder "0" no pasa la validación de formato del alta (nitValido, previa a este cambio):
    // los NIT 0 existentes vienen del import. Se prueban como entraron: insert directo.
    const c0 = await crearCliente({ nombreEmpresa: `${TAG} CERO X`, nit: '0' });
    ok(!c0.ok && /no parece un NIT/.test(c0.ok ? '' : c0.error), 'el alta sigue rechazando "0" por formato (comportamiento previo; los NIT 0 son del import)');
    for (const k of ['1', '2']) {
      const { data, error } = await sb.from('clientes').insert({ airtable_id: `sbwnit${STAMP}${k}`, nombre_empresa: `${TAG} CERO ${k}`, razon_social: `${TAG} CERO ${k}`, nit: '0', activo: true }).select('id').single();
      if (error) throw new Error(error.message); ids.push(String((data as { id: string }).id));
    }
    const compCero = clientesConNitCompartido(await getClientes());
    ok((await verificarNitCliente('0')) === null && [...compCero.values()].every(v => !/CERO/.test(v)), 'dos clientes con NIT "0" (como el import): ni aviso ni señal de "NIT compartido"');
    const cf1 = await crearCliente({ nombreEmpresa: `${TAG} CF 1`, nit: 'CF' }); if (cf1.ok) ids.push(await uuidDe(cf1.clienteId));
    const cf2 = await crearCliente({ nombreEmpresa: `${TAG} CF 2`, nit: 'cf' }); if (cf2.ok) ids.push(await uuidDe(cf2.clienteId));
    ok(cf1.ok && cf2.ok, 'dos clientes CF: sin aviso');
    const sn1 = await crearCliente({ nombreEmpresa: `${TAG} SIN NIT 1` }); if (sn1.ok) ids.push(await uuidDe(sn1.clienteId));
    const sn2 = await crearCliente({ nombreEmpresa: `${TAG} SIN NIT 2` }); if (sn2.ok) ids.push(await uuidDe(sn2.clienteId));
    ok(sn1.ok && sn2.ok, 'dos clientes sin NIT: sin aviso');
    if (b2.ok) await sb.from('clientes').update({ activo: false }).eq('id', ids[1]);
    await sb.from('clientes').update({ activo: false }).eq('id', ids[0]);
    ok((await verificarNitCliente(NIT)) === null, 'con ALFA y BETA inactivos, el NIT ya no avisa');
    const g = await crearCliente({ nombreEmpresa: `${TAG} GAMA`, nit: NIT });
    ok(g.ok, `GAMA con ese NIT se crea sin confirmación (los otros están inactivos): ${g.ok ? g.mensaje : g.error}`);
    if (g.ok) ids.push(await uuidDe(g.clienteId));
  } catch (e) {
    ok(false, `error: ${e instanceof Error ? e.message : e}`);
  } finally {
    if (ids.length) await sb.from('clientes').delete().in('id', ids);
    const { count } = await sb.from('clientes').select('id', { count: 'exact', head: true }).like('nombre_empresa', `${TAG}%`);
    ok((count ?? 0) === 0, `limpieza verificada: 0 clientes ${TAG}`);
    fin();
  }
})();
