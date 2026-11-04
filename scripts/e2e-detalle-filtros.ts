/**
 * DETALLE DIGITAL · PR 1 — E2E en Chrome sobre un `next start` con los datos de `validate-detalle-filtros.ts hit --conservar`.
 *  · Lista del cliente: filtros del corte por URL y por los selects (servicio / categoría / territorio / solicitante), COMPLETO
 *    con solo el polígrafo, "seleccionar todo" marca solo lo visible y cobrable, título propuesto, generar el detalle con título
 *    y "dirigido a" → el detalle los muestra (y se editan).
 *  · Imprimible: columnas Solicitante / Conforme (casillas) / Observaciones, letra 10.5 px, bloque de firma, título y
 *    "dirigido a"; en emulación de impresión (carta vertical) caben ≥ 30 líneas en la primera hoja; PDF generado.
 * Capturas en --out. Usuario descartable de Clerk (contador).
 *
 * Uso: npx tsx scripts/e2e-detalle-filtros.ts --env hit --base http://localhost:3012 --out /ruta/capturas
 *      (cada corrida crea detalles que reservan pruebas: volver a sembrar con `validate-detalle-filtros.ts hit --conservar` antes de repetirla)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ENV = arg('--env', 'hit');
const BASE = arg('--base', 'http://localhost:3012').replace(/\/$/, '');
const OUT = arg('--out', path.join(os.tmpdir(), 'e2e-detalle-filtros'));
const CHROME = arg('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const NIT = arg('--nit', '99990031K');
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
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-detalle-'));
  const ctx = await chromium.launchPersistentContext(perfil, { executablePath: CHROME, headless: true, args: [`--user-agent=${UA}`], viewport: { width: 1280, height: 900 }, userAgent: UA, locale: 'es-GT' });
  console.log(`\nE2E detalle · filtros + impresión · ${ENV.toUpperCase()} · ${BASE}`);
  try {
    const u = await clerk.users.createUser({ emailAddress: [`e2e.detalle+${STAMP}@example.com`], password: `E2e-${STAMP}-${Math.random().toString(36).slice(2)}!Aa9`, firstName: 'E2E', lastName: 'Detalle', skipPasswordChecks: true, publicMetadata: { accesos: [{ empresa_slug: SLUG, rol: 'contador' }] } });
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

    const grupo = `${BASE}/por-facturar/${encodeURIComponent('n-' + NIT)}`;
    /** Ir a la lista y esperar la hidratación (el select de solicitante refleja la URL; con '' espera cualquier render estable). */
    const irA = async (qs: string, solicitante: string) => {
      await page.goto(`${grupo}${qs}`);
      await page.waitForSelector('[data-filtros-corte]');
      await page.waitForFunction(v => (document.querySelector('[data-filtro="solicitante"]') as HTMLSelectElement | null)?.value === v, solicitante);
      await page.waitForTimeout(400);
    };
    const leer = () => page.evaluate(() => ({
      url: location.search,
      filas: [...document.querySelectorAll('[data-tabla-expedientes] tbody tr[data-expediente]')].map(tr => `${tr.getAttribute('data-expediente')}|${tr.querySelector('[data-servicio]')?.getAttribute('data-servicio') ?? ''}|${tr.getAttribute('data-situacion')}`),
      candidatos: Number(document.querySelector('[data-conteo-candidatos]')?.getAttribute('data-conteo-candidatos') ?? -1),
      selects: ['servicio', 'categoria', 'territorio', 'solicitante'].map(k => `${k}=${(document.querySelector(`[data-filtro="${k}"]`) as HTMLSelectElement | null)?.value ?? ''}`),
      opcionesSolicitante: [...document.querySelectorAll('[data-filtro="solicitante"] option')].map(o => o.textContent),
      tituloPropuesto: document.querySelector('[data-titulo-propuesto]')?.getAttribute('data-titulo-propuesto') ?? '',
    }));
    // ── filtros por URL ──
    await irA(`?servicio=POLIGRAFO&categoria=RUTINA&solicitante=${encodeURIComponent('ADELA CEBALLOS')}`, 'ADELA CEBALLOS');
    const r1 = await leer();
    ok(r1.selects.join() === 'servicio=POLIGRAFO,categoria=RUTINA,territorio=,solicitante=ADELA CEBALLOS' && r1.filas.length === 10 && r1.filas.every(f => f.includes('|POLIGRAFO|')) && r1.filas.filter(f => f.endsWith('|en_cola')).length === 9 && r1.filas.some(f => f.endsWith('|pendiente')), `filtros desde la URL: ${r1.filas.length} filas, todas POLIGRAFO (9 cobrables + 1 pendiente); del COMPLETO solo el polígrafo`);
    ok(r1.opcionesSolicitante.join('|') === 'Solicitante: todos|ADELA CEBALLOS|JOSE RUIZ|MARIA LOPEZ|Sin solicitante' && r1.tituloPropuesto === 'Polígrafos rutina · Solicitante ADELA CEBALLOS', `solicitantes del cliente (normalizados, "Sin solicitante" al final); título propuesto "${r1.tituloPropuesto}"`);
    await page.screenshot({ path: path.join(OUT, 'lista-filtros-1280.png'), fullPage: true });
    // ── cambiar un select → URL ──
    await page.selectOption('[data-filtro="solicitante"]', '__sin__');
    await page.waitForFunction(() => location.search.includes('solicitante=__sin__'));
    const r2 = await leer();
    ok(/servicio=POLIGRAFO/.test(r2.url) && /solicitante=__sin__/.test(r2.url) && r2.filas.length === 4 && r2.tituloPropuesto === 'Polígrafos rutina · Sin solicitante', `cambiar el solicitante a "Sin solicitante" escribe la URL (${r2.url}) y deja ${r2.filas.length} filas`);
    await page.selectOption('[data-filtro="solicitante"]', 'JOSE RUIZ');
    await page.selectOption('[data-filtro="servicio"]', 'SOCIOECONOMICO');
    await page.selectOption('[data-filtro="categoria"]', '');
    await page.waitForFunction(() => location.search.includes('servicio=SOCIOECONOMICO') && location.search.includes('solicitante=JOSE+RUIZ') && !location.search.includes('categoria='));
    const r3 = await leer();
    ok(r3.filas.length === 6 && r3.filas.every(f => f.includes('|SOCIOECONOMICO|')), `socios de JOSE RUIZ: ${r3.filas.length} filas (la "sin tarifa" es SOCIOECONOMICO VIRTUAL y no entra)`);
    // ── seleccionar todo lo visible y cobrable + generar con título y "dirigido a" ──
    await irA(`?servicio=POLIGRAFO&solicitante=${encodeURIComponent('JOSE RUIZ')}&termino=2026-10`, 'JOSE RUIZ');
    const r5 = await leer();
    await page.click('[data-tabla-expedientes] thead th.col-sel input[type="checkbox"]');
    const sel = await page.evaluate(() => ({ marcadas: document.querySelectorAll('[data-tabla-expedientes] tbody input[type="checkbox"]:checked').length, barra: (document.querySelector('[aria-label="Selección para el detalle"]')?.textContent ?? '').replace(/\s+/g, ' '), titulo: (document.querySelector('[data-campo="titulo"]') as HTMLInputElement | null)?.value ?? '' }));
    ok(r5.filas.length === 4 && sel.marcadas === 4 && /4 pruebas seleccionadas/.test(sel.barra) && /^Polígrafos · Solicitante JOSE RUIZ · Oct\.? 2026$/i.test(sel.titulo), `"seleccionar todo" marca las ${sel.marcadas} de ${r5.filas.length} visibles y cobrables; barra "${sel.barra.slice(0, 60)}"; título propuesto "${sel.titulo}"`);
    await page.fill('[data-campo="titulo"]', 'Polígrafos de José · Oct 2026');
    await page.fill('[data-campo="dirigido-a"]', 'José Ruiz');
    await page.click('[data-accion="generar-detalle"]');
    await page.waitForURL(u2 => /\/por-facturar\/detalle\/[0-9a-f-]{36}$/.test(u2.pathname), { timeout: 30_000 });
    await page.waitForSelector('[data-encabezado] [data-titulo]');
    const det = await page.evaluate(() => ({ url: location.pathname, titulo: document.querySelector('[data-encabezado] [data-titulo]')?.textContent?.trim(), dirigido: document.querySelector('[data-encabezado] [data-dirigido-a]')?.textContent?.trim(), lineas: document.querySelectorAll('[data-lista="detalle"] tbody tr[data-linea="incluida"]').length, solicitantes: [...document.querySelectorAll('[data-lista="detalle"] [data-solicitante]')].map(e => e.getAttribute('data-solicitante')) }));
    const detalleId = det.url.split('/').pop()!;
    ok(det.titulo === 'Polígrafos de José · Oct 2026' && det.dirigido === 'José Ruiz' && det.lineas === 4 && det.solicitantes.every(s => s === 'JOSE RUIZ'), `detalle generado (${detalleId.slice(0, 8)}…): título y "dirigido a" guardados; 4 líneas con solicitante`);
    // atrás desde el detalle → la lista vuelve con los filtros que tenía (viajan en la URL)
    await page.goBack();
    await page.waitForFunction(() => location.search.includes('solicitante=JOSE+RUIZ') || location.search.includes('solicitante=JOSE%20RUIZ'));
    await page.waitForFunction(() => (document.querySelector('[data-filtro="solicitante"]') as HTMLSelectElement | null)?.value === 'JOSE RUIZ');
    await page.waitForTimeout(400);
    const r4 = await leer();
    // las 4 pruebas quedaron reservadas en el detalle: salen de "por facturar" (0 candidatos), pero los filtros siguen puestos
    ok(r4.selects.includes('servicio=POLIGRAFO') && r4.selects.includes('solicitante=JOSE RUIZ') && r4.candidatos === 0, `volver atrás desde el detalle restaura los filtros desde la URL (${r4.url}); las 4 pruebas ya reservadas salen de "por facturar" (${r4.candidatos} candidatos)`);
    await page.goForward();
    await page.waitForSelector('[data-encabezado] [data-titulo]');
    // editar encabezado
    await page.click('[data-accion="editar-encabezado"]');
    await page.fill('[data-encabezado] [data-campo="titulo"]', 'Polígrafos de José · corregido');
    await page.click('[data-accion="guardar-encabezado"]');
    await page.waitForFunction(() => document.querySelector('[data-encabezado] [data-titulo]')?.textContent?.includes('corregido'));
    ok(true, 'el título se edita desde el detalle');
    await page.screenshot({ path: path.join(OUT, 'detalle-1280.png'), fullPage: true });

    // ── imprimible: un detalle grande (≥ 30 líneas) ──
    await irA(`?solicitante=${encodeURIComponent('ADELA CEBALLOS')}&listos=1`, 'ADELA CEBALLOS');
    await page.click('[data-tabla-expedientes] thead th.col-sel input[type="checkbox"]');
    const selA = await page.evaluate(() => document.querySelectorAll('[data-tabla-expedientes] tbody input[type="checkbox"]:checked').length);
    // + lo de MARIA LOPEZ y sin solicitante para pasar de 30 líneas: se agregan desde otra carga con la selección persistida en memoria no; se arma un segundo detalle grande vía URL "todos"
    await irA('?listos=1', '');
    await page.click('[data-tabla-expedientes] thead th.col-sel input[type="checkbox"]');
    const selT = await page.evaluate(() => document.querySelectorAll('[data-tabla-expedientes] tbody input[type="checkbox"]:checked').length);
    ok(selA === 14 && selT >= 30, `cobrables de ADELA: ${selA} (12 + las dos pruebas del COMPLETO); todo lo cobrable que queda: ${selT} (≥ 30 para probar la hoja)`);
    await page.fill('[data-campo="titulo"]', 'Todo lo cobrable · Oct–Nov 2026');
    await page.fill('[data-campo="dirigido-a"]', 'Gerencia de RRHH');
    await page.click('[data-accion="generar-detalle"]');
    await page.waitForURL(u2 => /\/por-facturar\/detalle\/[0-9a-f-]{36}$/.test(u2.pathname), { timeout: 30_000 });
    const grandeId = (await page.evaluate(() => location.pathname)).split('/').pop()!;
    await page.goto(`${BASE}/imprimir/detalle/${grandeId}`);
    await page.waitForSelector('[data-imprimible] [data-tabla-doc] tbody tr[data-linea]');
    const doc = await page.evaluate(() => {
      const th = [...document.querySelectorAll('[data-tabla-doc] thead th')].map(t => (t.textContent ?? '').trim());
      const filas = document.querySelectorAll('[data-tabla-doc] tbody tr[data-linea]').length;
      const td = document.querySelector('[data-tabla-doc] tbody td') as HTMLElement;
      const thEl = document.querySelector('[data-tabla-doc] thead th') as HTMLElement;
      const cb = document.querySelector('[data-tabla-doc] .cb') as HTMLElement;
      return {
        th, filas,
        fuente: getComputedStyle(td).fontSize, fuenteTh: getComputedStyle(thEl).fontSize, padding: getComputedStyle(td).paddingTop,
        casillas: document.querySelectorAll('[data-tabla-doc] [data-casillas] .cb').length, obs: document.querySelectorAll('[data-tabla-doc] [data-observaciones]').length,
        cbBorde: getComputedStyle(cb).borderTopWidth, cbAncho: getComputedStyle(cb).width,
        solicitantes: [...document.querySelectorAll('[data-tabla-doc] [data-solicitante]')].map(e => (e.textContent ?? '').trim()),
        firma: (document.querySelector('[data-firma]')?.textContent ?? '').replace(/\s+/g, ' '),
        titulo: document.querySelector('[data-cliente] [data-titulo]')?.textContent, dirigido: document.querySelector('[data-cliente] [data-dirigido-a]')?.textContent,
      };
    });
    ok(doc.th.join('|') === '#|Persona|Solicitante|Ingreso|Prueba · resultado|Cat.|Terr.|Conforme|Monto sin IVA|Observaciones', `imprimible: columnas ${doc.th.join(' · ')}`);
    ok(doc.fuente === '10.5px' && doc.fuenteTh === '9.5px' && doc.padding === '4px', `letra compacta: celdas ${doc.fuente}, encabezados ${doc.fuenteTh}, padding ${doc.padding}`);
    ok(doc.casillas === doc.filas * 2 && doc.obs === doc.filas && doc.cbBorde === '1px' && doc.cbAncho === '9px', `${doc.filas} líneas con 2 casillas vacías (CSS, ${doc.cbAncho} con borde ${doc.cbBorde}) y observaciones en blanco cada una`);
    ok(doc.solicitantes.filter(s => s === '—').length === 4 && doc.solicitantes.filter(s => s === 'ADELA CEBALLOS').length === 14 && doc.solicitantes.includes('MARIA LOPEZ'), `solicitante por línea: ${doc.solicitantes.filter(s => s === '—').length} vacíos como "—" (esperado 4), ${doc.solicitantes.filter(s => s === 'ADELA CEBALLOS').length} de ADELA (esperado 14), MARIA LOPEZ normalizada ${doc.solicitantes.includes('MARIA LOPEZ')}`);
    ok(/Autorizado por el cliente/.test(doc.firma) && /Nombre:/.test(doc.firma) && /Cargo:/.test(doc.firma) && /Firma:/.test(doc.firma) && /Fecha:/.test(doc.firma) && doc.titulo === 'Corte: Todo lo cobrable · Oct–Nov 2026' && doc.dirigido === 'Dirigido a: Gerencia de RRHH', 'bloque de firma al pie (no facturado); título del corte y "dirigido a" bajo el cliente');
    await page.screenshot({ path: path.join(OUT, 'imprimible-1280.png'), fullPage: true });
    // emulación de impresión: carta vertical (8.5 × 11 in = 816 × 1056 px a 96 dpi, márgenes 14 mm ≈ 53 px)
    await page.emulateMedia({ media: 'print' });
    await page.setViewportSize({ width: 816 - 2 * 45, height: 1056 });
    const hoja = await page.evaluate(() => {
      const alto = 1056 - 2 * 53;
      const filas = [...document.querySelectorAll('[data-tabla-doc] tbody tr[data-linea]')];
      const enPrimera = filas.filter(tr => tr.getBoundingClientRect().bottom <= alto).length;
      const altoFila = Math.round(filas.slice(0, 10).reduce((t, tr) => t + tr.getBoundingClientRect().height, 0) / Math.min(10, filas.length));
      return { enPrimera, total: filas.length, altoFila, display: getComputedStyle(document.querySelector('[data-tabla-doc] thead')!).display, breakTr: getComputedStyle(filas[0]).breakInside };
    });
    ok(hoja.enPrimera >= 30 && hoja.display === 'table-header-group' && hoja.breakTr === 'avoid', `hoja carta vertical: ${hoja.enPrimera} de ${hoja.total} líneas caben en la primera hoja (≥ 30; ${hoja.altoFila} px por fila); encabezado repetido (${hoja.display}); filas sin partir (${hoja.breakTr})`);
    const pdfPath = path.join(OUT, 'detalle-imprimible.pdf');
    await page.pdf({ path: pdfPath, format: 'Letter', printBackground: true, preferCSSPageSize: true });
    const pdf = fs.readFileSync(pdfPath);
    const paginas = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    ok(pdf.length > 10_000 && paginas >= 1, `PDF generado (${Math.round(pdf.length / 1024)} KB, ${paginas} página(s))`);
    await page.emulateMedia({ media: 'screen' });
    await page.setViewportSize({ width: 1280, height: 900 });
    ok(erroresJs.length === 0, `sin errores JS${erroresJs.length ? ': ' + erroresJs.join(' | ') : ''}`);
  } finally {
    await ctx.close().catch(() => null);
    if (userId) await clerk.users.deleteUser(userId).catch(() => null);
    console.log('  (usuario descartable borrado)');
  }
  console.log(`\n${pass} 🟢 / ${fail} 🔴`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
