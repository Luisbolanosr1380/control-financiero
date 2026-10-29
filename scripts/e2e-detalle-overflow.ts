/**
 * POR FACTURAR · DETALLE DE CLIENTE — E2E de layout en Chrome sobre un `next start`.
 * Verifica que la tabla de expedientes desplaza DENTRO de su tarjeta (no la página):
 * a 1280 px y a 390 px la página no se ensancha, el encabezado y los KPIs no se mueven
 * al desplazar la tabla, la última columna (Factura) queda alcanzable, y las columnas
 * fijas (selección + persona a la izquierda, factura a la derecha) siguen visibles.
 * Guarda capturas antes/después del scroll en --out. Usuario descartable de Clerk (contador).
 *
 * Uso: npx tsx scripts/e2e-detalle-overflow.ts --env hit --base http://localhost:3012 --grupo n-99990011K --out /ruta/capturas
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ENV = arg('--env', 'hit');
const BASE = arg('--base', 'http://localhost:3012').replace(/\/$/, '');
const GRUPO = arg('--grupo', 'n-99990011K');
const OUT = arg('--out', path.join(os.tmpdir(), 'e2e-detalle-overflow'));
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
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-overflow-'));
  const ctx = await chromium.launchPersistentContext(perfil, { executablePath: CHROME, headless: true, args: [`--user-agent=${UA}`], viewport: { width: 1280, height: 800 }, userAgent: UA, locale: 'es-GT' });
  console.log(`\nE2E detalle de cliente · overflow · ${ENV.toUpperCase()} · ${BASE}/por-facturar/${GRUPO}`);
  try {
    const u = await clerk.users.createUser({ emailAddress: [`e2e.overflow+${STAMP}@example.com`], password: `E2e-${STAMP}-${Math.random().toString(36).slice(2)}!Aa9`, firstName: 'E2E', lastName: 'Overflow', skipPasswordChecks: true, publicMetadata: { accesos: [{ empresa_slug: SLUG, rol: 'contador' }] } });
    userId = u.id;
    const ticket = (await clerk.signInTokens.createSignInToken({ userId: u.id, expiresInSeconds: 600 })).token;
    const page = ctx.pages()[0] ?? await ctx.newPage();
    page.setDefaultTimeout(30_000);
    const erroresJs: string[] = [];
    page.on('pageerror', e => erroresJs.push(e.message));
    // En teléfono el shell muestra el aviso "usá la versión de escritorio" salvo que se elija "ver igual": lo dejamos elegido.
    await ctx.addInitScript(() => { try { sessionStorage.setItem('ver-escritorio-en-telefono', '1'); } catch { /* sin storage */ } });
    await page.goto(`${BASE}/sign-in`);
    await page.waitForFunction(() => (window as unknown as { Clerk?: { loaded?: boolean } }).Clerk?.loaded === true, null, { timeout: 30_000 });
    await page.evaluate(async (t) => {
      const C = (window as unknown as { Clerk: { client: { signIn: { create: (a: unknown) => Promise<{ createdSessionId: string }> } }; setActive: (a: unknown) => Promise<void> } }).Clerk;
      const si = await C.client.signIn.create({ strategy: 'ticket', ticket: t });
      await C.setActive({ session: si.createdSessionId });
    }, ticket);
    await page.waitForURL(u2 => !u2.pathname.startsWith('/sign-in'), { timeout: 20_000 }).catch(() => null);
    ok(true, `sesión real de Clerk para usuario descartable rol contador en ${SLUG}`);

    for (const vp of [{ width: 1280, height: 800, nombre: '1280' }, { width: 390, height: 844, nombre: '390' }]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${BASE}/por-facturar/${GRUPO}`);
      await page.waitForSelector('[data-tabla-expedientes] table tbody tr');
      const m = await page.evaluate(() => {
        const wrap = document.querySelector('[data-tabla-expedientes]') as HTMLElement;
        const h1 = document.querySelector('h1.page-title') as HTMLElement;
        const kpi = document.querySelector('.kpi-grid') as HTMLElement | null;
        const thFact = [...document.querySelectorAll('[data-tabla-expedientes] thead th')].find(t => /Factura/.test(t.textContent ?? '')) as HTMLElement;
        const thPersona = document.querySelector('[data-tabla-expedientes] thead th.col-persona') as HTMLElement;
        // (sin helpers con nombre dentro del evaluate: tsx les agrega __name y el navegador no lo tiene)
        return {
          pageScrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
          wrapClient: wrap.clientWidth, wrapScroll: wrap.scrollWidth, wrapRect: wrap.getBoundingClientRect().toJSON(),
          h1Left: h1 ? h1.getBoundingClientRect().left : null, kpiLeft: kpi ? kpi.getBoundingClientRect().left : null, factRight: thFact ? thFact.getBoundingClientRect().right : null, personaLeft: thPersona ? thPersona.getBoundingClientRect().left : null,
          filas: document.querySelectorAll('[data-tabla-expedientes] tbody tr').length,
        };
      });
      await page.screenshot({ path: path.join(OUT, `detalle-${vp.nombre}-antes.png`), fullPage: true });
      // la captura "después" se toma con la tarjeta de la tabla a la vista (en teléfono queda debajo del menú apilado)
      await page.evaluate(() => (document.querySelector('[data-tabla-expedientes]') as HTMLElement).scrollIntoView({ block: 'center' }));
      ok(m.pageScrollW <= m.innerW + 1, `${vp.nombre} px: la página no se ensancha (scrollWidth ${m.pageScrollW} ≤ viewport ${m.innerW}); ${m.filas} filas`);
      const necesitaScroll = m.wrapScroll > m.wrapClient + 1;
      ok(vp.width === 390 ? necesitaScroll : true, `${vp.nombre} px: la tabla ${necesitaScroll ? `desplaza dentro de su tarjeta (${m.wrapScroll} px de contenido en ${m.wrapClient} px)` : 'cabe entera en la tarjeta'}`);
      ok(m.factRight === null || necesitaScroll || m.factRight <= m.innerW + 1, `${vp.nombre} px: sin scroll pendiente, la columna Factura está a la vista`);
      // Desplazar la tabla hasta el final: encabezado y KPIs no se mueven, Factura queda a la vista, persona sigue fija a la izquierda
      await page.evaluate(() => { const w = document.querySelector('[data-tabla-expedientes]') as HTMLElement; w.scrollLeft = w.scrollWidth; });
      await page.waitForTimeout(150);
      const d = await page.evaluate(() => {
        const wrap = document.querySelector('[data-tabla-expedientes]') as HTMLElement;
        const h1 = document.querySelector('h1.page-title') as HTMLElement;
        const kpi = document.querySelector('.kpi-grid') as HTMLElement | null;
        const thFact = [...document.querySelectorAll('[data-tabla-expedientes] thead th')].find(t => /Factura/.test(t.textContent ?? '')) as HTMLElement;
        const thPersona = document.querySelector('[data-tabla-expedientes] thead th.col-persona') as HTMLElement;
        const tdPersona = document.querySelector('[data-tabla-expedientes] tbody td.col-persona') as HTMLElement | null;
        return { scrollLeft: wrap.scrollLeft, wrapRect: wrap.getBoundingClientRect().toJSON() as DOMRect, h1Left: h1 ? h1.getBoundingClientRect().left : null, kpiLeft: kpi ? kpi.getBoundingClientRect().left : null, factRect: thFact ? thFact.getBoundingClientRect().toJSON() as DOMRect : null, personaRect: thPersona ? thPersona.getBoundingClientRect().toJSON() as DOMRect : null, tdPersonaRect: tdPersona ? tdPersona.getBoundingClientRect().toJSON() as DOMRect : null, pageScrollX: window.scrollX, pageScrollW: document.documentElement.scrollWidth };
      });
      await page.screenshot({ path: path.join(OUT, `detalle-${vp.nombre}-despues.png`), fullPage: false });
      if (necesitaScroll) {
        ok(d.scrollLeft > 0 && d.h1Left === m.h1Left && d.kpiLeft === m.kpiLeft && d.pageScrollX === 0 && d.pageScrollW <= m.innerW + 1, `${vp.nombre} px: tras desplazar la tabla (${Math.round(d.scrollLeft)} px) el encabezado y los KPIs no se movieron y la página sigue sin scroll horizontal`);
        ok(!!d.factRect && d.factRect.right <= (d.wrapRect?.right ?? 0) + 1 && d.factRect.left >= (d.wrapRect?.left ?? 0) - 1, `${vp.nombre} px: la columna Factura queda a la vista dentro de la tarjeta (factura ${Math.round(d.factRect?.left ?? -1)}–${Math.round(d.factRect?.right ?? -1)}, tarjeta ${Math.round(d.wrapRect.left)}–${Math.round(d.wrapRect.right)})`);
        ok(!!d.personaRect && Math.abs(d.personaRect.left - (m.personaLeft ?? -999)) < 1 && (!d.tdPersonaRect || d.tdPersonaRect.left >= (d.wrapRect?.left ?? 0) - 1), `${vp.nombre} px: la columna Persona sigue fija a la izquierda (sticky) con la tabla desplazada`);
      }
      const ell = await page.evaluate(() => [...document.querySelectorAll('[data-tabla-expedientes] td.col-persona .cell-ellipsis')].every(el => (el as HTMLElement).title.length > 0 && getComputedStyle(el).textOverflow === 'ellipsis'));
      const serv = await page.evaluate(() => [...document.querySelectorAll('[data-tabla-expedientes] td.col-servicio')].every(el => getComputedStyle(el).whiteSpace === 'normal'));
      ok(ell && serv, `${vp.nombre} px: persona/puesto con puntos suspensivos y title; servicio/proceso conservan las dos líneas`);
    }
    ok(erroresJs.length === 0, `sin errores JS${erroresJs.length ? ': ' + erroresJs.join(' | ') : ''}`);
    console.log(`  · capturas en ${OUT}`);
  } catch (e) {
    fail++; console.log(`  🔴 excepción: ${(e as Error).message}`);
    await ctx.pages()[0]?.screenshot({ path: path.join(OUT, 'detalle-error.png') }).catch(() => null);
  } finally {
    await ctx.close().catch(() => null);
    if (userId) await clerk.users.deleteUser(userId).catch((e: Error) => console.log(`     ✗ clerk: ${e.message}`));
    console.log(`\n== ${pass} 🟢 / ${fail} 🔴 ==\n`);
    process.exit(fail ? 1 : 0);
  }
})();
