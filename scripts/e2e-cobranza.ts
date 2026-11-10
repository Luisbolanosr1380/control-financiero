/**
 * CENTRO DE COBROS · PR 1 — E2E en Chrome sobre un `next start` (HIT) con el cliente que deja
 * `validate-cobranza.ts hit --conservar` (6 facturas, gestiones legacy migradas, promesa incumplida, «dice que ya pagó»).
 *  1. Usuario `cobranza` entra: / → /cobranza; el sidebar solo trae lo suyo; /conciliacion, /planillas, /gastos y
 *     /admin/precios lo devuelven a /cobranza (gate del layout).
 *  2. Bandeja «Hoy» a 390 px: KPIs, el cliente de prueba en «promesa incumplida» y «dice que ya pagó», contacto
 *     preferido con llamar / WhatsApp / correo; «Registrar gestión» → llamada con promesa para mañana y seguimiento.
 *  3. Ficha de cobranza (390 px): resumen en una línea, facturas con estado, historial con la gestión nueva y la
 *     promesa, filtro por tipo, contactos; historial PDF (imprimible) carga con sesión.
 *  4. «Al día siguiente»: una promesa cuya fecha ya pasó aparece como incumplida en la bandeja (la deja el validador).
 *  (Recordatorio propuesto, enviar y correo entrante del cliente son PR 2 y PR 3.)
 *
 * Uso: npx tsx scripts/e2e-cobranza.ts --env hit --base http://localhost:3012 --out /ruta/capturas
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ENV = arg('--env', 'hit');
const BASE = arg('--base', 'http://localhost:3012').replace(/\/$/, '');
const OUT = arg('--out', path.join(os.tmpdir(), 'e2e-cobranza'));
const CHROME = arg('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const APP = arg('--cliente', 'sbwCBE2E01');
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
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cb-')), { executablePath: CHROME, headless: true, args: [`--user-agent=${UA}`], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, userAgent: UA, locale: 'es-GT', isMobile: true, hasTouch: true });
  console.log(`\nE2E Centro de Cobros · ${ENV.toUpperCase()} · ${BASE} · 390 px`);
  try {
    const email = `e2e.cobranza+${STAMP}@example.com`;
    const u = await clerk.users.createUser({ emailAddress: [email], password: `E2e-${STAMP}-${Math.random().toString(36).slice(2)}!Aa9`, firstName: 'E2E', lastName: 'Cobranza', skipPasswordChecks: true, publicMetadata: { accesos: [{ empresa_slug: SLUG, rol: 'cobranza' }] } });
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
    ok(true, `sesión real de Clerk para usuario descartable rol cobranza en ${SLUG}`);

    // ── 1. rol cobranza: entra a su bandeja; no ve ni abre finanzas ──
    await page.goto(`${BASE}/`);
    await page.waitForURL(u2 => u2.pathname === '/cobranza', { timeout: 20_000 });
    await page.waitForSelector('[data-bandeja]');
    const nav = await page.evaluate(() => [...document.querySelectorAll('nav a, aside a, .sidebar a')].map(a => a.getAttribute('href') ?? '').filter(h => h.startsWith('/')));
    const prohibidos = nav.filter(h => /^\/(planillas|planilla|conciliacion|gastos|deudas|presupuesto|estados|admin|ai|analitica|dashboard|tesoreria|flujo|asientos|retenciones|reportes)/.test(h));
    ok(nav.includes('/cobranza') && nav.includes('/clientes') && nav.includes('/facturacion') && prohibidos.length === 0, `/ → /cobranza; el menú trae Centro de Cobros, Clientes y Facturación y nada de finanzas (${nav.length} enlaces${prohibidos.length ? ' · prohibidos: ' + prohibidos.join(', ') : ''})`);
    const destinos: string[] = [];
    for (const r of ['/conciliacion', '/planillas', '/gastos', '/admin/precios', '/facturacion/nueva']) { await page.goto(`${BASE}${r}`); await page.waitForURL(u2 => u2.pathname === '/cobranza' || u2.pathname === r, { timeout: 20_000 }).catch(() => null); destinos.push(new URL(page.url()).pathname); }
    ok(destinos.every(d => d === '/cobranza'), `por URL, bancos, planilla, gastos, mapa de precios y emitir factura lo devuelven a /cobranza (${destinos.join(', ')})`);

    // ── 2. bandeja a 390 px ──
    await page.goto(`${BASE}/cobranza`);
    await page.waitForSelector('[data-lista-bandeja]');
    const b1 = await page.evaluate((app) => ({
      ancho: document.documentElement.scrollWidth, vp: window.innerWidth, kpis: document.querySelectorAll('[data-kpis] [data-kpi]').length, n: Number(document.querySelector('[data-bandeja]')?.getAttribute('data-bandeja')),
      cats: [...document.querySelectorAll(`[data-item][data-cliente="${app}"]`)].map(e => e.getAttribute('data-item')), contacto: !!document.querySelector(`[data-item][data-cliente="${app}"] [data-contacto-preferido]`),
      acciones: ['llamar', 'whatsapp', 'correo'].map(a => !!document.querySelector(`[data-item][data-cliente="${app}"] [data-accion="${a}"]`)), orden: [...document.querySelectorAll('[data-item]')].map(e => e.getAttribute('data-item')),
    }), APP);
    const ordenIdx = (c: string) => ['seguimiento', 'promesa_incumplida', 'promesa_por_vencer', 'vencida_sin_gestion', 'por_vencer', 'dice_que_pago'].indexOf(c);
    ok(b1.ancho <= b1.vp + 1 && b1.kpis === 4 && b1.n > 0 && b1.cats.includes('seguimiento') && b1.cats.includes('promesa_incumplida') && b1.cats.includes('dice_que_pago') && b1.contacto && b1.acciones.some(Boolean) && b1.orden.every((c, i, arr) => i === 0 || ordenIdx(arr[i - 1]!) <= ordenIdx(c!)), `bandeja a 390 px sin desplazamiento horizontal (${b1.ancho} ≤ ${b1.vp}); 4 KPIs; ${b1.n} filas en orden de prioridad (${b1.orden.join(' > ')}); el cliente de prueba en ${b1.cats.join(' + ')} con contacto preferido (${b1.contacto}; llamar/WA/correo: ${b1.acciones.join('/')})`);
    await page.screenshot({ path: path.join(OUT, 'bandeja-390.png'), fullPage: true });
    // registrar gestión desde la bandeja: llamada con promesa para mañana
    await page.click(`[data-item="dice_que_pago"][data-cliente="${APP}"] [data-accion="registrar-gestion"]`);
    await page.waitForSelector('[data-gestion-form]');
    await page.click('[data-canal="llamada"]');
    await page.selectOption('[data-campo="resultado"]', 'promesa');
    await page.waitForSelector('[data-promesa]');
    const manana = new Date(Date.now() - 6 * 3600_000 + 86_400_000).toISOString().slice(0, 10);
    await page.fill('[data-campo="promesa-monto"]', '1000');
    await page.fill('[data-campo="promesa-fecha"]', manana);
    await page.fill('[data-campo="comentario"]', 'Andrea confirma transferencia mañana');
    const seg = await page.inputValue('[data-campo="seguimiento"]');
    const facturaChk = await page.evaluate(() => (document.querySelector('[data-facturas-gestion] input[type="checkbox"]') as HTMLInputElement | null)?.getAttribute('data-factura'));
    if (facturaChk) await page.check(`[data-facturas-gestion] input[data-factura="${facturaChk}"]`);
    await page.screenshot({ path: path.join(OUT, 'gestion-form-390.png'), fullPage: true });
    await page.click('[data-accion="guardar-gestion"]');
    await page.waitForSelector('[data-gestion-form]', { state: 'detached', timeout: 30_000 });
    await page.waitForTimeout(1500);
    const b2 = await page.evaluate((app) => ({ cats: [...document.querySelectorAll(`[data-item][data-cliente="${app}"]`)].map(e => e.getAttribute('data-item')), ultimo: document.querySelector(`[data-item][data-cliente="${app}"] [data-ultimo-contacto]`)?.textContent ?? '' }), APP);
    ok(seg > manana && b2.cats.includes('promesa_por_vencer') && !b2.cats.includes('dice_que_pago') && !b2.cats.includes('seguimiento') && /hoy, llamada a .*promesa de pago/.test(b2.ultimo), `gestión registrada desde la bandeja: promesa para mañana (seguimiento propuesto al día siguiente: ${seg}); el cliente pasa a «promesa que vence mañana», sale de «dice que ya pagó» y el seguimiento de hoy queda hecho; último contacto "${b2.ultimo.slice(0, 70)}"`);

    // ── 3. ficha de cobranza ──
    await page.click(`[data-item][data-cliente="${APP}"] [data-accion="abrir-ficha"]`);
    await page.waitForSelector('[data-ficha-cobranza]');
    const f1 = await page.evaluate(() => ({
      ancho: document.documentElement.scrollWidth, vp: window.innerWidth, resumen: document.querySelector('[data-resumen]')?.textContent ?? '', facturas: [...document.querySelectorAll('[data-lista="facturas-cobranza"] tr[data-factura]')].map(t => `${t.getAttribute('data-factura')!.slice(-3)}:${t.getAttribute('data-estado-cobro')}${t.getAttribute('data-modificadores') ? '+' + t.getAttribute('data-modificadores') : ''}`),
      contactos: Number(document.querySelector('[data-contactos]')?.getAttribute('data-contactos')), historial: Number(document.querySelector('[data-historial]')?.getAttribute('data-historial')), tipos: [...document.querySelectorAll('[data-lista-historial] [data-evento]')].slice(0, 3).map(e => e.getAttribute('data-evento')), requisitos: document.querySelector('[data-requisitos]')?.textContent ?? '',
    }));
    ok(f1.ancho <= f1.vp + 1 && /Último contacto: .*llamada a /.test(f1.resumen) && /Prometió pagar/.test(f1.resumen) && /Próximo seguimiento:/.test(f1.resumen) && f1.facturas.some(x => /001:vencida\+.*con_promesa|001:vencida\+.*promesa_incumplida/.test(x)) && f1.contactos >= 1 && f1.historial >= 8 && f1.tipos.includes('gestion') && f1.tipos.includes('promesa') && /contraseña/.test(f1.requisitos), `ficha a 390 px (${f1.ancho} ≤ ${f1.vp}): resumen "${f1.resumen.slice(0, 90)}…"; ${f1.facturas.length} facturas con estado (${f1.facturas.join(' ')}); ${f1.contactos} contacto(s), ${f1.historial} eventos (arriba: ${f1.tipos.join(', ')}); requisitos: "${f1.requisitos.slice(0, 60)}"`);
    await page.screenshot({ path: path.join(OUT, 'ficha-390.png'), fullPage: true });
    await page.selectOption('[data-filtro="tipo"]', 'promesa');
    const f2 = await page.evaluate(() => [...document.querySelectorAll('[data-lista-historial] [data-evento]')].map(e => e.getAttribute('data-evento')));
    ok(f2.length > 0 && f2.every(t => t === 'promesa'), `filtro del historial por tipo: solo promesas (${f2.length})`);
    const pdf = await page.request.get(`${BASE}/imprimir/cobranza/${encodeURIComponent(APP)}`);
    const html = await pdf.text();
    ok(pdf.status() === 200 && /data-historial-imprimible/.test(html) && /Historial de cobranza/.test(html) && /Facturas abiertas/.test(html), 'historial PDF (imprimible) carga con la sesión del rol cobranza');
    ok(errores.length === 0, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
  } finally {
    await ctx.close().catch(() => null);
    if (userId) await clerk.users.deleteUser(userId).catch(() => null);
    console.log('  (usuario descartable borrado)');
  }
  console.log(`\n${pass} 🟢 / ${fail} 🔴`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
