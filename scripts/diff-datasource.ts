/**
 * MIGRACIÓN CAPA 2 · Fase 1 — Validación paralela Airtable vs Supabase.
 *
 * Corre la MISMA función pública de /lib/db dos veces (forzando el backend
 * con DATA_SOURCE_FORCE) y compara los resultados: conteo + diff campo por
 * campo. Solo se flipea el flag de una tabla cuando su diff sale limpio.
 *
 * Uso:
 *   npx tsx scripts/diff-datasource.ts                # todas las tablas
 *   npx tsx scripts/diff-datasource.ts deudas cobros  # subset
 */

import fs from 'node:fs';
import path from 'node:path';

// ── cargar .env.local (tsx no lo hace solo) ──────────────────────────
const envFile = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const [k, ...rest] = t.split('=');
    if (!(k in process.env)) process.env[k.trim()] = rest.join('=').trim().replace(/^"|"$/g, '');
  }
}

/* ============================================================
 * Diff genérico
 * ============================================================ */

interface Mismatch { path: string; airtable: unknown; supabase: unknown }

const EPS = 0.005;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Map) && !(v instanceof Date);
}

function keyOf(el: unknown): string | null {
  if (!isPlainObject(el)) return null;
  for (const k of ['id', 'key', 'grupoId', 'planillaId', 'clienteId', 'noFactura', 'tipo', 'acreedor', 'motivo', 'periodoId']) {
    const v = el[k];
    if (typeof v === 'string' && v) return `${k}:${v}`;
  }
  return null;
}

function cmp(a: unknown, b: unknown, p: string, out: Mismatch[], ignore: (path: string) => boolean): void {
  if (ignore(p)) return;
  if (typeof a === 'number' && typeof b === 'number') {
    const ok = (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) < EPS;
    if (!ok) out.push({ path: p, airtable: a, supabase: b });
    return;
  }
  if (a instanceof Map && b instanceof Map) {
    cmp(Object.fromEntries(a), Object.fromEntries(b), p, out, ignore);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const ka = a.map(keyOf);
    const kb = b.map(keyOf);
    if (ka.every(k => k !== null) && kb.every(k => k !== null)) {
      const mapA = new Map(a.map((el, i) => [ka[i]!, el]));
      const mapB = new Map(b.map((el, i) => [kb[i]!, el]));
      for (const [k, el] of mapA) {
        if (!mapB.has(k)) {
          if (!ignore(`${p}[${k}]`)) out.push({ path: `${p}[${k}]`, airtable: '(presente)', supabase: '(AUSENTE)' });
        } else cmp(el, mapB.get(k), `${p}[${k}]`, out, ignore);
      }
      for (const k of mapB.keys()) {
        if (!mapA.has(k) && !ignore(`${p}[${k}]`)) out.push({ path: `${p}[${k}]`, airtable: '(AUSENTE)', supabase: '(presente)' });
      }
      // El ORDEN también importa (páginas, tops): comparar secuencia de keys.
      if (ka.join('|') !== kb.join('|') && !ignore(`${p}.__orden__`)) {
        out.push({ path: `${p}.__orden__`, airtable: ka.slice(0, 8).join(','), supabase: kb.slice(0, 8).join(',') });
      }
      return;
    }
    if (a.length !== b.length) {
      out.push({ path: `${p}.length`, airtable: a.length, supabase: b.length });
      return;
    }
    for (let i = 0; i < a.length; i++) cmp(a[i], b[i], `${p}[${i}]`, out, ignore);
    return;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      cmp(a[k], b[k], `${p}.${k}`, out, ignore);
    }
    return;
  }
  const same = a === b || (a == null && b == null);
  if (!same) out.push({ path: p, airtable: a, supabase: b });
}

async function conFuente<T>(src: 'airtable' | 'supabase', fn: () => Promise<T>): Promise<T> {
  process.env.DATA_SOURCE_FORCE = src;
  try {
    return await fn();
  } finally {
    delete process.env.DATA_SOURCE_FORCE;
  }
}

interface Caso {
  nombre: string;
  run: () => Promise<unknown>;
  /** paths a ignorar (gaps documentados: adjuntos, historial, etc.) */
  ignora?: RegExp[];
}

let fallas = 0;

async function correr(tabla: string, casos: Caso[]): Promise<void> {
  console.log(`\n══════ ${tabla} ══════`);
  for (const c of casos) {
    const ignore = (p: string) => (c.ignora ?? []).some(re => re.test(p));
    try {
      const [air, supa] = [
        await conFuente('airtable', c.run),
        await conFuente('supabase', c.run),
      ];
      const out: Mismatch[] = [];
      cmp(air, supa, '$', out, ignore);
      if (out.length === 0) {
        const len = Array.isArray(air) ? ` (${(air as unknown[]).length} items)` : '';
        console.log(`  🟢 ${c.nombre}${len}`);
      } else {
        fallas += 1;
        console.log(`  🔴 ${c.nombre}: ${out.length} diferencias`);
        const cap = Number(process.env.DIFF_PRINT ?? 12);
        for (const m of out.slice(0, cap)) {
          console.log(`     · ${m.path}\n         airtable: ${JSON.stringify(m.airtable)}\n         supabase: ${JSON.stringify(m.supabase)}`);
        }
        if (out.length > cap) console.log(`     … y ${out.length - cap} más`);
      }
    } catch (err) {
      fallas += 1;
      console.log(`  💥 ${c.nombre}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/* ============================================================
 * Main
 * ============================================================ */

async function main() {
  const soloTablas = process.argv.slice(2);
  const quiere = (t: string) => soloTablas.length === 0 || soloTablas.includes(t);

  // Gaps documentados (Fase 2): adjuntos (URLs Airtable expiran y no se
  // migraron) e historial de ediciones.
  const IG_ADJUNTO = [/adjuntoUrl/, /adjuntoNombre/, /historialEdiciones/, /boletaUrl/, /boletaNombre/, /constanciaUrl/, /constanciaNombre/, /tieneConstancia/];

  if (quiere('centros_costo')) {
    const { getCentrosCosto } = await import('../src/lib/db/centros');
    await correr('centros_costo', [{ nombre: 'getCentrosCosto()', run: () => getCentrosCosto() }]);
  }

  if (quiere('cuentas')) {
    const { getCuentas, getCuentasGasto } = await import('../src/lib/db/cuentas');
    // Divergencia DOCUMENTADA: Airtable tiene 3 cuentas "Nómina Directa *"
    // con codigo_path duplicado (5-1-3-2 / 5-1-4-2 / 5-1-5-2); Postgres las
    // guarda con el siguiente código libre (…-3). El brief ya contempla
    // actualizar Airtable a esos códigos en Fase 2/3. El __orden__ solo
    // difiere por esos 3 códigos (la lista va sorted por código).
    const IG_CODIGOS_REASIGNADOS = [
      /id:reckqFTk5CnY7rHFC\]\.codigo/,
      /id:reczi8KqO4NrkMe26\]\.codigo/,
      /id:rec23VvQjJjCQxgLo\]\.codigo/,
      /__orden__/,
    ];
    await correr('cuentas', [
      { nombre: 'getCuentas() [3 códigos reasignados ignorados]', run: () => getCuentas(), ignora: IG_CODIGOS_REASIGNADOS },
      { nombre: 'getCuentasGasto()', run: () => getCuentasGasto() },
    ]);
  }

  if (quiere('bancos')) {
    const { getBancos } = await import('../src/lib/db/bancos');
    await correr('bancos', [{ nombre: 'getBancos()', run: () => getBancos() }]);
  }

  if (quiere('clientes')) {
    const { getClientes } = await import('../src/lib/db/clientes');
    await correr('clientes', [{ nombre: 'getClientes()', run: () => getClientes() }]);
  }

  if (quiere('acreedores')) {
    const { getAcreedores } = await import('../src/lib/db/deudas');
    await correr('acreedores', [{ nombre: 'getAcreedores()', run: () => getAcreedores() }]);
  }

  if (quiere('deudas')) {
    const { getDeudas, getKPIsDeudas } = await import('../src/lib/db/deudas');
    await correr('deudas', [
      { nombre: 'getDeudas()', run: () => getDeudas() },
      { nombre: 'getKPIsDeudas()', run: () => getKPIsDeudas() },
    ]);
  }

  if (quiere('facturas_clientes')) {
    const { getFacturas, getFacturasLiviano, getFacturasCountTotal, getFacturasPagina } = await import('../src/lib/db/facturas');
    await correr('facturas_clientes', [
      { nombre: 'getFacturas()', run: () => getFacturas(), ignora: IG_ADJUNTO },
      { nombre: 'getFacturasLiviano()', run: () => getFacturasLiviano(), ignora: IG_ADJUNTO },
      { nombre: 'getFacturasLiviano({mes actual-1})', run: () => getFacturasLiviano({ mes: '2026-07' }), ignora: IG_ADJUNTO },
      { nombre: 'getFacturasCountTotal()', run: () => getFacturasCountTotal() },
      { nombre: 'getFacturasPagina({limit:40})', run: () => getFacturasPagina({ limit: 40 }), ignora: IG_ADJUNTO },
      { nombre: 'getFacturasPagina({filtro:por_cobrar})', run: () => getFacturasPagina({ limit: 40, filtro: 'por_cobrar' }), ignora: IG_ADJUNTO },
    ]);
  }

  if (quiere('cobros_clientes')) {
    const { getCobrosCompletos, getCobrosCountTotal, getCobrosPagina, getSaldoPendiente, getCobrosDeFactura } = await import('../src/lib/db/cobros');
    // Factura de muestra con cobros: la más reciente del listado airtable.
    const muestra = await conFuente('airtable', async () => {
      const cs = await getCobrosCompletos();
      return cs.find(c => c.noFactura)?.noFactura ?? '';
    });
    await correr('cobros_clientes', [
      { nombre: 'getCobrosCompletos()', run: () => getCobrosCompletos(), ignora: IG_ADJUNTO },
      { nombre: 'getCobrosCountTotal()', run: () => getCobrosCountTotal() },
      { nombre: 'getCobrosPagina({limit:40})', run: () => getCobrosPagina({ limit: 40 }), ignora: IG_ADJUNTO },
      { nombre: `getSaldoPendiente(${muestra})`, run: () => getSaldoPendiente(muestra) },
      // Divergencia DOCUMENTADA (a favor de Supabase): el filterByFormula de
      // Airtable sobre el lookup 'NO.FACTURA (from Factura Cliente)' NO
      // matchea cobros vinculados a VARIAS facturas (~74 históricos) — esos
      // cobros desaparecen del detalle en Airtable. Supabase sí los muestra.
      { nombre: `getCobrosDeFactura(${muestra}) [multi-factura ignorado]`, run: () => getCobrosDeFactura(muestra), ignora: [...IG_ADJUNTO, /__legacy__/, /__orden__/] },
    ]);
  }

  if (quiere('pagos_proveedores')) {
    const { getPagosRecientes, getCuentasBancoParaPago, getPagosPorDeuda } = await import('../src/lib/db/pagos-deudas');
    const deudaMuestra = await conFuente('airtable', async () => {
      const ps = await getPagosRecientes(1, { incluirAnulados: true });
      return ps[0]?.deudaId ?? '';
    });
    await correr('pagos_proveedores', [
      { nombre: 'getPagosRecientes(60)', run: () => getPagosRecientes(60, { incluirAnulados: true }) },
      { nombre: 'getCuentasBancoParaPago()', run: () => getCuentasBancoParaPago() },
      { nombre: `getPagosPorDeuda(${deudaMuestra})`, run: () => getPagosPorDeuda(deudaMuestra) },
    ]);
  }

  if (quiere('empleados')) {
    const { getEmpleados, getKPIsPlanilla } = await import('../src/lib/db/empleados');
    await correr('empleados', [
      { nombre: 'getEmpleados()', run: () => getEmpleados() },
      { nombre: 'getKPIsPlanilla()', run: () => getKPIsPlanilla() },
    ]);
  }

  if (quiere('periodos') || quiere('planilla')) {
    const { getPeriodos, getLineasPlanilla } = await import('../src/lib/db/planillas');
    const periodoMuestra = await conFuente('airtable', async () => {
      const ps = await getPeriodos({ estado: 'todos' });
      return ps[0]?.id ?? '';
    });
    await correr('periodos + planilla', [
      { nombre: 'getPeriodos({todos})', run: () => getPeriodos({ estado: 'todos' }) },
      { nombre: `getLineasPlanilla(${periodoMuestra})`, run: () => getLineasPlanilla(periodoMuestra), ignora: IG_ADJUNTO },
    ]);
  }

  if (quiere('obligaciones_recurrentes')) {
    const { getObligacionesRecurrentes } = await import('../src/lib/flujo/obligaciones');
    await correr('obligaciones_recurrentes', [
      { nombre: 'getObligacionesRecurrentes()', run: () => getObligacionesRecurrentes() },
    ]);
  }

  if (quiere('notas_credito')) {
    const { getNotasCredito, getKPIsNotasCredito } = await import('../src/lib/db/notas-credito');
    await correr('notas_credito', [
      { nombre: 'getNotasCredito()', run: () => getNotasCredito(), ignora: IG_ADJUNTO },
      { nombre: 'getKPIsNotasCredito()', run: () => getKPIsNotasCredito() },
    ]);
  }

  console.log(`\n${fallas === 0 ? '✓ DIFF LIMPIO' : `✗ ${fallas} casos con diferencias`}`);
  process.exit(fallas === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
