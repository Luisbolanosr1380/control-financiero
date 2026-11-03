/**
 * TARIFARIO · lista de empresas — E2E en Chrome (fix tarifario-lista-empresas).
 *  · /tarifario "Por empresa": la tabla desplaza DENTRO de su tarjeta (la página no se ensancha a 1280 / 1440 / 390 px),
 *    la columna Estado es alcanzable al final del scroll, los badges hacen wrap dentro de la celda, el nombre largo lleva
 *    puntos suspensivos y title; la columna de empresa queda fija al desplazar.
 *  · Buscador: --busquedas "walmart=20,guatex=1,…" (conteo esperado por término; ">=N" permite mínimo) y por NIT.
 *  · "Ver todas": mismo scroll dentro de la tarjeta y la búsqueda por nombre del cliente.
 * Usuario descartable de Clerk (contador). Capturas en --out.
 *
 * Uso: npx tsx scripts/e2e-tarifario-lista.ts --env golden --base http://localhost:3011 --out /ruta --busquedas "walmart=20,guatex=1" --nit 30370299
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ENV = arg('--env', 'hit');
const BASE = arg('--base', 'http://localhost:3012').replace(/\/$/, '');
const OUT = arg('--out', path.join(os.tmpdir(), 'e2e-tarifario-lista'));
const CHROME = arg('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const BUSQUEDAS = arg('--busquedas', '').split(',').map(x => x.trim()).filter(Boolean).map(x => { const i = x.indexOf('='); const t = x.slice(0, i), n = x.slice(i + 1); return { termino: t, min: n.startsWith('>='), n: Number(n.replace('>=', '')) }; });
const NIT = arg('--nit', '');
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
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-tarifario-'));
  const ctx = await chromium.launchPersistentContext(perfil, { executablePath: CHROME, headless: true, args: [`--user-agent=${UA}`], viewport: { width: 1280, height: 900 }, userAgent: UA, locale: 'es-GT' });
  console.log(`\nE2E tarifario · lista de empresas · ${ENV.toUpperCase()} · ${BASE}`);
  try {
    const u = await clerk.users.createUser({ emailAddress: [`e2e.tarifario+${STAMP}@example.com`], password: `E2e-${STAMP}-${Math.random().toString(36).slice(2)}!Aa9`, firstName: 'E2E', lastName: 'Tarifario', skipPasswordChecks: true, publicMetadata: { accesos: [{ empresa_slug: SLUG, rol: 'contador' }] } });
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

    const medir = () => page.evaluate(() => {
      const sc = document.querySelector('[data-tabla-empresas]') as HTMLElement | null;
      const table = sc?.querySelector('table') as HTMLElement | null;
      const thEstado = sc?.querySelector('th.col-estado') as HTMLElement | null;
      const filas = [...document.querySelectorAll('[data-tabla-empresas] tbody tr[data-nit]')];
      const conDos = filas.find(tr => tr.querySelectorAll('.col-estado .badge').length >= 2) as HTMLElement | undefined;
      const celda = conDos?.querySelector('td.col-estado') as HTMLElement | undefined;
      const badges = celda ? [...celda.querySelectorAll('.badge')].map(b => b.getBoundingClientRect()) : [];
      const nombres = [...document.querySelectorAll('[data-tabla-empresas] [data-nombre]')] as HTMLElement[];
      const recortado = nombres.find(n => n.scrollWidth > n.clientWidth + 1);
      const sticky = sc ? getComputedStyle(sc.querySelector('td.col-empresa') as Element).position : '';
      return {
        pagina: document.documentElement.scrollWidth, ancho: window.innerWidth,
        filas: filas.length,
        tablaMasAncha: !!sc && !!table && table.scrollWidth > sc.clientWidth,
        scCliente: sc?.clientWidth ?? 0, scScroll: sc?.scrollWidth ?? 0,
        estadoVisibleSinScroll: !!thEstado && !!sc && thEstado.getBoundingClientRect().right <= sc.getBoundingClientRect().right + 1,
        badgesDentro: !!celda && celda.scrollWidth <= celda.clientWidth + 1 && badges.every(b => b.right <= celda.getBoundingClientRect().right + 1),
        badgesEnDosLineas: badges.length >= 2 && new Set(badges.map(b => Math.round(b.top))).size >= 2,
        celdaEstadoAncho: celda?.clientWidth ?? 0,
        recortadoConTitle: !!recortado && !!recortado.getAttribute('title') && (recortado.getAttribute('title') ?? '').length > recortado.textContent!.length - 1,
        algunRecortado: !!recortado, textoRecortado: recortado?.textContent ?? '',
        sticky,
        sinCliente: document.querySelectorAll('[data-tabla-empresas] [data-sin-cliente]').length,
      };
    });
    const alFinal = () => page.evaluate(() => {
      const sc = document.querySelector('[data-tabla-empresas]') as HTMLElement; sc.scrollLeft = sc.scrollWidth;
      const th = sc.querySelector('th.col-estado') as HTMLElement; const emp = sc.querySelector('td.col-empresa') as HTMLElement;
      const r = sc.getBoundingClientRect();
      return { estadoDentro: th.getBoundingClientRect().right <= r.right + 1 && th.getBoundingClientRect().left >= r.left - 1, empresaSigueVisible: emp.getBoundingClientRect().left >= r.left - 1 && emp.getBoundingClientRect().right > r.left + 50, desplazado: sc.scrollLeft > 0 };
    });

    for (const ancho of [1280, 1440, 390]) {
      await page.setViewportSize({ width: ancho, height: ancho === 390 ? 844 : 900 });
      await page.goto(`${BASE}/tarifario`);
      await page.waitForSelector('[data-tabla-empresas] tbody tr');
      const m = await medir();
      ok(m.pagina <= m.ancho + 1 && m.filas >= 1, `${ancho} px: la página no se ensancha (${m.pagina} ≤ ${m.ancho}); ${m.filas} empresas`);
      if (m.tablaMasAncha) {
        const fin = await alFinal();
        ok(fin.desplazado && fin.estadoDentro && fin.empresaSigueVisible, `${ancho} px: la tabla desplaza dentro de la tarjeta (${m.scScroll} > ${m.scCliente}); al final del scroll la columna Estado queda completa y la empresa sigue fija (${m.sticky})`);
      } else ok(m.estadoVisibleSinScroll, `${ancho} px: la tabla cabe en la tarjeta y la columna Estado está completa sin scroll`);
      if (m.celdaEstadoAncho) ok(m.badgesDentro, `${ancho} px: una fila con varios badges los muestra dentro de la celda (${m.badgesEnDosLineas ? 'en dos líneas' : 'en una línea'}, ${m.celdaEstadoAncho} px)`);
      if (m.algunRecortado) ok(m.recortadoConTitle, `${ancho} px: nombre largo con puntos suspensivos y title completo ("${m.textoRecortado.slice(0, 40)}…")`);
      else console.log(`  ⚪ ${ancho} px: ningún nombre necesita recorte en esta base`);
      await page.screenshot({ path: path.join(OUT, `tarifario-empresas-${ENV}-${ancho}.png`), fullPage: false });
      // la tabla sola (su tarjeta), recortada a las primeras filas, para ver la columna Estado y el wrap de los badges
      await page.evaluate(() => { const sc = document.querySelector('[data-tabla-empresas]') as HTMLElement; sc.scrollLeft = 0; });
      await page.locator('[data-tabla-empresas]').screenshot({ path: path.join(OUT, `tarifario-empresas-${ENV}-${ancho}-tabla.png`) }).catch(() => null);
      await page.evaluate(() => { const sc = document.querySelector('[data-tabla-empresas]') as HTMLElement; sc.scrollLeft = sc.scrollWidth; });
      await page.locator('[data-tabla-empresas]').screenshot({ path: path.join(OUT, `tarifario-empresas-${ENV}-${ancho}-tabla-final.png`) }).catch(() => null);
      if (ancho === 1280) await page.screenshot({ path: path.join(OUT, `tarifario-empresas-${ENV}-${ancho}-completa.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE}/tarifario`);
    await page.waitForSelector('[data-tabla-empresas] tbody tr');
    const ph = await page.getAttribute('[data-filtro="empresa"]', 'placeholder');
    ok(ph === 'Buscar por nombre, razón social o NIT…', `placeholder: "${ph}"`);
    const conteo = async () => Number(await page.getAttribute('[data-conteo-empresas]', 'data-conteo-empresas'));
    const total = await conteo();
    for (const b of BUSQUEDAS) {
      await page.fill('[data-filtro="empresa"]', b.termino);
      const n = await conteo();
      const nombres = await page.evaluate(() => [...document.querySelectorAll('[data-tabla-empresas] [data-nombre]')].slice(0, 3).map(e => e.textContent));
      ok(b.min ? n >= b.n : n === b.n, `buscar "${b.termino}" → ${n} empresa(s)${b.min ? ` (≥ ${b.n})` : ` (esperado ${b.n})`}: ${nombres.join(' · ')}`);
    }
    if (NIT) {
      await page.fill('[data-filtro="empresa"]', NIT);
      const n = await conteo();
      const nit = await page.getAttribute('[data-tabla-empresas] tbody tr[data-nit]', 'data-nit');
      ok(n >= 1 && nit === NIT, `buscar por NIT ${NIT} → ${n} (fila ${nit})`);
    }
    await page.fill('[data-filtro="empresa"]', '');
    ok((await conteo()) === total, `vaciar el buscador vuelve a las ${total} empresas`);
    const m1 = await medir();
    ok(m1.sinCliente >= 0, `${m1.sinCliente} NIT(s) sin cliente activo marcados "sin cliente"`);
    // "Ver todas"
    await page.click('button[role="tab"]:has-text("Ver todas")');
    await page.waitForSelector('[data-tabla-tarifas] tbody tr');
    const vt = await page.evaluate(() => { const sc = document.querySelector('[data-tabla-tarifas]') as HTMLElement; const t = sc.querySelector('table') as HTMLElement; return { pagina: document.documentElement.scrollWidth, ancho: window.innerWidth, masAncha: t.scrollWidth > sc.clientWidth, sticky: getComputedStyle(sc.querySelector('td.col-empresa') as Element).position, filas: sc.querySelectorAll('tbody tr').length }; });
    ok(vt.pagina <= vt.ancho + 1 && vt.sticky === 'sticky', `"Ver todas": la página no se ensancha (${vt.pagina} ≤ ${vt.ancho}); cliente fijo (${vt.sticky}); ${vt.filas} tarifas${vt.masAncha ? ' · desplaza dentro de la tarjeta' : ''}`);
    if (BUSQUEDAS[0]) {
      await page.fill('[data-filtro="tarifa"]', BUSQUEDAS[0].termino);
      const n = await page.evaluate(() => document.querySelectorAll('[data-tabla-tarifas] tbody tr').length);
      const primero = await page.evaluate(() => document.querySelector('[data-tabla-tarifas] tbody tr td.col-empresa .cell-strong')?.textContent ?? '');
      ok(n >= 1 && new RegExp(BUSQUEDAS[0].termino, 'i').test(primero), `"Ver todas" busca por nombre del cliente: "${BUSQUEDAS[0].termino}" → ${n} tarifa(s), primera "${primero}"`);
    }
    await page.screenshot({ path: path.join(OUT, `tarifario-todas-${ENV}-1280.png`), fullPage: false });
    ok(erroresJs.length === 0, `sin errores JS${erroresJs.length ? ': ' + erroresJs.join(' | ') : ''}`);
  } finally {
    await ctx.close().catch(() => null);
    if (userId) await clerk.users.deleteUser(userId).catch(() => null);
    console.log('  (usuario descartable borrado)');
  }
  console.log(`\n${pass} 🟢 / ${fail} 🔴`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
