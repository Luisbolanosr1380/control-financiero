/**
 * CENTRO DE COBROS · PR 2 (035) — E2E en Chrome sobre un `next start` (HIT, CORREO_MOCK=1) con los clientes que deja
 * `validate-cobranza-recordatorios.ts hit --conservar` (sbwCRE2E01: vencida, por vencer, promesa incumplida, paquete;
 * sbwCRE2E02: vencida bloqueada por disputa).
 *  1. Rol cobranza (390 px): la bandeja muestra «N recordatorios propuestos» → Recordatorios: KPIs, borradores por regla,
 *     el bloqueado con su aviso; «Enviar igual» deshabilitado hasta escribir el motivo → sale; «Omitir hasta» con motivo;
 *     «Ver / editar el correo» (el cuerpo trae {{estado_cuenta}}), editar el asunto y Enviar → «Enviado»; recargar: ya no
 *     se propone; seleccionar el que queda → «Enviar seleccionados (1)».
 *  2. Ficha: el historial trae los «Correo enviado»; «Enviar estado de cuenta» (modal con el saldo real Q4,500) → sale;
 *     el PDF del estado de cuenta carga con logo, la parcial a 1,500, sin la cobrada y con el paquete.
 *  3. Plantillas como cobranza: solo lectura (sin Guardar).
 *  4. Rol contador (1280 px): Recordatorios de todos; Plantillas: cambia los días de «por vencer» y el bloque «Datos para
 *     pagar», guarda, verifica y restaura.
 *
 * Uso: npx tsx scripts/e2e-cobranza-recordatorios.ts --env hit --base http://localhost:3012 --out /ruta/capturas
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ENV = arg('--env', 'hit');
const BASE = arg('--base', 'http://localhost:3012').replace(/\/$/, '');
const OUT = arg('--out', path.join(os.tmpdir(), 'e2e-cobranza-recordatorios'));
const CHROME = arg('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const APP1 = 'sbwCRE2E01', APP2 = 'sbwCRE2E02';
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
  const abrir = async (rol: 'cobranza' | 'contador', movil: boolean) => {
    const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cr-')), { executablePath: CHROME, headless: true, args: [`--user-agent=${UA}`], viewport: movil ? { width: 390, height: 844 } : { width: 1280, height: 900 }, deviceScaleFactor: movil ? 2 : 1, userAgent: UA, locale: 'es-GT', isMobile: movil, hasTouch: movil });
    const u = await clerk.users.createUser({ emailAddress: [`e2e.recordatorios.${rol}+${STAMP}@example.com`], password: `E2e-${STAMP}-${Math.random().toString(36).slice(2)}!Aa9`, firstName: 'E2E', lastName: rol, skipPasswordChecks: true, publicMetadata: { accesos: [{ empresa_slug: SLUG, rol }] } });
    usuarios.push(u.id);
    const ticket = (await clerk.signInTokens.createSignInToken({ userId: u.id, expiresInSeconds: 600 })).token;
    const page = ctx.pages()[0] ?? await ctx.newPage();
    page.setDefaultTimeout(40_000);
    const errores: string[] = []; page.on('pageerror', e => errores.push(e.message));
    await page.goto(`${BASE}/sign-in`);
    await page.waitForFunction(() => (window as unknown as { Clerk?: { loaded?: boolean } }).Clerk?.loaded === true, null, { timeout: 30_000 });
    await page.evaluate(async (t) => { const C = (window as unknown as { Clerk: { client: { signIn: { create: (a: unknown) => Promise<{ createdSessionId: string }> } }; setActive: (a: unknown) => Promise<void> } }).Clerk; const si = await C.client.signIn.create({ strategy: 'ticket', ticket: t }); await C.setActive({ session: si.createdSessionId }); }, ticket);
    await page.waitForURL(u2 => !u2.pathname.startsWith('/sign-in'), { timeout: 20_000 }).catch(() => null);
    return { ctx, page, errores };
  };
  console.log(`\nE2E Recordatorios y estado de cuenta · ${ENV.toUpperCase()} · ${BASE}`);
  let cob: Awaited<ReturnType<typeof abrir>> | null = null, con: Awaited<ReturnType<typeof abrir>> | null = null;
  try {
    cob = await abrir('cobranza', true);
    const { page, errores } = cob;
    ok(true, `sesión real de Clerk para usuario descartable rol cobranza en ${SLUG} (390 px)`);
    // ── 1. bandeja → recordatorios ──
    await page.goto(`${BASE}/cobranza`);
    await page.waitForSelector('[data-recordatorios-propuestos]');
    const nBandeja = Number(await page.getAttribute('[data-recordatorios-propuestos]', 'data-recordatorios-propuestos'));
    await page.click('[data-accion="ver-recordatorios"]');
    await page.waitForURL(u => u.pathname === '/cobranza/recordatorios');
    await page.waitForSelector('[data-lista-recordatorios]');
    const r1 = await page.evaluate(({ a1, a2 }) => ({
      ancho: document.documentElement.scrollWidth, vp: window.innerWidth, kpis: document.querySelectorAll('[data-kpis] [data-kpi]').length, n: Number(document.querySelector('[data-recordatorios]')?.getAttribute('data-recordatorios')),
      reglas1: [...document.querySelectorAll(`[data-borrador][data-cliente="${a1}"]`)].map(e => e.getAttribute('data-regla')).sort(), bloq2: document.querySelector(`[data-borrador][data-cliente="${a2}"]`)?.getAttribute('data-bloqueo'), badgeBloq: !!document.querySelector(`[data-borrador][data-cliente="${a2}"] [data-badge-bloqueo]`), detalle: document.querySelector(`[data-borrador][data-cliente="${a2}"] [data-bloqueo-detalle]`)?.textContent ?? '',
      enviarDesh: (document.querySelector(`[data-borrador][data-cliente="${a2}"] [data-accion="enviar"]`) as HTMLButtonElement | null)?.disabled,
    }), { a1: APP1, a2: APP2 });
    ok(nBandeja >= 4 && r1.ancho <= r1.vp + 1 && r1.kpis === 4 && r1.n === nBandeja && r1.reglas1.join() === 'por_vencer,promesa_incumplida,vencida' && r1.bloq2 === 'disputa' && r1.badgeBloq && /disputa/.test(r1.detalle) && r1.enviarDesh === true, `bandeja: «${nBandeja} recordatorios propuestos» → pantalla a 390 px sin desplazamiento (${r1.ancho} ≤ ${r1.vp}), 4 KPIs, ${r1.n} borradores; ${APP1}: ${r1.reglas1.join(' + ')}; ${APP2} bloqueado por disputa con el aviso y «Enviar igual» deshabilitado`);
    await page.screenshot({ path: path.join(OUT, 'recordatorios-390.png'), fullPage: true });
    // bloqueado: motivo → sale
    await page.fill(`[data-borrador][data-cliente="${APP2}"] [data-campo="forzar-motivo"]`, 'el cliente pidió el recordatorio igual');
    await page.click(`[data-borrador][data-cliente="${APP2}"] [data-accion="enviar"]`);
    await page.waitForSelector(`[data-borrador][data-cliente="${APP2}"] [data-badge-enviado]`);
    const det2 = await page.textContent(`[data-borrador][data-cliente="${APP2}"] [data-detalle-envio]`);
    ok(/modo prueba|Enviado/.test(det2 ?? ''), `bloqueado por disputa: con el motivo escrito «Enviar igual» manda y queda «Enviado» (${(det2 ?? '').slice(0, 70)})`);
    // omitir la promesa incumplida
    await page.click(`[data-borrador][data-cliente="${APP1}"][data-regla="promesa_incumplida"] [data-accion="omitir"]`);
    await page.waitForSelector('[data-form-omitir]');
    await page.fill('[data-form-omitir] [data-campo="omitir-motivo"]', 'ya hablé con Andrea, paga el viernes');
    await page.click('[data-form-omitir] [data-accion="confirmar-omitir"]');
    await page.waitForFunction((a1) => !document.querySelector(`[data-borrador][data-cliente="${a1}"][data-regla="promesa_incumplida"][data-omitido="false"]`), APP1, { timeout: 30_000 });
    // ver / editar el correo de la vencida y enviar
    await page.click(`[data-borrador][data-cliente="${APP1}"][data-regla="vencida"] [data-accion="ver-correo"]`);
    await page.waitForSelector(`[data-borrador][data-cliente="${APP1}"][data-regla="vencida"] [data-correo-abierto]`);
    const cuerpo = await page.inputValue(`[data-borrador][data-cliente="${APP1}"][data-regla="vencida"] [data-campo="cuerpo"]`);
    const asunto = await page.inputValue(`[data-borrador][data-cliente="${APP1}"][data-regla="vencida"] [data-campo="asunto"]`);
    await page.fill(`[data-borrador][data-cliente="${APP1}"][data-regla="vencida"] [data-campo="asunto"]`, `${asunto} (E2E)`);
    await page.screenshot({ path: path.join(OUT, 'recordatorio-editar-390.png'), fullPage: true });
    await page.click(`[data-borrador][data-cliente="${APP1}"][data-regla="vencida"] [data-accion="enviar"]`);
    await page.waitForSelector(`[data-borrador][data-cliente="${APP1}"][data-regla="vencida"] [data-badge-enviado]`);
    ok(/\{\{estado_cuenta\}\}/.test(cuerpo) && /Estimado\/a Andrea Blanco/.test(cuerpo) && /Datos para pagar/.test(cuerpo) && /CR-E2E-001/.test(asunto), `«Ver / editar el correo»: el cuerpo trae el saludo a la preferida, {{estado_cuenta}} como marcador y los datos para pagar; asunto «${asunto}» editado y enviado`);
    await page.reload();
    await page.waitForSelector('[data-lista-recordatorios]');
    const r2 = await page.evaluate((a1) => ({ vivos: [...document.querySelectorAll(`[data-borrador][data-cliente="${a1}"]`)].map(e => e.getAttribute('data-regla')), omitidos: !!document.querySelector('[data-accion="ver-omitidos"]') }), APP1);
    ok(r2.vivos.join() === 'por_vencer' && r2.omitidos, `al recargar: la vencida enviada y la promesa omitida ya no se proponen; queda «por vencer» (${r2.vivos.join(', ')}) y el botón «ver omitidos»`);
    // seleccionar y enviar seleccionados
    await page.check(`[data-borrador][data-cliente="${APP1}"][data-regla="por_vencer"] [data-sel]`);
    const txtSel = await page.textContent('[data-accion="enviar-seleccionados"]');
    await page.click('[data-accion="enviar-seleccionados"]');
    await page.waitForSelector(`[data-borrador][data-cliente="${APP1}"][data-regla="por_vencer"] [data-badge-enviado]`);
    ok(/\(1\)/.test(txtSel ?? ''), `«Enviar seleccionados (1)» manda el marcado y queda «Enviado»`);
    await page.reload(); await page.waitForSelector('[data-lista-recordatorios]');
    const r3 = await page.evaluate((a1) => document.querySelectorAll(`[data-borrador][data-cliente="${a1}"][data-omitido="false"]`).length, APP1);
    ok(r3 === 0, `${APP1} ya no tiene borradores vivos (${r3})`);
    // ── 2. ficha: historial + enviar estado de cuenta + PDF ──
    await page.goto(`${BASE}/cobranza/${APP1}`);
    await page.waitForSelector('[data-ficha-cobranza]');
    const f1 = await page.evaluate(() => ({ correos: document.querySelectorAll('[data-lista-historial] [data-evento="correo_enviado"]').length, btn: !!document.querySelector('[data-accion="enviar-estado-cuenta"]'), pdf: document.querySelector('[data-accion="estado-cuenta-pdf"]')?.getAttribute('href') ?? '' }));
    await page.click('[data-accion="enviar-estado-cuenta"]');
    await page.waitForSelector('[data-estado-cuenta-enviar] [data-ec-resumen]');
    const ecTxt = await page.textContent('[data-estado-cuenta-enviar] [data-ec-resumen]');
    await page.screenshot({ path: path.join(OUT, 'estado-cuenta-enviar-390.png'), fullPage: true });
    await page.click('[data-accion="confirmar-enviar-ec"]');
    await page.waitForSelector('[data-estado-cuenta-enviar]', { state: 'detached', timeout: 30_000 });
    await page.waitForTimeout(1500);
    await page.reload(); await page.waitForSelector('[data-ficha-cobranza]');
    const f2 = await page.evaluate(() => document.querySelectorAll('[data-lista-historial] [data-evento="correo_enviado"]').length);
    ok(f1.correos >= 2 && f1.btn && /estado-cuenta/.test(f1.pdf) && /4,500/.test(ecTxt ?? '') && /PAQ-/.test(ecTxt ?? '') && f2 === f1.correos + 1, `ficha: ${f1.correos} «Correo enviado» en el historial; «Enviar estado de cuenta» abre el modal con saldo real Q4,500 y el paquete; al enviar queda otro evento (${f2})`);
    const pdf = await page.request.get(`${BASE}${f1.pdf}`);
    const html = await pdf.text();
    ok(pdf.status() === 200 && /data-estado-cuenta="3"/.test(html) && /data-logo/.test(html) && /CR-E2E-003/.test(html) && /1,500/.test(html) && !/CR-E2E-004/.test(html) && /data-paquetes="1"/.test(html) && /data-datos-pago/.test(html), 'estado de cuenta (PDF): 200 con logo, 3 facturas abiertas, la parcial a Q1,500 (cobro y NC descontados), sin la cobrada, el paquete y los datos para pagar');
    // ── 3. plantillas como cobranza: solo lectura ──
    await page.goto(`${BASE}/cobranza/plantillas`);
    await page.waitForSelector('[data-plantillas]');
    const p1 = await page.evaluate(() => ({ puede: document.querySelector('[data-plantillas]')?.getAttribute('data-puede-editar'), guardar: document.querySelectorAll('[data-accion="guardar-plantilla"], [data-accion="guardar-regla"]').length, ancho: document.documentElement.scrollWidth, vp: window.innerWidth }));
    ok(p1.puede === 'false' && p1.guardar === 0 && p1.ancho <= p1.vp + 1, 'plantillas como cobranza: solo lectura (sin botones Guardar), 390 px sin desplazamiento');
    ok(errores.length === 0, `sin errores JS (cobranza)${errores.length ? ': ' + errores.join(' | ') : ''}`);
    // ── 4. contador a 1280 px ──
    con = await abrir('contador', false);
    const pc = con.page;
    await pc.goto(`${BASE}/cobranza/recordatorios?todos=1`);
    await pc.waitForSelector('[data-lista-recordatorios]');
    await pc.screenshot({ path: path.join(OUT, 'recordatorios-1280.png'), fullPage: true });
    await pc.goto(`${BASE}/cobranza/plantillas`);
    await pc.waitForSelector('[data-plantillas][data-puede-editar="true"]');
    await pc.fill('[data-regla="por_vencer"] [data-campo="dias"]', '4');
    await pc.click('[data-regla="por_vencer"] [data-accion="guardar-regla"]');
    await pc.waitForFunction(() => /vence en 4 días/.test(document.querySelector('[data-regla="por_vencer"] [data-explicacion]')?.textContent ?? ''), null, { timeout: 30_000 });
    await pc.reload(); await pc.waitForSelector('[data-plantillas]');
    const dias4 = await pc.inputValue('[data-regla="por_vencer"] [data-campo="dias"]');
    await pc.fill('[data-regla="por_vencer"] [data-campo="dias"]', '3');
    await pc.click('[data-regla="por_vencer"] [data-accion="guardar-regla"]');
    await pc.waitForFunction(() => /vence en 3 días/.test(document.querySelector('[data-regla="por_vencer"] [data-explicacion]')?.textContent ?? ''), null, { timeout: 30_000 });
    const cuerpoDP = await pc.inputValue('[data-plantilla="datos_pago"] [data-campo="cuerpo"]');
    await pc.fill('[data-plantilla="datos_pago"] [data-campo="cuerpo"]', `${cuerpoDP} · Banco E2E cuenta 000`);
    await pc.click('[data-plantilla="datos_pago"] [data-accion="guardar-plantilla"]');
    await pc.waitForTimeout(1500);
    await pc.reload(); await pc.waitForSelector('[data-plantillas]');
    const cuerpoDP2 = await pc.inputValue('[data-plantilla="datos_pago"] [data-campo="cuerpo"]');
    await pc.screenshot({ path: path.join(OUT, 'plantillas-1280.png'), fullPage: true });
    await pc.fill('[data-plantilla="datos_pago"] [data-campo="cuerpo"]', cuerpoDP);
    await pc.click('[data-plantilla="datos_pago"] [data-accion="guardar-plantilla"]');
    await pc.waitForTimeout(1500);
    await pc.reload(); await pc.waitForSelector('[data-plantillas]');
    const cuerpoDP3 = await pc.inputValue('[data-plantilla="datos_pago"] [data-campo="cuerpo"]');
    const dias3 = await pc.inputValue('[data-regla="por_vencer"] [data-campo="dias"]');
    ok(dias4 === '4' && dias3 === '3' && /Banco E2E cuenta 000/.test(cuerpoDP2) && cuerpoDP3 === cuerpoDP, 'contador edita la regla «por vencer» (3 → 4 → 3 días) y el bloque «Datos para pagar» (se guarda, se ve al recargar y se restaura)');
    ok(con.errores.length === 0, `sin errores JS (contador)${con.errores.length ? ': ' + con.errores.join(' | ') : ''}`);
  } finally {
    await cob?.ctx.close().catch(() => null); await con?.ctx.close().catch(() => null);
    for (const id of usuarios) await clerk.users.deleteUser(id).catch(() => null);
    console.log(`  (${usuarios.length} usuarios descartables borrados)`);
  }
  console.log(`\n${pass} 🟢 / ${fail} 🔴`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
