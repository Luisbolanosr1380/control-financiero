/**
 * DETALLE FIRMADO EN PAPEL (032) — E2E en Chrome a 390 px (teléfono) sobre un `next start` (HIT) con el detalle en
 * enviada (con link vigente) que deja `validate-detalle-firmado.ts hit --conservar`.
 *  1. Finanzas (contador, desde el teléfono): abre el detalle → «Subir detalle firmado» → elige una foto (JPG) → firmado
 *     por / cargo → «y marcar como aprobado» → sube (PUT directo al bucket privado) → el detalle queda aprobado con
 *     canal «firmado en papel», la sección «Detalle firmado» muestra la foto (miniatura firmada) y el link digital revocado.
 *  2. «Ver» → la ruta /api/detalle-archivo/<id> redirige a una URL firmada del bucket (no pública) que entrega la imagen.
 *  3. Imprimible: «Firmado en papel por … el … · respaldo en el sistema», sin el bloque de firma en blanco.
 *  4. Lista de detalles: el ícono de firmado en la fila.
 *  5. Un archivo que no es PDF ni imagen (texto con extensión .jpg) se rechaza antes de subir.
 *  Capturas en --out. Usuario descartable de Clerk (contador).
 *
 * Uso: npx tsx scripts/e2e-detalle-firmado.ts --env hit --base http://localhost:3012 --out /ruta/capturas
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ENV = arg('--env', 'hit');
const BASE = arg('--base', 'http://localhost:3012').replace(/\/$/, '');
const OUT = arg('--out', path.join(os.tmpdir(), 'e2e-detalle-firmado'));
const CHROME = arg('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const NIT = arg('--nit', '99990034K');
const envFile = ENV === 'hit' ? '.env.hit.vercel' : '.env.local';
for (const line of fs.readFileSync(path.join(process.cwd(), envFile), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('=');
  if (ENV === 'hit' || !(k.trim() in process.env)) process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  🟢 ${m}`); } else { fail++; console.log(`  🔴 ${m}`); } };
const SLUG = (process.env.EMPRESA_SLUG || 'golden').toLowerCase();
// 390 px con isMobile, pero con el UA de Chrome de escritorio: con un UA de Safari móvil la sesión de Clerk (dev instance) no se activa por el handshake
const UA_MOVIL = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

(async () => {
  const { chromium } = await import('playwright-core');
  const { createClerkClient } = await import(path.resolve(process.cwd(), 'node_modules/@clerk/backend/dist/index.mjs'));
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  const STAMP = Date.now().toString(36);
  let userId: string | null = null;
  fs.mkdirSync(OUT, { recursive: true });
  const fotoPath = path.join(OUT, 'IMG_0042.jpg'); fs.writeFileSync(fotoPath, JPEG);
  const textoPath = path.join(OUT, 'texto.jpg'); fs.writeFileSync(textoPath, 'esto no es una foto\n');
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-dfp-')), { executablePath: CHROME, headless: true, args: [`--user-agent=${UA_MOVIL}`], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, userAgent: UA_MOVIL, locale: 'es-GT', isMobile: true, hasTouch: true });
  console.log(`\nE2E detalle firmado en papel · ${ENV.toUpperCase()} · ${BASE} · 390 px`);
  try {
    const u = await clerk.users.createUser({ emailAddress: [`e2e.firmado+${STAMP}@example.com`], password: `E2e-${STAMP}-${Math.random().toString(36).slice(2)}!Aa9`, firstName: 'E2E', lastName: 'Firmado', skipPasswordChecks: true, publicMetadata: { accesos: [{ empresa_slug: SLUG, rol: 'contador' }] } });
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
    ok(true, `sesión real de Clerk para usuario descartable rol contador en ${SLUG}`);

    // ── 1. el detalle enviado (la lista de detalles se revisa al final a 1280 px; en el teléfono se entra directo al detalle) ──
    const { createClient } = await import('@supabase/supabase-js');
    const sbE2E = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false } });
    const { data: dets } = await sbE2E.from('detalle_facturacion').select('id').eq('nit', NIT).eq('estado', 'enviada').order('created_at', { ascending: false }).limit(1);
    const idDetalle = String(dets?.[0]?.id ?? '');
    const { count: nArchivos } = await sbE2E.from('detalle_facturacion_archivo').select('id', { count: 'exact', head: true }).eq('detalle_id', idDetalle);
    ok(/^[0-9a-f-]{36}$/.test(idDetalle) && nArchivos === 0, `detalle enviado del cliente de prueba (${idDetalle.slice(0, 8)}…), todavía sin archivos`);
    const detalleUrl = `${BASE}/por-facturar/detalle/${idDetalle}`;
    await page.goto(detalleUrl);
    await page.waitForSelector('[data-accion="subir-firmado"]');
    const antes = await page.evaluate(() => ({ estado: document.querySelector('[data-estado]')?.getAttribute('data-estado'), firmado: document.querySelector('[data-firmado-papel]')?.getAttribute('data-firmado-papel'), seccion: !!document.querySelector('[data-detalle-firmado]'), ancho: document.documentElement.scrollWidth, vp: window.innerWidth }));
    ok(antes.estado === 'enviada' && antes.firmado === 'no' && !antes.seccion && antes.ancho <= antes.vp + 1, `detalle enviado, sin papel firmado, sin la sección; a 390 px sin desplazamiento horizontal (${antes.ancho} ≤ ${antes.vp})`);
    await page.screenshot({ path: path.join(OUT, 'detalle-antes-390.png'), fullPage: false });

    // ── 5. un texto con extensión .jpg no pasa el pre-chequeo ──
    await page.click('[data-accion="subir-firmado"]');
    await page.waitForSelector('[data-dialogo-firmado="subir"]');
    await page.setInputFiles('[data-campo="archivos"]', textoPath);
    await page.waitForSelector('[data-elegido="error"]');
    const malo = await page.evaluate(() => ({ texto: document.querySelector('[data-elegido="error"]')?.textContent ?? '', deshabilitado: (document.querySelector('[data-accion="confirmar-subir-firmado"]') as HTMLButtonElement).disabled }));
    ok(/no es PDF ni imagen/.test(malo.texto) && malo.deshabilitado, `un texto con extensión .jpg se rechaza por sus bytes antes de subir: "${malo.texto.slice(0, 60)}"`);

    // ── 1b. la foto, firmado por, y marcar como aprobado ──
    await page.setInputFiles('[data-campo="archivos"]', fotoPath);
    await page.waitForSelector('[data-elegido="ok"]');
    await page.fill('[data-campo="firmado-por"]', 'Marta Papel');
    await page.fill('[data-campo="firmado-cargo"]', 'Gerente RRHH');
    await page.fill('[data-campo="firmado-notas"]', 'Firmó todas las hojas');
    const chk = await page.isChecked('[data-campo="aprobar-papel"]');
    const boton = await page.textContent('[data-accion="confirmar-subir-firmado"]');
    await page.screenshot({ path: path.join(OUT, 'subir-dialogo-390.png'), fullPage: false });
    await page.click('[data-accion="confirmar-subir-firmado"]');
    await page.waitForSelector('[data-detalle-firmado="1"]', { timeout: 60_000 });
    await page.waitForFunction(() => { const i = document.querySelector('[data-miniatura]') as HTMLImageElement | null; return !!i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15_000 }).catch(() => null);
    const despues = await page.evaluate(() => ({
      estado: document.querySelector('[data-estado]')?.getAttribute('data-estado'), paso3: (document.querySelector('[data-paso="3"]')?.textContent ?? '').replace(/\s+/g, ' '),
      firmado: document.querySelector('[data-firmado-papel]')?.getAttribute('data-firmado-papel'), mime: document.querySelector('[data-archivo]')?.getAttribute('data-mime'),
      nombre: document.querySelector('[data-archivo-nombre]')?.textContent ?? '', por: document.querySelector('[data-firmado-por]')?.textContent ?? '', notas: document.querySelector('[data-archivo-notas]')?.textContent ?? '',
      miniatura: (document.querySelector('[data-miniatura]') as HTMLImageElement | null)?.naturalWidth ?? 0, link: (document.querySelector('[data-link-cliente]')?.textContent ?? '').replace(/\s+/g, ' '),
      ver: document.querySelector('[data-accion="ver-archivo"]')?.getAttribute('href') ?? '', descargar: document.querySelector('[data-accion="descargar-archivo"]')?.getAttribute('href') ?? '',
      reemplazar: !!document.querySelector('[data-accion="reemplazar-archivo"]'), quitar: !!document.querySelector('[data-accion="quitar-archivo"]'),
    }));
    ok(chk && /Subir y marcar como aprobado/.test(boton ?? '') && despues.estado === 'aprobada' && /firmado en papel/.test(despues.paso3) && /Marta Papel/.test(despues.paso3) && despues.firmado === 'si', `«y marcar como aprobado» venía marcado; el detalle queda aprobado con canal firmado en papel (paso 3: "${despues.paso3.slice(0, 70)}…")`);
    ok(despues.mime === 'image/jpeg' && /IMG_0042\.jpg/.test(despues.nombre) && /Firmado por Marta Papel · Gerente RRHH el/.test(despues.por) && /Firmó todas las hojas/.test(despues.notas) && despues.miniatura > 0 && /revocado/.test(despues.link) && despues.reemplazar && despues.quitar, `sección «Detalle firmado»: foto (miniatura firmada cargada: ${despues.miniatura} px), nombre (${despues.nombre.slice(0, 30)}), firmado por · cargo · fecha, notas; link digital revocado (${/revocado/.test(despues.link) ? 'sí' : 'NO: ' + despues.link.slice(0, 80)}); reemplazar / quitar para el contador (${despues.reemplazar}/${despues.quitar})`);
    await page.screenshot({ path: path.join(OUT, 'detalle-firmado-390.png'), fullPage: true });

    // ── 2. Ver → ruta con sesión → URL firmada del bucket privado ──
    const resVer = await page.request.get(`${BASE}${despues.ver}`, { maxRedirects: 0 });
    const destino = resVer.headers()['location'] ?? '';
    const resImg = destino ? await page.request.get(destino) : null;
    const resDesc = await page.request.get(`${BASE}${despues.descargar}`, { maxRedirects: 0 });
    ok(resVer.status() === 302 && /\/storage\/v1\/object\/sign\/detalles-firmados\/.+token=/.test(destino) && !/\/object\/public\//.test(destino) && resImg?.status() === 200 && /image\/jpeg/.test(resImg.headers()['content-type'] ?? '') && resVer.headers()['cache-control'] === 'no-store' && /download=/.test(resDesc.headers()['location'] ?? ''), `Ver: la ruta redirige (302, no-store) a una URL firmada del bucket privado que entrega la imagen (${resImg?.status()}); Descargar fuerza el nombre`);

    // ── 3. imprimible ──
    await page.goto(`${BASE}/imprimir/detalle/${idDetalle}`);
    await page.waitForSelector('[data-firmado-papel]');
    const imp = await page.evaluate(() => ({ texto: (document.querySelector('[data-firmado-papel]')?.textContent ?? '').replace(/\s+/g, ' '), manual: !!document.querySelector('[data-firma]'), casillas: document.querySelectorAll('[data-casillas]').length }));
    ok(/Firmado en papel por Marta Papel · Gerente RRHH el \d{2}\/\d{2}\/\d{4} · respaldo en el sistema \(1 archivo · Firmó todas las hojas\)/.test(imp.texto) && !imp.manual && imp.casillas === 0, `imprimible: "${imp.texto}"; sin el bloque de firma en blanco ni casillas`);
    await page.screenshot({ path: path.join(OUT, 'imprimible-firmado-390.png'), fullPage: true });

    // ── 4. lista con el ícono (a 1280 px: en el teléfono la lista de detalles no está a mano) ──
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE}/por-facturar`);
    await page.click('[data-tab="detalles"]');
    await page.waitForSelector('[data-lista="detalles"] tbody tr[data-detalle]');
    const icono = await page.evaluate((id) => [...document.querySelectorAll('[data-lista="detalles"] tbody tr[data-detalle]')].find(t => t.querySelector(`a[href$="/${id}"]`))?.querySelector('[data-firmado]')?.getAttribute('data-firmado') ?? null, idDetalle);
    ok(icono === 'si', 'lista de detalles: el ícono de firmado en la fila');
    ok(errores.length === 0, `sin errores JS${errores.length ? ': ' + errores.join(' | ') : ''}`);
  } finally {
    await ctx.close().catch(() => null);
    if (userId) await clerk.users.deleteUser(userId).catch(() => null);
    console.log('  (usuario descartable borrado)');
  }
  console.log(`\n${pass} 🟢 / ${fail} 🔴`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
