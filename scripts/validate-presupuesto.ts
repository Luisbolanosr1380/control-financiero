/**
 * PRESUPUESTO — validador.
 *
 *  A. Puro: fórmulas del ER compartidas, signo "-"/"–", clases de línea,
 *     subtotales del presupuesto, precarga con ajuste, comparativo con el
 *     signo correcto por tipo de línea y sobregiro.
 *  B. Estático: migración 011 (sin delete/drop/begin/commit, candados),
 *     permisos (primera línea de cada action, matriz), página, tool read-only.
 *  C. E2E en la base indicada (requiere la 011 aplicada): asientos reales
 *     por la RPC de la app (2026-03), fix de la línea 70 en el ER en vivo,
 *     presupuesto en blanco + celdas, precarga del real +10% con log,
 *     aprobar/bloquear, UN aprobado por año (app y 23505 directo), reabrir,
 *     comparativo con sobregiro y real = ER en vivo, tool de Auros (con y
 *     sin presupuesto aprobado) y una pregunta real a Auros. Limpieza total.
 *
 * Uso: npx tsx --conditions=react-server scripts/validate-presupuesto.ts [hit|golden] [--sin-e2e] [--sin-gemini]
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
const casi = (a: number, b: number) => Math.abs(a - b) < 0.011;

(async () => {
  /* ───────────── A. Puro ───────────── */
  console.log('\nA. Modelo puro');
  const F = await import('../src/lib/contabilidad/er-formulas');
  ok(F.esSignoNegativo('–') && F.esSignoNegativo('-') && !F.esSignoNegativo('+') && !F.esSignoNegativo(null), 'signo de resta: "–" (Golden) y "-" (HIT) significan lo mismo');
  ok(F.claseDeLinea(20) === 'ingreso' && F.claseDeLinea(70) === 'descuento' && F.claseDeLinea(130) === 'costo' && F.claseDeLinea(250) === 'gasto' && F.claseDeLinea(930, 'Calculada') === 'calculada', 'clase de línea por orden (misma convención que los subtotales del ER)');
  const M = await import('../src/lib/presupuesto/modelo');
  const lineas = M.lineasPresupuesto([
    { orden: 20, nombre: 'Ingresos Reclutamiento', tipo: 'Suma cuentas', negativa: false },
    { orden: 70, nombre: 'Descuentos y NC', tipo: 'Suma cuentas', negativa: true },
    { orden: 120, nombre: 'Costos Reclutamiento', tipo: 'Suma cuentas', negativa: false },
    { orden: 210, nombre: 'Gastos Administracion', tipo: 'Suma cuentas', negativa: false },
    { orden: 260, nombre: 'Depreciacion y Amortizacion', tipo: 'Suma cuentas', negativa: false },
    { orden: 900, nombre: 'Utilidad Bruta', tipo: 'Calculada', negativa: false },
    { orden: 910, nombre: 'EBITDA', tipo: 'Calculada', negativa: false },
    { orden: 920, nombre: 'Utilidad Operativa', tipo: 'Calculada', negativa: false },
    { orden: 930, nombre: 'Utilidad Neta', tipo: 'Calculada', negativa: false },
  ]);
  const res = M.resolverLineas(lineas, new Map([[20, 100000], [70, 5000], [120, 30000], [210, 20000], [260, 1000]]));
  ok(res.get(900) === 65000 && res.get(910) === 45000 && res.get(920) === 44000 && res.get(930) === 44000,
    `subtotales del presupuesto con las fórmulas del ER: U.Bruta 65,000 (100k − 5k descuento − 30k) · EBITDA 45,000 · U.Operativa 44,000 · U.Neta ${res.get(930)}`);
  const celdas = new Map([[M.claveCelda(20, 'A', 1), 100], [M.claveCelda(20, 'B', 1), 50], [M.claveCelda(20, 'A', 2), 10], [M.claveCelda(210, 'A', 1), 7]]);
  const sA = M.sumarCeldas(celdas, { centroId: 'A', meses: [1] }), sT = M.sumarCeldas(celdas, { centroId: M.TODOS, meses: [1, 2] });
  ok(sA.get(20) === 100 && sA.get(210) === 7 && sT.get(20) === 160, 'totales por centro y consolidado (suma de centros), por mes y acumulado');
  const pre = M.celdasDesdeReal(lineas, [
    { orden: 20, centroId: 'A', mes: 3, montoConSigno: 50000 },
    { orden: 70, centroId: 'A', mes: 3, montoConSigno: -2000 },
    { orden: 210, centroId: 'B', mes: 3, montoConSigno: 8000 },
    { orden: 210, centroId: '', mes: 3, montoConSigno: 999 },
    { orden: 900, centroId: 'A', mes: 3, montoConSigno: 1 },
  ], { globalPct: 10 });
  ok(pre.get(M.claveCelda(20, 'A', 3)) === 55000 && pre.get(M.claveCelda(70, 'A', 3)) === 2200 && pre.get(M.claveCelda(210, 'B', 3)) === 8800 && pre.size === 3,
    'precarga +10%: ingreso 50,000 → 55,000; descuento (−2,000 en el ER) → 2,200 de magnitud; sin centro y subtotales no se precargan');
  const pre2 = M.celdasDesdeReal(lineas, [{ orden: 20, centroId: 'A', mes: 1, montoConSigno: 1000 }, { orden: 210, centroId: 'A', mes: 1, montoConSigno: 1000 }],
    { globalPct: 8, porClasePct: { ingreso: 12 }, porLineaPct: { 210: 5 } });
  ok(pre2.get(M.claveCelda(20, 'A', 1)) === 1120 && pre2.get(M.claveCelda(210, 'A', 1)) === 1050, 'ajuste: por línea > por clase > global (ingresos +12%, Gastos Administración +5%)');
  const lIng = lineas.find(l => l.orden === 20)!, lGas = lineas.find(l => l.orden === 210)!, lUN = lineas.find(l => l.orden === 930)!;
  const fi = M.filaComparativo(lIng, 60000, 50000), fg = M.filaComparativo(lGas, 5000, 8000), fg2 = M.filaComparativo(lGas, 5000, 4000), fu = M.filaComparativo(lUN, 10000, 12000);
  ok(fi.variacion === -10000 && fi.favorable === false && !fi.sobregiro && fi.ejecucionPct === 83.33, 'ingreso real < presupuesto → en contra (quedé corto), sin "sobregiro"');
  ok(fg.variacion === 3000 && fg.favorable === false && fg.sobregiro && fg.ejecucionPct === 160, 'gasto real > presupuesto → SOBREGIRO (rojo), 160% de ejecución');
  ok(fg2.favorable === true && !fg2.sobregiro && fu.favorable === true, 'gasto por debajo y utilidad por encima → a favor');
  ok(M.filaComparativo(lGas, 0, 500).sobregiro && M.filaComparativo(lGas, 0, 500).ejecucionPct === null, 'gasto sin presupuesto (0) con real → sobregiro, % de ejecución sin dato');
  ok(M.mesDeCorte(2027, '2026-10-05') === 0 && M.mesDeCorte(2026, '2026-10-05') === 10 && M.mesDeCorte(2025, '2026-10-05') === 12, 'mes de corte: año futuro 0 · año en curso = mes actual · año pasado 12');

  /* ───────────── B. Estático ───────────── */
  console.log('\nB. Migración, permisos y página');
  const mig = leer('supabase/migrations/011_presupuesto.sql');
  const sinComentarios = mig.replace(/--[^\n]*/g, '');
  ok(!/\b(drop|begin|commit)\b/i.test(sinComentarios) && !/^\s*delete\b/im.test(sinComentarios), '011 sin drop/delete/begin/commit (pasa por el runner y el conector)');
  ok(/unique index if not exists uq_presupuesto_anio_aprobado\s+on presupuesto\(anio\) where estado = 'Aprobado'/.test(mig) && /uq_preslin_celda\s+on presupuesto_lineas\(presupuesto_id, mapeo_er_id, centro_costo_id, mes\)/.test(mig),
    'candados en la base: un aprobado por año y una celda por (presupuesto, línea, centro, mes)');
  const R = await import('../src/lib/auth/roles');
  ok(R.puede('admin', 'presupuesto') && R.puede('contador', 'presupuesto') && !R.puede('auxiliar', 'presupuesto') && !R.puede('lectura', 'presupuesto'), 'editar/aprobar: admin y contador');
  ok(['admin', 'contador', 'auxiliar', 'lectura'].every(r => R.puede(r as never, 'ver_presupuesto')), 'ver presupuesto y comparativo: todos (auxiliar solo lectura, en un punto de la matriz)');
  ok(R.puede('admin', 'reabrir_presupuesto') && !R.puede('contador', 'reabrir_presupuesto'), 'reabrir un aprobado: solo admin');
  const acts = leer('src/app/(app)/presupuesto/actions.ts');
  const primera = (fn: string) => { const i = acts.indexOf(`export async function ${fn}`); return acts.slice(acts.indexOf('{\n', acts.indexOf(')', i)) + 2).trim().split('\n')[0]; };
  for (const [fn, acc] of [['crearPresupuestoAction', 'presupuesto'], ['precargarPresupuestoAction', 'presupuesto'], ['editarCeldasAction', 'presupuesto'], ['limpiarCeldasAction', 'presupuesto'], ['aprobarPresupuestoAction', 'presupuesto'], ['archivarPresupuestoAction', 'presupuesto'], ['reabrirPresupuestoAction', 'reabrir_presupuesto']]) {
    ok(primera(fn).includes(`autorizar('${acc}')`), `${fn}: primera línea autorizar('${acc}')`);
  }
  ok(leer('src/app/(app)/presupuesto/page.tsx').includes("exigirPagina('ver_presupuesto')") && leer('src/app/(app)/presupuesto/[id]/page.tsx').includes("exigirPagina('ver_presupuesto')"), 'páginas /presupuesto y /presupuesto/[id] exigen ver_presupuesto');
  ok(!/\.(insert|update|upsert|delete)\(/.test(leer('src/lib/ai/tools.ts')), 'la tool de Auros es read-only');
  const er = leer('src/lib/contabilidad/estado-resultados.ts');
  ok(/from '@\/lib\/contabilidad\/er-formulas'/.test(er) && /export async function generarRealPorCelda/.test(er) && /calcularPeriodo\(ps, mapeo, cuentasMeta\)/.test(er),
    'el real por celda usa el MISMO calcularPeriodo del ER (no un cálculo aparte)');

  if (process.argv.includes('--sin-e2e')) return fin();

  /* ───────────── C. E2E ───────────── */
  const P = await import('../src/lib/db/presupuesto');
  if (!(await P.presupuestoDisponible())) {
    console.log(`\nC. E2E omitido: la migración 011 no está aplicada en ${base} (aplicala con migrar-todas.ts y volvé a correr).`);
    return fin();
  }
  console.log(`\nC. E2E en ${base.toUpperCase()}`);
  const { supabase } = await import('../src/lib/supabase/client');
  const { rpc } = await import('../src/lib/supabase/writes');
  const { generarEstadoResultados } = await import('../src/lib/contabilidad/estado-resultados');
  const sb = supabase()!;
  const STAMP = Date.now().toString(36);
  const TAG = `E2E-PRES-${STAMP}`;
  const USR = `validador+${STAMP}@presupuesto`;
  const asientos: string[] = [];
  const presupuestos: string[] = [];
  try {
    const cta = async (codigo: string) => { const { data } = await sb.from('cuentas').select('id, airtable_id').eq('codigo_path', codigo).single(); if (!data) throw new Error(`cuenta ${codigo}`); return data as { id: string; airtable_id: string }; };
    const ccu = async (nombre: string) => { const { data } = await sb.from('centros_costo').select('id, airtable_id').eq('nombre', nombre).eq('activo', true).single(); if (!data) throw new Error(`centro ${nombre}`); return data as { id: string; airtable_id: string }; };
    const [cIng, cGas, cDesc, cCxc] = await Promise.all([cta('4-1-2'), cta('6-1-1'), cta('4-1-2-1-7'), cta('1-1-3-1')]);
    const [ccAdm, ccRec] = await Promise.all([ccu('Administrativo'), ccu('Reclutamiento')]);

    // Real 2026-03 por la RPC transaccional de la app (como un asiento contable normal).
    const asiento = async (ref: string, partidas: Array<{ cuenta: string; centro: string; debe: number; haber: number }>) => {
      const r = await rpc<{ asiento_airtable_id: string }>('fase2_crear_asiento_con_partidas', {
        p_asiento: { asiento_ref: `${TAG}-${ref}`, fecha_asiento: '2026-03-15', origen: 'E2E', descripcion: `${TAG} ${ref}` },
        p_partidas: partidas.map(p => ({ cuenta_id: p.cuenta, centro_costo_id: p.centro, descripcion_linea: ref, debe: p.debe, haber: p.haber, moneda: 'GTQ', tipo_cambio: 1, periodo: '2026-03' })),
      }, ['asientos', 'partidas']);
      asientos.push(r.asiento_airtable_id);
    };
    const erAntes = await generarEstadoResultados({ periodo: '2026-03' });
    const lineaER = (e: typeof erAntes, orden: number) => e.lineas.find(l => l.orden === orden)?.mes ?? 0;
    await asiento('ING', [{ cuenta: cCxc.id, centro: '', debe: 50000, haber: 0 }, { cuenta: cIng.id, centro: ccRec.id, debe: 0, haber: 50000 }]);
    await asiento('GAS', [{ cuenta: cGas.id, centro: ccAdm.id, debe: 8000, haber: 0 }, { cuenta: cCxc.id, centro: '', debe: 0, haber: 8000 }]);
    await asiento('DESC', [{ cuenta: cDesc.id, centro: ccRec.id, debe: 2000, haber: 0 }, { cuenta: cCxc.id, centro: '', debe: 0, haber: 2000 }]);
    ok(asientos.length === 3, '3 asientos reales en 2026-03 por la RPC de la app (ingreso 50,000 · gasto 8,000 · descuento 2,000)');
    const erDesp = await generarEstadoResultados({ periodo: '2026-03' });
    const d70 = lineaER(erDesp, 70) - lineaER(erAntes, 70), d20 = lineaER(erDesp, 20) - lineaER(erAntes, 20), d900 = lineaER(erDesp, 900) - lineaER(erAntes, 900);
    ok(casi(d70, -2000) && casi(d20, 50000) && casi(d900, 48000 - 8000 * 0) || (casi(d70, -2000) && casi(d20, 50000)),
      `ER en vivo (fix de la línea 70): ingreso +50,000, Descuentos y NC ${d70} (resta), Utilidad Bruta +${d900}`);
    ok(casi(d900, 48000), `Utilidad Bruta = 50,000 − 2,000 de descuento = 48,000 (antes del fix, en Golden el descuento sumaba): ${d900}`);

    // ── Presupuesto 2027 en blanco + celdas ──
    const est = await P.getEstructura();
    const c1 = await P.crearPresupuesto({ anio: 2027, nombre: `${TAG} 2027 A`, modo: 'blanco', usuario: USR });
    if (!c1.ok) throw new Error(c1.error); presupuestos.push(c1.id);
    const ed = await P.editarCeldas({ id: c1.id, usuario: USR, cambios: [
      { orden: 20, centroId: ccRec.id, mes: 1, monto: 30000 }, { orden: 20, centroId: ccAdm.id, mes: 2, monto: 10000 },
      { orden: 210, centroId: ccAdm.id, mes: 1, monto: 7000 }, { orden: 210, centroId: ccRec.id, mes: 2, monto: 3000 },
    ] });
    ok(ed.ok, `celdas capturadas (ingreso y gasto, 2 centros, 2 meses): ${ed.ok ? ed.mensaje : ed.error}`);
    const g1 = (await P.getPresupuesto(c1.id))!;
    const anual = M.resolverLineas(est.lineas, M.sumarCeldas(g1.celdas, { centroId: M.TODOS, meses: M.TODOS_LOS_MESES }));
    const enero = M.resolverLineas(est.lineas, M.sumarCeldas(g1.celdas, { centroId: M.TODOS, meses: [1] }));
    const o = (re: RegExp) => est.lineas.find(l => re.test(l.nombre))!.orden;
    ok(anual.get(20) === 40000 && anual.get(210) === 10000 && anual.get(o(/utilidad bruta/i)) === 40000 && anual.get(o(/utilidad operativa/i)) === 30000 && enero.get(o(/utilidad operativa/i)) === 23000,
      `totales y subtotales: ingresos 40,000 · gastos 10,000 · U.Bruta ${anual.get(o(/utilidad bruta/i))} · U.Operativa ${anual.get(o(/utilidad operativa/i))} (enero 23,000)`);
    const malo = await P.editarCeldas({ id: c1.id, usuario: USR, cambios: [{ orden: o(/utilidad bruta/i), centroId: ccAdm.id, mes: 1, monto: 1 }] });
    ok(!malo.ok, 'un subtotal (Utilidad Bruta) no se captura: se calcula');

    // ── Precarga del real 2026 +10% ──
    const c2 = await P.crearPresupuesto({ anio: 2027, nombre: `${TAG} 2027 B`, modo: 'precarga', ajustes: { globalPct: 10 }, usuario: USR });
    if (!c2.ok) throw new Error(c2.error); presupuestos.push(c2.id);
    const g2 = (await P.getPresupuesto(c2.id))!;
    const v = (orden: number, cc: string, mes: number) => g2.celdas.get(M.claveCelda(orden, cc, mes)) ?? 0;
    ok(v(20, ccRec.id, 3) >= 55000 - 0.01 && casi(v(210, ccAdm.id, 3) - 0, v(210, ccAdm.id, 3)) && v(210, ccAdm.id, 3) >= 8800 - 0.01 && v(70, ccRec.id, 3) >= 2200 - 0.01,
      `precarga real 2026 ×1.10: ingreso Reclutamiento marzo ${v(20, ccRec.id, 3)} (≥55,000) · gasto Administrativo ${v(210, ccAdm.id, 3)} (≥8,800) · descuento ${v(70, ccRec.id, 3)} (≥2,200)`);
    const logPre = g2.log.find(e => e.accion === 'precargar') as { detalle: { ajustes?: { globalPct?: number }; desde?: string } } | undefined;
    ok(!!logPre && logPre.detalle.ajustes?.globalPct === 10 && /real 2026/.test(String(logPre.detalle.desde)), 'el log registró la precarga (desde el real 2026, ajuste +10%)');

    // ── Aprobar, bloquear, un solo aprobado por año, reabrir ──
    const ap = await P.aprobarPresupuesto({ id: c1.id, usuario: USR });
    const g1b = (await P.getPresupuesto(c1.id))!;
    ok(ap.ok && g1b.cab.estado === 'Aprobado' && g1b.cab.aprobadoPor === USR && !!g1b.cab.aprobadoEn, `aprobar: estado Aprobado, aprobado_por y aprobado_en grabados`);
    const bloq = await P.editarCeldas({ id: c1.id, usuario: USR, cambios: [{ orden: 20, centroId: ccRec.id, mes: 1, monto: 1 }] });
    ok(!bloq.ok && /no se edita/.test(bloq.ok ? '' : bloq.error), 'aprobado → las celdas quedan bloqueadas');
    const ap2 = await P.aprobarPresupuesto({ id: c2.id, usuario: USR });
    ok(!ap2.ok && /Ya hay un presupuesto aprobado para 2027/.test(ap2.ok ? '' : ap2.error), `segundo aprobado 2027 por la app → rechazado: "${ap2.ok ? '' : ap2.error.slice(0, 70)}…"`);
    const { error: e23505 } = await sb.from('presupuesto').update({ estado: 'Aprobado' }).eq('id', c2.id);
    ok(!!e23505 && (e23505.code === '23505' || /uq_presupuesto_anio_aprobado/.test(e23505.message)), `segundo aprobado DIRECTO en la base → 23505 del índice único (${e23505?.code})`);
    const re = await P.reabrirPresupuesto({ id: c1.id, usuario: USR, motivo: 'La junta pidió ajustar ingresos' });
    const g1c = (await P.getPresupuesto(c1.id))!;
    const logRe = g1c.log.find(e => e.accion === 'reabrir') as { detalle: { motivo?: string; aprobadoAntesPor?: string } } | undefined;
    ok(re.ok && g1c.cab.estado === 'Borrador' && logRe?.detalle.motivo === 'La junta pidió ajustar ingresos' && logRe?.detalle.aprobadoAntesPor === USR, 'reabrir → Borrador; el log guarda el motivo y quién lo había aprobado');
    ok((await P.editarCeldas({ id: c1.id, usuario: USR, cambios: [{ orden: 20, centroId: ccRec.id, mes: 1, monto: 31000 }] })).ok, 'reabierto → editable otra vez');
    ok(['crear', 'editar_celda', 'aprobar', 'reabrir'].every(a => g1c.log.some(e => e.accion === a)), 'historial completo: crear, editar, aprobar, reabrir');

    // ── Comparativo sobre 2026 (año con real) ──
    const c3 = await P.crearPresupuesto({ anio: 2026, nombre: `${TAG} 2026`, modo: 'blanco', usuario: USR });
    if (!c3.ok) throw new Error(c3.error); presupuestos.push(c3.id);
    const previo2026 = await P.getPresupuestoAprobado(2026);
    await P.editarCeldas({ id: c3.id, usuario: USR, cambios: [{ orden: 210, centroId: ccAdm.id, mes: 3, monto: 5000 }, { orden: 20, centroId: ccRec.id, mes: 3, monto: 60000 }] });
    const ap3 = previo2026 ? { ok: false } : await P.aprobarPresupuesto({ id: c3.id, usuario: USR });
    ok(ap3.ok, 'presupuesto 2026 de prueba aprobado (para comparar contra el real de marzo)');
    const g3 = (await P.getPresupuesto(c3.id))!;
    const real = await P.getReal(2026, est);
    const fAdm = M.comparativo(est.lineas, g3.celdas, real, { centroId: ccAdm.id, meses: [3] }).find(f => f.orden === 210)!;
    const fRec = M.comparativo(est.lineas, g3.celdas, real, { centroId: ccRec.id, meses: [3] }).find(f => f.orden === 20)!;
    const erAdm = await generarEstadoResultados({ periodo: '2026-03', centroCostoId: ccAdm.airtable_id });
    const erRec = await generarEstadoResultados({ periodo: '2026-03', centroCostoId: ccRec.airtable_id });
    ok(casi(fAdm.real, erAdm.lineas.find(l => l.orden === 210)!.mes) && casi(fRec.real, erRec.lineas.find(l => l.orden === 20)!.mes),
      `real de la celda = ER en vivo para esa línea/centro/mes (Gastos Administración ${fAdm.real}; Ingresos Reclutamiento ${fRec.real})`);
    ok(fAdm.sobregiro && fAdm.favorable === false && casi(fAdm.variacion, fAdm.real - 5000) && fAdm.real >= 8000,
      `gasto real ${fAdm.real} > presupuesto 5,000 → SOBREGIRO, variación +${fAdm.variacion}`);
    ok(!fRec.sobregiro && fRec.favorable === (fRec.real >= 60000) && casi(fRec.variacion, fRec.real - 60000),
      `ingreso real ${fRec.real} vs 60,000 → variación ${fRec.variacion}, ${fRec.favorable ? 'a favor' : 'en contra'} (sin "sobregiro": en ingresos quedar corto es lo malo)`);

    // ── Auros ──
    const { aiTools } = await import('../src/lib/ai/tools');
    const ej = <T,>(args: unknown) => (aiTools.getPresupuestoVsReal as unknown as { execute: (a: unknown, o: unknown) => Promise<T> }).execute(args, { toolCallId: 'x', messages: [] });
    const t1 = await ej<Record<string, any>>({ periodo: 'rango', anio: 2026, mesDesde: 1, mesHasta: 3, centro: 'Administrativo' });
    ok(t1.ok && t1.sobregiros.some((x: { linea: string }) => /administraci/i.test(x.linea)) && typeof t1.utilidad?.cumplimiento_pct !== 'undefined',
      `tool getPresupuestoVsReal 2026 ene–mar (Administrativo): sobregiro en ${t1.sobregiros?.map((x: { linea: string; exceso: number }) => `${x.linea} +${x.exceso}`).join(', ')}`);
    const t2 = await ej<Record<string, any>>({ periodo: 'ytd', anio: 2031 });
    ok(!t2.ok && t2.motivo === 'sin_presupuesto_aprobado' && /Todavía no hay presupuesto aprobado para 2031/.test(t2.mensaje), `sin presupuesto aprobado: "${t2.mensaje}" (no inventa base)`);
    if (!process.argv.includes('--sin-gemini') && process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      const { generateText } = await import('ai');
      const { google } = await import('@ai-sdk/google');
      const { buildSystemPrompt, hoyGuatemala } = await import('../src/lib/ai/system-prompt');
      const pregunta = async (q: string) => {
        const r = await generateText({ model: google('gemini-2.5-flash'), system: buildSystemPrompt(hoyGuatemala(), ''), messages: [{ role: 'user', content: q }], tools: aiTools, maxSteps: 8, temperature: 0.3 });
        return { texto: r.text, tools: r.steps.flatMap(st => (st.toolCalls ?? []).map(c => c.toolName)) };
      };
      const a1 = await pregunta('¿Cómo voy vs presupuesto en 2026, de enero a marzo, en el centro Administrativo? ¿En qué me pasé?');
      console.log(`     Auros → ${a1.texto.replace(/\s+/g, ' ').slice(0, 300)}`);
      ok(a1.tools.includes('getPresupuestoVsReal') && /Q\s?[\d,]{3,}/.test(a1.texto) && /administraci/i.test(a1.texto), 'Auros responde "¿cómo voy vs presupuesto?" con cifras de la tool y nombra la línea en sobregiro');
      const a2 = await pregunta('¿Cómo voy vs presupuesto en 2031?');
      console.log(`     Auros → ${a2.texto.replace(/\s+/g, ' ').slice(0, 200)}`);
      ok(a2.tools.includes('getPresupuestoVsReal') && /no hay presupuesto aprobado|todav[ií]a no hay/i.test(a2.texto), 'sin presupuesto aprobado, Auros lo dice en vez de inventar');
    }
  } catch (e) {
    ok(false, `error: ${e instanceof Error ? e.message : e}`);
  } finally {
    if (presupuestos.length) await sb.from('presupuesto').delete().in('id', presupuestos);
    const { data: as } = await sb.from('asientos').select('id').like('asiento_ref', `${TAG}%`);
    const ids = (as ?? []).map(a => (a as { id: string }).id);
    if (ids.length) { await sb.from('partidas').delete().in('asiento_id', ids); await sb.from('asientos').delete().in('id', ids); }
    const [{ count: c1 }, { count: c2 }, { count: c3 }] = await Promise.all([
      sb.from('presupuesto').select('id', { count: 'exact', head: true }).like('nombre', `${TAG}%`),
      sb.from('asientos').select('id', { count: 'exact', head: true }).like('asiento_ref', `${TAG}%`),
      sb.from('presupuesto_log').select('id', { count: 'exact', head: true }).eq('actor', USR),
    ]);
    ok((c1 ?? 0) + (c2 ?? 0) + (c3 ?? 0) === 0, `limpieza verificada: 0 presupuestos, asientos/partidas ni log de ${TAG}`);
    fin();
  }
})();
