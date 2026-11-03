/**
 * MAPA DE PRECIOS (027) — validador.
 *
 *  A. Estático: la seguridad está en el servidor (página redirige a /no-acceso, loader `server-only` + exigir
 *     `ver_mapa_precios` solo admin, RPC solo service_role, sin /api ni server action que la exponga), el ítem
 *     del menú va dentro de `esAdmin`, la migración es de solo lectura (sin drop/delete/truncate; el único
 *     insert/update es el artículo de ayuda), sin dependencias nuevas.
 *  B. Puro: percentil (= percentile_cont), benchmark por mediana, cuadrantes, resumen, referencias, franjas,
 *     filtros desde search params, CSV.
 *  C. E2E en HIT: siembra un dataset con resultados conocidos (5 clientes, 3 servicios, filas que NO deben
 *     entrar), llama la RPC con la llave de servicio y la compara fila por fila contra la misma regla en TS y
 *     contra los números calculados a mano; cambia los umbrales; con la llave anon la RPC falla por permiso.
 *     Limpia al final (--conservar deja los datos para el E2E en Chrome; --solo-limpiar solo borra).
 *
 * Uso: npx tsx scripts/validate-mapa-precios.ts hit [--conservar | --solo-limpiar]
 *      SUPABASE_ANON_KEY (env) habilita la prueba con la llave pública; sin ella se informa como omitida.
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] ?? 'hit').toLowerCase();
if (BASE !== 'hit') { console.error('Este validador siembra datos: solo corre contra HIT.'); process.exit(2); }
const CONSERVAR = process.argv.includes('--conservar'), SOLO_LIMPIAR = process.argv.includes('--solo-limpiar');
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.hit.vercel'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('='); process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  🟢 ${m}`); } else { fail++; console.log(`  🔴 ${m}`); } };
const rd = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const cerca = (a: number, b: number, tol = 0.011) => Math.abs(a - b) <= tol;

// Dataset (ver cálculo a mano en el PR): NITs propios, prefijo mpE2E en los ids externos.
const NIT = { A: '99990021K', B: '99990022K', C: '99990023K', D: '99990024K', E: '99990025K', X: '99990026K' };
const NITS = Object.values(NIT);
const NOMBRES = new Map([[NIT.A, 'MP E2E ALFA'], [NIT.B, 'MP E2E BETA'], [NIT.C, 'MP E2E GAMA'], [NIT.D, 'MP E2E DELTA']]);   // E no tiene cliente → 'NIT …'
type Seed = { nit: string | null; servicio: string; categoria: string | null; monto: number; n: number; situacion?: string; estado_tarifa?: string; eliminado?: boolean; fecha?: string };
const SEEDS: Seed[] = [
  { nit: NIT.A, servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', monto: 300, n: 70 }, { nit: NIT.A, servicio: 'SOCIOECONOMICO', categoria: 'PRE EMPLEO', monto: 200, n: 10 },
  { nit: NIT.B, servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', monto: 400, n: 65 }, { nit: NIT.B, servicio: 'SOCIOECONOMICO', categoria: 'PRE EMPLEO', monto: 250, n: 5 },
  { nit: NIT.C, servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', monto: 500, n: 10 }, { nit: NIT.C, servicio: 'SOCIOECONOMICO', categoria: 'PRE EMPLEO', monto: 300, n: 10 }, { nit: NIT.C, servicio: 'INFORNET', categoria: null, monto: 100, n: 5 },
  { nit: NIT.D, servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', monto: 250, n: 20 }, { nit: NIT.D, servicio: 'INFORNET', categoria: null, monto: 80, n: 1 },
  { nit: NIT.E, servicio: 'SOCIOECONOMICO', categoria: 'PRE EMPLEO', monto: 150, n: 5 },
  // NO deben entrar:
  { nit: NIT.A, servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', monto: 300, n: 3, situacion: 'pendiente' },
  { nit: NIT.A, servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', monto: 0, n: 2, estado_tarifa: 'sin_tarifa' },
  { nit: NIT.B, servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', monto: 400, n: 4, eliminado: true },
  { nit: null, servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', monto: 999, n: 2 },
  { nit: NIT.X, servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', monto: 50, n: 6, fecha: '2025-12-31' },
  { nit: NIT.A, servicio: 'SOCIOECONOMICO', categoria: 'PRE EMPLEO', monto: 200, n: 2, situacion: 'no_cobra' },
];
const TARIFAS: Array<{ nit: string; tipo: string; cat: string; monto: number; activo?: boolean }> = [
  { nit: NIT.A, tipo: 'POLIGRAFO', cat: 'PRE EMPLEO', monto: 300 }, { nit: NIT.B, tipo: 'POLIGRAFO', cat: 'PRE EMPLEO', monto: 400 }, { nit: NIT.C, tipo: 'POLIGRAFO', cat: 'PRE EMPLEO', monto: 500 }, { nit: NIT.D, tipo: 'POLIGRAFO', cat: 'PRE EMPLEO', monto: 250 },
  { nit: NIT.A, tipo: 'SOCIOECONOMICO', cat: 'PRE EMPLEO', monto: 200 }, { nit: NIT.B, tipo: 'SOCIOECONOMICO', cat: 'PRE EMPLEO', monto: 250 }, { nit: NIT.C, tipo: 'SOCIOECONOMICO', cat: 'PRE EMPLEO', monto: 300 },
  { nit: NIT.X, tipo: 'POLIGRAFO', cat: 'PRE EMPLEO', monto: 50, activo: false },   // inactiva: no cuenta
  { nit: NIT.E, tipo: 'POLIGRAFO', cat: 'PRE EMPLEO', monto: 0 },                   // Q0: no cuenta
];

(async () => {
  /* ───────────── A. Estático ───────────── */
  console.log('\nA. Seguridad en el servidor, menú, migración de solo lectura');
  const page = rd('src/app/(app)/admin/precios/page.tsx'), loader = rd('src/lib/db/precios.ts'), roles = rd('src/lib/auth/roles.ts'), side = rd('src/components/shell/sidebar.tsx');
  ok(/const \{ rol \} = await getSesion\(\);\s*\n\s*if \(rol !== 'admin'\) \{\s*\n\s*redirect\('\/no-acceso'\);/.test(page) && /export const dynamic = 'force-dynamic';/.test(page) && /getMapaPrecios\(/.test(page), 'página: getSesion + redirect(/no-acceso) si no es admin (patrón admin/roadmap), force-dynamic');
  ok(/^import 'server-only';/m.test(loader) && /await exigir\('ver_mapa_precios'\)/.test(loader) && /if \(rol !== 'admin'\) throw new PermisoDenegadoError/.test(loader) && /\.rpc\('precios_mapa'/.test(loader), 'loader db/precios.ts: server-only, vuelve a exigir ver_mapa_precios y lanza si el rol no es admin, llama la RPC con la llave de servicio');
  ok(/\|\s*'ver_mapa_precios'/.test(roles) && /ver_mapa_precios:\s+SOLO_ADMIN,/.test(roles) && /ver_mapa_precios:\s+'ver el mapa de precios',/.test(roles), 'roles.ts: acción ver_mapa_precios permitida solo a admin (matriz + etiqueta)');
  ok(/\.\.\.\(esAdmin \? \[\{ href: '\/admin\/precios', label: 'Mapa de precios'/.test(side), 'sidebar: "Mapa de precios" en el grupo Admin, dentro de esAdmin ? [...] : []');
  const apiDir = 'src/app/api'; const todos: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) todos.push(p); } };
  walk('src');
  const expuesto = todos.filter(p => !p.endsWith('db/precios.ts') && !p.endsWith('admin/precios/page.tsx') && /\.rpc\('precios_mapa'|getMapaPrecios\(/.test(fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
  ok(expuesto.length === 0 && fs.existsSync(apiDir), `nadie más llama precios_mapa / getMapaPrecios: ni rutas /api ni server actions (${expuesto.join(', ') || 'ninguno'})`);
  ok(!/'use server'/.test(loader) && !/'use server'/.test(page), 'ni el loader ni la página son server actions');
  const m27 = rd('supabase/migrations/027_precios_mapa.sql'), sin27 = m27.replace(/--.*$/gm, '');
  ok(/create or replace function precios_mapa\(p_desde date default '2026-01-01', p_hasta date default null, p_umbral_vol int default 60, p_umbral_idx numeric default 1\.0\)/.test(m27) && /returns jsonb\s*\n\s*language sql stable/.test(m27), '027: precios_mapa(p_desde, p_hasta, p_umbral_vol, p_umbral_idx) → jsonb, sql stable');
  ok(/revoke all on function precios_mapa\(date, date, int, numeric\) from public;/.test(m27) && /revoke all on function precios_mapa\(date, date, int, numeric\) from anon, authenticated;/.test(m27) && /grant execute on function precios_mapa\(date, date, int, numeric\) to service_role;/.test(m27), '027: execute revocado a public, anon y authenticated; solo service_role');
  const sinAyuda = sin27.replace(/insert into ayuda[\s\S]*?updated_at = now\(\);/, '');
  ok(!/\b(drop|truncate|delete)\b/i.test(sin27) && !/^\s*(begin|commit)\s*;/im.test(sin27) && !/\b(update|insert|alter)\b/i.test(sinAyuda) && /insert into ayuda \(titulo, slug, categoria/.test(sin27) && /on conflict \(slug\) do update/.test(sin27), '027: sin drop/delete/truncate/alter/commit; el único insert/update es el artículo de ayuda (upsert por slug)');
  ok(/c\.situacion = 'cobra' and not e\.eliminado and e\.nit_resuelto is not null/.test(m27) && /c\.estado_tarifa = 'resuelta' and c\.monto_calculado > 0/.test(m27) && /e\.fecha_ingreso >= p_desde and \(p_hasta is null or e\.fecha_ingreso <= p_hasta\)/.test(m27) && /coalesce\(c\.categoria, 'UNICA'\) cat/.test(m27) && /percentile_cont\(0\.5\) within group \(order by p\)/.test(m27) && /greatest\(cli\.prod_ref - cli\.prod, 0\)/.test(m27), '027: base común del Anexo (cobra, resuelta, > 0, vigente con NIT, rango por parámetros; categoría nula = UNICA; benchmark por mediana; brecha ≥ 0)');
  ok(!/facturas_clientes|upper\(coalesce|COBRAD/.test(sin27), '027: no toca facturas_clientes.estado ni redefine "cobrada" (026)');
  ok(!/"recharts":/.test(rd('package.json').split('"dependencies"')[1]?.split('}')[0]?.replace(/"recharts": "[^"]*",?/, 'X') ?? '') && /"recharts":/.test(rd('package.json')), 'sin dependencias nuevas: recharts ya estaba (la app lo usa en deudas, analítica, reportes)');
  const cli = rd('src/components/admin/mapa-precios-client.tsx');
  ok(/^'use client';/.test(cli) && /from 'recharts'/.test(cli) && /buscarClientes/.test(cli) && /ScatterChart/.test(cli) && /scale="log"/.test(cli) && /ReferenceLine x=\{filtros\.umbralVol\}/.test(cli) && /ReferenceLine y=\{filtros\.umbralIdx\}/.test(cli) && /data-tabla="clientes"/.test(cli) && /\/tarifario\/\$\{encodeURIComponent\(c\.nit\)\}/.test(cli) && /data-accion="exportar-csv"/.test(cli) && /data-accion="con-iva"/.test(cli) && /data-seccion="metodologia"/.test(cli) && /Las pruebas sin tarifa no entran; ver Por facturar/.test(cli) && !/window\.(confirm|alert|prompt)/.test(cli), 'pantalla: dispersión en log con líneas en los umbrales, tabla de clientes con buscador reutilizado y link al tarifario, CSV, interruptor IVA, nota metodológica; sin diálogos del navegador');
  ok(!/[\u{1F300}-\u{1FAFF}]/u.test(cli) && !/linear-gradient/.test(cli), 'diseño sobrio: sin emojis ni degradados');
  ok(/'mapa-de-precios-solo-admin'/.test(m27) && /'Configuración'/.test(m27), 'ayuda: artículo "Mapa de precios" (Configuración) en la migración, para que llegue a ambas bases');

  /* ───────────── B. Puro ───────────── */
  console.log('\nB. Regla en TS (la misma del SQL)');
  const P = await import('../src/lib/precios/mapa');
  ok(P.percentil([250, 300, 400, 500], 0.5) === 350 && P.percentil([250, 300, 400, 500], 0.25) === 287.5 && P.percentil([250, 300, 400, 500], 0.75) === 425 && P.percentil([200, 250, 300], 0.25) === 225 && P.percentil([7], 0.5) === 7 && Number.isNaN(P.percentil([], 0.5)), 'percentil = percentile_cont (interpolación lineal): [250,300,400,500] → p25 287.5, mediana 350, p75 425');
  ok(P.cuadranteDe(80, 0.86, 60, 1) === 'Volumen con descuento' && P.cuadranteDe(70, 1.14, 60, 1) === 'Estrellas' && P.cuadranteDe(25, 1.37, 60, 1) === 'Premium de nicho' && P.cuadranteDe(21, 0.72, 60, 1) === 'Por revisar' && P.cuadranteDe(60, 1, 60, 1) === 'Estrellas' && P.cuadranteDe(25, 1.37, 25, 1) === 'Estrellas', 'cuadrantes: ≥ umbral_vol y ≥ umbral_idx inclusive; con umbral 25 el premium pasa a estrella');
  const filas: import('../src/lib/precios/mapa').FilaCobro[] = SEEDS.filter(s => s.nit && !s.situacion && !s.estado_tarifa && !s.eliminado && !s.fecha).flatMap(s => Array.from({ length: s.n }, () => ({ nit: s.nit!, servicio: s.servicio, categoria: s.categoria, monto: s.monto })));
  const tarifas = TARIFAS.filter(t => t.activo !== false).map(t => ({ nit: t.nit, servicio: t.tipo, categoria: t.cat, monto: t.monto }));
  const bm = P.benchmark(filas);
  ok(bm.get('POLIGRAFO|PRE EMPLEO') === 350 && bm.get('SOCIOECONOMICO|PRE EMPLEO') === 225 && bm.get('INFORNET|UNICA') === 90, 'benchmark: mediana entre clientes del precio promedio por (servicio, categoría); INFORNET sin categoría → UNICA (90)');
  const cl = P.calcularClientes(filas, NOMBRES, 60, 1);
  const by = (nit: string) => cl.find(c => c.nit === nit)!;
  ok(cl.map(c => c.nit).join() === [NIT.B, NIT.A, NIT.C, NIT.D, NIT.E].join() && by(NIT.A).produccion === 23000 && by(NIT.A).produccion_mercado === 26750 && by(NIT.A).indice === 0.86 && by(NIT.A).brecha === 3750 && by(NIT.A).cuadrante === 'Volumen con descuento' && by(NIT.A).poligrafos === 70 && by(NIT.A).socios === 10 && by(NIT.A).precio_efectivo === 287.5, 'ALFA: 80 pruebas, Q23,000 vs Q26,750 a mercado → índice 0.860, brecha Q3,750, Volumen con descuento; orden por producción desc');
  ok(by(NIT.B).indice === 1.141 && by(NIT.B).brecha === 0 && by(NIT.B).cuadrante === 'Estrellas' && by(NIT.C).indice === 1.371 && by(NIT.C).cuadrante === 'Premium de nicho' && by(NIT.D).brecha === 2010 && by(NIT.D).cuadrante === 'Por revisar' && by(NIT.E).cliente === `NIT ${NIT.E}` && by(NIT.E).brecha === 375, 'BETA estrella (1.141, sin brecha), GAMA premium (1.371), DELTA por revisar (brecha Q2,010), el NIT sin cliente se muestra como "NIT …"');
  const rs = P.calcularResumen(cl);
  ok(rs.produccion === 64580 && rs.pruebas === 201 && rs.clientes === 5 && rs.brecha === 6135 && rs.top5 === 100 && cerca(rs.top20, 100) && rs.mayor_cliente?.nit === NIT.B && rs.mayor_brecha?.nit === NIT.A && rs.mayor_indice?.nit === NIT.C && rs.cuadrantes.length === 4 && rs.cuadrantes.find(q => q.cuadrante === 'Por revisar')?.clientes === 2 && rs.cuadrantes.find(q => q.cuadrante === 'Volumen con descuento')?.pct_brecha === 61.1, 'resumen: Q64,580, 201 pruebas, 5 clientes, brecha Q6,135; mayor cliente BETA, mayor brecha ALFA, mayor índice GAMA; 4 cuadrantes siempre (Por revisar = 2, 61.1 % de la brecha en Volumen con descuento)');
  const refs = P.calcularReferencias(tarifas, filas);
  const rPoli = refs.find(r => r.servicio === 'POLIGRAFO' && r.categoria === 'PRE EMPLEO')!, rSoc = refs.find(r => r.servicio === 'SOCIOECONOMICO' && r.categoria === 'PRE EMPLEO')!;
  ok(refs.length === 2 && rPoli.clientes === 4 && rPoli.minimo === 250 && rPoli.p25 === 287.5 && rPoli.mediana === 350 && rPoli.p75 === 425 && rPoli.maximo === 500 && rPoli.pruebas === 165 && cerca(rPoli.precio_real!, 345.45) && rSoc.p25 === 225 && rSoc.p75 === 275 && rSoc.pruebas === 30, 'referencias: solo líneas con tarifa activa > 0 (la inactiva y la Q0 no cuentan); polígrafo preempleo 250 / 287.5 / 350 / 425 / 500, precio real 345.45 sobre 165 pruebas');
  const fr = P.calcularFranjas(tarifas, filas);
  const f = (s: string, o: number) => fr.find(x => x.servicio === s && x.orden === o)!;
  ok(fr.length === 6 && f('POLIGRAFO', 1).clientes === 1 && f('POLIGRAFO', 2).clientes === 2 && f('POLIGRAFO', 3).clientes === 1 && f('POLIGRAFO', 3).pruebas === 10 && f('SOCIOECONOMICO', 1).clientes === 2 && f('SOCIOECONOMICO', 1).pruebas === 15 && f('SOCIOECONOMICO', 2).clientes === 1 && f('SOCIOECONOMICO', 3).produccion === 3000 && f('POLIGRAFO', 1).p25 === 287.5, 'franjas preempleo (6 celdas): polígrafo Bajo DELTA / Medio ALFA+BETA / Alto GAMA; socio Bajo ALFA+E (15 pruebas) / Medio BETA / Alto GAMA Q3,000');
  const sv = P.calcularServicios(filas);
  ok(sv[0].servicio === 'POLIGRAFO' && sv[0].pruebas === 165 && sv[0].produccion === 57000 && sv[1].servicio === 'SOCIOECONOMICO' && sv[1].produccion === 7000 && sv[2].servicio === 'INFORNET' && sv[2].precio_promedio === 96.67, 'servicios: polígrafo 165 pruebas Q57,000; socio Q7,000; INFORNET precio promedio 96.67');
  const hoy = new Date('2026-11-03T12:00:00Z');
  ok(JSON.stringify(P.filtrosDesdeParams({}, hoy)) === JSON.stringify({ desde: '2026-01-01', hasta: '2026-12-31', umbralVol: 60, umbralIdx: 1 }) && P.filtrosDesdeParams({ desde: '2026-03-01', hasta: '2026-02-01', vol: '25', idx: '0.9' }, hoy).hasta === '2026-03-01' && P.filtrosDesdeParams({ vol: '0', idx: 'abc' }, hoy).umbralVol === 60 && P.filtrosDesdeParams({ vol: '25', idx: '0.9' }, hoy).umbralIdx === 0.9 && P.filtrosDesdeParams({ desde: '2026-13-40' }, hoy).desde === '2026-01-01', 'filtros: defecto = año completo, 60, 1.00; hasta < desde → desde; umbral 0 / índice no numérico / fecha inválida caen al defecto');
  ok(P.queryDeFiltros({ desde: '2026-01-01', hasta: '2026-06-30', umbralVol: 40, umbralIdx: 0.95 }) === '?desde=2026-01-01&hasta=2026-06-30&vol=40&idx=0.95' && P.conIva(100) === 112 && P.conIva(350) === 392, 'query de filtros y conIva (× 1.12)');
  const csv = P.csvClientes(cl, { desde: '2026-01-01', hasta: '2026-12-31', umbralVol: 60, umbralIdx: 1 });
  ok(csv.startsWith('﻿# mapa de precios') && csv.split('\n')[1] === 'cliente,nit,pruebas,poligrafos,socios,produccion_sin_iva,produccion_mercado_sin_iva,indice,brecha_sin_iva,precio_efectivo_sin_iva,cuadrante' && csv.split('\n').length === 7 && /MP E2E BETA,99990022K,70,65,5,27250,23875,1\.141,0,389\.29,Estrellas/.test(csv), 'CSV: BOM, nota con el rango y los umbrales, cabecera, una fila por cliente');
  ok(P.ordenarClientes(cl, 'brecha', 'desc')[0].nit === NIT.A && P.ordenarClientes(cl, 'cliente', 'asc')[0].cliente === 'MP E2E ALFA' && P.ordenarClientes(cl, 'indice', 'asc')[0].nit === NIT.E, 'ordenar por brecha desc / nombre asc / índice asc');
  const parsed = P.parseMapa({ parametros: { desde: '2026-01-01', hasta: null, umbral_vol: '60', umbral_idx: '1.0', hoy: '2026-11-03' }, clientes: [{ cliente: 'X', nit: '1', pruebas: '3', produccion: '10.5', cuadrante: 'Estrellas' }], resumen: { produccion: '10.5', cuadrantes: [{ cuadrante: 'Raro' }] } });
  ok(parsed.parametros.hasta === null && parsed.parametros.umbral_vol === 60 && parsed.clientes[0].pruebas === 3 && parsed.clientes[0].produccion === 10.5 && parsed.clientes[0].socios === 0 && parsed.resumen.cuadrantes[0].cuadrante === 'Por revisar' && parsed.franjas.length === 0 && parsed.resumen.mayor_cliente === null, 'parseMapa: numéricos como texto → number, faltantes → 0 / [] / null, cuadrante desconocido → Por revisar');

  /* ───────────── C. E2E en HIT ───────────── */
  console.log(`\nC. E2E en HIT${CONSERVAR ? ' (--conservar)' : SOLO_LIMPIAR ? ' (--solo-limpiar)' : ''}`);
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const limpiar = async () => {
    const { data: exps } = await sb.from('facturacion_expediente').select('id').like('id_externo', 'mpE2E%');
    const ids = (exps ?? []).map(e => e.id as string);
    if (ids.length) { await sb.from('facturacion_componente').delete().in('expediente_id', ids); await sb.from('facturacion_expediente').delete().in('id', ids); }
    await sb.from('tarifario').delete().in('nit', NITS);
    await sb.from('clientes').delete().in('nit', NITS);
    const { count } = await sb.from('facturacion_expediente').select('id', { count: 'exact', head: true }).like('id_externo', 'mpE2E%');
    return count ?? 0;
  };
  if (SOLO_LIMPIAR) { ok((await limpiar()) === 0, 'limpieza: 0 expedientes mpE2E, tarifas y clientes de prueba borrados'); console.log(`\n${pass} 🟢 / ${fail} 🔴`); process.exit(fail ? 1 : 0); }
  await limpiar();
  // Sembrar
  const { error: eCli } = await sb.from('clientes').insert([...NOMBRES].map(([nit, nombre], i) => ({ airtable_id: `sbwMPE2E${i}`, nombre_empresa: nombre, razon_social: `${nombre}, S.A.`, nit, activo: true })));
  const { error: eTar } = await sb.from('tarifario').insert(TARIFAS.map((t, i) => ({ id: undefined, nit: t.nit, razon_social: NOMBRES.get(t.nit) ?? 'E2E', tipo_prueba: t.tipo, categoria: t.cat, territorio: 'METROPOLITANA', monto: t.monto, anio: '2026', aprobado_por: 'E2E', aprobado_en: '2026-01-01T00:00:00Z', activo: t.activo !== false })).map(({ id: _id, ...r }) => r));
  const exps: Record<string, unknown>[] = []; const comps: Array<{ ext: string; servicio: string; categoria: string | null; monto: number; situacion: string; estado_tarifa: string }> = [];
  let k = 0;
  for (const s of SEEDS) for (let i = 0; i < s.n; i++) {
    const ext = `mpE2E${String(++k).padStart(4, '0')}`;
    exps.push({ fuente: 'agenda', id_externo: ext, empresa_id_externo: `recMP${s.nit ?? 'X'}`, empresa_nombre_externo: s.nit ? (NOMBRES.get(s.nit) ?? `Empresa ${s.nit}`) : 'SIN NIT', nit_resuelto: s.nit, persona: `Persona ${k}`, tipo_prueba: s.servicio, categoria_prueba: s.categoria, proceso_solicitado: `SOLO ${s.servicio}`, fecha_ingreso: s.fecha ?? '2026-03-15', terminado: true, cancelado: false, eliminado: s.eliminado ?? false, estado_tarifa: s.estado_tarifa ?? 'resuelta', monto_calculado: s.monto, status_cobro_externo: 'PENDIENTE', actualizado_en_externo: '2026-03-15T12:00:00.000Z' });
    comps.push({ ext, servicio: s.servicio, categoria: s.categoria, monto: s.monto, situacion: s.situacion ?? 'cobra', estado_tarifa: s.estado_tarifa ?? 'resuelta' });
  }
  const { data: insExps, error: eExp } = await sb.from('facturacion_expediente').insert(exps).select('id, id_externo');
  const idPorExt = new Map((insExps ?? []).map(e => [e.id_externo as string, e.id as string]));
  const { error: eComp } = await sb.from('facturacion_componente').insert(comps.map(c => ({ fuente: 'agenda', expediente_id: idPorExt.get(c.ext), id_externo: c.ext, servicio: c.servicio, estado_prueba: 'APROBO', situacion: c.situacion, motivo: 'E2E', categoria: c.categoria, territorio: 'METROPOLITANA', monto_calculado: c.monto, estado_tarifa: c.estado_tarifa })));
  ok(!eCli && !eTar && !eExp && !eComp && idPorExt.size === exps.length, `sembrado: ${NOMBRES.size} clientes, ${TARIFAS.length} tarifas, ${exps.length} expedientes / pruebas (201 que entran + 19 que no)${[eCli, eTar, eExp, eComp].filter(Boolean).map(e => ' · ' + e!.message).join('')}`);

  // RPC con la llave de servicio
  const t0 = Date.now();
  const { data: raw, error: eRpc } = await sb.rpc('precios_mapa', { p_desde: '2026-01-01', p_hasta: '2026-12-31', p_umbral_vol: 60, p_umbral_idx: 1.0 });
  const ms = Date.now() - t0;
  ok(!eRpc && !!raw, `RPC precios_mapa con service_role responde (${ms} ms)${eRpc ? ': ' + eRpc.message : ''}`);
  const M = P.parseMapa(raw);
  // Solo nuestras filas (la base puede tener otros datos conservados): comparamos por NIT
  const mios = M.clientes.filter(c => NITS.includes(c.nit));
  const esperado = P.calcularMapa(filas, tarifas, NOMBRES, 60, 1);
  const difs: string[] = [];
  for (const e of esperado.clientes) {
    const r = mios.find(c => c.nit === e.nit);
    if (!r) { difs.push(`${e.nit} falta`); continue; }
    for (const kk of ['cliente', 'pruebas', 'poligrafos', 'socios', 'produccion', 'produccion_mercado', 'indice', 'brecha', 'precio_efectivo', 'cuadrante'] as const) {
      const a = r[kk], b = e[kk];
      if (typeof a === 'number' && typeof b === 'number' ? !cerca(a, b) : a !== b) difs.push(`${e.cliente}.${kk}: rpc ${a} vs ts ${b}`);
    }
  }
  ok(mios.length === 5 && difs.length === 0 && !M.clientes.some(c => c.nit === NIT.X), `clientes: la RPC coincide fila por fila con la regla en TS (5 clientes × 10 campos); el NIT con ingreso 2025 no entra${difs.length ? ' · ' + difs.slice(0, 5).join(' | ') : ''}`);
  ok(mios.map(c => c.nit).join() === [NIT.B, NIT.A, NIT.C, NIT.D, NIT.E].join(), 'orden por producción desc: BETA, ALFA, GAMA, DELTA, NIT sin cliente');
  const soloMios = M.clientes.length === 5;
  if (soloMios) {
    const R = M.resumen, E = esperado.resumen;
    ok(cerca(R.produccion, E.produccion) && R.pruebas === E.pruebas && R.clientes === 5 && cerca(R.brecha, E.brecha) && R.top5 === 100 && R.top10 === 100 && R.mayor_cliente?.nit === NIT.B && R.mayor_brecha?.nit === NIT.A && R.mayor_indice?.nit === NIT.C, `resumen (SQL = TS): Q${R.produccion} · ${R.pruebas} pruebas · brecha Q${R.brecha} · top5 ${R.top5} % · mayor ${R.mayor_cliente?.cliente} · mayor brecha ${R.mayor_brecha?.cliente} · mayor índice ${R.mayor_indice?.cliente}`);
    const qd = (q: string) => R.cuadrantes.find(x => x.cuadrante === q)!, qe = (q: string) => E.cuadrantes.find(x => x.cuadrante === q)!;
    ok(R.cuadrantes.length === 4 && P.CUADRANTES.every(q => qd(q) && qd(q).clientes === qe(q).clientes && cerca(qd(q).produccion, qe(q).produccion) && cerca(qd(q).brecha, qe(q).brecha) && cerca(qd(q).pct_produccion, qe(q).pct_produccion) && cerca(qd(q).pct_brecha, qe(q).pct_brecha)), `cuadrantes (SQL = TS, los 4 siempre): ${R.cuadrantes.map(q => `${q.cuadrante} ${q.clientes} (${q.pct_produccion} %)`).join(' · ')}`);
    const fd = (s: string, o: number) => M.franjas.find(x => x.servicio === s && x.orden === o)!, fe = (s: string, o: number) => esperado.franjas.find(x => x.servicio === s && x.orden === o)!;
    ok(M.franjas.length === 6 && ['POLIGRAFO', 'SOCIOECONOMICO'].every(s => [1, 2, 3].every(o => fd(s, o) && fd(s, o).clientes === fe(s, o).clientes && fd(s, o).pruebas === fe(s, o).pruebas && cerca(fd(s, o).produccion, fe(s, o).produccion) && cerca(fd(s, o).p25 ?? -1, fe(s, o).p25 ?? -1) && cerca(fd(s, o).p75 ?? -1, fe(s, o).p75 ?? -1))), `franjas (SQL = TS, 6 celdas): polígrafo ${[1, 2, 3].map(o => fd('POLIGRAFO', o).clientes).join('/')} · socio ${[1, 2, 3].map(o => fd('SOCIOECONOMICO', o).clientes).join('/')} clientes en Bajo/Medio/Alto`);
    const rd1 = (s: string, c: string) => M.referencias.find(x => x.servicio === s && x.categoria === c)!, re1 = (s: string, c: string) => esperado.referencias.find(x => x.servicio === s && x.categoria === c)!;
    ok(M.referencias.length === 2 && [['POLIGRAFO', 'PRE EMPLEO'], ['SOCIOECONOMICO', 'PRE EMPLEO']].every(([s, c]) => rd1(s, c) && (['clientes', 'minimo', 'p25', 'mediana', 'p75', 'maximo', 'pruebas'] as const).every(kk => cerca(rd1(s, c)[kk], re1(s, c)[kk])) && cerca(rd1(s, c).precio_real ?? -1, re1(s, c).precio_real ?? -1)), `referencias (SQL = TS): polígrafo preempleo ${rd1('POLIGRAFO', 'PRE EMPLEO').minimo} / ${rd1('POLIGRAFO', 'PRE EMPLEO').p25} / ${rd1('POLIGRAFO', 'PRE EMPLEO').mediana} / ${rd1('POLIGRAFO', 'PRE EMPLEO').p75} / ${rd1('POLIGRAFO', 'PRE EMPLEO').maximo}, real ${rd1('POLIGRAFO', 'PRE EMPLEO').precio_real}; la tarifa inactiva y la Q0 no cuentan`);
    ok(M.servicios.length === 3 && M.servicios.every((s, i) => s.servicio === esperado.servicios[i].servicio && s.pruebas === esperado.servicios[i].pruebas && cerca(s.produccion, esperado.servicios[i].produccion) && cerca(s.precio_promedio, esperado.servicios[i].precio_promedio)), `servicios (SQL = TS): ${M.servicios.map(s => `${s.servicio} ${s.pruebas} · Q${s.produccion}`).join(' · ')}`);
  } else console.log(`  ⚪ la base tiene otros clientes conservados (${M.clientes.length}): resumen/franjas/referencias/servicios se comparan solo por filas propias`);
  // Umbrales como parámetros
  const { data: raw2 } = await sb.rpc('precios_mapa', { p_desde: '2026-01-01', p_hasta: '2026-12-31', p_umbral_vol: 25, p_umbral_idx: 0.8 });
  const M2 = P.parseMapa(raw2); const c2 = (nit: string) => M2.clientes.find(c => c.nit === nit)!;
  ok(c2(NIT.C).cuadrante === 'Estrellas' && c2(NIT.A).cuadrante === 'Estrellas' && c2(NIT.D).cuadrante === 'Por revisar' && c2(NIT.E).cuadrante === 'Por revisar' && M2.parametros.umbral_vol === 25 && M2.parametros.umbral_idx === 0.8, 'umbrales por parámetro (25 / 0.80): GAMA y ALFA pasan a Estrellas; DELTA (0.717) y E siguen Por revisar');
  // Rango como parámetro
  const { data: raw3 } = await sb.rpc('precios_mapa', { p_desde: '2025-12-01', p_hasta: '2025-12-31', p_umbral_vol: 60, p_umbral_idx: 1.0 });
  const M3 = P.parseMapa(raw3);
  ok(M3.clientes.some(c => c.nit === NIT.X) && !M3.clientes.some(c => c.nit === NIT.A) && M3.clientes.find(c => c.nit === NIT.X)!.pruebas === 6, 'rango por parámetro (dic-2025): entra el NIT con ingreso 2025-12-31 (6 pruebas) y no los de 2026');
  const { data: raw4, error: e4 } = await sb.rpc('precios_mapa', { p_desde: '2026-01-01', p_hasta: null, p_umbral_vol: 60, p_umbral_idx: 1.0 });
  ok(!e4 && P.parseMapa(raw4).parametros.hasta === null && P.parseMapa(raw4).clientes.some(c => c.nit === NIT.A), 'p_hasta null = sin tope superior');
  // Llave anon
  const anon = process.env.SUPABASE_ANON_KEY;
  if (anon) {
    const { createClient } = await import('@supabase/supabase-js');
    const pub = createClient(process.env.SUPABASE_URL!, anon, { auth: { persistSession: false } });
    const { data: dA, error: eA } = await pub.rpc('precios_mapa', { p_desde: '2026-01-01' });
    ok(!dA && !!eA && /permission denied|42501/i.test(`${eA?.code} ${eA?.message}`), `con la llave anon la RPC falla por permiso: ${eA?.code ?? ''} ${eA?.message ?? ''}`);
  } else console.log('  ⚪ SUPABASE_ANON_KEY no está en el entorno: prueba con la llave pública omitida (verificada por SQL con set role anon en el PR)');
  if (!CONSERVAR) ok((await limpiar()) === 0, 'limpieza verificada: 0 expedientes mpE2E; tarifas y clientes de prueba borrados');
  else console.log('  ⚪ --conservar: datos sembrados quedan para el E2E en Chrome (borrar con --solo-limpiar)');

  console.log(`\n${pass} 🟢 / ${fail} 🔴`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
