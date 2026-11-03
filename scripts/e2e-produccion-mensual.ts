/**
 * PRODUCCIÓN POR MES (025) — E2E en Chrome sobre un `next start` con los datos del validador (--conservar).
 *  · /por-facturar/produccion?desde&hasta: KPIs, una fila por mes del rango (también los vacíos), total; clic en un mes
 *    abre el detalle por línea y por cliente (link al cliente); botón CSV; completitud por fuente; sin errores JS.
 *  · /por-facturar/<grupo>: columna "Terminó" con fecha por prueba (title con la fuente), filtro "Terminadas en <mes>"
 *    que deja solo las pruebas de ese mes; cambiar el filtro de cobro a "Todos" para ver las facturadas.
 * Capturas en --out. Usuario descartable de Clerk (contador).
 *
 * Uso: npx tsx scripts/e2e-produccion-mensual.ts --env hit --base http://localhost:3012 --grupo n-99990011K --desde 2025-09 --hasta 2025-11 --out /ruta/capturas
 *      --sin-025  (base sin la migración: solo verifica que la página rinde con el aviso "falta la 025" y el detalle del cliente sigue sin la columna con datos)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ENV = arg('--env', 'hit');
const BASE = arg('--base', 'http://localhost:3012').replace(/\/$/, '');
const GRUPO = arg('--grupo', 'n-99990011K');
const DESDE = arg('--desde', '2025-09'), HASTA = arg('--hasta', '2025-11');
const OUT = arg('--out', path.join(os.tmpdir(), 'e2e-produccion'));
const CHROME = arg('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const SIN025 = process.argv.includes('--sin-025');
const envFile = ENV === 'hit' ? '.env.hit.vercel' : '.env.local';
for (const line of fs.readFileSync(path.join(process.cwd(), envFile), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('=');
  if (ENV === 'hit' || !(k.trim() in process.env)) process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  🟢 ${m}`); } else { fail++; console.log(`  🔴 ${m}`); } };
const SLUG = (process.env.EMPRESA_SLUG || 'golden').toLowerCase();
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

(async () => {
  const { chromium } = await import('playwright-core');
  const { createClerkClient } = await import(path.resolve(process.cwd(), 'node_modules/@clerk/backend/dist/index.mjs'));
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  const STAMP = Date.now().toString(36);
  let userId: string | null = null;
  fs.mkdirSync(OUT, { recursive: true });
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-produccion-'));
  const ctx = await chromium.launchPersistentContext(perfil, { executablePath: CHROME, headless: true, args: [`--user-agent=${UA}`], viewport: { width: 1280, height: 900 }, userAgent: UA, locale: 'es-GT' });
  console.log(`\nE2E producción por mes · ${ENV.toUpperCase()} · ${BASE}`);
  try {
    const u = await clerk.users.createUser({ emailAddress: [`e2e.produccion+${STAMP}@example.com`], password: `E2e-${STAMP}-${Math.random().toString(36).slice(2)}!Aa9`, firstName: 'E2E', lastName: 'Produccion', skipPasswordChecks: true, publicMetadata: { accesos: [{ empresa_slug: SLUG, rol: 'contador' }] } });
    userId = u.id;
    const ticket = (await clerk.signInTokens.createSignInToken({ userId: u.id, expiresInSeconds: 600 })).token;
    const page = ctx.pages()[0] ?? await ctx.newPage();
    page.setDefaultTimeout(30_000);
    const erroresJs: string[] = [];
    page.on('pageerror', e => erroresJs.push(e.message));
    await page.goto(`${BASE}/sign-in`);
    await page.waitForFunction(() => (window as unknown as { Clerk?: { loaded?: boolean } }).Clerk?.loaded === true, null, { timeout: 30_000 });
    await page.evaluate(async (t) => {
      const C = (window as unknown as { Clerk: { client: { signIn: { create: (a: unknown) => Promise<{ createdSessionId: string }> } }; setActive: (a: unknown) => Promise<void> } }).Clerk;
      const si = await C.client.signIn.create({ strategy: 'ticket', ticket: t });
      await C.setActive({ session: si.createdSessionId });
    }, ticket);
    await page.waitForURL(u2 => !u2.pathname.startsWith('/sign-in'), { timeout: 20_000 }).catch(() => null);
    ok(true, `sesión real de Clerk para usuario descartable rol contador en ${SLUG}`);

    // ── Reporte ──
    await page.goto(`${BASE}/por-facturar/produccion?desde=${DESDE}&hasta=${HASTA}`);
    await page.waitForSelector('[data-tabla="produccion"] tbody tr[data-mes]');
    const r = await page.evaluate(() => ({
      meses: [...document.querySelectorAll('[data-tabla="produccion"] tbody tr[data-mes]')].map(tr => tr.getAttribute('data-mes')),
      kpis: [...document.querySelectorAll('.kpi[data-kpi]')].map(k => `${k.getAttribute('data-kpi')}=${(k.querySelector('.kpi-value')?.textContent ?? '').trim()}`),
      falta025: !!document.querySelector('[data-falta-025]'),
      csv: !!document.querySelector('[data-accion="exportar-csv"]:not([disabled])'),
      fuentes: (document.querySelector('[data-fuentes]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    }));
    if (SIN025) {
      ok(r.falta025 && r.meses.length >= 2 && !r.csv, `base sin la 025: la página rinde con el aviso "falta la migración 025" (filas en cero, CSV deshabilitado); KPIs ${r.kpis.join(' · ')}`);
      await page.screenshot({ path: path.join(OUT, `produccion-sin-025-${ENV}-1280.png`), fullPage: true });
      await page.goto(`${BASE}/por-facturar/${GRUPO}`);
      await page.waitForSelector('[data-tabla-expedientes] table');
      const th = await page.evaluate(() => [...document.querySelectorAll('[data-tabla-expedientes] thead th')].map(t => (t.textContent ?? '').trim()));
      ok(th.includes('Terminó'), `detalle del cliente sin la 025: la columna "Terminó" existe (vacía hasta aplicar la migración)`);
      ok(erroresJs.length === 0, `sin errores JS${erroresJs.length ? ': ' + erroresJs.join(' | ') : ''}`);
      return;
    }
    const esperados = ((): string[] => { const o: string[] = []; const [y0, m0] = DESDE.split('-').map(Number); const [y1, m1] = HASTA.split('-').map(Number); for (let y = y0, m = m0; y * 12 + m <= y1 * 12 + m1; m++) { if (m > 12) { m = 1; y++; } o.push(`${y}-${String(m).padStart(2, '0')}`); } return o; })();
    ok(!r.falta025 && r.meses.slice(0, -1).join() === esperados.join() && r.meses[r.meses.length - 1] === 'total', `reporte: una fila por mes del rango (${esperados.join(', ')}) + total; sin aviso de "falta la 025"`);
    ok(r.kpis.length === 6 && r.kpis.some(k => k.startsWith('terminado=Q')) && r.kpis.some(k => k.startsWith('sin-fecha=')) && r.csv, `KPIs: ${r.kpis.join(' · ')} · botón CSV habilitado`);
    ok(/detectado: \d+ \([^)]*%\)/.test(r.fuentes) && /agenda: \d+/.test(r.fuentes) && /Cuando la Agenda mande/.test(r.fuentes), `completitud por fuente (detectado / agenda con %; aviso de qué pasa cuando lleguen las fechas reales): ${r.fuentes.slice(0, 150)}…`);
    await page.screenshot({ path: path.join(OUT, 'produccion-1280.png'), fullPage: true });
    // clic en un mes con datos → detalle por línea y por cliente
    const mesConDatos = await page.evaluate(() => { const tr = [...document.querySelectorAll('[data-tabla="produccion"] tbody tr[data-mes]')].find(t => t.getAttribute('data-mes') !== 'total' && /\d/.test(t.querySelectorAll('td')[1]?.textContent ?? '') && (t.querySelectorAll('td')[1]?.textContent ?? '').trim() !== '—'); return tr?.getAttribute('data-mes') ?? null; });
    ok(!!mesConDatos, `hay un mes con producción en el rango (${mesConDatos})`);
    if (mesConDatos) {
      await page.click(`[data-tabla="produccion"] tbody tr[data-mes="${mesConDatos}"]`);
      await page.waitForSelector(`[data-detalle-mes="${mesConDatos}"]`);
      const d = await page.evaluate(() => ({
        lineas: [...document.querySelectorAll('[data-tabla="por-servicio"] tbody tr[data-linea]')].map(t => t.getAttribute('data-linea')),
        clientes: [...document.querySelectorAll('[data-tabla="por-cliente"] tbody tr[data-cliente]')].map(t => `${t.getAttribute('data-cliente')}:${!!t.querySelector('a[href^="/por-facturar/"]')}`),
      }));
      ok(d.lineas.length >= 1 && d.lineas.every(l => ['poligrafo', 'socio', 'otros'].includes(l ?? '')) && d.clientes.length >= 1 && d.clientes.some(c => c.endsWith(':true')), `detalle de ${mesConDatos}: líneas ${d.lineas.join('/')}; clientes ${d.clientes.map(c => c.split(':')[0]).join(', ')} con link al cliente`);
      await page.screenshot({ path: path.join(OUT, 'produccion-detalle-mes-1280.png'), fullPage: true });
    }
    // rango inválido en la URL → cae al default sin romper
    const resp = await page.goto(`${BASE}/por-facturar/produccion?desde=2026-13&hasta=basura`);
    ok(!!resp && resp.status() === 200 && (await page.locator('[data-tabla="produccion"] tbody tr[data-mes]').count()) >= 2, 'rango inválido en la URL → 200 con el rango por defecto');

    // ── Detalle del cliente: columna "Terminó" + filtro por mes de terminación ──
    await page.goto(`${BASE}/por-facturar/${GRUPO}`);
    await page.waitForSelector('[data-tabla-expedientes] table');
    await page.selectOption('select[aria-label="Estado de cobro"]', 'todos');
    await page.waitForSelector('[data-tabla-expedientes] tbody tr[data-prueba]');
    const g = await page.evaluate(() => ({
      th: [...document.querySelectorAll('[data-tabla-expedientes] thead th')].map(t => (t.textContent ?? '').trim()),
      conFecha: [...document.querySelectorAll('[data-tabla-expedientes] tbody tr[data-prueba] td[data-termino]')].filter(td => /^\d{4}-\d{2}-\d{2}$/.test(td.getAttribute('data-termino') ?? '')).length,
      conTitle: [...document.querySelectorAll('[data-tabla-expedientes] tbody tr[data-prueba] td[data-termino] span[title^="Fuente:"]')].length,
      filas: document.querySelectorAll('[data-tabla-expedientes] tbody tr[data-prueba]').length,
      opciones: [...document.querySelectorAll('select[data-filtro="mes-resultado"] option')].map(o => (o as HTMLOptionElement).value).filter(Boolean),
    }));
    ok(g.th.includes('Terminó') && g.th.indexOf('Terminó') === g.th.indexOf('Prueba · estado') + 1, `columna "Terminó" junto a "Prueba · estado" (${g.th.join(' | ')})`);
    ok(g.conFecha > 0 && g.conTitle === g.conFecha && g.opciones.length >= 1, `${g.conFecha} de ${g.filas} pruebas con fecha de resultado (title con la fuente); meses disponibles: ${g.opciones.join(', ')}`);
    await page.screenshot({ path: path.join(OUT, 'detalle-cliente-termino-1280.png'), fullPage: true });
    if (g.opciones.length) {
      const mes = g.opciones[g.opciones.length - 1];
      await page.selectOption('select[data-filtro="mes-resultado"]', mes);
      await page.waitForTimeout(200);
      const f = await page.evaluate((m) => {
        const tds = [...document.querySelectorAll('[data-tabla-expedientes] tbody tr[data-prueba] td[data-termino]')];
        return { filas: tds.length, todasDelMes: tds.every(td => (td.getAttribute('data-termino') ?? '').startsWith(m)), texto: (document.querySelector('.card .card-pad span[style*="margin-left"]')?.textContent ?? '').trim() };
      }, mes);
      ok(f.filas > 0 && f.filas <= g.filas && f.todasDelMes, `filtro "Terminadas en ${mes}": quedan ${f.filas} prueba(s) y todas terminaron ese mes (${f.texto})`);
      await page.screenshot({ path: path.join(OUT, `detalle-cliente-terminadas-${mes}-1280.png`), fullPage: true });
    }
    ok(erroresJs.length === 0, `sin errores JS${erroresJs.length ? ': ' + erroresJs.join(' | ') : ''}`);
    console.log(`  · capturas en ${OUT}`);
  } catch (e) {
    fail++; console.log(`  🔴 excepción: ${(e as Error).message}`);
    await ctx.pages()[0]?.screenshot({ path: path.join(OUT, 'produccion-error.png') }).catch(() => null);
  } finally {
    await ctx.close().catch(() => null);
    if (userId) await clerk.users.deleteUser(userId).catch((e: Error) => console.log(`     ✗ clerk: ${e.message}`));
    console.log(`\n== ${pass} 🟢 / ${fail} 🔴 ==\n`);
    process.exit(fail ? 1 : 0);
  }
})();
