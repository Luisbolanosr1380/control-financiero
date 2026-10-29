/**
 * TARIFARIO (migraciones 014 + 015) — validador.
 *
 *  A. Estático: 014 en migrations/ (create table if not exists, candado
 *     único, sin delete/drop/begin/commit), seed en seeds/ (NO en migrations/,
 *     idempotente, solo Golden), 015 (tabla tarifario_historial, trigger
 *     única fuente de la bitácora, RPCs con set_config de actor/motivo, sin
 *     drop/delete/commit), writes de la app por RPC, actions con
 *     autorizar('catalogos') en la primera línea, pantalla sin diálogos del
 *     navegador, nav.
 *  B. Motor PURO: canonicalización (variantes reales de la Agenda y del
 *     tarifario), Q0 = sin tarifa, territorio no indicado, COMPLETO,
 *     alias de empresa → NIT, duplicado canónico, ambigüedad, resumen por
 *     empresa, antigüedad del precio (historial → año → updated_at),
 *     umbral de estancada, texto del badge, puntos y crecimiento.
 *  C. E2E en la base indicada (HIT: tabla vacía): crear, aviso de
 *     combinación repetida con otra grafía (PREEMPLEO vs PRE EMPLEO),
 *     candado exacto de la base, aprobar, editar monto → vuelve a
 *     pendiente, Q0 no se aprueba, lookup real, desactivar/reactivar, lote;
 *     y la BITÁCORA real: alta / cambio_precio con variación % (incl. anterior
 *     Q0 → null) y motivo / aprobación con usuario / desactivación /
 *     reactivación / SQL directo sin GUC → usuario null; antigüedad cae al
 *     año cuando no hay historial. Limpieza verificada (cascade).
 *
 * Uso: npx tsx --conditions=react-server scripts/validate-tarifario.ts hit
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AccionHistorial, HistorialTarifa } from '../src/lib/tarifario/antiguedad';

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
  // ── 015: histórico ──
  const m15 = rd('supabase/migrations/015_tarifario_historial.sql');
  const sinCom15 = m15.replace(/--.*$/gm, '');
  ok(/create table if not exists tarifario_historial/.test(m15) && /references tarifario\(id\) on delete cascade/.test(m15) && /check \(accion in \('alta', 'cambio_precio', 'aprobacion', 'desactivacion', 'reactivacion'\)\)/.test(m15) && /alter table tarifario_historial enable row level security/.test(m15), '015: tarifario_historial (if not exists, FK cascade, 5 acciones, RLS)');
  ok(/create or replace function tarifario_historial_registrar\(\)/.test(m15) && /create or replace trigger trg_tarifario_historial\s+after insert or update on tarifario/.test(m15) && /current_setting\('app\.actor', true\)/.test(m15) && /current_setting\('app\.motivo', true\)/.test(m15), '015: trigger AFTER INSERT/UPDATE = única fuente de la bitácora; lee GUCs app.actor / app.motivo');
  ok(/round\(\(new\.monto - old\.monto\) \/ old\.monto \* 100, 2\)/.test(m15) && /coalesce\(old\.monto, 0\) > 0/.test(m15), '015: variacion_pct = (nuevo − anterior) / anterior × 100 redondeado a 2; null si el anterior era Q0');
  ok(/create or replace function tarifario_insertar\(p_actor text, p_motivo text, p_fila jsonb\)/.test(m15) && /create or replace function tarifario_actualizar\(p_actor text, p_motivo text, p_ids uuid\[\], p_patch jsonb\)/.test(m15) && (m15.match(/set_config\('app\.actor',\s+coalesce\(p_actor, ''\),\s+true\)/g) ?? []).length === 2 && (m15.match(/set_config\('app\.motivo',\s+coalesce\(p_motivo, ''\),\s+true\)/g) ?? []).length === 2, '015: RPCs tarifario_insertar / tarifario_actualizar fijan actor y motivo con set_config(..., true) en la misma transacción');
  ok(!/\b(drop|truncate)\b/i.test(sinCom15) && !/\bdelete\s+from\b/i.test(sinCom15) && !/^\s*(begin|commit)\s*;/im.test(sinCom15) && !/alter table tarifario\b(?!_historial)/.test(sinCom15) && !/uq_tarifario_llave/.test(sinCom15), '015: sin drop/truncate/delete/commit; no toca `tarifario` ni su clave única (solo agrega)');
  ok(fs.readdirSync('supabase/migrations').filter(f => /^01[6-9]_|^0[2-9]\d_/.test(f)).every(f => !/\b(tarifario|tarifario_historial)\b/.test(rd(`supabase/migrations/${f}`).replace(/--.*$/gm, ''))), 'ninguna migración posterior a la 015 toca tarifario / tarifario_historial');
  const db = rd('src/lib/db/tarifario.ts');
  ok(/sb\.rpc\('tarifario_insertar'/.test(db) && /sb\.rpc\('tarifario_actualizar'/.test(db) && (db.match(/\.from\('tarifario'\)\.(insert|update)\(/g) ?? []).length === 2 && /rpcNoExiste/.test(db), 'db/tarifario.ts: alta y actualizaciones (monto, aprobar, lote, activar) van por RPC; el write directo queda solo como fallback si la 015 no está');
  const acts = rd('src/app/(app)/tarifario/actions.ts');
  for (const fn of ['crearTarifaAction', 'editarTarifaAction', 'aprobarTarifaAction', 'activarTarifaAction']) {
    const m = new RegExp(`export async function ${fn}\\([^)]*\\)[^{]*\\{\\s*const permiso = await autorizar\\('catalogos'\\);`).test(acts);
    ok(m, `${fn}: primera línea autorizar('catalogos')`);
  }
  ok(/export async function historialTarifaAction\([^)]*\)[^{]*\{\s*await exigir\('ver'\);/.test(acts), "historialTarifaAction: primera línea exigir('ver') (consultar el histórico = todos)");
  const tabla = rd('src/components/tarifario/tarifas-tabla.tsx');
  const ui = rd('src/components/tarifario/tarifario-client.tsx') + rd('src/components/tarifario/tarifa-form.tsx') + tabla;
  ok(!/window\.(confirm|alert|prompt)\(|\bconfirm\(/.test(ui), 'pantalla sin diálogos del navegador');
  ok(/role="alertdialog"/.test(ui) && /confirmarDuplicado/.test(ui), 'aviso de combinación repetida con confirmación en el pie del modal');
  ok(/Motivo del cambio de/.test(tabla) && /motivo: motivoEdit/.test(tabla) && /Ver histórico de/.test(tabla) && /historialTarifaAction/.test(tabla) && /textoAntiguedad/.test(tabla), 'tabla: motivo opcional al editar el monto, "ver histórico" por fila y badge de antigüedad');
  ok(/'\/tarifario'/.test(rd('src/components/shell/sidebar.tsx')) && /'\/tarifario'/.test(rd('src/components/shell/topbar.tsx')) && /startsWith\('\/tarifario\/'\)/.test(rd('src/components/shell/topbar.tsx')), 'nav: Tarifario en sidebar y breadcrumb (lista y detalle)');
  ok(new RegExp("export async function aprobarTarifasPorNitAction\\([^)]*\\)[^{]*\\{\\s*const permiso = await autorizar\\('catalogos'\\);").test(acts), "aprobarTarifasPorNitAction: primera línea autorizar('catalogos') (aprobar en lote = mismo permiso que aprobar una)");
  // RE-RESOLVER AUTOMÁTICO (pulido): tocar el tarifario de un NIT re-clasifica su cola de la Agenda sin esperar el cron ni "Traer ahora".
  ok(/import \{ reclasificar \} from '@\/lib\/db\/facturacion-agenda'/.test(acts) && /reclasificar\(\{ nit: k \}\)/.test(acts) && (acts.match(/reresolverNit\(/g) ?? []).length >= 7 && /catch \(e\) \{ console\.error\('re-resolver tras tarifa:'/.test(acts), 'actions: crear / editar monto / aprobar / activar / lote / generar re-resuelven la cola del NIT en local (reclasificar({ nit }), fail-soft: la tarifa queda guardada aunque falle)');
  ok(/export async function reclasificar\(filtro: \{ empresaIdExterno\?: string; empresasIdExterno\?: string\[\]; [^}]*nit\?: string \}/.test(rd('src/lib/db/facturacion-agenda.ts')) && /if \(filtro\.nit\) q = q\.eq\('nit_resuelto', filtro\.nit\);/.test(rd('src/lib/db/facturacion-agenda.ts')), 'reclasificar acepta filtro por NIT (solo los expedientes ya resueltos a ese cliente)');
  const aliasSrc = db.slice(db.indexOf('export async function aliasClientes('), db.indexOf('export interface TarifaInput'));
  ok(/c\.razonSocial, c\.nombreComercial, \.\.\.\(c\.aliases \?\? \[\]\)/.test(aliasSrc), 'aliasClientes: el motor identifica el NIT también por razón social, nombre comercial y marcas (020)');
  ok(fs.existsSync('src/app/(app)/tarifario/[nit]/page.tsx') && /notFound\(\)/.test(rd('src/app/(app)/tarifario/[nit]/page.tsx')), 'ruta de detalle /tarifario/[nit] (404 si el NIT no tiene tarifas)');
  const det = rd('src/components/tarifario/empresa-detalle.tsx');
  ok(/role="alertdialog"/.test(det) && !/window\.(confirm|alert|prompt)\(|\bconfirm\(/.test(det + rd('src/components/tarifario/empresas-lista.tsx')), 'detalle: aprobar en lote con confirmación en línea, sin diálogos del navegador');
  ok(/puede\('catalogos'\)/.test(det), 'detalle: el botón de lote solo para quien puede aprobar (catalogos)');

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

  const T = (id: string, nit: string, tipo: string, cat: string, ter: string, monto: number, extra: Partial<{ razonSocial: string; aprobadoEn: string | null; activo: boolean; anio: string }> = {}) =>
    ({ id, nit, razonSocial: extra.razonSocial ?? 'EMPRESA X', tipoPrueba: tipo, categoria: cat, territorio: ter, monto, anio: extra.anio ?? '2026', aprobadoPor: extra.aprobadoEn ? 'a@b' : '', aprobadoEn: extra.aprobadoEn ?? null, activo: extra.activo ?? true });
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

  // ── FORMAS DE PRECIO (matriz / por territorio / por categoría / único) ──
  const C = await import('../src/lib/tarifario/canon');
  ok(C.formaPrecio('INFORNET') === 'unico' && C.formaPrecio('Consulta Infornet') === 'unico' && C.formaPrecio('SOCIO EMPRESARIAL') === 'territorio' && C.formaPrecio('SOCIOECONOMICO EMPRESARIAL') === 'territorio' && C.formaPrecio('POLIGRAFO') === 'matriz' && C.formaPrecio('SOCIOECONOMICO') === 'matriz' && C.formaPrecio('BACKGROUND CHECK') === 'matriz' && C.formaPrecio('MIDOT') === 'unico' && C.formaPrecio('PDA') === 'unico' && C.formaPrecio('Entrevista Gerencial') === 'unico' && C.formaPrecio('ENTREVISTA ESPECIALISTA') === 'unico' && C.formaPrecio('INSIGHT') === 'unico', 'formaPrecio: INFORNET, PDA, ENTREVISTA GERENCIAL / ESPECIALISTA, INSIGHT y MIDOT único; SOCIO EMPRESARIAL por territorio; polígrafo/socio y lo no definido (BACKGROUND CHECK) matriz');
  // SERVICIOS DE PRECIO ÚNICO (PDA, entrevistas, INSIGHT, MIDOT): canon exacto a la llave de FORMA_POR_TIPO y una sola fila UNICA/UNICA.
  ok(C.canonTipoPrueba('PDA') === 'PDA' && C.canonTipoPrueba('pda ') === 'PDA' && C.canonTipoPrueba('ENTREVISTA GERENCIAL') === 'ENTREVISTA GERENCIAL' && C.canonTipoPrueba('ENTREVISTA GERENCIL') === 'ENTREVISTA GERENCIAL' && C.canonTipoPrueba('Entrevista Especialista') === 'ENTREVISTA ESPECIALISTA' && C.canonTipoPrueba('INSIGHT') === 'INSIGHT' && C.canonTipoPrueba('MIDOT') === 'MIDOT' && C.canonTipoPrueba('ENTREVISTA FORENSE') === 'ENTREVISTA FORENSE' && C.canonTipoPrueba('BACKGROUND CHECK') === 'BACKGROUND CHECK' && (C.TIPOS_PRUEBA as readonly string[]).includes('PDA') && (C.TIPOS_PRUEBA as readonly string[]).includes('MIDOT'), 'canonTipoPrueba: PDA / ENTREVISTA GERENCIAL (y la errata GERENCIL) / ENTREVISTA ESPECIALISTA / INSIGHT / MIDOT devuelven la llave exacta; FORENSE y BACKGROUND CHECK no cambian; están en TIPOS_PRUEBA');
  ok(C.llaveTarifa({ nit: '1', tipoPrueba: 'PDA', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA' }) === '1|PDA|UNICA|UNICA' && C.llaveTarifa({ nit: '1', tipoPrueba: 'MIDOT', categoria: 'RUTINA', territorio: 'DEPARTAMENTAL' }) === '1|MIDOT|UNICA|UNICA', 'llave efectiva de PDA / MIDOT: UNICA/UNICA aunque la fila traiga categoría y territorio de matriz');
  const unicos = [
    T('pd1', '11854243', 'PDA', 'PRE EMPLEO', 'METROPOLITANA', 3200), T('pd2', '11854243', 'PDA', 'PRE EMPLEO', 'DEPARTAMENTAL', 0), T('pd3', '11854243', 'PDA', 'RUTINA', 'METROPOLITANA', 0), T('pd4', '11854243', 'PDA', 'RUTINA', 'DEPARTAMENTAL', 0), T('pd5', '11854243', 'PDA', 'ESPECIFICO', 'METROPOLITANA', 0), T('pd6', '11854243', 'PDA', 'ESPECIFICO', 'DEPARTAMENTAL', 0),
    T('ge1', '11854243', 'ENTREVISTA GERENCIAL', 'PRE EMPLEO', 'METROPOLITANA', 0), T('ge2', '11854243', 'ENTREVISTA GERENCIAL', 'RUTINA', 'METROPOLITANA', 0),
    T('es1', '11854243', 'ENTREVISTA ESPECIALISTA', 'UNICA', 'UNICA', 1500, { aprobadoEn: '2026-01-01' }),
    T('in1', '11854243', 'INSIGHT', 'RUTINA', 'METROPOLITANA', 160), T('in2', '11854243', 'INSIGHT', 'PRE EMPLEO', 'METROPOLITANA', 180),
  ];
  r = resolverTarifa(unicos, { nit: '11854243', tipoPrueba: 'PDA', categoria: '', territorio: '' });
  ok(r.estado === 'ok' && r.monto === 3200 && r.tarifa.id === 'pd1' && /5 en Q0/.test(r.avisos.join(' ')), 'PDA único sin categoría ni territorio → Q3,200 aun con las 5 celdas legacy en Q0 (aviso: normalizar), no "ambigua"');
  r = resolverTarifa(unicos, { nit: '11854243', tipoPrueba: 'PDA', categoria: 'AGENDADO', territorio: 'DEPARTAMENTAL' });
  ok(r.estado === 'ok' && r.monto === 3200, 'PDA con una categoría basura y otro territorio → el mismo Q3,200 (la forma ignora categoría y territorio)');
  r = resolverTarifa(unicos, { nit: '11854243', tipoPrueba: 'ENTREVISTA GERENCIAL', categoria: '', territorio: '' });
  ok(r.estado === 'sin_tarifa' && /ENTREVISTA GERENCIAL/.test(r.mensaje), 'ENTREVISTA GERENCIAL con todas en Q0 → sin tarifa (no es gratis), no "no trae categoría"');
  r = resolverTarifa(unicos, { nit: '11854243', tipoPrueba: 'ENTREVISTA ESPECIALISTA', categoria: '', territorio: '' });
  ok(r.estado === 'ok' && r.monto === 1500 && r.aprobada && r.avisos.length === 0, 'ENTREVISTA ESPECIALISTA ya normalizada (UNICA/UNICA) → Q1,500 aprobada, sin avisos');
  r = resolverTarifa(unicos, { nit: '11854243', tipoPrueba: 'INSIGHT', categoria: '', territorio: '' });
  ok(r.estado === 'ambigua' && /2 montos distintos/.test(r.mensaje), 'INSIGHT con dos precios distintos (160 y 180) → ambigua: hay que dejar uno');
  r = resolverTarifa(unicos, { nit: '11854243', tipoPrueba: 'MIDOT', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA' });
  ok(r.estado === 'no_encontrada' && /no tiene tarifa para MIDOT \(precio único por cliente\)/.test(r.mensaje), 'MIDOT sin fila → no_encontrada diciendo que es precio único');
  ok(buscarDuplicado(unicos, { nit: '11854243', tipoPrueba: 'PDA', categoria: 'UNICA', territorio: 'UNICA' })?.id === 'pd1' && tarifasDuplicadas(unicos).has('pd2') && !tarifasDuplicadas(unicos).has('es1'), 'duplicados por llave efectiva: las 6 celdas legacy de PDA cuentan como repetidas; la ESPECIALISTA normalizada no');

  ok(C.llaveTarifa({ nit: '1', tipoPrueba: 'INFORNET', categoria: 'PRE EMPLEO', territorio: 'metro' }) === '1|INFORNET|UNICA|UNICA' && C.llaveTarifa({ nit: '1', tipoPrueba: 'Socio Empresarial', categoria: 'RUTINA', territorio: 'depto' }) === '1|SOCIOECONOMICO EMPRESARIAL|UNICA|DEPARTAMENTAL' && C.llaveTarifa({ nit: '1', tipoPrueba: 'POLIGRAFO', categoria: 'RUTINA', territorio: 'depto' }) === '1|POLIGRAFO|RUTINA|DEPARTAMENTAL' && C.dimTexto(C.UNICA) === '—' && C.canonCategoria('UNICA') === 'UNICA' && C.canonTerritorio('unica') === 'UNICA' && !(C.CATEGORIAS as readonly string[]).includes('INFORNET'), 'llave efectiva: las dimensiones que la forma no usa van al centinela UNICA (sin migración); INFORNET ya no es categoría');
  const formas = [
    T('u1', '777', 'INFORNET', 'UNICA', 'UNICA', 44.64, { aprobadoEn: '2026-01-01' }),
    T('l1', '888', 'INFORNET', 'PRE EMPLEO', 'METROPOLITANA', 44), T('l2', '888', 'INFORNET', 'PRE EMPLEO', 'DEPARTAMENTAL', 44),
    T('x1', '999', 'INFORNET', 'INFORNET', 'METROPOLITANA', 44), T('x2', '999', 'INFORNET', 'PRE EMPLEO', 'DEPARTAMENTAL', 50),
    T('s1', '777', 'SOCIOECONOMICO EMPRESARIAL', 'UNICA', 'METROPOLITANA', 600), T('s2', '777', 'SOCIOECONOMICO EMPRESARIAL', 'UNICA', 'DEPARTAMENTAL', 750),
  ];
  r = resolverTarifa(formas, { nit: '777', tipoPrueba: 'CONSULTA INFORNET', categoria: '', territorio: '' });
  ok(r.estado === 'ok' && r.monto === 44.64 && r.aprobada, 'único: INFORNET resuelve sin categoría ni territorio (Q44.64)');
  r = resolverTarifa(formas, { nit: '777', tipoPrueba: 'INFORNET', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA' });
  ok(r.estado === 'ok' && r.monto === 44.64, 'único: ignora la categoría y el territorio que traiga el expediente');
  r = resolverTarifa(formas, { nit: '888', tipoPrueba: 'INFORNET', categoria: '', territorio: '' });
  ok(r.estado === 'ok' && r.monto === 44 && r.avisos.some(a => /normalizarlas/.test(a)), 'único con filas legacy (PRE EMPLEO × 2 territorios, mismo monto) → resuelve y avisa que conviene normalizar');
  r = resolverTarifa(formas, { nit: '999', tipoPrueba: 'INFORNET', categoria: 'RUTINA', territorio: 'DEPARTAMENTAL' });
  ok(r.estado === 'ambigua' && /precio único/.test(r.mensaje) && r.candidatas.length === 2, 'único con montos distintos (44 vs 50) → ambigua: dejar un solo precio');
  r = resolverTarifa(formas, { nit: '777', tipoPrueba: 'SOCIO EMPRESARIAL', categoria: '', territorio: 'GUATEMALA' });
  ok(r.estado === 'ok' && r.monto === 600, 'por territorio: SOCIO EMPRESARIAL sin categoría en GUATEMALA → Q600');
  r = resolverTarifa(formas, { nit: '777', tipoPrueba: 'SOCIO EMPRESARIAL', categoria: 'RUTINA', territorio: 'DEPARTAMENTAL' });
  ok(r.estado === 'ok' && r.monto === 750, 'por territorio: ignora la categoría (RUTINA) y toma DEPARTAMENTAL → Q750');
  r = resolverTarifa(formas, { nit: '777', tipoPrueba: 'SOCIO EMPRESARIAL', categoria: '', territorio: '' });
  ok(r.estado === 'ambigua' && /territorio/.test(r.mensaje), 'por territorio sin territorio y precios distintos → ambigua (pide territorio)');
  r = resolverTarifa(formas, { nit: '777', tipoPrueba: 'POLIGRAFO', categoria: '', territorio: 'METROPOLITANA' });
  ok(r.estado === 'no_encontrada' && /no trae categoría/.test(r.mensaje), 'matriz sin categoría → no_encontrada con el motivo (la categoría sigue siendo obligatoria en polígrafo/socio)');
  ok(buscarDuplicado(formas, { nit: '888', tipoPrueba: 'INFORNET', categoria: 'RUTINA', territorio: 'UNICA' })?.id === 'l1' && tarifasDuplicadas(formas).has('l1') && tarifasDuplicadas(formas).has('x2') && !tarifasDuplicadas(formas).has('u1'), 'duplicados por llave efectiva: las filas legacy de INFORNET del mismo NIT cuentan como repetidas');
  const G = await import('../src/lib/tarifario/generar');
  let plan = G.planGenerar('555', [], ['SOCIO EMPRESARIAL', 'CONSULTA INFORNET', 'COMPLETO']);
  ok(plan.filas.length === 13 && plan.porTipo.POLIGRAFO === 6 && plan.porTipo.SOCIOECONOMICO === 4 && plan.porTipo['SOCIOECONOMICO EMPRESARIAL'] === 2 && plan.porTipo.INFORNET === 1 && plan.filas.filter(f => f.tipoPrueba === 'INFORNET').every(f => f.categoria === 'UNICA' && f.territorio === 'UNICA') && plan.filas.filter(f => f.tipoPrueba === 'SOCIOECONOMICO EMPRESARIAL').every(f => f.categoria === 'UNICA') && /INFORNET 1 \(único\)/.test(G.resumenPlan(plan)) && /SOCIOECONOMICO EMPRESARIAL 2 \(por territorio\)/.test(G.resumenPlan(plan)), 'planGenerar: plantilla (10) + socio empresarial (2, por territorio) + infornet (1, único); COMPLETO no genera filas');
  plan = G.planGenerar('555', [T('p1', '555', 'POLIGRAFO', 'PREEMPLEO', 'metro', 1), T('p2', '555', 'INFORNET', 'PRE EMPLEO', 'METROPOLITANA', 1, { activo: false })], ['INFORNET'], ['BACKGROUND CHECK']);
  ok(plan.filas.length === 15 && plan.omitidas.length === 2 && plan.porTipo['BACKGROUND CHECK'] === 6, 'planGenerar no duplica: omite lo que ya existe por llave efectiva (incluso inactivo o con otra grafía); un tipo extra matriz genera 6');
  plan = G.planGenerar('11854243', [T('pd1', '11854243', 'PDA', 'PRE EMPLEO', 'METROPOLITANA', 3200)], ['PDA', 'ENTREVISTA GERENCIL', 'MIDOT', 'INSIGHT', 'ENTREVISTA ESPECIALISTA']);
  ok(plan.porTipo['ENTREVISTA GERENCIAL'] === 1 && plan.porTipo.MIDOT === 1 && plan.porTipo.INSIGHT === 1 && plan.porTipo['ENTREVISTA ESPECIALISTA'] === 1 && plan.porTipo.PDA === undefined && plan.omitidas.some(f => f.tipoPrueba === 'PDA') && plan.filas.filter(f => f.forma === 'unico').every(f => f.categoria === 'UNICA' && f.territorio === 'UNICA') && plan.filas.length === 14, 'generar para un cliente que pide PDA / entrevistas / INSIGHT / MIDOT en la Agenda: 1 fila UNICA/UNICA por servicio único; PDA se omite porque ya existe (por llave efectiva, aunque esté como matriz)');

  // ── FORMA 'categoria' (por categoría, sin territorio): SOCIOECONOMICO VIRTUAL — queda completo el 2×2 ──
  ok(C.formaPrecio('SOCIOECONOMICO VIRTUAL') === 'categoria' && C.formaPrecio('Socio Virtual') === 'categoria' && C.formaPrecio('SOCIOECONÓMICO VIRTUAL') === 'categoria' && C.formaPrecio('SOCIOECONOMICO EMPRESARIAL') === 'territorio' && C.formaPrecio('SOLO SOCIOECONOMICO') === 'matriz', "formaPrecio: SOCIOECONOMICO VIRTUAL (y 'Socio Virtual', con tilde) → 'categoria'; EMPRESARIAL sigue por territorio; el socio plano sigue matriz");
  ok(C.canonTipoPrueba('SOCIOECONOMICO VIRTUAL') === 'SOCIOECONOMICO VIRTUAL' && C.canonTipoPrueba('socio virtual') === 'SOCIOECONOMICO VIRTUAL' && C.canonTipoPrueba('Estudio Socio-Económico Virtual') === 'SOCIOECONOMICO VIRTUAL' && C.canonTipoPrueba('SOCIOECONOMICO EMPRESARIAL') === 'SOCIOECONOMICO EMPRESARIAL' && C.canonTipoPrueba('SOLO SOCIOECONOMICO') === 'SOCIOECONOMICO' && C.canonTipoPrueba('VIRTUAL') === 'VIRTUAL' && (C.TIPOS_PRUEBA as readonly string[]).includes('SOCIOECONOMICO VIRTUAL'), 'canonTipoPrueba: SOCIO + VIRTUAL (cualquier grafía) → SOCIOECONOMICO VIRTUAL; no confunde con EMPRESARIAL ni con el socio plano; "VIRTUAL" solo no es socio; está en TIPOS_PRUEBA');
  ok(C.usaCategoria('matriz') && C.usaTerritorio('matriz') && !C.usaCategoria('territorio') && C.usaTerritorio('territorio') && C.usaCategoria('categoria') && !C.usaTerritorio('categoria') && !C.usaCategoria('unico') && !C.usaTerritorio('unico') && C.ETIQUETA_FORMA.categoria === 'Por categoría (sin territorio)' && (C.CATEGORIAS_SOCIO as readonly string[]).join() === 'PRE EMPLEO,RUTINA', 'el 2×2 completo: matriz cat+terr · territorio solo terr · categoria solo cat · unico ninguna; etiqueta "Por categoría (sin territorio)"; CATEGORIAS_SOCIO = PRE EMPLEO, RUTINA');
  ok(C.llaveTarifa({ nit: '1', tipoPrueba: 'Socio Virtual', categoria: 'PREEMPLEO', territorio: 'METROPOLITANA' }) === '1|SOCIOECONOMICO VIRTUAL|PRE EMPLEO|UNICA' && C.llaveTarifa({ nit: '1', tipoPrueba: 'SOCIOECONOMICO VIRTUAL', categoria: 'rutina', territorio: '' }) === '1|SOCIOECONOMICO VIRTUAL|RUTINA|UNICA', 'llave efectiva de SOCIO VIRTUAL: categoría canónica + territorio UNICA (el territorio de la fila se descarta)');
  const virt = [
    T('sv1', '11854243', 'SOCIOECONOMICO VIRTUAL', 'PRE EMPLEO', 'UNICA', 450, { aprobadoEn: '2026-01-01' }), T('sv2', '11854243', 'SOCIOECONOMICO VIRTUAL', 'RUTINA', 'UNICA', 380),
    T('sv3', '11854243', 'SOCIOECONOMICO', 'PRE EMPLEO', 'METROPOLITANA', 600), T('sv4', '11854243', 'SOCIOECONOMICO EMPRESARIAL', 'UNICA', 'METROPOLITANA', 700),
    T('lv1', '222', 'SOCIOECONOMICO VIRTUAL', 'PRE EMPLEO', 'METROPOLITANA', 400), T('lv2', '222', 'SOCIOECONOMICO VIRTUAL', 'PRE EMPLEO', 'DEPARTAMENTAL', 0),
    T('lv3', '333', 'SOCIOECONOMICO VIRTUAL', 'PRE EMPLEO', 'METROPOLITANA', 400), T('lv4', '333', 'SOCIOECONOMICO VIRTUAL', 'PRE EMPLEO', 'DEPARTAMENTAL', 500),
    T('sv0', '444', 'SOCIOECONOMICO VIRTUAL', 'PRE EMPLEO', 'UNICA', 0),
  ];
  const rM = resolverTarifa(virt, { nit: '11854243', tipoPrueba: 'SOCIOECONOMICO VIRTUAL', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA' });
  const rD = resolverTarifa(virt, { nit: '11854243', tipoPrueba: 'Socio Virtual', categoria: 'PREEMPLEO', territorio: 'DEPARTAMENTAL' });
  const rS = resolverTarifa(virt, { nit: '11854243', tipoPrueba: 'SOCIOECONOMICO VIRTUAL', categoria: 'PRE EMPLEO', territorio: '' });
  ok(rM.estado === 'ok' && rM.monto === 450 && rM.aprobada && rD.estado === 'ok' && rD.monto === 450 && rD.tarifa.id === 'sv1' && rS.estado === 'ok' && rS.monto === 450 && rM.avisos.length === 0 && rD.avisos.length === 0 && rS.avisos.length === 0, 'SOCIO VIRTUAL PRE EMPLEO Q450 resuelve igual en METROPOLITANA, DEPARTAMENTAL y sin territorio (sin avisos: el territorio no cuenta)');
  r = resolverTarifa(virt, { nit: '11854243', tipoPrueba: 'SOCIOECONOMICO VIRTUAL', categoria: 'RUTINA', territorio: 'DEPARTAMENTAL' });
  ok(r.estado === 'ok' && r.monto === 380 && r.tarifa.id === 'sv2', 'RUTINA virtual usa su propio precio (Q380)');
  r = resolverTarifa(virt, { nit: '11854243', tipoPrueba: 'SOCIOECONOMICO VIRTUAL', categoria: '', territorio: 'METROPOLITANA' });
  ok(r.estado === 'no_encontrada' && /no trae categoría/.test(r.mensaje), 'SOCIO VIRTUAL sin categoría → sin tarifa (la categoría sí importa en esta forma)');
  r = resolverTarifa(virt, { nit: '11854243', tipoPrueba: 'SOCIOECONOMICO VIRTUAL', categoria: 'ESPECIFICO', territorio: 'METROPOLITANA' });
  ok(r.estado === 'no_encontrada' && /no tiene tarifa para SOCIOECONOMICO VIRTUAL ESPECIFICO \(precio por categoría, sin territorio\)/.test(r.mensaje), 'categoría sin fila (ESPECIFICO) → no_encontrada diciendo que es por categoría sin territorio, sin mencionar METROPOLITANA');
  r = resolverTarifa(virt, { nit: '11854243', tipoPrueba: 'SOLO SOCIOECONOMICO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA' });
  const rE = resolverTarifa(virt, { nit: '11854243', tipoPrueba: 'SOCIO EMPRESARIAL', categoria: '', territorio: 'GUATEMALA' });
  ok(r.estado === 'ok' && r.monto === 600 && r.tarifa.id === 'sv3' && rE.estado === 'ok' && rE.monto === 700, 'el socio plano (Q600, matriz) y el empresarial (Q700, por territorio) del mismo NIT no se mezclan con el virtual');
  r = resolverTarifa(virt, { nit: '222', tipoPrueba: 'SOCIOECONOMICO VIRTUAL', categoria: 'PRE EMPLEO', territorio: 'DEPARTAMENTAL' });
  ok(r.estado === 'ok' && r.monto === 400 && r.tarifa.id === 'lv1' && /1 en Q0/.test(r.avisos.join(' ')), 'legacy cargado como matriz (METRO Q400 + DEPTO Q0): resuelve Q400 aun pidiendo DEPARTAMENTAL (Q0 no es precio) con aviso de normalizar');
  r = resolverTarifa(virt, { nit: '333', tipoPrueba: 'SOCIOECONOMICO VIRTUAL', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA' });
  ok(r.estado === 'ambigua' && /se cobra por categoría sin territorio/.test(r.mensaje) && /2 montos distintos/.test(r.mensaje), 'legacy con dos precios distintos por territorio (400 / 500) → ambigua: el territorio nunca elige el precio, hay que dejar uno');
  r = resolverTarifa(virt, { nit: '444', tipoPrueba: 'SOCIOECONOMICO VIRTUAL', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA' });
  ok(r.estado === 'sin_tarifa' && /^SOCIOECONOMICO VIRTUAL PRE EMPLEO está en Q0/.test(r.mensaje), 'fila en Q0 → sin tarifa (no es gratis), sin el centinela UNICA en el mensaje');
  ok(buscarDuplicado(virt, { nit: '11854243', tipoPrueba: 'Socio Virtual', categoria: 'PRE EMPLEO', territorio: 'DEPARTAMENTAL' })?.id === 'sv1' && buscarDuplicado(virt, { nit: '11854243', tipoPrueba: 'SOCIOECONOMICO VIRTUAL', categoria: 'ESPECIFICO', territorio: 'UNICA' }) === null && tarifasDuplicadas(virt).has('lv1') && tarifasDuplicadas(virt).has('lv2') && !tarifasDuplicadas(virt).has('sv1') && !tarifasDuplicadas(virt).has('sv3'), 'duplicados por llave efectiva: otra PRE EMPLEO virtual con cualquier territorio es la misma; otra categoría no; las dos legacy del 222 cuentan como repetidas; el socio plano no');
  plan = G.planGenerar('555', [], ['SOCIO VIRTUAL']);
  const fv = plan.filas.filter(f => f.tipoPrueba === 'SOCIOECONOMICO VIRTUAL');
  ok(plan.porTipo['SOCIOECONOMICO VIRTUAL'] === 2 && fv.length === 2 && fv.every(f => f.forma === 'categoria' && f.territorio === 'UNICA') && fv.map(f => f.categoria).sort().join() === 'PRE EMPLEO,RUTINA' && /SOCIOECONOMICO VIRTUAL 2 \(por categoría\)/.test(G.resumenPlan(plan)) && plan.filas.length === 12, 'generar para un cliente que pide SOCIO VIRTUAL: 2 filas (PRE EMPLEO y RUTINA; ESPECIFICO no aplica) con territorio UNICA; resumen "(por categoría)"; plantilla 10 + 2 = 12');
  plan = G.planGenerar('555', [T('lv', '555', 'SOCIOECONOMICO VIRTUAL', 'PRE EMPLEO', 'METROPOLITANA', 400)], ['SOCIOECONOMICO VIRTUAL']);
  ok(plan.porTipo['SOCIOECONOMICO VIRTUAL'] === 1 && plan.filas.find(f => f.tipoPrueba === 'SOCIOECONOMICO VIRTUAL')?.categoria === 'RUTINA' && plan.omitidas.some(f => f.tipoPrueba === 'SOCIOECONOMICO VIRTUAL' && f.categoria === 'PRE EMPLEO'), 'no duplica: con la PRE EMPLEO virtual ya cargada (aunque esté como matriz) solo genera RUTINA');

  const { resumenPorEmpresa, filtrarEmpresas, aprobablesDe } = await import('../src/lib/tarifario/resumen');
  const resumen = resumenPorEmpresa([...tarifas, T('10', '53563972', 'POLIGRAFO', 'RUTINA', 'METROPOLITANA', 300, { razonSocial: 'CREDICHAPIN', aprobadoEn: '2026-01-01' })]);
  ok(resumen.length === 3 && resumen[0].nit === '104455470' && resumen[0].semaforo === 'rojo' && resumen[0].activas === 5 && resumen[0].sinTarifa === 1 && resumen[0].pendientes === 2 && resumen[0].aprobadas === 2 && resumen[0].estancadas === 0 && resumen[0].precioDesde === null, `resumen por empresa: IDEA CENTRAL primero (rojo: 5 activas, 1 Q0, 2 pendientes, 2 aprobadas; sin antigüedad → 0 estancadas) → ${JSON.stringify(resumen[0])}`);
  ok(resumen[1].nit === '22933093' && resumen[1].semaforo === 'amarillo' && resumen[1].activas === 2 && resumen[2].nit === '53563972' && resumen[2].semaforo === 'verde', 'orden: rojo → amarillo (ABIRSA, inactiva no cuenta) → verde (CREDICHAPIN)');
  ok(filtrarEmpresas(resumen, 'abir').length === 1 && filtrarEmpresas(resumen, '5356').length === 1 && filtrarEmpresas(resumen, '').length === 3, 'buscador de empresas por razón social o NIT');
  ok(aprobablesDe(tarifas).map(t => t.id).join(',') === '3,4,6,7', 'aprobables en lote = activas, pendientes y con monto (sin Q0 ni inactivas ni ya aprobadas)');

  // ── Antigüedad del precio (015) ──
  const A = await import('../src/lib/tarifario/antiguedad');
  const HOY = new Date('2026-10-28T12:00:00Z');
  ok(A.umbralEstancadaMeses(undefined) === 12 && A.umbralEstancadaMeses('18') === 18 && A.umbralEstancadaMeses('0') === 12 && A.umbralEstancadaMeses('abc') === 12, 'umbral: default 12 meses; env entera > 0 lo cambia (18); basura → 12');
  ok(A.mesesEntre('2025-01-01T00:00:00Z', HOY) === 21 && A.mesesEntre('2026-10-01T00:00:00Z', HOY) === 0 && A.mesesEntre('2025-10-29T00:00:00Z', HOY) === 11 && A.mesesEntre('2027-01-01T00:00:00Z', HOY) === 0, 'mesesEntre: meses completos (ene-2025 → 21; día no alcanzado → 11; futuro → 0)');
  let a = A.antiguedadDe({ monto: 300, anio: '2023' }, '2026-06-15T10:00:00Z', 12, HOY);
  ok(a.origen === 'historial' && a.desde === '2026-06-15T10:00:00Z' && a.meses === 4 && !a.estancada, '1) con cambio_precio en la bitácora → esa fecha (hace 4 meses, no estancada) aunque el año diga 2023');
  a = A.antiguedadDe({ monto: 300, anio: '2023' }, null, 12, HOY);
  ok(a.origen === 'anio' && a.desde === '2023-01-01T00:00:00.000Z' && a.meses === 45 && a.estancada, '2) sin historial → año de la tarifa como 1-ene (2023 → 45 meses, ESTANCADA)');
  a = A.antiguedadDe({ monto: 300, anio: '', updatedAt: '2025-03-10T00:00:00Z' }, null, 12, HOY);
  ok(a.origen === 'actualizacion' && a.meses === 19 && a.estancada, '3) sin historial ni año → updated_at (19 meses, estancada)');
  a = A.antiguedadDe({ monto: 300, anio: '', updatedAt: null }, null, 12, HOY);
  ok(a.origen === 'desconocido' && a.desde === null && !a.estancada, 'sin ningún dato → desconocido, no estancada');
  ok(!A.antiguedadDe({ monto: 0, anio: '2020' }, null, 12, HOY).estancada && !A.antiguedadDe({ monto: 300, anio: '2026' }, null, 12, HOY).estancada && A.antiguedadDe({ monto: 300, anio: '2025' }, null, 12, HOY).estancada && !A.antiguedadDe({ monto: 300, anio: '2025' }, null, 24, HOY).estancada, 'Q0 nunca está estancada; 2026 (9 meses) no; 2025 (21 meses) sí con umbral 12 y no con umbral 24');
  const uc = A.ultimoCambioPrecio([
    { tarifarioId: 'x', accion: 'alta', createdAt: '2026-01-01T00:00:00Z' }, { tarifarioId: 'x', accion: 'cambio_precio', createdAt: '2026-03-01T00:00:00Z' },
    { tarifarioId: 'x', accion: 'cambio_precio', createdAt: '2026-05-01T00:00:00Z' }, { tarifarioId: 'x', accion: 'aprobacion', createdAt: '2026-09-01T00:00:00Z' }, { tarifarioId: 'y', accion: 'alta', createdAt: '2026-09-01T00:00:00Z' },
  ]);
  ok(uc.get('x') === '2026-05-01T00:00:00Z' && !uc.has('y'), 'ultimoCambioPrecio: solo cambio_precio, el más reciente por tarifa (alta/aprobación no cuentan)');
  ok(A.textoAntiguedad(A.antiguedadDe({ monto: 1, anio: '' }, '2026-07-20T00:00:00Z', 12, HOY)) === 'última subida: hace 3 meses' && A.textoAntiguedad(A.antiguedadDe({ monto: 1, anio: '2023' }, null, 12, HOY)) === 'desde 2023' && A.haceTexto(0) === 'este mes' && A.haceTexto(1) === 'hace 1 mes' && A.haceTexto(25) === 'hace 2 años y 1 mes' && A.haceTexto(24) === 'hace 2 años', 'texto del badge: "última subida: hace 3 meses" · "desde 2023" · "hace 2 años y 1 mes"');
  const H = (seq: number, accion: AccionHistorial, montoNuevo: number | null, montoAnterior: number | null = null): HistorialTarifa =>
    ({ id: String(seq), seq, tarifarioId: 't', nit: '1', tipoPrueba: 'P', categoria: 'C', territorio: 'M', accion, montoAnterior, montoNuevo, variacionPct: null, usuario: '', motivo: '', anio: '', createdAt: `2026-0${seq}-01T00:00:00Z` });
  const puntos = A.puntosPrecio([H(3, 'cambio_precio', 125, 100), H(1, 'alta', 100), H(4, 'aprobacion', 125), H(5, 'cambio_precio', 150, 125), H(2, 'aprobacion', 100)]);
  ok(puntos.map(p => p.monto).join(',') === '100,125,150' && A.crecimiento(puntos)?.pct === 50 && A.crecimiento(A.puntosPrecio([H(1, 'alta', 0), H(2, 'cambio_precio', 80, 0)]))?.pct === null && A.crecimiento(puntos.slice(0, 1)) === null, 'sparkline: puntos = alta + cambios en orden (100 → 125 → 150), crecimiento +50 %; inicial Q0 → % null; 1 punto → sin crecimiento');
  ok(A.fechaDesdeTexto('2023-01-01T00:00:00.000Z') === '2023' && /2025/.test(A.fechaDesdeTexto('2025-03-15T10:00:00Z')) && A.fechaDesdeTexto(null) === '—', 'fechaDesdeTexto: 1-ene exacto → "2023"; fecha real → mes y año');
  const antig = A.antiguedades([T('1', 'n', 'P', 'C', 'M', 300, { anio: '2023' }), T('2', 'n', 'P', 'C', 'D', 300, { anio: '2026' }), T('3', 'n', 'S', 'C', 'M', 0, { anio: '2020' })], new Map([['2', '2026-02-01T00:00:00Z']]), 12, HOY);
  const resEst = resumenPorEmpresa([T('1', 'n', 'P', 'C', 'M', 300, { anio: '2023' }), T('2', 'n', 'P', 'C', 'D', 300, { anio: '2026' }), T('3', 'n', 'S', 'C', 'M', 0, { anio: '2020' })], antig);
  ok(resEst[0].estancadas === 1 && resEst[0].precioDesde === '2023-01-01T00:00:00.000Z' && filtrarEmpresas(resEst, '', true).length === 1 && filtrarEmpresas(resumen, '', true).length === 0, 'resumen con antigüedad: 1 estancada (la de 2023), "precio desde" = la menos reciente (2023; la Q0 de 2020 no cuenta); filtro "solo estancadas"');

  console.log(`\nC. E2E en ${base.toUpperCase()}`);
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const { crearTarifa, editarTarifa, aprobarTarifa, activarTarifa, getTarifario, resolverTarifaExpediente, tarifarioDisponible, historialDisponible, listarEmpresasTarifario, listarTarifasPorNit, aprobarTarifasPorNit, listarHistorialTarifa, listarHistorialPorNit, antiguedadesTarifario } = await import('../src/lib/db/tarifario');
  type TR = import('../src/lib/db/tarifario').TarifaResult;
  const NO: TR = { ok: false, error: '' };
  const ACTOR = 'validador@tarifario';
  const disponible = await tarifarioDisponible();
  console.log(`     · tabla tarifario en ${base}: ${disponible ? 'SÍ (014 aplicada)' : 'NO'}`);
  ok(disponible, 'tarifarioDisponible() detecta la 014');
  const hayHist = await historialDisponible();
  ok(hayHist, `historialDisponible() detecta la 015 (tarifario_historial) en ${base}`);
  const NIT = '99990001K';   // NIT de prueba (no existe en el tarifario)
  const creados: string[] = [];
  const hist = async (id: string) => (await listarHistorialTarifa(id));
  try {
    const c1 = await crearTarifa({ nit: NIT, razonSocial: 'E2E TARIFARIO S.A.', tipoPrueba: 'Polígrafo', categoria: 'pre-empleo', territorio: 'metro', monto: 350, anio: '2026' }, ACTOR);
    ok(c1.ok, `crear tarifa (grafías sueltas → canónicas): ${c1.ok ? c1.mensaje : c1.error}`); if (c1.ok) creados.push(c1.id);
    const id1 = c1.ok ? c1.id : '';
    const fila = (await getTarifario()).find(t => t.id === id1);
    ok(!!fila && fila.tipoPrueba === 'POLIGRAFO' && fila.categoria === 'PRE EMPLEO' && fila.territorio === 'METROPOLITANA' && fila.nit === NIT && fila.monto === 350 && !fila.aprobadoEn, 'queda guardada canónica, pendiente de aprobación');
    let h = await hist(id1);
    ok(h.length === 1 && h[0].accion === 'alta' && h[0].montoNuevo === 350 && h[0].montoAnterior === null && h[0].variacionPct === null && h[0].usuario === ACTOR && h[0].anio === '2026', `bitácora: la alta escribe 'alta' Q350 con usuario (${JSON.stringify(h[0] ? { accion: h[0].accion, monto: h[0].montoNuevo, usuario: h[0].usuario } : null)})`);
    const c2 = await crearTarifa({ nit: NIT, tipoPrueba: 'POLIGRAFO', categoria: 'PREEMPLEO', territorio: 'METROPOLITANA', monto: 360 }, ACTOR);
    ok(!c2.ok && !!c2.duplicado && /Ya existe una tarifa/.test(c2.error), `misma combinación con otra grafía (PREEMPLEO) → aviso de repetida: ${c2.ok ? '' : c2.error}`);
    const c2b = await crearTarifa({ nit: NIT, tipoPrueba: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto: 360, confirmarDuplicado: true }, ACTOR);
    ok(!c2b.ok && /candado de la base/.test(c2b.ok ? '' : c2b.error), 'la combinación EXACTA la frena el candado único de la base aunque se confirme (por la RPC)');
    const c3 = await crearTarifa({ nit: NIT, tipoPrueba: 'SOCIOECONOMICO', categoria: 'RUTINA', territorio: 'DEPARTAMENTAL', monto: 0 }, ACTOR);
    ok(c3.ok && /sin tarifa definida/.test(c3.mensaje), 'tarifa en Q0 se crea como "sin tarifa definida"'); if (c3.ok) creados.push(c3.id);
    const id3 = c3.ok ? c3.id : '';
    const ap0 = c3.ok ? await aprobarTarifa(id3, ACTOR) : NO;
    ok(!ap0.ok && /Q0/.test(ap0.ok ? '' : ap0.error), 'una tarifa en Q0 no se puede aprobar');
    const ap = c1.ok ? await aprobarTarifa(id1, ACTOR) : NO;
    const aprobada = (await getTarifario()).find(t => t.id === id1);
    ok(ap.ok && aprobada?.aprobadoPor === ACTOR && !!aprobada?.aprobadoEn, 'aprobar → aprobado_por / aprobado_en (gobierno)');
    h = await hist(id1);
    ok(h.length === 2 && h[1].accion === 'aprobacion' && h[1].usuario === ACTOR && h[1].montoNuevo === 350, "bitácora: aprobar escribe 'aprobacion' con el usuario");
    const ed = c1.ok ? await editarTarifa(id1, { monto: 375 }, ACTOR, 'ajuste anual') : NO;
    const editada = (await getTarifario()).find(t => t.id === id1);
    ok(ed.ok && editada?.monto === 375 && !editada?.aprobadoEn && /pendiente de aprobación/.test(ed.ok ? ed.mensaje : ''), 'editar el monto de una aprobada → Q375 y vuelve a pendiente');
    h = await hist(id1);
    const cp = h.find(x => x.accion === 'cambio_precio');
    ok(h.length === 3 && !!cp && cp.montoAnterior === 350 && cp.montoNuevo === 375 && cp.variacionPct === 7.14 && cp.motivo === 'ajuste anual' && cp.usuario === ACTOR && !h.some(x => x.seq > cp.seq), `bitácora: 'cambio_precio' 350 → 375 = +7.14 % con motivo "ajuste anual" y usuario; volver a pendiente NO genera renglón (${JSON.stringify(cp ? { ant: cp.montoAnterior, nuevo: cp.montoNuevo, pct: cp.variacionPct, motivo: cp.motivo } : null)})`);
    const edQ0 = c3.ok ? await editarTarifa(id3, { monto: 50 }, ACTOR, 'primer precio pactado') : NO;
    const edQ0b = c3.ok ? await editarTarifa(id3, { monto: 0 }, ACTOR) : NO;
    const h3 = await hist(id3);
    const cp0 = h3.filter(x => x.accion === 'cambio_precio');
    ok(edQ0.ok && edQ0b.ok && cp0.length === 2 && cp0[0].montoAnterior === 0 && cp0[0].montoNuevo === 50 && cp0[0].variacionPct === null && cp0[0].motivo === 'primer precio pactado' && cp0[1].montoAnterior === 50 && cp0[1].montoNuevo === 0 && cp0[1].variacionPct === -100, `bitácora: anterior Q0 → variación null (no hay base); volver a Q0 → −100 % (${JSON.stringify(cp0.map(x => [x.montoAnterior, x.montoNuevo, x.variacionPct]))})`);
    const lk = await resolverTarifaExpediente({ empresa: 'e2e tarifario s.a.', tipoPrueba: 'SOLO POLIGRAFO', categoria: 'PRE EMEPLEO' });
    ok(lk.estado === 'ok' && lk.monto === 375 && lk.total === 420 && !lk.aprobada, `lookup real por alias + erratas de la Agenda → ok Q375 (total Q420), no aprobada: ${lk.estado}`);
    const lk0 = await resolverTarifaExpediente({ nit: NIT, tipoPrueba: 'SOCIOECONOMICO', categoria: 'RUTINA', territorio: 'DEPARTAMENTAL' });
    ok(lk0.estado === 'sin_tarifa', 'lookup real de la Q0 → sin_tarifa');
    const des = c1.ok ? await activarTarifa(id1, false, ACTOR) : NO;
    const lkDes = await resolverTarifaExpediente({ nit: NIT, tipoPrueba: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA' });
    ok(des.ok && lkDes.estado === 'no_encontrada', 'desactivar → el motor ya no la ve (no_encontrada)');
    const re = c1.ok ? await activarTarifa(id1, true, ACTOR) : NO;
    ok(re.ok && (await getTarifario()).find(t => t.id === id1)?.activo === true, 'reactivar → activa de nuevo');
    h = await hist(id1);
    ok(h.length === 5 && h[3].accion === 'desactivacion' && h[4].accion === 'reactivacion' && h[3].usuario === ACTOR && h[4].usuario === ACTOR && h.every((x, i) => i === 0 || x.seq > h[i - 1].seq), "bitácora: 'desactivacion' y 'reactivacion' con usuario; la línea de tiempo viene en orden (seq)");
    // ── Maestro-detalle: resumen por NIT, tarifas por NIT y aprobar en lote ──
    const c4 = await crearTarifa({ nit: NIT, tipoPrueba: 'POLIGRAFO', categoria: 'RUTINA', territorio: 'DEPARTAMENTAL', monto: 89.29, anio: '2024' }, ACTOR);
    if (c4.ok) creados.push(c4.id);
    const id4 = c4.ok ? c4.id : '';
    const emp = (await listarEmpresasTarifario()).find(e => e.nit === NIT);
    ok(!!emp && emp.activas === 3 && emp.sinTarifa === 1 && emp.pendientes === 2 && emp.semaforo === 'rojo' && emp.razonSocial === 'E2E TARIFARIO S.A.', `listarEmpresasTarifario: ${NIT} → 3 activas, 2 pendientes, 1 Q0, rojo (${JSON.stringify(emp)})`);
    ok(!!emp && emp.estancadas === 1 && emp.precioDesde === '2024-01-01T00:00:00.000Z', 'resumen: 1 estancada (la de 2024 sin historial de cambios) y "precio desde" 2024; la de Q375 no (su cambio es de hoy)');
    const ant = await antiguedadesTarifario(await listarTarifasPorNit(NIT));
    ok(ant[id1]?.origen === 'historial' && ant[id1].meses === 0 && !ant[id1].estancada && ant[id4]?.origen === 'anio' && ant[id4].desde === '2024-01-01T00:00:00.000Z' && ant[id4].estancada && ant[id3]?.origen === 'historial' && !ant[id3].estancada, `antigüedad real: con cambios → historial (hoy); sin cambios → año 2024 (estancada); la Q0 (tuvo cambios) → historial pero nunca estancada (${JSON.stringify(Object.values(ant).map(x => x.origen))})`);
    const porNit = await listarTarifasPorNit('9999-0001-K');
    ok(porNit.length === 3 && porNit.every(t => t.nit === NIT), 'listarTarifasPorNit normaliza el NIT (guiones) y trae solo las del cliente');
    const lote = await aprobarTarifasPorNit(NIT, 'lote@tarifario');
    const trasLote = await listarTarifasPorNit(NIT);
    ok(lote.ok && lote.aprobadas === 2 && lote.omitidasQ0 === 1 && trasLote.filter(t => t.aprobadoEn && t.aprobadoPor === 'lote@tarifario').length === 2 && trasLote.find(t => t.monto === 0)?.aprobadoEn === null, `aprobar en lote: 2 aprobadas, la Q0 queda fuera (${lote.ok ? lote.mensaje : lote.error})`);
    const hNit = await listarHistorialPorNit(NIT);
    const apLote = hNit.filter(x => x.accion === 'aprobacion' && x.usuario === 'lote@tarifario');
    ok(apLote.length === 2 && new Set(apLote.map(x => x.tarifarioId)).size === 2 && !hNit.some(x => x.tarifarioId === id3 && x.accion === 'aprobacion'), "bitácora: el lote escribe una 'aprobacion' por tarifa con el usuario del lote; la Q0 no tiene aprobación");
    const lote2 = await aprobarTarifasPorNit(NIT, 'lote@tarifario');
    ok(lote2.ok && lote2.aprobadas === 0 && /Q0/.test(lote2.mensaje), 'segundo lote: nada que aprobar (solo queda la Q0)');
    const empTras = (await listarEmpresasTarifario()).find(e => e.nit === NIT);
    ok(!!empTras && empTras.pendientes === 0 && empTras.aprobadas === 2 && empTras.semaforo === 'rojo', 'resumen tras el lote: 0 pendientes, sigue rojo por la Q0');
    const lote3 = await aprobarTarifasPorNit('00000000X', 'lote@tarifario');
    ok(!lote3.ok && /no tiene tarifas activas/.test(lote3.ok ? '' : lote3.error), 'lote sobre un NIT sin tarifas → error claro');
    // ── SQL directo (sin GUC): el trigger igual registra, con usuario null ──
    const { error: eDir } = await sb.from('tarifario').update({ monto: 380 }).eq('id', id1);
    h = await hist(id1);
    const dir = h[h.length - 1];
    ok(!eDir && dir?.accion === 'cambio_precio' && dir.montoAnterior === 375 && dir.montoNuevo === 380 && dir.variacionPct === 1.33 && dir.usuario === '' && dir.motivo === '', `un UPDATE directo (sin RPC ni GUC) también deja renglón: 375 → 380 (+1.33 %) con usuario null (${JSON.stringify(dir ? { usuario: dir.usuario, pct: dir.variacionPct } : null)})`);

    // ── FORMAS DE PRECIO + GENERAR TARIFAS (en la base) ──
    console.log('   formas de precio · generar tarifas');
    const { planGenerarTarifas, generarTarifasCliente } = await import('../src/lib/db/tarifario');
    const cI = await crearTarifa({ nit: NIT, tipoPrueba: 'Consulta Infornet', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto: 44.64 }, ACTOR);
    const fI = cI.ok ? (await getTarifario()).find(t => t.id === cI.id) : undefined;
    ok(cI.ok && !!fI && fI.tipoPrueba === 'INFORNET' && fI.categoria === 'UNICA' && fI.territorio === 'UNICA', `crear INFORNET con categoría/territorio → se guarda como precio único (UNICA/UNICA): ${cI.ok ? cI.mensaje : cI.error}`);
    const cI2 = await crearTarifa({ nit: NIT, tipoPrueba: 'INFORNET', categoria: 'RUTINA', territorio: 'DEPARTAMENTAL', monto: 50 }, ACTOR);
    ok(!cI2.ok && !!cI2.duplicado, 'otra INFORNET del mismo NIT con otra categoría/territorio → aviso de repetida (la llave efectiva es la misma)');
    const cS = await crearTarifa({ nit: NIT, tipoPrueba: 'SOCIO EMPRESARIAL', categoria: 'RUTINA', territorio: 'metro', monto: 600 }, ACTOR);
    const fS = cS.ok ? (await getTarifario()).find(t => t.id === cS.id) : undefined;
    ok(cS.ok && !!fS && fS.tipoPrueba === 'SOCIOECONOMICO EMPRESARIAL' && fS.categoria === 'UNICA' && fS.territorio === 'METROPOLITANA', 'crear SOCIO EMPRESARIAL → por territorio: categoría UNICA, territorio METROPOLITANA');
    let rf = await resolverTarifaExpediente({ nit: NIT, tipoPrueba: 'CONSULTA INFORNET', categoria: '', territorio: '' });
    ok(rf.estado === 'ok' && rf.monto === 44.64, 'lookup real: INFORNET sin categoría ni territorio → Q44.64');
    rf = await resolverTarifaExpediente({ nit: NIT, tipoPrueba: 'SOCIO EMPRESARIAL', categoria: '', territorio: 'GUATEMALA' });
    ok(rf.estado === 'ok' && rf.monto === 600, 'lookup real: SOCIO EMPRESARIAL sin categoría, GUATEMALA → Q600');
    rf = await resolverTarifaExpediente({ nit: NIT, tipoPrueba: 'SOCIO EMPRESARIAL', categoria: 'PRE EMPLEO', territorio: 'depto' });
    ok(rf.estado === 'no_encontrada' && /DEPARTAMENTAL/.test(rf.mensaje), 'lookup real: SOCIO EMPRESARIAL en DEPARTAMENTAL sin tarifa → no_encontrada con el faltante');
    // Forma 'categoria' en la base: SOCIO VIRTUAL guarda categoría + territorio UNICA; el lookup ignora el territorio del expediente.
    const cV = await crearTarifa({ nit: NIT, tipoPrueba: 'Socio Virtual', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto: 450 }, ACTOR);
    const fV = cV.ok ? (await getTarifario()).find(t => t.id === cV.id) : undefined;
    ok(cV.ok && !!fV && fV.tipoPrueba === 'SOCIOECONOMICO VIRTUAL' && fV.categoria === 'PRE EMPLEO' && fV.territorio === 'UNICA', `crear SOCIO VIRTUAL PRE EMPLEO con territorio → se guarda por categoría (PRE EMPLEO / UNICA): ${cV.ok ? cV.mensaje : cV.error}`);
    const cV2 = await crearTarifa({ nit: NIT, tipoPrueba: 'SOCIOECONOMICO VIRTUAL', categoria: 'PREEMPLEO', territorio: 'DEPARTAMENTAL', monto: 500 }, ACTOR);
    ok(!cV2.ok && !!cV2.duplicado, 'otra PRE EMPLEO virtual en DEPARTAMENTAL → aviso de repetida (misma llave efectiva: el territorio no distingue)');
    rf = await resolverTarifaExpediente({ nit: NIT, tipoPrueba: 'SOCIOECONOMICO VIRTUAL', categoria: 'PRE EMPLEO', territorio: 'depto' });
    const rfM = await resolverTarifaExpediente({ nit: NIT, tipoPrueba: 'SOCIOECONOMICO VIRTUAL', categoria: 'PRE EMPLEO', territorio: 'metro' });
    ok(rf.estado === 'ok' && rf.monto === 450 && rfM.estado === 'ok' && rfM.monto === 450, 'lookup real: SOCIO VIRTUAL PRE EMPLEO → Q450 en DEPARTAMENTAL y en METROPOLITANA por igual');
    rf = await resolverTarifaExpediente({ nit: NIT, tipoPrueba: 'SOCIOECONOMICO VIRTUAL', categoria: '', territorio: 'metro' });
    const rfR = await resolverTarifaExpediente({ nit: NIT, tipoPrueba: 'SOCIOECONOMICO VIRTUAL', categoria: 'RUTINA', territorio: 'metro' });
    ok(rf.estado === 'no_encontrada' && /no trae categoría/.test(rf.mensaje) && rfR.estado === 'no_encontrada' && /sin territorio/.test(rfR.mensaje), 'lookup real: sin categoría → falta la categoría; RUTINA sin fila → no_encontrada (por categoría, sin territorio)');
    const pl = await planGenerarTarifas(NIT, { incluirAgenda: false, tiposExtra: ['SOCIO EMPRESARIAL'] });
    const yaHay = (await getTarifario()).filter(t => t.nit === NIT).length;
    ok(!('error' in pl) && pl.filas.length + pl.omitidas.length === 12 && pl.porTipo['SOCIOECONOMICO EMPRESARIAL'] === 1 && pl.filas.every(f => f.forma !== 'unico'), `planGenerarTarifas: plantilla (10) + SOCIO EMPRESARIAL (2) = 12 llaves; ${'error' in pl ? pl.error : `${pl.filas.length} a crear, ${pl.omitidas.length} ya existen (${yaHay} filas del NIT)`}`);
    const g1 = await generarTarifasCliente({ nit: NIT, tiposExtra: ['SOCIO EMPRESARIAL'], incluirAgenda: false }, ACTOR);
    const g2 = await generarTarifasCliente({ nit: NIT, tiposExtra: ['SOCIO EMPRESARIAL'], incluirAgenda: false }, ACTOR);
    const delNit = (await getTarifario()).filter(t => t.nit === NIT);
    ok(g1.ok && !('error' in pl) && g1.creadas === pl.filas.length && g2.ok && g2.creadas === 0 && delNit.filter(t => t.tipoPrueba === 'POLIGRAFO').length === 6 && delNit.filter(t => t.tipoPrueba === 'SOCIOECONOMICO').length === 4 && delNit.filter(t => t.tipoPrueba === 'SOCIOECONOMICO EMPRESARIAL').length === 2 && delNit.filter(t => t.tipoPrueba === 'INFORNET').length === 1, `generar: crea ${g1.ok ? g1.creadas : '?'} en Q0 (bitácora 'alta'); la segunda corrida crea 0 (no duplica) → polígrafo 6, socio 4, socio empresarial 2, infornet 1`);
    const hG = await listarHistorialPorNit(NIT);
    ok(hG.filter(h => h.accion === 'alta' && h.usuario === ACTOR && /generadas en Q0/.test(h.motivo)).length === (g1.ok ? g1.creadas : -1), 'las generadas quedaron en la bitácora como alta con el motivo "generadas en Q0…"');
    const plV = await planGenerarTarifas(NIT, { incluirAgenda: false, tiposExtra: ['SOCIO VIRTUAL'] });
    const g3 = await generarTarifasCliente({ nit: NIT, tiposExtra: ['SOCIO VIRTUAL'], incluirAgenda: false }, ACTOR);
    const virtDb = (await getTarifario()).filter(t => t.nit === NIT && t.tipoPrueba === 'SOCIOECONOMICO VIRTUAL');
    ok(!('error' in plV) && plV.porTipo['SOCIOECONOMICO VIRTUAL'] === 1 && plV.omitidas.some(f => f.tipoPrueba === 'SOCIOECONOMICO VIRTUAL' && f.categoria === 'PRE EMPLEO') && g3.ok && g3.creadas === 1 && virtDb.length === 2 && virtDb.every(t => t.territorio === 'UNICA') && virtDb.find(t => t.categoria === 'RUTINA')?.monto === 0 && virtDb.find(t => t.categoria === 'PRE EMPLEO')?.monto === 450, `generar SOCIO VIRTUAL con la PRE EMPLEO ya cargada: crea solo RUTINA en Q0 (UNICA) → 2 filas por categoría, sin territorio (${g3.ok ? g3.creadas : g3.error})`);
  } catch (e) { fail++; console.log(`  🔴 excepción: ${(e as Error).message}`); }
  finally {
    if (creados.length) { const { error } = await sb.from('tarifario').delete().in('id', creados); if (error) console.log(`     ✗ limpieza: ${error.message}`); }
    { const { error } = await sb.from('tarifario').delete().eq('nit', NIT); if (error) console.log(`     ✗ limpieza (generadas): ${error.message}`); }
    const { count } = await sb.from('tarifario').select('id', { count: 'exact', head: true }).eq('nit', NIT);
    const { count: countH } = await sb.from('tarifario_historial').select('id', { count: 'exact', head: true }).eq('nit', NIT);
    ok((count ?? 0) === 0 && (countH ?? 0) === 0, `limpieza verificada: 0 filas del NIT de prueba ${NIT} en tarifario y en la bitácora (cascade)`);
  }
  console.log(`\n== ${pass} 🟢 / ${fail} 🔴 ==\n`);
  process.exit(fail ? 1 : 0);
})();
