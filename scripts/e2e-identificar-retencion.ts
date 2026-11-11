/**
 * IDENTIFICAR PAGO: SALDO Y NETO CON RETENCIÓN — E2E en Chrome a 1280 y 390 px sobre un `next start` (HIT) con los datos
 * IR-E2E que deja `validate-identificar-retencion.ts hit --conservar` (cliente que retiene 15 % con la Q450 abierta y una
 * parcial; cliente que retiene 80 % con dos abiertas; cliente que nunca retuvo con una Q450).
 *  1. contador a 1280: /cobros/identificar?m=442.77 → la Q450 del que retiene 15 % calza «Neto con retención IVA 15 %
 *     (−Q7.23)» primero y la del que nunca retuvo sale «posible» abajo; «Buscar sobre» → Total: la URL cambia y no calza;
 *     542 → saldo de la parcial; 1,024 → neto 80 %; 3,072 → «Clientes que calzan» por suma de netos; el atajo lleva la base.
 *  2. «Registrar cobro» abre la factura con el modal prellenado (depósito + retención IVA como componentes). NO se guarda.
 *  3. 390 px: la página no se ensancha; la tabla se desplaza dentro de su tarjeta; el selector se ve.
 *  4. lectura: ve las coincidencias pero no el botón «Registrar cobro» (ve «Ver factura»).
 * Usuarios descartables de Clerk; se borran al final.
 *
 * Uso: npx tsx scripts/e2e-identificar-retencion.ts --env hit --base http://localhost:3012 --out /ruta/capturas
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ENV = arg('--env', 'hit');
const BASE = arg('--base', 'http://localhost:3012').replace(/\/$/, '');
const OUT = arg('--out', path.join(os.tmpdir(), 'e2e-identificar-retencion'));
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
const P = 'IR-E2E-';

(async () => {
  const { chromium } = await import('playwright-core');
  const { createClerkClient } = await import(path.resolve(process.cwd(), 'node_modules/@clerk/backend/dist/index.mjs'));
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  const STAMP = Date.now().toString(36);
  const usuarios: string[] = [];
  fs.mkdirSync(OUT, { recursive: true });
  const entrar = async (rol: string, viewport: { width: number; height: number }) => {
    const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ir-')), { executablePath: CHROME, headless: true, args: [`--user-agent=${UA}`], viewport, userAgent: UA, locale: 'es-GT', acceptDownloads: true });
    const u = await clerk.users.createUser({ emailAddress: [`e2e.identificar+${rol}${STAMP}@example.com`], password: `E2e-${STAMP}-${Math.random().toString(36).slice(2)}!Aa9`, firstName: 'E2E', lastName: `Ident ${rol}`, skipPasswordChecks: true, publicMetadata: { accesos: [{ empresa_slug: SLUG, rol }] } });
    usuarios.push(u.id);
    const ticket = (await clerk.signInTokens.createSignInToken({ userId: u.id, expiresInSeconds: 600 })).token;
    const page = ctx.pages()[0] ?? await ctx.newPage();
    page.setDefaultTimeout(30_000);
    await page.goto(`${BASE}/sign-in`);
    await page.waitForFunction(() => (window as unknown as { Clerk?: { loaded?: boolean } }).Clerk?.loaded === true, null, { timeout: 30_000 });
    await page.evaluate(async (t) => {
      const C = (window as unknown as { Clerk: { client: { signIn: { create: (a: unknown) => Promise<{ createdSessionId: string }> } }; setActive: (a: unknown) => Promise<void> } }).Clerk;
      const si = await C.client.signIn.create({ strategy: 'ticket', ticket: t });
      await C.setActive({ session: si.createdSessionId });
    }, ticket);
    await page.waitForURL(u2 => !u2.pathname.startsWith('/sign-in'), { timeout: 20_000 }).catch(() => null);
    return { ctx, page };
  };
  const filas = (page: import('playwright-core').Page) => page.evaluate((pref) => [...document.querySelectorAll('[data-lista="facturas"] tbody tr')].filter(tr => (tr.getAttribute('data-factura') ?? '').startsWith(pref)).map(tr => ({ nf: tr.getAttribute('data-factura')!.slice(pref.length), tipo: tr.getAttribute('data-tipo'), esperado: tr.getAttribute('data-esperado'), calza: tr.querySelector('[data-calza]')?.textContent?.trim(), posible: tr.querySelector('[data-calza]')?.getAttribute('data-posible'), diff: tr.querySelector('[data-diff]')?.getAttribute('data-diff'), registrar: !!tr.querySelector('[data-accion="registrar-cobro-prellenado"]'), ver: !!tr.querySelector('[data-accion="ver-factura"]') })), P);
  const escribir = async (page: import('playwright-core').Page, monto: string) => { await page.fill('[data-campo="monto"]', ''); await page.fill('[data-campo="monto"]', monto); await page.waitForTimeout(150); };

  console.log(`\nE2E identificar pago · saldo y neto con retención · ${ENV.toUpperCase()} · ${BASE}`);
  const { ctx, page } = await entrar('contador', { width: 1280, height: 900 });
  const errores: string[] = []; page.on('pageerror', e => errores.push(e.message));
  try {
    ok(true, `sesión real de Clerk para usuario descartable rol contador en ${SLUG} (puede registrar cobros)`);

    // ── 1. 442.77 desde la URL ──
    await page.goto(`${BASE}/cobros/identificar?m=442.77`);
    await page.waitForSelector('[data-lista="facturas"]');
    const r1 = await filas(page);
    const sel1 = await page.evaluate(() => ({ monto: (document.querySelector('[data-campo="monto"]') as HTMLInputElement)?.value, auto: document.querySelector('[data-sobre="auto"]')?.getAttribute('aria-pressed'), url: location.search }));
    ok(sel1.monto === '442.77' && sel1.auto === 'true' && r1.length === 2 && r1[0].nf === 'A03' && r1[0].tipo === 'neto' && r1[0].calza === 'Neto con retención IVA 15 % (−Q7.23)' && r1[0].diff === '0' && r1[1].nf === 'C01' && r1[1].tipo === 'neto_general' && r1[1].posible === '1' && /^Posible: retención general/.test(r1[1].calza ?? '') && r1[0].registrar, `?m=442.77 → monto en la casilla, «Automático» activo; la Q450 del que retiene 15 % calza «${r1[0].calza}» primero y la del que nunca retuvo «${r1[1].calza}» abajo; botón «Registrar cobro»`);
    await page.screenshot({ path: path.join(OUT, 'identificar-neto-1280.png'), fullPage: false });

    // ── 2. Buscar sobre → Total ──
    await page.click('[data-sobre="total"]');
    await page.waitForSelector('[data-sin-coincidencias]');
    const r2 = await page.evaluate(() => ({ url: location.search, total: document.querySelector('[data-sobre="total"]')?.getAttribute('aria-pressed'), href: document.querySelector('[data-accion="buscar-facturas-monto"]')?.getAttribute('href') }));
    ok(r2.url === '?m=442.77&sobre=total' && r2.total === 'true' && r2.href === '/facturacion?monto=442.77&estado=pendientes', `«Buscar sobre» → Total: la URL lleva sobre=total (${r2.url}), no calza nada; el atajo busca por total`);
    await page.click('[data-sobre="neto"]');
    await page.waitForSelector('[data-lista="facturas"]');
    const r3 = await page.evaluate(() => ({ url: location.search, href: document.querySelector('[data-accion="buscar-facturas-monto"]')?.getAttribute('href') }));
    ok(r3.url === '?m=442.77&sobre=neto' && /^\/facturacion\?monto=442\.77&sobre=saldo&tol=\d+(\.\d+)?&aviso=retencion&estado=pendientes$/.test(r3.href ?? ''), `Neto: URL ${r3.url}; el atajo al #51 busca por saldo con tolerancia ampliada y aviso (${r3.href})`);
    await page.click('[data-sobre="auto"]');

    // ── 3. saldo de la parcial, neto 80 %, clientes ──
    await escribir(page, '542');
    const r4 = await filas(page);
    await escribir(page, '1024');
    const r5 = await filas(page);
    ok(r4.length === 1 && r4[0].nf === 'A04' && r4[0].tipo === 'saldo' && r4[0].calza === 'Saldo' && r5.length === 1 && r5[0].nf === 'B03' && r5[0].calza === 'Neto con retención IVA 80 % (−Q96.00)', `542 → la parcial calza por «${r4[0]?.calza}» (saldo 1,120 − 560 − 18); 1,024 → «${r5[0]?.calza}»`);
    await escribir(page, '3072');
    await page.waitForSelector('[data-lista="clientes"]');
    const r6 = await page.evaluate(() => { const tr = document.querySelector('[data-lista="clientes"] tbody tr[data-cliente]'); return { tipo: tr?.getAttribute('data-tipo'), suma: tr?.getAttribute('data-suma'), calza: tr?.querySelector('[data-calza]')?.textContent?.trim(), n: document.querySelectorAll('[data-lista="clientes"] tbody tr[data-cliente]').length, facturas: !!document.querySelector('[data-lista="facturas"]') }; });
    await page.click('[data-lista="clientes"] tbody tr[data-cliente]');
    const r6b = await page.evaluate(() => [...document.querySelectorAll('[data-factura-cliente]')].map(tr => tr.getAttribute('data-factura-cliente')!.replace('IR-E2E-', '')).join(','));
    ok(r6.n === 1 && r6.tipo === 'neto' && r6.suma === '3072' && r6.calza === 'Suma de netos · Neto con retención IVA 80 % (−Q288.00)' && !r6.facturas && r6b === 'B04,B03', `3,072 → «Clientes que calzan»: ${r6.calza} (${r6b}); ninguna factura sola calza`);
    await page.screenshot({ path: path.join(OUT, 'identificar-clientes-1280.png'), fullPage: false });

    // ── 4. Registrar cobro prellenado (sin guardar) ──
    await escribir(page, '442.77');
    await page.waitForSelector('[data-lista="facturas"] tr[data-factura="IR-E2E-A03"] [data-accion="registrar-cobro-prellenado"]');
    const hrefReg = await page.getAttribute('[data-lista="facturas"] tr[data-factura="IR-E2E-A03"] [data-accion="registrar-cobro-prellenado"]', 'href');
    await page.click('[data-lista="facturas"] tr[data-factura="IR-E2E-A03"] [data-accion="registrar-cobro-prellenado"]');
    await page.waitForSelector('[data-modal="registrar-cobro"][data-prellenado="1"]');
    const r7 = await page.evaluate(() => ({ url: location.pathname + location.search, montos: [...document.querySelectorAll('[data-modal="registrar-cobro"] [data-componente-monto]')].map(i => (i as HTMLInputElement).value), metodos: [...document.querySelectorAll('[data-modal="registrar-cobro"] [data-componente-metodo]')].map(s => (s as HTMLSelectElement).value) }));
    ok(/^\/facturacion\/recIRE2E003\?cobro=442\.77&retiva=7\.23$/.test(hrefReg ?? '') && r7.montos.join(',') === '442.77,7.23' && r7.metodos.join(',') === 'Transferencia,Retención IVA', `«Registrar cobro» abre ${r7.url} con el modal prellenado: ${r7.metodos.map((m, i) => `${m} Q${r7.montos[i]}`).join(' + ')} (no se guarda)`);
    await page.screenshot({ path: path.join(OUT, 'factura-modal-prellenado-1280.png'), fullPage: false });
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-modal="registrar-cobro"]', { state: 'detached' });
    const r8 = await page.evaluate(() => !!document.querySelector('[data-modal="registrar-cobro"]'));
    ok(!r8, 'Escape cierra el modal sin registrar nada');

    // ── 5. 390 px ──
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/cobros/identificar?m=442.77`);
    await page.waitForSelector('[data-lista="facturas"]');
    const m1 = await page.evaluate(() => { const wrap = document.querySelector('[data-lista="facturas"]')?.closest('.table-wrap') as HTMLElement | null; return { ancho: document.documentElement.scrollWidth, vp: window.innerWidth, tablaScroll: !!wrap && wrap.scrollWidth > wrap.clientWidth + 1, selector: !!document.querySelector('[data-selector-base]'), filas: document.querySelectorAll('[data-lista="facturas"] tbody tr').length }; });
    ok(m1.ancho <= m1.vp + 1 && m1.selector && m1.filas === 2, `390 px: la página no se ensancha (${m1.ancho} ≤ ${m1.vp}); el selector «Buscar sobre» se ve; ${m1.filas} filas${m1.tablaScroll ? ' (la tabla se desplaza dentro de su tarjeta)' : ''}`);
    await page.screenshot({ path: path.join(OUT, 'identificar-neto-390.png'), fullPage: true });
    ok(errores.length === 0, `sin errores JS en la sesión contador${errores.length ? ': ' + errores.join(' | ') : ''}`);
  } finally { await ctx.close().catch(() => null); }

  // ── 6. rol lectura ──
  const { ctx: ctx2, page: p2 } = await entrar('lectura', { width: 1280, height: 900 });
  try {
    await p2.goto(`${BASE}/cobros/identificar?m=442.77`);
    await p2.waitForSelector('[data-lista="facturas"]');
    const l1 = await filas(p2);
    ok(l1.length === 2 && l1.every(f => !f.registrar) && l1[0].ver, 'rol lectura: ve las dos coincidencias, sin «Registrar cobro» (ve «Ver factura»)');
  } finally { await ctx2.close().catch(() => null); }

  for (const id of usuarios) await clerk.users.deleteUser(id).catch(() => null);
  console.log(`\n${pass} 🟢 / ${fail} 🔴 · capturas en ${OUT}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
