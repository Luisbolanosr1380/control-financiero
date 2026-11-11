/**
 * PAQUETES PREPAGADOS (034) — validador.
 *
 *  A. Estático: la 034 (tablas, RLS, índice único del consumo vigente, RPC), el descuento engancha en el mismo paso del sync
 *     (upsertExpedientes → paquete_aplicar_consumos), la regla de cola con cubiertas en SQL y TS, el detalle y la emisión
 *     rechazan cubiertas, write-back con el número del paquete, producción con «cubierta», permisos, pantallas, ayuda.
 *  B. Puro: estado efectivo, umbral por defecto, lineaCubre, token, banner, filtros, CSV; facturasDelExpediente con cubiertas;
 *     pruebaEnCola excluye cubiertas; canon PSICOMETRICAS.
 *  C. HIT (datos sembrados): cliente con 2 paquetes de polígrafos pre empleo (FIFO), uno vencido de socios y uno de
 *     psicométricas; pruebas terminadas (4 pre empleo + 1 rutina + 1 anterior al inicio + 1 socio + 1 completo + psicométricas).
 *     La retroactiva aplica solo al confirmar; 4 se cubren y la 5.ª va a la cola a tarifa; rutina no descuenta; vencido no
 *     descuenta; anterior al inicio no; reversión al pasar a pendiente; detalle rechaza una cubierta; dos aplicar en paralelo =
 *     un solo consumo; el COMPLETO espera al socio y el cierre escribe ambos números; psicométrica con paquete descuenta y la
 *     del otro cliente queda excluida; avisos de umbral / agotado en el historial de cobranza; producción con cubiertas;
 *     paridad SQL / TS de la cola y de lineaCubre.
 *
 * Uso: npx tsx scripts/validate-paquetes.ts hit [--conservar | --solo-limpiar]   (--conservar deja los datos PQ-E2E para el E2E en Chrome)
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FiltroPaquetes, Paquete, PaqueteLinea } from '../src/lib/paquetes/paquete';

const BASE = (process.argv[2] ?? 'hit').toLowerCase();
if (BASE !== 'hit') { console.error('Este validador siembra datos: solo corre contra HIT.'); process.exit(2); }
const SOLO_LIMPIAR = process.argv.includes('--solo-limpiar'), CONSERVAR = process.argv.includes('--conservar');
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.hit.vercel'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('='); process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  🟢 ${m}`); } else { fail++; console.log(`  🔴 ${m}`); } };
const rd = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const NIT = '99990042K', NIT_B = '99990043K', EMPRESA = 'pq-e2e-emp', EMPRESA_B = 'pq-e2e-emp2', PREFIJO = 'PQE2E-', ACTOR = 'validador@pq-e2e.example';

(async () => {
  /* ───────────── A. Estático ───────────── */
  console.log('\nA. Estático');
  const sql = rd('supabase/migrations/034_paquetes_prepagados.sql'), db = rd('src/lib/db/facturacion-agenda.ts'), mapeo = rd('src/lib/facturacion-agenda/mapeo.ts'), puro = rd('src/lib/paquetes/paquete.ts'), dbp = rd('src/lib/db/paquetes.ts');
  ok(/create table if not exists paquete \(/.test(sql) && /create table if not exists paquete_linea \(/.test(sql) && /create table if not exists paquete_consumo \(/.test(sql) && /create unique index if not exists uq_paquete_consumo_vigente on paquete_consumo \(componente_id\) where revertido_en is null/.test(sql) && /check \(estado in \('activo', 'agotado', 'vencido', 'cerrado'\)\)/.test(sql) && /grant all on table paquete, paquete_linea, paquete_consumo to service_role/.test(sql) && !/^\s*(begin|commit);/m.test(sql) && !/drop (table|function)/i.test(sql) && !/^\s*(delete|truncate) /im.test(sql), '034: paquete / paquete_linea / paquete_consumo, un consumo vigente por prueba (índice único parcial), estados con check, RLS + solo service_role; sin begin/commit ni drop/delete');
  ok(/create or replace function paquete_aplicar_consumos\(p_nit text default null, p_fuente text default 'agenda', p_hoy date default null, p_actor text default 'sistema'\)/.test(sql) && /for update of pl;/.test(sql) && /order by p2\.fecha_inicio, p2\.created_at, l2\.created_at, l2\.id/.test(sql) && /nulls last, c\.fecha_resultado nulls last, c\.created_at, c\.id/.test(sql) && /p2\.retroactivo_confirmado or r\.momento is null or r\.momento >= p2\.created_at/.test(sql) && /set revertido_en = now\(\)/.test(sql) && /'cambio_condicion', 'automatico'/.test(sql), 'paquete_aplicar_consumos: bloquea las líneas (for update), FIFO (pruebas más viejas, paquete más antiguo), retroactiva solo confirmada, reversión con motivo, avisos como cambio_condicion');
  ok(/and not exists \(select 1 from paquete_consumo x where x\.componente_id = c\.id and x\.revertido_en is null\)   -- 034: cubierta por un paquete/.test(sql) && (sql.match(/not exists \(select 1 from paquete_consumo x where x\.componente_id = c\.id and x\.revertido_en is null\)/g) ?? []).length >= 4 && /PRUEBA_CUBIERTA_POR_PAQUETE/.test(sql) && (sql.match(/PRUEBA_CUBIERTA_POR_PAQUETE/g) ?? []).length >= 2 && /and not paquete_componente_cubierto\(c\.id\)\) as sin_cobrables/.test(sql), 'cola en SQL: en_cola / resumen / sin_mapear excluyen cubiertas (conservando 017–030); detalle y emisión rechazan PRUEBA_CUBIERTA_POR_PAQUETE; «completo» cuenta las cubiertas');
  ok(/paquete_token\(p\)/.test(sql) && /Expediente cubierto por el paquete prepagado/.test(sql) && /'cubierta_n'|as cubierta_n/.test(sql) && /\(e\.estado_tarifa <> 'excluido_psicometrica' or pc\.id is not null\)/.test(sql) && /slug.*paquetes-prepagados|'paquetes-prepagados'/.test(sql), 'cierre para el write-back con el número del paquete; producción con cubierta_n / cubierta_q (psicométrica solo si la cubre un paquete); artículo de ayuda');
  ok(/await aplicarPaquetes\(null, 'sync'\)/.test(db) && /anotarCubiertas\(todas\)/.test(db) && /from\('paquete_consumo'\)/.test(db) && /paquetes,\n    arranque/.test(db) && /paquetesPorNit/.test(db), 'app: el sync / webhook / re-resolver aplican los consumos en el mismo paso (upsertExpedientes); las pruebas cargan «cubiertaPor»; el grupo y la lista traen los paquetes');
  ok(/!p\.cubiertaPor && \(servicioPorEstado/.test(mapeo) && /export const pruebasCubiertas/.test(mapeo) && /cub\.map\(p => \(p\.cubiertaPor!\.noFactura/.test(mapeo) && /nit: empresaId \? \(ctx\.nitPorEmpresa\.get\(empresaId\) \?\? null\) : null, monto: null, detalle, pruebas: sinPrecio\('excluido_psicometrica'/.test(mapeo) && /return 'PSICOMETRICAS'/.test(rd('src/lib/tarifario/canon.ts')), 'TS: pruebaEnCola excluye cubiertas (paridad con SQL), facturasDelExpediente une «F-140 / PAQ-0001», la psicométrica resuelve su cliente y sigue excluida; canon PSICOMETRICAS');
  ok(/gestionar_paquetes: CONTROL/.test(rd('src/lib/auth/roles.ts')) && /'\/paquetes', '\/imprimir'/.test(rd('src/lib/auth/roles.ts')) && /href: '\/paquetes'/.test(rd('src/components/shell/sidebar.tsx')) && !/\.insert\(|\.update\(|\.delete\(/.test(dbp) && !/from 'node:|server-only|@\/lib\/db/.test(puro), 'permisos: gestionar_paquetes = admin y contador; cobranza ve /paquetes; menú; la capa de datos solo usa las RPC; módulo puro sin IO');
  const ui = ['src/app/(app)/paquetes/page.tsx', 'src/app/(app)/paquetes/actions.ts', 'src/app/(app)/tarifario/paquetes/[id]/page.tsx', 'src/app/imprimir/paquete/[id]/page.tsx', 'src/components/paquetes/paquetes-section.tsx', 'src/components/paquetes/paquete-detalle.tsx', 'src/components/paquetes/paquete-imprimible.tsx', 'src/components/paquetes/paquetes-lista.tsx'];
  const faltan = ui.filter(f => !fs.existsSync(f));
  const gd = fs.existsSync('src/components/por-facturar/grupo-detalle.tsx') ? rd('src/components/por-facturar/grupo-detalle.tsx') : '';
  ok(faltan.length === 0 && /Cubierta por/.test(gd) && /data-banner-paquete/.test(gd) && (fs.existsSync('src/app/(app)/paquetes/actions.ts') && /exigir\('gestionar_paquetes'\)/.test(rd('src/app/(app)/paquetes/actions.ts'))) && !/window\.(confirm|alert|prompt)/.test(ui.filter(f => fs.existsSync(f)).map(rd).join('') + gd), `pantallas: tarifario → Paquetes, detalle, PDF, lista global, banner y «Cubierta por» en Por facturar; acciones con gestionar_paquetes; sin diálogos del navegador${faltan.length ? ' · faltan: ' + faltan.join(', ') : ''}`);

  /* ───────────── B. Puro ───────────── */
  console.log('\nB. Puro');
  const P = await import('../src/lib/paquetes/paquete');
  const M = await import('../src/lib/facturacion-agenda/mapeo');
  const C = await import('../src/lib/tarifario/canon');
  const lin = (over: Partial<PaqueteLinea> = {}): PaqueteLinea => ({ id: 'l1', servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: null, cantidad: 100, precioUnitario: 450, usadas: 63, remanente: 37, avisoUmbralEn: null, agotadoEn: null, ...over });
  const pq = (over: Partial<Paquete> = {}): Paquete => ({ id: 'p1', correlativo: 'PAQ-0001', nit: NIT, clienteId: null, cliente: 'ACME', nombre: 'Paquete 100', fechaInicio: '2026-01-01', venceEn: null, estado: 'activo', noFactura: null, facturaId: null, facturaAppId: null, umbralAviso: 10, retroactivoConfirmado: true, retroPendientes: 0, notas: '', creadoPor: 'x', createdAt: '2026-01-01', updatedAt: null, cerradoPor: null, cerradoMotivo: null, cerradoEn: null, lineas: [lin()], ...over });
  const hoy = '2026-11-11';
  ok(P.estadoEfectivo(pq(), hoy) === 'activo' && P.estadoEfectivo(pq({ lineas: [lin({ usadas: 95, remanente: 5 })] }), hoy) === 'por_agotarse' && P.estadoEfectivo(pq({ lineas: [lin({ usadas: 100, remanente: 0 })] }), hoy) === 'agotado' && P.estadoEfectivo(pq({ venceEn: '2026-12-01' }), hoy) === 'vence_pronto' && P.estadoEfectivo(pq({ venceEn: '2026-11-10' }), hoy) === 'vencido' && P.estadoEfectivo(pq({ estado: 'vencido' }), hoy) === 'vencido' && P.estadoEfectivo(pq({ estado: 'cerrado', venceEn: '2026-11-10' }), hoy) === 'cerrado' && P.estadoEfectivo(pq({ venceEn: '2027-01-15', lineas: [lin({ usadas: 92, remanente: 8 })] }), hoy) === 'por_agotarse', 'estado efectivo: activo / por agotarse (≤ umbral) / agotado / vence pronto (≤ 30 días) / vencido / cerrado manda');
  ok(P.umbralPorDefecto(100) === 10 && P.umbralPorDefecto(20) === 5 && P.umbralPorDefecto(3) === 5 && P.umbralPorDefecto(55) === 6, 'umbral por defecto: max(5, 10 %) → 100 → 10, 20 → 5, 3 → 5, 55 → 6');
  ok(P.lineaCubre({ servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: null }, { servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA' }) && !P.lineaCubre({ servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: null }, { servicio: 'POLIGRAFO', categoria: 'RUTINA', territorio: '' }) && !P.lineaCubre({ servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'DEPARTAMENTAL' }, { servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA' }) && P.lineaCubre({ servicio: 'PSICOMETRICAS', categoria: 'UNICA', territorio: 'UNICA' }, { servicio: 'PSICOMETRICAS', categoria: '', territorio: '' }) && !P.lineaCubre({ servicio: 'SOCIOECONOMICO', categoria: 'PRE EMPLEO', territorio: null }, { servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: '' }), 'lineaCubre: servicio + categoría exactos, UNICA = cualquiera, territorio solo si la línea lo fija (espejo de paquete_linea_cubre)');
  ok(P.tokenPaquete(pq()) === 'PAQ-0001' && P.tokenPaquete(pq({ noFactura: ' F-123 ' })) === 'F-123 (PAQ-0001)' && P.textoBanner(pq({ venceEn: '2026-12-31' })) === 'Paquete PAQ-0001 · Poligrafo pre empleo: 37 restantes de 100 · vence 31-dic' && P.textoUsadas(pq()) === 'Usadas 63 de 100 · Restan 37' && P.valorRemanente(pq()) === 16650 && P.porcentajeUsado(pq()) === 63, 'token «F-123 (PAQ-0001)» / «PAQ-0001», banner «37 restantes de 100 · vence 31-dic», «Usadas 63 de 100 · Restan 37», valor del remanente 37 × 450');
  const lista = [pq(), pq({ id: 'p2', lineas: [lin({ usadas: 96, remanente: 4 })] }), pq({ id: 'p3', lineas: [lin({ usadas: 100, remanente: 0 })] }), pq({ id: 'p4', venceEn: '2026-10-01' }), pq({ id: 'p5', estado: 'cerrado' })];
  const f = (x: FiltroPaquetes) => lista.filter(p => P.pasaFiltro(p, x, hoy)).map(p => p.id).join(',');
  ok(f('activos') === 'p1,p2' && f('por_agotarse') === 'p2' && f('agotados') === 'p3' && f('vencidos') === 'p4' && f('todos') === 'p1,p2,p3,p4,p5', 'filtros de la lista: activos (incluye por agotarse), por agotarse, agotados, vencidos, todos');
  const csv = P.csvDetalle({ paquete: pq(), consumos: [{ id: 'c1', lineaId: 'l1', componenteId: 'x', fecha: '2026-10-05T10:00:00Z', revertidoEn: null, motivoReversion: null, fechaResultado: '2026-10-05T09:00:00Z', servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', estadoPrueba: 'APROBO', situacion: 'cobra', persona: 'Ana, Pérez', solicitante: 'RRHH', puesto: 'Cajera', idExterno: 'E1', expedienteId: 'e1', detalleId: null, noFactura: null }] });
  ok(csv.startsWith('﻿paquete,linea,persona') && /PAQ-0001,Poligrafo pre empleo,"Ana, Pérez",RRHH,Cajera,E1,2026-10-05,APROBO,POLIGRAFO,PRE EMPLEO,METROPOLITANA,descontado,,/.test(csv) && /Poligrafo pre empleo,100,63,37,450,16650/.test(csv), 'CSV del detalle: una fila por prueba (persona con coma entre comillas) y las líneas con remanente y valor al pie');
  const prueba = (over: Record<string, unknown>) => ({ id: 'a', expedienteId: 'e', idExterno: 'E', servicio: 'POLIGRAFO', estadoPrueba: 'APROBO', situacion: 'cobra' as const, motivo: '', categoria: 'PRE EMPLEO', territorio: '', montoCalculado: 450, estadoTarifa: 'resuelta' as const, detalleTarifa: '', tarifarioId: null, aprobada: true, detalleId: null, facturaId: null, noFactura: null, facturadoEn: null, facturadoPor: null, fechaResultado: '2026-10-05T00:00:00Z', fechaResultadoFuente: 'agenda' as const, cubiertaPor: null, ...over });
  const exp = { terminado: true, cancelado: false, eliminado: false, estadoTarifa: 'resuelta' as const, statusCobroExterno: 'PENDIENTE', estatusPagoExterno: null, arranqueExcluido: false };
  const cub = { consumoId: 'c', paqueteId: 'p', correlativo: 'PAQ-0007', noFactura: null, precioUnitario: 450, fecha: '2026-10-06T00:00:00Z' };
  ok(M.pruebaEnCola(prueba({}), exp) && !M.pruebaEnCola(prueba({ cubiertaPor: cub }), exp) && M.pruebasEnCola({ ...exp, pruebas: [prueba({}), prueba({ id: 'b', cubiertaPor: cub })] }).length === 1 && M.pruebasCubiertas({ pruebas: [prueba({}), prueba({ id: 'b', cubiertaPor: cub })] }).length === 1, 'pruebaEnCola: una prueba cubierta no está en cola (sale de listos y totales); pruebasCubiertas la separa');
  const fe = M.facturasDelExpediente({ noFactura: null, montoCalculado: 1100, pruebas: [prueba({ id: 'p', servicio: 'POLIGRAFO', cubiertaPor: cub }), prueba({ id: 's', servicio: 'SOCIOECONOMICO', montoCalculado: 650, facturaId: 'f', noFactura: 'F-140', facturadoEn: '2026-10-20' })] });
  const fe2 = M.facturasDelExpediente({ noFactura: null, montoCalculado: 450, pruebas: [prueba({ cubiertaPor: { ...cub, noFactura: 'F-123' } })] });
  ok(fe.numero === 'F-140 / PAQ-0007' && fe.montoSinIva === 1100 && fe2.numero === 'F-123 (PAQ-0007)' && fe2.montoSinIva === 450, 'write-back: «F-140 / PAQ-0007» con la suma (650 facturado + 450 del paquete); solo cubierta con factura del anticipo → «F-123 (PAQ-0007)»');
  ok(C.canonTipoPrueba('PSICOMETRICAS') === 'PSICOMETRICAS' && C.canonTipoPrueba('Psicométrica') === 'PSICOMETRICAS' && C.canonTipoPrueba('POLIGRAFO') === 'POLIGRAFO' && M.serviciosDe('PSICOMETRICAS', null).join() === 'PSICOMETRICAS', 'canon: PSICOMETRICAS (y sus grafías) es el servicio canónico de las psicométricas; los demás no cambian');

  /* ───────────── C. HIT ───────────── */
  console.log(`\nC. HIT${SOLO_LIMPIAR ? ' (--solo-limpiar)' : ''}`);
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const limpiar = async () => {
    const { data: pqs } = await sb.from('paquete').select('id').in('nit', [NIT, NIT_B]);
    const pids = (pqs ?? []).map(p => p.id as string);
    if (pids.length) {
      const { data: ls } = await sb.from('paquete_linea').select('id').in('paquete_id', pids);
      const lids = (ls ?? []).map(l => l.id as string);
      if (lids.length) await sb.from('paquete_consumo').delete().in('paquete_linea_id', lids);
      await sb.from('paquete_linea').delete().in('paquete_id', pids);
      await sb.from('paquete').delete().in('id', pids);
    }
    const { data: exps } = await sb.from('facturacion_expediente').select('id').like('id_externo', `${PREFIJO}%`);
    const ids = (exps ?? []).map(e => e.id as string);
    if (ids.length) {
      const { data: cs } = await sb.from('facturacion_componente').select('id').in('expediente_id', ids);
      const cids = (cs ?? []).map(c => c.id as string);
      if (cids.length) { await sb.from('paquete_consumo').delete().in('componente_id', cids); await sb.from('factura_detalle_expediente').delete().in('componente_id', cids); }
      await sb.from('facturacion_componente').delete().in('expediente_id', ids);
      await sb.from('facturacion_expediente').delete().in('id', ids);
    }
    const { data: fs2 } = await sb.from('facturas_clientes').select('id').like('no_factura', `${PREFIJO}%`);
    const fids = (fs2 ?? []).map(f => f.id as string);
    if (fids.length) { await sb.from('factura_detalle_expediente').delete().in('factura_id', fids); await sb.from('facturas_clientes').delete().in('id', fids); }
    const { data: clis } = await sb.from('clientes').select('id').in('nit', [NIT, NIT_B]);
    const cuids = (clis ?? []).map(c => c.id as string);
    if (cuids.length) { await sb.from('cobranza_evento').delete().in('cliente_id', cuids); await sb.from('detalle_facturacion').delete().in('cliente_id', cuids); }   // el detalle anulado del paso 7 referencia al cliente
    await sb.from('cliente_externo').delete().in('nit', [NIT, NIT_B]);
    await sb.from('tarifario').delete().in('nit', [NIT, NIT_B]);
    await sb.from('clientes').delete().in('nit', [NIT, NIT_B]);
    const { count } = await sb.from('facturacion_expediente').select('id', { count: 'exact', head: true }).like('id_externo', `${PREFIJO}%`);
    const { count: cp } = await sb.from('paquete').select('id', { count: 'exact', head: true }).in('nit', [NIT, NIT_B]);
    return (count ?? 0) + (cp ?? 0);
  };
  if (SOLO_LIMPIAR) { ok((await limpiar()) === 0, 'limpieza: 0 expedientes PQE2E ni paquetes; consumos, facturas, eventos, mapeos, tarifas y clientes borrados'); console.log(`\n${pass} 🟢 / ${fail} 🔴`); process.exit(fail ? 1 : 0); }
  await limpiar();
  const { data: cli, error: eCli } = await sb.from('clientes').insert([
    { airtable_id: 'sbwPQE2E01', nombre_empresa: 'PQ E2E PAQUETES', razon_social: 'PQ E2E PAQUETES, S.A.', nit: NIT, activo: true, dias_credito: 30 },
    { airtable_id: 'sbwPQE2E02', nombre_empresa: 'PQ E2E SIN PAQUETE', razon_social: 'PQ E2E SIN PAQUETE, S.A.', nit: NIT_B, activo: true, dias_credito: 30 },
  ]).select('id, nit');
  const cliA = (cli ?? []).find(c => c.nit === NIT)?.id as string, cliB = (cli ?? []).find(c => c.nit === NIT_B)?.id as string;
  const { error: eMap } = await sb.from('cliente_externo').insert([
    { fuente: 'agenda', empresa_id_externo: EMPRESA, empresa_nombre_externo: 'PQ E2E PAQUETES', nit: NIT, cliente_id: cliA, activo: true, creado_por: 'e2e' },
    { fuente: 'agenda', empresa_id_externo: EMPRESA_B, empresa_nombre_externo: 'PQ E2E SIN PAQUETE', nit: NIT_B, cliente_id: cliB, activo: true, creado_por: 'e2e' },
  ]);
  const { error: eTar } = await sb.from('tarifario').insert([
    { nit: NIT, razon_social: 'PQ E2E PAQUETES, S.A.', tipo_prueba: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto: 450, anio: '2026', activo: true, aprobado_por: 'e2e', aprobado_en: new Date().toISOString() },
    { nit: NIT, razon_social: 'PQ E2E PAQUETES, S.A.', tipo_prueba: 'POLIGRAFO', categoria: 'RUTINA', territorio: 'METROPOLITANA', monto: 400, anio: '2026', activo: true, aprobado_por: 'e2e', aprobado_en: new Date().toISOString() },
    { nit: NIT, razon_social: 'PQ E2E PAQUETES, S.A.', tipo_prueba: 'SOCIOECONOMICO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto: 650, anio: '2026', activo: true, aprobado_por: 'e2e', aprobado_en: new Date().toISOString() },
  ]);
  // expedientes + pruebas (todas terminadas, cobro pendiente en la Agenda)
  type Seed = { ext: string; nit: string; cliente: string; empresa: string; persona: string; tipo: string; estadoTarifa?: string; pruebas: Array<{ servicio: string; categoria: string; territorio: string; monto: number | null; fecha: string; situacion?: string; estadoTarifa?: string }> };
  const d = (iso: string) => `${iso}T15:00:00Z`;
  const seeds: Seed[] = [
    { ext: 'C1', nit: NIT, cliente: cliA, empresa: EMPRESA, persona: 'Carla Completo', tipo: 'POLIGRAFO, SOCIOECONOMICO', pruebas: [{ servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto: 450, fecha: d('2026-10-04') }, { servicio: 'SOCIOECONOMICO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto: 650, fecha: d('2026-10-12') }] },
    { ext: 'P1', nit: NIT, cliente: cliA, empresa: EMPRESA, persona: 'Pedro Uno', tipo: 'POLIGRAFO', pruebas: [{ servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto: 450, fecha: d('2026-10-05') }] },
    { ext: 'P2', nit: NIT, cliente: cliA, empresa: EMPRESA, persona: 'Pablo Dos', tipo: 'POLIGRAFO', pruebas: [{ servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto: 450, fecha: d('2026-10-06') }] },
    { ext: 'P3', nit: NIT, cliente: cliA, empresa: EMPRESA, persona: 'Paula Tres', tipo: 'POLIGRAFO', pruebas: [{ servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto: 450, fecha: d('2026-10-07') }] },
    { ext: 'P4', nit: NIT, cliente: cliA, empresa: EMPRESA, persona: 'Pía Cuatro', tipo: 'POLIGRAFO', pruebas: [{ servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto: 450, fecha: d('2026-10-08') }] },
    { ext: 'R1', nit: NIT, cliente: cliA, empresa: EMPRESA, persona: 'Rita Rutina', tipo: 'POLIGRAFO', pruebas: [{ servicio: 'POLIGRAFO', categoria: 'RUTINA', territorio: 'METROPOLITANA', monto: 400, fecha: d('2026-10-09') }] },
    { ext: 'V1', nit: NIT, cliente: cliA, empresa: EMPRESA, persona: 'Víctor Viejo', tipo: 'POLIGRAFO', pruebas: [{ servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto: 450, fecha: d('2026-09-20') }] },
    { ext: 'S1', nit: NIT, cliente: cliA, empresa: EMPRESA, persona: 'Sara Socio', tipo: 'SOCIOECONOMICO', pruebas: [{ servicio: 'SOCIOECONOMICO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto: 650, fecha: d('2026-10-10') }] },
    { ext: 'PS1', nit: NIT, cliente: cliA, empresa: EMPRESA, persona: 'Psico Uno', tipo: 'PSICOMETRICAS', estadoTarifa: 'excluido_psicometrica', pruebas: [{ servicio: 'PSICOMETRICAS', categoria: '', territorio: '', monto: null, fecha: d('2026-10-13'), estadoTarifa: 'excluido_psicometrica' }] },
    { ext: 'PS2', nit: NIT_B, cliente: cliB, empresa: EMPRESA_B, persona: 'Psico Dos', tipo: 'PSICOMETRICAS', estadoTarifa: 'excluido_psicometrica', pruebas: [{ servicio: 'PSICOMETRICAS', categoria: '', territorio: '', monto: null, fecha: d('2026-10-14'), estadoTarifa: 'excluido_psicometrica' }] },
  ];
  const exps = seeds.map(s => ({ fuente: 'agenda', id_externo: `${PREFIJO}${s.ext}`, empresa_id_externo: s.empresa, empresa_nombre_externo: s.nit === NIT ? 'PQ E2E PAQUETES' : 'PQ E2E SIN PAQUETE', nit_resuelto: s.nit, cliente_id: s.cliente, persona: s.persona, puesto: 'Puesto', solicitante: 'RRHH', tipo_prueba: s.tipo, categoria_prueba: s.pruebas[0].categoria || null, proceso_solicitado: s.tipo, fecha_ingreso: '2026-10-01', fecha_entrega: '2026-10-15', status_proceso: 'TERMINADO', terminado: true, cancelado: false, eliminado: false, status_cobro_externo: 'PENDIENTE', estatus_pago_externo: null, estado_tarifa: s.estadoTarifa ?? 'resuelta', tipo_cobrado: s.tipo.replace(', ', ' + '), monto_calculado: s.pruebas.reduce((a, p) => a + (p.monto ?? 0), 0) || null, categoria_canon: s.pruebas[0].categoria || null, territorio_resuelto: s.pruebas[0].territorio || null }));
  const { data: insExps, error: eExp } = await sb.from('facturacion_expediente').insert(exps).select('id, id_externo');
  const expId = new Map((insExps ?? []).map(e => [String(e.id_externo).slice(PREFIJO.length), e.id as string]));
  const comps = seeds.flatMap(s => s.pruebas.map(p => ({ expediente_id: expId.get(s.ext), fuente: 'agenda', id_externo: `${PREFIJO}${s.ext}`, servicio: p.servicio, estado_prueba: 'APROBO', situacion: p.situacion ?? 'cobra', motivo: 'E2E', categoria: p.categoria || null, territorio: p.territorio || null, monto_calculado: p.monto, estado_tarifa: p.estadoTarifa ?? 'resuelta', fecha_resultado: p.fecha, fecha_resultado_fuente: 'agenda' })));
  const { data: insComps, error: eComp } = await sb.from('facturacion_componente').insert(comps).select('id, id_externo, servicio');
  const compId = (ext: string, servicio: string) => (insComps ?? []).find(c => c.id_externo === `${PREFIJO}${ext}` && c.servicio === servicio)?.id as string;
  ok(!eCli && !eMap && !eTar && !eExp && !eComp && expId.size === seeds.length && (insComps ?? []).length === comps.length, `sembrado: 2 clientes mapeados, 3 tarifas, ${seeds.length} expedientes y ${comps.length} pruebas${[eCli, eMap, eTar, eExp, eComp].filter(Boolean).map(e => ' · ' + e!.message).join('')}`);

  const DB = await import('../src/lib/db/paquetes');
  const FA = await import('../src/lib/db/facturacion-agenda');
  const R = await import('../src/lib/facturacion-agenda/resumen');
  const consumosDe = async (nit = NIT) => { const l = await DB.listarPaquetes(nit); return l; };
  const cubiertosDe = async (ext: string, servicio: string) => { const { data } = await sb.from('paquete_consumo').select('id, revertido_en, paquete_linea:paquete_linea(paquete:paquete(correlativo))').eq('componente_id', compId(ext, servicio)); return (data ?? []) as unknown as Array<{ id: string; revertido_en: string | null; paquete_linea: { paquete: { correlativo: string } | null } | null }>; };
  const vigente = async (ext: string, servicio: string) => (await cubiertosDe(ext, servicio)).find(c => !c.revertido_en)?.paquete_linea?.paquete?.correlativo ?? null;

  // 1) vista previa + crear SIN confirmar la retroactiva → nada se descuenta
  const vp = await DB.vistaPreviaPaquete(NIT, '2026-10-01', null, [{ servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', cantidad: 4, precioUnitario: 450 }]);
  ok(vp.length === 1 && vp[0].candidatas === 5 && vp[0].tomaria === 4 && vp[0].pruebas.map(p => p.idExterno.slice(PREFIJO.length)).join(',') === 'C1,P1,P2,P3,P4', `vista previa: 5 pre empleo terminadas desde el 1-oct (C1, P1–P4 por fecha; sin la rutina ni la de setiembre), tomaría 4 (${vp[0]?.pruebas.map(p => p.idExterno.slice(PREFIJO.length)).join(',')})`);
  const c1 = await DB.crearPaquete({ nit: NIT, nombre: 'Paquete 4 polígrafos', fechaInicio: '2026-10-01', lineas: [{ servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', cantidad: 4, precioUnitario: 450 }] }, ACTOR);
  const l1 = (await consumosDe()).find(p => p.id === (c1.ok ? c1.id : ''));
  ok(c1.ok && c1.aplicado.consumidos === 0 && l1?.lineas[0].usadas === 0 && l1?.retroPendientes === 5 && l1?.umbralAviso === 5 && l1?.clienteId !== null, `crear sin confirmar la retroactiva: ${c1.ok ? c1.correlativo : c1.error} no descuenta nada (5 pruebas esperan confirmación), umbral por defecto 5, cliente enlazado`);
  // 2) confirmar → FIFO por fecha de resultado: C1 (4-oct), P1, P2, P3; P4 queda a tarifa
  const conf = await DB.confirmarRetroactivo(c1.ok ? c1.id : '', ACTOR);
  const A1 = (await consumosDe()).find(p => p.id === (c1.ok ? c1.id : ''))!;
  ok(conf.ok && conf.aplicado.consumidos === 4 && A1.lineas[0].usadas === 4 && A1.lineas[0].remanente === 0 && A1.estado === 'agotado' && (await vigente('C1', 'POLIGRAFO')) === A1.correlativo && (await vigente('P3', 'POLIGRAFO')) === A1.correlativo && (await vigente('P4', 'POLIGRAFO')) === null && (await vigente('R1', 'POLIGRAFO')) === null && (await vigente('V1', 'POLIGRAFO')) === null && (await vigente('S1', 'SOCIOECONOMICO')) === null, `confirmar: 4 descontadas por fecha (C1, P1, P2, P3) → ${A1.correlativo} agotado; la 5.ª (P4) va a la cola a tarifa; la rutina, la anterior al inicio y el socio no descuentan`);
  const { data: evA } = await sb.from('cobranza_evento').select('comentario').eq('cliente_id', cliA).eq('tipo', 'cambio_condicion');
  ok((evA ?? []).some(e => /agotado: Poligrafo pre empleo 0 de 4/.test(String(e.comentario))), `aviso «agotado» en el historial de cobranza (033): ${(evA ?? []).map(e => e.comentario).join(' | ')}`);
  // 3) segundo paquete (FIFO entre dos): P4 cae en el nuevo; aviso «por agotarse» (umbral 5 ≥ remanente 1)
  const c2 = await DB.crearPaquete({ nit: NIT, nombre: 'Paquete 2 polígrafos', fechaInicio: '2026-10-01', retroactivoConfirmado: true, lineas: [{ servicio: 'POLIGRAFO', categoria: 'PRE EMPLEO', cantidad: 2, precioUnitario: 440 }] }, ACTOR);
  const A2 = (await consumosDe()).find(p => p.id === (c2.ok ? c2.id : ''))!;
  const { data: evB } = await sb.from('cobranza_evento').select('comentario').eq('cliente_id', cliA).eq('tipo', 'cambio_condicion');
  ok(c2.ok && c2.aplicado.consumidos === 1 && A2.lineas[0].usadas === 1 && A2.lineas[0].remanente === 1 && (await vigente('P4', 'POLIGRAFO')) === A2.correlativo && (await vigente('C1', 'POLIGRAFO')) === A1.correlativo && (evB ?? []).some(e => new RegExp(`${A2.correlativo} por agotarse: quedan 1 de 2`).test(String(e.comentario))), `FIFO entre dos paquetes: el más antiguo (${A1.correlativo}) ya estaba lleno, P4 cae en ${A2.correlativo} (1 de 2); aviso «por agotarse: quedan 1 de 2» en cobranza`);
  // 4) vencido no descuenta
  const c3 = await DB.crearPaquete({ nit: NIT, nombre: 'Paquete socios vencido', fechaInicio: '2026-08-01', venceEn: '2026-09-30', retroactivoConfirmado: true, lineas: [{ servicio: 'SOCIOECONOMICO', categoria: 'PRE EMPLEO', cantidad: 5, precioUnitario: 650 }] }, ACTOR);
  const A3 = (await consumosDe()).find(p => p.id === (c3.ok ? c3.id : ''))!;
  ok(c3.ok && c3.aplicado.consumidos === 0 && A3.estado === 'vencido' && A3.lineas[0].remanente === 5 && (await vigente('S1', 'SOCIOECONOMICO')) === null && (await vigente('C1', 'SOCIOECONOMICO')) === null, `paquete vencido (30-sep): queda «vencido» y no descuenta los socios del 10 y 12 de octubre (remanente 5)`);
  // 5) psicométrica con paquete descuenta; la del otro cliente sigue excluida
  const c4 = await DB.crearPaquete({ nit: NIT, nombre: 'Paquete psicométricas', fechaInicio: '2026-10-01', retroactivoConfirmado: true, lineas: [{ servicio: 'PSICOMETRICAS', categoria: 'UNICA', cantidad: 2, precioUnitario: 120 }] }, ACTOR);
  const A4 = (await consumosDe()).find(p => p.id === (c4.ok ? c4.id : ''))!;
  ok(c4.ok && c4.aplicado.consumidos === 1 && (await vigente('PS1', 'PSICOMETRICAS')) === A4.correlativo && (await vigente('PS2', 'PSICOMETRICAS')) === null && A4.lineas[0].remanente === 1, 'psicométrica: la del cliente con paquete descuenta (categoría UNICA); la del otro cliente queda excluida como hoy');

  // 6) cola SQL = TS: cubiertas fuera; listos = R1, V1, S1, C1-socio (P4 cubierta por A2)
  const { data: res } = await sb.rpc('facturacion_agenda_resumen', { p_fuente: 'agenda' });
  const rr = res as { grupos: Array<{ nit_resuelto: string; listos: number; total_sin_iva: number | string }>; cubiertas?: Array<{ nit_resuelto: string; cubiertas: number }>; excluidos: number };
  const gA = rr.grupos.find(g => g.nit_resuelto === NIT);
  const cubA = Number(rr.cubiertas?.find(c => c.nit_resuelto === NIT)?.cubiertas ?? 0);
  const locales = await FA.listarExpedientesLocal({ nit: NIT });
  const gTs = R.agruparPorCliente(locales)[0];
  const enColaTs = locales.flatMap(e => M.pruebasEnCola(e)).map(p => p.idExterno.slice(PREFIJO.length) + ':' + p.servicio).sort().join(',');
  const cubTs = locales.flatMap(e => M.pruebasCubiertas(e));
  ok(!!gA && Number(gA.listos) === 4 && Number(gA.total_sin_iva) === 2150 && cubA === 6 && gTs.listos === 4 && gTs.totalSinIva === 2150 && cubTs.length === 6 && enColaTs === 'C1:SOCIOECONOMICO,R1:POLIGRAFO,S1:SOCIOECONOMICO,V1:POLIGRAFO', `cola: SQL listos ${gA?.listos} / Q${gA?.total_sin_iva} y ${cubA} cubiertas = TS listos ${gTs?.listos} / Q${gTs?.totalSinIva} y ${cubTs.length} cubiertas; en cola: ${enColaTs}`);
  ok(cubTs.every(p => !!p.cubiertaPor?.correlativo && p.cubiertaPor.precioUnitario > 0) && locales.find(e => e.idExterno.endsWith('PS1'))!.pruebas[0].cubiertaPor?.correlativo === A4.correlativo && R.vigente(locales.find(e => e.idExterno.endsWith('PS1'))!), 'las pruebas cubiertas traen el paquete y el precio unitario; la psicométrica cubierta se ve en el grupo (vigente)');
  // paridad de lineaCubre con SQL
  const casos: Array<[string, string, string | null, string, string, string]> = [['POLIGRAFO', 'PRE EMPLEO', null, 'POLIGRAFO', 'PRE EMPLEO', 'METROPOLITANA'], ['POLIGRAFO', 'PRE EMPLEO', null, 'POLIGRAFO', 'RUTINA', ''], ['POLIGRAFO', 'PRE EMPLEO', 'DEPARTAMENTAL', 'POLIGRAFO', 'PRE EMPLEO', 'METROPOLITANA'], ['PSICOMETRICAS', 'UNICA', 'UNICA', 'PSICOMETRICAS', '', ''], ['SOCIOECONOMICO', 'PRE EMPLEO', null, 'POLIGRAFO', 'PRE EMPLEO', ''], ['poligrafo ', 'pre empleo', 'metropolitana', 'POLIGRAFO', 'PRE EMPLEO', 'METROPOLITANA']];
  let iguales = 0;
  for (const [ls, lc, lt, cs, cc, ct] of casos) { const { data } = await sb.rpc('paquete_linea_cubre', { p_servicio: ls, p_categoria: lc, p_territorio: lt, c_servicio: cs, c_categoria: cc, c_territorio: ct }); if (data === P.lineaCubre({ servicio: ls, categoria: lc, territorio: lt }, { servicio: cs, categoria: cc, territorio: ct })) iguales++; }
  ok(iguales === casos.length, `paridad lineaCubre TS = paquete_linea_cubre SQL en ${iguales}/${casos.length} casos`);

  // 7) un componente cubierto no entra a un detalle
  const det = await sb.rpc('detalle_facturacion_crear_pruebas', { p_actor: ACTOR, p_componente_ids: [compId('P1', 'POLIGRAFO')], p_notas: null });
  const detOk = await sb.rpc('detalle_facturacion_crear_pruebas', { p_actor: ACTOR, p_componente_ids: [compId('R1', 'POLIGRAFO')], p_notas: null });
  ok(!!det.error && /PRUEBA_CUBIERTA_POR_PAQUETE/.test(det.error.message) && !detOk.error, `crear detalle: con una prueba cubierta → ${det.error?.message.split(':')[0]}; con la rutina (a tarifa) sí se crea`);
  if (!detOk.error) await sb.rpc('detalle_facturacion_anular', { p_actor: ACTOR, p_id: (detOk.data as { id: string }).id, p_motivo: 'validador' });

  // 8) reversión: P2 pasa a pendiente → su consumo se revierte (la fila queda con motivo) y A1 vuelve a activo con remanente 1
  await sb.from('facturacion_componente').update({ situacion: 'pendiente', motivo: 'la Agenda corrigió el resultado' }).eq('id', compId('P2', 'POLIGRAFO'));
  const ap = await DB.aplicarPaquetes(NIT, ACTOR);
  const A1b = (await consumosDe()).find(p => p.id === A1.id)!;
  const cP2 = await cubiertosDe('P2', 'POLIGRAFO');
  ok(!!ap && ap.revertidos === 1 && cP2.length === 1 && !!cP2[0].revertido_en && A1b.lineas[0].remanente === 1 && A1b.estado === 'activo', `reversión: P2 pasó a pendiente → consumo revertido (fila conservada), ${A1.correlativo} vuelve a activo con remanente 1`);
  const { data: motivo } = await sb.from('paquete_consumo').select('motivo_reversion').eq('id', cP2[0]?.id).maybeSingle();
  ok(/la prueba pasó a pendiente/.test(String((motivo as { motivo_reversion?: string } | null)?.motivo_reversion)), `motivo de la reversión: «${(motivo as { motivo_reversion?: string } | null)?.motivo_reversion}»`);

  // 9) dos syncs a la vez: una prueba nueva (P5) → un solo consumo
  const { data: p5e } = await sb.from('facturacion_expediente').insert({ ...exps[1], id_externo: `${PREFIJO}P5`, persona: 'Pepe Cinco' }).select('id').single();
  const { data: p5c } = await sb.from('facturacion_componente').insert({ ...comps[2], expediente_id: (p5e as { id: string }).id, id_externo: `${PREFIJO}P5`, fecha_resultado: d('2026-10-20') }).select('id').single();
  const [r1, r2] = await Promise.all([sb.rpc('paquete_aplicar_consumos', { p_nit: NIT, p_fuente: 'agenda', p_hoy: null, p_actor: 'sync-a' }), sb.rpc('paquete_aplicar_consumos', { p_nit: NIT, p_fuente: 'agenda', p_hoy: null, p_actor: 'sync-b' })]);
  const { count: nP5 } = await sb.from('paquete_consumo').select('id', { count: 'exact', head: true }).eq('componente_id', (p5c as { id: string }).id).is('revertido_en', null);
  const tot = Number((r1.data as { consumidos?: number })?.consumidos ?? 0) + Number((r2.data as { consumidos?: number })?.consumidos ?? 0);
  const { data: cP5 } = await sb.from('paquete_consumo').select('paquete_linea:paquete_linea(paquete:paquete(correlativo))').eq('componente_id', (p5c as { id: string }).id).is('revertido_en', null).maybeSingle();
  const pqP5 = (cP5 as unknown as { paquete_linea: { paquete: { correlativo: string } | null } | null } | null)?.paquete_linea?.paquete?.correlativo ?? null;
  ok(!r1.error && !r2.error && nP5 === 1 && tot === 1 && pqP5 === A1.correlativo, `dos aplicar en paralelo: P5 se descuenta UNA vez (consumidos ${tot}: ${JSON.stringify(r1.data)} / ${JSON.stringify(r2.data)}; errores ${r1.error?.message ?? '-'} / ${r2.error?.message ?? '-'}; consumos vigentes ${nP5}) y cae en ${A1.correlativo} (el más antiguo, que recuperó una unidad; quedó en ${pqP5})`);

  // 10) write-back: C1 (polígrafo cubierto + socio a tarifa) espera al socio; al facturar el socio el cierre escribe ambos números
  const cerr0 = await sb.rpc('facturacion_agenda_cerrar_parciales', { p_fuente: 'agenda' });
  const cerrados0 = ((cerr0.data ?? []) as Array<{ id_externo: string; no_factura: string }>).filter(x => x.id_externo.startsWith(PREFIJO));
  const { data: e1 } = await sb.from('facturacion_expediente').select('writeback_estado, no_factura, factura_id').eq('id', expId.get('P1')).maybeSingle();
  const eP1 = e1 as { writeback_estado: string | null; no_factura: string | null; factura_id: string | null } | null;
  ok(!cerr0.error && cerrados0.some(x => x.id_externo === `${PREFIJO}P1` && x.no_factura === A1.correlativo) && !cerrados0.some(x => x.id_externo === `${PREFIJO}C1`) && eP1?.writeback_estado === 'pendiente' && eP1?.no_factura === A1.correlativo && eP1?.factura_id === null, `cierre: P1 (todo cubierto) queda pendiente de escribir a la Agenda con «${eP1?.no_factura}»; C1 espera al socio a tarifa (${cerrados0.map(x => x.id_externo.slice(PREFIJO.length)).join(',')})`);
  const { data: fac } = await sb.from('facturas_clientes').insert({ airtable_id: 'recPQE2EF1', no_factura: `${PREFIJO}F1`, cliente_id: cliA, fecha_emision: '2026-10-20', total: 728, iva: 78, subtotal: 650, estado: 'EMITIDA' }).select('id').single();
  await sb.from('facturacion_componente').update({ factura_id: (fac as { id: string }).id, no_factura: `${PREFIJO}F1`, facturado_en: new Date().toISOString(), facturado_por: ACTOR }).eq('id', compId('C1', 'SOCIOECONOMICO'));
  await sb.from('facturacion_expediente').update({ writeback_estado: 'parcial', no_factura: `${PREFIJO}F1` }).eq('id', expId.get('C1'));
  await DB.editarPaquete(A1.id, { noFactura: `${PREFIJO}ANT` }, ACTOR);   // la factura del anticipo se enlaza después
  const cerr1 = await sb.rpc('facturacion_agenda_cerrar_parciales', { p_fuente: 'agenda' });
  const cerrados1 = ((cerr1.data ?? []) as Array<{ id_externo: string; no_factura: string }>).filter(x => x.id_externo.startsWith(PREFIJO));
  const loc = await FA.listarExpedientesLocal({ idsExternos: [`${PREFIJO}C1`, `${PREFIJO}P3`] });
  const wbC1 = M.facturasDelExpediente(loc.find(e => e.idExterno.endsWith('C1'))!), wbP3 = M.facturasDelExpediente(loc.find(e => e.idExterno.endsWith('P3'))!);
  const { data: e2 } = await sb.from('facturacion_expediente').select('writeback_estado, factura_id').eq('id', expId.get('C1')).maybeSingle();
  ok(!cerr1.error && cerrados1.some(x => x.id_externo === `${PREFIJO}C1`) && (e2 as { writeback_estado: string; factura_id: string | null } | null)?.writeback_estado === 'pendiente' && !!(e2 as { factura_id: string | null } | null)?.factura_id && wbC1.numero === `${PREFIJO}F1 / ${PREFIJO}ANT (${A1.correlativo})` && wbC1.montoSinIva === 1100 && wbP3.numero === `${PREFIJO}ANT (${A1.correlativo})` && wbP3.montoSinIva === 450, `al facturar el socio: C1 se cierra con la factura y la app escribe «${wbC1.numero}» (Q${wbC1.montoSinIva}); P3 solo cubierta → «${wbP3.numero}»`);

  // 11) producción 025: las cubiertas cuentan como producidas a su precio unitario y como «cubiertas», no como backlog
  const { data: prod } = await sb.rpc('facturacion_produccion_mensual', { p_desde: '2026-10-01', p_hasta: '2026-10-31', p_fuente: 'agenda' });
  const pc = ((prod as { por_cliente?: Array<Record<string, unknown>> })?.por_cliente ?? []).find(x => x.nit_resuelto === NIT);
  ok(!!pc && Number(pc.cubierta_n) === 6 && Number(pc.cubierta_q) === 450 * 4 + 440 + 120 && Number(pc.backlog_n) === 2 && Number(pc.terminado_n) === 9 && Number(pc.terminado_q) === 2360 + 650 + 400 + 650, `producción oct-2026 del cliente: ${pc?.cubierta_n} cubiertas por anticipo (Q${pc?.cubierta_q}), backlog ${pc?.backlog_n} (sin las cubiertas), terminadas ${pc?.terminado_n} por Q${pc?.terminado_q}`);

  // 12) cerrar paquete; detalle
  const cz = await DB.cerrarPaquete(A3.id, 'vencido sin renovación', ACTOR);
  const detA1 = await DB.getPaqueteDetalle(A1.id);
  ok(cz.ok && cz.paquete.estado === 'cerrado' && cz.paquete.cerradoMotivo === 'vencido sin renovación' && !!detA1 && detA1.consumos.filter(c => !c.revertidoEn).length === 4 && detA1.consumos.filter(c => c.revertidoEn).length === 1 && detA1.consumos.every(c => c.persona && c.fechaResultado) && detA1.paquete.noFactura === `${PREFIJO}ANT`, `cerrar con motivo; detalle de ${A1.correlativo}: 4 pruebas descontadas (persona, fecha, resultado) + 1 reversión; factura del anticipo enlazada`);

  if (!CONSERVAR) ok((await limpiar()) === 0, 'limpieza verificada: 0 expedientes PQE2E ni paquetes; consumos, facturas, eventos, mapeos, tarifas y clientes borrados');
  else console.log('  ⚪ --conservar: quedan los clientes PQ-E2E con sus expedientes y paquetes para el E2E en Chrome (borrar con --solo-limpiar)');
  console.log(`\n${pass} 🟢 / ${fail} 🔴`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
