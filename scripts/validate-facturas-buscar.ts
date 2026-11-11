/**
 * BUSCAR FACTURAS POR MONTO, RANGO Y ESTADO — validador.
 *
 *  A. Estático: la búsqueda corre en el servidor (page.tsx → buscarFacturas sin el mes), «pagadas» por la regla 026
 *     (facturaCobrada, nunca el texto crudo), criterios en la URL, chip con ✕, panel «Más filtros», CSV, atajo desde
 *     Identificar; sin diálogos del navegador; ayuda.
 *  B. Puro: el parser (`8000`, `8,000`, `Q8000`, `9450.50`, `8 mil`, `8000-10000`, `8000 a 10000`, `entre 8000 y 10000`;
 *     un número de más de 7 dígitos sin separador NO es monto), criterios ↔ URL, descripción, filtro (tolerancia, rango,
 *     estados, fechas, texto) y orden (cercanía / fecha) sobre facturas armadas a mano; consolidación de filas crudas
 *     (dos líneas suman, anuladas aparte, saldo de una parcial, cobro anulado no resta, NC activa resta).
 *  C. HIT (datos sembrados): facturas con «COBRADO » con espacio, dos líneas, parcial con cobro, anulada; cada caso contra
 *     `buscarFacturas` y «pagadas» contra la RPC facturacion_factura_cobrada (paridad TS = SQL).
 *
 * Uso: npx tsx scripts/validate-facturas-buscar.ts hit [--conservar | --solo-limpiar]   (--conservar deja las facturas BM-E2E para el E2E en Chrome)
 */
import fs from 'node:fs';
import path from 'node:path';
import type { CriteriosBusqueda, EstadoFila, FacturaBuscable } from '../src/lib/facturacion/buscar-monto';
import type { ResultadoBusqueda } from '../src/lib/db/facturas-buscar';

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
const NIT = '99990035K', PREFIJO = 'BM-E2E-';

(async () => {
  /* ───────────── A. Estático ───────────── */
  console.log('\nA. Estático');
  const pg = rd('src/app/(app)/facturacion/page.tsx'), srv = rd('src/lib/db/facturas-buscar.ts'), puro = rd('src/lib/facturacion/buscar-monto.ts'), lc = rd('src/components/facturas/list-client.tsx'), res = rd('src/components/facturas/buscar-resultados.tsx'), idc = rd('src/components/cobros/identificar-client.tsx');
  ok(/const criterios = criteriosDesdeParams\(uno\);/.test(pg) && /hayBusquedaServidor\(criterios\) \? \{ criterios, resultado: await buscarFacturas\(criterios\) \} : null/.test(pg) && !/buscarFacturas\([^)]*mes/.test(pg), 'page.tsx: criterios desde la URL y búsqueda en el servidor sobre todas las facturas (sin el filtro de mes)');
  ok(/import \{ esLineaInactiva, estadoFacturaCanon, facturaCobrada \} from '@\/lib\/facturacion-agenda\/estado-factura'/.test(srv) && /facturaCobrada\(estados\)/.test(srv) && !/=== 'COBRADO'|'COBRADO '/.test(srv) && /estadoFacturaCanon\(c\.estado_cobro\) === 'ANULADO'/.test(srv) && /!== 'Activa'/.test(srv) && /fetchAll<FilaFactura>\('facturas_clientes'/.test(srv) && /TOPE_FILAS_BUSQUEDA = 500/.test(srv), 'servidor: «pagada» = regla 026 (facturaCobrada, sin comparar el texto crudo); cobrado solo con cobros activos; NC activas restan; suma por no_factura; tope de filas');
  ok(/export function interpretarBusqueda/.test(puro) && /sinComas\.length > 7\) return null/.test(puro) && /TOLERANCIA_DEFAULT = 1/.test(puro) && /case 'pagadas': if \(esAnulada \|\| !f\.cobrada\) return false/.test(puro) && /default: if \(esAnulada\) return false/.test(puro) && !/from 'node:|server-only/.test(puro), 'puro: parser con tope de 7 dígitos, tolerancia ±Q1, pagadas por `cobrada`, todas sin anuladas; sin node');
  ok(/onKeyDown=\{e => \{ if \(e\.key === 'Enter'\) buscarEnServidor\(\); \}\}/.test(lc) && /data-accion="buscar-monto"/.test(lc) && /data-accion="mas-filtros"/.test(lc) && /<ChipBusqueda criterios=\{busqueda\.criterios\} \/>/.test(lc) && /<ResultadosBusqueda resultado=\{busqueda\.resultado\} criterios=\{busqueda\.criterios\} \/>/.test(lc) && /\{!busqueda && (!cartera && )?<>/.test(lc) && /data-chip-busqueda/.test(res) && /data-accion="quitar-busqueda"/.test(res) && /data-accion="exportar-csv"/.test(res) && /paramsDeCriterios\(c \?\? CRITERIOS_VACIOS, base\)/.test(res) && !/window\.(confirm|alert|prompt)/.test(lc + res), 'Finanzas: Enter o botón manda el monto al servidor, chip con ✕, Más filtros, resultados con CSV, criterios a la URL conservando tab y mes; sin diálogos del navegador');
  ok(/data-accion="buscar-facturas-monto"/.test(idc) && /enlaceBusquedaFacturas\(monto, base\)/.test(idc) && /Buscar por monto:/.test(rd('supabase/ayuda_facturacion_buscar_por_monto.sql')) && !fs.existsSync('supabase/migrations/033_facturas_buscar.sql'), 'atajo desde Cobros → Identificar (monto del depósito, ±Q1 por defecto, pendientes); línea en la ayuda; sin migración');

  /* ───────────── B. Puro ───────────── */
  console.log('\nB. Puro');
  const P = await import('../src/lib/facturacion/buscar-monto');
  const i = (s: string) => JSON.stringify(P.interpretarBusqueda(s));
  ok(i('8000') === '{"tipo":"monto","monto":8000}' && i('8,000') === '{"tipo":"monto","monto":8000}' && i('Q8000') === '{"tipo":"monto","monto":8000}' && i('Q 9,450.50') === '{"tipo":"monto","monto":9450.5}' && i('8 mil') === '{"tipo":"monto","monto":8000}' && i('8.5mil') === '{"tipo":"monto","monto":8500}' && i('q.8,000') === '{"tipo":"monto","monto":8000}', 'parser monto: 8000, 8,000, Q8000, Q 9,450.50, 8 mil, 8.5mil, q.8,000');
  ok(i('8000-10000') === '{"tipo":"rango","desde":8000,"hasta":10000}' && i('8000 a 10000') === '{"tipo":"rango","desde":8000,"hasta":10000}' && i('entre 8000 y 10000') === '{"tipo":"rango","desde":8000,"hasta":10000}' && i('10000 - 8000') === '{"tipo":"rango","desde":8000,"hasta":10000}' && i('Q8,000 hasta Q10,000') === '{"tipo":"rango","desde":8000,"hasta":10000}' && i('8 mil a 10 mil') === '{"tipo":"rango","desde":8000,"hasta":10000}', 'parser rango: 8000-10000, 8000 a 10000, entre 8000 y 10000, invertido, con Q y comas, en miles');
  ok(i('20260001234') === '{"tipo":"texto","texto":"20260001234"}' && i('12345678') === '{"tipo":"texto","texto":"12345678"}' && i('1234567') === '{"tipo":"monto","monto":1234567}' && i('ACME') === '{"tipo":"texto","texto":"ACME"}' && i('FAC 8000') === '{"tipo":"texto","texto":"FAC 8000"}' && i('   ') === '{"tipo":"vacio"}' && i('0') === '{"tipo":"texto","texto":"0"}', 'parser texto: más de 7 dígitos sin separador = número de factura; letras = texto; vacío; 0 no es monto');
  const c1 = P.criteriosDesdeParams(k => ({ monto: '9450', estado: 'pendientes', sobre: 'saldo', edesde: '2026-01-01', ehasta: '2025-12-01', q: 'acme' } as Record<string, string>)[k] ?? null);
  const c2 = P.criteriosDesdeParams(k => ({ desde: '10000', hasta: '8,000', tol: '5', estado: 'raro', sobre: 'x' } as Record<string, string>)[k] ?? null);
  ok(c1.monto === 9450 && c1.tol === 1 && c1.estado === 'pendientes' && c1.sobre === 'saldo' && c1.emisionDesde === '2025-12-01' && c1.emisionHasta === '2026-01-01' && c1.texto === 'acme' && c2.monto === undefined && c2.tol === undefined && c2.desde === 8000 && c2.hasta === 10000 && c2.estado === 'todas' && c2.sobre === 'total', 'URL → criterios: tolerancia ±1 por defecto, fechas y rango invertidos se ordenan, valores inválidos se ignoran');
  ok(P.paramsDeCriterios(c1, new URLSearchParams('tab=cobradas&mes=2026-10&monto=1')) === '?tab=cobradas&mes=2026-10&monto=9450&sobre=saldo&estado=pendientes&edesde=2025-12-01&ehasta=2026-01-01&q=acme' && P.paramsDeCriterios(P.CRITERIOS_VACIOS) === '' && P.paramsDeCriterios({ ...P.CRITERIOS_VACIOS, desde: 8000, hasta: 10000 }) === '?desde=8000&hasta=10000' && P.paramsDeCriterios({ ...P.CRITERIOS_VACIOS, monto: 8000, tol: 1 }) === '?monto=8000', 'criterios → URL: conserva tab y mes, omite los valores por defecto (tol 1, total, todas)');
  ok(P.describirCriterios({ ...P.CRITERIOS_VACIOS, desde: 8000, hasta: 10000 }) === 'Monto entre Q8,000 y Q10,000 · todas' && P.describirCriterios(c1) === 'Monto Q9,450 ±Q1 · pendientes · sobre saldo pendiente · emitidas del 01/12/2025 al 01/01/2026 · «acme»' && P.describirCriterios({ ...P.CRITERIOS_VACIOS, estado: 'pagadas' }) === 'pagadas', 'chip: «Monto entre Q8,000 y Q10,000 · todas», «Monto Q9,450 ±Q1 · pendientes · sobre saldo pendiente · emitidas …»');
  const mk = (nf: string, total: number, estado: EstadoFila, extra: Partial<FacturaBuscable> = {}): FacturaBuscable => ({ noFactura: nf, fechaEmision: '2026-05-10', clienteNombre: 'ACME S.A.', nit: '1234567-8', total, subtotal: Math.round(total / 1.12 * 100) / 100, saldo: estado === 'cobrada' || estado === 'anulada' ? 0 : total, cobrada: estado === 'cobrada', estado, ...extra });
  const F = [mk('A1', 8000, 'cobrada'), mk('A2', 8000.6, 'emitida'), mk('A3', 7998, 'pendiente', { fechaEmision: '2026-06-01' }), mk('A4', 9000, 'parcial', { saldo: 4000 }), mk('A5', 9000, 'anulada'), mk('A6', 10000, 'cobrada', { clienteNombre: 'Génesis', nit: '555' }), mk('A7', 10000.5, 'cobrada'), mk('A8', 12000, 'refacturada')];
  const q = (c: Partial<CriteriosBusqueda>) => P.ordenarResultados(F.filter(f => P.coincideCriterios(f, { ...P.CRITERIOS_VACIOS, ...c })), { ...P.CRITERIOS_VACIOS, ...c }).map(f => f.noFactura).join(',');
  ok(q({ monto: 8000, tol: 1 }) === 'A1,A2' && q({ monto: 8000, tol: 2 }) === 'A1,A2,A3' && q({ monto: 8000, tol: 0 }) === 'A1' && q({ monto: 9000 }) === 'A4', 'monto exacto con tolerancia: ±1 trae 8000 y 8000.60 (no 7998); ±2 también 7998; ±0 solo exacto; ordenados por cercanía');
  ok(q({ desde: 8000, hasta: 10000 }) === 'A1,A2,A4,A6' && q({ desde: 8000, hasta: 10000, estado: 'anuladas' }) === 'A5' && q({ desde: 8000, hasta: 10000, estado: 'pagadas' }) === 'A1,A6' && q({ desde: 8000, hasta: 10000, estado: 'pendientes' }) === 'A2' && q({ desde: 8000, hasta: 10000, estado: 'parcial' }) === 'A4' && q({ desde: 8000, hasta: 10000, sobre: 'saldo' }) === 'A2' && q({ desde: 8000, hasta: 10000, sobre: 'subtotal' }) === 'A4,A6,A7' && q({ desde: 7000, hasta: 10000 }) === 'A3,A1,A2,A4,A6', 'rango: todas excluye anuladas y refacturadas (salvo estado anuladas) y 7,998 queda fuera de 8,000–10,000; pagadas / pendientes / parcial; sobre saldo (la parcial con saldo 4,000 no entra); sobre subtotal (10,000.50 entra: 8,929); orden por fecha desc');
  ok(q({ desde: 7000, hasta: 10000, emisionDesde: '2026-06-01' }) === 'A3' && q({ desde: 8000, hasta: 10000, emisionDesde: '2026-06-01' }) === '' && q({ desde: 8000, hasta: 10000, texto: 'genesis' }) === 'A6' && q({ texto: '555' }) === 'A6' && q({ desde: 8000, hasta: 10000, emisionHasta: '2026-05-31', texto: 'acme' }) === 'A1,A2,A4', 'fechas de emisión y texto (cliente sin tildes, NIT) combinados con el rango');
  const B = await import('../src/lib/db/facturas-buscar');
  const lin = (id: string, nf: string, total: number, estado: string, extra: Record<string, unknown> = {}) => ({ id, airtable_id: 'rec' + id, no_factura: nf, cliente_id: 'c1', fecha_emision: '2026-04-10', subtotal: Math.round(total / 1.12 * 100) / 100, iva: null, total, estado, cliente: { airtable_id: 'recC1', razon_social: 'ACME, S.A.', nombre_empresa: 'ACME', nit: '1234567-8' }, ...extra });
  const cons = B.consolidarParaBusqueda(
    [lin('l1', 'F-1', 5000, 'COBRADO '), lin('l2', 'F-1', 3000, 'COBRADO '), lin('l3', 'F-2', 9000, 'COBRADO PARCIAL '), lin('l4', 'F-3', 7000, 'ANULADO'), lin('l5', 'F-3', 7000, 'EMITIDA'), lin('l6', 'F-4', 2000, 'COBRADO '), lin('l7', 'F-4', 1000, 'EMITIDA'), lin('l8', 'F-5', 500, 'REFACTURADO'), lin('l9', 'F-6', 1200, 'PENDIENTE ')],
    [{ factura_id: 'l3', monto_cobrado: 4000, fecha_cobro: '2026-05-01', estado_cobro: 'Activo' }, { factura_id: 'l3', monto_cobrado: 1000, fecha_cobro: '2026-05-20', estado_cobro: null }, { factura_id: 'l3', monto_cobrado: 9999, fecha_cobro: '2026-05-25', estado_cobro: 'Anulado' }, { factura_id: 'l1', monto_cobrado: 8000, fecha_cobro: '2026-04-30', estado_cobro: 'Activo' }],
    [{ factura_id: 'l5', monto: 700, estado: 'Activa' }, { factura_id: 'l5', monto: 100, estado: 'Anulada' }],
  );
  const by = Object.fromEntries(cons.map(f => [f.noFactura + ':' + f.estado, f]));
  const f1 = by['F-1:cobrada'], f2 = by['F-2:parcial'], f3 = by['F-3:emitida'], f3a = by['F-3:anulada'], f4 = by['F-4:emitida'], f5 = by['F-5:refacturada'], f6 = by['F-6:pendiente'];
  ok(!!f1 && f1.total === 8000 && f1.lineas === 2 && f1.cobrada && f1.cobrado === 8000 && f1.saldo === 0 && f1.fechaCobro === '2026-04-30' && f1.id === 'recl1' && f1.clienteNombre === 'ACME' && f1.nit === '1234567-8', 'consolidación: una factura con dos líneas suma 8,000, «COBRADO » con espacio cuenta como pagada (026), cobrado y fecha de cobro, id de la línea principal');
  ok(!!f2 && f2.cobrado === 5000 && f2.saldo === 4000 && f2.fechaCobro === '2026-05-20' && !f2.cobrada, 'parcial: cobrado = cobros activos (el anulado de 9,999 no resta), saldo 4,000, última fecha de cobro del activo');
  ok(!!f3 && f3.total === 7000 && f3.lineas === 1 && f3.saldo === 6300 && !!f3a && f3a.total === 7000 && f3a.saldo === 0 && cons.filter(f => f.noFactura === 'F-3').length === 2, 'la línea anulada va aparte y no suma a la viva; la NC activa de 700 resta al saldo (la anulada no)');
  ok(!!f4 && f4.total === 3000 && !f4.cobrada && f4.estado === 'emitida' && !!f5 && f5.estado === 'refacturada' && !!f6 && f6.estado === 'pendiente' && !f6.cobrada, 'una línea cobrada y otra emitida → NO pagada (026); refacturada y pendiente clasificadas');
  const rr = B.resultadoDe(cons, { ...P.CRITERIOS_VACIOS, monto: 8000 });
  ok(rr.cantidad === 1 && rr.filas[0].noFactura === 'F-1' && rr.filas[0].diff === 0 && rr.suma === 8000 && rr.universo === 7 && !rr.limitado, 'resultadoDe: totales (cantidad, suma), diferencia contra el monto, universo');

  /* ───────────── C. HIT ───────────── */
  console.log(`\nC. HIT${SOLO_LIMPIAR ? ' (--solo-limpiar)' : ''}`);
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const limpiar = async () => {
    const { data: fs2 } = await sb.from('facturas_clientes').select('id').like('no_factura', `${PREFIJO}%`);
    const ids = (fs2 ?? []).map(f => f.id as string);
    if (ids.length) { await sb.from('cobros_clientes').delete().in('factura_id', ids); await sb.from('notas_credito').delete().in('factura_id', ids); await sb.from('facturas_clientes').delete().in('id', ids); }
    await sb.from('clientes').delete().eq('nit', NIT);
    const { count } = await sb.from('facturas_clientes').select('id', { count: 'exact', head: true }).like('no_factura', `${PREFIJO}%`);
    return count ?? 0;
  };
  if (SOLO_LIMPIAR) { ok((await limpiar()) === 0, 'limpieza: 0 facturas BM-E2E; cobros, NC y cliente borrados'); console.log(`\n${pass} 🟢 / ${fail} 🔴`); process.exit(fail ? 1 : 0); }
  await limpiar();
  const { data: cli, error: eCli } = await sb.from('clientes').insert({ airtable_id: 'sbwBME2E01', nombre_empresa: 'BM E2E BUSCAR', razon_social: 'BM E2E BUSCAR, S.A.', nit: NIT, activo: true }).select('id').single();
  const filas = [
    { no_factura: `${PREFIJO}001`, total: 5000, subtotal: 4464.29, iva: 535.71, estado: 'COBRADO ' }, { no_factura: `${PREFIJO}001`, total: 3000, subtotal: 2678.57, iva: 321.43, estado: 'COBRADO ' },
    { no_factura: `${PREFIJO}002`, total: 9000, subtotal: 8035.71, iva: 964.29, estado: 'COBRADO PARCIAL ' },
    { no_factura: `${PREFIJO}003`, total: 8000.6, subtotal: 7143.39, iva: 857.21, estado: 'EMITIDA' },
    { no_factura: `${PREFIJO}004`, total: 8000, subtotal: 7142.86, iva: 857.14, estado: 'ANULADO' },
    { no_factura: `${PREFIJO}005`, total: 2000, subtotal: 1785.71, iva: 214.29, estado: 'COBRADO ' }, { no_factura: `${PREFIJO}005`, total: 1000, subtotal: 892.86, iva: 107.14, estado: 'EMITIDA' },
  ].map((f, i) => ({ ...f, airtable_id: `recBME2E${String(i + 1).padStart(3, '0')}`, cliente_id: cli?.id, fecha_emision: '2026-03-15' }));
  const { data: ins, error: eIns } = await sb.from('facturas_clientes').insert(filas).select('id, no_factura, total');
  const idDe = (nf: string, total?: number) => (ins ?? []).find(r => r.no_factura === nf && (total === undefined || Number(r.total) === total))?.id as string;
  const { error: eCob } = await sb.from('cobros_clientes').insert([
    { factura_id: idDe(`${PREFIJO}002`), monto_cobrado: 4000, monto_cobro_gtq: 4000, fecha_cobro: '2026-04-02', estado_cobro: 'Activo', metodo: 'Transferencia', estado: 'Pendiente' },
    { factura_id: idDe(`${PREFIJO}002`), monto_cobrado: 9999, monto_cobro_gtq: 9999, fecha_cobro: '2026-04-05', estado_cobro: 'Anulado', metodo: 'Transferencia', estado: 'Pendiente' },
    { factura_id: idDe(`${PREFIJO}001`, 5000), monto_cobrado: 8000, monto_cobro_gtq: 8000, fecha_cobro: '2026-03-30', estado_cobro: 'Activo', metodo: 'Transferencia', estado: 'Pendiente' },
  ]);
  ok(!eCli && !eIns && !eCob && (ins ?? []).length === 7, `sembrado: cliente ${NIT}, 7 líneas (5 facturas) y 3 cobros${eCli ? ' · ' + eCli.message : ''}${eIns ? ' · ' + eIns.message : ''}${eCob ? ' · ' + eCob.message : ''}`);
  const solo = (r: ResultadoBusqueda) => r.filas.filter(f => f.noFactura.startsWith(PREFIJO)).map(f => `${f.noFactura.slice(PREFIJO.length)}:${f.estado}`).join(',');
  const r1 = await B.buscarFacturas({ ...P.CRITERIOS_VACIOS, monto: 8000 });
  ok(solo(r1) === '001:cobrada,003:emitida' && r1.filas.find(f => f.noFactura === `${PREFIJO}001`)!.diff === 0 && r1.filas.find(f => f.noFactura === `${PREFIJO}003`)!.diff === 0.6 && !r1.error, `monto exacto 8,000 ±1: la de dos líneas (5,000 + 3,000) y la de 8,000.60; la anulada de 8,000 no (${solo(r1)})`);
  const r2 = await B.buscarFacturas({ ...P.CRITERIOS_VACIOS, desde: 1000, hasta: 9500, texto: 'BM E2E' });
  ok(solo(r2) === '001:cobrada,002:parcial,003:emitida,005:emitida', `rango 1,000–9,500 del cliente de prueba: 4 facturas, sin la anulada (${solo(r2)})`);
  const r3 = await B.buscarFacturas({ ...P.CRITERIOS_VACIOS, desde: 1000, hasta: 9500, texto: 'BM E2E', estado: 'anuladas' });
  const r4 = await B.buscarFacturas({ ...P.CRITERIOS_VACIOS, desde: 1000, hasta: 9500, texto: 'BM E2E', estado: 'pagadas' });
  const r5 = await B.buscarFacturas({ ...P.CRITERIOS_VACIOS, desde: 1000, hasta: 9500, texto: 'BM E2E', estado: 'parcial' });
  const r6 = await B.buscarFacturas({ ...P.CRITERIOS_VACIOS, desde: 1000, hasta: 9500, texto: 'BM E2E', estado: 'pendientes' });
  ok(solo(r3) === '004:anulada' && solo(r4) === '001:cobrada' && solo(r5) === '002:parcial' && solo(r6) === '003:emitida,005:emitida', `estados: anuladas (${solo(r3)}), pagadas (${solo(r4)}: «COBRADO » con espacio; la 005 con una línea emitida no), parcial (${solo(r5)}), pendientes (${solo(r6)})`);
  const p2 = r5.filas.find(f => f.noFactura === `${PREFIJO}002`)!;
  const r7 = await B.buscarFacturas({ ...P.CRITERIOS_VACIOS, monto: 5000, sobre: 'saldo', texto: 'BM E2E' });
  ok(p2.cobrado === 4000 && p2.saldo === 5000 && p2.fechaCobro === '2026-04-02' && solo(r7) === '002:parcial', `saldo de la parcial: 9,000 − 4,000 cobrados (el cobro anulado no resta) = 5,000; búsqueda sobre saldo la encuentra (${solo(r7)})`);
  // paridad con la RPC 026
  const { data: rpc } = await sb.rpc('facturacion_factura_cobrada', { p_no_factura: `${PREFIJO}001` });
  const { data: rpc5 } = await sb.rpc('facturacion_factura_cobrada', { p_no_factura: `${PREFIJO}005` });
  const { data: rpc4 } = await sb.rpc('facturacion_factura_cobrada', { p_no_factura: `${PREFIJO}004` });
  ok(rpc === true && rpc5 === false && rpc4 === false && r4.filas.some(f => f.noFactura === `${PREFIJO}001`) && !r4.filas.some(f => f.noFactura === `${PREFIJO}005`), '«pagadas» = facturacion_factura_cobrada (026) en SQL: 001 true, 005 false, 004 false, igual que el TS');
  // paridad global: todas las cobradas del universo según TS == según la RPC (muestra de 60)
  const todas = await B.facturasParaBusqueda();
  const muestra = todas.filter(f => f.estado !== 'anulada' && f.estado !== 'refacturada').slice(0, 60);
  let iguales = 0;
  for (const f of muestra) { const { data } = await sb.rpc('facturacion_factura_cobrada', { p_no_factura: f.noFactura }); if (data === f.cobrada) iguales++; }
  ok(muestra.length > 0 && iguales === muestra.length, `paridad TS = SQL en ${iguales}/${muestra.length} facturas de HIT (cobrada según 026)`);
  const r8 = await B.buscarFacturas({ ...P.CRITERIOS_VACIOS, desde: 1000, hasta: 9500, texto: 'BM E2E', emisionDesde: '2026-04-01' });
  const r9 = await B.buscarFacturas({ ...P.CRITERIOS_VACIOS, desde: 1000, hasta: 9500, texto: 'BM E2E', emisionDesde: '2026-03-01', emisionHasta: '2026-03-31' });
  ok(r8.cantidad === 0 && solo(r9) === '001:cobrada,002:parcial,003:emitida,005:emitida' && r9.suma === 8000 + 9000 + 8000.6 + 3000 && r9.sumaSaldo === 0 + 5000 + 8000.6 + 3000, `fechas de emisión: fuera → 0; dentro → 4 con suma ${r9.suma} y saldo ${r9.sumaSaldo} (la 005 tiene una línea «COBRADO » sin cobro registrado: su saldo sigue en 3,000)`);
  if (!CONSERVAR) ok((await limpiar()) === 0, 'limpieza verificada: 0 facturas BM-E2E; cobros y cliente borrados');
  else console.log('  ⚪ --conservar: quedan las 5 facturas BM-E2E (7 líneas, 3 cobros) para el E2E en Chrome (borrar con --solo-limpiar)');
  console.log(`\n${pass} 🟢 / ${fail} 🔴`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
