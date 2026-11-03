/**
 * MAPA DE PRECIOS (027) — E2E en Chrome sobre un `next start` con los datos de `validate-mapa-precios.ts hit --conservar`.
 *  · admin: /admin/precios rinde (KPIs, dispersión, tarjetas de cuadrante, brecha, referencias con interruptor IVA, franjas,
 *    servicios, tabla de clientes con buscador / filtro / orden, CSV habilitado, nota metodológica); cambiar umbrales por
 *    los controles navega con search params y recalcula; el ítem "Mapa de precios" está en el menú; sin errores JS.
 *    Capturas a 1280, 1440 y 390 px.
 *  · no-admin (contador): /admin/precios por URL directa → /no-acceso; el ítem NO está en el menú.
 * Usuarios descartables de Clerk (uno admin, uno contador en la empresa del deploy).
 *
 * Uso: npx tsx scripts/e2e-mapa-precios.ts --env hit --base http://localhost:3012 --out /ruta/capturas [--rol-no-admin contador]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ENV = arg('--env', 'hit');
const BASE = arg('--base', 'http://localhost:3012').replace(/\/$/, '');
const OUT = arg('--out', path.join(os.tmpdir(), 'e2e-mapa-precios'));
const CHROME = arg('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const ROL_NO_ADMIN = arg('--rol-no-admin', 'contador');
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
  const usuarios: string[] = [];
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`\nE2E mapa de precios · ${ENV.toUpperCase()} · ${BASE}`);
  const entrar = async (rol: string, ancho: number) => {
    const u = await clerk.users.createUser({ emailAddress: [`e2e.precios.${rol}+${STAMP}@example.com`], password: `E2e-${STAMP}-${Math.random().toString(36).slice(2)}!Aa9`, firstName: 'E2E', lastName: `Precios ${rol}`, skipPasswordChecks: true, publicMetadata: { accesos: [{ empresa_slug: SLUG, rol }] } });
    usuarios.push(u.id);
    const ticket = (await clerk.signInTokens.createSignInToken({ userId: u.id, expiresInSeconds: 600 })).token;
    const perfil = fs.mkdtempSync(path.join(os.tmpdir(), `e2e-precios-${rol}-`));
    const ctx = await chromium.launchPersistentContext(perfil, { executablePath: CHROME, headless: true, args: [`--user-agent=${UA}`], viewport: { width: ancho, height: 900 }, userAgent: UA, locale: 'es-GT' });
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
    ok(true, `sesión real de Clerk para usuario descartable rol ${rol} en ${SLUG}`);
    return { ctx, page, erroresJs };
  };

  try {
    // ── admin ──
    const A = await entrar('admin', 1280);
    await A.page.goto(`${BASE}/admin/precios?desde=2026-01-01&hasta=2026-12-31&vol=60&idx=1`);
    await A.page.waitForSelector('[data-pagina="mapa-precios"] [data-tabla="clientes"] tbody tr[data-nit]');
    const r = await A.page.evaluate(() => ({
      url: location.pathname + location.search,
      kpis: [...document.querySelectorAll('.kpi[data-kpi]')].map(k => `${k.getAttribute('data-kpi')}=${(k.querySelector('.kpi-value')?.textContent ?? '').trim()}`),
      falta: !!document.querySelector('[data-falta-027]'),
      puntos: document.querySelectorAll('[data-seccion="cuadrantes"] .recharts-scatter-symbol').length,
      tarjetas: [...document.querySelectorAll('[data-tarjeta-cuadrante]')].map(t => `${t.getAttribute('data-tarjeta-cuadrante')}: ${(t.querySelector('.kpi-value')?.textContent ?? '').trim()}`),
      barrasBrecha: document.querySelectorAll('[data-seccion="brecha"] .recharts-bar-rectangle').length,
      refs: document.querySelectorAll('[data-tabla="referencias"] tbody tr[data-linea]').length,
      franjas: document.querySelectorAll('[data-tabla="franjas"] tbody tr[data-franja]').length,
      servicios: document.querySelectorAll('[data-tabla="servicios"] tbody tr[data-servicio]').length,
      filas: [...document.querySelectorAll('[data-tabla="clientes"] tbody tr[data-nit]')].map(tr => `${tr.getAttribute('data-nit')}:${tr.getAttribute('data-cuadrante-fila')}`),
      linkTarifario: (document.querySelector('[data-tabla="clientes"] tbody tr[data-nit] a') as HTMLAnchorElement | null)?.getAttribute('href') ?? '',
      csv: !!document.querySelector('[data-accion="exportar-csv"]:not([disabled])'),
      metodologia: (document.querySelector('[data-seccion="metodologia"]')?.textContent ?? '').includes('Las pruebas sin tarifa no entran; ver Por facturar'),
      menu: [...document.querySelectorAll('a[href="/admin/precios"]')].length,
    }));
    ok(!r.falta && r.kpis.length === 6 && r.kpis.some(k => k.startsWith('produccion=Q')) && r.kpis.some(k => k.startsWith('brecha=Q')) && r.kpis.some(k => k.startsWith('mayor-brecha=')), `admin: KPIs ${r.kpis.join(' · ')}`);
    ok(r.puntos >= 5 && r.tarjetas.length === 4, `dispersión con ${r.puntos} clientes y 4 tarjetas de cuadrante: ${r.tarjetas.join(' · ')}`);
    ok(r.barrasBrecha >= 3 && r.refs >= 2 && r.franjas === 6 && r.servicios >= 3, `brecha (${r.barrasBrecha} barras), referencias (${r.refs} líneas), franjas (${r.franjas} celdas), servicios (${r.servicios})`);
    ok(r.filas.length >= 5 && r.filas.some(f => f.endsWith(':Estrellas')) && r.filas.some(f => f.endsWith(':Volumen con descuento')) && /^\/tarifario\/\d/.test(r.linkTarifario) && r.csv && r.metodologia, `tabla de clientes (${r.filas.length}) con cuadrante, link al tarifario (${r.linkTarifario}), CSV habilitado, nota metodológica`);
    ok(r.menu >= 1, 'el ítem "Mapa de precios" aparece en el menú del admin');
    await A.page.screenshot({ path: path.join(OUT, 'mapa-precios-1280.png'), fullPage: true });
    // interruptor IVA
    const antesIva = await A.page.evaluate(() => document.querySelector('[data-tabla="referencias"] tbody tr[data-linea] td:nth-child(5)')?.textContent ?? '');
    await A.page.click('[data-accion="con-iva"]');
    const conIva = await A.page.evaluate(() => ({ iva: document.querySelector('[data-tabla="referencias"]')?.getAttribute('data-iva'), v: document.querySelector('[data-tabla="referencias"] tbody tr[data-linea] td:nth-child(5)')?.textContent ?? '' }));
    const num = (s: string) => Number(s.replace(/[^\d.]/g, ''));
    ok(conIva.iva === 'con' && Math.abs(num(conIva.v) - num(antesIva) * 1.12) < 0.02, `interruptor IVA: mediana ${antesIva} → ${conIva.v} (× 1.12)`);
    // buscador + filtro por cuadrante
    await A.page.fill('[data-filtro="buscar"]', 'alfa');
    const busq = await A.page.evaluate(() => [...document.querySelectorAll('[data-tabla="clientes"] tbody tr[data-nit]')].map(tr => tr.textContent ?? ''));
    ok(busq.length === 1 && /ALFA/.test(busq[0]), `buscador: "alfa" deja 1 fila (${busq.length})`);
    await A.page.fill('[data-filtro="buscar"]', '');
    await A.page.selectOption('[data-filtro="cuadrante"]', 'Por revisar');
    const filtradas = await A.page.evaluate(() => [...document.querySelectorAll('[data-tabla="clientes"] tbody tr[data-nit]')].map(tr => tr.getAttribute('data-cuadrante-fila')));
    ok(filtradas.length >= 1 && filtradas.every(c => c === 'Por revisar'), `filtro por cuadrante: ${filtradas.length} filas, todas "Por revisar"`);
    await A.page.selectOption('[data-filtro="cuadrante"]', '');
    // orden por columna
    await A.page.click('[data-tabla="clientes"] thead th[data-col="brecha"]');
    const ordenBrecha = await A.page.evaluate(() => [...document.querySelectorAll('[data-tabla="clientes"] tbody tr[data-nit] td:nth-child(9)')].map(td => Number((td.textContent ?? '').replace(/[^\d.]/g, '') || 0)));
    ok(ordenBrecha.length >= 2 && ordenBrecha.every((v, i, a) => i === 0 || a[i - 1] >= v), `orden por brecha desc: ${ordenBrecha.slice(0, 4).join(' ≥ ')}`);
    // umbrales por controles → search params y recalcula
    await A.page.fill('[data-campo="vol"]', '25');
    await A.page.fill('[data-campo="idx"]', '0.8');
    await A.page.click('[data-accion="aplicar"]');
    await A.page.waitForURL(u => u.searchParams.get('vol') === '25' && u.searchParams.get('idx') === '0.8');
    await A.page.waitForSelector('[data-tabla="clientes"] tbody tr[data-nit]');
    const r2 = await A.page.evaluate(() => ({
      url: location.search,
      gama: document.querySelector('[data-tabla="clientes"] tbody tr[data-nit="99990023K"]')?.getAttribute('data-cuadrante-fila'),
      alfa: document.querySelector('[data-tabla="clientes"] tbody tr[data-nit="99990021K"]')?.getAttribute('data-cuadrante-fila'),
      estrellas: (document.querySelector('[data-tarjeta-cuadrante="Estrellas"] .kpi-value')?.textContent ?? '').trim(),
    }));
    ok(/vol=25/.test(r2.url) && /idx=0\.8/.test(r2.url) && r2.gama === 'Estrellas' && r2.alfa === 'Estrellas' && /^3 clientes/.test(r2.estrellas), `umbrales 25 / 0.80 por los controles → ${r2.url}; GAMA y ALFA pasan a Estrellas (${r2.estrellas})`);
    await A.page.screenshot({ path: path.join(OUT, 'mapa-precios-umbrales-25-1280.png'), fullPage: true });
    // rango inválido en la URL cae al defecto, no rompe
    await A.page.goto(`${BASE}/admin/precios?desde=2026-13-99&vol=abc&idx=0`);
    await A.page.waitForSelector('[data-pagina="mapa-precios"]');
    const r3 = await A.page.evaluate(() => ({ desde: (document.querySelector('[data-campo="desde"]') as HTMLInputElement)?.value, vol: (document.querySelector('[data-campo="vol"]') as HTMLInputElement)?.value, idx: (document.querySelector('[data-campo="idx"]') as HTMLInputElement)?.value }));
    ok(r3.desde === '2026-01-01' && r3.vol === '60' && r3.idx === '1', `parámetros inválidos caen al defecto (${r3.desde}, ${r3.vol}, ${r3.idx})`);
    // 1440 y 390
    await A.page.setViewportSize({ width: 1440, height: 900 });
    await A.page.goto(`${BASE}/admin/precios`);
    await A.page.waitForSelector('[data-tabla="clientes"] tbody tr[data-nit]');
    await A.page.screenshot({ path: path.join(OUT, 'mapa-precios-1440.png'), fullPage: true });
    await A.page.setViewportSize({ width: 390, height: 844 });
    await A.page.goto(`${BASE}/admin/precios`);
    await A.page.waitForSelector('[data-tabla="clientes"] tbody tr[data-nit]');
    const movil = await A.page.evaluate(() => ({ scrollX: document.documentElement.scrollWidth, ancho: window.innerWidth, tablaScroll: [...document.querySelectorAll('.table-scroll')].some(e => e.scrollWidth > e.clientWidth) }));
    ok(movil.scrollX <= movil.ancho + 1 && movil.tablaScroll, `390 px: sin desplazamiento horizontal de la página (${movil.scrollX} ≤ ${movil.ancho}); las tablas desplazan dentro de su tarjeta`);
    await A.page.screenshot({ path: path.join(OUT, 'mapa-precios-390.png'), fullPage: true });
    ok(A.erroresJs.length === 0, `admin sin errores JS${A.erroresJs.length ? ': ' + A.erroresJs.join(' | ') : ''}`);
    await A.ctx.close();

    // ── no admin ──
    const B = await entrar(ROL_NO_ADMIN, 1280);
    await B.page.goto(`${BASE}/admin/precios`);
    await B.page.waitForURL(u => u.pathname === '/no-acceso' || u.pathname === '/admin/precios', { timeout: 20_000 }).catch(() => null);
    await B.page.waitForTimeout(500);
    const nb = await B.page.evaluate(() => ({ path: location.pathname, tieneMapa: !!document.querySelector('[data-pagina="mapa-precios"]') }));
    ok(nb.path === '/no-acceso' && !nb.tieneMapa, `${ROL_NO_ADMIN} por URL directa a /admin/precios → ${nb.path} (sin la página)`);
    await B.page.screenshot({ path: path.join(OUT, `mapa-precios-${ROL_NO_ADMIN}-no-acceso-1280.png`), fullPage: true });
    await B.page.goto(`${BASE}/dashboard`);
    await B.page.waitForSelector('nav, aside, [class*="sidebar"]', { timeout: 20_000 }).catch(() => null);
    const menu = await B.page.evaluate(() => ({ precios: document.querySelectorAll('a[href="/admin/precios"]').length, roadmap: document.querySelectorAll('a[href="/admin/roadmap"]').length, algo: document.querySelectorAll('a[href="/dashboard"]').length }));
    ok(menu.precios === 0 && menu.roadmap === 0 && menu.algo >= 1, `${ROL_NO_ADMIN}: el menú no tiene "Mapa de precios" (ni Roadmap) y sí el resto`);
    await B.ctx.close();
  } finally {
    for (const id of usuarios) await clerk.users.deleteUser(id).catch(() => null);
    console.log(`  (usuarios descartables borrados: ${usuarios.length})`);
  }
  console.log(`\n${pass} 🟢 / ${fail} 🔴`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
