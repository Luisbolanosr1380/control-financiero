/**
 * BUSCAR FACTURAS POR MONTO — E2E en Chrome a 1280 y 390 px sobre un `next start` (HIT) con las facturas BM-E2E que
 * deja `validate-facturas-buscar.ts hit --conservar` (8,000 en dos líneas cobrada, 9,000 parcial, 8,000.60 emitida, 8,000
 * anulada, 3,000). Los conteos esperados se calculan con el mismo módulo del servidor sobre la base (resultadoDe).
 * Escribe `8000-10000` en el buscador → Enter → la URL lleva los criterios, el chip dice «Monto entre
 * Q8,000 y Q10,000 · todas», la tabla trae todas las coincidencias (el conteo coincide con el servidor), totales al pie,
 * CSV, Más filtros → estado pagadas → la URL cambia, ✕ quita la búsqueda; a 390 px sin desplazamiento horizontal de la
 * página; Cobros → Identificar muestra el atajo con el monto. Usuario descartable de Clerk (lectura).
 *
 * Uso: npx tsx scripts/e2e-facturas-buscar.ts --env hit --base http://localhost:3012 --out /ruta/capturas
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ENV = arg('--env', 'hit');
const BASE = arg('--base', 'http://localhost:3012').replace(/\/$/, '');
const OUT = arg('--out', path.join(os.tmpdir(), 'e2e-facturas-buscar'));
const CHROME = arg('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
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
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-bm-')), { executablePath: CHROME, headless: true, args: [`--user-agent=${UA}`], viewport: { width: 1280, height: 900 }, userAgent: UA, locale: 'es-GT', acceptDownloads: true });
  console.log(`\nE2E buscar facturas por monto · ${ENV.toUpperCase()} · ${BASE}`);
  try {
    const u = await clerk.users.createUser({ emailAddress: [`e2e.buscar+${STAMP}@example.com`], password: `E2e-${STAMP}-${Math.random().toString(36).slice(2)}!Aa9`, firstName: 'E2E', lastName: 'Buscar', skipPasswordChecks: true, publicMetadata: { accesos: [{ empresa_slug: SLUG, rol: 'lectura' }] } });
    userId = u.id;
    const ticket = (await clerk.signInTokens.createSignInToken({ userId: u.id, expiresInSeconds: 600 })).token;
    const page = ctx.pages()[0] ?? await ctx.newPage();
    page.setDefaultTimeout(30_000);
    const errores: string[] = []; page.on('pageerror', e => errores.push(e.message));
    await page.goto(`${BASE}/sign-in`);
    await page.waitForFunction(() => (window as unknown as { Clerk?: { loaded?: boolean } }).Clerk?.loaded === true, null, { timeout: 30_000 });
    await page.evaluate(async (t) => {
      const C = (window as unknown as { Clerk: { client: { signIn: { create: (a: unknown) => Promise<{ createdSessionId: string }> } }; setActive: (a: unknown) => Promise<void> } }).Clerk;
      const si = await C.client.signIn.create({ strategy: 'ticket', ticket: t });
      await C.setActive({ session: si.createdSessionId });
    }, ticket);
    await page.waitForURL(u2 => !u2.pathname.startsWith('/sign-in'), { timeout: 20_000 }).catch(() => null);
    ok(true, `sesión real de Clerk para usuario descartable rol lectura en ${SLUG} (ver Facturación alcanza)`);

    // esperado según el servidor (mismo módulo), para no depender de cuántas facturas tenga HIT
    const B = await import('../src/lib/db/facturas-buscar');
    const P = await import('../src/lib/facturacion/buscar-monto');
    const universo = await B.facturasParaBusqueda();
    const esperado = (c: Partial<import('../src/lib/facturacion/buscar-monto').CriteriosBusqueda>) => B.resultadoDe(universo, { ...P.CRITERIOS_VACIOS, ...c });
    const eRango = esperado({ desde: 8000, hasta: 10000 }), ePagadas = esperado({ desde: 8000, hasta: 10000, estado: 'pagadas' });
    ok(eRango.cantidad >= 3 && ePagadas.cantidad >= 1 && eRango.cantidad > ePagadas.cantidad, `datos: ${eRango.cantidad} facturas entre 8,000 y 10,000 en HIT (${ePagadas.cantidad} pagadas), con las BM-E2E sembradas`);

    // ── 1. el buscador entiende el rango y manda al servidor ──
    await page.goto(`${BASE}/facturacion`);
    await page.waitForSelector('[data-campo="buscar"]');
    await page.fill('[data-campo="buscar"]', '8000-10000');
    const boton = await page.textContent('[data-accion="buscar-monto"]');
    await page.press('[data-campo="buscar"]', 'Enter');
    await page.waitForSelector('[data-resultados-busqueda]');
    const r1 = await page.evaluate(() => ({ url: location.search, chip: document.querySelector('[data-chip-texto]')?.textContent, n: Number(document.querySelector('[data-resultados-busqueda]')?.getAttribute('data-resultados-busqueda')), filas: document.querySelectorAll('[data-lista="busqueda"] tbody tr[data-factura]').length, totales: !!document.querySelector('[data-totales-busqueda]'), suma: document.querySelector('[data-suma]')?.getAttribute('data-suma'), listado: !!document.querySelector('.table-wrap'), anuladas: document.querySelectorAll('[data-lista="busqueda"] tr[data-estado-fila="anulada"], [data-lista="busqueda"] tr[data-estado-fila="refacturada"]').length }));
    ok(/Buscar entre Q8,000(\.00)? y Q10,000(\.00)? en todas/.test(boton ?? '') && r1.url === '?desde=8000&hasta=10000' && r1.chip === 'Monto entre Q8,000 y Q10,000 · todas' && r1.n === r1.filas && r1.n === eRango.cantidad && r1.totales && Number(r1.suma) === eRango.suma && !r1.listado && r1.anuladas === 0, `«8000-10000» + Enter → URL ${r1.url}, chip "${r1.chip}", ${r1.filas} filas (= ${eRango.cantidad} del servidor; suma ${r1.suma}), totales al pie, sin anuladas (la BM-E2E-004 queda fuera), el listado paginado se oculta (botón: "${boton}")`);
    const totales = await page.evaluate(() => [...document.querySelectorAll('[data-lista="busqueda"] tbody tr [data-total]')].map(e => Number(e.getAttribute('data-total'))));
    ok(totales.every(t => t >= 8000 && t <= 10000) && totales.length === r1.filas, `todas las filas tienen total entre 8,000 y 10,000 (${totales.length})`);
    await page.screenshot({ path: path.join(OUT, 'busqueda-rango-1280.png'), fullPage: false });
    // CSV
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('[data-accion="exportar-csv"]')]);
    const csvPath = path.join(OUT, 'busqueda.csv'); await descarga.saveAs(csvPath);
    const csv = fs.readFileSync(csvPath, 'utf8');
    ok(/^﻿Factura,Fecha,Cliente,NIT,Total con IVA/.test(csv) && csv.split('\n').length === r1.filas + 2 && /^TOTAL,/m.test(csv), `CSV: encabezado, ${r1.filas} filas y la fila TOTAL`);

    // ── 2. Más filtros → pagadas; los criterios viajan en la URL ──
    await page.click('[data-accion="mas-filtros"]');
    await page.waitForSelector('[data-filtros-busqueda]');
    await page.selectOption('[data-campo="estado"]', 'pagadas');
    await page.click('[data-accion="buscar"]');
    await page.waitForFunction(() => location.search.includes('estado=pagadas'));
    await page.waitForSelector('[data-resultados-busqueda]');
    const r2 = await page.evaluate(() => ({ url: location.search, chip: document.querySelector('[data-chip-texto]')?.textContent, n: Number(document.querySelector('[data-resultados-busqueda]')?.getAttribute('data-resultados-busqueda')), estados: [...new Set([...document.querySelectorAll('[data-lista="busqueda"] tbody tr[data-factura]')].map(t => t.getAttribute('data-estado-fila')))] }));
    ok(r2.url === '?desde=8000&hasta=10000&estado=pagadas' && r2.chip === 'Monto entre Q8,000 y Q10,000 · pagadas' && r2.n === ePagadas.cantidad && r2.estados.join() === 'cobrada', `Más filtros → pagadas: URL ${r2.url}, chip "${r2.chip}", ${r2.n} facturas (= ${ePagadas.cantidad} del servidor), todas cobradas («COBRADO » con espacio)`);
    // volver a abrir la URL compartida: la búsqueda se conserva
    await page.goto(`${BASE}/facturacion?monto=8000&estado=pendientes&sobre=saldo`);
    await page.waitForSelector('[data-chip-busqueda]');
    const eSaldo = esperado({ monto: 8000, estado: 'pendientes', sobre: 'saldo' });
    const r3 = await page.evaluate(() => ({ chip: document.querySelector('[data-chip-texto]')?.textContent, n: Number(document.querySelector('[data-resultados-busqueda]')?.getAttribute('data-resultados-busqueda')), dif: [...document.querySelectorAll('[data-lista="busqueda"] tbody tr[data-factura] td:nth-child(10)')].map(e => e.textContent) }));
    ok(r3.chip === 'Monto Q8,000 ±Q1 · pendientes · sobre saldo pendiente' && r3.n === eSaldo.cantidad && r3.n >= 1 && r3.dif.some(d => /\+Q0\.60|exacto/.test(d ?? '')), `URL compartida → la búsqueda se arma igual: "${r3.chip}", ${r3.n} facturas con la columna de diferencia (${r3.dif.join(' · ')})`);
    // ✕ quita la búsqueda
    await page.click('[data-accion="quitar-busqueda"]');
    await page.waitForSelector('.table-wrap');
    const r4 = await page.evaluate(() => ({ url: location.search, chip: !!document.querySelector('[data-chip-busqueda]') }));
    ok(r4.url === '' && !r4.chip, '✕ quita la búsqueda y vuelve el listado paginado');

    // ── 3. 390 px ──
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/facturacion`);
    await page.waitForSelector('[data-campo="buscar"]');
    const base390 = await page.evaluate(() => document.documentElement.scrollWidth);
    await page.goto(`${BASE}/facturacion?desde=8000&hasta=10000`);
    await page.waitForSelector('[data-resultados-busqueda]');
    const r5 = await page.evaluate(() => {
      const vp = window.innerWidth;
      const anchos = [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > vp + 1 && !e.closest('.table-scroll table')).slice(0, 6).map(e => `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : ''}${[...e.attributes].filter(a => a.name.startsWith('data-')).map(a => `[${a.name}]`).join('')}:${Math.round(e.getBoundingClientRect().right)}`);
      return { ancho: document.documentElement.scrollWidth, vp, filas: document.querySelectorAll('[data-lista="busqueda"] tbody tr[data-factura]').length, anchos };
    });
    ok(r5.ancho <= Math.max(r5.vp + 1, base390) && r5.filas === r1.filas, `390 px: la búsqueda no ensancha la página más que el listado (${r5.ancho} vs ${base390} sin búsqueda, viewport ${r5.vp}); las mismas ${r5.filas} filas (la tabla se desplaza dentro de su tarjeta)${r5.ancho > r5.vp + 1 ? ' · se salen: ' + r5.anchos.join(' | ') : ''}`);
    await page.screenshot({ path: path.join(OUT, 'busqueda-rango-390.png'), fullPage: false });
    await page.setViewportSize({ width: 1280, height: 900 });

    // ── 4. Cobros → Identificar: atajo ──
    await page.goto(`${BASE}/cobros/identificar`);
    await page.waitForSelector('input[inputmode="decimal"]');
    await page.fill('input[inputmode="decimal"]', '9450');
    await page.waitForSelector('[data-accion="buscar-facturas-monto"]');
    const href = await page.getAttribute('[data-accion="buscar-facturas-monto"]', 'href');
    await page.click('[data-accion="buscar-facturas-monto"]');
    await page.waitForSelector('[data-chip-busqueda]');
    const r6 = await page.evaluate(() => ({ chip: document.querySelector('[data-chip-texto]')?.textContent, url: location.search }));
    ok(href === '/facturacion?monto=9450&estado=pendientes' && r6.chip === 'Monto Q9,450 ±Q1 · pendientes', `Identificar → «Buscar facturas por este monto» abre ${r6.url} con el chip "${r6.chip}"`);
    await page.screenshot({ path: path.join(OUT, 'identificar-atajo-1280.png'), fullPage: false });
    ok(errores.length === 0, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
  } finally {
    await ctx.close().catch(() => null);
    if (userId) await clerk.users.deleteUser(userId).catch(() => null);
    console.log('  (usuario descartable borrado)');
  }
  console.log(`\n${pass} 🟢 / ${fail} 🔴`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
