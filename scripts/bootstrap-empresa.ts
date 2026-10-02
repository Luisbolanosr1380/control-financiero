/**
 * FASE MOLDE · Pieza 4 — Scaffold del bootstrap "nueva empresa".
 *
 * Automatiza los pasos AUTOMATIZABLES del procedimiento documentado en
 * scripts/bootstrap-empresa.md (migraciones + seed + verificación de
 * schema) sobre una base que EL USUARIO ya creó a mano en Supabase.
 *
 * Este script NO crea proyectos Supabase, NO toca Vercel y NO corre
 * contra ninguna base salvo la URL que se le pase explícitamente.
 *
 * USO (consciente, con la base nueva ya creada):
 *   npx tsx scripts/bootstrap-empresa.ts --db 'postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres'
 *
 * Pasos que ejecuta:
 *   1. Sanidad: la base debe estar VACÍA (0 tablas en public) — protege
 *      contra apuntarle por error a una base viva (p.ej. Golden).
 *   2. Migraciones 001..006 (vía el mismo runner migrar-todas).
 *   3. Seed del plan de cuentas base.
 *   4. Verificación: conteos de tablas, funciones, cuentas y mapeos.
 * Los pasos manuales (crear proyecto, bucket adjuntos, Vercel) los
 * imprime como checklist al final.
 */

import { spawnSync } from 'node:child_process';
import { Client } from 'pg';

const ESPERADO = { tablas: 34, funciones: 6, cuentas: 245, centros: 6, mapeoEr: 25, mapeoBs: 20 };

function fallo(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

(async () => {
  const i = process.argv.indexOf('--db');
  const dbUrl = i >= 0 ? process.argv[i + 1] : null;
  if (!dbUrl) fallo("Falta --db 'postgresql://…' (la base NUEVA que creaste a mano; ver bootstrap-empresa.md paso 1)");

  // ── 1. Sanidad: base vacía ──
  const cliente = new Client({ connectionString: dbUrl });
  await cliente.connect().catch(e => fallo(`No conecta: ${e.message}`));
  const { rows } = await cliente.query(
    "select count(*)::int as n from pg_tables where schemaname = 'public'");
  await cliente.end();
  if (rows[0].n > 0) {
    fallo(`La base ya tiene ${rows[0].n} tablas en public — este bootstrap es SOLO para bases recién creadas. ` +
          'Si querés actualizar una empresa existente, usá migrar-todas.ts.');
  }
  console.log('1 ✓ base vacía — es una base nueva');

  // ── 2+3. Migraciones + seed (mismo runner de siempre) ──
  const r = spawnSync('npx', ['tsx', 'scripts/migrar-todas.ts', '--db', dbUrl, '--aplicar',
    '--seed', 'supabase/seeds/seed_plan_cuentas_base.sql'], { stdio: 'inherit' });
  if (r.status !== 0) fallo('migraciones/seed fallaron (ver arriba)');

  // ── 4. Verificación ──
  const c2 = new Client({ connectionString: dbUrl });
  await c2.connect();
  const q = async (sql: string) => (await c2.query(sql)).rows[0].n as number;
  const res = {
    tablas: await q("select count(*)::int as n from pg_tables where schemaname='public' and tablename <> '_migraciones'"),
    funciones: await q("select count(*)::int as n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.prokind='f'"),
    cuentas: await q('select count(*)::int as n from cuentas'),
    centros: await q('select count(*)::int as n from centros_costo'),
    mapeoEr: await q('select count(*)::int as n from mapeo_er'),
    mapeoBs: await q('select count(*)::int as n from mapeo_bs'),
  };
  await c2.end();

  let ok = true;
  for (const [k, esperado] of Object.entries(ESPERADO)) {
    const real = res[k as keyof typeof res];
    const bien = real === esperado;
    ok = ok && bien;
    console.log(`${bien ? '✓' : '✗'} ${k}: ${real} (esperado ${esperado})`);
  }
  if (!ok) fallo('la verificación no cuadra — revisar arriba');

  console.log(`
✓ BASE LISTA. Pasos MANUALES restantes (bootstrap-empresa.md):
  · Bucket Storage 'adjuntos' (público) en el dashboard de Supabase.
  · Revisar cuentas ⚠ intercompany y centros de costo de la empresa.
  · Proyecto Vercel + env vars (paso 4 del checklist).
  · Pase de verificación en el navegador (paso 5).
  · Agregar la base a scripts/empresas.json (local) para futuros cambios.`);
})();
