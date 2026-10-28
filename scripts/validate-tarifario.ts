/**
 * TARIFARIO (migración 014) — validador.
 *
 *  A. Estático: 014 en migrations/ (create table if not exists, candado
 *     único, sin delete/drop/begin/commit), seed en seeds/ (NO en migrations/,
 *     idempotente, solo Golden), actions con autorizar('catalogos') en la
 *     primera línea, pantalla sin diálogos del navegador, nav.
 *  B. Motor PURO: canonicalización (variantes reales de la Agenda y del
 *     tarifario), Q0 = sin tarifa, territorio no indicado, COMPLETO,
 *     alias de empresa → NIT, duplicado canónico, ambigüedad.
 *  C. E2E en la base indicada (HIT: tabla vacía): crear, aviso de
 *     combinación repetida con otra grafía (PREEMPLEO vs PRE EMPLEO),
 *     candado exacto de la base, aprobar, editar monto → vuelve a
 *     pendiente, Q0 no se aprueba, lookup real, desactivar/reactivar.
 *     Limpieza verificada.
 *
 * Uso: npx tsx --conditions=react-server scripts/validate-tarifario.ts hit
 */
import fs from 'node:fs';
import path from 'node:path';

const base = (process.argv[2] ?? 'hit').toLowerCase();
const envFile = base === 'hit' ? '.env.hit.vercel' : '.env.local';
for (const line of fs.readFileSync(path.join(process.cwd(), envFile), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('=');
  if (base === 'hit' || !(k.trim() in process.env)) process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  🟢 ${m}`); } else { fail++; console.log(`  🔴 ${m}`); } };
const rd = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

(async () => {
  console.log('\nA. Estático');
  const mig = rd('supabase/migrations/014_tarifario.sql');
  const sinCom = mig.replace(/--.*$/gm, '');
  ok(/create table if not exists tarifario/.test(mig) && /create unique index if not exists uq_tarifario_llave\s+on tarifario \(nit, tipo_prueba, categoria, territorio\)/.test(mig) && !/\b(drop|delete|begin|commit)\b/i.test(sinCom), '014: create table if not exists + candado único (nit, tipo_prueba, categoria, territorio), sin delete/drop/begin/commit');
  ok(!fs.existsSync('supabase/migrations/014_tarifario_seed.sql') && fs.existsSync('supabase/seeds/014_tarifario_seed.sql'), 'seed en supabase/seeds/ (migrar-todas no lo aplica como migración: son precios de Golden)');
  const seed = rd('supabase/seeds/014_tarifario_seed.sql');
  const nVals = (seed.match(/^\s+\('/gm) ?? []).length;
  ok(/if exists \(select 1 from tarifario limit 1\)/.test(seed) && nVals === 788, `seed idempotente con 788 tarifas (${nVals})`);
  const acts = rd('src/app/(app)/tarifario/actions.ts');
  for (const fn of ['crearTarifaAction', 'editarTarifaAction', 'aprobarTarifaAction', 'activarTarifaAction']) {
    const m = new RegExp(`export async function ${fn}\\([^)]*\\)[^{]*\\{\\s*const permiso = await autorizar\\('catalogos'\\);`).test(acts);
    ok(m, `${fn}: primera línea autorizar('catalogos')`);
  }
  const ui = rd('src/components/tarifario/tarifario-client.tsx') + rd('src/components/tarifario/tarifa-form.tsx');
  ok(!/window\.(confirm|alert|prompt)\(|\bconfirm\(/.test(ui), 'pantalla sin diálogos del navegador');
  ok(/role="alertdialog"/.test(ui) && /confirmarDuplicado/.test(ui), 'aviso de combinación repetida con confirmación en el pie del modal');
  ok(/'\/tarifario'/.test(rd('src/components/shell/sidebar.tsx')) && /'\/tarifario'/.test(rd('src/components/shell/topbar.tsx')), 'nav: Tarifario en sidebar y breadcrumb');

  console.log('\nB. Motor puro');
  const { canonCategoria, canonTerritorio, canonTipoPrueba, esSinTarifa, llaveTarifa, conIva } = await import('../src/lib/tarifario/canon');
  const { resolverTarifa, buscarDuplicado, tarifasDuplicadas, resolverNit, indiceAlias } = await import('../src/lib/tarifario/lookup');
  const cats = ['PRE EMPLEO', 'PREEMPLEO', 'PRE-EMPLEO', 'PRE  EMPLEO', 'PRE EMEPLEO', 'PRE EMMPLEO', 'PRE E E', 'pre empleo ', 'Pre-Empleo'];
  ok(cats.every(c => canonCategoria(c) === 'PRE EMPLEO'), `categoría: ${cats.length} variantes de PRE EMPLEO → PRE EMPLEO`);
  ok(canonCategoria('ESPECIFICA') === 'ESPECIFICO' && canonCategoria('Específico') === 'ESPECIFICO' && canonCategoria('RUTINA ') === 'RUTINA' && canonCategoria('rutina') === 'RUTINA', 'categoría: ESPECIFICA/Específico → ESPECIFICO, "RUTINA " → RUTINA');
  ok(canonTipoPrueba('POLÍGRAFO') === 'POLIGRAFO' && canonTipoPrueba('SOLO POLIGRAFO') === 'POLIGRAFO' && canonTipoPrueba('Solo Socioeconómico') === 'SOCIOECONOMICO' && canonTipoPrueba('Estudio socio-económico') === 'SOCIOECONOMICO' && canonTipoPrueba('POLIGRAFO BASIC') === 'POLIGRAFO BASIC' && canonTipoPrueba('COMPLETO') === 'COMPLETO' && canonTipoPrueba('visita domiciliaria') === 'VISITA DOMICILIAR', 'tipo: POLÍGRAFO/SOLO POLIGRAFO → POLIGRAFO; socio variantes → SOCIOECONOMICO; BASIC; COMPLETO; VISITA');
  ok(canonTerritorio('metro') === 'METROPOLITANA' && canonTerritorio('Metropolitana ') === 'METROPOLITANA' && canonTerritorio('Depto.') === 'DEPARTAMENTAL' && canonTerritorio('departamental') === 'DEPARTAMENTAL' && canonTerritorio('') === '', 'territorio: metro/Depto. → canónicos; vacío → ""');
  ok(llaveTarifa({ nit: '1234567-8', tipoPrueba: 'Polígrafo', categoria: 'PREEMPLEO', territorio: 'metro' }) === llaveTarifa({ nit: '12345678', tipoPrueba: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA' }), 'misma llave canónica con distinta grafía y NIT con/sin guion');
  ok(esSinTarifa(0) && esSinTarifa(-1) && esSinTarifa(null) && !esSinTarifa(0.01), 'Q0 (y vacío) = sin tarifa; 0.01 no');
  ok(conIva(4037.5).iva === 484.5 && conIva(4037.5).total === 4522, 'IVA 12 %: 4037.50 → iva 484.50, total 4522.00');

  const T = (id: string, nit: string, tipo: string, cat: string, ter: string, monto: number, extra: Partial<{ razonSocial: string; aprobadoEn: string | null; activo: boolean }> = {}) =>
    ({ id, nit, razonSocial: extra.razonSocial ?? 'EMPRESA X', tipoPrueba: tipo, categoria: cat, territorio: ter, monto, anio: '2026', aprobadoPor: extra.aprobadoEn ? 'a@b' : '', aprobadoEn: extra.aprobadoEn ?? null, activo: extra.activo ?? true });
  const tarifas = [
    T('1', '104455470', 'POLIGRAFO', 'PRE EMPLEO', 'METROPOLITANA', 394.24, { razonSocial: 'VENTAS IC, S.A. / IDEA CENTRAL', aprobadoEn: '2026-01-01' }),
    T('2', '104455470', 'POLIGRAFO', 'PRE EMPLEO', 'DEPARTAMENTAL', 394.24, { razonSocial: 'VENTAS IC, S.A. / IDEA CENTRAL', aprobadoEn: '2026-01-01' }),
    T('3', '104455470', 'SOCIOECONOMICO', 'RUTINA', 'METROPOLITANA', 300, { razonSocial: 'VENTAS IC, S.A. / IDEA CENTRAL' }),
    T('4', '104455470', 'SOCIOECONOMICO', 'RUTINA', 'DEPARTAMENTAL', 450, { razonSocial: 'VENTAS IC, S.A. / IDEA CENTRAL' }),
    T('5', '104455470', 'SOCIOECONOMICO', 'PREEMPLEO', 'METROPOLITANA', 0, { razonSocial: 'VENTAS IC, S.A. / IDEA CENTRAL' }),
    T('6', '22933093', 'POLIGRAFO', 'ESPECIFICA', 'METROPOLITANA', 440, { razonSocial: 'ABIRSA / ZVI, KLEIN' }),
    T('7', '22933093', 'POLIGRAFO', 'ESPECIFICO', 'METROPOLITANA', 500, { razonSocial: 'ABIRSA / ZVI, KLEIN' }),
    T('8', '22933093', 'SOCIOECONOMICO', 'RUTINA', 'METROPOLITANA', 999, { razonSocial: 'ABIRSA / ZVI, KLEIN', activo: false }),
  ];
  const clientes = [{ nombre: 'Idea Central', nit: '104455470' }, { nombre: 'CREDICHAPIN', nit: '53563972' }];
  let r = resolverTarifa(tarifas, { nit: '104455470', tipoPrueba: 'Polígrafo', categoria: 'PRE-EMPLEO', territorio: 'metro' }, clientes);
  ok(r.estado === 'ok' && r.monto === 394.24 && r.total === 441.55 && r.aprobada, `lookup por NIT con grafías distintas → ok Q394.24 (total Q441.55), aprobada`);
  r = resolverTarifa(tarifas, { empresa: 'IDEA CENTRAL', tipoPrueba: 'POLIGRAFO', categoria: 'PRE EMPLEO' }, clientes);
  ok(r.estado === 'ok' && r.monto === 394.24 && r.avisos.some(a => /no indica territorio/.test(a)), 'empresa por alias del tarifario ("… / IDEA CENTRAL"), sin territorio y mismo precio → ok con aviso');
  r = resolverTarifa(tarifas, { empresa: 'idea central', tipoPrueba: 'SOCIOECONOMICO', categoria: 'RUTINA' }, clientes);
  ok(r.estado === 'ambigua' && r.candidatas.length === 2, 'sin territorio y precio distinto por territorio → ambigua (pide territorio)');
  r = resolverTarifa(tarifas, { nit: '104455470', tipoPrueba: 'SOCIOECONOMICO', categoria: 'RUTINA', territorio: 'DEPARTAMENTAL' }, clientes);
  ok(r.estado === 'ok' && r.monto === 450 && !r.aprobada && r.avisos.some(a => /no está aprobada/.test(a)), 'con territorio → ok Q450, marcada "no aprobada"');
  r = resolverTarifa(tarifas, { nit: '104455470', tipoPrueba: 'SOCIOECONOMICO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA' }, clientes);
  ok(r.estado === 'sin_tarifa' && /no es gratis/.test(r.mensaje), 'Q0 → sin_tarifa (no es gratis), no devuelve precio');
  r = resolverTarifa(tarifas, { nit: '104455470', tipoPrueba: 'COMPLETO', categoria: 'RUTINA', territorio: 'DEPARTAMENTAL' }, clientes);
  ok(r.estado === 'no_encontrada' && /POLIGRAFO RUTINA/.test(r.mensaje), 'COMPLETO = POLIGRAFO + SOCIO: falta POLIGRAFO RUTINA → no_encontrada con el faltante');
  const conPoli = [...tarifas, T('9', '104455470', 'POLIGRAFO', 'RUTINA', 'DEPARTAMENTAL', 100)];
  r = resolverTarifa(conPoli, { nit: '104455470', tipoPrueba: 'COMPLETO', categoria: 'RUTINA', territorio: 'DEPARTAMENTAL' }, clientes);
  ok(r.estado === 'ok' && r.monto === 550 && r.componentes?.length === 2, 'COMPLETO con ambas → ok Q550 (100 + 450) con componentes');
  r = resolverTarifa(tarifas, { empresa: 'ABIRSA', tipoPrueba: 'POLIGRAFO', categoria: 'ESPECIFICO', territorio: 'METROPOLITANA' }, clientes);
  ok(r.estado === 'ambigua' && r.candidatas.length === 2, 'ESPECIFICA y ESPECIFICO con montos distintos para el mismo NIT → ambigua (duplicado con distinta grafía)');
  r = resolverTarifa(tarifas, { empresa: 'ABIRSA', tipoPrueba: 'SOCIOECONOMICO', categoria: 'RUTINA', territorio: 'METROPOLITANA' }, clientes);
  ok(r.estado === 'no_encontrada', 'una tarifa inactiva no cuenta → no_encontrada');
  r = resolverTarifa(tarifas, { empresa: 'EMPRESA QUE NO EXISTE', tipoPrueba: 'POLIGRAFO', categoria: 'RUTINA' }, clientes);
  ok(r.estado === 'cliente_no_identificado', 'empresa desconocida → cliente_no_identificado');
  r = resolverTarifa(tarifas, { empresa: 'CREDICHAPIN A', tipoPrueba: 'POLIGRAFO', categoria: 'RUTINA' }, clientes);
  ok(r.estado === 'no_encontrada' && r.nit === '53563972', 'alias con sufijo de la Agenda ("CREDICHAPIN A") → NIT del catálogo de clientes (sin tarifario → no_encontrada)');
  ok(resolverNit({ nit: '0' }, indiceAlias(tarifas, clientes)) === '' && resolverNit({ nit: 'CF' }, indiceAlias(tarifas, clientes)) === '', 'NIT 0 / CF no identifican a un cliente');
  const dup = buscarDuplicado(tarifas, { nit: '104455470', tipoPrueba: 'Polígrafo', categoria: 'PREEMPLEO', territorio: 'Metro' });
  ok(dup?.id === '1', 'buscarDuplicado: misma llave con otra grafía → la tarifa existente');
  ok(buscarDuplicado(tarifas, { nit: '22933093', tipoPrueba: 'SOCIOECONOMICO', categoria: 'RUTINA', territorio: 'METROPOLITANA' }) === null, 'buscarDuplicado ignora inactivas');
  const dd = tarifasDuplicadas(tarifas);
  ok(dd.size === 2 && dd.has('6') && dd.has('7'), 'tarifasDuplicadas marca ESPECIFICA/ESPECIFICO del mismo NIT');

  console.log(`\nC. E2E en ${base.toUpperCase()}`);
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const { crearTarifa, editarTarifa, aprobarTarifa, activarTarifa, getTarifario, resolverTarifaExpediente, tarifarioDisponible } = await import('../src/lib/db/tarifario');
  type TR = import('../src/lib/db/tarifario').TarifaResult;
  const NO: TR = { ok: false, error: '' };
  const disponible = await tarifarioDisponible();
  console.log(`     · tabla tarifario en ${base}: ${disponible ? 'SÍ (014 aplicada)' : 'NO'}`);
  ok(disponible, 'tarifarioDisponible() detecta la 014');
  const NIT = '99990001K';   // NIT de prueba (no existe en el tarifario)
  const creados: string[] = [];
  try {
    const c1 = await crearTarifa({ nit: NIT, razonSocial: 'E2E TARIFARIO S.A.', tipoPrueba: 'Polígrafo', categoria: 'pre-empleo', territorio: 'metro', monto: 350, anio: '2026' }, 'validador@tarifario');
    ok(c1.ok, `crear tarifa (grafías sueltas → canónicas): ${c1.ok ? c1.mensaje : c1.error}`); if (c1.ok) creados.push(c1.id);
    const fila = (await getTarifario()).find(t => t.id === (c1.ok ? c1.id : ''));
    ok(!!fila && fila.tipoPrueba === 'POLIGRAFO' && fila.categoria === 'PRE EMPLEO' && fila.territorio === 'METROPOLITANA' && fila.nit === NIT && fila.monto === 350 && !fila.aprobadoEn, 'queda guardada canónica, pendiente de aprobación');
    const c2 = await crearTarifa({ nit: NIT, tipoPrueba: 'POLIGRAFO', categoria: 'PREEMPLEO', territorio: 'METROPOLITANA', monto: 360 }, 'validador@tarifario');
    ok(!c2.ok && !!c2.duplicado && /Ya existe una tarifa/.test(c2.error), `misma combinación con otra grafía (PREEMPLEO) → aviso de repetida: ${c2.ok ? '' : c2.error}`);
    const c2b = await crearTarifa({ nit: NIT, tipoPrueba: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto: 360, confirmarDuplicado: true }, 'validador@tarifario');
    ok(!c2b.ok && /candado de la base/.test(c2b.ok ? '' : c2b.error), 'la combinación EXACTA la frena el candado único de la base aunque se confirme');
    const c3 = await crearTarifa({ nit: NIT, tipoPrueba: 'SOCIOECONOMICO', categoria: 'RUTINA', territorio: 'DEPARTAMENTAL', monto: 0 }, 'validador@tarifario');
    ok(c3.ok && /sin tarifa definida/.test(c3.mensaje), 'tarifa en Q0 se crea como "sin tarifa definida"'); if (c3.ok) creados.push(c3.id);
    const ap0 = c3.ok ? await aprobarTarifa(c3.id, 'validador@tarifario') : NO;
    ok(!ap0.ok && /Q0/.test(ap0.ok ? '' : ap0.error), 'una tarifa en Q0 no se puede aprobar');
    const ap = c1.ok ? await aprobarTarifa(c1.id, 'validador@tarifario') : NO;
    const aprobada = (await getTarifario()).find(t => t.id === (c1.ok ? c1.id : ''));
    ok(ap.ok && aprobada?.aprobadoPor === 'validador@tarifario' && !!aprobada?.aprobadoEn, 'aprobar → aprobado_por / aprobado_en (gobierno)');
    const ed = c1.ok ? await editarTarifa(c1.id, { monto: 375 }) : NO;
    const editada = (await getTarifario()).find(t => t.id === (c1.ok ? c1.id : ''));
    ok(ed.ok && editada?.monto === 375 && !editada?.aprobadoEn && /pendiente de aprobación/.test(ed.ok ? ed.mensaje : ''), 'editar el monto de una aprobada → Q375 y vuelve a pendiente');
    const lk = await resolverTarifaExpediente({ empresa: 'e2e tarifario s.a.', tipoPrueba: 'SOLO POLIGRAFO', categoria: 'PRE EMEPLEO' });
    ok(lk.estado === 'ok' && lk.monto === 375 && lk.total === 420 && !lk.aprobada, `lookup real por alias + erratas de la Agenda → ok Q375 (total Q420), no aprobada: ${lk.estado}`);
    const lk0 = await resolverTarifaExpediente({ nit: NIT, tipoPrueba: 'SOCIOECONOMICO', categoria: 'RUTINA', territorio: 'DEPARTAMENTAL' });
    ok(lk0.estado === 'sin_tarifa', 'lookup real de la Q0 → sin_tarifa');
    const des = c1.ok ? await activarTarifa(c1.id, false) : NO;
    const lkDes = await resolverTarifaExpediente({ nit: NIT, tipoPrueba: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA' });
    ok(des.ok && lkDes.estado === 'no_encontrada', 'desactivar → el motor ya no la ve (no_encontrada)');
    const re = c1.ok ? await activarTarifa(c1.id, true) : NO;
    ok(re.ok && (await getTarifario()).find(t => t.id === (c1.ok ? c1.id : ''))?.activo === true, 'reactivar → activa de nuevo');
  } catch (e) { fail++; console.log(`  🔴 excepción: ${(e as Error).message}`); }
  finally {
    if (creados.length) { const { error } = await sb.from('tarifario').delete().in('id', creados); if (error) console.log(`     ✗ limpieza: ${error.message}`); }
    const { count } = await sb.from('tarifario').select('id', { count: 'exact', head: true }).eq('nit', NIT);
    ok((count ?? 0) === 0, `limpieza verificada: 0 filas del NIT de prueba ${NIT}`);
  }
  console.log(`\n== ${pass} 🟢 / ${fail} 🔴 ==\n`);
  process.exit(fail ? 1 : 0);
})();
