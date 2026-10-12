/**
 * NC · AUTORIZACIÓN FEL — E2E en navegador real (Chrome) sobre un `next start`.
 *
 *  1. Datos de prueba en la base del env: cliente + factura (createFactura).
 *  2. Usuario DESCARTABLE de Clerk (rol contador: puede emitir/editar NC) con
 *     sesión real por sign-in token. Se borra al final, pase lo que pase.
 *  3. Detalle de factura: emite una NC con el número FEL escrito con espacios y
 *     minúsculas → la sección de NC lo muestra normalizado; lo edita en línea.
 *  4. /notas-credito: columna "Constancia FEL" con el número; el buscador lo
 *     encuentra; edición inline (Enter guarda; formato inválido rechazado sin
 *     cambiar el valor; Esc cancela); Exportar CSV trae Autorizacion_FEL.
 *  5. Limpia todo (NC, factura, cliente, usuario) y lo verifica.
 *
 * Uso:
 *   npx tsx --conditions=react-server scripts/e2e-nc-fel.ts --env hit --base http://localhost:3012
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ENV = arg('--env', 'hit');
const BASE = arg('--base', 'http://localhost:3012').replace(/\/$/, '');
const CHROME = arg('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const SHOTS = arg('--capturas', path.join(process.cwd(), '.e2e-nc-fel'));

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
  fs.mkdirSync(SHOTS, { recursive: true });
  const { chromium } = await import('playwright-core');
  const { createClerkClient } = await import(path.resolve(process.cwd(), 'node_modules/@clerk/backend/dist/index.mjs'));
  const { supabase } = await import('../src/lib/supabase/client');
  const { createFactura, getFacturas } = await import('../src/lib/db/facturas');
  const { getNotasCredito } = await import('../src/lib/db/notas-credito');
  const sb = supabase()!;
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  const STAMP = Date.now().toString(36);
  const TAG = `E2E-FELUI-${STAMP}`;
  const email = `e2e.fel+${STAMP}@example.com`;
  let userId: string | null = null;
  const creados: Array<[string, string]> = [];
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-fel-'));
  const ctx = await chromium.launchPersistentContext(perfil, {
    executablePath: CHROME, headless: true, args: [`--user-agent=${UA}`], acceptDownloads: true,
    viewport: { width: 1440, height: 900 }, userAgent: UA, locale: 'es-GT',
  });
  console.log(`\nE2E NC · autorización FEL · ${ENV.toUpperCase()} · ${BASE}`);
  try {
    // ── Datos ──
    const { data: cli, error: ec } = await sb.from('clientes').insert({ airtable_id: `sbwfelui${STAMP}`, razon_social: `${TAG} CLIENTE`, nombre_empresa: `${TAG} CLIENTE`, activo: true }).select('id').single();
    if (ec) throw new Error(ec.message); creados.push(['clientes', String((cli as { id: string }).id)]);
    const { data: cc } = await sb.from('centros_costo').select('airtable_id').eq('activo', true).limit(1).single();
    await createFactura({ noFactura: `${TAG}-F1`, custId: `sbwfelui${STAMP}`, fechaEmision: '2026-09-01', lineas: [{ centroCostoId: (cc as { airtable_id: string }).airtable_id, total: 1120, iva: 120 }] });
    const fid = (await getFacturas()).find(x => x.noFactura === `${TAG}-F1`)!.id;
    const { data: fuuid } = await sb.from('facturas_clientes').select('id').eq('no_factura', `${TAG}-F1`); for (const r of fuuid ?? []) creados.push(['facturas_clientes', String((r as { id: string }).id)]);
    ok(!!fid, `factura de prueba ${TAG}-F1 (${fid})`);

    // ── Sesión ──
    const u = await clerk.users.createUser({
      emailAddress: [email], password: `E2e-${STAMP}-${Math.random().toString(36).slice(2)}!Aa9`, firstName: 'E2E', lastName: 'FEL', skipPasswordChecks: true,
      publicMetadata: { accesos: [{ empresa_slug: SLUG, rol: 'contador' }] },
    });
    userId = u.id;
    const ticket = (await clerk.signInTokens.createSignInToken({ userId: u.id, expiresInSeconds: 600 })).token;
    const page = ctx.pages()[0] ?? await ctx.newPage();
    page.setDefaultTimeout(30_000);
    const erroresJs: string[] = [];
    page.on('pageerror', e => erroresJs.push(e.message));
    page.on('dialog', d => { erroresJs.push(`diálogo del navegador: ${d.message()}`); void d.dismiss(); });
    await page.goto(`${BASE}/sign-in`);
    await page.waitForFunction(() => (window as unknown as { Clerk?: { loaded?: boolean } }).Clerk?.loaded === true, null, { timeout: 30_000 });
    await page.evaluate(async (t) => {
      const C = (window as unknown as { Clerk: { client: { signIn: { create: (a: unknown) => Promise<{ createdSessionId: string }> } }; setActive: (a: unknown) => Promise<void> } }).Clerk;
      const si = await C.client.signIn.create({ strategy: 'ticket', ticket: t });
      await C.setActive({ session: si.createdSessionId });
    }, ticket);
    await page.waitForURL(u => !u.pathname.startsWith('/sign-in'), { timeout: 20_000 }).catch(() => null);
    await page.waitForLoadState('networkidle').catch(() => null);
    ok(true, `sesión real de Clerk (sign-in token) para usuario descartable rol contador en ${SLUG}`);

    // ── Detalle de factura: emitir NC con número FEL ──
    await page.goto(`${BASE}/facturacion/${fid}`);
    await page.getByRole('button', { name: 'Nota de crédito' }).click();
    const campoFel = page.locator('#nc-fel');
    ok(await campoFel.isVisible(), 'form de emisión: campo "No. de autorización FEL (opcional)" visible');
    const labelFel = await page.locator('label[for="nc-fel"]').innerText().catch(() => '');
    ok(/autorizaci[oó]n FEL/i.test(labelFel) && /opcional/i.test(labelFel), `etiqueta del campo: "${labelFel.trim()}"`);
    await page.locator('#nc-monto').fill('100');
    await page.locator('#nc-desc').fill(`${TAG} desde el navegador`);
    await campoFel.fill(' a1b2 c3d4-0000 0001 ');
    const btnEmitir = page.getByRole('button', { name: 'Emitir NC' });
    await btnEmitir.waitFor();
    if (!(await btnEmitir.isEnabled())) {
      await page.waitForTimeout(1500);
      if (!(await btnEmitir.isEnabled())) console.log(`     · form:\n${(await page.locator('.modal, [role=dialog]').first().innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 600)}\n     · monto="${await page.locator('#nc-monto').inputValue()}" desc="${await page.locator('#nc-desc').inputValue()}"`);
    }
    await btnEmitir.click();
    const tarjetaNC = page.locator('text=Autorización FEL:').first();
    await tarjetaNC.waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => /A1B2C3D4-00000001/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => null);
    const ncs = (await getNotasCredito()).filter(n => n.descripcion.startsWith(TAG));
    for (const n of ncs) { const { data } = await sb.from('notas_credito').select('id').eq('airtable_id', n.id).single(); if (data) creados.push(['notas_credito', String((data as { id: string }).id)]); }
    const nc = ncs[0];
    ok(!!nc && nc.numeroAutorizacionFel === 'A1B2C3D4-00000001', `NC ${nc?.numeroNC ?? '?'} emitida desde el form con el número normalizado en la base: ${nc?.numeroAutorizacionFel}`);
    const detalleTxt = await page.locator('body').innerText();
    ok(/Autorización FEL:\s*A1B2C3D4-00000001/.test(detalleTxt.replace(/\n/g, ' ')), 'detalle de factura: "Autorización FEL: A1B2C3D4-00000001" en la tarjeta de la NC');
    await page.screenshot({ path: path.join(SHOTS, 'detalle-nc-fel.png'), fullPage: true });

    // ── Edición inline en el detalle ──
    await page.getByRole('button', { name: `Editar autorización FEL de ${nc.numeroNC}` }).click();
    const inputDet = page.locator(`input[aria-label="Autorización FEL de ${nc.numeroNC}"]`);
    await inputDet.fill('ffff0000-1111 2222-3333');
    await inputDet.press('Enter');
    await page.waitForFunction(() => /FFFF0000-11112222-3333/.test(document.body.innerText), null, { timeout: 30_000 });
    const trasDet = (await getNotasCredito()).find(n => n.id === nc.id);
    ok(trasDet?.numeroAutorizacionFel === 'FFFF0000-11112222-3333', `edición inline en el detalle (Enter) → base: ${trasDet?.numeroAutorizacionFel}`);

    // ── Lista /notas-credito ──
    await page.goto(`${BASE}/notas-credito`);
    await page.waitForSelector('table thead');
    const ths = (await page.locator('table thead th').allInnerTexts()).map(t => t.trim().toLowerCase());   // el CSS las pone en mayúsculas
    ok(ths.includes('constancia fel') && ths.indexOf('constancia fel') === ths.indexOf('factura origen') + 1, `columna "Constancia FEL" después de "Factura origen" (${ths.filter(Boolean).join(' · ')})`);
    const fila = page.locator('table tbody tr', { hasText: nc.numeroNC });
    const celda = fila.locator('td').nth(4);
    ok(/FFFF0000-11112222-3333/.test(await celda.innerText()), `fila ${nc.numeroNC}: la celda muestra FFFF0000-11112222-3333`);
    // buscador por número FEL
    const buscador = page.getByPlaceholder('NC, factura, cliente, descripción…');
    await buscador.fill('ffff0000-1111');
    await page.waitForTimeout(300);
    const nFilas = await page.locator('table tbody tr').filter({ hasText: 'NC-' }).count();
    ok(nFilas === 1 && await page.locator('table tbody tr', { hasText: nc.numeroNC }).count() === 1, `el buscador encuentra la NC por su número FEL (${nFilas} fila)`);
    await buscador.fill('');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SHOTS, 'lista-constancia-fel.png'), fullPage: true });

    // formato inválido → toast de error, valor intacto
    await fila.getByRole('button', { name: `Editar autorización FEL de ${nc.numeroNC}` }).click();
    const inputLista = fila.locator(`input[aria-label="Autorización FEL de ${nc.numeroNC}"]`);
    await inputLista.fill('abc');
    await inputLista.press('Enter');
    await page.waitForFunction(() => /no parece un número de autorización FEL/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => null);
    const toastErr = await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => [] as string[]);
    ok(toastErr.some(t => /no parece un número de autorización FEL/.test(t)), `formato inválido ("abc") rechazado con aviso: ${toastErr.find(t => /FEL/.test(t))?.slice(0, 90) ?? '(sin toast)'}`);
    ok((await getNotasCredito()).find(n => n.id === nc.id)?.numeroAutorizacionFel === 'FFFF0000-11112222-3333', 'el valor en la base no cambió tras el intento inválido');
    // Esc cancela
    await inputLista.fill('zzzz');
    await inputLista.press('Escape');
    ok((await inputLista.count()) === 0 && /FFFF0000-11112222-3333/.test(await celda.innerText()), 'Esc cancela y deja el número como estaba');
    // edición válida en la lista
    await fila.getByRole('button', { name: `Editar autorización FEL de ${nc.numeroNC}` }).click();
    const inputLista2 = fila.locator(`input[aria-label="Autorización FEL de ${nc.numeroNC}"]`);
    await inputLista2.fill('abcd1234-5678-90ef');
    await fila.getByRole('button', { name: 'Guardar' }).click();
    await page.waitForFunction(() => /ABCD1234-5678-90EF/.test(document.body.innerText), null, { timeout: 30_000 });
    ok((await getNotasCredito()).find(n => n.id === nc.id)?.numeroAutorizacionFel === 'ABCD1234-5678-90EF', 'edición inline en la lista (botón Guardar) → base: ABCD1234-5678-90EF');

    // ── CSV ── (el CSV sale de las props del servidor: tras router.refresh() debe traer el valor nuevo; se reintenta unos segundos)
    let csv = '', intentos = 0;
    const exportar = async () => {
      const [descarga] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByRole('button', { name: 'Exportar CSV' }).click()]);
      const csvPath = path.join(SHOTS, descarga.suggestedFilename() || 'nc.csv');
      await descarga.saveAs(csvPath);
      return fs.readFileSync(csvPath, 'utf8');
    };
    do { intentos++; csv = await exportar(); if (csv.includes('ABCD1234-5678-90EF')) break; await page.waitForTimeout(1500); } while (intentos < 8);
    const lineas = csv.split(/\r?\n/);
    const header = lineas[0].split(',');
    const iFel = header.indexOf('Autorizacion_FEL');
    const filaCsv = lineas.find(l => l.startsWith(nc.numeroNC + ','));
    ok(iFel > 0 && header[iFel - 1] === 'Factura', `CSV: header con Autorizacion_FEL tras Factura (${header.join(',')})`);
    ok(!!filaCsv && filaCsv.split(',')[iFel] === 'ABCD1234-5678-90EF', `CSV: la fila de ${nc.numeroNC} trae ABCD1234-5678-90EF (valor editado inline, llegó por router.refresh en ${intentos} intento${intentos === 1 ? '' : 's'})`);

    ok(erroresJs.length === 0, `sin errores de JavaScript ni diálogos del navegador${erroresJs.length ? `: ${erroresJs[0]}` : ''}`);
  } catch (e) {
    fail++; console.log(`  🔴 excepción: ${(e as Error).message}`);
    await ctx.pages()[0]?.screenshot({ path: path.join(SHOTS, 'error.png'), fullPage: true }).catch(() => null);
  } finally {
    await ctx.close().catch(() => null);
    if (userId) await clerk.users.deleteUser(userId).catch((e: Error) => console.log(`     ✗ clerk: ${e.message}`));
    console.log('\n  Limpieza');
    for (const t of ['notas_credito', 'facturas_clientes', 'clientes']) {
      const ids = creados.filter(([tt]) => tt === t).map(([, id]) => id);
      if (ids.length) { const { error } = await sb.from(t).delete().in('id', ids); if (error) console.log(`     ✗ ${t}: ${error.message}`); }
    }
    const [{ count: c1 }, { count: c2 }, { count: c3 }] = await Promise.all([
      sb.from('notas_credito').select('id', { count: 'exact', head: true }).like('descripcion', `${TAG}%`),
      sb.from('facturas_clientes').select('id', { count: 'exact', head: true }).like('no_factura', `${TAG}%`),
      sb.from('clientes').select('id', { count: 'exact', head: true }).like('razon_social', `${TAG}%`),
    ]);
    const usuarios = await clerk.users.getUserList({ emailAddress: [email] }).catch(() => ({ data: [] as unknown[] }));
    ok((c1 ?? 0) + (c2 ?? 0) + (c3 ?? 0) === 0 && usuarios.data.length === 0, `limpieza verificada: 0 filas ${TAG}, usuario de Clerk borrado`);
    console.log(`\n== ${pass} 🟢 / ${fail} 🔴 ==\n`);
    process.exit(fail ? 1 : 0);
  }
})();
