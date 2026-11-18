/**
 * PAQUETE DE VARIOS NIT (036) — validador.
 *
 *  A. Estático: la 036 (paquete_nit con RLS y único por paquete + NIT, paquete_nits, aplicar / vista previa / resumen /
 *     crear / editar con todos los NIT, decisión al quitar, ayuda), la app (capa de datos, acciones, pantallas).
 *  B. Puro: nitsDe, etiqueta «Compartido · titular: SAGRACO (1083171)», subtotal por NIT, CSV; el PDF «Estado del paquete»
 *     renderizado con datos de dos NIT muestra la columna «Empresa / NIT», el NIT de cada prueba y el subtotal.
 *  C. HIT (datos sembrados): titular A + adicional B + un tercero C que NO está en el paquete. Paquete de 5:
 *     vista previa y retroactiva con los dos NIT; 3 de A y 2 de B se descuentan en FIFO GLOBAL; la 6.ª (de cualquiera) va a
 *     tarifa; C no descuenta; el resumen se encuentra desde A y desde B; el banner de Por facturar sale en ambos; el detalle
 *     trae el NIT de cada prueba; quitar B con consumos pide decisión (mantener / revertir); dos aplicar en paralelo por
 *     NIT distintos del mismo paquete = un solo consumo.
 *
 * Uso: npx tsx scripts/validate-paquete-varios-nit.ts hit [--solo-limpiar | --sin-hit]
 *      (--sin-hit corre solo A y B: no toca ninguna base)
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ConsumoPaquete, Paquete, PaqueteLinea } from '../src/lib/paquetes/paquete';

const BASE = (process.argv[2] ?? 'hit').toLowerCase();
if (BASE !== 'hit') { console.error('Este validador siembra datos: solo corre contra HIT.'); process.exit(2); }
const SOLO_LIMPIAR = process.argv.includes('--solo-limpiar'), SIN_HIT = process.argv.includes('--sin-hit');
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.hit.vercel'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('='); process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  🟢 ${m}`); } else { fail++; console.log(`  🔴 ${m}`); } };
const rd = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const NIT_A = '99990051K', NIT_B = '99990052K', NIT_C = '99990053K', NITS = [NIT_A, NIT_B, NIT_C];
const PREFIJO = 'PVN-', ACTOR = 'validador@pvn.example';

(async () => {
  /* ───────────── A. Estático ───────────── */
  console.log('\nA. Estático');
  const sql = rd('supabase/migrations/036_paquete_varios_nit.sql'), dbp = rd('src/lib/db/paquetes.ts'), puro = rd('src/lib/paquetes/paquete.ts'), acc = rd('src/app/(app)/paquetes/actions.ts');
  ok(/create table if not exists paquete_nit \(/.test(sql) && /paquete_id\s+uuid not null references paquete\(id\)/.test(sql) && /agregado_por\s+text/.test(sql) && /agregado_en\s+timestamptz not null default now\(\)/.test(sql) && /unique \(paquete_id, nit\)/.test(sql) && /alter table paquete_nit enable row level security/.test(sql) && /revoke all on table paquete_nit from public, anon, authenticated/.test(sql) && /grant all on table paquete_nit to service_role/.test(sql) && !/^\s*(begin|commit);/m.test(sql) && !/drop (table|function)/i.test(sql) && !/^\s*truncate /im.test(sql) && !/alter table paquete (drop|alter) column/i.test(sql), '036: paquete_nit (paquete_id, nit, agregado_por, agregado_en), único (paquete_id, nit), RLS + solo service_role; el titular sigue en paquete.nit; sin begin/commit, drop ni truncate');
  ok(/create or replace function paquete_nits\(p paquete\)\s+returns text\[\]/.test(sql) && /array\[p\.nit\] \|\| coalesce/.test(sql), 'paquete_nits(p paquete) → text[]: el titular más los adicionales');
  const aplicar = sql.slice(sql.indexOf('create or replace function paquete_aplicar_consumos'), sql.indexOf('-- ── 3. RPCs de pantalla'));
  ok(/unnest\(paquete_nits\(p2\)\)/.test(aplicar) && /p2\.estado <> 'cerrado'/.test(aplicar) && /where pl\.paquete_id = any\(v_paqs\) order by pl\.id for update of pl;/.test(aplicar) && /r\.nit = any\(paquete_nits\(p2\)\)/.test(aplicar) && !/p2\.nit = r\.nit|nit = any\(v_nits\) and estado/.test(aplicar) && /e\.nit_resuelto = any\(v_nits\)/.test(aplicar), 'paquete_aplicar_consumos: v_nits incluye los adicionales de los paquetes no cerrados, bloqueo de líneas por paquete, la línea compara r.nit = any(paquete_nits(p2))');
  ok(/order by p2\.fecha_inicio, p2\.created_at, l2\.created_at, l2\.id/.test(aplicar) && /nulls last, c\.fecha_resultado nulls last, c\.created_at, c\.id/.test(aplicar) && /paquete_linea_cubre\(l2\.servicio, l2\.categoria, l2\.territorio, r\.servicio, r\.categoria, r\.territorio\)/.test(aplicar) && /p2\.retroactivo_confirmado or r\.momento is null or r\.momento >= p2\.created_at/.test(aplicar) && /r\.fecha >= p2\.fecha_inicio and \(p2\.vence_en is null or r\.fecha <= p2\.vence_en\)/.test(aplicar) && /c\.situacion <> 'cobra' or e\.eliminado/.test(aplicar), 'no se toca: cobertura (servicio + categoría + territorio), FIFO (la prueba más vieja, el paquete más antiguo), retroactiva solo confirmada, vencimientos y reversión como en la 034');
  ok(/function paquete_vista_previa\(p_nits text\[\], p_fecha_inicio date/.test(sql) && /e\.nit_resuelto = any\(p_nits\)/.test(sql) && /function paquete_vista_previa\(p_nit text, p_fecha_inicio date/.test(sql) && /select paquete_vista_previa\(array\[p_nit\]::text\[\]/.test(sql), 'paquete_vista_previa recibe p_nits text[] (la firma vieja de un NIT queda como envoltorio)');
  ok(/where p_nit is null or p_nit = any\(paquete_nits\(p\)\)/.test(sql) && /e\.nit_resuelto = any\(paquete_nits\(p\)\)/.test(sql) && /'nits_adicionales'/.test(sql) && /'usadas_por_nit'/.test(sql) && /'nit', e\.nit_resuelto/.test(sql), 'paquete_resumen: se encuentra desde un NIT adicional, retro_pendientes considera todos los NIT, devuelve adicionales y usadas por NIT; paquete_detalle trae el NIT y la empresa de cada prueba');
  ok(/p_paquete->'nits_adicionales'/.test(sql) && /p_cambios->'nits_adicionales'/.test(sql) && /PAQUETE_NIT_CON_CONSUMOS: quedan % pruebas del NIT % descontadas/.test(sql) && /v_decision not in \('mantener', 'revertir'\)/.test(sql) && /'se quitó el NIT ' \|\| v_adic \|\| ' del paquete'/.test(sql) && (sql.match(/paquete_aplicar_consumos\(p\.nit, 'agenda', null, p_actor\)/g) ?? []).length >= 2 && /perform paquete_aplicar_consumos\(v_adic, 'agenda', null, p_actor\)/.test(sql), 'paquete_crear / paquete_editar aceptan nits_adicionales; quitar un NIT con consumos exige mantener | revertir (PAQUETE_NIT_CON_CONSUMOS); editar y confirmar retroactivo aplican a todos los NIT');
  ok(/Un paquete lo pueden usar varias empresas del mismo grupo: agregalas en "También lo usan"/.test(sql) && /where slug = 'paquetes-prepagados' and contenido not like '%También lo usan%'/.test(sql), 'ayuda «Paquetes prepagados»: la línea de varias empresas (idempotente)');
  ok(/p_nits: lista/.test(dbp) && /nits_adicionales: adicionalesLimpios/.test(dbp) && /al_quitar_nit/.test(dbp) && /for \(const nit of nitsDe\(p\)\)/.test(dbp) && /buscarClientes\(candidatos, q\)/.test(dbp) && /from '@\/lib\/clientes\/buscar'/.test(dbp) && !/\.insert\(|\.update\(|\.delete\(/.test(dbp) && /for \(const k of nitsDe\(pq\)\)/.test(rd('src/lib/db/facturacion-agenda.ts')) && !/from 'node:|server-only|@\/lib\/db/.test(puro), 'app: la vista previa manda la lista de NIT, crear / editar mandan nits_adicionales y la decisión, los badges de Por facturar salen bajo cada NIT; «También lo usan» reusa buscar.ts; la capa de datos solo usa RPC; módulo puro sin IO');
  const sec = rd('src/components/paquetes/paquetes-section.tsx'), det = rd('src/components/paquetes/paquete-detalle.tsx'), imp = rd('src/components/paquetes/paquete-imprimible.tsx'), lst = rd('src/components/paquetes/paquetes-lista.tsx'), gd = rd('src/components/por-facturar/grupo-detalle.tsx'), inp = rd('src/components/paquetes/nits-adicionales-input.tsx');
  ok(/También lo usan/.test(inp) && /buscarClientesPaqueteAction/.test(inp) && /<NitsAdicionalesInput/.test(sec) && /<NitsAdicionalesInput/.test(det) && /etiquetaCompartido\(p\)/.test(sec) && /Empresa \/ NIT/.test(det) && /Empresa \/ NIT/.test(imp) && /data-subtotal-nit/.test(det) && /data-subtotal-nit/.test(imp) && /<th>NIT<\/th>/.test(lst) && /data-nits-mas/.test(lst) && /title=\{`También lo usa/.test(lst) && /etiquetaCompartido\(pq\)/.test(gd) && /quitar-nit-mantener/.test(det) && /quitar-nit-revertir/.test(det) && /exigir\('gestionar_paquetes'\)/.test(acc) && !/window\.(confirm|alert|prompt)/.test(sec + det + imp + lst + inp), 'pantallas: «También lo usan» en crear y editar, etiqueta «Compartido · titular» en el tarifario y el banner, «Empresa / NIT» + subtotal por NIT en el detalle y el PDF, columna «NIT» con «+N» y title en la lista global; quitar un NIT pide mantener / revertir sin diálogos del navegador');

  /* ───────────── B. Puro ───────────── */
  console.log('\nB. Puro');
  const P = await import('../src/lib/paquetes/paquete');
  const lin = (over: Partial<PaqueteLinea> = {}): PaqueteLinea => ({ id: 'l1', servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: null, cantidad: 5, precioUnitario: 450, usadas: 5, remanente: 0, avisoUmbralEn: null, agotadoEn: null, ...over });
  const pq = (over: Partial<Paquete> = {}): Paquete => ({ id: 'p1', correlativo: 'PAQ-0009', nit: '1083171', clienteId: null, cliente: 'Colegio Sagrado Corazón 1', razonSocial: 'SAGRACO, S.A.', nombre: 'Paquete colegio', fechaInicio: '2026-01-01', venceEn: null, estado: 'activo', noFactura: null, facturaId: null, facturaAppId: null, umbralAviso: 5, retroactivoConfirmado: true, retroPendientes: 0, notas: '', creadoPor: 'x', createdAt: '2026-01-01', updatedAt: null, cerradoPor: null, cerradoMotivo: null, cerradoEn: null, lineas: [lin()], nitsAdicionales: [{ nit: '21076383', nombre: 'Colegio Sagrado Corazón de Jesús 2', razonSocial: 'ARPE, S.A.', agregadoPor: 'x', agregadoEn: '2026-01-01' }], usadasPorNit: { '1083171': 3, '21076383': 2 }, ...over });
  const con = (id: string, nit: string, empresa: string, over: Partial<ConsumoPaquete> = {}): ConsumoPaquete => ({ id, lineaId: 'l1', componenteId: 'c' + id, fecha: '2026-10-05T10:00:00Z', revertidoEn: null, motivoReversion: null, fechaResultado: '2026-10-05T09:00:00Z', servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', estadoPrueba: 'APROBO', situacion: 'cobra', persona: 'Persona ' + id, solicitante: 'RRHH', puesto: 'Puesto', idExterno: 'E' + id, expedienteId: 'e' + id, detalleId: null, noFactura: null, nit, empresa, ...over });
  const solo = pq({ nitsAdicionales: [], usadasPorNit: { '1083171': 5 } });
  ok(P.nitsDe(pq()).join(',') === '1083171,21076383' && P.nitsDe(solo).join(',') === '1083171' && P.esCompartido(pq()) && !P.esCompartido(solo) && P.nitsDe(P.parsePaquete({ id: 'x', nit: '1' })).join(',') === '1', 'nitsDe: el titular primero y después los adicionales; un paquete de un solo NIT (o una base sin la 036) sigue igual');
  ok(P.etiquetaCompartido(pq()) === 'Compartido · titular: SAGRACO (1083171)' && P.nombreCorto('ARPE, S.A.') === 'ARPE' && P.nombreCorto('Distribuidora La Sabana, Sociedad Anónima') === 'Distribuidora La Sabana' && P.nombreCorto('SALSA') === 'SALSA' && P.etiquetaCompartido(pq({ razonSocial: null })) === 'Compartido · titular: Colegio Sagrado Corazón 1 (1083171)' && P.tituloNits(pq()) === 'ARPE, S.A. (21076383)', `etiqueta del NIT adicional: «${P.etiquetaCompartido(pq())}»; el title de la lista: «${P.tituloNits(pq())}»`);
  const dd = { paquete: pq(), consumos: [con('1', '1083171', 'SAGRACO, S.A.'), con('2', '21076383', 'ARPE, S.A.'), con('3', '1083171', 'SAGRACO, S.A.'), con('4', '21076383', 'ARPE, S.A.'), con('5', '1083171', 'SAGRACO, S.A.'), con('6', '21076383', 'ARPE, S.A.', { revertidoEn: '2026-10-09T00:00:00Z', motivoReversion: 'x' })] };
  const st = P.subtotalesPorNit(dd);
  const stQuitado = P.subtotalesPorNit({ paquete: solo, consumos: dd.consumos });
  ok(st.map(t => `${t.nit}:${t.usadas}:${t.titular ? 'T' : 'A'}`).join(',') === '1083171:3:T,21076383:2:A' && st[1].empresa === 'ARPE, S.A.' && stQuitado.map(t => `${t.nit}:${t.usadas}:${t.vigente}`).join(',') === '1083171:3:true,21076383:2:false' && P.subtotalesPorNit({ paquete: pq(), consumos: [] }).map(t => t.usadas).join(',') === '0,0', 'subtotal por NIT: 3 del titular + 2 del adicional (las revertidas no cuentan); un NIT ya quitado con pruebas mantenidas sigue saliendo como «ya no lo usa»');
  const csv = P.csvDetalle(dd);
  ok(/motivo_reversion,nit,empresa\n/.test(csv) && /,descontado,,,21076383,"ARPE, S\.A\."\n/.test(csv) && /\nnit,empresa,usadas\n1083171,"SAGRACO, S\.A\.",3\n21076383,"ARPE, S\.A\.",2\n/.test(csv) && !/nit,empresa,usadas/.test(P.csvDetalle({ paquete: solo, consumos: dd.consumos.filter(c => c.nit === '1083171') })), 'CSV: cada prueba con su NIT y empresa (columnas al final: no mueve las de la 034) y el subtotal por NIT si es compartido');
  let html = '';
  try {
    const React = await import('react'); const { createElement } = React;
    (globalThis as unknown as { React: unknown }).React = React;   // tsx compila el JSX con el runtime clásico
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { PaqueteImprimible } = await import('../src/components/paquetes/paquete-imprimible');
    html = renderToStaticMarkup(createElement(PaqueteImprimible, { datos: dd, emisor: { nombre: 'Golden Talent', nit: '1', direccion: '' }, hoy: '2026-11-18' }));
  } catch (e) { html = 'ERROR ' + (e instanceof Error ? e.message : String(e)); }
  const filasPdf = (html.match(/data-nit-prueba="(\d+)"/g) ?? []).map(x => x.replace(/\D/g, ''));
  ok(/Empresa \/ NIT/.test(html) && filasPdf.join(',') === '1083171,21076383,1083171,21076383,1083171' && /ARPE, S\.A\.<div class="doc-mute">NIT 21076383<\/div>/.test(html) && /data-subtotal-nit="1083171:3,21076383:2"/.test(html) && /También lo usa: ARPE, S\.A\. \(NIT 21076383\)/.test(html) && /titular del paquete/.test(html), `PDF «Estado del paquete» (render real): columna «Empresa / NIT», el NIT de cada una de las ${filasPdf.length} pruebas, «También lo usa» y el subtotal por NIT${html.startsWith('ERROR') ? ' · ' + html : ''}`);

  if (SIN_HIT) { console.log(`\n(--sin-hit: sin la parte C)\n${pass} 🟢 / ${fail} 🔴`); process.exit(fail ? 1 : 0); }

  /* ───────────── C. HIT ───────────── */
  console.log(`\nC. HIT${SOLO_LIMPIAR ? ' (--solo-limpiar)' : ''}`);
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const { error: e036 } = await sb.from('paquete_nit').select('paquete_id', { count: 'exact', head: true });
  if (e036) { ok(false, `la 036 NO está aplicada en HIT (paquete_nit: ${e036.message}): la parte C no se puede correr`); console.log(`\n${pass} 🟢 / ${fail} 🔴`); process.exit(1); }
  const limpiar = async () => {
    const { data: pqs } = await sb.from('paquete').select('id').in('nit', NITS);
    const pids = (pqs ?? []).map(p => p.id as string);
    if (pids.length) {
      const { data: ls } = await sb.from('paquete_linea').select('id').in('paquete_id', pids);
      const lids = (ls ?? []).map(l => l.id as string);
      if (lids.length) await sb.from('paquete_consumo').delete().in('paquete_linea_id', lids);
      await sb.from('paquete_nit').delete().in('paquete_id', pids);
      await sb.from('paquete_linea').delete().in('paquete_id', pids);
      await sb.from('paquete').delete().in('id', pids);
    }
    await sb.from('paquete_nit').delete().in('nit', NITS);
    const { data: exps } = await sb.from('facturacion_expediente').select('id').like('id_externo', `${PREFIJO}%`);
    const ids = (exps ?? []).map(e => e.id as string);
    if (ids.length) {
      const { data: cs } = await sb.from('facturacion_componente').select('id').in('expediente_id', ids);
      const cids = (cs ?? []).map(c => c.id as string);
      if (cids.length) await sb.from('paquete_consumo').delete().in('componente_id', cids);
      await sb.from('facturacion_componente').delete().in('expediente_id', ids);
      await sb.from('facturacion_expediente').delete().in('id', ids);
    }
    const { data: clis } = await sb.from('clientes').select('id').in('nit', NITS);
    const cuids = (clis ?? []).map(c => c.id as string);
    if (cuids.length) await sb.from('cobranza_evento').delete().in('cliente_id', cuids);
    await sb.from('cliente_externo').delete().in('nit', NITS);
    await sb.from('clientes').delete().in('nit', NITS);
    const { count } = await sb.from('facturacion_expediente').select('id', { count: 'exact', head: true }).like('id_externo', `${PREFIJO}%`);
    const { count: cp } = await sb.from('paquete').select('id', { count: 'exact', head: true }).in('nit', NITS);
    const { count: cc } = await sb.from('clientes').select('id', { count: 'exact', head: true }).in('nit', NITS);
    return (count ?? 0) + (cp ?? 0) + (cc ?? 0);
  };
  if (SOLO_LIMPIAR) { ok((await limpiar()) === 0, 'limpieza: 0 expedientes PVN, paquetes ni clientes'); console.log(`\n${pass} 🟢 / ${fail} 🔴`); process.exit(fail ? 1 : 0); }
  await limpiar();

  const EMP: Record<string, { ext: string; nombre: string; razon: string; id: string }> = {
    [NIT_A]: { ext: 'pvn-emp-a', nombre: 'PVN COLEGIO UNO', razon: 'PVN TITULAR, S.A.', id: 'sbwPVN01' },
    [NIT_B]: { ext: 'pvn-emp-b', nombre: 'PVN COLEGIO DOS', razon: 'PVN ADICIONAL, S.A.', id: 'sbwPVN02' },
    [NIT_C]: { ext: 'pvn-emp-c', nombre: 'PVN OTRA EMPRESA', razon: 'PVN TERCERO, S.A.', id: 'sbwPVN03' },
  };
  const { data: cli, error: eCli } = await sb.from('clientes').insert(NITS.map(n => ({ airtable_id: EMP[n].id, nombre_empresa: EMP[n].nombre, razon_social: EMP[n].razon, nit: n, activo: true, dias_credito: 30 }))).select('id, nit');
  const cliDe = (n: string) => (cli ?? []).find(c => c.nit === n)?.id as string;
  const { error: eMap } = await sb.from('cliente_externo').insert(NITS.map(n => ({ fuente: 'agenda', empresa_id_externo: EMP[n].ext, empresa_nombre_externo: EMP[n].nombre, nit: n, cliente_id: cliDe(n), activo: true, creado_por: 'e2e' })));
  // pruebas: polígrafo pre empleo terminadas; fechas intercaladas entre A y B para probar el FIFO GLOBAL
  const seeds: Array<{ ext: string; nit: string; dia: string }> = [
    { ext: 'A1', nit: NIT_A, dia: '2026-10-02' }, { ext: 'B1', nit: NIT_B, dia: '2026-10-03' }, { ext: 'A2', nit: NIT_A, dia: '2026-10-04' },
    { ext: 'B2', nit: NIT_B, dia: '2026-10-05' }, { ext: 'A3', nit: NIT_A, dia: '2026-10-06' }, { ext: 'B3', nit: NIT_B, dia: '2026-10-07' },
    { ext: 'A4', nit: NIT_A, dia: '2026-10-08' }, { ext: 'C1', nit: NIT_C, dia: '2026-10-01' },
  ];
  const filaExp = (s: { ext: string; nit: string }) => ({ fuente: 'agenda', id_externo: `${PREFIJO}${s.ext}`, empresa_id_externo: EMP[s.nit].ext, empresa_nombre_externo: EMP[s.nit].nombre, nit_resuelto: s.nit, cliente_id: cliDe(s.nit), persona: `Persona ${s.ext}`, puesto: 'Puesto', solicitante: 'RRHH', tipo_prueba: 'POLIGRAFO', categoria_prueba: 'PRE EMPLEO', proceso_solicitado: 'POLIGRAFO', fecha_ingreso: '2026-10-01', fecha_entrega: '2026-10-15', status_proceso: 'TERMINADO', terminado: true, cancelado: false, eliminado: false, status_cobro_externo: 'PENDIENTE', estatus_pago_externo: null, estado_tarifa: 'resuelta', tipo_cobrado: 'POLIGRAFO', monto_calculado: 450, categoria_canon: 'PRE EMPLEO', territorio_resuelto: 'METROPOLITANA' });
  const { data: insExps, error: eExp } = await sb.from('facturacion_expediente').insert(seeds.map(filaExp)).select('id, id_externo');
  const expId = new Map((insExps ?? []).map(e => [String(e.id_externo).slice(PREFIJO.length), e.id as string]));
  const filaComp = (s: { ext: string; dia: string }) => ({ expediente_id: expId.get(s.ext), fuente: 'agenda', id_externo: `${PREFIJO}${s.ext}`, servicio: 'POLIGRAFO', estado_prueba: 'APROBO', situacion: 'cobra', motivo: 'E2E', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto_calculado: 450, estado_tarifa: 'resuelta', fecha_resultado: `${s.dia}T15:00:00Z`, fecha_resultado_fuente: 'agenda' });
  const { data: insComps, error: eComp } = await sb.from('facturacion_componente').insert(seeds.map(filaComp)).select('id, id_externo');
  const compId = (ext: string) => (insComps ?? []).find(c => c.id_externo === `${PREFIJO}${ext}`)?.id as string;
  ok(!eCli && !eMap && !eExp && !eComp && expId.size === seeds.length && (insComps ?? []).length === seeds.length, `sembrado: 3 clientes mapeados (titular A, adicional B, tercero C) y ${seeds.length} polígrafos pre empleo terminados${[eCli, eMap, eExp, eComp].filter(Boolean).map(e => ' · ' + e!.message).join('')}`);

  const DB = await import('../src/lib/db/paquetes');
  const FA = await import('../src/lib/db/facturacion-agenda');
  const M = await import('../src/lib/facturacion-agenda/mapeo');
  const LINEA = [{ servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', cantidad: 5, precioUnitario: 450 }];
  const ext = (idExterno: string) => idExterno.slice(PREFIJO.length);
  const vigentesDe = async (paqueteId: string) => { const d = await DB.getPaqueteDetalle(paqueteId); return (d?.consumos ?? []).filter(c => !c.revertidoEn); };
  const enCola = async (nit: string) => (await FA.listarExpedientesLocal({ nit })).flatMap(e => M.pruebasEnCola(e)).map(p => ext(p.idExterno)).sort().join(',');

  // 1) vista previa con los dos NIT: FIFO global por fecha; el NIT C no entra
  const vp = await DB.vistaPreviaPaquete([NIT_A, NIT_B], '2026-10-01', null, LINEA);
  const vpSolo = await DB.vistaPreviaPaquete(NIT_A, '2026-10-01', null, LINEA);
  ok(vp.length === 1 && vp[0].candidatas === 7 && vp[0].tomaria === 5 && vp[0].pruebas.map(p => ext(p.idExterno)).join(',') === 'A1,B1,A2,B2,A3,B3,A4' && vp[0].pruebas.every(p => p.nit === (ext(p.idExterno).startsWith('A') ? NIT_A : NIT_B)) && vp[0].porNit[NIT_A] === 4 && vp[0].porNit[NIT_B] === 3 && vpSolo[0]?.candidatas === 4, `vista previa con titular + adicional: 7 candidatas en orden FIFO global (${vp[0]?.pruebas.map(p => ext(p.idExterno)).join(',')}), tomaría 5; 4 de A y 3 de B; cada prueba con su NIT; C no entra; con un solo NIT, 4`);
  const { data: vpVieja, error: eVieja } = await sb.rpc('paquete_vista_previa', { p_nit: NIT_A, p_fecha_inicio: '2026-10-01', p_vence_en: null, p_lineas: [{ servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', cantidad: 5 }] });
  ok(!eVieja && Number((vpVieja as Array<{ candidatas: number }>)?.[0]?.candidatas) === 4, `la firma de la 034 (p_nit) sigue respondiendo: la app desplegada no se rompe entre la migración y el deploy${eVieja ? ' · ' + eVieja.message : ''}`);

  // 2) crear con adicional, sin confirmar la retroactiva: nada se descuenta; el resumen se encuentra desde A y desde B, no desde C
  const c1 = await DB.crearPaquete({ nit: NIT_A, nitsAdicionales: [NIT_B, NIT_A, ` ${NIT_B} `], nombre: 'Paquete 5 polígrafos · grupo', fechaInicio: '2026-10-01', lineas: LINEA }, ACTOR);
  const id1 = c1.ok ? c1.id : '';
  const [desdeA, desdeB, desdeC] = await Promise.all([DB.listarPaquetes(NIT_A), DB.listarPaquetes(NIT_B), DB.listarPaquetes(NIT_C)]);
  const pA = desdeA.find(p => p.id === id1), pB = desdeB.find(p => p.id === id1);
  ok(c1.ok && c1.aplicado.consumidos === 0 && !!pA && !!pB && !desdeC.some(p => p.id === id1) && pA.nit === NIT_A && pB.nit === NIT_A && pA.nitsAdicionales.map(a => a.nit).join(',') === NIT_B && pA.nitsAdicionales[0].razonSocial === EMP[NIT_B].razon && pA.razonSocial === EMP[NIT_A].razon && pA.retroPendientes === 7, `crear con «También lo usan» (${c1.ok ? c1.correlativo : c1.error}): el titular sigue siendo A, B queda como adicional con su nombre (sin repetir ni incluir al titular); el resumen se encuentra desde A y desde B y no desde C; 7 pruebas de los dos NIT esperan la confirmación`);
  ok(!!pB && P.etiquetaCompartido(pB) === `Compartido · titular: PVN TITULAR (${NIT_A})`, `etiqueta en el tarifario de B: «${pB ? P.etiquetaCompartido(pB) : ''}»`);

  // 3) retroactiva con los dos NIT: 3 de A y 2 de B en FIFO global; la 6.ª y la 7.ª a tarifa; C no descuenta
  const conf = await DB.confirmarRetroactivo(id1, ACTOR);
  const v3 = await vigentesDe(id1);
  const A1 = (await DB.listarPaquetes(NIT_B)).find(p => p.id === id1)!;
  ok(conf.ok && conf.aplicado.consumidos === 5 && v3.map(c => ext(c.idExterno)).join(',') === 'A1,B1,A2,B2,A3' && A1.usadasPorNit[NIT_A] === 3 && A1.usadasPorNit[NIT_B] === 2 && A1.lineas[0].remanente === 0 && A1.estado === 'agotado', `retroactiva confirmada: 5 descontadas en FIFO global (${v3.map(c => ext(c.idExterno)).join(',')}) = 3 de A + 2 de B → ${A1.correlativo} agotado`);
  const [colaA, colaB, colaC] = await Promise.all([enCola(NIT_A), enCola(NIT_B), enCola(NIT_C)]);
  ok(colaB === 'B3' && colaA === 'A4' && colaC === 'C1', `la 6.ª (B3) y la 7.ª (A4) van a Por facturar a tarifa; el NIT C, que no está en el paquete, no descuenta (cola: A ${colaA} · B ${colaB} · C ${colaC})`);

  // 4) el detalle trae el NIT y la empresa de cada prueba; subtotal por NIT
  const det1 = (await DB.getPaqueteDetalle(id1))!;
  const sub = P.subtotalesPorNit(det1);
  ok(v3.every(c => c.nit === (ext(c.idExterno).startsWith('A') ? NIT_A : NIT_B) && c.empresa === EMP[c.nit].razon) && sub.map(t => `${t.nit}:${t.usadas}`).join(',') === `${NIT_A}:3,${NIT_B}:2` && sub[0].titular && sub[1].empresa === EMP[NIT_B].razon, `detalle: cada prueba con su «Empresa / NIT» y subtotal ${sub.map(t => `${t.empresa} ${t.usadas}`).join(' · ')}`);
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { PaqueteImprimible } = await import('../src/components/paquetes/paquete-imprimible');
  const pdf = renderToStaticMarkup(createElement(PaqueteImprimible, { datos: det1, emisor: { nombre: 'HIT', nit: '1', direccion: '' }, hoy: '2026-11-18' }));
  const nitsPdf = (pdf.match(/data-nit-prueba="([0-9A-Z]+)"/g) ?? []).map(x => x.slice(17, -1));
  ok(nitsPdf.join(',') === [NIT_A, NIT_B, NIT_A, NIT_B, NIT_A].join(',') && pdf.includes(`data-subtotal-nit="${NIT_A}:3,${NIT_B}:2"`) && pdf.includes('Empresa / NIT') && pdf.includes(`NIT ${NIT_B}`), `PDF con los datos reales del paquete: el NIT de cada prueba (${nitsPdf.join(', ')}) y el subtotal por NIT`);

  // 5) el banner de Por facturar aparece en los dos clientes
  const [gA, gB, gC] = await Promise.all([FA.getGrupo(`n-${NIT_A}`), FA.getGrupo(`n-${NIT_B}`), FA.getGrupo(`n-${NIT_C}`)]);
  const mapa = await DB.paquetesPorNit();
  ok(!!gA?.paquetes.some(p => p.id === id1) && !!gB?.paquetes.some(p => p.id === id1) && !gC?.paquetes.some(p => p.id === id1) && !!mapa.get(NIT_A)?.some(p => p.id === id1) && !!mapa.get(NIT_B)?.some(p => p.id === id1) && !mapa.get(NIT_C)?.some(p => p.id === id1), 'Por facturar: el banner del paquete aparece en el grupo de A y en el de B (y sus badges en la lista), no en el de C');

  // 6) quitar B con consumos vigentes → pide decisión; sin ella no cambia nada (ni por la app ni por la RPC)
  const q0 = await DB.editarPaquete(id1, { nitsAdicionales: [] }, ACTOR);
  const rpc0 = await sb.rpc('paquete_editar', { p_actor: ACTOR, p_id: id1, p_cambios: { nits_adicionales: [] } });
  const tras0 = (await DB.listarPaquetes(NIT_B)).find(p => p.id === id1);
  ok(!q0.ok && q0.decision?.length === 1 && q0.decision[0].nit === NIT_B && q0.decision[0].pruebas === 2 && /Quedan 2 pruebas del NIT .* descontadas: ¿mantenerlas o revertirlas\?/.test(q0.error) && !!rpc0.error && /PAQUETE_NIT_CON_CONSUMOS: quedan 2 pruebas del NIT/.test(rpc0.error.message) && !!tras0 && (await vigentesDe(id1)).length === 5, `quitar B con consumos: «${!q0.ok ? q0.error : ''}»; la RPC sin decisión falla con PAQUETE_NIT_CON_CONSUMOS y B sigue en el paquete con sus 2 pruebas`);

  // 7) quitar B manteniendo: sale del paquete, sus 2 pruebas siguen descontadas, deja de descontar
  const q1 = await DB.editarPaquete(id1, { nitsAdicionales: [], alQuitarNit: 'mantener' }, ACTOR);
  const v7 = await vigentesDe(id1);
  const det7 = (await DB.getPaqueteDetalle(id1))!;
  ok(q1.ok && q1.paquete.nitsAdicionales.length === 0 && !(await DB.listarPaquetes(NIT_B)).some(p => p.id === id1) && v7.length === 5 && v7.filter(c => c.nit === NIT_B).length === 2 && P.subtotalesPorNit(det7).map(t => `${t.nit}:${t.usadas}:${t.vigente}`).join(',') === `${NIT_A}:3:true,${NIT_B}:2:false` && (await enCola(NIT_B)) === 'B3', 'mantener: B ya no usa el paquete (no se encuentra desde B), sus 2 pruebas siguen descontadas y el subtotal lo muestra como «ya no lo usa»');

  // 8) volver a agregar B y quitarlo revirtiendo: las 2 de B vuelven al paquete y a la cola a tarifa; A4 toma una unidad
  const q2 = await DB.editarPaquete(id1, { nitsAdicionales: [NIT_B] }, ACTOR);
  const q3 = await DB.editarPaquete(id1, { nitsAdicionales: [], alQuitarNit: 'revertir' }, ACTOR);
  const det8 = (await DB.getPaqueteDetalle(id1))!;
  const v8 = det8.consumos.filter(c => !c.revertidoEn), r8 = det8.consumos.filter(c => !!c.revertidoEn);
  ok(q2.ok && q2.paquete.nitsAdicionales.map(a => a.nit).join(',') === NIT_B && q3.ok && v8.map(c => ext(c.idExterno)).join(',') === 'A1,A2,A3,A4' && r8.map(c => ext(c.idExterno)).sort().join(',') === 'B1,B2' && r8.every(c => new RegExp(`se quitó el NIT ${NIT_B} del paquete`).test(c.motivoReversion ?? '')) && det8.paquete.lineas[0].remanente === 1 && det8.paquete.estado === 'activo' && (await enCola(NIT_B)) === 'B1,B2,B3', `revertir: las 2 pruebas de B se revierten con motivo (fila conservada) y vuelven a Por facturar a tarifa (${await enCola(NIT_B)}); el paquete recupera las unidades y A4 toma una (${v8.map(c => ext(c.idExterno)).join(',')}; resta ${det8.paquete.lineas[0].remanente})`);

  // 9) dos aplicar a la vez, cada uno por un NIT distinto del MISMO paquete: se serializan por paquete → un solo consumo, el más viejo
  const { error: eNit } = await sb.from('paquete_nit').insert({ paquete_id: id1, nit: NIT_B, agregado_por: ACTOR });
  const [r1, r2] = await Promise.all([sb.rpc('paquete_aplicar_consumos', { p_nit: NIT_A, p_fuente: 'agenda', p_hoy: null, p_actor: 'sync-a' }), sb.rpc('paquete_aplicar_consumos', { p_nit: NIT_B, p_fuente: 'agenda', p_hoy: null, p_actor: 'sync-b' })]);
  const tot = Number((r1.data as { consumidos?: number })?.consumidos ?? 0) + Number((r2.data as { consumidos?: number })?.consumidos ?? 0);
  const v9 = await vigentesDe(id1);
  const { count: nB1 } = await sb.from('paquete_consumo').select('id', { count: 'exact', head: true }).eq('componente_id', compId('B1')).is('revertido_en', null);
  ok(!eNit && !r1.error && !r2.error && tot === 1 && v9.length === 5 && nB1 === 1 && v9.some(c => ext(c.idExterno) === 'B1') && Number((r1.data as { clientes?: number })?.clientes) === 2 && Number((r2.data as { clientes?: number })?.clientes) === 2, `dos aplicar en paralelo por A y por B: un solo consumo (${tot}) y es B1, la prueba más vieja sin descontar; cada llamada resolvió los 2 NIT del paquete (errores ${r1.error?.message ?? '-'} / ${r2.error?.message ?? '-'})`);

  // 10) reversión automática y cierre siguen como en la 034 con un NIT adicional
  await sb.from('facturacion_componente').update({ situacion: 'pendiente', motivo: 'la Agenda corrigió el resultado' }).eq('id', compId('B1'));
  const ap = await DB.aplicarPaquetes(NIT_B, ACTOR);
  const v10 = await vigentesDe(id1);
  const cz = await DB.cerrarPaquete(id1, 'validador', ACTOR);
  const ap2 = await DB.aplicarPaquetes(NIT_B, ACTOR);
  ok(!!ap && ap.revertidos === 1 && ap.consumidos === 1 && v10.map(c => ext(c.idExterno)).join(',') === 'A1,A2,A3,A4,B2' && cz.ok && cz.paquete.estado === 'cerrado' && !!ap2 && ap2.consumidos === 0 && ap2.clientes === 0, `no se tocó: B1 pasa a pendiente → se revierte sola y la unidad la toma B2 (${v10.map(c => ext(c.idExterno)).join(',')}); cerrado no vuelve a descontar`);

  ok((await limpiar()) === 0, 'limpieza verificada: 0 expedientes PVN, paquetes ni clientes');
  console.log(`\n${pass} 🟢 / ${fail} 🔴`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
