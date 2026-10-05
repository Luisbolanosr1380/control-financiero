/**
 * MÓVIL / PWA — E2E en navegador real, a ancho de teléfono.
 *
 * Contra un `next start` (o un deploy) y la base del env indicado:
 *  1. Usuario DESCARTABLE de Clerk con el rol pedido; inicia sesión con un
 *     sign-in token (sesión real, con refresh — las server actions corren
 *     minutos después de cargar la página). Se borra al final, pase lo que pase.
 *  2. Teléfono (390×844, táctil): / redirige a la home del rol; el layout no
 *     se desborda a lo ancho.
 *  3. Instalabilidad: Chrome no reporta errores (Page.getInstallabilityErrors),
 *     manifest leído, service worker activo, y sin red la navegación cae a
 *     /offline.html.
 *  4. --modo chat: toca una sugerencia y hace una pregunta de cliente; Auros
 *     responde con cifras de las tools sin romper el layout.
 *     --modo captura: factura (foto adjunta), cobro (foto como constancia) y
 *     gasto (foto leída por Gemini → bandeja Pendiente); verifica en la base
 *     que cada adjunto quedó guardado y se puede abrir; el auxiliar no entra a
 *     Auros ni a aprobar gastos. Limpia todo y lo verifica.
 *     --modo escritorio: regresión del drawer de Auros en escritorio (usa el
 *     mismo hook que el chat móvil): abre el panel, pregunta y responde.
 *
 * Uso:
 *   npx tsx --conditions=react-server scripts/e2e-movil.ts --env hit --modo captura --rol auxiliar --base http://localhost:3012
 *   npx tsx --conditions=react-server scripts/e2e-movil.ts --env golden --modo chat --rol lectura --base http://localhost:3011
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ENV = arg('--env', 'hit');
const MODO = arg('--modo', 'captura') as 'chat' | 'captura' | 'escritorio';
const ROL = arg('--rol', MODO === 'chat' ? 'lectura' : 'auxiliar');
const BASE = arg('--base', 'http://localhost:3000').replace(/\/$/, '');
const CHROME = arg('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const SHOTS = arg('--capturas', path.join(process.cwd(), '.e2e-movil'));

const envFile = ENV === 'hit' ? '.env.hit.vercel' : '.env.local';
for (const line of fs.readFileSync(path.join(process.cwd(), envFile), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('=');
  if (ENV === 'hit' || !(k.trim() in process.env)) process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  🟢 ${m}`); } else { fail++; console.log(`  🔴 ${m}`); } };
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const UA_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ES_ESCRITORIO = MODO === 'escritorio';
const UA = ES_ESCRITORIO ? UA_DESKTOP : UA_ANDROID;
const SLUG = (process.env.EMPRESA_SLUG || 'golden').toLowerCase();

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const { chromium } = await import('playwright-core');
  const { createClerkClient } = await import(path.resolve(process.cwd(), 'node_modules/@clerk/backend/dist/index.mjs'));
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  const STAMP = Date.now().toString(36);
  const TAG = `E2E-MOVIL-${STAMP}`;
  const email = `e2e.movil+${STAMP}@example.com`;
  let userId: string | null = null;
  const creados: Array<[string, string]> = [];
  const urlsStorage: string[] = [];
  // Perfil persistente (no incógnito: Chrome no considera instalable una PWA en incógnito) y UA a nivel
  // del navegador (las navegaciones las sirve el service worker, que no hereda el override por página).
  process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-movil-'));
  const ctx = await chromium.launchPersistentContext(perfil, {
    executablePath: CHROME, headless: true, args: [`--user-agent=${UA}`],
    viewport: ES_ESCRITORIO ? { width: 1440, height: 900 } : { width: 390, height: 844 },
    deviceScaleFactor: 2, isMobile: !ES_ESCRITORIO, hasTouch: !ES_ESCRITORIO, userAgent: UA, locale: 'es-GT',
  });

  console.log(`\nE2E móvil · ${MODO} · rol ${ROL} · ${ENV.toUpperCase()} · ${BASE}`);
  try {
    const u = await clerk.users.createUser({
      emailAddress: [email], password: `E2e-${STAMP}-${Math.random().toString(36).slice(2)}!Aa9`, firstName: 'E2E', lastName: 'Movil', skipPasswordChecks: true,
      publicMetadata: { accesos: [{ empresa_slug: SLUG, rol: ROL }] },
    });
    userId = u.id;
    const ticket = (await clerk.signInTokens.createSignInToken({ userId: u.id, expiresInSeconds: 600 })).token;

    const page = ctx.pages()[0] ?? await ctx.newPage();
    page.setDefaultTimeout(30_000);
    const erroresConsola: string[] = [];
    if (process.env.E2E_DEBUG) page.on('request', async r => { if (r.url() === `${BASE}/`) console.log('     · REQ / headers', JSON.stringify(await r.allHeaders())); });
    if (process.env.E2E_DEBUG) page.on('response', r => { if (r.request().isNavigationRequest() || r.status() >= 300 && r.status() < 400) console.log(`     · ${r.status()} ${r.url()} → ${r.headers()['location'] ?? ''}`); });
    if (process.env.E2E_DEBUG) page.on('framenavigated', f => { if (f === page.mainFrame()) console.log(`     · nav ${f.url()}`); });
    page.on('pageerror', e => erroresConsola.push(e.message));

    await page.goto(`${BASE}/sign-in`);
    await page.waitForFunction(() => (window as unknown as { Clerk?: { loaded?: boolean } }).Clerk?.loaded === true, null, { timeout: 30_000 });
    await page.evaluate(async (t) => {
      const C = (window as unknown as { Clerk: { client: { signIn: { create: (a: unknown) => Promise<{ createdSessionId: string }> } }; setActive: (a: unknown) => Promise<void> } }).Clerk;
      const si = await C.client.signIn.create({ strategy: 'ticket', ticket: t });
      await C.setActive({ session: si.createdSessionId });
    }, ticket);
    // Clerk redirige solo tras setActive (fallback /dashboard): esperar a que termine antes de probar "/".
    await page.waitForURL(u => !u.pathname.startsWith('/sign-in'), { timeout: 20_000 }).catch(() => null);
    await page.waitForLoadState('networkidle').catch(() => null);
    ok(true, `sesión real de Clerk (sign-in token) para usuario descartable con rol ${ROL} en ${SLUG}`);

    if (process.env.E2E_DEBUG) {
      const r0 = await page.request.get(`${BASE}/`, { maxRedirects: 0, headers: { 'User-Agent': UA_ANDROID, Accept: 'text/html' } });
      console.log(`     · GET / → ${r0.status()} ${r0.headers()['location'] ?? ''} ${r0.headers()['x-clerk-auth-reason'] ?? ''}`);
    }
    if (ES_ESCRITORIO) {
      // ── Regresión del drawer de escritorio ──
      await page.goto(`${BASE}/`);
      await page.waitForURL('**/dashboard');
      ok(page.url().endsWith('/dashboard'), 'escritorio en "/" → /dashboard (la app móvil no se mete en la PC)');
      await page.getByRole('button', { name: 'Auros', exact: true }).click();
      const saludo = await page.locator('.ai-panel').innerText();
      ok(/Hola .+, soy Auros/.test(saludo), `drawer abierto con el saludo de la empresa ("${saludo.match(/Hola [^,]+/)?.[0]}")`);
      await page.locator('.ai-panel textarea').fill('¿Cuánto me deben y quién?');
      await page.locator('.ai-panel textarea').press('Enter');
      await page.waitForFunction(() => !!document.querySelector('.ai-panel .ai-text') || /Error:/.test(document.querySelector('.ai-panel')?.textContent ?? ''), null, { timeout: 150_000 });
      const t = await page.locator('.ai-panel .ai-text').last().innerText().catch(() => '');
      console.log(`     Auros (escritorio) → ${t.replace(/\s+/g, ' ').slice(0, 300)}`);
      ok(/Q\s?[\d,]{2,}/.test(t), 'el drawer de escritorio responde con cifras (mismo hook que el móvil)');
      await page.screenshot({ path: path.join(SHOTS, 'escritorio-drawer.png') });
      ok(erroresConsola.length === 0, `sin errores de JavaScript${erroresConsola.length ? `: ${erroresConsola[0]}` : ''}`);
      return;
    }
    // ── Entrada por rol ──
    const home = MODO === 'chat' ? '/m/auros' : '/m/captura';
    await page.goto(`${BASE}/`);
    await page.waitForURL(`**${home}`, { timeout: 30_000 }).catch(async () => {
      await page.screenshot({ path: path.join(SHOTS, `${MODO}-entrada-fallida.png`) });
      throw new Error(`"/" terminó en ${page.url()} en vez de ${home}`);
    });
    ok(page.url().endsWith(home), `teléfono en "/" → ${home} (home del rol ${ROL})`);
    const desborde = async () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok((await desborde()) <= 1, 'a 390 px de ancho no hay scroll horizontal');

    // ── Instalabilidad PWA ──
    const cdp = await ctx.newCDPSession(page);
    const swActivo = await page.evaluate(async () => {
      const r = await Promise.race([navigator.serviceWorker.ready, new Promise(res => setTimeout(() => res(null), 15000))]);
      return !!(r && (r as ServiceWorkerRegistration).active);
    });
    ok(swActivo, 'service worker registrado y activo (/sw.js)');
    const inst = await cdp.send('Page.getInstallabilityErrors') as { installabilityErrors: Array<{ errorId: string }> };
    ok(inst.installabilityErrors.length === 0, `Chrome: instalable, sin errores de instalabilidad${inst.installabilityErrors.length ? ` (${inst.installabilityErrors.map(e => e.errorId).join(', ')})` : ''}`);
    const man = await cdp.send('Page.getAppManifest') as { url: string; errors: Array<{ message: string }>; data?: string };
    const datosMan = man.data ? JSON.parse(man.data) : {};
    ok(man.errors.length === 0 && datosMan.display === 'standalone' && datosMan.start_url === '/m', `manifest leído por Chrome sin errores: "${datosMan.name}" · start_url ${datosMan.start_url}`);
    const icono = await page.request.get(`${BASE}/pwa/maskable-512.png`);
    ok(icono.status() === 200 && icono.headers()['content-type'] === 'image/png' && (await icono.body()).length > 1000, 'ícono maskable por empresa se sirve sin sesión (image/png)');
    const html = await page.content();
    ok(/apple-mobile-web-app-capable|mobile-web-app-capable/.test(html) && /apple-touch-icon/.test(html), 'etiquetas de iOS ("Agregar a inicio") presentes');
    await page.screenshot({ path: path.join(SHOTS, `${MODO}-inicio.png`) });

    // Sin red: se corta la red del service worker (por donde pasan las navegaciones).
    const enCache = await page.evaluate(async () => !!(await caches.match('/offline.html')));
    await ctx.route('**/*', r => (r.request().serviceWorker() ? r.abort('internetdisconnected') : r.continue()));
    await page.goto(`${BASE}${home}`).catch(() => null);
    const sinRed = await page.content();
    await ctx.unroute('**/*');
    ok(enCache && /Sin conexión/.test(sinRed), 'sin red: la navegación muestra /offline.html (precacheada), no una pantalla rota');
    await page.screenshot({ path: path.join(SHOTS, `${MODO}-offline.png`) });
    await page.goto(`${BASE}${home}`);

    if (MODO === 'chat') {
      // ── Auros chat ──
      const sug = '¿Quién facturó más este mes? (vs el mes pasado)';
      await page.getByRole('button', { name: sug }).click();
      const respuesta = page.locator('.ai-text').last();
      await page.waitForFunction(() => !!document.querySelector('.ai-text') || !!document.querySelector('[data-auros-error]'), null, { timeout: 150_000 });
      if (await page.locator('[data-auros-error]').count()) throw new Error(`Auros devolvió error: ${await page.locator('[data-auros-error]').innerText()}`);
      const t1 = (await respuesta.innerText()).trim();
      console.log(`     Auros → ${t1.replace(/\s+/g, ' ').slice(0, 400)}`);
      const funciones1 = await page.locator('.msg-ai').last().innerText();
      ok(/Q\s?[\d,]{2,}/.test(t1) && /\d+ funci[oó]n/.test(funciones1), `respuesta con cifras en quetzales y tools llamadas (${funciones1.match(/\d+ funci[oó]n(es)?/)?.[0] ?? 'sin tools'})`);
      ok(!/Q320,000|Q18,000|Cliente [ABC]\b/.test(t1), 'no copia montos de ejemplo de las instrucciones');
      ok(!/^nadie\b|nadie ha facturado/i.test(t1) && /(d[ií]a \d+|mes pasado|anterior|septiembre|agosto|octubre|noviembre|diciembre|enero|febrero|marzo|abril|mayo|junio|julio)/i.test(t1),
        'conciencia de calendario: no responde un cero pelado; ubica el día o compara con el mes anterior');
      ok((await desborde()) <= 1, 'con la respuesta en pantalla, sigue sin scroll horizontal');
      await page.screenshot({ path: path.join(SHOTS, 'chat-respuesta-1.png'), fullPage: false });

      // Cliente real con facturación en los últimos 3 meses, del mismo catálogo que usa Auros.
      const { getFacturasLiviano } = await import('../src/lib/db/facturas');
      const { getClientes } = await import('../src/lib/db/clientes');
      const { computeTopClientesRango } = await import('../src/lib/facturacion/top-clientes');
      const desde3m = new Date(Date.now() - 95 * 864e5).toISOString().slice(0, 10);
      const topR = computeTopClientesRango(await getFacturasLiviano({ desde: desde3m, hasta: new Date().toISOString().slice(0, 10) }), await getClientes(), 1);
      const cliente = topR.items[0]?.nombre.split(/[ ,]/).filter(Boolean).slice(0, 2).join(' ');
      if (cliente) {
        await page.locator('textarea').fill(`¿Cuánto le facturamos a ${cliente} en los últimos 3 meses y cuál fue su última factura?`);
        await page.getByRole('button', { name: 'Enviar' }).click();
        await page.waitForFunction(() => document.querySelectorAll('.ai-text').length >= 2 || !!document.querySelector('[data-auros-error]'), null, { timeout: 150_000 });
        const alerta = await page.locator('[data-auros-error]').count() ? await page.locator('[data-auros-error]').innerText() : '';
        if (alerta) throw new Error(`Auros devolvió error: ${alerta}`);
        const t2 = (await page.locator('.ai-text').last().innerText()).trim();
        console.log(`     Auros → ${t2.replace(/\s+/g, ' ').slice(0, 400)}`);
        const funciones2 = await page.locator('.msg-ai').last().innerText();
        ok(/Q\s?[\d,]{2,}/.test(t2) && /\d+ funci[oó]n/.test(funciones2), `cliente "${cliente}" últimos 3 meses: responde con cifras de tools (${funciones2.match(/\d+ funci[oó]n(es)?/)?.[0] ?? 'sin tools'})`);
        ok((await desborde()) <= 1, 'dos respuestas en pantalla, sin desborde');
        const inputVisible = await page.locator('textarea').evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; });
        ok(inputVisible, 'con la conversación larga, el campo para preguntar sigue a la vista (no se va abajo)');
        await page.screenshot({ path: path.join(SHOTS, 'chat-respuesta-2.png') });
      }
      ok(erroresConsola.length === 0, `sin errores de JavaScript en la página${erroresConsola.length ? `: ${erroresConsola[0]}` : ''}`);
    } else {
      // ── Captura ──
      const nav = await page.locator('nav').innerText();
      ok(!/Auros/.test(nav) && /Capturar/.test(nav), `menú del ${ROL}: Capturar sin Auros`);
      await page.goto(`${BASE}/m/auros`);
      await page.waitForURL('**/m/captura');
      ok(page.url().endsWith('/m/captura'), `${ROL} que abre /m/auros vuelve a captura (sin Auros)`);

      const cli = await sb.from('clientes').insert({ airtable_id: `sbwmv${STAMP}`, razon_social: `${TAG} CLIENTE`, nombre_empresa: `${TAG} CLIENTE`, dias_credito: 15 }).select('id').single();
      if (cli.error) throw new Error(cli.error.message); creados.push(['clientes', String(cli.data.id)]);
      const bco = await sb.from('bancos').insert({ airtable_id: `sbwmvb${STAMP}`, nombre_cuenta: `${TAG} Monetaria`, banco: 'E2E', moneda: 'GTQ', activo: true }).select('id').single();
      if (bco.error) throw new Error(bco.error.message); creados.push(['bancos', String(bco.data.id)]);
      await page.goto(`${BASE}/m/captura`);   // las opciones (clientes, bancos) se cargan con la página

      // Imágenes de prueba renderizadas en el propio navegador (una "foto" de factura).
      const foto = async (titulo: string, lineas: string[]) => {
        const p = await ctx.newPage();
        await p.setViewportSize({ width: 900, height: 1100 });
        await p.setContent(`<html><body style="font-family:Arial;padding:40px;background:#fff;color:#111">
          <h2 style="margin:0 0 4px">${titulo}</h2>${lineas.map(l => `<div style="font-size:22px;margin:6px 0">${l}</div>`).join('')}</body></html>`);
        const buf = await p.screenshot({ type: 'png' });
        await p.close();
        return buf;
      };
      const elegirTipo = (t: string) => page.getByRole('tab', { name: t }).click();
      const subirFoto = async (nombre: string, buffer: Buffer) => {
        await page.locator('input[capture="environment"]').setInputFiles({ name: nombre, mimeType: 'image/png', buffer });
        await page.getByAltText('Documento capturado').waitFor();
      };
      const verArchivo = async (url: string | null | undefined, que: string) => {
        if (!url) { ok(false, `${que}: sin URL de adjunto en la base`); return; }
        urlsStorage.push(url);
        const r = await fetch(url);
        const tipo = r.headers.get('content-type') ?? '';
        ok(r.status === 200 && /^image\//.test(tipo) && Number(r.headers.get('content-length') ?? (await r.clone().arrayBuffer()).byteLength) > 1000, `${que}: adjunto guardado y visible (${r.status}, ${tipo})`);
      };

      // 1) Factura con la foto adjunta
      const noFactura = `${TAG}-F1`;
      await elegirTipo('Factura');
      await subirFoto('factura.png', await foto('FACTURA', [`No. ${noFactura}`, 'Total Q 1,120.00']));
      await page.getByLabel('Cliente').selectOption({ label: `${TAG} CLIENTE` });
      await page.getByLabel('Número de factura').fill(noFactura);
      await page.getByLabel('Total con IVA').fill('1120');
      if (await page.getByLabel('Línea de negocio').count()) await page.getByLabel('Línea de negocio').selectOption({ index: 1 });
      await page.screenshot({ path: path.join(SHOTS, 'captura-factura.png') });
      await page.getByRole('button', { name: 'Registrar factura' }).click();
      const st1 = await page.getByRole('status').first().innerText({ timeout: 60_000 });
      ok(/registrada/.test(st1) && /foto adjunta/.test(st1), `factura: "${st1.slice(0, 90)}"`);
      const { data: f } = await sb.from('facturas_clientes').select('id, total, adjunto_url, estado').eq('no_factura', noFactura).maybeSingle();
      if (f) creados.push(['facturas_clientes', String(f.id)]);
      ok(!!f && Number(f.total) === 1120, `factura en la base: total ${f?.total}, estado ${f?.estado}`);
      await verArchivo(f?.adjunto_url, 'factura');

      // 2) Cobro de esa factura con la foto del comprobante
      await page.reload();
      await elegirTipo('Cobro');
      await subirFoto('comprobante.png', await foto('COMPROBANTE DE TRANSFERENCIA', [`Ref ${STAMP}`, 'Monto Q 500.00']));
      const opcion = page.getByLabel('Factura que se cobra').locator('option', { hasText: noFactura });
      await page.getByLabel('Factura que se cobra').selectOption({ value: (await opcion.getAttribute('value'))! });
      await page.getByLabel('Monto cobrado').fill('500');
      await page.getByLabel('Referencia (opcional)').fill(`REF-${STAMP}`);
      await page.getByRole('button', { name: 'Registrar cobro' }).click();
      const st2 = await page.getByRole('status').first().innerText({ timeout: 60_000 });
      ok(/Cobro de Q500\.00 registrado/.test(st2) && /Saldo: Q620\.00/.test(st2), `cobro: "${st2.slice(0, 100)}"`);
      const { data: cobros } = await sb.from('cobros_clientes').select('id, monto_cobrado, constancia_url').eq('referencia', `REF-${STAMP}`);
      for (const c of cobros ?? []) creados.push(['cobros_clientes', String(c.id)]);
      ok((cobros ?? []).length === 1 && Number(cobros![0].monto_cobrado) === 500, `cobro en la base: Q${cobros?.[0]?.monto_cobrado}`);
      await verArchivo(cobros?.[0]?.constancia_url, 'cobro (constancia)');

      // 3) Gasto: la foto la lee Gemini y queda en la bandeja Pendiente
      await page.reload();
      await elegirTipo('Gasto');
      const numero = String(100000000 + Math.floor(Math.random() * 899999999));
      const emision = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
      await subirFoto('gasto.png', await foto('FACTURA ELECTRÓNICA EN LÍNEA (FEL) — DTE', [
        'Emisor: PAPELERÍA PRUEBA E2E, SOCIEDAD ANÓNIMA', 'NIT emisor: 1234567-8', `Serie: E2E${STAMP.slice(-4).toUpperCase()}   Número: ${numero}`,
        `Fecha de emisión: ${emision}`, 'Receptor: HIGH IMPACT TALENT, S.A.   NIT: 9876543-2', 'Descripción: Resmas de papel bond (5 unidades)',
        'Subtotal: Q 100.00', 'IVA (12%): Q 12.00', '<b>TOTAL: Q 112.00</b>', 'Moneda: GTQ',
      ]));
      await page.getByRole('button', { name: 'Enviar a la bandeja' }).click();
      const st3 = await page.getByRole('status').first().innerText({ timeout: 120_000 });
      ok(/Gasto recibido/.test(st3) && /pendiente de revisión/.test(st3), `gasto: "${st3.slice(0, 110)}"`);
      const { data: fin } = await sb.from('facturas_in').select('id, estado, total, archivo_url, subido_por').eq('subido_por', email);
      for (const x of fin ?? []) creados.push(['facturas_in', String(x.id)]);
      ok((fin ?? []).length === 1 && fin![0].estado === 'Pendiente' && Number(fin![0].total) === 112, `gasto en la bandeja: estado ${fin?.[0]?.estado}, total Q${fin?.[0]?.total}, subido por el auxiliar`);
      await verArchivo(fin?.[0]?.archivo_url, 'gasto');
      await page.screenshot({ path: path.join(SHOTS, 'captura-gasto-ok.png') });
      ok((await desborde()) <= 1, 'captura sin scroll horizontal');

      // El auxiliar captura pero no aprueba.
      await page.goto(`${BASE}/gastos`);
      await page.waitForLoadState('domcontentloaded');
      ok(/no-acceso/.test(page.url()), `${ROL} no entra a la bandeja de aprobación (/gastos → ${new URL(page.url()).pathname})`);
      ok(erroresConsola.length === 0, `sin errores de JavaScript${erroresConsola.length ? `: ${erroresConsola[0]}` : ''}`);
    }
  } catch (e) {
    ok(false, `error: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
  } finally {
    await ctx.close().catch(() => null);
    fs.rmSync(perfil, { recursive: true, force: true });
    if (userId) await clerk.users.deleteUser(userId).catch(() => null);
    if (creados.length || urlsStorage.length) {
      for (const t of ['cobros_clientes', 'facturas_clientes', 'facturas_in', 'clientes', 'bancos']) {
        const ids = creados.filter(([x]) => x === t).map(([, id]) => id);
        if (ids.length) { const { error } = await sb.from(t).delete().in('id', ids); if (error) console.log(`     ✗ ${t}: ${error.message}`); }
      }
      const paths = urlsStorage.map(u => decodeURIComponent(u.split('/object/public/adjuntos/')[1] ?? '')).filter(Boolean);
      if (paths.length) await sb.storage.from('adjuntos').remove(paths);
      const restos = await Promise.all([
        sb.from('facturas_clientes').select('id', { count: 'exact', head: true }).like('no_factura', `${TAG}%`),
        sb.from('clientes').select('id', { count: 'exact', head: true }).like('razon_social', `${TAG}%`),
        sb.from('bancos').select('id', { count: 'exact', head: true }).like('nombre_cuenta', `${TAG}%`),
        sb.from('facturas_in').select('id', { count: 'exact', head: true }).eq('subido_por', email),
        sb.from('cobros_clientes').select('id', { count: 'exact', head: true }).like('referencia', `REF-${STAMP}%`),
      ]);
      const quedan = restos.reduce((s, r) => s + (r.count ?? 0), 0);
      // Se verifica contra la API de storage (la URL pública puede seguir respondiendo desde la caché del CDN).
      const siguen = await Promise.all(paths.map(async p => {
        const carpeta = p.slice(0, p.lastIndexOf('/')); const nombre = p.slice(p.lastIndexOf('/') + 1);
        const { data } = await sb.storage.from('adjuntos').list(carpeta, { search: nombre });
        return (data ?? []).some(o => o.name === nombre);
      }));
      ok(quedan === 0 && !siguen.some(Boolean) && paths.length === urlsStorage.length, `limpieza verificada: 0 filas de prueba y ${paths.length} archivo(s) borrados del storage`);
    }
    console.log(`  (usuario descartable borrado · capturas de pantalla en ${SHOTS})`);
    console.log(`\n== ${pass} 🟢 / ${fail} 🔴 ==\n`);
    process.exit(fail ? 1 : 0);
  }
})();
