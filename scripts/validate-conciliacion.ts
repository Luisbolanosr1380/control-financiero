/**
 * CONCILIACIÓN BANCARIA — validador.
 *
 *  A. Motor y CSV (puros): agrupación de cobros, montos, sugerencias,
 *     cuadre, dirección contable del ajuste, parser de estados de cuenta.
 *  B. Permisos: matriz + guard en la primera línea de cada action.
 *  C. E2E en la base indicada (requiere migración 009): el escenario
 *     completo del brief con la capa de datos REAL, y limpieza total.
 *
 * Uso: npx tsx --conditions=react-server scripts/validate-conciliacion.ts [hit|golden] [--sin-e2e]
 *   (--conditions=react-server: la capa de datos es 'server-only')
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

(async () => {
  const M = await import('../src/lib/conciliacion/motor');
  const C = await import('../src/lib/conciliacion/csv');

  /* ───────────── A. Motor ───────────── */
  console.log('\nA1. Documentos');
  const cobros = [
    { id: 'c1', cobro_grupo_id: 'G1', fecha_cobro: '2026-10-01', referencia: 'TRF-881', metodo: 'Transferencia', estado_cobro: 'Activo', es_conciliado: false, monto_cobrado: 600, monto_cobro_gtq: 600, descripcion: 'Cobro A' },
    { id: 'c2', cobro_grupo_id: 'G1', fecha_cobro: '2026-10-01', referencia: 'TRF-881', metodo: 'Transferencia', estado_cobro: 'Activo', es_conciliado: false, monto_cobrado: 400, monto_cobro_gtq: 400, descripcion: 'Cobro A' },
    { id: 'c3', cobro_grupo_id: 'G1', fecha_cobro: '2026-10-01', referencia: null, metodo: 'Retención IVA', estado_cobro: 'Activo', es_conciliado: false, monto_cobrado: 60, monto_cobro_gtq: 60, descripcion: 'Cobro A' },
    { id: 'c4', cobro_grupo_id: null, fecha_cobro: '2026-10-03', referencia: null, metodo: 'Cheque', estado_cobro: 'Anulado', es_conciliado: false, monto_cobrado: 999, monto_cobro_gtq: 999, descripcion: 'Anulado' },
  ];
  const docs = M.agruparCobros(cobros, 'GTQ', new Map());
  ok(docs.length === 1 && docs[0].monto === 1000 && docs[0].registros.length === 2, 'grupo G1 = 1 evento de Q1,000 (2 registros); retención y anulado fuera');
  ok(M.montoPago({ monto_pago: 800, monto_interes: 150, monto_mora: 0, monto_comision: 10, tipo_cambio: 1 }, 'GTQ') === 960, 'pago al banco = capital + interés + comisión (960, no 800)');
  ok(M.montoCobro({ monto_cobrado: 100, monto_cobro_gtq: 780 }, 'USD') === 100 && M.montoCobro({ monto_cobrado: 100, monto_cobro_gtq: 780 }, 'GTQ') === 780, 'cobro en moneda del banco (USD 100 / GTQ 780)');

  console.log('\nA2. Sugerencias');
  const mov = (monto: number, fecha = '2026-10-02', referencia = '', tipo: 'Ingreso' | 'Egreso' = 'Ingreso') =>
    ({ id: 'm', bancoId: 'b', fecha, monto, tipo, descripcion: '', referencia, conciliado: false, asientoId: null, origen: 'manual', aplicado: 0 });
  const d = (key: string, monto: number, fecha: string, referencia = '', tipo: 'cobro' | 'pago' | 'gasto' = 'cobro') =>
    ({ key, tipo, registros: [{ id: key, monto }], fecha, monto, referencia, descripcion: key, conciliado: false, movimientoId: null });
  const pool = [d('A', 1000, '2026-10-01', 'TRF-8810'), d('B', 1000, '2026-10-06'), d('C', 990, '2026-10-02'), d('D', 300, '2026-10-01'), d('E', 200, '2026-10-02'), d('P', 1000, '2026-10-02', '', 'pago')];
  const s1 = M.sugerir(mov(1000, '2026-10-02', '00008810'), pool);
  ok(s1[0]?.docKeys[0] === 'A' && s1[0].confianza === 'alta', 'monto exacto + referencia (00008810 ≡ TRF-8810) + ±3 días → ALTA, primera');
  ok(!M.refCoincide('881', 'TRF-881'), 'referencias de menos de 4 caracteres no cuentan (evita falsos positivos)');
  ok(M.sugerir({ ...mov(1000, '2026-10-02'), descripcion: 'DEP CLIENTE REF TRF-8810' }, pool)[0]?.confianza === 'alta', 'la referencia también se busca en la descripción del banco');
  ok(s1.some(s => s.docKeys[0] === 'B' && s.confianza === 'media'), 'monto exacto + 4 días sin referencia → MEDIA');
  ok(s1.some(s => s.docKeys[0] === 'C' && s.confianza === 'baja'), 'monto aproximado (diferencia 10) → BAJA');
  ok(!s1.some(s => s.docKeys.includes('P')), 'un ingreso nunca sugiere pagos (sentido)');
  const s2 = M.sugerir(mov(500, '2026-10-02'), pool);
  ok(s2.some(s => s.docKeys.length === 2 && s.docKeys.includes('D') && s.docKeys.includes('E')), 'depósito agrupado sugerido: 300 + 200 = 500');
  ok(M.sugerir(mov(1000, '2026-12-30'), pool).length === 0, 'fuera de la ventana de fechas → sin sugerencias');

  console.log('\nA3. Cuadre');
  const base0 = { saldoInicial: 10000, fechaSaldoInicial: '2026-09-30', desde: '2026-10-01', hasta: '2026-10-31' };
  const mC = { ...mov(1000, '2026-10-02'), id: 'm1', conciliado: true, aplicado: 1000 };
  const docC = { ...d('A', 1000, '2026-10-01'), conciliado: true, movimientoId: 'm1' };
  const c1 = M.calcularCuadre({ ...base0, movimientos: [mC], docs: [docC] });
  ok(c1.estado === 'cuadrado' && c1.saldoBanco === 11000 && c1.saldoLibros === 11000, `todo conciliado → 🟢 (banco ${c1.saldoBanco} = libros ${c1.saldoLibros})`);
  const mPend = { ...mov(25, '2026-10-05', '', 'Egreso'), id: 'm2' };
  const docPend = d('B', 700, '2026-10-06');
  const c2 = M.calcularCuadre({ ...base0, movimientos: [mC, mPend], docs: [docC, docPend] });
  ok(c2.estado === 'descuadrado' && c2.diferencia === -725 && c2.explicado === -725 && c2.noExplicado === 0, `pendientes → 🔴 diferencia ${c2.diferencia} explicada por tránsito`);
  const mAj = { ...mov(995, '2026-10-02'), id: 'm3', conciliado: true, aplicado: 1000 };
  const c3 = M.calcularCuadre({ ...base0, movimientos: [mAj], docs: [{ ...docC, movimientoId: 'm3' }] });
  ok(c3.estado === 'cuadrado' && c3.sinDocumentoContabilizado === -5, 'ajuste de comisión (995 vs 1000) cuadra vía porción sin documento');
  const c4 = M.calcularCuadre({ ...base0, movimientos: [{ ...mov(50, '2026-09-15'), id: 'viejo' }], docs: [] });
  ok(c4.saldoBanco === 10000, 'movimientos anteriores al saldo inicial no se suman (ya están en el saldo)');

  console.log('\nA4. Dirección contable de la porción sin documento');
  const p = (tipo: 'Ingreso' | 'Egreso', dif: number) => M.partidasSinDocumento({ tipo, diferencia: dif, cuentaContrapartidaId: 'CTA', cuentaBancoId: 'BCO', bancoId: 'b', descripcion: 'x', periodo: '2026-10' });
  const debe = (ps: ReturnType<typeof p>) => ps.find(x => x.debe > 0)!.cuenta_id;
  ok(debe(p('Egreso', 25)) === 'CTA', 'comisión (egreso sin doc): Dr comisión / Cr banco');
  ok(debe(p('Ingreso', 40)) === 'BCO', 'intereses ganados (ingreso sin doc): Dr banco / Cr ingreso');
  ok(debe(p('Ingreso', -5)) === 'CTA', 'depósito menor a lo cobrado: Dr comisión / Cr banco');
  ok(debe(p('Egreso', 5)) === 'CTA', 'egreso mayor al pago: Dr comisión / Cr banco');
  ok(p('Egreso', 25).reduce((s, x) => s + x.debe - x.haber, 0) === 0, 'partidas balanceadas');

  console.log('\nA5. CSV');
  ok(C.parsearMonto('1,234.56') === 1234.56 && C.parsearMonto('1.234,56') === 1234.56 && C.parsearMonto('(150.00)') === -150 && C.parsearMonto('Q -75') === -75 && Number.isNaN(C.parsearMonto('abc')), 'montos: 1,234.56 · 1.234,56 · (150.00) · Q -75 · basura');
  ok(C.parsearFecha('02/10/2026') === '2026-10-02' && C.parsearFecha('2026-10-02') === '2026-10-02' && C.parsearFecha('31/02/2026') === '', 'fechas dd/mm/aaaa, ISO, inválida');
  const csv1 = 'Fecha;Descripción;Referencia;Débito;Crédito\n01/10/2026;"DEPOSITO CLIENTE, S.A.";881;;1.000,00\n02/10/2026;COMISION;ND-1;25,00;\n03/10/2026;SALDO;;;\n';
  const t1 = C.parsearCsv(csv1);
  const m1 = C.sugerirMapeo(t1.encabezados);
  ok(t1.separador === ';' && m1.debito === 3 && m1.credito === 4, 'detecta ";" y columnas Débito/Crédito');
  const f1 = C.normalizarFilas(t1, m1);
  ok(f1[0].tipo === 'Ingreso' && f1[0].monto === 1000 && f1[0].descripcion === 'DEPOSITO CLIENTE, S.A.', 'crédito → Ingreso 1000 (comillas con coma)');
  ok(f1[1].tipo === 'Egreso' && f1[1].monto === 25, 'débito → Egreso 25 (monto positivo + tipo)');
  ok(!!f1[2].error, 'fila de saldo sin montos → error, no se importa');
  const t2 = C.parsearCsv('fecha,descripcion,monto\n2026-10-01,ABONO,500\n2026-10-02,CARGO,-120.50\n');
  const f2 = C.normalizarFilas(t2, C.sugerirMapeo(t2.encabezados));
  ok(f2[0].tipo === 'Ingreso' && f2[1].tipo === 'Egreso' && f2[1].monto === 120.5, 'una columna con signo → Ingreso/Egreso');
  ok(C.claveDuplicado('b', f2[0]) === C.claveDuplicado('b', { ...f2[0] }) && C.claveDuplicado('b', f2[0]) !== C.claveDuplicado('b', { ...f2[0], tipo: 'Egreso' }), 'clave de duplicado incluye banco+fecha+monto+tipo+referencia');

  /* ───────────── B. Permisos ───────────── */
  console.log('\nB. Permisos');
  const R = await import('../src/lib/auth/roles');
  ok(R.puede('auxiliar', 'registrar_movimiento') && !R.puede('auxiliar', 'conciliar'), 'auxiliar carga movimientos pero NO concilia');
  ok(R.puede('contador', 'conciliar') && R.puede('admin', 'conciliar'), 'contador y admin concilian');
  ok(R.puede('lectura', 'ver') && !R.puede('lectura', 'registrar_movimiento') && !R.puede('lectura', 'conciliar'), 'lectura solo ve');
  const src = fs.readFileSync('src/app/(app)/conciliacion/actions.ts', 'utf8');
  const esperado: Record<string, string> = {
    crearMovimientoAction: 'registrar_movimiento', previsualizarImportacionAction: 'registrar_movimiento', importarMovimientosAction: 'registrar_movimiento',
    borrarMovimientoAction: 'conciliar', conciliarAction: 'conciliar', deshacerConciliacionAction: 'conciliar', contabilizarMovimientoAction: 'conciliar',
  };
  for (const [fn, acc] of Object.entries(esperado)) {
    const i = src.indexOf(`export async function ${fn}`);
    const cuerpo = src.slice(src.indexOf('{\n', src.indexOf(')', i)) + 2, i + 900).trim().split('\n')[0];
    ok(cuerpo.includes(`autorizar('${acc}')`), `${fn}: primera línea autorizar('${acc}')`);
  }
  ok(fs.readFileSync('src/app/(app)/conciliacion/page.tsx', 'utf8').includes("exigirPagina('ver')"), 'página /conciliacion exige ver');

  /* ───────────── C. E2E ───────────── */
  if (process.argv.includes('--sin-e2e')) return fin();
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const { error: e009 } = await sb.from('conciliacion_items').select('id').limit(1);
  if (e009) { console.log(`\nC. E2E omitido: la migración 009 no está aplicada en ${base} (${e009.message}).`); return fin(); }

  console.log(`\nC. E2E en ${base.toUpperCase()} (capa de datos real)`);
  const DB = await import('../src/lib/db/conciliacion');
  const TAG = `E2E-CONC-${Date.now()}`;
  const USR = 'validador@conciliacion';
  const creados: Array<[string, string]> = [];
  const crear = async (tabla: string, fila: Record<string, unknown>) => {
    const { data, error } = await sb.from(tabla).insert(fila).select('id').single();
    if (error) throw new Error(`${tabla}: ${error.message}`);
    creados.push([tabla, String(data.id)]);
    return String(data.id);
  };
  const asientosDe = async () => (await sb.from('asientos').select('id', { count: 'exact', head: false }).eq('origen', 'CONCILIACION BANCARIA')).count ?? 0;
  const totalAsientos = async () => (await sb.from('asientos').select('id', { count: 'exact', head: false })).count ?? 0;

  try {
    // 1. Banco con cuenta contable y saldo inicial
    const { data: ctaB } = await sb.from('cuentas').select('id').eq('codigo_path', '1-1-2').maybeSingle();
    const ctaBanco = await crear('cuentas', { codigo_path: `1-1-2-9${String(Date.now()).slice(-3)}`, nombre: `${TAG} Banco`, nivel: 4, parent_path: '1-1-2', parent_id: ctaB?.id ?? null });
    const { data: ctaCom } = await sb.from('cuentas').select('id').eq('codigo_path', '6-5-2').maybeSingle();
    const banco = await crear('bancos', { nombre_cuenta: `${TAG} BANCO`, banco: 'E2E', moneda: 'GTQ', saldo_inicial: 10000, fecha_saldo_inicial: '2026-09-30', cuenta_contable_id: ctaBanco, activo: true });
    ok(!!ctaCom?.id, 'cuenta 6-5-2 Comisiones Bancarias disponible para ajustes');

    // 2. Cobro, pago y gasto contra ese banco
    const cliente = await crear('clientes', { razon_social: `${TAG} CLIENTE`, nombre_empresa: `${TAG} CLIENTE` });
    const factura = await crear('facturas_clientes', { no_factura: `${TAG}-F1`, cliente_id: cliente, fecha_emision: '2026-09-25', total: 1500, estado: 'COBRADO' });
    const cobroA = await crear('cobros_clientes', { factura_id: factura, fecha_cobro: '2026-10-01', monto_cobrado: 1000, monto_cobro_gtq: 1000, cuenta_banco_id: banco, metodo: 'Transferencia', referencia: 'TRF-881', estado_cobro: 'Activo', cobro_grupo_id: `${TAG}-G1` });
    const cobroB = await crear('cobros_clientes', { factura_id: factura, fecha_cobro: '2026-10-03', monto_cobrado: 300, monto_cobro_gtq: 300, cuenta_banco_id: banco, metodo: 'Transferencia', estado_cobro: 'Activo', cobro_grupo_id: `${TAG}-G2` });
    const cobroC = await crear('cobros_clientes', { factura_id: factura, fecha_cobro: '2026-10-03', monto_cobrado: 200, monto_cobro_gtq: 200, cuenta_banco_id: banco, metodo: 'Transferencia', estado_cobro: 'Activo', cobro_grupo_id: `${TAG}-G3` });
    const acreedor = await crear('acreedores', { nombre_acreedor: `${TAG} ACREEDOR` });
    const deuda = await crear('deudas', { acreedor_id: acreedor, nombre_deuda: `${TAG} DEUDA`, monto_original: 5000 });
    const pago = await crear('pagos_proveedores', { deuda_id: deuda, fecha_pago: '2026-10-04', cuenta_banco_id: banco, monto_pago: 800, monto_interes: 150, monto_comision: 10, monto_pago_gtq: 800, tipo_cambio: 1, estado_pago: 'Activo' });
    const gasto = await crear('gastos', { fecha: '2026-10-05', monto: 450, banco_id: banco, metodo_pago: 'Contado', estado: 'Pagado', descripcion: TAG });
    const asientosIni = await totalAsientos();
    ok(true, 'banco (cuenta contable + saldo inicial 10,000), 3 cobros, 1 pago (960 al banco), 1 gasto 450');

    // 3. Movimientos: manual + CSV (con un duplicado)
    await DB.crearMovimientoManual({ bancoId: banco, fecha: '2026-10-01', monto: 1000, tipo: 'Ingreso', descripcion: 'DEPOSITO TRF 881', referencia: 'TRF-881' }, USR);
    const csv = C.parsearCsv(['Fecha,Descripcion,Referencia,Debito,Credito',
      '01/10/2026,DEPOSITO TRF 881,TRF-881,,"1,000.00"',      // duplicado del manual
      '03/10/2026,DEPOSITO AGRUPADO,,,500.00',
      '04/10/2026,PAGO PRESTAMO,,965.00,',                      // 960 + 5 de comisión del banco
      '05/10/2026,CHEQUE 1001,CH-1001,450.00,',
      '06/10/2026,COMISION MANEJO,ND-77,25.00,'].join('\n'));
    const filas = C.normalizarFilas(csv, C.sugerirMapeo(csv.encabezados));
    const prev = await DB.previsualizarImportacion(banco, filas);
    ok(prev.nuevos.length === 4 && prev.duplicados.length === 1, `vista previa: ${prev.nuevos.length} nuevos, ${prev.duplicados.length} duplicado (el manual)`);
    await DB.importarMovimientos(banco, filas, USR);
    const re = await DB.importarMovimientos(banco, filas, USR);
    ok(re.nuevos.length === 0 && re.duplicados.length === 5, 're-subir el mismo estado → 0 nuevos, 5 duplicados');
    const { data: movs } = await sb.from('movimientos_bancarios').select('id, monto, tipo, descripcion').eq('banco_id', banco);
    ok((movs ?? []).length === 5 && (movs ?? []).every(m => Number(m.monto) > 0), '5 movimientos, todos con monto positivo + tipo');
    const movId = (desc: string) => (movs ?? []).find(m => m.descripcion === desc)!.id as string;

    // 4. Sugerencias del motor contra datos reales
    let datos = await DB.getDatosConciliacion(banco, '2026-10-01', '2026-10-31');
    const sugTrf = datos.sugerencias[movId('DEPOSITO TRF 881')] ?? [];
    ok(sugTrf[0]?.docKeys[0] === `cobro:${TAG}-G1` && sugTrf[0].confianza === 'alta', 'motor sugiere el cobro correcto con confianza ALTA');
    const sugAgr = datos.sugerencias[movId('DEPOSITO AGRUPADO')] ?? [];
    ok(sugAgr.some(s => s.docKeys.length === 2), 'motor sugiere el depósito agrupado (300 + 200)');
    ok(datos.cuadre?.estado !== 'cuadrado', 'antes de conciliar el cuadre NO está en verde');

    // 5. Conciliar simple
    const r1 = await DB.conciliar({ movimientoId: movId('DEPOSITO TRF 881'), docKeys: [`cobro:${TAG}-G1`], usuario: USR });
    ok(r1.ok, `conciliar cobro: ${r1.ok ? r1.mensaje : r1.error}`);
    const { data: fa } = await sb.from('cobros_clientes').select('es_conciliado').eq('id', cobroA).single();
    const { data: it } = await sb.from('conciliacion_items').select('id, monto_aplicado, created_by').eq('cobro_id', cobroA);
    ok(fa?.es_conciliado === true && (it ?? []).length === 1 && Number(it![0].monto_aplicado) === 1000, 'flag es_conciliado + 1 item de 1000');
    const r1b = await DB.conciliar({ movimientoId: movId('DEPOSITO AGRUPADO'), docKeys: [`cobro:${TAG}-G1`], usuario: USR });
    ok(!r1b.ok, `doble conciliación del mismo cobro rechazada: ${!r1b.ok ? r1b.error : ''}`);
    // La defensa REAL: saltarse la app e insertar el item directo en la base.
    const { error: eDup } = await sb.from('conciliacion_items').insert({ movimiento_id: movId('DEPOSITO AGRUPADO'), cobro_id: cobroA, monto_aplicado: 1000, created_by: USR });
    ok(!!eDup && (eDup.code === '23505' || /uq_concitems_cobro/.test(eDup.message)), `inserción DIRECTA del mismo cobro en la base real → rechazada por el índice único parcial (${eDup?.code} ${eDup?.message?.slice(0, 60)})`);

    // 6. Depósito agrupado
    const r2 = await DB.conciliar({ movimientoId: movId('DEPOSITO AGRUPADO'), docKeys: [`cobro:${TAG}-G2`, `cobro:${TAG}-G3`], usuario: USR });
    ok(r2.ok, `depósito agrupado (2 cobros → 1 movimiento): ${r2.ok ? r2.mensaje : r2.error}`);

    // 7. Pago con diferencia (comisión del banco) → ajuste
    const r3sin = await DB.conciliar({ movimientoId: movId('PAGO PRESTAMO'), docKeys: [`pago:${pago}`], usuario: USR });
    ok(!r3sin.ok, 'pago 965 vs 960 sin cuenta de ajuste → rechazado');
    const r3 = await DB.conciliar({ movimientoId: movId('PAGO PRESTAMO'), docKeys: [`pago:${pago}`], ajuste: { cuentaId: ctaCom!.id }, usuario: USR });
    ok(r3.ok, `pago con ajuste de 5: ${r3.ok ? r3.mensaje : r3.error}`);

    // 8. Gasto + comisión sin documento
    const r4 = await DB.conciliar({ movimientoId: movId('CHEQUE 1001'), docKeys: [`gasto:${gasto}`], usuario: USR });
    ok(r4.ok, 'gasto 450 conciliado');
    const r5 = await DB.contabilizarMovimiento({ movimientoId: movId('COMISION MANEJO'), cuentaId: ctaCom!.id, usuario: USR });
    ok(r5.ok, `comisión 25 sin documento → asiento: ${r5.ok ? r5.mensaje : r5.error}`);
    const { data: mc } = await sb.from('movimientos_bancarios').select('asiento_id, conciliado').eq('id', movId('COMISION MANEJO')).single();
    const { data: pc } = await sb.from('partidas').select('debe, haber').eq('asiento_id', mc!.asiento_id);
    ok(!!mc?.asiento_id && mc.conciliado && (pc ?? []).reduce((s, x) => s + Number(x.debe), 0) === 25 && (pc ?? []).reduce((s, x) => s + Number(x.haber), 0) === 25, 'asiento de la comisión balanceado 25/25 y guardado en el movimiento');

    // 9. Cuadre en verde
    datos = await DB.getDatosConciliacion(banco, '2026-10-01', '2026-10-31');
    const cq = datos.cuadre!;
    ok(cq.estado === 'cuadrado', `cuadre 🟢: banco ${cq.saldoBanco} = libros ${cq.saldoLibros} (saldo ini 10,000 + 1,000 + 500 − 965 − 450 − 25 = 10,060)`);
    ok(cq.saldoBanco === 10060, 'saldo según banco = 10,060');

    // 10. Ningún asiento duplicado
    const nuevosAsientos = (await totalAsientos()) - asientosIni;
    ok(nuevosAsientos === 2 && (await asientosDe()) >= 2, `solo 2 asientos nuevos (ajuste 5 + comisión 25) — cobros, pago y gasto NO se re-contabilizaron (${nuevosAsientos})`);
    const { data: gOrig } = await sb.from('gastos').select('asiento_id').eq('id', gasto).single();
    ok(gOrig?.asiento_id == null, 'el gasto conserva su asiento original (aquí: ninguno) — la conciliación no le creó otro');

    // 11. Deshacer
    const d1 = await DB.deshacerConciliacion(movId('DEPOSITO AGRUPADO'), USR, 'prueba E2E');
    const { data: fb } = await sb.from('cobros_clientes').select('es_conciliado').in('id', [cobroB, cobroC]);
    const { data: itB } = await sb.from('conciliacion_items').select('id').in('cobro_id', [cobroB, cobroC]);
    ok(d1.ok && (fb ?? []).every(x => !x.es_conciliado) && (itB ?? []).length === 0, 'deshacer agrupado: items borrados, flags en false');
    const d2 = await DB.deshacerConciliacion(movId('PAGO PRESTAMO'), USR, 'prueba E2E ajuste');
    ok(d2.ok && /contra-asiento/.test(d2.ok ? d2.mensaje : ''), 'deshacer con ajuste → contra-asiento (no se borran asientos)');
    const { data: log } = await sb.from('conciliacion_log').select('accion, usuario').eq('usuario', USR);
    ok((log ?? []).filter(l => l.accion === 'deshacer').length === 2, 'bitácora registra quién y cuándo deshizo');
    datos = await DB.getDatosConciliacion(banco, '2026-10-01', '2026-10-31');
    ok(datos.cuadre!.estado === 'descuadrado' && datos.cuadre!.noExplicado === 0, 'tras deshacer, el cuadre vuelve a 🔴 con la diferencia 100% explicada por partidas en tránsito');
    const r6 = await DB.conciliar({ movimientoId: movId('PAGO PRESTAMO'), docKeys: [`pago:${pago}`], ajuste: { cuentaId: ctaCom!.id }, usuario: USR });
    ok(r6.ok, `re-conciliar con ajuste tras deshacer (ref de asiento nueva): ${r6.ok ? r6.mensaje : r6.error}`);
  } catch (e) {
    ok(false, `E2E: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    // Limpieza: asientos/partidas de la conciliación del banco de prueba, luego todo lo creado.
    const bancoId = creados.find(([t]) => t === 'bancos')?.[1];
    if (bancoId) {
      const { data: movs } = await sb.from('movimientos_bancarios').select('id').eq('banco_id', bancoId);
      const ids = (movs ?? []).map(m => m.id);
      const { data: logs } = ids.length ? await sb.from('conciliacion_log').select('detalle').in('movimiento_id', ids) : { data: [] };
      const asientos = new Set<string>();
      for (const l of logs ?? []) {
        const dd = l.detalle as Record<string, string> | null;
        for (const k of ['asiento_ajuste_id', 'asiento_id', 'asiento_revertido_id', 'contra_asiento_id']) if (dd?.[k]) asientos.add(dd[k]);
      }
      const { data: mvA } = ids.length ? await sb.from('movimientos_bancarios').select('asiento_id').in('id', ids) : { data: [] };
      for (const m of mvA ?? []) if (m.asiento_id) asientos.add(m.asiento_id);
      await sb.from('movimientos_bancarios').update({ asiento_id: null }).eq('banco_id', bancoId);
      if (asientos.size) { await sb.from('partidas').delete().in('asiento_id', [...asientos]); await sb.from('asientos').delete().in('id', [...asientos]); }
      await sb.from('movimientos_bancarios').delete().eq('banco_id', bancoId);   // cascade: items + log
    }
    for (const [tabla, id] of creados.reverse()) await sb.from(tabla).delete().eq('id', id);
    const { data: resto } = await sb.from('bancos').select('id').like('nombre_cuenta', 'E2E-CONC-%');
    const { data: restoC } = await sb.from('clientes').select('id').like('razon_social', 'E2E-CONC-%');
    ok((resto ?? []).length === 0 && (restoC ?? []).length === 0, 'limpieza: 0 datos de prueba en la base');
  }
  fin();

  function fin() {
    console.log(`\n== ${pass} 🟢 / ${fail} 🔴 ==\n`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
