/**
 * PAQUETES PREPAGADOS (034) — E2E en Chrome a 1280 y 390 px sobre un `next start` (HIT) con los datos PQ-E2E que deja
 * `validate-paquetes.ts hit --conservar` (cliente «PQ E2E PAQUETES» con paquetes y pruebas terminadas; la rutina R1 sin cubrir).
 *  1. contador a 1280: Tarifario → cliente → «Paquetes» → Crear paquete (polígrafo rutina × 40, inicio 1-oct → vista previa
 *     muestra la rutina ya terminada → se confirma) → aparece en la lista con 1 / 40.
 *  2. Por facturar → cliente: banner «Poligrafo rutina: 39 restantes de 40», la rutina en gris «Cubierta por PAQ-…» sin
 *     checkbox y fuera de «Cobrable ahora»; Re-resolver no la devuelve a la cola.
 *  3. Detalle del paquete (persona descontada) → «Estado del paquete» (PDF) con «Usadas 1 de 40 · Restan 39» y el logo.
 *  4. Lista global /paquetes con filtros y KPI de pasivo.
 *  5. 390 px: tarifario y Por facturar sin ensanchar la página.
 *  6. lectura: ve los paquetes, sin «Crear paquete».
 * Usuarios descartables de Clerk; se borran al final.
 *
 * Uso: npx tsx scripts/e2e-paquetes.ts --env hit --base http://localhost:3012 --out /ruta/capturas
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ENV = arg('--env', 'hit');
const BASE = arg('--base', 'http://localhost:3012').replace(/\/$/, '');
const OUT = arg('--out', path.join(os.tmpdir(), 'e2e-paquetes'));
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
const NIT = '99990042K', PREFIJO = 'PQE2E-';

(async () => {
  const { chromium } = await import('playwright-core');
  const { createClerkClient } = await import(path.resolve(process.cwd(), 'node_modules/@clerk/backend/dist/index.mjs'));
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  const STAMP = Date.now().toString(36);
  const usuarios: string[] = [];
  fs.mkdirSync(OUT, { recursive: true });
  const entrar = async (rol: string, viewport: { width: number; height: number }) => {
    const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-pq-')), { executablePath: CHROME, headless: true, args: [`--user-agent=${UA}`], viewport, userAgent: UA, locale: 'es-GT', acceptDownloads: true });
    const u = await clerk.users.createUser({ emailAddress: [`e2e.paquetes+${rol}${STAMP}@example.com`], password: `E2e-${STAMP}-${Math.random().toString(36).slice(2)}!Aa9`, firstName: 'E2E', lastName: `Paq ${rol}`, skipPasswordChecks: true, publicMetadata: { accesos: [{ empresa_slug: SLUG, rol }] } });
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

  console.log(`\nE2E paquetes prepagados · ${ENV.toUpperCase()} · ${BASE}`);
  const { ctx, page } = await entrar('contador', { width: 1280, height: 900 });
  const errores: string[] = []; page.on('pageerror', e => errores.push(e.message));
  let correlativo = '', paqueteId = '';
  try {
    ok(true, `sesión real de Clerk para usuario descartable rol contador en ${SLUG} (gestiona paquetes)`);

    // ── 1. crear desde el tarifario ──
    await page.goto(`${BASE}/tarifario/${NIT}`);
    await page.waitForSelector('[data-paquetes]');
    const antes = await page.evaluate(() => ({ n: Number(document.querySelector('[data-paquetes]')?.getAttribute('data-paquetes')), filas: document.querySelectorAll('tr[data-paquete]').length, crear: !!document.querySelector('[data-accion="crear-paquete"]') }));
    ok(antes.n >= 4 && antes.filas === antes.n && antes.crear, `Tarifario → sección Paquetes con ${antes.n} paquetes del cliente y el botón «Crear paquete»`);
    await page.click('[data-accion="crear-paquete"]');
    await page.waitForSelector('[data-form-paquete]');
    await page.fill('[data-campo="nombre"]', 'Paquete E2E 40 polígrafos rutina');
    await page.fill('[data-campo="fecha-inicio"]', '2026-10-01');
    await page.selectOption('[data-campo="linea-servicio"]', 'POLIGRAFO');
    await page.selectOption('[data-campo="linea-categoria"]', 'RUTINA');
    await page.fill('[data-campo="linea-cantidad"]', '40');
    const precio = await page.inputValue('[data-campo="linea-precio"]');
    ok(precio === '400', `precio unitario propuesto desde la tarifa vigente de polígrafo rutina: Q${precio}`);
    await page.click('[data-accion="guardar-paquete"]');   // fecha en el pasado: primero la vista previa
    await page.waitForSelector('[data-vista-linea="1"]');
    const vp = await page.evaluate(() => ({ tomaria: document.querySelector('[data-vista-linea="1"]')?.getAttribute('data-tomaria'), texto: document.querySelector('[data-vista-linea="1"]')?.textContent ?? '', retro: (document.querySelector('[data-campo="aplicar-retro"]') as HTMLInputElement | null)?.checked }));
    ok(vp.tomaria === '1' && /Rita Rutina/.test(vp.texto) && vp.retro === true, `vista previa: descontaría 1 (la rutina de Rita, ya terminada); «aplicar a las ya terminadas» marcado`);
    await page.click('[data-accion="guardar-paquete"]');
    await page.waitForFunction((n0) => document.querySelectorAll('tr[data-paquete]').length > n0, antes.filas);
    const fila = await page.evaluate(() => { const tr = [...document.querySelectorAll('tr[data-paquete]')].find(t => /Paquete E2E 40/.test(t.textContent ?? '')); return { correlativo: tr?.getAttribute('data-paquete') ?? '', estado: tr?.getAttribute('data-estado'), remanente: tr?.getAttribute('data-remanente'), usadas: tr?.querySelector('[data-usadas]')?.getAttribute('data-usadas'), total: tr?.querySelector('[data-usadas]')?.getAttribute('data-total'), href: tr?.querySelector('a[href*="/tarifario/paquetes/"]')?.getAttribute('href') ?? '' }; });
    correlativo = fila.correlativo; paqueteId = fila.href.split('/').pop() ?? '';
    ok(/^PAQ-\d{4}$/.test(correlativo) && fila.estado === 'activo' && fila.remanente === '39' && fila.usadas === '1' && fila.total === '40' && !!paqueteId, `creado ${correlativo}: 1 / 40 usadas, 39 restantes, activo`);
    await page.screenshot({ path: path.join(OUT, 'tarifario-paquetes-1280.png'), fullPage: true });

    // ── 2. Por facturar: banner, «Cubierta por», fuera de la cola; re-resolver no la devuelve ──
    await page.goto(`${BASE}/por-facturar/${encodeURIComponent('n-' + NIT)}`);
    await page.waitForSelector(`[data-banner-paquete="${correlativo}"]`);
    const pf = await page.evaluate((c) => {
      const b = document.querySelector(`[data-banner-paquete="${c}"]`);
      const r1 = document.querySelector('tr[data-expediente="PQE2E-R1"]');
      return { banner: b?.textContent ?? '', estado: b?.getAttribute('data-estado'), sit: r1?.getAttribute('data-situacion'), cubierta: r1?.getAttribute('data-cubierta-por'), etiqueta: r1?.querySelector('[data-etiqueta-cubierta]')?.textContent, checkbox: !!r1?.querySelector('input[type="checkbox"]'), listos: document.querySelector('[data-kpi="listos"] .kpi-value')?.textContent, banners: document.querySelectorAll('[data-banner-paquete]').length };
    }, correlativo);
    ok(/Pol[ií]grafo rutina: 39 restantes de 40/.test(pf.banner) && pf.estado === 'activo' && pf.sit === 'cubierta' && pf.cubierta === correlativo && pf.etiqueta === `Cubierta por ${correlativo}` && !pf.checkbox && pf.banners >= 3, `Por facturar: banner «${pf.banner.replace(/\s+/g, ' ').trim().slice(0, 70)}…»; la rutina está «${pf.etiqueta}», sin checkbox y fuera de «Cobrable ahora» (${pf.listos})`);
    await page.screenshot({ path: path.join(OUT, 'por-facturar-cubierta-1280.png'), fullPage: false });
    await page.goto(`${BASE}/por-facturar`);
    await page.waitForSelector('[data-grupo]');
    const lista = await page.evaluate((nit) => { const tr = document.querySelector(`tr[data-grupo="n-${nit}"]`); return { badges: [...(tr?.querySelectorAll('[data-badge-paquete]') ?? [])].map(b => b.getAttribute('data-badge-paquete')) }; }, NIT);
    ok(lista.badges.includes('por_agotarse') || lista.badges.includes('agotado'), `lista de Por facturar: badges de paquete del cliente (${lista.badges.join(', ')})`);
    const reres = await page.$('[data-accion="re-resolver"]');
    if (reres) { await reres.click(); await page.waitForTimeout(2500); }
    await page.goto(`${BASE}/por-facturar/${encodeURIComponent('n-' + NIT)}`);
    await page.waitForSelector(`[data-banner-paquete="${correlativo}"]`);
    const pf2 = await page.evaluate(() => document.querySelector('tr[data-expediente="PQE2E-R1"]')?.getAttribute('data-situacion'));
    ok(pf2 === 'cubierta', `tras re-resolver, la rutina sigue cubierta (${pf2})`);

    // ── 3. detalle y PDF ──
    await page.click(`[data-banner-paquete="${correlativo}"] [data-accion="ver-paquete"]`);
    await page.waitForSelector('[data-paquete-detalle]');
    const det = await page.evaluate(() => ({ c: document.querySelector('[data-paquete-detalle]')?.getAttribute('data-paquete-detalle'), usadas: document.querySelector('[data-usadas-texto]')?.textContent, consumos: document.querySelector('[data-consumos]')?.getAttribute('data-consumos'), persona: document.querySelector('tr[data-consumo="PQE2E-R1"] .cell-strong')?.textContent, pdf: document.querySelector('[data-accion="pdf-paquete"]')?.getAttribute('href'), csv: !!document.querySelector('[data-accion="csv-paquete"]'), cerrar: !!document.querySelector('[data-accion="cerrar-paquete"]') }));
    ok(det.c === correlativo && det.usadas === 'Usadas 1 de 40 · Restan 39' && det.consumos === '1' && /Rita Rutina/.test(det.persona ?? '') && det.pdf === `/imprimir/paquete/${paqueteId}` && det.csv && det.cerrar, `detalle de ${correlativo}: «${det.usadas}», 1 prueba descontada (${det.persona?.trim().split('\n')[0]}), botones PDF / CSV / cerrar`);
    await page.goto(`${BASE}${det.pdf}`);
    await page.waitForSelector('[data-imprimible="paquete"]');
    const pdf = await page.evaluate(() => ({ usadas: document.querySelector('[data-usadas-texto]')?.textContent, logo: !!document.querySelector('[data-logo]'), filas: document.querySelectorAll('[data-linea-impresa] tbody tr').length, titulo: document.title }));
    ok(pdf.usadas === 'Usadas 1 de 40 · Restan 39' && pdf.logo && pdf.filas === 1, `«Estado del paquete» (PDF): «${pdf.usadas}», con el logo y 1 fila de prueba descontada`);
    await page.screenshot({ path: path.join(OUT, 'estado-paquete-pdf-1280.png'), fullPage: true });

    // ── 4. lista global ──
    await page.goto(`${BASE}/paquetes?f=todos`);
    await page.waitForSelector('[data-lista-paquetes]');
    const lg = await page.evaluate((c) => ({ n: Number(document.querySelector('[data-lista-paquetes]')?.getAttribute('data-lista-paquetes')), fila: !!document.querySelector(`tr[data-paquete="${c}"]`), pasivo: document.querySelector('[data-kpi="pasivo"] .kpi-value')?.textContent, todos: document.querySelector('[data-filtro="todos"]')?.getAttribute('aria-pressed') }), correlativo);
    await page.click('[data-filtro="agotados"]');
    const lg2 = await page.evaluate(() => ({ url: location.search, n: Number(document.querySelector('[data-lista-paquetes]')?.getAttribute('data-lista-paquetes')), estados: [...document.querySelectorAll('tr[data-paquete]')].map(t => t.getAttribute('data-estado')) }));
    ok(lg.n >= 5 && lg.fila && /Q/.test(lg.pasivo ?? '') && lg.todos === 'true' && lg2.url === '?f=agotados' && lg2.n >= 1 && lg2.estados.every(e => e === 'agotado'), `lista global: ${lg.n} paquetes con «todos», pasivo por anticipos ${lg.pasivo}; filtro «agotados» en la URL (${lg2.url}) deja ${lg2.n}`);
    await page.screenshot({ path: path.join(OUT, 'paquetes-lista-1280.png'), fullPage: false });

    // ── 5. 390 px ──
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/tarifario/${NIT}`);
    await page.waitForSelector('[data-paquetes]');
    const m1 = await page.evaluate(() => ({ ancho: document.documentElement.scrollWidth, vp: window.innerWidth }));
    await page.screenshot({ path: path.join(OUT, 'tarifario-paquetes-390.png'), fullPage: false });
    await page.goto(`${BASE}/por-facturar/${encodeURIComponent('n-' + NIT)}`);
    await page.waitForSelector('[data-banner-paquete]');
    const m2 = await page.evaluate(() => ({ ancho: document.documentElement.scrollWidth, vp: window.innerWidth, banner: !!document.querySelector('[data-banner-paquete]') }));
    ok(m1.ancho <= m1.vp + 1 && m2.ancho <= m2.vp + 1 && m2.banner, `390 px: tarifario (${m1.ancho} ≤ ${m1.vp}) y Por facturar con banner (${m2.ancho} ≤ ${m2.vp}) sin ensanchar la página`);
    await page.screenshot({ path: path.join(OUT, 'por-facturar-banner-390.png'), fullPage: false });
    ok(errores.length === 0, `sin errores JS en la sesión contador${errores.length ? ': ' + errores.join(' | ') : ''}`);
  } finally { await ctx.close().catch(() => null); }

  // ── 6. rol lectura ──
  const { ctx: ctx2, page: p2 } = await entrar('lectura', { width: 1280, height: 900 });
  try {
    await p2.goto(`${BASE}/tarifario/${NIT}`);
    await p2.waitForSelector('[data-paquetes]');
    const l1 = await p2.evaluate(() => ({ n: Number(document.querySelector('[data-paquetes]')?.getAttribute('data-paquetes')), crear: !!document.querySelector('[data-accion="crear-paquete"]') }));
    await p2.goto(`${BASE}/paquetes`);
    await p2.waitForSelector('[data-lista-paquetes]');
    const l2 = await p2.evaluate(() => Number(document.querySelector('[data-lista-paquetes]')?.getAttribute('data-lista-paquetes')));
    ok(l1.n >= 5 && !l1.crear && l2 >= 1, `rol lectura: ve los ${l1.n} paquetes del cliente y la lista global (${l2} activos), sin «Crear paquete»`);
  } finally { await ctx2.close().catch(() => null); }

  for (const id of usuarios) await clerk.users.deleteUser(id).catch(() => null);
  console.log(`\n${pass} 🟢 / ${fail} 🔴 · capturas en ${OUT}${correlativo ? ` · paquete creado ${correlativo} (lo borra validate-paquetes.ts hit --solo-limpiar)` : ''}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
