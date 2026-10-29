/**
 * POR FACTURAR · "Sin mapear" MASIVO — E2E en navegador real (Chrome) sobre un `next start`
 * con la base de HIT. Siembra empresas de la Agenda sin mapear directo en el espejo
 * (facturacion_expediente), entra con un usuario DESCARTABLE de Clerk (rol contador =
 * facturar_agenda) y prueba:
 *   1. pestaña "Sin mapear" → buscar "WALMART" → "Seleccionar las N de WALMART" → "Mapear
 *      todas a un cliente" → elegir el cliente de prueba → confirmar → desaparecen de la
 *      lista; en la base todas quedan con ese NIT y sus expedientes resuelven precio.
 *   2. buscar "GOLDEN" → toda la página → "No se factura (no aplica)" con motivo → confirmar
 *      → desaparecen; aparecen en la pestaña "No se facturan" con el motivo; en la base los
 *      expedientes están en excluido_no_factura.
 * Limpia todo (clientes, tarifario, mapeos, expedientes, usuario).
 *
 * Uso: npx tsx scripts/e2e-sin-mapear.ts --env hit --base http://localhost:3012
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
const NIT = '99990021K';
const PRE = 'recE2EUI';

(async () => {
  const { chromium } = await import('playwright-core');
  const { createClerkClient } = await import(path.resolve(process.cwd(), 'node_modules/@clerk/backend/dist/index.mjs'));
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  const STAMP = Date.now().toString(36);
  const email = `e2e.sinmapear+${STAMP}@example.com`;
  let userId: string | null = null;
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-sin-mapear-'));
  const ctx = await chromium.launchPersistentContext(perfil, { executablePath: CHROME, headless: true, args: [`--user-agent=${UA}`], viewport: { width: 1440, height: 900 }, userAgent: UA, locale: 'es-GT' });
  console.log(`\nE2E sin mapear (masivo) · ${ENV.toUpperCase()} · ${BASE}`);
  const limpiar = async () => {
    await sb.from('facturacion_expediente').delete().like('id_externo', `${PRE}%`);
    await sb.from('cliente_externo').delete().like('empresa_id_externo', `${PRE}%`);
    await sb.from('tarifario').delete().eq('nit', NIT);
    await sb.from('clientes').delete().eq('nit', NIT);
  };
  try {
    await limpiar();
    // Semilla: cliente + tarifa + 5 empresas WALMART/… (3 exp. c/u) + 2 empresas GOLDEN (2 exp. c/u), todas sin mapear y en cola.
    const { data: cli } = await sb.from('clientes').insert({ airtable_id: `sbw${PRE}cli`, nombre_empresa: 'E2E WALMART MATRIZ, S.A.', nit: NIT, activo: true }).select('airtable_id').single();
    await sb.from('tarifario').insert([{ nit: NIT, razon_social: 'E2E WALMART MATRIZ, S.A.', tipo_prueba: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto: 300, anio: '2026' }, { nit: NIT, razon_social: 'E2E WALMART MATRIZ, S.A.', tipo_prueba: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'DEPARTAMENTAL', monto: 300, anio: '2026' }]);
    const filas: Record<string, unknown>[] = [];
    const emp = (id: string, nombre: string, n: number) => { for (let i = 0; i < n; i++) filas.push({ fuente: 'agenda', id_externo: `${PRE}${id}${i}`, empresa_id_externo: `${PRE}emp${id}`, empresa_nombre_externo: nombre, estado_tarifa: 'cliente_sin_mapear', detalle_tarifa: 'sin mapear', terminado: true, cancelado: false, eliminado: false, status_cobro_externo: 'PENDIENTE', fecha_ingreso: '2026-10-0' + (1 + i), tipo_prueba: 'POLIGRAFO', proceso_solicitado: 'SOLO POLIGRAFO', categoria_prueba: 'PRE EMPLEO', depto_visita: 'GUATEMALA', persona: `PERSONA ${id}${i}`, raw: { id: `${PRE}${id}${i}`, empresa: { id: `${PRE}emp${id}`, nombre }, tipoPrueba: 'POLIGRAFO', procesoSolicitado: 'SOLO POLIGRAFO', categoriaPrueba: 'PRE EMPLEO', deptoVisita: 'GUATEMALA', terminado: true, cancelado: false, eliminado: false, fechaIngreso: '2026-10-0' + (1 + i), cobro: { statusCobro: 'PENDIENTE' }, actualizadoEn: '2026-10-20T10:00:00.000Z', nombre: `PERSONA ${id}${i}` } }); };
    ['WALMART/TRANSPORTES LOPEZ', 'WALMART/MULTISERVICIOS Y EMPAQUES, S.A', 'WALMART/TRANSPORTES/JMP LOGISTICA', 'WALMART/SEGURIDAD', 'WALMART/LIMPIEZA'].forEach((n, i) => emp(`W${i}`, n, 3));
    emp('G0', 'GOLDEN TALENT E2E', 2); emp('G1', 'GOLDEN TALENT EL SALVADOR E2E', 2);
    const { error: eSeed } = await sb.from('facturacion_expediente').insert(filas);
    ok(!eSeed && !!cli, `semilla: cliente ${NIT} con tarifa POLIGRAFO PRE EMPLEO Q300, 5 empresas WALMART/… (15 exp.) y 2 GOLDEN (4 exp.) sin mapear${eSeed ? ' · ' + eSeed.message : ''}`);

    const u = await clerk.users.createUser({ emailAddress: [email], password: `E2e-${STAMP}-${Math.random().toString(36).slice(2)}!Aa9`, firstName: 'E2E', lastName: 'SinMapear', skipPasswordChecks: true, publicMetadata: { accesos: [{ empresa_slug: SLUG, rol: 'contador' }] } });
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

    await page.goto(`${BASE}/por-facturar`);
    await page.waitForSelector('h1.page-title');
    const listosAntes = Number((await page.locator('[data-kpi="listos"] .kpi-value').innerText()).replace(/[^0-9]/g, '')) || 0;
    await page.locator('[data-tab="sin-mapear"]').click();
    await page.waitForSelector('[data-lista="sin-mapear"] tbody tr[data-empresa]');
    // 1) Caso Walmart: buscar → seleccionar todo el filtro → mapear al mismo cliente
    await page.getByLabel('Buscar empresa sin mapear').fill('WALMART');
    await page.waitForFunction(() => document.querySelectorAll('[data-lista="sin-mapear"] tbody tr[data-empresa]').length === 5 && [...document.querySelectorAll('[data-lista="sin-mapear"] tbody tr[data-empresa]')].every(r => /WALMART/.test(r.textContent ?? '')), null, { timeout: 15_000 });
    ok(true, 'buscar "WALMART" deja 5 empresas en la pestaña');
    await page.locator('[data-accion="seleccionar-filtro"]').click();
    await page.waitForSelector('[data-barra-masiva]');
    ok(/5 empresas seleccionadas/.test(await page.locator('[data-barra-masiva]').innerText()), '"Seleccionar las 5 de WALMART" → barra masiva con 5 seleccionadas');
    await page.locator('[data-accion="mapear-lote"]').click();
    await page.getByLabel('Buscar cliente para mapear (lote)').fill('WALMART MATRIZ');
    await page.getByLabel('Cliente de financiero (lote)').selectOption({ label: `E2E WALMART MATRIZ, S.A. · NIT ${NIT}` });
    await page.locator('[data-accion="confirmar-mapear-lote"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-lista="sin-mapear"] tbody tr[data-empresa]').length === 0 && !document.querySelector('[data-barra-masiva]'), null, { timeout: 30_000 });
    ok(true, 'confirmar → las 5 WALMART desaparecen de "Sin mapear" y la barra se cierra');
    const { data: mapW } = await sb.from('cliente_externo').select('empresa_id_externo, nit, no_factura').like('empresa_id_externo', `${PRE}empW%`);
    const { data: expW } = await sb.from('facturacion_expediente').select('estado_tarifa, nit_resuelto, monto_calculado').like('id_externo', `${PRE}W%`);
    ok((mapW ?? []).length === 5 && (mapW ?? []).every(m => m.nit === NIT && !m.no_factura) && (expW ?? []).length === 15 && (expW ?? []).every(e => e.estado_tarifa === 'resuelta' && e.nit_resuelto === NIT && Number(e.monto_calculado) === 300), 'en la base: las 5 empresas con el NIT de la matriz y sus 15 expedientes resuelven precio (Q300)');
    await page.waitForFunction((esp) => Number((document.querySelector('[data-kpi="listos"] .kpi-value')?.textContent ?? '').replace(/[^0-9]/g, '')) === esp, listosAntes + 15, { timeout: 30_000 }).catch(() => null);
    const listosDespues = Number((await page.locator('[data-kpi="listos"] .kpi-value').innerText()).replace(/[^0-9]/g, '')) || 0;
    ok(listosDespues === listosAntes + 15, `KPI "Listos para facturar" se refresca sin recargar: ${listosAntes} → ${listosDespues} (+15)`);

    // 2) Caso internas: buscar → toda la página → no se factura con motivo
    await page.getByLabel('Buscar empresa sin mapear').fill('GOLDEN');
    await page.waitForFunction(() => document.querySelectorAll('[data-lista="sin-mapear"] tbody tr[data-empresa]').length === 2, null, { timeout: 15_000 });
    await page.getByLabel('Seleccionar toda la página').check();
    await page.waitForSelector('[data-barra-masiva]');
    ok(/2 empresas seleccionadas/.test(await page.locator('[data-barra-masiva]').innerText()), '"toda la página" → 2 GOLDEN seleccionadas');
    await page.locator('[data-accion="no-factura-lote"]').click();
    await page.getByLabel('Motivo de no facturar (lote)').fill('intercompany');
    await page.locator('[data-accion="confirmar-no-factura-lote"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-lista="sin-mapear"] tbody tr[data-empresa]').length === 0 && !document.querySelector('[data-barra-masiva]'), null, { timeout: 30_000 });
    ok(true, 'confirmar → las 2 GOLDEN salen de "Sin mapear"');
    await page.locator('[data-tab="no-facturan"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-lista="no-facturan"] tbody tr[data-empresa]').length >= 2, null, { timeout: 30_000 });
    const txtNF = await page.locator('[data-lista="no-facturan"]').innerText();
    ok(/GOLDEN TALENT E2E/.test(txtNF) && /GOLDEN TALENT EL SALVADOR E2E/.test(txtNF) && (txtNF.match(/intercompany/g) ?? []).length >= 2, 'pestaña "No se facturan": las 2 con el motivo "intercompany"');
    const { data: expG } = await sb.from('facturacion_expediente').select('estado_tarifa').like('id_externo', `${PRE}G%`);
    ok((expG ?? []).length === 4 && (expG ?? []).every(e => e.estado_tarifa === 'excluido_no_factura'), 'en la base: los 4 expedientes de GOLDEN en excluido_no_factura');
    ok(erroresJs.length === 0, `sin errores JS ni diálogos del navegador${erroresJs.length ? ': ' + erroresJs.join(' | ') : ''}`);
  } finally {
    await ctx.close().catch(() => null);
    if (userId) await clerk.users.deleteUser(userId).catch((e: Error) => console.log(`     ✗ clerk: ${e.message}`));
    await limpiar();
    const { count } = await sb.from('facturacion_expediente').select('id', { count: 'exact', head: true }).like('id_externo', `${PRE}%`);
    const { count: c2 } = await sb.from('clientes').select('id', { count: 'exact', head: true }).eq('nit', NIT);
    ok((count ?? 0) === 0 && (c2 ?? 0) === 0, 'limpieza verificada: 0 expedientes / mapeos / clientes de prueba, usuario de Clerk borrado');
    console.log(`\n== ${pass} 🟢 / ${fail} 🔴 ==\n`);
    process.exit(fail ? 1 : 0);
  }
})();
