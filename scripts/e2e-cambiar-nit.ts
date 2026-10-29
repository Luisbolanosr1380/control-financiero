/**
 * CLIENTES · CAMBIAR NIT (023) — E2E en Chrome sobre un `next start` con la base de HIT.
 * Usuario descartable de Clerk (contador). Siembra un cliente A (NIT_A) con 2 tarifas,
 * un mapeo de la Agenda y un expediente resuelto, y un cliente B (NIT_B) con una tarifa
 * que choca con A. Desde la FICHA de A: "Cambiar NIT" → a NIT_B muestra el choque y no
 * deja aplicar; se quita la tarifa en choque de B; a NIT_X el resumen cuenta 2 tarifas,
 * 1 empresa y 1 expediente → confirmar → la ficha muestra el NIT nuevo y en la base se
 * movió todo. Desde el TARIFARIO de X: "Cambiar NIT" → a NIT_B (de B) pide aceptar el
 * NIT compartido → aceptar → confirmar → navega a /tarifario/NIT_B con las tarifas de
 * ambos. Sin diálogos del navegador. Limpia todo.
 *
 * Uso: npx tsx scripts/e2e-cambiar-nit.ts --env hit --base http://localhost:3012
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
const NIT_A = '99990041K', NIT_B = '99990042K', NIT_X = '99990043K';
const ID_A = 'sbwE2ECNIT01', ID_B = 'sbwE2ECNIT02', EMP = 'recE2ECNITemp', EXP = 'recE2ECNIT001';
const ACTOR = 'e2e@cambiar-nit';

(async () => {
  const { chromium } = await import('playwright-core');
  const { createClerkClient } = await import(path.resolve(process.cwd(), 'node_modules/@clerk/backend/dist/index.mjs'));
  const { supabase } = await import('../src/lib/supabase/client');
  const { crearTarifa } = await import('../src/lib/db/tarifario');
  const sb = supabase()!;
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  const STAMP = Date.now().toString(36);
  const email = `e2e.cnit+${STAMP}@example.com`;
  let userId: string | null = null;
  const NITS = [NIT_A, NIT_B, NIT_X];
  const limpiar = async () => {
    await sb.from('facturacion_expediente').delete().eq('id_externo', EXP);
    await sb.from('cliente_externo').delete().eq('empresa_id_externo', EMP);
    await sb.from('tarifario').delete().in('nit', NITS);
    await sb.from('clientes').delete().in('airtable_id', [ID_A, ID_B]);
  };
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-cnit-'));
  const ctx = await chromium.launchPersistentContext(perfil, { executablePath: CHROME, headless: true, args: [`--user-agent=${UA}`], viewport: { width: 1440, height: 900 }, userAgent: UA, locale: 'es-GT' });
  console.log(`\nE2E cambiar NIT · ${ENV.toUpperCase()} · ${BASE}`);
  try {
    await limpiar();
    // Semilla: A con 2 tarifas + mapeo + expediente resuelto; B con una tarifa que choca con A
    const { data: cA } = await sb.from('clientes').insert({ airtable_id: ID_A, nombre_empresa: 'E2E CAMBIO NIT, S.A.', razon_social: 'E2E CAMBIO NIT, SOCIEDAD ANONIMA', nit: NIT_A, activo: true }).select('id').single();
    const { data: cB } = await sb.from('clientes').insert({ airtable_id: ID_B, nombre_empresa: 'E2E DESTINO, S.A.', nit: NIT_B, activo: true }).select('id').single();
    const t1 = await crearTarifa({ nit: NIT_A, razonSocial: 'E2E CAMBIO NIT, S.A.', tipoPrueba: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto: 350, anio: '2026' }, ACTOR);
    const t2 = await crearTarifa({ nit: NIT_A, razonSocial: 'E2E CAMBIO NIT, S.A.', tipoPrueba: 'INFORNET', categoria: '', territorio: '', monto: 44.64, anio: '2026' }, ACTOR);
    const tB = await crearTarifa({ nit: NIT_B, razonSocial: 'E2E DESTINO, S.A.', tipoPrueba: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto: 999, anio: '2026' }, ACTOR);
    const { error: eM } = await sb.from('cliente_externo').insert({ fuente: 'agenda', empresa_id_externo: EMP, empresa_nombre_externo: 'E2E CAMBIO NIT (AGENDA)', nit: NIT_A, cliente_id: cA!.id, activo: true, creado_por: ACTOR });
    const { error: eE } = await sb.from('facturacion_expediente').insert({ fuente: 'agenda', id_externo: EXP, empresa_id_externo: EMP, empresa_nombre_externo: 'E2E CAMBIO NIT (AGENDA)', nit_resuelto: NIT_A, cliente_id: cA!.id, tipo_cobrado: 'POLIGRAFO', estado_tarifa: 'resuelta', monto_calculado: 350, detalle_tarifa: 'sembrado', terminado: true, cancelado: false, eliminado: false, status_cobro_externo: 'PENDIENTE', fecha_ingreso: '2026-10-15', tipo_prueba: 'POLIGRAFO', proceso_solicitado: 'SOLO POLIGRAFO', categoria_prueba: 'PRE EMPLEO', depto_visita: 'GUATEMALA', persona: 'PERSONA E2E', raw: { id: EXP, empresa: { id: EMP, nombre: 'E2E CAMBIO NIT (AGENDA)' }, tipoPrueba: 'POLIGRAFO', procesoSolicitado: 'SOLO POLIGRAFO', categoriaPrueba: 'PRE EMPLEO', deptoVisita: 'GUATEMALA', terminado: true, cancelado: false, eliminado: false, fechaIngreso: '2026-10-15', cobro: { statusCobro: 'PENDIENTE' }, actualizadoEn: '2026-10-20T10:00:00.000Z', nombre: 'PERSONA E2E' } });
    ok(!!cA && !!cB && t1.ok && t2.ok && tB.ok && !eM && !eE, `semilla: A (${NIT_A}) con POLIGRAFO Q350 + INFORNET Q44.64, 1 empresa de la Agenda mapeada y 1 expediente resuelto; B (${NIT_B}) con POLIGRAFO · PRE EMPLEO · METROPOLITANA Q999 (choque)`);

    const u = await clerk.users.createUser({ emailAddress: [email], password: `E2e-${STAMP}-${Math.random().toString(36).slice(2)}!Aa9`, firstName: 'E2E', lastName: 'CambiarNit', skipPasswordChecks: true, publicMetadata: { accesos: [{ empresa_slug: SLUG, rol: 'contador' }] } });
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

    // ── Ficha del cliente A: choque → no aplica; NIT_X → resumen → confirmar ──
    await page.goto(`${BASE}/clientes/${ID_A}`);
    await page.waitForSelector('[data-nombres-cliente]');
    ok(/NIT 99990041K/.test(await page.locator('[data-nombres-cliente]').innerText()), 'ficha de A: muestra NIT 99990041K y el botón "Cambiar NIT"');
    await page.locator('[data-nombres-cliente] [data-accion="cambiar-nit"]').click();
    const dlg = page.locator('[role=dialog][data-cambiar-nit]');
    await dlg.waitFor();
    ok(await dlg.locator('#cn-actual').inputValue() === NIT_A && await dlg.locator('#cn-actual').isDisabled() && await dlg.locator('[data-accion="confirmar-cambiar-nit"]').isDisabled(), 'modal: NIT actual solo lectura; confirmar deshabilitado hasta tener un resumen válido');
    await dlg.locator('#cn-nuevo').fill('CF');
    ok(/no sirven como NIT/.test(await dlg.innerText()) && await dlg.locator('[data-resumen]').count() === 0, 'CF → aviso de placeholder sin ir a la base, sin resumen');
    await dlg.locator('#cn-nuevo').fill(NIT_B);
    await page.waitForSelector('[data-cambiar-nit] [data-resumen][data-estado="tarifa_choque"]');
    const txtChoque = await dlg.locator('[data-choque]').innerText();
    ok(/POLIGRAFO/.test(txtChoque) && /PRE EMPLEO/.test(txtChoque) && /METROPOLITANA/.test(txtChoque) && /350\.00/.test(txtChoque) && /999\.00/.test(txtChoque) && /No se aplica/.test(txtChoque) && await dlg.locator('[data-accion="confirmar-cambiar-nit"]').isDisabled(), `a ${NIT_B}: choque de llave POLIGRAFO · PRE EMPLEO · METROPOLITANA (Q350 vs Q999) → "No se aplica", confirmar deshabilitado`);
    await dlg.locator('#cn-nuevo').fill(NIT_X);
    await page.waitForSelector('[data-cambiar-nit] [data-resumen][data-estado="ok"]');
    const txtOk = await dlg.locator('[data-resumen]').innerText();
    ok(/Tarifas\s*2/.test(txtOk.replace(/\n/g, ' ')) && /Histórico de precios\s*2/.test(txtOk.replace(/\n/g, ' ')) && /Empresas de la Agenda mapeadas\s*1/.test(txtOk.replace(/\n/g, ' ')) && /Expedientes resueltos a este NIT\s*1/.test(txtOk.replace(/\n/g, ' ')) && await dlg.locator('[data-accion="confirmar-cambiar-nit"]').isEnabled(), `a ${NIT_X}: resumen "se moverán" 2 tarifas, 2 de histórico, 1 empresa de la Agenda, 1 expediente; confirmar habilitado`);
    await dlg.locator('[data-accion="confirmar-cambiar-nit"]').click();
    await dlg.waitFor({ state: 'detached' });
    await page.waitForFunction((n) => document.querySelector('[data-nombres-cliente]')?.textContent?.includes(`NIT ${n}`), NIT_X, { timeout: 30_000 });
    ok(true, `confirmado: el modal cierra y la ficha muestra NIT ${NIT_X} (refresh)`);
    const [{ data: cliX }, { data: tarX }, { data: mapX }, { data: expX }] = await Promise.all([
      sb.from('clientes').select('nit').eq('airtable_id', ID_A).single(),
      sb.from('tarifario').select('nit, tipo_prueba, monto').in('nit', NITS).order('tipo_prueba'),
      sb.from('cliente_externo').select('nit').eq('empresa_id_externo', EMP).single(),
      sb.from('facturacion_expediente').select('nit_resuelto, estado_tarifa, monto_calculado').eq('id_externo', EXP).single(),
    ]);
    const tarDeX = (tarX ?? []).filter(t => t.nit === NIT_X);
    ok(cliX?.nit === NIT_X && tarDeX.length === 2 && !(tarX ?? []).some(t => t.nit === NIT_A) && mapX?.nit === NIT_X && expX?.nit_resuelto === NIT_X && expX?.estado_tarifa === 'resuelta' && Number(expX?.monto_calculado) === 350, `en la base: cliente, 2 tarifas, mapeo y expediente en ${NIT_X}; nada quedó en ${NIT_A}; el expediente sigue resuelto Q350`);

    // ── Tarifario de X: a NIT_B (de otro cliente, ya sin choque) → pide aceptar el NIT compartido → confirmar → navega a /tarifario/NIT_B ──
    if (tB.ok) await sb.from('tarifario').delete().eq('id', tB.id);
    const tB2 = await crearTarifa({ nit: NIT_B, razonSocial: 'E2E DESTINO, S.A.', tipoPrueba: 'PDA', categoria: '', territorio: '', monto: 3200, anio: '2026' }, ACTOR);
    await page.goto(`${BASE}/tarifario/${NIT_X}`);
    await page.waitForSelector('h1.page-title');
    ok(tB2.ok && /E2E CAMBIO NIT/.test(await page.locator('h1.page-title').innerText()) && await page.locator('table tbody tr').count() === 2, `/tarifario/${NIT_X}: la empresa con sus 2 tarifas (B ahora tiene PDA Q3,200, sin choque)`);
    await page.locator('.page-actions [data-accion="cambiar-nit"]').click();
    await dlg.waitFor();
    await dlg.locator('#cn-nuevo').fill(NIT_B);
    await page.waitForSelector('[data-cambiar-nit] [data-resumen][data-estado="nit_compartido"]');
    ok(/E2E DESTINO, S\.A\./.test(await dlg.locator('[data-compartido]').innerText()) && await dlg.locator('[data-accion="confirmar-cambiar-nit"]').isDisabled(), `a ${NIT_B}: "ya es de otro cliente: E2E DESTINO, S.A." → pide aceptar explícitamente; confirmar deshabilitado`);
    await dlg.locator('[data-accion="forzar-compartido"]').check();
    await page.waitForSelector('[data-cambiar-nit] [data-resumen][data-estado="ok"]');
    ok(await dlg.locator('[data-compartido-aceptado]').count() === 1 && await dlg.locator('[data-accion="confirmar-cambiar-nit"]').isEnabled(), 'aceptado el NIT compartido: el resumen vuelve a "ok" y confirmar se habilita');
    await dlg.locator('[data-accion="confirmar-cambiar-nit"]').click();
    await page.waitForURL(u2 => u2.pathname === `/tarifario/${NIT_B}`, { timeout: 30_000 });
    await page.waitForSelector('h1.page-title');
    await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length === 3, null, { timeout: 30_000 });
    const [{ data: cliB2 }, { data: tarB2 }] = await Promise.all([
      sb.from('clientes').select('nit').eq('airtable_id', ID_A).single(),
      sb.from('tarifario').select('nit').in('nit', NITS),
    ]);
    ok(cliB2?.nit === NIT_B && (tarB2 ?? []).length === 3 && (tarB2 ?? []).every(t => t.nit === NIT_B), `navega a /tarifario/${NIT_B} con 3 tarifas (2 de A + PDA de B); en la base A quedó con NIT ${NIT_B} (compartido, aceptado)`);
    ok(erroresJs.length === 0, `sin errores JS ni diálogos del navegador${erroresJs.length ? ': ' + erroresJs.join(' | ') : ''}`);
  } finally {
    await ctx.close().catch(() => null);
    if (userId) await clerk.users.deleteUser(userId).catch((e: Error) => console.log(`     ✗ clerk: ${e.message}`));
    await limpiar();
    const [{ count: a }, { count: b }, { count: c }, { count: d }] = await Promise.all([
      sb.from('tarifario').select('id', { count: 'exact', head: true }).in('nit', NITS),
      sb.from('clientes').select('id', { count: 'exact', head: true }).in('airtable_id', [ID_A, ID_B]),
      sb.from('cliente_externo').select('id', { count: 'exact', head: true }).eq('empresa_id_externo', EMP),
      sb.from('facturacion_expediente').select('id', { count: 'exact', head: true }).eq('id_externo', EXP),
    ]);
    ok(a === 0 && b === 0 && c === 0 && d === 0, 'limpieza verificada: 0 tarifas / clientes / mapeos / expedientes de prueba, usuario de Clerk borrado');
    console.log(`\n== ${pass} 🟢 / ${fail} 🔴 ==\n`);
    process.exit(fail ? 1 : 0);
  }
})();
