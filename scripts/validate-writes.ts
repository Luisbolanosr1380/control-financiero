/**
 * FASE 2 — Validación de ESCRITURAS en staging (contra la base real, con
 * registros de PRUEBA que se crean y se borran al final).
 *
 * Requiere haber corrido supabase/04_fase2_writes.sql (RPCs).
 *
 * Por operación valida:
 *  1. La operación real sobre un registro de prueba deja TODAS las tablas
 *     afectadas correctas.
 *  2. ATOMICIDAD: se fuerza un fallo a mitad → nada quedó escrito.
 *  3. IDEMPOTENCIA donde aplica (asiento duplicado → rechazo sin duplicar).
 *
 * Uso:  npx tsx scripts/validate-writes.ts
 */

import fs from 'node:fs';
import path from 'node:path';

const envFile = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const [k, ...rest] = t.split('=');
    if (!(k in process.env)) process.env[k.trim()] = rest.join('=').trim().replace(/^"|"$/g, '');
  }
}
// Staging: TODO lee y escribe Supabase durante esta corrida.
process.env.DATA_SOURCE_FORCE = 'supabase';
process.env.WRITE_SOURCE_FORCE = 'supabase';

let fallas = 0;
const okLog = (msg: string) => console.log(`  🟢 ${msg}`);
const badLog = (msg: string) => { fallas += 1; console.log(`  🔴 ${msg}`); };
const check = (cond: boolean, msg: string) => (cond ? okLog(msg) : badLog(msg));

async function main() {
  const { supabase } = await import('../src/lib/supabase/client');
  const { invalidarBridge } = await import('../src/lib/supabase/id-bridge');
  const sb = supabase();
  if (!sb) throw new Error('Supabase no configurado');

  // ¿RPCs presentes?
  {
    const { error } = await sb.rpc('fase2_nuevo_id');
    if (error) {
      console.log('✗ Las RPCs de 04_fase2_writes.sql NO están instaladas.');
      console.log('  Corré supabase/04_fase2_writes.sql en el SQL Editor y re-ejecutá este script.');
      process.exit(2);
    }
    okLog('RPCs fase2 instaladas');
  }

  const basura: Array<[string, string]> = [];   // [tabla, airtable_id] para cleanup (orden inverso)
  const marca = `TEST-F2-${Date.now()}`;

  try {
    /* ════════ setup: registros de prueba base ════════ */
    const cliente = await sb.from('clientes').insert({
      airtable_id: `${marca}-cli`, nombre_empresa: `${marca} Cliente`, dias_credito: 15, activo: true,
    }).select('id').single();
    basura.push(['clientes', `${marca}-cli`]);
    const factura = await sb.from('facturas_clientes').insert({
      airtable_id: `${marca}-fac`, no_factura: marca, cliente_id: cliente.data!.id,
      fecha_emision: '2026-08-01', subtotal: 892.86, iva: 107.14, total: 1000, estado: 'EMITIDA',
    }).select('id').single();
    basura.push(['facturas_clientes', `${marca}-fac`]);
    const banco = await sb.from('bancos').select('id, airtable_id, nombre_cuenta, cuenta_contable_id').limit(1).single();
    invalidarBridge();

    /* ════════ 2.1 COBROS ════════ */
    console.log('\n══ 2.1 registrarCobro / anularCobro ══');
    const { registrarCobro, anularCobro, getSaldoPendiente } = await import('../src/lib/db/cobros');
    const r1 = await registrarCobro({
      noFactura: marca, fecha: '2026-08-04',
      componentes: [
        { monto: 600, metodo: 'Transferencia', bancoId: banco.data!.airtable_id, referencia: 'ref-test' },
        { monto: 100, metodo: 'Retención IVA', referencia: 'const-123' },
      ],
    });
    check(r1.ok && r1.cobrosCreados === 2, `registrarCobro parcial ok (${r1.cobrosCreados} cobros, saldo ${r1.saldoNuevo})`);
    check(r1.estadoNuevo === 'COBRADO PARCIAL' && r1.saldoNuevo === 300, `estado COBRADO PARCIAL y saldo 300 (${r1.estadoNuevo}/${r1.saldoNuevo})`);
    {
      const { data } = await sb.from('facturas_clientes').select('estado').eq('airtable_id', `${marca}-fac`).single();
      check((data?.estado ?? '') === 'COBRADO PARCIAL ', `factura.estado actualizado en la MISMA transacción ('${data?.estado}')`);
      const { data: cobs } = await sb.from('cobros_clientes').select('airtable_id, cobro_grupo_id, estado_cobro').eq('cobro_grupo_id', r1.grupoId);
      check((cobs?.length ?? 0) === 2 && cobs!.every(c => c.estado_cobro === 'Activo'), 'cobros insertados con grupo + Estado_Cobro=Activo');
      for (const c of cobs ?? []) basura.push(['cobros_clientes', c.airtable_id]);
    }
    // saldo por la ruta de lectura de la app
    const saldo1 = await getSaldoPendiente(marca);
    check(saldo1?.saldoPendiente === 300 && saldo1?.estado === 'COBRADO PARCIAL', `getSaldoPendiente refleja 300 / COBRADO PARCIAL`);

    // Banco inválido debe RECHAZARSE antes de escribir (paridad con Airtable).
    const rBadBanco = await registrarCobro({
      noFactura: marca, fecha: '2026-08-04',
      componentes: [{ monto: 100, metodo: 'Transferencia', bancoId: 'recNOEXISTE123456', referencia: 'x' }],
    });
    check(!rBadBanco.ok, `banco inexistente rechazado (${(rBadBanco.error ?? '').slice(0, 60)}…)`);

    // ATOMICIDAD real: RPC con 2 cobros, el 2º con factura_id inválido →
    // la FK revienta DENTRO de la transacción → ni el 1º ni el estado quedan.
    const antes = await sb.from('cobros_clientes').select('id', { count: 'exact' }).limit(1);
    const facturaUuid = (await sb.from('facturas_clientes').select('id').eq('airtable_id', `${marca}-fac`).single()).data!.id;
    let rpcFallo = false;
    try {
      await sb.rpc('fase2_registrar_cobro', {
        p_cobros: [
          { factura_id: facturaUuid, fecha_cobro: '2026-08-04', monto_cobrado: 50, metodo: 'Transferencia', moneda: 'GTQ', tipo_cambio: 1, cobro_grupo_id: `${marca}-atom` },
          { factura_id: '00000000-0000-0000-0000-000000000000', fecha_cobro: '2026-08-04', monto_cobrado: 50, metodo: 'Transferencia', moneda: 'GTQ', tipo_cambio: 1, cobro_grupo_id: `${marca}-atom` },
        ],
        p_factura_ids: [facturaUuid],
        p_nuevo_estado: 'COBRADO ',
      }).then(r => { if (r.error) throw new Error(r.error.message); });
    } catch { rpcFallo = true; }
    const despues = await sb.from('cobros_clientes').select('id', { count: 'exact' }).limit(1);
    check(rpcFallo && antes.count === despues.count, 'ATOMICIDAD cobro: FK inválida a mitad de la RPC → 0 filas nuevas (rollback)');
    {
      const { data } = await sb.from('facturas_clientes').select('estado').eq('airtable_id', `${marca}-fac`).single();
      check((data?.estado ?? '') === 'COBRADO PARCIAL ', 'ATOMICIDAD cobro: estado de factura intacto (no quedó COBRADO)');
    }

    // anular el grupo → estado vuelve a EMITIDA
    const rAn = await anularCobro(r1.grupoId, 'prueba de anulación F2', 'validador@test');
    check(rAn.ok && rAn.cobrosAnulados === 2 && rAn.estadoNuevo === 'EMITIDA', `anularCobro ok (${rAn.cobrosAnulados} anulados → ${rAn.estadoNuevo})`);
    {
      const { data } = await sb.from('facturas_clientes').select('estado').eq('airtable_id', `${marca}-fac`).single();
      check((data?.estado ?? '') === 'EMITIDA', 'factura.estado=EMITIDA tras anular');
    }

    /* ════════ 2.2 PAGOS ════════ */
    console.log('\n══ 2.2 registrarPagoDeuda / anularPagoDeuda ══');
    const acreedor = await sb.from('acreedores').select('id').limit(1).single();
    await sb.from('deudas').insert({
      airtable_id: `${marca}-deu`, clave_deuda: marca, acreedor_id: acreedor.data!.id,
      nombre_deuda: `${marca} deuda`, estado: 'Pendiente', monto_original: 500, moneda: 'GTQ',
      tipo_cambio: 1, monto_gtq: 500, saldo_pendiente: 500, no_incluir: false, fecha_emision: '2026-08-01',
    });
    basura.push(['deudas', `${marca}-deu`]);
    invalidarBridge();
    const { registrarPagoDeuda, anularPagoDeuda, getPagosPorDeuda } = await import('../src/lib/db/pagos-deudas');
    const p1 = await registrarPagoDeuda({
      deudaId: `${marca}-deu`, fecha: '2026-08-04', montoTotal: 200,
      metodo: 'Transferencia', referencia: 'ref-pago', cuentaBancoName: banco.data!.nombre_cuenta,
    });
    check(p1.ok, `registrarPagoDeuda ok (${p1.ok ? p1.pagoId : p1.error})`);
    if (p1.ok) {
      basura.push(['pagos_proveedores', p1.pagoId]);
      check(p1.deudaActualizada.saldoPendiente === 300, `saldo derivado 300 (${p1.deudaActualizada.saldoPendiente})`);
      const pagos = await getPagosPorDeuda(`${marca}-deu`);
      check(pagos.length === 1 && pagos[0].capital === 200 && pagos[0].cuentaBancoName === banco.data!.nombre_cuenta,
        'lectura del pago refleja capital + cuenta banco');
      const pAn = await anularPagoDeuda(p1.pagoId, 'prueba anulación', 'validador@test');
      check(pAn.ok && pAn.montoAnulado === 200, `anularPagoDeuda ok (monto ${pAn.montoAnulado})`);
      const pagosTras = await getPagosPorDeuda(`${marca}-deu`);
      check(pagosTras.length === 0, 'pago anulado queda oculto por default');
    }

    /* ════════ 2.3 GASTOS ════════ */
    console.log('\n══ 2.3 aprobarFactura (asiento+partidas+gasto+factura_in) ══');
    const { sbCrearFacturaIn, sbAprobarGasto, sbResolverPeriodoContable, sbBuscarOCrearProveedor } =
      await import('../src/lib/gastos/supabase-gastos');
    const fin = await sbCrearFacturaIn({
      fuente: 'Sistema', fileHash: `${marca}-hash`, docKey: `${marca}-dockey`,
      proveedorNombre: `${marca} Proveedor`, proveedorNit: '1234567', serie: 'A', numero: '999',
      fechaEmision: '2026-08-01', moneda: 'Q', subtotal: 892.86, iva: 107.14, total: 1000,
      subidoPor: 'validador@test', fechaSubida: new Date().toISOString(),
    });
    basura.push(['facturas_in', fin.appId]);
    const prov = await sbBuscarOCrearProveedor({ nit: `${Date.now()}`.slice(-9), nombreSugerido: `${marca} Prov SA` });
    basura.push(['proveedores', prov.recordId]);
    const periodo = await sbResolverPeriodoContable('2026-08-01');
    const cuentaGasto = await sb.from('cuentas').select('airtable_id').eq('codigo_path', '6-1-7').single();

    const antesA = await sb.from('asientos').select('id', { count: 'exact' }).limit(1);
    // ATOMICIDAD: cuenta de gasto inexistente → RPC falla → ni asiento ni gasto
    try {
      await sbAprobarGasto({
        facturaInAppId: fin.appId, fechaEmision: '2026-08-01', periodo,
        centroCostoAppId: 'recNOEXISTE', proveedorAppId: prov.recordId, proveedorNombre: prov.nombre,
        proveedorEsInternacional: false, cuentaGastoAppId: cuentaGasto.data!.airtable_id,
        baseSinIva: 892.86, iva: 107.14, total: 1000, moneda: 'Q', tipoCambio: 1,
        metodoPago: 'Plazo', fechaVencimiento: '2026-09-01', tipoOperativo: 'Operativo',
        serie: 'A', numero: '999', descripcion: `${marca} test`, aprobadoPor: 'validador@test',
        fechaAprobacion: new Date().toISOString(),
      });
      badLog('ATOMICIDAD gasto: debía fallar con CC inexistente');
    } catch {
      const desA = await sb.from('asientos').select('id', { count: 'exact' }).limit(1);
      const { data: finRow } = await sb.from('facturas_in').select('estado').eq('airtable_id', fin.appId).single();
      check(antesA.count === desA.count && finRow?.estado === 'Pendiente',
        'ATOMICIDAD gasto: fallo forzado → sin asiento y factura_in sigue Pendiente');
    }

    // aprobación real (a Plazo → Cr CxP)
    const cc = await sb.from('centros_costo').select('airtable_id').limit(1).single();
    const ap = await sbAprobarGasto({
      facturaInAppId: fin.appId, fechaEmision: '2026-08-01', periodo,
      centroCostoAppId: cc.data!.airtable_id, proveedorAppId: prov.recordId, proveedorNombre: prov.nombre,
      proveedorEsInternacional: false, cuentaGastoAppId: cuentaGasto.data!.airtable_id,
      baseSinIva: 892.86, iva: 107.14, total: 1000, moneda: 'Q', tipoCambio: 1,
      metodoPago: 'Plazo', fechaVencimiento: '2026-09-01', tipoOperativo: 'Operativo',
      serie: 'A', numero: '999', descripcion: `${marca} test`, aprobadoPor: 'validador@test',
      fechaAprobacion: new Date().toISOString(),
    });
    basura.push(['gastos', ap.gastoId]);
    basura.push(['asientos', ap.asientoId]);
    okLog(`aprobación ok: gasto ${ap.gastoId}, asiento ${ap.asientoRef}`);
    {
      const { data: part } = await sb.from('partidas').select('debe, haber, airtable_id')
        .eq('asiento_id', (await sb.from('asientos').select('id').eq('airtable_id', ap.asientoId).single()).data!.id);
      const debe = (part ?? []).reduce((s, p) => s + Number(p.debe), 0);
      const haber = (part ?? []).reduce((s, p) => s + Number(p.haber), 0);
      check((part?.length ?? 0) === 3 && Math.abs(debe - haber) < 0.01,
        `3 partidas balanceadas (Dr ${debe} = Cr ${haber})`);
      const { data: finRow } = await sb.from('facturas_in').select('estado, gasto_id').eq('airtable_id', fin.appId).single();
      check(finRow?.estado === 'Aprobada' && !!finRow?.gasto_id, 'factura_in → Aprobada + link al gasto (misma transacción)');
    }

    /* ════════ 2.4 PLANILLA (RPC directa + idempotencia) ════════ */
    console.log('\n══ 2.4 asiento de planilla (RPC + idempotencia) ══');
    const { rpc: rpcW } = await import('../src/lib/supabase/writes');
    const cuentaNomina = await sb.from('cuentas').select('id').eq('codigo_path', '5-1-3-3').single();
    const cuentaBanco = banco.data!.cuenta_contable_id;
    const asientoPla = {
      asiento_ref: `PLA-${marca}`, fecha_asiento: '2026-08-04', origen: 'PLANILLA',
      descripcion: `Planilla ${marca}`,
    };
    const partidasPla = [
      { cuenta_id: cuentaNomina.data!.id, descripcion_linea: 'Dr nomina test', debe: 100, haber: 0, moneda: 'GTQ', tipo_cambio: 1, periodo: marca },
      { cuenta_id: cuentaBanco, descripcion_linea: 'Cr banco test', debe: 0, haber: 100, moneda: 'GTQ', tipo_cambio: 1, periodo: marca },
    ];
    const pla = await rpcW<{ asiento_airtable_id: string; partidas_airtable_ids: string[] }>(
      'fase2_crear_asiento_con_partidas',
      { p_asiento: asientoPla, p_partidas: partidasPla, p_planilla_ids: null },
    );
    basura.push(['asientos', pla.asiento_airtable_id]);
    check(pla.partidas_airtable_ids.length === 2, `asiento planilla creado con código nuevo 5-1-3-3 (${pla.asiento_airtable_id})`);
    // IDEMPOTENCIA: mismo asiento_ref → rechazo, sin duplicar
    try {
      await rpcW('fase2_crear_asiento_con_partidas', { p_asiento: asientoPla, p_partidas: partidasPla, p_planilla_ids: null });
      badLog('IDEMPOTENCIA planilla: debía rechazar el asiento_ref duplicado');
    } catch (err) {
      const { count } = await sb.from('asientos').select('id', { count: 'exact' }).eq('asiento_ref', `PLA-${marca}`).limit(1);
      check(count === 1 && String(err).includes('ASIENTO_DUPLICADO'), 'IDEMPOTENCIA planilla: ASIENTO_DUPLICADO y sigue habiendo 1');
    }
    // BALANCE: partidas desbalanceadas → rechazo
    try {
      await rpcW('fase2_crear_asiento_con_partidas', {
        p_asiento: { ...asientoPla, asiento_ref: `PLA-${marca}-B` },
        p_partidas: [{ cuenta_id: cuentaNomina.data!.id, debe: 100, haber: 0, moneda: 'GTQ', tipo_cambio: 1 }],
        p_planilla_ids: null,
      });
      badLog('BALANCE: debía rechazar asiento no balanceado');
    } catch (err) {
      check(String(err).includes('ASIENTO_NO_BALANCEADO'), 'BALANCE: asiento no balanceado rechazado dentro de la transacción');
    }

    /* ════════ FASE 3.1 FACTURACIÓN — emitir + PDF DE UNA + editar + NC + anular ════════ */
    console.log('\n══ 3.1 facturación (emitir + adjuntar PDF de una + NC) ══');
    const { createFactura, editarFacturaNoContable, anularFactura, getHistorialEdicionesFactura } = await import('../src/lib/db/facturas');
    const { uploadAttachment, ADJUNTO_FIELD_ID } = await import('../src/lib/db/attachments');
    const cc2 = await sb.from('centros_costo').select('airtable_id').limit(2);
    const marca2 = `${marca}-F3`;
    const fac3 = await createFactura({
      noFactura: marca2, custId: `${marca}-cli`, fechaEmision: '2026-08-02',
      lineas: [
        { centroCostoId: cc2.data![0].airtable_id, total: 560, iva: 60 },
        { centroCostoId: cc2.data![1]?.airtable_id ?? cc2.data![0].airtable_id, total: 336, iva: 36 },
      ],
    });
    check(fac3.recordsCreados === 2 && !!fac3.recordIdPrincipal, `createFactura 2 líneas atómico (principal ${fac3.recordIdPrincipal})`);
    {
      const { data } = await sb.from('facturas_clientes').select('airtable_id, subtotal, estado').eq('no_factura', marca2);
      check((data?.length ?? 0) === 2 && data!.every(r => r.estado === 'EMITIDA'), 'líneas EMITIDA con subtotal materializado');
      for (const r of data ?? []) basura.push(['facturas_clientes', r.airtable_id]);
    }
    // DEPENDENCIA CRÍTICA (addendum): factura emitida EN SUPABASE + PDF
    // adjuntado EN SUPABASE, de una, sin error de backends cruzados.
    const miniPdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    await uploadAttachment(fac3.recordIdPrincipal, ADJUNTO_FIELD_ID, 'test-f3.pdf', 'application/pdf', miniPdf);
    {
      const { data } = await sb.from('facturas_clientes').select('adjunto_url, adjunto_nombre').eq('airtable_id', fac3.recordIdPrincipal).single();
      check(!!data?.adjunto_url && String(data.adjunto_url).includes('/adjuntos/'), 'PDF adjuntado DE UNA a la factura recién emitida (Storage, mismo backend)');
    }
    const ed = await editarFacturaNoContable(fac3.recordIdPrincipal, { observaciones: 'editada por validador F3' }, 'validador@test');
    check(ed.ok && ed.auditoriaPersistida, 'edición no-contable + auditoría persistida');
    {
      const hist = await getHistorialEdicionesFactura(fac3.recordIdPrincipal);
      check(hist.length === 1 && hist[0].usuario === 'validador@test', 'historial de ediciones legible desde la columna');
    }
    // NC sobre la factura RECIÉN creada (acoplamiento del addendum)
    const { crearNotaCredito, anularNotaCredito } = await import('../src/lib/db/notas-credito');
    const nc = await crearNotaCredito({ facturaId: fac3.recordIdPrincipal, fechaEmision: '2026-08-03', monto: 96, motivo: 'Ajuste de cuenta', descripcion: 'NC validador F3' }, 'validador@test');
    check(nc.ok && nc.estadoInicial === 'Activa', `NC creada sobre factura nacida en Supabase (${nc.numeroNC})`);
    if (nc.ok && nc.notaCreditoId) {
      basura.push(['notas_credito', nc.notaCreditoId]);
      const ncAn = await anularNotaCredito(nc.notaCreditoId, 'prueba', 'validador@test');
      check(ncAn.ok === true, 'NC anulada y estado de factura recalculado');
    }
    const anF = await anularFactura(marca2, 'prueba validador', 'Error en datos');
    check(anF.ok && anF.recordsActualizados === 2, 'anularFactura marca ambas líneas ANULADO');

    /* ════════ FASE 3.2 EMPLEADOS + DEUDAS + OBLIGACIONES ════════ */
    console.log('\n══ 3.2 empleados / deudas / obligaciones ══');
    const { crearEmpleado, editarEmpleado, darDeBajaEmpleado, crearDeudaSalarioPendiente } = await import('../src/lib/db/empleados');
    const emp = await crearEmpleado({ nombre: `${marca} EMPLEADO`, fechaIngreso: '2026-01-01', salarioBase: 3000, bonificacionIncentivo: 250, departamento: 'TEST' });
    check(emp.ok, `crearEmpleado (${emp.ok ? emp.empleadoId : emp.error})`);
    if (emp.ok && emp.empleadoId) {
      basura.push(['empleados', emp.empleadoId]);
      {
        const { data } = await sb.from('empleados').select('salario_mensual').eq('airtable_id', emp.empleadoId).single();
        check(Number(data?.salario_mensual) === 3250, `salario_mensual materializado 3250 (${data?.salario_mensual})`);
      }
      const edE = await editarEmpleado(emp.empleadoId, { salarioBase: 3500 });
      const { data: d2 } = await sb.from('empleados').select('salario_mensual').eq('airtable_id', emp.empleadoId).single();
      check(edE.ok && Number(d2?.salario_mensual) === 3750, `editar recalcula salario_mensual (${d2?.salario_mensual})`);
      const dsp = await crearDeudaSalarioPendiente(emp.empleadoId, 1875, '2026-08-15', 'quincena diferida test');
      check(dsp.ok === true, `deuda salarial + acreedor auto-creado (${dsp.ok ? dsp.deudaId : dsp.error})`);
      if (dsp.ok && dsp.deudaId) basura.push(['deudas', dsp.deudaId]);
      if (dsp.ok && dsp.acreedorId) basura.push(['acreedores', dsp.acreedorId]);
      const baja = await darDeBajaEmpleado(emp.empleadoId, '2026-08-04', 'fin de prueba', 'INACTIVO');
      check(baja.ok === true, 'darDeBajaEmpleado');
    }
    const { crearDeuda, editarDeuda, eliminarDeuda } = await import('../src/lib/db/deudas');
    const acr = await sb.from('acreedores').select('airtable_id').limit(1).single();
    const deu = await crearDeuda({ acreedorId: acr.data!.airtable_id, tipoDocumento: 'Factura', fechaEmision: '2026-08-01', moneda: 'Q', montoOriginal: 750, nombreDeuda: `${marca} deuda F3`, plazoMeses: 1 });
    check(deu.ok, `crearDeuda (${deu.ok ? deu.deudaId : deu.error})`);
    if (deu.ok && deu.deudaId) {
      basura.push(['deudas', deu.deudaId]);
      {
        const { data } = await sb.from('deudas').select('fecha_vencimiento, monto_gtq').eq('airtable_id', deu.deudaId).single();
        check(data?.fecha_vencimiento === '2026-09-01' && Number(data?.monto_gtq) === 750, `vencimiento calculado + monto_gtq (${data?.fecha_vencimiento})`);
      }
      const edD = await editarDeuda(deu.deudaId, { montoOriginal: 900 });
      const { data: d3 } = await sb.from('deudas').select('monto_gtq, saldo_pendiente').eq('airtable_id', deu.deudaId).single();
      check(edD.ok && Number(d3?.monto_gtq) === 900, `editarDeuda recalcula monto_gtq (${d3?.monto_gtq})`);
      const del = await eliminarDeuda(deu.deudaId);
      check(del.ok === true, 'eliminarDeuda');
    }
    const { crearObligacion, toggleActivoObligacion } = await import('../src/app/(app)/planillas/../flujo/_actions/obligaciones');
    const ob = await crearObligacion({ nombre: `${marca} OBLIG`, tipo: 'Servicio', montoEstimado: 100, diaPago: 5, frecuencia: 'Mensual', prioridad: 'Baja', porCuentaDe: 'Otra' });
    check(ob.ok, `crearObligacion con porCuentaDe='Otra' (${ob.ok ? ob.id : ob.error})`);
    if (ob.ok) {
      basura.push(['obligaciones_recurrentes', ob.id]);
      const tg = await toggleActivoObligacion(ob.id);
      const { data } = await sb.from('obligaciones_recurrentes').select('activo, por_cuenta_de').eq('airtable_id', ob.id).single();
      check(tg.ok && data?.activo === false && data?.por_cuenta_de === 'Otra', 'toggle pausa + enum Otra persistido');
    }

    /* ════════ FASE 3.3 WORKFLOW PLANILLA ════════ */
    console.log('\n══ 3.3 workflow de planilla (período → aprobar → pagar → cierre) ══');
    const { crearPeriodo, aprobarPeriodo, registrarPagoEmpleado } = await import('../src/lib/db/planillas');
    const per = await crearPeriodo({ quincena: 2, mes: 12, anio: 2098 });
    check(per.ok, `crearPeriodo (${per.ok ? per.periodoId : per.error})`);
    if (per.ok && per.periodoId) {
      basura.push(['periodos', per.periodoId]);
      // línea sintética vinculada al período de prueba
      const perUuid = (await sb.from('periodos').select('id').eq('airtable_id', per.periodoId).single()).data!.id;
      const empRow = await sb.from('empleados').select('id').limit(1).single();
      const lineaIns = await sb.from('planilla').insert({
        airtable_id: `${marca}-lin`, periodo_id: perUuid, empleado_id: empRow.data!.id,
        ordinario: 1000, neto_pagar: 1000, estado_pago: 'Pendiente',
      }).select('id').single();
      basura.push(['planilla', `${marca}-lin`]);
      check(!!lineaIns.data, 'línea de planilla sintética creada');
      invalidarBridge();
      const ap2 = await aprobarPeriodo(per.periodoId, 'validador@test');
      check(ap2.ok === true, `aprobarPeriodo (${ap2.ok ? 'ok' : ap2.error})`);
      const bancoRow = await sb.from('bancos').select('airtable_id').limit(1).single();
      const pago = await registrarPagoEmpleado({ lineaId: `${marca}-lin`, fechaPago: '2026-08-04', bancoId: bancoRow.data!.airtable_id, usuarioEmail: 'validador@test' });
      check(pago.ok === true, `registrarPagoEmpleado (${pago.ok ? 'ok' : pago.error})`);
      const { data: perFin } = await sb.from('periodos').select('estado, pagado_por').eq('airtable_id', per.periodoId).single();
      check(perFin?.estado === 'Cerrada' && !!perFin?.pagado_por, `período auto-Cerrada al concluir todas las líneas ('${perFin?.estado}')`);
    }
  } finally {
    /* ════════ cleanup (orden inverso por FKs) ════════ */
    console.log('\n══ limpieza de registros de prueba ══');
    const sb2 = (await import('../src/lib/supabase/client')).supabase()!;
    // partidas/gastos/movimientos dependen de asientos → borrar hijos primero.
    for (const [tabla, appId] of [...basura].reverse()) {
      try {
        if (tabla === 'asientos') {
          const { data } = await sb2.from('asientos').select('id').eq('airtable_id', appId).single();
          if (data) {
            await sb2.from('movimientos_bancarios').delete().eq('asiento_id', data.id);
            await sb2.from('partidas').delete().eq('asiento_id', data.id);
          }
        }
        if (tabla === 'facturas_in') {
          // gasto_id FK: los gastos de prueba ya se borran por su propia entrada.
          await sb2.from('facturas_in').update({ gasto_id: null }).eq('airtable_id', appId);
        }
        if (tabla === 'facturas_clientes') {
          // Cualquier cobro de prueba que haya quedado colgando de la factura
          // TEST (aunque no esté trackeado) se barre antes de borrarla.
          const { data } = await sb2.from('facturas_clientes').select('id').eq('airtable_id', appId).single();
          if (data) await sb2.from('cobros_clientes').delete().eq('factura_id', data.id);
        }
        await sb2.from(tabla).delete().eq('airtable_id', appId);
      } catch (err) {
        console.log(`  ⚠ cleanup ${tabla}/${appId}: ${err instanceof Error ? err.message : err}`);
      }
    }
    console.log('  ✓ limpieza terminada');
  }

  console.log(`\n${fallas === 0 ? '✓ ESCRITURAS VALIDADAS — ok flipear WRITE_SOURCE' : `✗ ${fallas} validaciones fallaron`}`);
  process.exit(fallas === 0 ? 0 : 1);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
