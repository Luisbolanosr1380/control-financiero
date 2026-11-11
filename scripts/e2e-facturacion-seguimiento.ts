/**
 * SEGUIMIENTO DE COBRO A LA VISTA — E2E en Chrome a 1280 y 390 px sobre un `next start` (HIT) con el cliente «FOGEL E2E»
 * que deja `validate-facturacion-seguimiento.ts hit --conservar` (11 facturas con un caso de badge cada una; la
 * CS-E2E-001 es la de nov-2025 PENDIENTE, sin gestión).
 *  1. Facturación → escribe «fogel» → Enter: la búsqueda va al servidor sobre todas las facturas (otro mes) y trae la 001.
 *  2. Abre la factura → sección «Seguimiento de cobro» (sin gestión, contacto preferido) → «Registrar seguimiento» →
 *     promesa de pago para hoy → guardar → la sección muestra la gestión y la promesa y pasa a «Paga hoy».
 *  3. Vuelve a la lista (pestaña Pendientes, todas las abiertas, orden por días vencida): la 001 trae «Paga hoy» y la
 *     nota; el chip «Pagan hoy» la filtra y viaja en la URL; orden por columna en la URL; CSV.
 *  4. 390 px: la página no se ensancha (tabs desplazables) y la sección de la factura se ve.
 *  5. Un usuario `lectura` ve la columna y la sección pero no el botón «Registrar seguimiento».
 *
 * Uso: npx tsx scripts/e2e-facturacion-seguimiento.ts --env hit --base http://localhost:3012 --out /ruta/capturas
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ENV = arg('--env', 'hit');
const BASE = arg('--base', 'http://localhost:3012').replace(/\/$/, '');
const OUT = arg('--out', path.join(os.tmpdir(), 'e2e-facturacion-seguimiento'));
const CHROME = arg('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const PREFIJO = 'CS-E2E-', NF = `${PREFIJO}001`, ID001 = 'recCSE2E001';
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
  const hoy = (await import('../src/lib/utils/fechas')).obtenerFechaHoyGuatemala();
  const entrar = async (rol: string, viewport: { width: number; height: number }, movil = false) => {
    const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cs-')), { executablePath: CHROME, headless: true, args: [`--user-agent=${UA}`], viewport, userAgent: UA, locale: 'es-GT', acceptDownloads: true, ...(movil ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}) });
    const u = await clerk.users.createUser({ emailAddress: [`e2e.seguimiento+${rol}${STAMP}@example.com`], password: `E2e-${STAMP}-${Math.random().toString(36).slice(2)}!Aa9`, firstName: 'E2E', lastName: `Seg ${rol}`, skipPasswordChecks: true, publicMetadata: { accesos: [{ empresa_slug: SLUG, rol }] } });
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
  console.log(`\nE2E seguimiento de cobro en Facturación · ${ENV.toUpperCase()} · ${BASE}`);
  const { ctx, page } = await entrar('contador', { width: 1280, height: 900 });
  const errores: string[] = []; page.on('pageerror', e => errores.push(e.message));
  try {
    ok(true, `sesión real de Clerk para usuario descartable rol contador en ${SLUG} (ve Facturación y gestiona cobranza)`);

    // ── 1. buscar «fogel» con Enter: todas las facturas, otro mes ──
    await page.goto(`${BASE}/facturacion`);
    await page.waitForSelector('[data-campo="buscar"]');
    await page.fill('[data-campo="buscar"]', 'fogel');
    const hint = await page.textContent('[data-accion="buscar-texto"]').catch(() => null);
    await page.press('[data-campo="buscar"]', 'Enter');
    await page.waitForSelector('[data-resultados-busqueda]');
    const r1 = await page.evaluate((nf) => ({ url: location.search, chip: document.querySelector('[data-chip-texto]')?.textContent, n: Number(document.querySelector('[data-resultados-busqueda]')?.getAttribute('data-resultados-busqueda')), tiene: !!document.querySelector(`[data-lista="busqueda"] tr[data-factura="${nf}"]`), fecha: document.querySelector(`[data-lista="busqueda"] tr[data-factura="${nf}"] td:nth-child(2)`)?.textContent }), NF);
    ok(/Enter para buscar «fogel» en todas/.test(hint ?? '') && r1.url === '?q=fogel' && r1.chip === 'todas · «fogel»' && r1.n >= 10 && r1.tiene && r1.fecha === '13/11/2025', `«fogel» + Enter → URL ${r1.url}, chip "${r1.chip}", ${r1.n} facturas del cliente de todos los meses; la ${NF} de nov-2025 aparece (${r1.fecha}); el chip previo decía "${hint}"`);
    await page.screenshot({ path: path.join(OUT, 'buscar-fogel-1280.png') });

    // ── 2. abrir la factura → sección → registrar promesa para hoy ──
    await page.click(`[data-lista="busqueda"] tr[data-factura="${NF}"] [data-accion="abrir-factura"]`);
    await page.waitForURL(u2 => u2.pathname === `/facturacion/${ID001}`, { timeout: 20_000 });
    await page.waitForSelector('[data-seguimiento-cobro]');
    const s1 = await page.evaluate(() => ({ badge: document.querySelector('[data-seguimiento-cobro]')?.getAttribute('data-badge'), estado: document.querySelector('[data-estado-cobro]')?.textContent, promesa: document.querySelector('[data-promesa-vigente]')?.textContent, contacto: document.querySelector('[data-contacto-preferido]')?.textContent, acciones: ['llamar', 'whatsapp', 'correo'].map(a => !!document.querySelector(`[data-contacto-preferido] [data-accion="${a}"]`)), boton: !!document.querySelector('[data-accion="registrar-seguimiento"]'), ficha: document.querySelector('[data-accion="ver-ficha-cobranza"]')?.getAttribute('href'), eventos: Number(document.querySelector('[data-seguimiento-cobro]')?.getAttribute('data-seguimiento-cobro')), responsable: document.querySelector('[data-responsable]')?.textContent }));
    ok(s1.badge === 'sin_gestion' && /Vencida · \d+ d/.test(s1.estado ?? '') && s1.promesa === 'sin promesa' && /Liseth Ramírez/.test(s1.contacto ?? '') && s1.acciones.every(Boolean) && s1.boton && /^\/cobranza\//.test(s1.ficha ?? '') && s1.eventos === 1, `sección «Seguimiento de cobro»: ${s1.estado}, badge ${s1.badge}, ${s1.promesa}, contacto preferido Liseth con llamar / WhatsApp / correo, responsable ${s1.responsable}, ${s1.eventos} evento propio, botón y enlace a la ficha (${s1.ficha})`);
    // interruptor «incluir lo general del cliente»
    await page.check('[data-campo="incluir-cliente"]');
    const s2 = await page.evaluate(() => ({ n: Number(document.querySelector('[data-historial-factura]')?.getAttribute('data-historial-factura')), generales: document.querySelectorAll('[data-evento][data-general="1"]').length }));
    await page.uncheck('[data-campo="incluir-cliente"]');
    const s3 = await page.evaluate(() => Number(document.querySelector('[data-historial-factura]')?.getAttribute('data-historial-factura')));
    ok(s2.n === 2 && s2.generales === 1 && s3 === 1, `el interruptor suma lo general del cliente (${s3} → ${s2.n} eventos, ${s2.generales} general) y lo quita`);
    await page.screenshot({ path: path.join(OUT, 'factura-seccion-1280.png'), fullPage: true });
    await page.click('[data-accion="registrar-seguimiento"]');
    await page.waitForSelector('[data-gestion-form]');
    const f1 = await page.evaluate((nf) => ({ pre: (document.querySelector(`[data-gestion-form] [data-factura="${nf}"]`) as HTMLInputElement | null)?.checked, seg: (document.querySelector('[data-campo="seguimiento"]') as HTMLInputElement | null)?.value, canal: document.querySelectorAll('[data-canal]').length, contacto: (document.querySelector('[data-campo="contacto"]') as HTMLSelectElement | null)?.selectedOptions[0]?.textContent }), NF);
    const en7 = new Date(`${hoy}T00:00:00Z`); en7.setUTCDate(en7.getUTCDate() + 7);
    ok(f1.pre === true && f1.seg === en7.toISOString().slice(0, 10) && f1.canal === 6 && /Liseth/.test(f1.contacto ?? ''), `el MISMO formulario del Centro de Cobros con la ${NF} preseleccionada, seguimiento propuesto a 7 días (${f1.seg}), canales y el contacto preferido`);
    await page.click('[data-canal="llamada"]');
    await page.selectOption('[data-campo="resultado"]', 'promesa');
    await page.waitForSelector('[data-promesa]');
    const placeholder = await page.getAttribute('[data-campo="promesa-monto"]', 'placeholder');
    await page.fill('[data-campo="promesa-fecha"]', hoy);
    await page.fill('[data-campo="comentario"]', 'Pagan hoy por transferencia');
    await page.click('[data-accion="guardar-gestion"]');
    await page.waitForSelector('[data-gestion-form]', { state: 'detached', timeout: 30_000 });
    await page.waitForFunction(() => document.querySelector('[data-seguimiento-cobro]')?.getAttribute('data-badge') === 'paga_hoy', null, { timeout: 30_000 });
    const s4 = await page.evaluate(() => ({ badge: document.querySelector('[data-seguimiento-cobro]')?.getAttribute('data-badge'), badgeTxt: document.querySelector('[data-seguimiento-cobro] [data-badge-texto]')?.textContent, promesa: document.querySelector('[data-promesa-vigente]')?.getAttribute('data-promesa-vigente'), tipos: [...document.querySelectorAll('[data-historial-factura] [data-evento]')].map(e => e.getAttribute('data-evento')), n: Number(document.querySelector('[data-seguimiento-cobro]')?.getAttribute('data-seguimiento-cobro')) }));
    ok(/Q1,100/.test(placeholder ?? '') && s4.badge === 'paga_hoy' && s4.badgeTxt === 'Paga hoy' && s4.promesa === hoy && s4.tipos.includes('gestion') && s4.tipos.includes('promesa') && s4.n === 3, `promesa de pago para hoy (monto propuesto = saldo ${placeholder}) → la sección muestra la gestión y la promesa (${s4.n} eventos) y pasa a «${s4.badgeTxt}» con la promesa vigente ${s4.promesa}`);
    await page.screenshot({ path: path.join(OUT, 'factura-paga-hoy-1280.png'), fullPage: true });

    // ── 3. la lista: Pendientes con todas las abiertas, orden por días, badge, chip, orden en la URL ──
    await page.goto(`${BASE}/facturacion?tab=pendientes`);
    await page.waitForSelector('[data-lista="cartera"]');
    const l1 = await page.evaluate((nf) => {
      const filas = [...document.querySelectorAll('[data-lista="cartera"] tbody tr[data-factura]')];
      const dias = filas.map(t => Number(t.getAttribute('data-dias')));
      const fila = document.querySelector(`[data-lista="cartera"] tr[data-factura="${nf}"]`);
      return { n: filas.length, ordenDesc: dias.every((d, i) => i === 0 || dias[i - 1] >= d), primero: filas[0]?.getAttribute('data-factura'), dias001: Number(fila?.getAttribute('data-dias')), badge: fila?.querySelector('[data-badge-texto]')?.textContent, nota: fila?.querySelector('[data-nota]')?.textContent, notaTitle: fila?.querySelector('[data-nota]')?.getAttribute('title'), resumen: document.querySelector('[data-resumen-cartera]')?.textContent, kpi: document.querySelector('[data-kpi-promesas-semana]')?.textContent, chips: document.querySelectorAll('[data-chip-cobranza]').length, totales: !!document.querySelector('[data-totales-cartera]'), cols: [...document.querySelectorAll('[data-lista="cartera"] thead th')].map(t => t.textContent?.trim()) };
    }, NF);
    ok(l1.n >= 1 && l1.ordenDesc && l1.dias001 > 300 && l1.badge === 'Paga hoy' && /Llamada a Liseth Ramírez: Pagan hoy por transferencia/.test(l1.nota ?? '') && /— e2e\.seguimiento\+contador/.test(l1.notaTitle ?? '') && /de todos los meses/.test(l1.resumen ?? '') && /Promesas de esta semana: [1-9]/.test(l1.kpi ?? '') && l1.chips === 5 && l1.totales && l1.cols.slice(0, 9).join('|') === 'Factura|Cliente|Emisión|Vence|Días vencida ↓|Total|Saldo|Cobranza|Estado', `Pendientes: ${l1.n} facturas de todos los meses ordenadas por días vencida (primera ${l1.primero}); la ${NF} (${l1.dias001} d) trae «${l1.badge}» y la nota «${l1.nota}» (autor en el title); KPI «${l1.kpi}»; 5 chips; pie; columnas ${l1.cols.slice(0, 9).join(', ')}`);
    await page.screenshot({ path: path.join(OUT, 'lista-pendientes-1280.png'), fullPage: true });
    await page.click('[data-chip-cobranza="pagan_hoy"]');
    await page.waitForFunction(() => location.search.includes('cob=pagan_hoy'));
    await page.waitForSelector('[data-lista="cartera"]');
    const l2 = await page.evaluate((nf) => ({ url: location.search, filas: [...document.querySelectorAll('[data-lista="cartera"] tbody tr[data-factura]')].map(t => t.getAttribute('data-factura')), badges: [...new Set([...document.querySelectorAll('[data-lista="cartera"] tbody tr[data-factura]')].map(t => t.getAttribute('data-badge')))], tiene: !!document.querySelector(`[data-lista="cartera"] tr[data-factura="${nf}"]`), pressed: document.querySelector('[data-chip-cobranza="pagan_hoy"]')?.getAttribute('aria-pressed') }), NF);
    ok(l2.url === '?tab=pendientes&cob=pagan_hoy' && l2.tiene && l2.badges.join() === 'paga_hoy' && l2.pressed === 'true', `chip «Pagan hoy» → URL ${l2.url}; ${l2.filas.length} fila(s), todas «paga hoy», la ${NF} incluida`);
    // vencidas (otra pestaña de cartera): la 002 que paga hoy también sale, con el chip conservado en la URL
    await page.goto(`${BASE}/facturacion?tab=vencidas&cob=pagan_hoy`);
    await page.waitForSelector('[data-lista="cartera"]');
    const l3 = await page.evaluate(() => [...document.querySelectorAll('[data-lista="cartera"] tbody tr[data-factura]')].map(t => t.getAttribute('data-factura')));
    ok(l3.includes(`${PREFIJO}002`) && !l3.includes(NF), `URL compartida con pestaña + chip: Vencidas + pagan hoy trae la ${PREFIJO}002 (emitida) y no la ${NF} (pendiente)`);
    // orden por columna → URL
    await page.goto(`${BASE}/facturacion?tab=cartera_total`);
    await page.waitForSelector('[data-lista="cartera"]');
    const antes = await page.evaluate(() => document.querySelectorAll('[data-lista="cartera"] tbody tr[data-factura]').length);
    await page.click('[data-orden="cliente"]');
    // la URL cambia antes de que llegue el render del servidor: esperar al encabezado ya marcado como ascendente
    await page.waitForSelector('[data-orden="cliente"][aria-sort="ascending"]');
    const l4 = await page.evaluate(() => { const c = [...document.querySelectorAll('[data-lista="cartera"] tbody tr[data-factura] td:nth-child(2)')].map(t => t.getAttribute('title') ?? ''); return { url: location.search, asc: c.every((x, i) => i === 0 || c[i - 1].localeCompare(x, 'es', { sensitivity: 'base' }) <= 0), n: c.length, clientes: [...new Set(c)].length, sort: document.querySelector('[data-orden="cliente"]')?.getAttribute('aria-sort') }; });
    ok(l4.url === '?tab=cartera_total&orden=cliente&dir=asc' && l4.asc && l4.sort === 'ascending' && l4.n === antes, `clic en «Cliente» → URL ${l4.url}, ${l4.n} filas (${l4.clientes} clientes) ordenadas por cliente (antes ${antes} filas)`);
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('[data-accion="exportar-csv-cartera"]')]);
    const csvPath = path.join(OUT, 'cartera.csv'); await descarga.saveAs(csvPath);
    const csv = fs.readFileSync(csvPath, 'utf8');
    const lineasCsv = csv.split('\n').filter(Boolean);
    ok(/^\uFEFFFactura,Cliente,Emisión,Vence,Días vencida,Total,Saldo,Cobranza,Última nota/.test(csv) && lineasCsv.length === l4.n + 2 && /^TOTAL,/m.test(csv) && /Paga hoy/.test(csv), `CSV de la cartera: encabezado con Cobranza y Última nota, ${lineasCsv.length - 2} filas (tabla: ${l4.n}) y TOTAL`);

    // ── 4. 390 px ──
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/facturacion?tab=vencidas`);
    await page.waitForSelector('[data-lista="cartera"]');
    const m1 = await page.evaluate(() => { const tabs = document.querySelector('[data-tabs-facturacion]'); return { ancho: document.documentElement.scrollWidth, vp: window.innerWidth, tabsScroll: tabs ? tabs.scrollWidth > tabs.clientWidth : false, tabsAncho: tabs?.getBoundingClientRect().width }; });
    ok(m1.ancho <= m1.vp + 1 && m1.tabsScroll, `390 px: la página no se ensancha (${m1.ancho} ≤ ${m1.vp}); la fila de pestañas se desplaza dentro de su contenedor (${Math.round(m1.tabsAncho ?? 0)} px visibles)`);
    await page.screenshot({ path: path.join(OUT, 'lista-vencidas-390.png'), fullPage: false });
    await page.goto(`${BASE}/facturacion/${ID001}`);
    await page.waitForSelector('[data-seguimiento-cobro]');
    const m2 = await page.evaluate(() => ({ ancho: document.documentElement.scrollWidth, vp: window.innerWidth, badge: document.querySelector('[data-seguimiento-cobro]')?.getAttribute('data-badge'), boton: !!document.querySelector('[data-accion="registrar-seguimiento"]') }));
    ok(m2.badge === 'paga_hoy' && m2.boton, `390 px: la sección de la factura se ve con «${m2.badge}» y el botón (ancho ${m2.ancho} vs ${m2.vp}${m2.ancho > m2.vp + 1 ? ' · la página de la factura ya se ensanchaba antes de este PR' : ''})`);
    await page.screenshot({ path: path.join(OUT, 'factura-seccion-390.png'), fullPage: true });
    ok(errores.length === 0, `sin errores de JavaScript en la página${errores.length ? ': ' + errores.slice(0, 3).join(' | ') : ''}`);
  } finally { await ctx.close().catch(() => null); }

  // ── 5. rol lectura: ve, no gestiona ──
  const L = await entrar('lectura', { width: 1280, height: 900 });
  try {
    await L.page.goto(`${BASE}/facturacion/${ID001}`);
    await L.page.waitForSelector('[data-seguimiento-cobro]');
    const r = await L.page.evaluate(() => ({ seccion: !!document.querySelector('[data-seguimiento-cobro]'), boton: !!document.querySelector('[data-accion="registrar-seguimiento"]'), badge: document.querySelector('[data-seguimiento-cobro]')?.getAttribute('data-badge') }));
    await L.page.goto(`${BASE}/facturacion?tab=pendientes`);
    await L.page.waitForSelector('[data-lista="cartera"]');
    const c = await L.page.evaluate(() => document.querySelectorAll('[data-lista="cartera"] [data-cobranza]').length);
    ok(r.seccion && !r.boton && r.badge === 'paga_hoy' && c >= 1, `rol lectura: ve la sección (${r.badge}) y la columna Cobranza (${c} filas) pero no tiene el botón «Registrar seguimiento»`);
  } finally { await L.ctx.close().catch(() => null); }

  for (const id of usuarios) await clerk.users.deleteUser(id).catch(() => null);
  console.log(`\n${pass} 🟢 / ${fail} 🔴 · capturas en ${OUT}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
