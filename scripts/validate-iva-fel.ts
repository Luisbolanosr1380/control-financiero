/**
 * IVA · REGLA FEL (030) — validador.
 *  A. Puro (`totalesFel` / `precioConIva`): GTL 16 × 401.79 + 12 × 424.11 → total 12,900.00, base 11,517.86, IVA 1,382.14;
 *     cada tarifa real → su precio redondo; base + IVA = total en 1,000 combinaciones aleatorias de las tarifas reales;
 *     `documentoDetalle` y `armarFactura` (dos centros de costo) cuadran línea por línea y la suma de las líneas = total.
 *  B. Estático: nadie aplica el 12 % sobre una suma (conIva solo sobre una tarifa suelta); la 030 recrea las RPC y hace el
 *     backfill solo de los detalles vivos.
 *  C. SQL (HIT): `fel_totales` da lo mismo que TS para GTL y para 200 combinaciones; `facturacion_agenda_resumen` trae
 *     total_con_iva.
 *
 * Uso: npx tsx scripts/validate-iva-fel.ts hit
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.argv[2] ?? 'hit').toLowerCase();
for (const line of fs.readFileSync(path.join(process.cwd(), BASE === 'hit' ? '.env.hit.vercel' : '.env.local'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('='); process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  🟢 ${m}`); } else { fail++; console.log(`  🔴 ${m}`); } };
const rd = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Tarifas reales de Golden (sin IVA, 2 decimales) y su precio con IVA esperado. */
const TARIFAS: Array<[number, number]> = [[44, 49.28], [44.64, 50], [89.29, 100], [99.91, 111.9], [137.98, 154.54], [156.25, 175], [160, 179.2], [172.48, 193.18], [176, 197.12], [178.57, 200], [223.21, 250], [246.4, 275.97], [250.8, 280.9], [264, 295.68], [267.86, 300], [290.18, 325], [308, 344.96], [312.4, 349.89], [312.5, 350], [320.32, 358.76], [325, 364], [330, 369.6], [334.4, 374.53], [334.82, 375], [338.8, 379.46], [344.96, 386.36], [350, 392], [352, 394.24], [353.76, 396.21], [357.14, 400], [369.6, 413.95], [374.53, 419.47], [375, 420], [379.46, 425], [380, 425.6], [394.24, 441.55], [396, 443.52], [400, 448], [401.79, 450], [424.11, 475], [440, 492.8], [443.52, 496.74], [446.43, 500], [450, 504], [468.16, 524.34], [468.75, 525], [475, 532], [484, 542.08], [491.07, 550], [492, 551.04], [492.8, 551.94], [517.44, 579.53], [528, 591.36], [535.71, 600], [536, 600.32], [551.94, 618.17], [580.36, 650], [591.36, 662.32], [650, 728], [1500, 1680], [3200, 3584]];
const GTL = [...Array(16).fill(401.79), ...Array(12).fill(424.11)] as number[];
// generador determinista para las combinaciones aleatorias
let semilla = 20261104; const rnd = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };

(async () => {
  console.log('\nA. Regla FEL en TS');
  const C = await import('../src/lib/tarifario/canon');
  const g = C.totalesFel(GTL);
  ok(g.total === 12900 && g.base === 11517.86 && g.iva === 1382.14, `GTL: 16 × 401.79 + 12 × 424.11 → total ${g.total}, base ${g.base}, IVA ${g.iva}`);
  ok(C.precioConIva(401.79) === 450 && C.precioConIva(424.11) === 475 && TARIFAS.every(([sin, con]) => C.precioConIva(sin) === con), `cada tarifa real (${TARIFAS.length}) → su precio con IVA redondo`);
  const vieja = C.conIva(r2(GTL.reduce((s, m) => s + m, 0)));
  ok(vieja.total === 12900.12 && g.total === 12900, `la regla vieja (12 % sobre la suma) daba ${vieja.total}; la nueva da ${g.total}, como la FEL`);
  let malas = 0;
  for (let i = 0; i < 1000; i++) {
    const n = 1 + Math.floor(rnd() * 40);
    const montos = Array.from({ length: n }, () => TARIFAS[Math.floor(rnd() * TARIFAS.length)][0]);
    const t = C.totalesFel(montos);
    // base = total / 1.12 redondeado a centavos como numeric (mitad hacia arriba): se compara en centavos enteros, no con la división en coma flotante
    const baseCent = Math.round((Math.round(t.total * 100) * 100) / 112);
    if (r2(t.base + t.iva) !== t.total || t.total !== r2(montos.reduce((s, m) => s + C.precioConIva(m), 0)) || Math.round(t.base * 100) !== baseCent || Math.abs(t.base - t.total / 1.12) > 0.0051) malas++;   // x.xx5 exacto redondea hacia arriba, como numeric
  }
  ok(malas === 0, 'base + IVA = total y total = Σ precios con IVA en 1,000 combinaciones aleatorias de las tarifas reales');
  ok(C.totalesFel([]).total === 0 && C.totalesFel([]).base === 0 && C.totalesFel([]).iva === 0 && C.totalesFel([350]).total === 392 && C.totalesFel([350]).iva === 42, 'vacío → 0; una tarifa → igual que conIva (350 → 392, IVA 42)');
  // documento del detalle y factura por centro de costo
  const D = await import('../src/lib/facturacion-agenda/detalle');
  const M = await import('../src/lib/facturacion-agenda/mapeo');
  type P = import('../src/lib/facturacion-agenda/tipos').PruebaLocal; type E = import('../src/lib/facturacion-agenda/tipos').ExpedienteLocal;
  const P0 = (id: string, servicio: string, monto: number): P => ({ id, expedienteId: 'e' + id, idExterno: 'x' + id, servicio, estadoPrueba: 'APROBO', situacion: 'cobra', motivo: '', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', montoCalculado: monto, estadoTarifa: 'resuelta', detalleTarifa: '', tarifarioId: null, aprobada: true, detalleId: null, facturaId: null, noFactura: null, facturadoEn: null, facturadoPor: null, fechaResultado: null, fechaResultadoFuente: null } as P);
  const E0 = (p: P): E => ({ id: p.expedienteId, fuente: 'agenda', idExterno: p.idExterno, empresaIdExterno: 'rec', empresaNombreExterno: 'GTL', nitResuelto: '53595181', clienteId: null, persona: 'P' + p.id, puesto: '', solicitante: '', tipoPrueba: p.servicio, categoriaPrueba: '', procesoSolicitado: '', deptoVisita: '', tipoCobrado: p.servicio, categoriaCanon: 'PRE EMPLEO', territorioResuelto: 'METROPOLITANA', fechaIngreso: '2026-10-01', fechaEntrega: null, statusProceso: '', terminado: true, cancelado: false, eliminado: false, enVistaFacturacion: null, statusCobroExterno: 'PENDIENTE', estatusPagoExterno: null, montoExterno: null, numeroFacturaExterno: null, fechaFacturaExterno: null, cobroMegapaca: null, costoVisita: null, montoCalculado: p.montoCalculado, estadoTarifa: 'resuelta', detalleTarifa: '', componentes: [], estadoPoligrafo: null, estadoSocio: null, pruebasFirma: null, pruebas: [p], actualizadoEn: null, creadoEn: null, facturaId: null, facturaAppId: null, noFactura: null, facturadoEn: null, facturadoPor: null, writebackEstado: null, writebackDetalle: null, writebackEn: null, cobroWritebackEstado: null, cobroWritebackDetalle: null, cobroWritebackEn: null, detalleId: null, fechaResultadoPoligrafo: null, fechaResultadoSocio: null } as unknown as E);
  const pruebas = GTL.map((m, i) => P0(String(i + 1), i < 16 ? 'POLIGRAFO' : 'SOCIOECONOMICO', m));
  const exps = pruebas.map(E0);
  const doc = D.documentoDetalle(exps, pruebas);
  ok(doc.incluidas.length === 28 && doc.total === 12900 && doc.subtotal === 11517.86 && doc.iva === 1382.14 && doc.incluidas[0].montoConIva === 450 && doc.incluidas[27].montoConIva === 475 && doc.incluidas[0].monto === 401.79, `documentoDetalle GTL: 28 líneas con precio con IVA 450 / 475; total ${doc.total}, base ${doc.subtotal}, IVA ${doc.iva}`);
  const fac = M.armarFactura(pruebas.map(p => ({ ...p, persona: 'P', resultado: '' })), s => (s === 'POLIGRAFO' ? 'cc-poli' : 'cc-socio'));
  const lp = fac.lineas.find(l => l.centroCostoId === 'cc-poli')!, ls = fac.lineas.find(l => l.centroCostoId === 'cc-socio')!;
  ok(fac.lineas.length === 2 && lp.total === 7200 && lp.subtotal === 6428.57 && lp.iva === 771.43 && ls.total === 5700 && ls.subtotal === 5089.29 && ls.iva === 610.71 && r2(lp.subtotal + lp.iva) === lp.total && r2(ls.subtotal + ls.iva) === ls.total, `factura por centro de costo: polígrafos ${lp.subtotal} + ${lp.iva} = ${lp.total}; socios ${ls.subtotal} + ${ls.iva} = ${ls.total}`);
  ok(fac.total === 12900 && fac.total === r2(lp.total + ls.total) && fac.subtotal === r2(lp.subtotal + ls.subtotal) && fac.iva === r2(lp.iva + ls.iva), `total de la factura = suma de las líneas = ${fac.total} (base ${fac.subtotal}, IVA ${fac.iva})`);
  ok(M.montoParaAgenda(401.79, 'con_iva') === 450 && M.montoParaAgenda(401.79, 'sin_iva') === 401.79 && M.montoParaAgenda(89.29, 'con_iva') === 100, 'montoParaAgenda con IVA = precio redondo de la prueba (401.79 → 450; 89.29 → 100)');
  const grupo = (await import('../src/lib/facturacion-agenda/resumen')).agruparPorCliente(exps, new Map());
  const kp = (await import('../src/lib/facturacion-agenda/resumen')).kpisPorFacturar(exps);
  ok(grupo.length === 1 && grupo[0].totalSinIva === 11517.96 && grupo[0].totalConIva === 12900 && kp.totalConIva === 12900 && kp.totalSinIva === 11517.96, `cola: total sin IVA (suma de tarifas) ${grupo[0].totalSinIva} · con IVA (suma de precios con IVA) ${grupo[0].totalConIva}`);
  const L = await import('../src/lib/tarifario/lookup');
  const T = (id: string, tipo: string, monto: number) => ({ id, nit: '1', razonSocial: 'X', tipoPrueba: tipo, categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto, anio: '2026', aprobadoPor: 'x', aprobadoEn: '2026-01-01', activo: true });
  const rc = L.resolverTarifa([T('a', 'POLIGRAFO', 401.79), T('b', 'SOCIOECONOMICO', 424.11)], { nit: '1', tipoPrueba: 'COMPLETO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA' }, []);
  ok(rc.estado === 'ok' && rc.total === 925 && rc.monto === 825.9 && rc.iva === r2(925 - r2(925 / 1.12)), `lookup de un COMPLETO (dos tarifas): total ${rc.estado === 'ok' ? rc.total : '—'} = 450 + 475; una tarifa suelta sigue con conIva`);

  console.log('\nB. Estático');
  const src = ['src/lib/facturacion-agenda/detalle.ts', 'src/lib/facturacion-agenda/mapeo.ts', 'src/lib/facturacion-agenda/resumen.ts', 'src/lib/db/facturacion-agenda.ts', 'src/components/por-facturar/grupo-detalle.tsx', 'src/lib/tarifario/lookup.ts'].map(rd).join('\n');
  const sinFallback = src.replace(/const conIvaSinLa030 = [^\n]*\n/, '');   // la única excepción: el fallback documentado para una base sin la 030
  ok(!/conIva\(/.test(sinFallback) && !/\* 112\b|\* 1\.12\b|\* 0\.12\b/.test(sinFallback.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'nadie aplica el 12 % sobre una suma en el detalle, la factura, la cola ni el lookup (solo totalesFel / precioConIva; única excepción: el fallback para una base sin la 030)');
  const m30 = rd('supabase/migrations/030_iva_cuadre_fel.sql'), sin30 = m30.replace(/--.*$/gm, '');
  ok(/create or replace function fel_totales\(p_montos numeric\[\]\)/.test(m30) && /round\(coalesce\(p_monto_sin_iva, 0\) \* 1\.12, 2\)/.test(m30) && /round\(total \/ 1\.12, 2\)/.test(m30) && /\(total - base\)/.test(m30), '030: fel_totales = Σ round(monto × 1.12, 2), base = round(total / 1.12, 2), IVA por resta');
  ok(['detalle_facturacion_crear_pruebas', 'detalle_facturacion_crear', 'detalle_facturacion_recalcular', 'detalle_link_contenido', 'facturacion_agenda_resumen'].every(f => new RegExp(`create or replace function ${f}\\(`).test(m30)) && !/\* 0\.12/.test(sin30) && /'monto', fel_precio_con_iva\(c\.monto_calculado\)/.test(m30) && /as total_con_iva/.test(m30), '030: recrea crear_pruebas, crear (019), recalcular, contenido del link (monto con IVA) y resumen (total_con_iva); ya no queda ningún 0.12 sobre sumas');
  ok(/where d\.estado in \('borrador', 'enviada', 'aprobada'\)/.test(m30) && !/\b(drop|truncate|delete)\b/i.test(sin30) && !/^\s*(begin|commit)\s*;/im.test(sin30) && /raise notice '030 backfill/.test(m30) && !/revocado_en = now\(\)/.test(sin30), '030: backfill solo de los detalles vivos (facturada y anulada no se tocan), sin drop/delete/commit; cuenta los links vigentes y NO los revoca');
  const imp = rd('src/components/por-facturar/detalle-imprimible.tsx'), cli = rd('src/components/aprobar-detalle/aprobar-detalle-client.tsx'), dv = rd('src/components/por-facturar/detalle-view.tsx');
  ok(/Precio \(IVA incl\.\)/.test(imp) && /Total \(IVA incluido\)/.test(imp) && /Base sin IVA \{Q\(doc\.subtotal\)\} · IVA 12 % \{Q\(doc\.iva\)\}/.test(imp) && /IVA incl\./.test(cli) && /Total \(IVA incluido\)/.test(cli) && /Base sin IVA \{Q\(d\.subtotal\)\} · IVA 12 % \{Q\(d\.iva\)\}/.test(cli) && /<th className="num">Sin IVA<\/th><th className="num"[^>]*>Con IVA<\/th>/.test(dv), 'imprimible y link: columna "Precio (IVA incl.)", "Total (IVA incluido)" y debajo base + IVA; la vista del detalle muestra las dos columnas');
  ok(/monto: precioConIva\(p\.montoCalculado \?\? 0\)/.test(rd('src/lib/db/detalle-link.ts')), 'la huella del documento firmado usa el precio con IVA por línea (igual que detalle_link_contenido)');

  console.log(`\nC. SQL en ${BASE.toUpperCase()}`);
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const { data: fg, error: eg } = await sb.rpc('fel_totales', { p_montos: GTL });
  ok(!eg && Number((fg as { total: number }).total) === 12900 && Number((fg as { base: number }).base) === 11517.86 && Number((fg as { iva: number }).iva) === 1382.14, `fel_totales (SQL) GTL: ${JSON.stringify(fg)}`);
  let dif = 0;
  for (let i = 0; i < 200; i++) {
    const n = 1 + Math.floor(rnd() * 30);
    const montos = Array.from({ length: n }, () => TARIFAS[Math.floor(rnd() * TARIFAS.length)][0]);
    const t = C.totalesFel(montos);
    const { data } = await sb.rpc('fel_totales', { p_montos: montos });
    const s = data as { total: number | string; base: number | string; iva: number | string };
    if (Number(s.total) !== t.total || Number(s.base) !== t.base || Number(s.iva) !== t.iva) dif++;
  }
  ok(dif === 0, 'fel_totales (SQL) = totalesFel (TS) en 200 combinaciones aleatorias');
  const { data: res, error: er } = await sb.rpc('facturacion_agenda_resumen', { p_fuente: 'agenda' });
  const grupos = ((res as { grupos?: Array<Record<string, unknown>> } | null)?.grupos ?? []);
  ok(!er && grupos.every(g => 'total_con_iva' in g), `facturacion_agenda_resumen trae total_con_iva por grupo (${grupos.length} grupos)`);
  console.log(`\n${pass} 🟢 / ${fail} 🔴`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
