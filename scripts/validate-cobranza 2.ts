/**
 * F-COBRANZA — validador de staging de la bitácora de gestión de cobro.
 *
 * PRERREQUISITO: correr supabase/05_cobranza.sql en el SQL Editor.
 * Uso: npx tsx scripts/validate-cobranza.ts
 *
 * Crea gestiones de PRUEBA sobre un cliente real con varias facturas
 * pendientes, valida histórico/promesas/resumen y BORRA todo al final.
 */
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('='); if (!(k in process.env)) process.env[k.trim()] = r.join('=').trim();
}

let pass = 0, fail = 0;
const ok = (cond: boolean, msg: string) => { if (cond) { pass++; console.log(`  🟢 ${msg}`); } else { fail++; console.log(`  🔴 ${msg}`); } };

(async () => {
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase();
  if (!sb) { console.error('Supabase no configurado'); process.exit(1); }

  // 0. ¿Existe la tabla?
  const { error: errTabla } = await sb.from('gestiones_cobro').select('id', { head: true, count: 'exact' });
  if (errTabla) {
    console.error(`✗ La tabla gestiones_cobro no existe todavía: ${errTabla.message}`);
    console.error('  → Corré supabase/05_cobranza.sql en el SQL Editor y volvé a correr este script.');
    process.exit(1);
  }
  console.log('0. Tabla gestiones_cobro existe 🟢');

  const { crearGestionCobro, getGestionesCliente, getResumenGestiones } = await import('../src/lib/db/gestiones-cobro');
  const { getFacturasPendientesCobro } = await import('../src/lib/db/facturas-pendientes');

  // Cliente real con 2+ facturas pendientes (solo para staging; se limpia).
  const pend = await getFacturasPendientesCobro();
  const porCliente = new Map<string, typeof pend.filas>();
  for (const f of pend.filas) {
    const l = porCliente.get(f.custId) ?? [];
    l.push(f); porCliente.set(f.custId, l);
  }
  const candidato = [...porCliente.entries()].find(([, fs2]) => fs2.length >= 2);
  if (!candidato) { console.error('No hay cliente con 2+ facturas pendientes para staging'); process.exit(1); }
  const [custId, facturasCliente] = candidato;
  console.log(`   staging sobre cliente ${facturasCliente[0].cliente} (${facturasCliente.length} facturas pendientes)`);

  const MARCA = `TEST-COBRANZA-${process.hrtime.bigint()}`;
  const hoy = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
  const enUnaSemana = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);
  const ayer = new Date(Date.now() - 30 * 3600_000).toISOString().slice(0, 10);

  console.log('1. Registrar gestión con facturas referenciadas');
  const g1 = await crearGestionCobro({
    custId, usuario: 'validador@test', canal: 'Llamada',
    contactoCliente: 'Contabilidad', comentario: `${MARCA} — dijo que paga la próxima semana`,
    fechaPagoPromesa: enUnaSemana,
    proximoSeguimiento: enUnaSemana,
    facturas: [
      { facturaId: facturasCliente[0].id },                          // hereda la general
      { facturaId: facturasCliente[1].id, fechaPromesa: hoy },       // fecha propia
    ],
  });
  ok(g1.ok, `crearGestionCobro ok → ${g1.ok ? g1.gestionId : g1.error}`);
  if (!g1.ok) process.exit(1);

  console.log('2. Segunda gestión NO sobrescribe (histórico apilado)');
  const g2 = await crearGestionCobro({
    custId, usuario: 'validador@test', canal: 'WhatsApp',
    comentario: `${MARCA} — segundo contacto, prometió ayer y no cumplió`,
    fechaPagoPromesa: ayer,
  });
  ok(g2.ok, `segunda gestión ok → ${g2.ok ? g2.gestionId : g2.error}`);
  const historial = await getGestionesCliente(custId);
  const mias = historial.filter(g => g.comentario.startsWith(MARCA));
  ok(mias.length === 2, `histórico apilado: ${mias.length}/2 gestiones TEST en el historial`);
  ok(historial[0].comentario.includes('segundo contacto'), 'más reciente arriba');
  const conFacturas = mias.find(g => g.facturas.length === 2);
  ok(!!conFacturas, 'facturas referenciadas guardadas (2 en la primera gestión)');
  ok(conFacturas?.facturas.some(f => f.fechaPromesa === hoy) ?? false, 'fecha de promesa POR FACTURA guardada');

  console.log('3. Resumen para el tablero (columnas Prometido / Últ. gestión)');
  const resumen = await getResumenGestiones();
  const rc = resumen.porCliente[custId];
  ok(!!rc && rc.numGestiones >= 2 || false, `porCliente presente (${rc?.numGestiones} gestiones)`);
  ok(rc?.ultimaGestion === hoy && rc?.diasDesdeUltima === 0, `última gestión hoy (dias=${rc?.diasDesdeUltima})`);
  ok(rc !== undefined && rc.fechaPagoPromesa === ayer && rc.promesaVencida === true, `promesa vigente = la MÁS RECIENTE (${rc?.fechaPagoPromesa}) y marcada VENCIDA (rojo en la tabla)`);
  const rf = resumen.porFactura[facturasCliente[1].id];
  ok(rf?.fechaPromesa === hoy, `promesa específica por factura pisa a la general (${rf?.fechaPromesa})`);
  const rf0 = resumen.porFactura[facturasCliente[0].id];
  ok(rf0?.fechaPromesa === enUnaSemana, `factura sin fecha propia hereda la general (${rf0?.fechaPromesa})`);

  console.log('4. Tool de Auros');
  const { aiTools } = await import('../src/lib/ai/tools');
  const t = aiTools.getGestionesCobro;
  const prom = await t.execute({ vista: 'promesas', dias: 7, incluirVencidas: true, limite: 50 }, { toolCallId: 'x', messages: [] });
  ok((prom.promesas ?? []).some((p: { cliente: string }) => p.cliente === facturasCliente[0].cliente), 'vista promesas encuentra al cliente TEST');
  ok((prom.promesasVencidasQ ?? 0) > 0, `promesas vencidas detectadas (Q${prom.promesasVencidasQ})`);
  const hist = await t.execute({ vista: 'historial', dias: 7, incluirVencidas: true, nombreCliente: facturasCliente[0].cliente.slice(0, 8), limite: 10 }, { toolCallId: 'x', messages: [] });
  ok((hist.gestiones ?? []).some((g: { comentario: string }) => g.comentario.startsWith(MARCA)), 'vista historial filtra por cliente');
  const sinG = await t.execute({ vista: 'sin_gestion', dias: 7, incluirVencidas: true, limite: 100 }, { toolCallId: 'x', messages: [] });
  ok(!(sinG.clientes ?? []).some((c: { cliente: string }) => c.cliente === facturasCliente[0].cliente), 'cliente recién gestionado NO sale en sin_gestion');
  ok((sinG.clientesSinGestion ?? 0) > 0, `hay ${sinG.clientesSinGestion} clientes sin gestión (Q${sinG.saldoTotalQ}) — el resto de la cartera`);

  console.log('5. Limpieza');
  const idsUuid: string[] = [];
  for (const g of mias) {
    const { data } = await sb.from('gestiones_cobro').select('id').eq('airtable_id', g.id).single();
    if (data) idsUuid.push(data.id);
  }
  const { error: delErr } = await sb.from('gestiones_cobro').delete().in('id', idsUuid);   // puente cae por cascade
  ok(!delErr, `gestiones TEST borradas (${idsUuid.length}; puente en cascada)`);
  const quedan = (await getGestionesCliente(custId)).filter(g => g.comentario.startsWith(MARCA));
  ok(quedan.length === 0, 'sin residuos TEST en el historial');

  console.log(`\n${fail === 0 ? '✓ F-COBRANZA STAGING VERDE' : '✗ FALLARON CHECKS'} — ${pass}/${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
