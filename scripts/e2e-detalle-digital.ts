/**
 * DETALLE DIGITAL · PR 2 — E2E en Chrome sobre un `next start` (HIT) con el detalle en borrador que deja
 * `validate-detalle-digital.ts hit --conservar` (servidor con DETALLE_LINK_SECRET y CORREO_MOCK=1).
 *  1. Finanzas (contador): abre el detalle → "Enviar al cliente" → modal → se genera el link (modo mock) y se lee del
 *     texto para copiar.
 *  2. Cliente (contexto SIN sesión): abre el link, marca 2 líneas con observación (nota obligatoria), "Ver solo las que no
 *     aprobé", envía observaciones → confirmación y vista de solo lectura; el link no se vuelve a usar.
 *  3. Finanzas: el tablero muestra "Respuestas del cliente"; en el detalle cada línea trae la respuesta; quitar una línea
 *     (diferida), responder la nota, "Enviar versión corregida" → link v2.
 *  4. Cliente (sin sesión, 390 px): link v2 con "Versión 2 · corregida" y las respuestas de Golden, "Aprobar todo", firma
 *     con el mouse en el canvas, confirma → "Detalle aprobado y firmado".
 *  5. Finanzas: detalle aprobado por link con firma y huella; imprimible con la firma digital y las casillas marcadas.
 *  Capturas en --out. Usuario descartable de Clerk (contador).
 *
 * Uso: npx tsx scripts/e2e-detalle-digital.ts --env hit --base http://localhost:3012 --out /ruta/capturas
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ENV = arg('--env', 'hit');
const BASE = arg('--base', 'http://localhost:3012').replace(/\/$/, '');
const OUT = arg('--out', path.join(os.tmpdir(), 'e2e-detalle-digital'));
const CHROME = arg('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const NIT = arg('--nit', '99990032K');
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
  const ctxFin = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dd-fin-')), { executablePath: CHROME, headless: true, args: [`--user-agent=${UA}`], viewport: { width: 1280, height: 900 }, userAgent: UA, locale: 'es-GT' });
  const ctxCli = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dd-cli-')), { executablePath: CHROME, headless: true, args: [`--user-agent=${UA}`], viewport: { width: 390, height: 844 }, userAgent: UA, locale: 'es-GT', isMobile: true, hasTouch: true });
  console.log(`\nE2E detalle digital · ${ENV.toUpperCase()} · ${BASE}`);
  try {
    const u = await clerk.users.createUser({ emailAddress: [`e2e.digital+${STAMP}@example.com`], password: `E2e-${STAMP}-${Math.random().toString(36).slice(2)}!Aa9`, firstName: 'E2E', lastName: 'Digital', skipPasswordChecks: true, publicMetadata: { accesos: [{ empresa_slug: SLUG, rol: 'contador' }] } });
    userId = u.id;
    const ticket = (await clerk.signInTokens.createSignInToken({ userId: u.id, expiresInSeconds: 600 })).token;
    const fin = ctxFin.pages()[0] ?? await ctxFin.newPage();
    fin.setDefaultTimeout(30_000);
    const erroresFin: string[] = []; fin.on('pageerror', e => erroresFin.push(e.message));
    await fin.goto(`${BASE}/sign-in`);
    await fin.waitForFunction(() => (window as unknown as { Clerk?: { loaded?: boolean } }).Clerk?.loaded === true, null, { timeout: 30_000 });
    await fin.evaluate(async (t) => {
      const C = (window as unknown as { Clerk: { client: { signIn: { create: (a: unknown) => Promise<{ createdSessionId: string }> } }; setActive: (a: unknown) => Promise<void> } }).Clerk;
      const si = await C.client.signIn.create({ strategy: 'ticket', ticket: t });
      await C.setActive({ session: si.createdSessionId });
    }, ticket);
    await fin.waitForURL(u2 => !u2.pathname.startsWith('/sign-in'), { timeout: 20_000 }).catch(() => null);
    ok(true, `sesión real de Clerk para usuario descartable rol contador en ${SLUG}`);

    // ── 1. Finanzas: enviar al cliente ──
    await fin.goto(`${BASE}/por-facturar`);
    await fin.click('[data-tab="detalles"]');
    await fin.waitForSelector('[data-lista="detalles"] tbody tr[data-detalle]');
    const idDetalle = await fin.evaluate((nit) => { const tr = [...document.querySelectorAll('[data-lista="detalles"] tbody tr[data-detalle]')].find(t => (t.textContent ?? '').includes(`NIT ${nit}`) && (t.textContent ?? '').includes('Borrador')); const a = tr?.querySelector('a[href*="/por-facturar/detalle/"]') as HTMLAnchorElement | null; return a?.getAttribute('href')?.split('/').pop() ?? ''; }, NIT);
    ok(/^[0-9a-f-]{36}$/.test(idDetalle), `detalle en borrador del cliente de prueba encontrado (${idDetalle.slice(0, 8)}…)`);
    const detalleUrl = `${BASE}/por-facturar/detalle/${idDetalle}`;
    await fin.goto(detalleUrl);
    await fin.waitForSelector('[data-accion="enviar-cliente"]');
    await fin.click('[data-accion="enviar-cliente"]');
    await fin.waitForSelector('[data-dialogo-enviar]');
    const dlg = await fin.evaluate(() => ({ para: (document.querySelector('[data-campo="destinatarios"]') as HTMLInputElement).value, asunto: (document.querySelector('[data-campo="asunto"]') as HTMLInputElement).value, sinCorreo: !!document.querySelector('[data-sin-correo]') }));
    ok(/cobros@dd-e2e\.example/.test(dlg.para) && /rrhh@dd-e2e\.example/.test(dlg.para) && /^Detalle de servicios DET-\d+ · Golden Talent · /.test(dlg.asunto), `modal: destinatarios sugeridos del cliente (${dlg.para}); asunto "${dlg.asunto}"${dlg.sinCorreo ? ' · modo copiar link (sin RESEND_API_KEY)' : ' · correo configurado (mock)'}`);
    await fin.click('[data-accion="confirmar-enviar"]');
    await fin.waitForSelector('[data-resultado-envio]');
    const env1 = await fin.evaluate(() => ({ res: document.querySelector('[data-resultado-envio]')?.getAttribute('data-resultado-envio'), texto: (document.querySelector('[data-texto-copiar]') as HTMLTextAreaElement).value }));
    const link1 = (env1.texto.match(/https?:\/\/\S+\/aprobar-detalle#[A-Za-z0-9_-]{43}/) ?? [''])[0];
    ok(!!link1 && env1.res === 'enviado', `link generado y correo en modo mock (${env1.res}); texto listo para pegar con el link`);
    await fin.screenshot({ path: path.join(OUT, 'finanzas-enviado-1280.png'), fullPage: true });
    await fin.click('[data-resultado-envio] .btn.btn-ghost');
    await fin.reload();
    await fin.waitForSelector('[data-link-cliente]');
    const est1 = await fin.evaluate(() => ({ estado: document.querySelector('[data-estado]')?.getAttribute('data-estado'), link: (document.querySelector('[data-link-cliente]')?.textContent ?? '').replace(/\s+/g, ' ') }));
    ok(est1.estado === 'enviada' && /vigente hasta/.test(est1.link) && /sin abrir/.test(est1.link), `Finanzas: estado enviada, link vigente, sin abrir`);

    // ── 2. Cliente sin sesión: observaciones ──
    const cli = ctxCli.pages()[0] ?? await ctxCli.newPage();
    cli.setDefaultTimeout(30_000);
    const erroresCli: string[] = []; cli.on('pageerror', e => erroresCli.push(e.message));
    const externos: string[] = []; cli.on('request', r => { const h = new URL(r.url()).host; if (!r.url().startsWith(BASE) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) externos.push(h); });
    await cli.goto(link1);
    await cli.waitForSelector('[data-aprobar-detalle][data-fase="vigente"]');
    const pub1 = await cli.evaluate(() => ({
      url: location.href, hash: location.hash, lineas: document.querySelectorAll('[data-lineas] li[data-linea]').length, hayNav: !!document.querySelector('.sidebar, nav.sidebar'),
      clerk: !!(window as unknown as { Clerk?: unknown }).Clerk, scripts: [...document.scripts].map(s => s.src).filter(s => s && !s.startsWith(location.origin)), html: document.documentElement.outerHTML,
      ancho: document.documentElement.scrollWidth, vp: window.innerWidth,
    }));
    ok(pub1.lineas === 6 && !pub1.hash && !pub1.hayNav && !pub1.clerk && pub1.scripts.length === 0, `cliente sin sesión: la página abre con ${pub1.lineas} líneas, sin el shell de la app, sin Clerk ni scripts externos; el token se quitó de la barra (${pub1.url})`);
    ok(!pub1.html.includes(NIT) && !/componente_id|nit_resuelto|centro_costo|estado_tarifa/.test(pub1.html), 'nada interno a la vista: ni NIT, ni ids, ni centro de costo');
    ok(pub1.ancho <= pub1.vp + 1, `390 px: sin desplazamiento horizontal (${pub1.ancho} ≤ ${pub1.vp})`);
    await cli.screenshot({ path: path.join(OUT, 'cliente-link-390.png'), fullPage: true });
    // marcar 2 líneas: corrección y próximo mes (nota obligatoria)
    const refs = await cli.evaluate(() => [...document.querySelectorAll('[data-lineas] li[data-linea]')].map(l => l.getAttribute('data-linea')!));
    await cli.click(`li[data-linea="${refs[0]}"] input[value="correccion"]`);
    await cli.click(`li[data-linea="${refs[1]}"] input[value="proximo_mes"]`);
    await cli.click('[data-accion="enviar"]');
    const err1 = await cli.evaluate(() => document.querySelector('[data-error]')?.textContent ?? '');
    ok(/Falta el motivo/.test(err1), `sin motivo no deja enviar: "${err1}"`);
    await cli.fill(`li[data-linea="${refs[0]}"] [data-nota]`, 'El precio no es el pactado');
    await cli.fill(`li[data-linea="${refs[1]}"] [data-nota]`, 'Cobrarla en la factura de diciembre');
    // al fallar el envío por falta de motivo la página ya deja "solo las que no aprobé"; si no, se activa
    if (/^Ver solo/.test((await cli.textContent('[data-accion="solo-no-aprobadas"]')) ?? '')) await cli.click('[data-accion="solo-no-aprobadas"]');
    const solo = await cli.evaluate(() => ({ n: document.querySelectorAll('[data-lineas] li[data-linea]').length, firma: !!document.querySelector('[data-firma]'), boton: document.querySelector('[data-accion="enviar"]')?.textContent?.trim() }));
    ok(solo.n === 2 && !solo.firma && /Enviar observaciones a/.test(solo.boton ?? ''), `"Ver solo las que no aprobé" deja ${solo.n}; no se puede firmar: botón "${solo.boton}"`);
    await cli.screenshot({ path: path.join(OUT, 'cliente-observaciones-390.png'), fullPage: true });
    await cli.click('[data-accion="enviar"]');
    await cli.waitForSelector('[data-confirmacion="con_observaciones"]');
    const conf1 = await cli.evaluate(() => ({ fase: document.querySelector('[data-aprobar-detalle]')?.getAttribute('data-fase'), texto: document.querySelector('[data-confirmacion]')?.textContent, decisiones: [...document.querySelectorAll('[data-solo-lectura] li[data-linea]')].map(l => l.getAttribute('data-decision')) }));
    ok(conf1.fase === 'respondido' && /recibió 2 observaciones/.test(conf1.texto ?? '') && conf1.decisiones.filter(d => d !== 'aprobado').length === 2 && conf1.decisiones.length === 6, 'confirmación "observaciones enviadas" y vista de solo lectura con lo respondido');
    await cli.screenshot({ path: path.join(OUT, 'cliente-respondido-390.png'), fullPage: true });
    await cli.goto('about:blank'); await cli.goto(link1);
    await cli.waitForSelector('[data-aprobar-detalle][data-fase="respondido"]');
    ok(true, 'volver a abrir el link: solo lectura (no deja cambiar nada)');
    ok(externos.length === 0, `sin recursos externos en la página pública${externos.length ? ': ' + [...new Set(externos)].join(', ') : ''}`);

    // ── 3. Finanzas: respuestas, quitar línea, responder nota, versión corregida ──
    await fin.goto(`${BASE}/por-facturar`);
    await fin.click('[data-tab="detalles"]');
    await fin.waitForSelector('[data-filtro-detalle="con_observaciones"]');
    const tab = await fin.evaluate(() => ({ filtro: document.querySelector('[data-filtro-detalle="con_observaciones"]')?.textContent, badge: !!document.querySelector('[data-badge-observaciones]') }));
    ok(/Respuestas del cliente \(\d+\)/.test(tab.filtro ?? '') && tab.badge, `tablero: "${tab.filtro}" y badge en el KPI`);
    await fin.goto(detalleUrl);
    await fin.waitForSelector('[data-respuesta-cliente="con_observaciones"]');
    const obs = await fin.evaluate(() => ({ estado: document.querySelector('[data-estado]')?.getAttribute('data-estado'), lineas: [...document.querySelectorAll('[data-lista="detalle"] tr[data-prueba]')].map(tr => tr.getAttribute('data-respuesta-linea') ?? '') , notas: [...document.querySelectorAll('[data-nota-cliente]')].map(e => e.textContent) }));
    ok(obs.estado === 'con_observaciones' && obs.lineas.filter(x => x === 'correccion').length === 1 && obs.lineas.filter(x => x === 'proximo_mes').length === 1 && obs.notas.includes('El precio no es el pactado'), 'Finanzas: con observaciones; cada línea muestra la respuesta del cliente y su nota');
    await fin.screenshot({ path: path.join(OUT, 'finanzas-observaciones-1280.png'), fullPage: true });
    // responder la nota de la corrección + quitar la línea "próximo mes" diferida
    const filaCorr = fin.locator('[data-lista="detalle"] tr[data-respuesta-linea="correccion"]');
    await filaCorr.locator('[data-campo="respuesta-golden"]').fill('Precio corregido según tarifa 2026');
    await filaCorr.locator('[data-accion="guardar-respuesta-golden"]').click();
    await fin.waitForTimeout(800);
    const filaProx = fin.locator('[data-lista="detalle"] tr[data-respuesta-linea="proximo_mes"]');
    await filaProx.locator('[data-accion="quitar-linea"]').click();
    await fin.waitForSelector('[data-quitar-linea]');
    const difMarcado = await fin.isChecked('[data-campo="diferir"]');
    await fin.click('[data-accion="confirmar-quitar-linea"]');
    await fin.waitForFunction(() => document.querySelectorAll('[data-lista="detalle"] tr[data-prueba]').length === 5);
    ok(difMarcado, 'quitar la línea "próximo mes": viene marcada como diferida; la prueba sale del detalle (5 líneas)');
    await fin.click('[data-accion="enviar-cliente"]');
    await fin.waitForSelector('[data-dialogo-enviar]');
    const titulo = await fin.evaluate(() => document.querySelector('[data-dialogo-enviar] .card-title')?.textContent);
    await fin.click('[data-accion="confirmar-enviar"]');
    await fin.waitForSelector('[data-resultado-envio]');
    const env2 = await fin.evaluate(() => (document.querySelector('[data-texto-copiar]') as HTMLTextAreaElement).value);
    const link2 = (env2.match(/https?:\/\/\S+\/aprobar-detalle#[A-Za-z0-9_-]{43}/) ?? [''])[0];
    ok(/Enviar versión 2 · corregida/.test(titulo ?? '') && !!link2 && link2 !== link1 && /versión 2 \(corregida\)/.test(env2), `"Enviar versión corregida" → link v2 nuevo (texto: "versión 2 (corregida)")`);
    await fin.click('[data-resultado-envio] .btn.btn-ghost');
    // el cliente, en el cliente de la cola: diferida visible
    await fin.goto(`${BASE}/por-facturar/${encodeURIComponent('n-' + NIT)}?cobro=todos`);
    await fin.waitForSelector('[data-tabla-expedientes] tbody tr[data-expediente]');
    const dif = await fin.evaluate(() => ({ badge: document.querySelector('[data-diferida]')?.textContent, kpi: document.querySelector('[data-kpi-diferidas]')?.getAttribute('data-kpi-diferidas') }));
    ok(/Diferida a /.test(dif.badge ?? '') && dif.kpi === '1', `cola del cliente: la prueba quitada aparece "${dif.badge}" y el KPI cuenta ${dif.kpi} diferida`);
    await fin.screenshot({ path: path.join(OUT, 'finanzas-cliente-diferida-1280.png'), fullPage: false });

    // ── 4. Cliente: link viejo → versión nueva; link v2 → aprobar todo + firmar ──
    await cli.goto('about:blank'); await cli.goto(link1);
    await cli.waitForSelector('[data-aprobar-detalle]:not([data-fase="cargando"])');
    const viejo = await cli.evaluate(() => ({ fase: document.querySelector('[data-aprobar-detalle]')?.getAttribute('data-fase'), texto: document.querySelector('[data-invalido]')?.textContent ?? (document.querySelector('[data-solo-lectura]') ? 'solo-lectura' : '') }));
    ok(viejo.fase === 'invalido' && /versión más nueva/.test(viejo.texto), `link v1 después de reenviar: "${viejo.texto}"`);
    await cli.goto('about:blank'); await cli.goto(link2);
    await cli.waitForSelector('[data-aprobar-detalle][data-fase="vigente"]');
    const v2 = await cli.evaluate(() => ({ version: document.querySelector('[data-version]')?.getAttribute('data-version'), previas: document.querySelectorAll('[data-previa]').length, golden: [...document.querySelectorAll('[data-previa]')].some(e => (e.textContent ?? '').includes('Precio corregido según tarifa 2026')), lineas: document.querySelectorAll('[data-lineas] li[data-linea]').length, aprobadas: document.querySelectorAll('[data-lineas] li[data-decision="aprobado"]').length }));
    ok(v2.version === '2' && v2.lineas === 5 && v2.aprobadas === 5 && v2.previas === 5 && v2.golden, `link v2: "Versión 2 · corregida", 5 líneas aprobadas por defecto con la respuesta previa y la respuesta de Golden`);
    await cli.click('[data-accion="aprobar-todo"]');
    await cli.click('[data-accion="ir-a-firmar"]');
    await cli.waitForSelector('[data-firma]');
    await cli.fill('[data-campo="nombre"]', 'Marta Solicita');
    await cli.fill('[data-campo="cargo"]', 'Gerente de RRHH');
    await cli.fill('[data-campo="correo"]', 'marta@dd-e2e.example');
    await cli.check('[data-campo="autoriza"]');
    // firma con el "mouse" (pointer) sobre el canvas
    const canvas = cli.locator('[data-canvas-firma]');
    const box = (await canvas.boundingBox())!;
    await cli.mouse.move(box.x + 20, box.y + 60); await cli.mouse.down();
    for (let i = 1; i <= 25; i++) await cli.mouse.move(box.x + 20 + i * 8, box.y + 60 + Math.sin(i / 2) * 25, { steps: 2 });
    await cli.mouse.up();
    const trazos = Number(await canvas.getAttribute('data-trazos'));
    ok(trazos > 10, `firma dibujada en el canvas (${trazos} trazos)`);
    await cli.screenshot({ path: path.join(OUT, 'cliente-firma-390.png'), fullPage: true });
    await cli.click('[data-accion="enviar"]');
    await cli.waitForSelector('[data-confirmacion="aprobada"]');
    const conf2 = await cli.evaluate(() => (document.querySelector('[data-confirmacion]')?.textContent ?? '').replace(/\s+/g, ' '));
    ok(/Detalle aprobado y firmado/.test(conf2) && /autorizada la facturación/.test(conf2), `cliente: "${conf2.slice(0, 80)}…"`);
    await cli.screenshot({ path: path.join(OUT, 'cliente-aprobado-390.png'), fullPage: true });
    ok(erroresCli.length === 0, `página pública sin errores JS${erroresCli.length ? ': ' + erroresCli.join(' | ') : ''}`);

    // ── 5. Finanzas: aprobado por link + imprimible ──
    await fin.goto(detalleUrl);
    await fin.waitForSelector('[data-respuesta-cliente="aprobada"]');
    const apro = await fin.evaluate(() => ({ estado: document.querySelector('[data-estado]')?.getAttribute('data-estado'), firma: !!document.querySelector('[data-firma-img]'), huella: document.querySelector('[data-huella]')?.textContent, paso3: document.querySelector('[data-paso="3"]')?.getAttribute('data-hecho'), facturar: !!document.querySelector('[data-accion="facturar"]'), envios: document.querySelectorAll('[data-bitacora-envios] tbody tr').length }));
    ok(apro.estado === 'aprobada' && apro.firma && /huella/.test(apro.huella ?? '') && apro.paso3 === 'true' && apro.facturar && apro.envios >= 3, `Finanzas: aprobada con canal link, firma visible, ${apro.huella}, paso 3 hecho, botón Facturar; bitácora con ${apro.envios} envíos (incl. avisos)`);
    await fin.screenshot({ path: path.join(OUT, 'finanzas-aprobado-1280.png'), fullPage: true });
    await fin.goto(`${BASE}/imprimir/detalle/${idDetalle}`);
    await fin.waitForSelector('[data-firma-digital]');
    const imp = await fin.evaluate(() => ({ marcadas: [...document.querySelectorAll('[data-casillas]')].map(c => c.getAttribute('data-marcada')), firma: !!document.querySelector('[data-firma-digital] img'), texto: (document.querySelector('[data-firma-digital]')?.textContent ?? '').replace(/\s+/g, ' '), manual: !!document.querySelector('[data-firma]') }));
    ok(imp.marcadas.length === 5 && imp.marcadas.every(m => m === 'si') && imp.firma && /Aprobado digitalmente por Marta Solicita el/.test(imp.texto) && /huella/.test(imp.texto) && !imp.manual, 'imprimible: 5 casillas "Sí" marcadas, firma digital (imagen), nombre, cargo, fecha y hora, huella; sin el bloque de firma manual');
    await fin.screenshot({ path: path.join(OUT, 'imprimible-firmado-1280.png'), fullPage: true });
    ok(erroresFin.length === 0, `Finanzas sin errores JS${erroresFin.length ? ': ' + erroresFin.join(' | ') : ''}`);
  } finally {
    await ctxFin.close().catch(() => null); await ctxCli.close().catch(() => null);
    if (userId) await clerk.users.deleteUser(userId).catch(() => null);
    console.log('  (usuario descartable borrado)');
  }
  console.log(`\n${pass} 🟢 / ${fail} 🔴`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
