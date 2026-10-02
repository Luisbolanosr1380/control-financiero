/**
 * FASE MOLDE · Pieza 1 — Runner de migraciones multi-empresa.
 *
 * Corre las migraciones PENDIENTES de supabase/migrations/ (orden por
 * nombre de archivo) sobre una o varias bases Postgres. Lleva registro
 * en la tabla `_migraciones` de cada base — correrlo dos veces no
 * re-aplica nada.
 *
 * USO:
 *   npx tsx scripts/migrar-todas.ts                        # dry-run sobre scripts/empresas.json
 *   npx tsx scripts/migrar-todas.ts --aplicar              # aplica sobre empresas.json
 *   npx tsx scripts/migrar-todas.ts --db <url> [--aplicar] # una base puntual
 *   npx tsx scripts/migrar-todas.ts --db <url> --aplicar --seed supabase/seeds/seed_plan_cuentas_base.sql
 *
 * SEGURIDAD:
 *   - Sin --aplicar es SIEMPRE dry-run (lista qué haría, no toca nada).
 *   - Cada migración corre en SU transacción: si falla, esa base queda
 *     como estaba antes de ese archivo y el runner corta ahí.
 *   - La lista de empresas vive en scripts/empresas.json — nace vacía;
 *     el usuario la llena cuando existan las bases reales.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const RAIZ = path.resolve(__dirname, '..');
const DIR_MIGRACIONES = path.join(RAIZ, 'supabase', 'migrations');
const ARCHIVO_EMPRESAS = path.join(__dirname, 'empresas.json');

interface Empresa { nombre: string; dbUrl: string }

function argsCli() {
  const argv = process.argv.slice(2);
  const flag = (f: string) => argv.includes(f);
  const valor = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
  };
  return { aplicar: flag('--aplicar'), db: valor('--db'), seed: valor('--seed') };
}

function cargarEmpresas(): Empresa[] {
  if (!fs.existsSync(ARCHIVO_EMPRESAS)) return [];
  const data = JSON.parse(fs.readFileSync(ARCHIVO_EMPRESAS, 'utf8'));
  return (data.empresas ?? []).filter((e: Empresa) => e.dbUrl && !e.dbUrl.includes('<'));
}

function archivosMigracion(): string[] {
  return fs.readdirSync(DIR_MIGRACIONES)
    .filter(f => /^\d{3}_.*\.sql$/.test(f))
    .sort();   // orden léxico = orden numérico con prefijo 00N
}

async function migrarBase(nombre: string, dbUrl: string, aplicar: boolean, seedPath: string | null): Promise<boolean> {
  const cliente = new Client({ connectionString: dbUrl });
  await cliente.connect();
  try {
    await cliente.query(`create table if not exists _migraciones (
      nombre text primary key,
      aplicada_en timestamptz not null default now()
    )`);
    const { rows } = await cliente.query('select nombre from _migraciones');
    const aplicadas = new Set(rows.map(r => r.nombre));
    const pendientes = archivosMigracion().filter(f => !aplicadas.has(f));

    console.log(`\n■ ${nombre} — ${aplicadas.size} aplicadas, ${pendientes.length} pendientes`);
    if (pendientes.length === 0 && !seedPath) return true;

    for (const archivo of pendientes) {
      if (!aplicar) { console.log(`  · (dry-run) aplicaría ${archivo}`); continue; }
      const sql = fs.readFileSync(path.join(DIR_MIGRACIONES, archivo), 'utf8');
      try {
        await cliente.query('begin');
        await cliente.query(sql);
        await cliente.query('insert into _migraciones (nombre) values ($1)', [archivo]);
        await cliente.query('commit');
        console.log(`  ✓ ${archivo}`);
      } catch (err) {
        await cliente.query('rollback');
        console.error(`  ✗ ${archivo}: ${err instanceof Error ? err.message : err}`);
        console.error('    (rollback — la base quedó como antes de este archivo; el runner corta acá)');
        return false;
      }
    }

    if (seedPath) {
      const sql = fs.readFileSync(path.resolve(RAIZ, seedPath), 'utf8');
      if (!aplicar) {
        console.log(`  · (dry-run) aplicaría seed ${seedPath}`);
      } else {
        try {
          await cliente.query('begin');
          await cliente.query(sql);
          await cliente.query('commit');
          console.log(`  ✓ seed ${path.basename(seedPath)} (idempotente: se omite solo si ya hay datos)`);
        } catch (err) {
          await cliente.query('rollback');
          console.error(`  ✗ seed: ${err instanceof Error ? err.message : err}`);
          return false;
        }
      }
    }
    return true;
  } finally {
    await cliente.end();
  }
}

(async () => {
  const { aplicar, db, seed } = argsCli();
  const objetivos: Empresa[] = db
    ? [{ nombre: '(base puntual --db)', dbUrl: db }]
    : cargarEmpresas();

  if (objetivos.length === 0) {
    console.log('Sin bases objetivo. Llená scripts/empresas.json o pasá --db <url>.');
    console.log('Formato: { "empresas": [{ "nombre": "Empresa X", "dbUrl": "postgresql://..." }] }');
    process.exit(0);
  }
  console.log(`${aplicar ? '⚡ APLICANDO' : '· DRY-RUN (usar --aplicar para ejecutar)'} — ${archivosMigracion().length} migraciones en el molde`);

  let ok = true;
  for (const e of objetivos) {
    try {
      ok = (await migrarBase(e.nombre, e.dbUrl, aplicar, seed)) && ok;
    } catch (err) {
      console.error(`■ ${e.nombre}: no se pudo conectar — ${err instanceof Error ? err.message : err}`);
      ok = false;
    }
  }
  process.exit(ok ? 0 : 1);
})();
