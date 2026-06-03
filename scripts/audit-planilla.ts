/* eslint-disable no-console */
/**
 * F-038.3 — Audit del vínculo período ↔ líneas de PLANILLA.
 *
 * Lee TODO PERIODOS y TODO PLANILLA con eachPage y reporta:
 *  - Períodos existentes con su array PLANILLA (lado del período).
 *  - Líneas de PLANILLA con su campo PERIODO (lado de la línea).
 *  - Tabla cruzada para detectar dónde se rompe el vínculo bidireccional.
 *
 * Uso:
 *   set -a && source .env.local && set +a && npx tsx scripts/audit-planilla.ts
 */

import Airtable from 'airtable';

if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
  console.error('AIRTABLE_API_KEY y AIRTABLE_BASE_ID son requeridos.');
  process.exit(1);
}

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

(async () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log('AUDIT PLANILLA — vínculo período ↔ líneas');
  console.log('═══════════════════════════════════════════════════════\n');

  // 1) PERIODOS
  const periodos: { id: string; fields: Record<string, unknown> }[] = [];
  await base('PERIODOS').select({ pageSize: 100 }).eachPage((records, next) => {
    for (const r of records) periodos.push({ id: r.id, fields: r.fields as Record<string, unknown> });
    next();
  });

  console.log(`Períodos totales: ${periodos.length}\n`);

  for (const p of periodos) {
    const planillaArr = p.fields['PLANILLA'];
    const cantLink = Array.isArray(planillaArr) ? planillaArr.length : 0;
    console.log(`Período ${p.id}`);
    console.log(`  PERIODO        : ${JSON.stringify(p.fields['PERIODO'])}`);
    console.log(`  ESTADO         : ${JSON.stringify(p.fields['ESTADO'])}`);
    console.log(`  FECHA_INICIO   : ${p.fields['FECHA_INICIO']}`);
    console.log(`  FECHA_FIN      : ${p.fields['FECHA_FIN']}`);
    console.log(`  PLANILLA links : ${JSON.stringify(planillaArr)?.slice(0, 200)}`);
    console.log(`  cantidad links : ${cantLink}`);
    console.log('');
  }

  // 2) PLANILLA
  const lineas: { id: string; fields: Record<string, unknown> }[] = [];
  await base('PLANILLA').select({ pageSize: 100 }).eachPage((records, next) => {
    for (const r of records) lineas.push({ id: r.id, fields: r.fields as Record<string, unknown> });
    next();
  });

  console.log(`═══════════════════════════════════════════════════════`);
  console.log(`LÍNEAS DE PLANILLA`);
  console.log(`═══════════════════════════════════════════════════════\n`);
  console.log(`Total líneas en tabla PLANILLA: ${lineas.length}\n`);

  // Distribución por su campo PERIODO (lookup back-link)
  const porPeriodo = new Map<string, number>();
  for (const l of lineas) {
    const periodoVal = l.fields['PERIODO'];
    const key = JSON.stringify(periodoVal);
    porPeriodo.set(key, (porPeriodo.get(key) ?? 0) + 1);
  }
  console.log(`Líneas agrupadas por su campo PERIODO:`);
  for (const [periodo, count] of porPeriodo) {
    console.log(`  ${periodo} → ${count} líneas`);
  }

  // 3) Primera línea completa
  if (lineas.length > 0) {
    console.log(`\nPrimera línea (TODOS los campos):`);
    console.log(JSON.stringify(lineas[0].fields, null, 2));
  }

  // 4) Cross-check: para cada período, contar líneas que lo declaran vs cuántas dice el período
  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(`CROSS-CHECK (período ↔ líneas)`);
  console.log(`═══════════════════════════════════════════════════════\n`);
  for (const p of periodos) {
    const arr = Array.isArray(p.fields['PLANILLA']) ? (p.fields['PLANILLA'] as unknown[]).length : 0;
    const desdeLineas = lineas.filter(l => {
      const v = l.fields['PERIODO'];
      return Array.isArray(v) && v.includes(p.id);
    }).length;
    const pname = String(p.fields['PERIODO'] ?? '');
    const flag = arr === desdeLineas ? 'OK' : '❌ MISMATCH';
    console.log(`  ${pname.padEnd(24)} ${p.id}  → período.PLANILLA=${arr}  líneas con PERIODO=este=${desdeLineas}   ${flag}`);
  }

  process.exit(0);
})().catch(e => {
  console.error('Audit falló:', e);
  process.exit(2);
});
