/**
 * TESORERÍA — validador del flujo de caja proyectado.
 *
 *  A. Motor puro: ventanas, días de crédito por defecto, cuotas de deuda,
 *     "solo capital" sin interés inventado, factoraje, vencidos, saldo
 *     acumulado y períodos negativos.
 *  B. Permisos: 'flujo' = admin + contador; /tesoreria exige 'flujo'.
 *  C. Prueba de cálculo en la base indicada: banco con saldo + movimientos,
 *     facturas con distintos días de crédito, una cedida, recurrentes, deudas
 *     (con cuotas y sin términos), factoraje, planilla pendiente y un período
 *     forzado a negativo. Fechas y saldo acumulado contra lo esperado,
 *     calculado aparte. Limpieza total y verificada.
 *
 * Uso: npx tsx --conditions=react-server scripts/validate-tesoreria.ts [hit|golden] [--sin-e2e]
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
const casi = (a: number, b: number) => Math.abs(a - b) < 0.011;

(async () => {
  const M = await import('../src/lib/tesoreria/motor');

  /* ───────────── A. Motor puro ───────────── */
  console.log('\nA. Motor puro');
  const vs = M.ventanas('2026-10-07', 'semana', 13);
  ok(vs.length === 13 && vs[0].inicio === '2026-10-05' && vs[0].fin === '2026-10-11' && vs[12].fin === '2027-01-03', `13 semanas lun–dom desde la semana de hoy (${vs[0].inicio} → ${vs[12].fin})`);
  const ms = M.ventanas('2026-10-07', 'mes', 6);
  ok(ms.length === 6 && ms[0].inicio === '2026-10-01' && ms[5].fin === '2027-03-31', `6 meses calendario (${ms[0].inicio} → ${ms[5].fin})`);
  const c1 = M.fechaEsperadaCobro('2026-10-01', 15, 30), c2 = M.fechaEsperadaCobro('2026-10-01', null, 30), c3 = M.fechaEsperadaCobro('2026-10-01', 0, 30);
  ok(c1.fecha === '2026-10-16' && !c1.usoDefault && c2.fecha === '2026-10-31' && c2.usoDefault && c3.fecha === '2026-10-01' && !c3.usoDefault, 'cobro = emisión + días de crédito; null → 30 días marcado; 0 es contado (no default)');

  const deudaBase = { id: 'd', descripcion: 'Préstamo X', fechaVencimiento: null, parteRelacionada: false };
  const lin = M.proyectarDeuda({ ...deudaBase, saldo: 10000, plazoMeses: 12, fechaPrimerCuota: '2026-03-20', diaPagoFijo: 20, interesAnualPct: null }, '2026-10-07', '2027-12-31');
  ok(lin.length === 5 && lin[0].fecha === '2026-10-20' && lin[4].fecha === '2027-02-20' && casi(lin.reduce((s, e) => s + e.monto, 0), 10000) && lin.every(e => !e.marcas.includes('terminos_incompletos')), `con plazo y 1a cuota sin interés: quedan 5 de 12 cuotas (20-oct → 20-feb) que suman el saldo exacto`);
  const fr = M.proyectarDeuda({ ...deudaBase, saldo: 10000, plazoMeses: 12, fechaPrimerCuota: '2026-03-20', diaPagoFijo: 20, interesAnualPct: 0.12 }, '2026-10-07', '2027-12-31');
  const cuotaFr = 10000 * 0.01 / (1 - Math.pow(1.01, -5));
  ok(fr.length === 5 && fr.every(e => casi(e.monto, Math.round(cuotaFr * 100) / 100)), `con interés 12%: cuota francesa ${fr[0]?.monto} (esperada ${cuotaFr.toFixed(2)})`);
  const inc = M.proyectarDeuda({ ...deudaBase, saldo: 7000, plazoMeses: null, fechaPrimerCuota: null, diaPagoFijo: null, interesAnualPct: 0.3, fechaVencimiento: '2026-11-15' }, '2026-10-07', '2027-12-31');
  ok(inc.length === 1 && inc[0].monto === 7000 && inc[0].fecha === '2026-11-15' && inc[0].marcas.includes('terminos_incompletos'), 'sin plazo/1a cuota: SOLO capital (7,000) al vencimiento, marcado — aunque tenga tasa, no se inventa interés');
  const sinF = M.proyectarDeuda({ ...deudaBase, saldo: 500, plazoMeses: null, fechaPrimerCuota: null, diaPagoFijo: null, interesAnualPct: null, parteRelacionada: true }, '2026-10-07', '2027-12-31');
  ok(sinF[0].fecha === '2026-10-07' && sinF[0].marcas.includes('sin_fecha') && sinF[0].marcas.includes('parte_relacionada'), 'sin vencimiento: exigible hoy, marcado sin fecha (+ parte relacionada)');

  const facBase = { id: 'f', descripcion: 'Fact', saldo: 9000, fechaVencimiento: '2026-12-01', fechaEmision: '2026-10-01', comisionPct: null, interesAnualPct: null, reservaPct: 0.1 };
  const fSin = M.proyectarFactoraje({ ...facBase, conRecurso: false, montoCedidoActivo: 10000 }, '2026-10-07');
  ok(fSin.length === 1 && fSin[0].tipo === 'ingreso' && fSin[0].monto === 1000, 'factoraje sin recurso con cesiones: capital NO sale de caja; solo regresa la reserva (1,000)');
  const fCon = M.proyectarFactoraje({ ...facBase, conRecurso: true, montoCedidoActivo: 10000, comisionPct: 0.02, interesAnualPct: 0.18 }, '2026-10-07');
  const costo = Math.round((10000 * 0.02 + 10000 * 0.18 * 61 / 365) * 100) / 100;
  ok(fCon.some(e => e.tipo === 'egreso' && e.monto === 9000 && e.marcas.includes('terminos_incompletos')) && fCon.some(e => casi(e.monto, costo)) && !fCon.some(e => e.tipo === 'ingreso'), `con recurso: capital 9,000 + comisión/interés ${costo} (cargados); sin reserva de vuelta`);
  const fNada = M.proyectarFactoraje({ ...facBase, conRecurso: true, montoCedidoActivo: 0, reservaPct: null }, '2026-10-07');
  ok(fNada.length === 1 && fNada[0].monto === 9000, 'sin comisión/interés cargados: solo capital');

  const ev = (fecha: string, tipo: 'ingreso' | 'egreso', monto: number) => ({ fecha, tipo, fuente: 'cxp' as const, monto, descripcion: `${tipo} ${fecha}`, marcas: [] });
  const pr = M.proyectar({ hoy: '2026-10-07', granularidad: 'semana', cantidad: 4, saldoInicial: 1000, eventos: [
    ev('2026-09-30', 'ingreso', 5000), ev('2026-10-01', 'egreso', 200), ev('2026-10-08', 'ingreso', 300),
    ev('2026-10-14', 'egreso', 2000), ev('2026-10-22', 'ingreso', 1500), ev('2027-06-01', 'egreso', 999),
  ] });
  const [atr, w1, w2, w3, w4] = pr.periodos;
  ok(pr.totalCobranzaVencida === 5000 && pr.cobranzaVencida.length === 1, 'cobro vencido (5,000) va aparte y NO suma al saldo');
  ok(atr.clave === 'atrasado' && atr.egresos === 200 && atr.saldoFin === 800, 'pago vencido (200) cuenta en "Atrasado" (exigible ya): 1,000 → 800');
  ok(w1.saldoFin === 1100 && w2.saldoFin === -900 && w2.negativo && w3.saldoFin === 600 && !w3.negativo && w4.saldoFin === 600, `saldo acumulado 800 → 1,100 → −900 (rojo) → 600 → 600`);
  const sf = { fecha: '2026-10-07', tipo: 'egreso' as const, fuente: 'deuda' as const, monto: 4000, descripcion: 'sin fecha', marcas: ['sin_fecha' as const, 'terminos_incompletos' as const] };
  const prOut = M.proyectar({ hoy: '2026-10-07', granularidad: 'semana', cantidad: 2, saldoInicial: 1000, eventos: [sf], incluirSinFecha: false });
  const prIn = M.proyectar({ hoy: '2026-10-07', granularidad: 'semana', cantidad: 2, saldoInicial: 1000, eventos: [sf] });
  ok(prOut.totalSinFecha === 4000 && prOut.saldoFinal === 1000 && prIn.saldoFinal === -3000 && prIn.primerNegativo !== null, 'pasivo sin fecha: aparte (saldo 1,000) o, si se decide incluirlo, exigible hoy (−3,000, rojo)');
  ok(pr.primerNegativo?.clave === '2026-10-12' && pr.minimo?.saldo === -900 && pr.fueraDeHorizonte.egresos === 999, 'primer negativo y mínimo correctos; lo que cae después del horizonte se reporta aparte');

  /* ───────────── B. Permisos ───────────── */
  console.log('\nB. Permisos');
  const R = await import('../src/lib/auth/roles');
  ok(R.puede('admin', 'flujo') && R.puede('contador', 'flujo') && !R.puede('auxiliar', 'flujo') && !R.puede('lectura', 'flujo'), "'flujo' = admin + contador");
  ok(fs.readFileSync('src/app/(app)/tesoreria/page.tsx', 'utf8').includes("exigirPagina('flujo')"), "página /tesoreria exige 'flujo'");
  const fuentesSrc = fs.readFileSync('src/lib/tesoreria/fuentes.ts', 'utf8');
  ok(!/\.(insert|update|upsert|delete|rpc)\(/.test(fuentesSrc), 'fuentes de tesorería: read-only (sin insert/update/delete/rpc)');

  if (process.argv.includes('--sin-e2e')) return fin();

  /* ───────────── C. Prueba de cálculo en la base ───────────── */
  console.log(`\nC. Prueba de cálculo en ${base.toUpperCase()}`);
  const { supabase } = await import('../src/lib/supabase/client');
  const { formatInTimeZone } = await import('date-fns-tz');
  const sb = supabase()!;
  const T = await import('../src/lib/tesoreria/fuentes');
  const D = await import('../src/lib/db/deudas');
  const A2 = await import('../src/lib/db/acreedores');
  const F = await import('../src/lib/db/factoraje');
  const { getEmpleados } = await import('../src/lib/db/empleados');
  const { EMPRESA_EMPLEADORA_DEFAULT } = await import('../src/lib/empleados/empresa');

  const H = formatInTimeZone(new Date(), 'America/Guatemala', 'yyyy-MM-dd');
  const d = (n: number) => M.sumarDias(H, n);
  const hasta6m = M.ventanas(H, 'mes', 6)[5].fin;
  const hasta = [hasta6m, M.ventanas(H, 'semana', 26)[25].fin].reduce((a, b) => (a > b ? a : b));
  const STAMP = Date.now().toString(36);
  const TAG = `E2E-TES-${STAMP}`;
  const aid = (k: string) => `sbw${('tes' + STAMP + k).replace(/[^a-z0-9]/gi, '').toLowerCase()}`.slice(0, 40);
  const creados: Array<[string, string]> = [];
  const crear = async (tabla: string, fila: Record<string, unknown>) => {
    const { data, error } = await sb.from(tabla).insert(fila).select('id').single();
    if (error) throw new Error(`${tabla}: ${error.message}`);
    creados.push([tabla, String(data.id)]); return String(data.id);
  };
  const esperado: Array<{ fecha: string; tipo: 'ingreso' | 'egreso'; monto: number; que: string }> = [];

  try {
    // Saldo inicial: 50,000 + ingreso 5,000 − egreso 1,000 (posteriores al saldo inicial) = 54,000
    const banco = await crear('bancos', { airtable_id: aid('bco'), nombre_cuenta: `${TAG} Monetaria`, banco: 'E2E', moneda: 'GTQ', saldo_inicial: 50000, fecha_saldo_inicial: d(-10), activo: true });
    await crear('movimientos_bancarios', { banco_id: banco, fecha: d(-2), monto: 5000, tipo: 'Ingreso', descripcion: `${TAG} depósito` });
    await crear('movimientos_bancarios', { banco_id: banco, fecha: d(-1), monto: 1000, tipo: 'Egreso', descripcion: `${TAG} cheque` });
    await crear('movimientos_bancarios', { banco_id: banco, fecha: d(-20), monto: 777, tipo: 'Egreso', descripcion: `${TAG} anterior al saldo inicial` });

    // Clientes con distintos días de crédito + facturas
    const cli = async (k: string, dias: number | null) => crear('clientes', { airtable_id: aid('cli' + k), razon_social: `${TAG} CLIENTE ${k}`, nombre_empresa: `${TAG} CLIENTE ${k}`, dias_credito: dias });
    const [c15, c45, cNull] = [await cli('15', 15), await cli('45', 45), await cli('ND', null)];
    const fact = async (k: string, cliente: string, emision: string, total: number) => crear('facturas_clientes', { airtable_id: aid('fac' + k), no_factura: `${TAG}-${k}`, cliente_id: cliente, fecha_emision: emision, total, subtotal: total, estado: 'EMITIDA' });
    await fact('F1', c15, d(-5), 20000);  esperado.push({ fecha: d(10), tipo: 'ingreso', monto: 20000, que: 'F1 (15 días)' });
    await fact('F2', c45, d(-5), 30000);  esperado.push({ fecha: d(40), tipo: 'ingreso', monto: 30000, que: 'F2 (45 días)' });
    await fact('F3', cNull, d(-40), 8000);   // esperada hoy−10 → cobranza vencida, días por defecto
    await fact('F4', c15, d(-5), 10000);     // se cede → no es ingreso propio

    // Factoraje sin recurso (reserva 10%, sin comisión/interés) + cesión de F4
    const fin1 = await A2.crearAcreedor({ nombreAcreedor: `${TAG} FINANCIERA`, tipoProducto: 'Factoraje', tipoAcreedor: 'Financiera' });
    if (!fin1.ok) throw new Error(fin1.error);
    creados.push(['acreedores', String((await sb.from('acreedores').select('id').eq('airtable_id', fin1.acreedorId).single()).data!.id)]);
    const rf = await D.crearDeuda({ acreedorId: fin1.acreedorId, nombreDeuda: `${TAG} Factoraje`, tipoDocumento: 'Factoraje', fechaEmision: d(-3), moneda: 'Q', montoOriginal: 9000, fechaVencimiento: d(50), reserva: 0.1, conRecurso: false });
    if (!rf.ok) throw new Error(rf.error);
    creados.push(['deudas', String((await sb.from('deudas').select('id').eq('airtable_id', rf.deudaId).single()).data!.id)]);
    const { getFacturas } = await import('../src/lib/db/facturas');
    const f4 = (await getFacturas()).find(f => f.noFactura === `${TAG}-F4`)!;
    const rc = await F.cederFacturas({ factorajeId: rf.deudaId, items: [{ facturaId: f4.id }], usuario: 'validador@tesoreria' });
    ok(rc.ok, `F4 cedida al factoraje: ${rc.ok ? rc.mensaje : rc.error}`);
    esperado.push({ fecha: d(50), tipo: 'ingreso', monto: 1000, que: 'reserva del factoraje' });

    // Préstamo con términos: 12,000 · 12 cuotas · día 20 · primera cuota hace 2 meses · sin interés
    const banco2 = await A2.crearAcreedor({ nombreAcreedor: `${TAG} BANCO`, tipoProducto: 'Préstamo', tipoAcreedor: 'Banco' });
    if (!banco2.ok) throw new Error(banco2.error);
    creados.push(['acreedores', String((await sb.from('acreedores').select('id').eq('airtable_id', banco2.acreedorId).single()).data!.id)]);
    const primera = M.sumarMeses(H, -2, 20);
    const rp = await D.crearDeuda({ acreedorId: banco2.acreedorId, nombreDeuda: `${TAG} Préstamo`, tipoDocumento: 'Préstamo', fechaEmision: d(-70), moneda: 'Q', montoOriginal: 12000, plazoMeses: 12, diaPagoFijo: 20, fechaPrimerCuota: primera });
    if (!rp.ok) throw new Error(rp.error);
    creados.push(['deudas', String((await sb.from('deudas').select('id').eq('airtable_id', rp.deudaId).single()).data!.id)]);
    const cuotasFechas = Array.from({ length: 12 }, (_, k) => M.sumarMeses(primera, k, 20)).filter(f => f >= H);
    const cuotaP = Math.round(12000 / cuotasFechas.length * 100) / 100;
    cuotasFechas.forEach((f, k) => f <= hasta && esperado.push({ fecha: f, tipo: 'egreso', monto: k === cuotasFechas.length - 1 ? Math.round((12000 - cuotaP * (cuotasFechas.length - 1)) * 100) / 100 : cuotaP, que: `cuota préstamo ${f}` }));

    // Deuda sin términos (factura de proveedor a crédito): solo capital al vencimiento
    const rs = await D.crearDeuda({ acreedorId: banco2.acreedorId, nombreDeuda: `${TAG} Factura proveedor`, tipoDocumento: 'Factura', fechaEmision: d(-5), moneda: 'Q', montoOriginal: 5000, fechaVencimiento: d(20) });
    if (!rs.ok) throw new Error(rs.error);
    creados.push(['deudas', String((await sb.from('deudas').select('id').eq('airtable_id', rs.deudaId).single()).data!.id)]);
    esperado.push({ fecha: d(20), tipo: 'egreso', monto: 5000, que: 'deuda solo capital' });

    // Recurrente mensual 3,000 el día 10 + una obligación grande que fuerza caja negativa
    await crear('obligaciones_recurrentes', { airtable_id: aid('obl1'), nombre: `${TAG} Alquiler`, monto_estimado: 3000, dia_pago: 10, frecuencia: 'Mensual', activo: true });
    for (let k = 0; k < 9; k++) {
      const f = M.sumarMeses(`${H.slice(0, 7)}-10`, k, 10);
      if (f >= H && f <= hasta) esperado.push({ fecha: f, tipo: 'egreso', monto: 3000, que: `alquiler ${f}` });
    }
    const fNeg = d(35);
    await crear('obligaciones_recurrentes', { airtable_id: aid('obl2'), nombre: `${TAG} Pago extraordinario`, monto_estimado: 200000, dia_pago: Number(fNeg.slice(8)), frecuencia: 'Mensual', fecha_inicio: fNeg, fecha_fin: fNeg, activo: true });
    esperado.push({ fecha: fNeg, tipo: 'egreso', monto: 200000, que: 'pago extraordinario' });

    // Planilla: período de prueba con una línea pendiente (neto + IGSS patronal/2)
    const emp = (await getEmpleados({ status: 'ACTIVO' })).find(e => e.empresaEmpleadora === EMPRESA_EMPLEADORA_DEFAULT && !e.esHonorarios);
    const qFecha = M.fechasQuincena(d(1), hasta)[1];
    if (emp) {
      const { data: empRow } = await sb.from('empleados').select('id').eq('airtable_id', emp.id).single();
      const per = await crear('periodos', { airtable_id: aid('per'), periodo: `${TAG} Q`, fecha_inicio: M.sumarDias(qFecha, -14), fecha_fin: qFecha, estado: 'Abierto' });
      await crear('planilla', { airtable_id: aid('pla'), periodo_id: per, empleado_id: empRow!.id, fecha_pago: qFecha, neto_pagar: 4000, igss: 0, estado_pago: 'Pendiente' });
      esperado.push({ fecha: qFecha, tipo: 'egreso', monto: Math.round((4000 + emp.igssPatronal / 2) * 100) / 100, que: `planilla ${emp.nombre}` });
    } else ok(false, 'no hay empleado activo de esta empresa para la línea de planilla');

    /* ── Correr la fuente real ── */
    const { eventos, supuestos } = await T.getEventosCaja(H, hasta);
    const mios = eventos.filter(e => e.descripcion.includes(TAG));

    ok(supuestos.saldoInicial.bancos.some(b => b.nombre.includes(TAG) && b.saldo === 54000 && b.movimientos === 2), `saldo inicial del banco = 50,000 + 5,000 − 1,000 = ${supuestos.saldoInicial.bancos.find(b => b.nombre.includes(TAG))?.saldo} (el movimiento anterior al saldo inicial no cuenta)`);
    const otrosBancos = supuestos.saldoInicial.total - 54000;

    const clave = (e: { fecha: string; tipo: string; monto: number }) => `${e.fecha}|${e.tipo}|${e.monto.toFixed(2)}`;
    const got = mios.filter(e => e.fecha >= H).map(clave).sort();
    const want = esperado.map(clave).sort();
    const faltan = want.filter(k => !got.includes(k)), sobran = got.filter(k => !want.includes(k));
    ok(faltan.length === 0 && sobran.length === 0, `eventos de la prueba = esperados (${want.length})${faltan.length ? ` · faltan ${faltan.join(', ')}` : ''}${sobran.length ? ` · sobran ${sobran.join(', ')}` : ''}`);
    for (const x of esperado.filter(x => /F1|F2|reserva|solo capital|extraordinario|planilla/.test(x.que))) {
      ok(got.includes(clave(x)), `${x.que}: ${x.tipo} ${x.monto} el ${x.fecha}`);
    }
    ok(!eventos.some(e => e.ref?.id === f4.id) && !mios.some(e => e.descripcion.includes(`${TAG}-F4`)), 'F4 (cedida) NO aparece como ingreso');
    ok(supuestos.cedidas.facturas >= 1 && supuestos.cedidas.monto >= 10000, `supuestos: ${supuestos.cedidas.facturas} cedida(s) por ${supuestos.cedidas.monto} fuera del ingreso propio`);
    ok(!mios.some(e => e.fuente === 'factoraje' && e.tipo === 'egreso'), 'factoraje sin recurso con cesión: su capital no se proyecta como salida');
    const f3 = mios.find(e => e.descripcion.includes(`${TAG}-F3`));
    ok(!!f3 && f3.fecha === d(-10) && f3.marcas.includes('dias_credito_default'), `F3 sin días de crédito: esperada emisión + 30 = ${f3?.fecha}, marcada`);
    const solo = mios.find(e => e.descripcion.startsWith('Factura:'));
    ok(!!solo && solo.marcas.includes('terminos_incompletos') && solo.monto === 5000, 'deuda sin términos: solo capital, marcada términos incompletos');
    if (emp) ok(!eventos.some(e => e.fuente === 'planilla' && e.fecha === qFecha && e.marcas.includes('estimado')), `la quincena ${qFecha} ya tiene período: no se duplica con el estimado`);

    /* ── Saldo acumulado: solo eventos de la prueba, contra lo esperado calculado aparte ── */
    const saldo0 = 54000;
    for (const [gran, cant] of [['semana', 13], ['mes', 6]] as const) {
      const p = M.proyectar({ hoy: H, granularidad: gran, cantidad: cant, saldoInicial: saldo0, eventos: mios });
      let s = saldo0, okSaldo = true, okNeg = true;
      const mal: string[] = [];
      for (const per of p.periodos) {
        if (per.clave === 'atrasado') { okSaldo = false; mal.push('atrasado inesperado'); continue; }
        s = Math.round((s + esperado.filter(x => x.fecha >= per.inicio && x.fecha <= per.fin).reduce((t, x) => t + (x.tipo === 'ingreso' ? x.monto : -x.monto), 0)) * 100) / 100;
        if (!casi(per.saldoFin, s)) { okSaldo = false; mal.push(`${per.etiqueta}: ${per.saldoFin} vs ${s}`); }
        if (per.negativo !== (s < 0)) okNeg = false;
      }
      ok(okSaldo, `${gran}: saldo acumulado período a período = esperado${mal.length ? ` (${mal.slice(0, 3).join('; ')})` : ''}`);
      const perNeg = p.periodos.find(x => fNeg >= x.inicio && fNeg <= x.fin)!;
      ok(okNeg && perNeg.negativo && p.primerNegativo?.clave === perNeg.clave, `${gran}: el período del pago extraordinario (${perNeg.etiqueta}) es el primero en rojo (${perNeg.saldoFin})`);
      ok(p.totalCobranzaVencida === 8000 && p.cobranzaVencida.every(e => e.descripcion.includes(`${TAG}-F3`)), `${gran}: F3 vencida (8,000) va aparte, sin sumar al saldo`);
    }
    const sinExtra = M.proyectar({ hoy: H, granularidad: 'semana', cantidad: 13, saldoInicial: saldo0, eventos: mios.filter(e => !e.descripcion.includes('extraordinario')) });
    ok(!sinExtra.primerNegativo, 'sin el pago extraordinario, ningún período queda en rojo');

    /* ── Proyección completa (con todo lo que haya en la base): coherencia ── */
    const todo = M.proyectar({ hoy: H, granularidad: 'semana', cantidad: 13, saldoInicial: supuestos.saldoInicial.total, eventos });
    let enc = true;
    for (let i = 1; i < todo.periodos.length; i++) if (!casi(todo.periodos[i].saldoInicio, todo.periodos[i - 1].saldoFin)) enc = false;
    ok(enc && casi(todo.saldoFinal, supuestos.saldoInicial.total + todo.totalIngresos - todo.totalEgresos), `proyección completa encadenada: saldo final ${todo.saldoFinal} = inicial ${supuestos.saldoInicial.total} + ${todo.totalIngresos} − ${todo.totalEgresos}${otrosBancos ? ` (otros bancos: ${otrosBancos})` : ''}`);
    console.log(`     supuestos: planilla ${supuestos.planilla.fuente} (quincena estimada ${supuestos.planilla.quincenaEstimada}, ${supuestos.planilla.empleados} empleados) · recurrentes ${supuestos.recurrentes.activas} · deudas ${supuestos.deudas.conTerminos} con términos / ${supuestos.deudas.terminosIncompletos} incompletas`);
  } catch (e) {
    ok(false, `error en la prueba: ${e instanceof Error ? e.message : e}`);
  } finally {
    console.log('\nLimpieza');
    const orden = ['planilla', 'periodos', 'obligaciones_recurrentes', 'deudas', 'acreedores', 'facturas_clientes', 'clientes', 'movimientos_bancarios', 'bancos'];
    const deudaIds = creados.filter(([t]) => t === 'deudas').map(([, id]) => id);
    if (deudaIds.length) await sb.from('factoraje_facturas').delete().in('deuda_id', deudaIds);
    for (const t of orden) {
      const ids = creados.filter(([x]) => x === t).map(([, id]) => id);
      if (!ids.length) continue;
      const { error } = await sb.from(t).delete().in('id', ids);
      if (error) console.log(`     ✗ ${t}: ${error.message}`);
    }
    let restos = 0;
    for (const [t, col] of [['bancos', 'nombre_cuenta'], ['clientes', 'razon_social'], ['facturas_clientes', 'no_factura'], ['obligaciones_recurrentes', 'nombre'], ['deudas', 'nombre_deuda'], ['acreedores', 'nombre_acreedor'], ['periodos', 'periodo'], ['movimientos_bancarios', 'descripcion']] as const) {
      const { count } = await sb.from(t).select('id', { count: 'exact', head: true }).like(col, `${TAG}%`);
      restos += count ?? 0;
    }
    const { count: ces } = await sb.from('factoraje_facturas').select('id', { count: 'exact', head: true }).eq('created_by', 'validador@tesoreria');
    ok(restos === 0 && (ces ?? 0) === 0, `limpieza verificada: 0 filas con ${TAG} y 0 cesiones de prueba`);
    fin();
  }
})();
