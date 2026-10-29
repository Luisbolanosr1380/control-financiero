/**
 * PULIDO · nombre comercial / marcas + buscador + crear inline + re-resolver — E2E en navegador
 * real (Chrome) sobre un `next start` con la base de HIT. Siembra en la base dos clientes (uno con
 * marca "Calzado Chicote E2E", otro "E2E CUSCATLAN TCU") y tres empresas de la Agenda sin mapear,
 * entra con un usuario DESCARTABLE de Clerk (rol contador) y prueba:
 *   1. /por-facturar/e-<CALZADO CHICOTÉ E2E>: la sugerencia propone a Distribuidora Suprema por su
 *      marca; el buscador encuentra con tilde ("chicoté", "cuscatlán"), auto-selecciona si hay uno
 *      solo, y la opción dice por qué nombre apareció; mapear → va al cliente.
 *   2. /por-facturar/e-<NUEVA EMPRESA INLINE>: "Crear cliente nuevo" → modal (NIT obligatorio,
 *      nombre comercial, marcas en chips) → queda creado + mapeado y aterriza en el cliente con
 *      "Generar tarifas" abierto → se generan en Q0.
 *   3. /tarifario/<nit>: cargar precio a una Q0 → SIN "Traer ahora" la cola del cliente muestra el
 *      expediente como listo (re-resolver automático) y el KPI sube.
 *   4. /clientes/<id>: tarjeta "Nombres y marcas" → Editar → agregar marca → Guardar → queda en la base.
 * Limpia todo (clientes, tarifario, mapeos, expedientes, usuario).
 *
 * Uso: npx tsx scripts/e2e-pulido-clientes.ts --env hit --base http://localhost:3012
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ENV = arg('--env', 'hit');
const BASE = arg('--base', 'http://localhost:3012').replace(/\/$/, '');
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
const PRE = 'recE2EPU';
const NIT_SUP = '99990031K', NIT_CUS = '99990032K', NIT_NEW = '99990033K';
const EMP_CHI = `${PRE}empChi`, EMP_CUS = `${PRE}empCus`, EMP_NEW = `${PRE}empNew`;

(async () => {
  const { chromium } = await import('playwright-core');
  const { createClerkClient } = await import(path.resolve(process.cwd(), 'node_modules/@clerk/backend/dist/index.mjs'));
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  const STAMP = Date.now().toString(36);
  const email = `e2e.pulido+${STAMP}@example.com`;
  let userId: string | null = null;
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-pulido-'));
  const ctx = await chromium.launchPersistentContext(perfil, { executablePath: CHROME, headless: true, args: [`--user-agent=${UA}`], viewport: { width: 1440, height: 900 }, userAgent: UA, locale: 'es-GT' });
  console.log(`\nE2E pulido clientes / mapeo · ${ENV.toUpperCase()} · ${BASE}`);
  const limpiar = async () => {
    await sb.from('facturacion_expediente').delete().like('id_externo', `${PRE}%`);
    await sb.from('cliente_externo').delete().like('empresa_id_externo', `${PRE}%`);
    await sb.from('tarifario').delete().in('nit', [NIT_SUP, NIT_CUS, NIT_NEW]);
    await sb.from('clientes').delete().in('nit', [NIT_SUP, NIT_CUS, NIT_NEW]);
  };
  try {
    await limpiar();
    // Semilla: cliente con marca + cliente "CUSCATLAN" + 3 empresas de la Agenda sin mapear.
    const { data: sup } = await sb.from('clientes').insert({ airtable_id: `sbw${PRE}sup`, nombre_empresa: 'E2E DISTRIBUIDORA SUPREMA, S.A.', razon_social: 'E2E DISTRIBUIDORA SUPREMA, SOCIEDAD ANONIMA', nit: NIT_SUP, activo: true, nombre_comercial: 'Calzado Chicote E2E', aliases: ['Chicote E2E'] }).select('airtable_id').single();
    const { data: cus } = await sb.from('clientes').insert({ airtable_id: `sbw${PRE}cus`, nombre_empresa: 'E2E CUSCATLAN TCU', nit: NIT_CUS, activo: true }).select('airtable_id').single();
    const filas: Record<string, unknown>[] = [];
    const emp = (empId: string, nombre: string, n: number) => { for (let i = 0; i < n; i++) { const id = `${PRE}${empId.slice(-3)}${i}`; filas.push({ fuente: 'agenda', id_externo: id, empresa_id_externo: empId, empresa_nombre_externo: nombre, estado_tarifa: 'cliente_sin_mapear', detalle_tarifa: 'sin mapear', terminado: true, cancelado: false, eliminado: false, status_cobro_externo: 'PENDIENTE', fecha_ingreso: '2026-10-0' + (1 + i), tipo_prueba: 'POLIGRAFO', proceso_solicitado: 'SOLO POLIGRAFO', categoria_prueba: 'PRE EMPLEO', depto_visita: 'GUATEMALA', persona: `PERSONA ${empId.slice(-3)}${i}`, raw: { id, empresa: { id: empId, nombre }, tipoPrueba: 'POLIGRAFO', procesoSolicitado: 'SOLO POLIGRAFO', categoriaPrueba: 'PRE EMPLEO', deptoVisita: 'GUATEMALA', terminado: true, cancelado: false, eliminado: false, fechaIngreso: '2026-10-0' + (1 + i), cobro: { statusCobro: 'PENDIENTE' }, actualizadoEn: '2026-10-20T10:00:00.000Z', nombre: `PERSONA ${empId.slice(-3)}${i}` } }); } };
    emp(EMP_CHI, 'CALZADO CHICOTÉ E2E', 2); emp(EMP_CUS, 'BANCO CUSCATLAN E2E', 1); emp(EMP_NEW, 'NUEVA EMPRESA INLINE E2E', 2);
    const { error: eSeed } = await sb.from('facturacion_expediente').insert(filas);
    ok(!eSeed && !!sup && !!cus, `semilla: Distribuidora Suprema (marca "Calzado Chicote E2E"), CUSCATLAN TCU y 3 empresas de la Agenda sin mapear (5 exp.)${eSeed ? ' · ' + eSeed.message : ''}`);

    const u = await clerk.users.createUser({ emailAddress: [email], password: `E2e-${STAMP}-${Math.random().toString(36).slice(2)}!Aa9`, firstName: 'E2E', lastName: 'Pulido', skipPasswordChecks: true, publicMetadata: { accesos: [{ empresa_slug: SLUG, rol: 'contador' }] } });
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
    await page.waitForURL(u2 => !u2.pathname.startsWith('/sign-in'), { timeout: 20_000 }).catch(() => null);
    ok(true, `sesión real de Clerk para usuario descartable rol contador en ${SLUG}`);

    // 1) Sugerencia por marca + buscador con tildes + auto-selección + mapear
    await page.goto(`${BASE}/por-facturar/e-${EMP_CHI}`);
    await page.waitForSelector('[aria-label="Mapear cliente"]');
    const panel = page.locator('[aria-label="Mapear cliente"]');
    ok(/Sugeridos por nombre:/.test(await panel.innerText()) && /E2E DISTRIBUIDORA SUPREMA/.test(await panel.innerText()), 'Agenda "CALZADO CHICOTÉ E2E" → "Sugeridos por nombre" propone a Distribuidora Suprema por su MARCA');
    const buscador = page.getByLabel('Buscar cliente para mapear');
    const select = page.getByLabel('Cliente de financiero');
    await buscador.fill('cuscatlán');
    await page.waitForFunction((id) => (document.querySelector('select[aria-label="Cliente de financiero"]') as HTMLSelectElement | null)?.value === id, cus!.airtable_id, { timeout: 10_000 });
    const opcCus = await select.locator('option').allInnerTexts();
    ok(opcCus.filter(o => /CUSCATLAN/.test(o)).length === 1 && opcCus.some(o => /E2E CUSCATLAN TCU · NIT 99990032K/.test(o)), `"cuscatlán" (con tilde) encuentra CUSCATLAN TCU y lo deja seleccionado solo (${opcCus.length - 1} coincidencia)`);
    await buscador.fill('calzado chicoté');
    await page.waitForFunction((id) => !!document.querySelector(`select[aria-label="Cliente de financiero"] option[value="${id}"]`), sup!.airtable_id, { timeout: 10_000 });
    const opcChi = await select.locator('option').allInnerTexts();
    ok(opcChi.some(o => /E2E DISTRIBUIDORA SUPREMA, S\.A\. \(Calzado Chicote E2E\) · NIT 99990031K/.test(o)) && !opcChi.some(o => /CUSCATLAN/.test(o)), `alias "calzado chicoté" encuentra a Distribuidora Suprema y la opción dice "(Calzado Chicote E2E)" para explicar por qué apareció (${opcChi.length - 1} coincidencia(s))`);
    await select.selectOption(sup!.airtable_id);
    await buscador.fill(NIT_SUP);
    await page.waitForFunction((id) => (document.querySelector('select[aria-label="Cliente de financiero"]') as HTMLSelectElement | null)?.value === id, sup!.airtable_id, { timeout: 10_000 });
    ok(true, 'el NIT también la encuentra');
    await page.getByRole('button', { name: /^Mapear a E2E DISTRIBUIDORA SUPREMA/ }).click();
    await page.waitForURL(u2 => u2.pathname === `/por-facturar/n-${NIT_SUP}`, { timeout: 30_000 });
    await page.waitForSelector('h1.page-title');
    const { data: mapChi } = await sb.from('cliente_externo').select('nit').eq('empresa_id_externo', EMP_CHI).single();
    ok(mapChi?.nit === NIT_SUP && /E2E DISTRIBUIDORA SUPREMA/.test(await page.locator('h1.page-title').innerText()), 'Mapear → aterriza en el cliente; en la base la empresa quedó con su NIT');

    // 2) Crear cliente inline desde el panel de mapeo → mapeado + "Generar tarifas" abierto
    await page.goto(`${BASE}/por-facturar/e-${EMP_NEW}`);
    await page.waitForSelector('[data-accion="crear-cliente-inline"]');
    await page.locator('[data-accion="crear-cliente-inline"]').click();
    const crearBtn = page.getByRole('button', { name: 'Crear cliente', exact: true });
    await crearBtn.waitFor();
    ok(await crearBtn.isDisabled() && /Hace falta el NIT para mapearlo/.test(await page.locator('[role="dialog"], body').innerText()), 'modal "Nuevo cliente" pre-cargado con el nombre de la Agenda; sin NIT no se puede crear (el tarifario cruza por NIT)');
    await page.getByPlaceholder('Si se deja vacío, usa el nombre de la empresa').fill('NUEVA EMPRESA INLINE E2E, SOCIEDAD ANONIMA');
    await page.getByLabel('Nombre comercial').fill('Inline Marca E2E');
    const chips = page.getByLabel('Otros nombres o marcas');
    await chips.fill('Marca Dos E2E'); await chips.press('Enter');
    await chips.fill('marca dos e2é'); await chips.press('Enter');   // repetida (sin tildes) → no se agrega
    ok((await page.locator('[data-chips] [data-chip]').allInnerTexts()).map(t => t.trim()).join('|') === 'Marca Dos E2E', 'chips de marcas: Enter agrega; la repetida (sin tildes/mayúsculas) no se duplica');
    await page.getByLabel('NIT').fill(NIT_NEW);
    await page.waitForFunction(() => !([...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Crear cliente') as HTMLButtonElement | undefined)?.disabled, null, { timeout: 5_000 });
    await crearBtn.click();
    await page.waitForURL(u2 => u2.pathname === `/por-facturar/n-${NIT_NEW}` && u2.searchParams.get('generar') === '1', { timeout: 30_000 });
    await page.waitForSelector('[data-generar-tarifas]');
    const { data: cNew } = await sb.from('clientes').select('airtable_id, nombre_empresa, razon_social, nombre_comercial, aliases').eq('nit', NIT_NEW).single();
    const { data: mapNew } = await sb.from('cliente_externo').select('nit').eq('empresa_id_externo', EMP_NEW).single();
    ok(!!cNew && cNew.nombre_empresa === 'NUEVA EMPRESA INLINE E2E' && cNew.razon_social === 'NUEVA EMPRESA INLINE E2E, SOCIEDAD ANONIMA' && cNew.nombre_comercial === 'Inline Marca E2E' && (cNew.aliases as string[]).join() === 'Marca Dos E2E' && mapNew?.nit === NIT_NEW, 'Crear cliente → en la base: cliente con razón social, nombre comercial y marca; la empresa de la Agenda quedó mapeada a su NIT en el mismo paso');
    ok(!!(await page.$('[data-recien-mapeado]')) && !!(await page.$('[data-generar-tarifas]')), 'aterriza en el cliente con el aviso "creado y mapeado" y "Generar tarifas" abierto');
    const { data: expNew0 } = await sb.from('facturacion_expediente').select('estado_tarifa, nit_resuelto').like('id_externo', `${PRE}New%`);
    ok((expNew0 ?? []).length === 2 && expNew0!.every(e => e.estado_tarifa === 'sin_tarifa' && e.nit_resuelto === NIT_NEW), 'sus 2 expedientes ya se re-resolvieron: "sin tarifa" con el NIT nuevo (todavía no hay tarifario)');
    await page.getByRole('button', { name: 'Ver qué se crearía' }).click();
    await page.waitForSelector('[data-plan-resumen]');
    await page.locator('[data-accion="confirmar-generar"]').click();
    await page.waitForFunction((nit) => !document.querySelector('[data-plan-resumen]') && /Tarifario del cliente/.test(document.body.innerText) && !!document.querySelector(`a[href="/tarifario/${nit}"]`), NIT_NEW, { timeout: 30_000 });
    const { data: tarNew } = await sb.from('tarifario').select('id, tipo_prueba, categoria, territorio, monto').eq('nit', NIT_NEW);
    const polMet = (tarNew ?? []).find(t => t.tipo_prueba === 'POLIGRAFO' && t.categoria === 'PRE EMPLEO' && t.territorio === 'METROPOLITANA');
    ok((tarNew ?? []).length >= 4 && (tarNew ?? []).every(t => Number(t.monto) === 0) && !!polMet, `"Generar tarifas" creó ${(tarNew ?? []).length} filas en Q0 para el cliente nuevo (incluye POLIGRAFO PRE EMPLEO METROPOLITANA)`);

    // 3) Re-resolver automático: cargar precio en el tarifario → la cola refleja los expedientes como listos SIN "Traer ahora"
    await page.goto(`${BASE}/tarifario/${NIT_NEW}`);
    await page.waitForSelector('h1.page-title');
    await page.locator('button[aria-label^="Editar monto de"][aria-label*="POLIGRAFO PRE EMPLEO METROPOLITANA"]').first().click();
    const montoIn = page.locator('input[aria-label^="Monto de"][aria-label*="POLIGRAFO PRE EMPLEO METROPOLITANA"]');
    await montoIn.fill('300');
    await page.locator('input[aria-label^="Motivo del cambio de"][aria-label*="POLIGRAFO PRE EMPLEO METROPOLITANA"]').fill('precio pactado');
    await montoIn.press('Enter');
    await page.waitForFunction(() => /re-resuelt/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => null);
    const toastTxt = await page.locator('body').innerText();
    ok(/2 expedientes de la Agenda re-resueltos/.test(toastTxt), 'al guardar el precio, el aviso dice "2 expedientes de la Agenda re-resueltos" (sin cron ni "Traer ahora")');
    const { data: expNew1 } = await sb.from('facturacion_expediente').select('estado_tarifa, monto_calculado').like('id_externo', `${PRE}New%`);
    ok((expNew1 ?? []).length === 2 && expNew1!.every(e => e.estado_tarifa === 'resuelta' && Number(e.monto_calculado) === 300), 'en la base: los 2 expedientes pasaron a "resuelta" Q300');
    await page.goto(`${BASE}/por-facturar/n-${NIT_NEW}`);
    await page.waitForSelector('[data-kpi="listos"] .kpi-value');
    ok(Number((await page.locator('[data-kpi="listos"] .kpi-value').innerText()).replace(/[^0-9]/g, '')) === 2 && Number((await page.locator('[data-kpi="sin-tarifa"] .kpi-value').innerText()).replace(/[^0-9]/g, '')) === 0, 'la cola del cliente muestra 2 listos / 0 sin tarifa sin haber tocado "Traer ahora"');
    // "Re-resolver precios" del tablero: nada pendiente
    await page.goto(`${BASE}/por-facturar`);
    await page.waitForSelector('[data-accion="re-resolver"]');
    await page.locator('[data-accion="re-resolver"]').click();
    await page.waitForFunction(() => /ya estaba al día|re-resuelt/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => null);
    ok(/ya estaba al día|re-resuelt/.test(await page.locator('body').innerText()), '"Re-resolver precios" en el tablero responde (local, sin ir a la Agenda)');

    // 4) Ficha del cliente: editar marcas
    await page.goto(`${BASE}/clientes/${sup!.airtable_id}`);
    await page.waitForSelector('[data-nombres-cliente]');
    const card = page.locator('[data-nombres-cliente]');
    ok(/Calzado Chicote E2E/.test(await card.innerText()) && /Chicote E2E/.test(await card.innerText()) && /E2E DISTRIBUIDORA SUPREMA, SOCIEDAD ANONIMA/.test(await card.innerText()), 'ficha del cliente: tarjeta "Nombres y marcas" con razón social (factura), nombre comercial y marca');
    await page.locator('[data-accion="editar-nombres"]').click();
    const chips2 = card.getByLabel('Otros nombres o marcas');
    await chips2.fill('Zapatería E2E'); await chips2.press('Enter');
    await page.locator('[data-accion="guardar-nombres"]').click();
    await page.waitForFunction(() => !document.querySelector('[data-accion="guardar-nombres"]') && /Zapatería E2E/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => null);
    const { data: supDb } = await sb.from('clientes').select('aliases, nombre_comercial').eq('nit', NIT_SUP).single();
    ok(!(await page.$('[data-accion="guardar-nombres"]')) && (supDb?.aliases as string[] | undefined)?.join('|') === 'Chicote E2E|Zapatería E2E' && supDb?.nombre_comercial === 'Calzado Chicote E2E', 'Editar → agregar "Zapatería E2E" → Guardar: queda en la base junto a la marca anterior');
    ok(erroresJs.length === 0, `sin errores JS ni diálogos del navegador${erroresJs.length ? ': ' + erroresJs.join(' | ') : ''}`);
  } catch (e) {
    fail++; console.log(`  🔴 error: ${e instanceof Error ? e.message.split('\n').slice(0, 3).join(' · ') : String(e)}`);
  } finally {
    await ctx.close().catch(() => null);
    if (userId) await clerk.users.deleteUser(userId).catch((e: Error) => console.log(`     ✗ clerk: ${e.message}`));
    await limpiar();
    const { count } = await sb.from('facturacion_expediente').select('id', { count: 'exact', head: true }).like('id_externo', `${PRE}%`);
    const { count: c2 } = await sb.from('clientes').select('id', { count: 'exact', head: true }).in('nit', [NIT_SUP, NIT_CUS, NIT_NEW]);
    const { count: c3 } = await sb.from('tarifario').select('id', { count: 'exact', head: true }).in('nit', [NIT_SUP, NIT_CUS, NIT_NEW]);
    ok((count ?? 0) === 0 && (c2 ?? 0) === 0 && (c3 ?? 0) === 0, 'limpieza verificada: 0 expedientes / mapeos / tarifas / clientes de prueba, usuario de Clerk borrado');
    console.log(`\n== ${pass} 🟢 / ${fail} 🔴 ==\n`);
    process.exit(fail ? 1 : 0);
  }
})();
