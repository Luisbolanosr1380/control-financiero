/**
 * FACTORAJE — validador.
 *
 *  A. Puro: asiento parametrizado (desglose, balance, con/sin recurso, flag apagado).
 *  B. Permisos: matriz + guard en la primera línea de cada action.
 *  C. E2E en la base indicada (requiere migración 010): financiador + factoraje,
 *     cesión de 2 facturas, doble cesión rechazada (app Y 23505 directo en la
 *     base), exclusión del por cobrar propio, liberar → disponible de nuevo,
 *     limpieza total.
 *
 * Uso: npx tsx --conditions=react-server scripts/validate-factoraje.ts [hit|golden] [--sin-e2e]
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

(async () => {
  console.log('\nA. Asiento parametrizado (apagado)');
  const A = await import('../src/lib/factoraje/asiento-config');
  ok(A.GENERAR_ASIENTO_FACTORAJE === false, 'GENERAR_ASIENTO_FACTORAJE = false (nada se escribe a libros)');
  const t = { montoCedido: 100000, reservaPct: 0.1, comisionPct: 0.02, interesPct: 0.18, plazoDias: 60, conRecurso: false };
  const d = A.desglosarFactoraje(t);
  ok(d.reserva === 10000 && d.comision === 2000 && Math.abs(d.interes - 2958.9) < 0.01 && Math.abs(d.adelantoNeto - 85041.1) < 0.01, `desglose: reserva ${d.reserva} · comisión ${d.comision} · interés ${d.interes} · adelanto neto ${d.adelantoNeto}`);
  const sin = A.previewAsientoAdelanto(t, '1-1-2-1');
  ok(sin.balanceado && sin.tipo === 'sin_recurso' && sin.partidas.some(p => p.cuentaCodigo === A.CUENTAS_FACTORAJE.CXC_CLIENTES && p.haber === 100000), 'sin recurso: balanceado, Cr CxC Clientes por el cedido (venta de cartera)');
  const con = A.previewAsientoAdelanto({ ...t, conRecurso: true }, '1-1-2-1');
  ok(con.balanceado && con.tipo === 'con_recurso' && con.partidas.some(p => p.cuentaCodigo === A.CUENTAS_FACTORAJE.PASIVO_FINANCIADOR && p.haber === 100000) && !con.partidas.some(p => p.cuentaCodigo === A.CUENTAS_FACTORAJE.CXC_CLIENTES), 'con recurso: balanceado, Cr Prestamos CP, la CxC del cliente NO se da de baja');
  ok(!sin.habilitado && /PENDIENTE de validación del contador/.test(sin.nota), 'preview marcado como pendiente de validación del contador');

  console.log('\nB. Permisos');
  const R = await import('../src/lib/auth/roles');
  ok(R.puede('auxiliar', 'ceder_factura') && !R.puede('auxiliar', 'factoraje'), 'auxiliar registra la cesión pero NO libera/contabiliza');
  ok(R.puede('contador', 'factoraje') && R.puede('admin', 'factoraje') && R.puede('contador', 'gestionar_deudas'), 'contador y admin gestionan factoraje (y crean la deuda)');
  ok(!R.puede('lectura', 'ceder_factura') && R.puede('lectura', 'ver'), 'lectura solo ve');
  const src = fs.readFileSync('src/app/(app)/factoraje/actions.ts', 'utf8');
  for (const [fn, acc] of [['cederFacturasAction', 'ceder_factura'], ['cambiarEstadoCesionAction', 'factoraje'], ['previewAsientoFactorajeAction', 'factoraje'], ['contabilizarFactorajeAction', 'factoraje']]) {
    const i = src.indexOf(`export async function ${fn}`);
    const cuerpo = src.slice(src.indexOf('{\n', src.indexOf(')', i)) + 2, i + 900).trim().split('\n')[0];
    ok(cuerpo.includes(`autorizar('${acc}')`), `${fn}: primera línea autorizar('${acc}')`);
  }
  ok(fs.readFileSync('src/app/(app)/factoraje/page.tsx', 'utf8').includes("exigirPagina('ver')"), 'página /factoraje exige ver');
  ok(!fs.existsSync('src/app/(app)/bancos/loading.tsx') && /redirect\('\/conciliacion'\)/.test(fs.readFileSync('src/app/(app)/bancos/page.tsx', 'utf8')) && !/4 cuentas activas/.test(fs.readFileSync('src/app/(app)/bancos/page.tsx', 'utf8')), 'Parte 0: /bancos sin placeholder ni "4 cuentas activas"; redirige a /conciliacion');

  if (process.argv.includes('--sin-e2e')) return fin();
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const { error: e010 } = await sb.from('factoraje_facturas').select('id').limit(1);
  if (e010) { console.log(`\nC. E2E omitido: la migración 010 no está aplicada en ${base} (${e010.message}).`); return fin(); }

  console.log(`\nC. E2E en ${base.toUpperCase()} (capa de datos real)`);
  const F = await import('../src/lib/db/factoraje');
  const P = await import('../src/lib/db/facturas-pendientes');
  const D = await import('../src/lib/db/deudas');
  const TAG = `E2E-FACT-${Date.now()}`;
  const USR = 'validador@factoraje';
  const creados: Array<[string, string]> = [];
  const crear = async (tabla: string, fila: Record<string, unknown>) => {
    const { data, error } = await sb.from(tabla).insert(fila).select('id').single();
    if (error) throw new Error(`${tabla}: ${error.message}`);
    creados.push([tabla, String(data.id)]); return String(data.id);
  };
  try {
    const cliente = await crear('clientes', { razon_social: `${TAG} CLIENTE`, nombre_empresa: `${TAG} CLIENTE` });
    const fIds = [] as string[];
    for (const [no, total] of [['A', 10000], ['B', 6000], ['C', 3000]] as const) {
      fIds.push(await crear('facturas_clientes', { airtable_id: `sbw${TAG.toLowerCase().replace(/[^a-z0-9]/g, '')}${no}`.slice(0, 40), no_factura: `${TAG}-${no}`, cliente_id: cliente, fecha_emision: '2026-09-20', total, subtotal: total, estado: 'EMITIDA' }));
    }
    // NC activa sobre B: saldo B = 6000 − 1000 = 5000
    await crear('notas_credito', { factura_id: fIds[1], monto: 1000, estado: 'Activa', fecha_creacion: '2026-09-25' }).catch(() => ok(false, 'no se pudo crear la NC de prueba'));

    // Financiador (acreedor) + factoraje = deuda vía el alta EXISTENTE (reuso, no tabla paralela)
    // Financiador vía el alta de acreedores EXISTENTE (como lo haría un usuario).
    const A2 = await import('../src/lib/db/acreedores');
    const ra = await A2.crearAcreedor({ nombreAcreedor: `${TAG} FINANCIERA`, tipoProducto: 'Factoraje', tipoAcreedor: 'Financiera' });
    ok(ra.ok, `financiador creado con el alta de acreedores existente: ${ra.ok ? ra.acreedorId : ra.error}`);
    if (!ra.ok) throw new Error('sin financiador');
    const { data: acrRow } = await sb.from('acreedores').select('id').eq('airtable_id', ra.acreedorId).single();
    creados.push(['acreedores', String(acrRow!.id)]);
    const rd = await D.crearDeuda({ acreedorId: ra.acreedorId, nombreDeuda: `${TAG} Factoraje`, tipoDocumento: 'Factoraje', fechaEmision: '2026-10-01', moneda: 'Q', montoOriginal: 12000, fechaVencimiento: '2026-11-30', tasaComision: 0.02, reserva: 0.1, tasaInteresAnual: 0.18, conRecurso: false });
    ok(rd.ok, `factoraje creado con el alta de deudas existente: ${rd.ok ? rd.deudaId : rd.error}`);
    if (!rd.ok) throw new Error('sin factoraje');
    const factorajeId = rd.deudaId;
    const { data: deudaRow } = await sb.from('deudas').select('id').eq('airtable_id', factorajeId).single();
    creados.push(['deudas', String(deudaRow!.id)]);

    const lista = await F.getFactorajes();
    const mio = lista.find(f => f.id === factorajeId)!;
    ok(!!mio && mio.financiador.includes(TAG) && mio.reservaPct === 0.1 && mio.comisionPct === 0.02 && mio.conRecurso === false, `getFactorajes trae el factoraje con sus términos (reserva ${mio?.reservaPct}, comisión ${mio?.comisionPct}, ${mio?.conRecurso ? 'con' : 'sin'} recurso)`);

    const { getFacturas } = await import('../src/lib/db/facturas');
    const facts = (await getFacturas()).filter(f => f.noFactura.startsWith(TAG));
    const appId = (no: string) => facts.find(f => f.noFactura === `${TAG}-${no}`)!.id;
    const cedibles = await F.getFacturasCedibles();
    const cB = cedibles.find(c => c.noFactura === `${TAG}-B`);
    ok(!!cB && cB.saldo === 5000, `saldo cedible de B = total − NC activa = ${cB?.saldo} (esperado 5000)`);

    const sobre = await F.cederFacturas({ factorajeId, items: [{ facturaId: appId('B'), montoCedido: 5500 }], usuario: USR });
    ok(!sobre.ok && /saldo por cobrar es Q5000/.test(!sobre.ok ? sobre.error : ''), `ceder 5500 de una factura con saldo 5000 → rechazado: ${!sobre.ok ? sobre.error.slice(0, 90) : ''}`);

    const antes = await P.getFacturasPendientesCobro();
    const propioAntes = antes.totales.saldoTotalQ;
    const r1 = await F.cederFacturas({ factorajeId, items: [{ facturaId: appId('A') }, { facturaId: appId('B') }], usuario: USR });
    ok(r1.ok && /2 factura/.test(r1.ok ? r1.mensaje : ''), `ceder A y B: ${r1.ok ? r1.mensaje : r1.error}`);

    const r2 = await F.cederFacturas({ factorajeId, items: [{ facturaId: appId('A') }], usuario: USR });
    ok(!r2.ok && /ya está cedida/.test(!r2.ok ? r2.error : ''), `doble cesión por la app → rechazada: ${!r2.ok ? r2.error.slice(0, 80) : ''}`);
    const { error: eDup } = await sb.from('factoraje_facturas').insert({ deuda_id: deudaRow!.id, factura_id: fIds[0], monto_cedido: 1, created_by: USR });
    ok(!!eDup && (eDup.code === '23505' || /uq_factfact_factura_activa/.test(eDup.message)), `doble cesión DIRECTA en la base → rechazada por el índice único parcial (${eDup?.code})`);
    const mix = await F.cederFacturas({ factorajeId, items: [{ facturaId: appId('C') }, { facturaId: appId('A') }], usuario: USR });
    const { data: cC } = await sb.from('factoraje_facturas').select('id').eq('factura_id', fIds[2]);
    ok(!mix.ok && (cC ?? []).length === 0, 'cesión mixta (C libre + A cedida) → todo o nada: C NO se cedió');

    const despues = await P.getFacturasPendientesCobro();
    const filaA = despues.filas.find(f => f.noFactura === `${TAG}-A`);
    ok(!!filaA?.cedida && filaA.cedida.financiador.includes(TAG), 'pendientes marca la factura A como "Cedida · financiador"');
    ok(Math.abs(despues.totales.saldoTotalQ - (propioAntes - 15000)) < 0.01 && despues.totales.saldoCedidoQ >= 15000 && despues.totales.numCedidas >= 2, `por cobrar PROPIO bajó exactamente 15,000 (A 10,000 + B 5,000) y pasó a cedidas (${despues.totales.saldoCedidoQ})`);
    ok(!despues.aging.some(t => t.montoQ < 0) && despues.aging.reduce((s, t) => s + t.montoQ, 0) - despues.totales.saldoTotalQ < 0.01, 'el aging solo suma el por cobrar propio');

    const ces = (await F.getFactorajes()).find(f => f.id === factorajeId)!.cesiones;
    const cesA = ces.find(c => c.noFactura === `${TAG}-A`)!;
    const aux = await F.cambiarEstadoCesion({ cesionId: cesA.id, estado: 'Liberada', usuario: USR, nota: 'E2E' });
    ok(aux.ok, `liberar A: ${aux.ok ? aux.mensaje : aux.error}`);
    const otra = await F.cambiarEstadoCesion({ cesionId: cesA.id, estado: 'Pagada', usuario: USR });
    ok(!otra.ok, 'cambiar una cesión ya liberada → rechazado');
    const cedibles2 = await F.getFacturasCedibles();
    ok(cedibles2.some(c => c.noFactura === `${TAG}-A`) && !cedibles2.some(c => c.noFactura === `${TAG}-B`), 'tras liberar, A vuelve a estar disponible y B sigue cedida');
    const r3 = await F.cederFacturas({ factorajeId, items: [{ facturaId: appId('A'), montoCedido: 4000 }], usuario: USR });
    ok(r3.ok, 'A se puede ceder de nuevo (parcial, 4,000)');
    const fin2 = await P.getFacturasPendientesCobro();
    ok(Math.abs(fin2.totales.saldoTotalQ - (propioAntes - 15000)) < 0.01, 'el por cobrar propio excluye la factura completa aunque la cesión sea parcial (su cobro va al financiador)');
    const asientosConc = (await sb.from('asientos').select('id', { count: 'exact', head: false }).eq('origen', 'FACTORAJE')).count ?? 0;
    ok(asientosConc === 0, 'cero asientos de FACTORAJE generados (flag apagado)');
    const pv = await F.getPreviewAsiento(factorajeId);
    ok(pv.ok && pv.preview.balanceado && !pv.preview.habilitado, 'preview del asiento balanceado y marcado como apagado');
  } catch (e) {
    ok(false, `E2E: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    const deudas = creados.filter(([t]) => t === 'deudas').map(([, id]) => id);
    if (deudas.length) await sb.from('factoraje_facturas').delete().in('deuda_id', deudas);
    await sb.from('notas_credito').delete().in('factura_id', creados.filter(([t]) => t === 'facturas_clientes').map(([, id]) => id));
    for (const [tabla, id] of creados.reverse()) await sb.from(tabla).delete().eq('id', id);
    const { data: resto } = await sb.from('clientes').select('id').like('razon_social', 'E2E-FACT-%');
    const { data: restoA } = await sb.from('acreedores').select('id').or('nombre_acreedor.like.E2E-FACT-%,nombre_legal.like.E2E-FACT-%');
    ok((resto ?? []).length === 0 && (restoA ?? []).length === 0, 'limpieza: 0 datos de prueba en la base');
  }
  fin();
})();
