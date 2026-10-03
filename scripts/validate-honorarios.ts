/**
 * FIX-HONORARIOS — validador READ-ONLY: honorarios sin prestaciones,
 * dependencia intacta, en ficha/listado/KPIs/quincena/asiento.
 *
 * Uso: npx tsx scripts/validate-honorarios.ts [golden|hit]
 *   golden ← .env.local · hit ← .env.hit.vercel (gitignorado)
 *
 * No escribe nada: el asiento se valida con previewAsientoPlanilla (en seco).
 */
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] ?? 'golden';
const ENV_POR_BASE: Record<string, string> = { golden: '.env.local', hit: '.env.hit.vercel' };
const envFile = ENV_POR_BASE[base];
if (!envFile) { console.error('Uso: npx tsx scripts/validate-honorarios.ts [golden|hit]'); process.exit(1); }
const forzar = base === 'hit';
for (const line of fs.readFileSync(path.join(process.cwd(), envFile), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('=');
  if (forzar || !(k.trim() in process.env)) process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}

let pass = 0, fail = 0;
const ok = (cond: boolean, msg: string) => { if (cond) { pass++; console.log(`  🟢 ${msg}`); } else { fail++; console.log(`  🔴 ${msg}`); } };
const Q = (n: number) => `Q${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

(async () => {
  console.log(`\n== FIX-HONORARIOS · ${base.toUpperCase()} ==\n`);
  const { regimenContrato } = await import('../src/lib/empleados/contrato');
  const { getEmpleados, getKPIsPlanilla, getPlanillaPorCentroCosto } = await import('../src/lib/db/empleados');
  const { calcularQuincena } = await import('../src/lib/calculos/planilla-calc');
  const { calcularLiquidacion } = await import('../src/lib/calculos/planilla');
  const { previewAsientoPlanilla } = await import('../src/lib/planilla/generar-asiento-planilla');

  console.log('1. Clasificación de los tipos de contrato reales');
  for (const [tipo, esperado] of [
    ['Honorarios', 'honorarios'], ['SERVICIOS PROFESIONALES', 'honorarios'], [' servicios profesionales ', 'honorarios'],
    ['Indefinido', 'dependencia'], ['CONTRATO INDEFINIDO', 'dependencia'], ['Plazo fijo', 'dependencia'],
    ['Por obra', 'dependencia'], ['CONTRATO', 'dependencia'], [null, 'dependencia'],
  ] as const) {
    ok(regimenContrato(tipo) === esperado, `${JSON.stringify(tipo)} → ${esperado}`);
  }

  const empleados = await getEmpleados({ status: 'ACTIVO' });
  const honorarios = empleados.filter(e => e.esHonorarios);
  const dependencia = empleados.filter(e => !e.esHonorarios && e.salarioMensual > 0);
  ok(honorarios.length > 0, `hay honorarios activos: ${honorarios.map(e => `${e.nombre} (${e.tipoContrato})`).join(', ')}`);
  ok(dependencia.length > 0, `hay ${dependencia.length} empleados en dependencia activos`);

  console.log('2. Ficha / listado — honorarios: costo = solo el honorario');
  for (const e of honorarios) {
    const prest = e.igssPatronal + e.provisionBono14 + e.provisionAguinaldo + e.provisionVacaciones + e.provisionIndemnizacion;
    ok(prest === 0, `${e.nombre}: prestaciones mensuales = ${Q(prest)}`);
    ok(e.costoTotalMensual === e.salarioMensual, `${e.nombre}: costo total ${Q(e.costoTotalMensual)} = honorario ${Q(e.salarioMensual)}`);
    ok(e.provisionesAcumuladas.totalPasivoLaboral === 0 && e.provisionesAcumuladas.indemnizacionPotencial === 0,
      `${e.nombre}: pasivo laboral acumulado = ${Q(e.provisionesAcumuladas.totalPasivoLaboral)}`);
    const liq = calcularLiquidacion({ fechaIngreso: e.fechaIngreso, salarioMensual: e.salarioMensual, salarioBase: e.salarioBase, tipoContrato: e.tipoContrato }, 'Despido sin responsabilidad', new Date());
    ok(liq.total === 0, `${e.nombre}: liquidación (aun despido sin responsabilidad) = ${Q(liq.total)}`);
  }

  console.log('3. Dependencia sigue con todas las prestaciones (no se rompió)');
  const d = dependencia[0];
  const esperado = d.salarioMensual * (1 + 0.1267 + 0.0833 + 0.0833 + 0.0417 + 0.0972);
  ok(Math.abs(d.costoTotalMensual - esperado) < 0.01, `${d.nombre} (${d.tipoContrato}): costo ${Q(d.costoTotalMensual)} = salario ${Q(d.salarioMensual)} × 1.4322`);
  ok(d.igssPatronal > 0 && d.provisionBono14 > 0 && d.provisionIndemnizacion > 0, `${d.nombre}: IGSS ${Q(d.igssPatronal)}, Bono14 ${Q(d.provisionBono14)}, Indem ${Q(d.provisionIndemnizacion)}`);

  console.log('4. KPIs y vista por centro de costo');
  const kpis = await getKPIsPlanilla();
  const costoEsperado = empleados.reduce((s, e) => s + e.costoTotalMensual, 0);
  ok(Math.abs(kpis.costoMensualTotal - costoEsperado) < 0.05, `costo mensual total ${Q(kpis.costoMensualTotal)} (honorarios sin recargo)`);
  const porCC = await getPlanillaPorCentroCosto();
  const prestCC = porCC.centrosCosto.reduce((s, c) => s + c.prestaciones, 0);
  const prestEsperadas = empleados.reduce((s, e) => s + e.igssPatronal + e.provisionBono14 + e.provisionAguinaldo + e.provisionVacaciones + e.provisionIndemnizacion, 0);
  ok(Math.abs(prestCC - prestEsperadas) < 0.05, `prestaciones por CC ${Q(prestCC)} no incluyen a honorarios`);

  console.log('5. Quincena');
  const h = honorarios[0];
  const qh = calcularQuincena({ empleado: { id: h.id, nombre: h.nombre, salarioBase: h.salarioBase, tipoContrato: h.tipoContrato } });
  ok(qh.bonificacion === 0 && qh.igssLaboral === 0 && qh.isr === 0, `${h.nombre}: bonif ${Q(qh.bonificacion)}, IGSS lab ${Q(qh.igssLaboral)}, ISR ${Q(qh.isr)}`);
  ok(qh.netoPagar === round2(h.salarioBase / 2), `${h.nombre}: neto quincena ${Q(qh.netoPagar)} = honorario/2`);
  const qd = calcularQuincena({ empleado: { id: d.id, nombre: d.nombre, salarioBase: d.salarioBase, tipoContrato: d.tipoContrato } });
  ok(qd.bonificacion === 125 && qd.igssLaboral > 0, `${d.nombre}: bonif ${Q(qd.bonificacion)}, IGSS lab ${Q(qd.igssLaboral)} (intacto)`);

  console.log('6. Asiento de planilla (preview en seco)');
  const linea = (e: typeof h, q: typeof qh) => ({
    id: `test-${e.id}`, empleadoId: e.id, centroCostoId: e.centroCostoId,
    ordinario: q.ordinario, bonificacion: q.bonificacion, extraordinario: 0, comisiones: 0, otrosIngresos: 0,
    igssLaboral: q.igssLaboral, isr: q.isr, netoPagar: q.netoPagar,
  });
  const empMin = (e: typeof h) => ({ id: e.id, nombre: e.nombre, empresaEmpleadora: e.empresaEmpleadora, igssPatronal: e.igssPatronal, tipoContrato: e.tipoContrato, centroCostoId: e.centroCostoId });
  const prev = async (e: typeof h, q: typeof qh) => previewAsientoPlanilla({
    periodoId: 'validador-sin-periodo', periodoNombre: 'TEST', fechaAsiento: '2026-10-15',
    lineas: [linea(e, q)], empleados: [empMin(e)], bancoId: 'validador-sin-banco',
  });
  const ph = await prev(h, qh);
  const brutoH = qh.ordinario + qh.bonificacion;
  ok(Math.abs(ph.totalDr - brutoH) < 0.01 || Math.abs(ph.totalDr - qh.netoPagar) < 0.01,
    `${h.nombre}: Dr asiento ${Q(ph.totalDr)} = solo el honorario (sin IGSS patronal ni provisiones)`);
  // Barrera propia del generador: aunque llegara un igssPatronal > 0, un honorarios no lo carga.
  const phForzado = await previewAsientoPlanilla({
    periodoId: 'validador-sin-periodo', periodoNombre: 'TEST', fechaAsiento: '2026-10-15',
    lineas: [linea(h, qh)], empleados: [{ ...empMin(h), igssPatronal: 999 }], bancoId: 'validador-sin-banco',
  });
  ok(Math.abs(phForzado.totalDr - ph.totalDr) < 0.01, `barrera del generador: igssPatronal forzado a 999 sigue sin cargarse (${Q(phForzado.totalDr)})`);
  const pd = await prev(d, qd);
  const brutoD = qd.ordinario + qd.bonificacion;
  const conIgss = brutoD + d.igssPatronal / 2;
  ok(Math.abs(pd.totalDr - conIgss) < 0.01 || Math.abs(pd.totalDr - qd.netoPagar) < 0.01,
    `${d.nombre}: Dr asiento ${Q(pd.totalDr)} (${Math.abs(pd.totalDr - conIgss) < 0.01 ? 'bruto + IGSS patronal/2' : 'neto — línea intercompany'})`);

  console.log(`\n== ${base.toUpperCase()}: ${pass} 🟢 / ${fail} 🔴 ==\n`);
  process.exit(fail === 0 ? 0 : 1);
})();

function round2(n: number) { return Math.round(n * 100) / 100; }
