/**
 * TARIFARIO — E2E en navegador real (Chrome) sobre un `next start` con la base
 * del env indicado (HIT: tarifario vacío). Usuario DESCARTABLE de Clerk rol
 * contador (catalogos). Prueba la pantalla: alta con el aviso de combinación
 * repetida (otra grafía) y su confirmación, edición inline del monto, aprobar,
 * el simulador de precio (motor de lookup) y el CSV. Limpia todo.
 *
 * Uso: npx tsx --conditions=react-server scripts/e2e-tarifario.ts --env hit --base http://localhost:3012
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ENV = arg('--env', 'hit');
const BASE = arg('--base', 'http://localhost:3012').replace(/\/$/, '');
const CHROME = arg('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const SHOTS = arg('--capturas', path.join(process.cwd(), '.e2e-tarifario'));
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
const NIT = '99990002K';

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const { chromium } = await import('playwright-core');
  const { createClerkClient } = await import(path.resolve(process.cwd(), 'node_modules/@clerk/backend/dist/index.mjs'));
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  const STAMP = Date.now().toString(36);
  const email = `e2e.tarifario+${STAMP}@example.com`;
  let userId: string | null = null;
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-tarifario-'));
  const ctx = await chromium.launchPersistentContext(perfil, { executablePath: CHROME, headless: true, args: [`--user-agent=${UA}`], acceptDownloads: true, viewport: { width: 1440, height: 900 }, userAgent: UA, locale: 'es-GT' });
  console.log(`\nE2E tarifario · ${ENV.toUpperCase()} · ${BASE}`);
  try {
    const u = await clerk.users.createUser({ emailAddress: [email], password: `E2e-${STAMP}-${Math.random().toString(36).slice(2)}!Aa9`, firstName: 'E2E', lastName: 'Tarifario', skipPasswordChecks: true, publicMetadata: { accesos: [{ empresa_slug: SLUG, rol: 'contador' }] } });
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
    ok(true, `sesión real de Clerk para usuario descartable rol contador en ${SLUG}`);

    await page.goto(`${BASE}/tarifario`);
    await page.waitForSelector('h1.page-title');
    ok((await page.locator('h1.page-title').innerText()).trim() === 'Tarifario', '/tarifario carga con el título');
    ok(await page.locator('a[href="/tarifario"]').first().isVisible(), 'ítem "Tarifario" en el sidebar');

    // ── Alta ──
    await page.getByRole('button', { name: 'Nueva tarifa' }).click();
    await page.locator('#tf-nit').fill(NIT);
    await page.locator('#tf-razon').fill('E2E TARIFARIO UI S.A.');
    await page.locator('#tf-tipo').selectOption('POLIGRAFO');
    await page.locator('#tf-cat').selectOption('PRE EMPLEO');
    await page.locator('#tf-monto').fill('0');
    ok(/sin tarifa definida/.test(await page.locator('[role=dialog]').innerText()), 'Q0 en el form avisa "sin tarifa definida, no gratis"');
    await page.locator('#tf-monto').fill('350');
    await page.getByRole('button', { name: 'Guardar tarifa' }).click();
    await page.waitForFunction((n) => document.body.innerText.includes(`NIT ${n}`), NIT, { timeout: 30_000 });
    const filas = page.locator('table tbody tr', { hasText: `NIT ${NIT}` });
    ok(await filas.count() === 2, 'alta con los dos territorios → 2 filas (METROPOLITANA y DEPARTAMENTAL) a Q350');
    const { data: enBase } = await sb.from('tarifario').select('tipo_prueba, categoria, territorio, monto, aprobado_en').eq('nit', NIT).order('territorio');
    ok((enBase ?? []).length === 2 && (enBase ?? []).every(r => r.tipo_prueba === 'POLIGRAFO' && r.categoria === 'PRE EMPLEO' && Number(r.monto) === 350 && !r.aprobado_en), 'en la base: canónicas, Q350, pendientes de aprobación');

    // ── Repetida con otra grafía ──
    await page.getByRole('button', { name: 'Nueva tarifa' }).click();
    await page.locator('#tf-nit').fill(NIT);
    await page.locator('#tf-nit').blur();
    await page.locator('#tf-tipo').selectOption('__otro');
    await page.getByLabel('Otro tipo de prueba').fill('Polígrafo');
    await page.locator('[role=dialog]').getByLabel('DEPARTAMENTAL', { exact: true }).uncheck();
    await page.waitForFunction(() => /Ya existe una tarifa para esta combinación/.test(document.querySelector('[role=dialog]')?.textContent ?? ''), null, { timeout: 15_000 }).catch(() => null);
    ok(/Ya existe una tarifa para esta combinación/.test(await page.locator('[role=dialog]').innerText()), 'aviso bajo el form: "Ya existe una tarifa para esta combinación" (Polígrafo con acento = POLIGRAFO)');
    await page.locator('#tf-monto').fill('360');
    await page.getByRole('button', { name: 'Guardar tarifa' }).click();
    await page.locator('[role=alertdialog]').waitFor();
    ok(/Guardar de todos modos/.test(await page.locator('[role=alertdialog]').innerText()), 'al guardar pide confirmación en el pie del modal (sin confirm() del navegador)');
    await page.screenshot({ path: path.join(SHOTS, 'tarifa-repetida.png') });
    await page.getByRole('button', { name: 'Volver' }).click();
    await page.keyboard.press('Escape');
    ok((await page.locator('[role=dialog]').count()) === 0, 'Volver + Esc cierran sin crear');
    const { count: n2 } = await sb.from('tarifario').select('id', { count: 'exact', head: true }).eq('nit', NIT);
    ok(n2 === 2, 'siguen 2 filas (la repetida no se creó)');

    // ── Aprobar + editar monto ──
    const filaMetro = page.locator('table tbody tr', { hasText: `NIT ${NIT}` }).filter({ hasText: 'METROPOLITANA' });
    await filaMetro.getByRole('button', { name: 'Aprobar' }).click();
    await page.waitForFunction(() => /Tarifa aprobada por/.test(document.body.innerText), null, { timeout: 30_000 });
    await page.waitForFunction((n) => { const tr = [...document.querySelectorAll('table tbody tr')].find(r => r.textContent?.includes(`NIT ${n}`) && r.textContent?.includes('METROPOLITANA')); return /Aprobada/.test(tr?.textContent ?? ''); }, NIT, { timeout: 30_000 });
    ok(/Aprobada/.test(await filaMetro.innerText()) && /e2e\.tarifario/.test(await filaMetro.innerText()), 'Aprobar → badge "Aprobada" con quién (gobierno)');
    await filaMetro.getByRole('button', { name: /Editar monto de/ }).click();
    const inp = filaMetro.locator('input[aria-label^="Monto de"]');
    await inp.fill('375');
    await inp.press('Enter');
    await page.waitForFunction(() => /queda pendiente de aprobación/.test(document.body.innerText), null, { timeout: 30_000 });
    await page.waitForFunction((n) => { const tr = [...document.querySelectorAll('table tbody tr')].find(r => r.textContent?.includes(`NIT ${n}`) && r.textContent?.includes('METROPOLITANA')); return /Q375/.test(tr?.textContent ?? '') && /Pendiente/.test(tr?.textContent ?? ''); }, NIT, { timeout: 30_000 });
    ok(true, 'editar monto inline (Enter) → Q375 y vuelve a "Pendiente"');

    // ── Simulador (motor) ──
    await page.getByLabel('Empresa', { exact: true }).fill('e2e tarifario ui s.a.');
    await page.getByLabel('Tipo de prueba', { exact: true }).selectOption('POLIGRAFO');
    await page.getByLabel('Categoría', { exact: true }).selectOption('PRE EMPLEO');
    await page.getByRole('button', { name: 'Resolver precio' }).click();
    // METRO quedó en Q375 y DEPARTAMENTAL en Q350: sin territorio el motor debe pedirlo (ambigua), no adivinar.
    await page.waitForSelector('[role=status]:has-text("Ambigua"), [role=status]:has-text("sin IVA"), [role=status]:has-text("No encontrada")');
    const simTxt = await page.locator('[role=status]').filter({ hasText: /Ambigua|sin IVA|No encontrada/ }).first().innerText();
    ok(/Ambigua/.test(simTxt) && /cambia según el territorio/.test(simTxt) && /METROPOLITANA Q375\.00/.test(simTxt) && /DEPARTAMENTAL Q350\.00/.test(simTxt), `simulador por empresa (alias) sin territorio y precios distintos → ambigua: ${simTxt.replace(/\s+/g, ' ').slice(0, 150)}`);
    await page.getByLabel('Territorio', { exact: true }).selectOption('DEPARTAMENTAL');
    await page.getByRole('button', { name: 'Resolver precio' }).click();
    await page.waitForFunction(() => /Q350\.00 sin IVA/.test(document.body.innerText), null, { timeout: 30_000 });
    const simTxt2 = await page.locator('[role=status]').filter({ hasText: /sin IVA/ }).first().innerText();
    ok(/Q350\.00 sin IVA/.test(simTxt2) && /total Q392\.00/.test(simTxt2) && /Tarifa no aprobada/.test(simTxt2), `simulador con territorio DEPARTAMENTAL → Q350.00 sin IVA, total Q392.00, no aprobada: ${simTxt2.replace(/\s+/g, ' ').slice(0, 120)}`);
    await page.screenshot({ path: path.join(SHOTS, 'tarifario.png'), fullPage: true });

    // ── CSV ──
    await page.locator('input[placeholder="NIT o razón social…"]').fill(NIT);
    const [descarga] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByRole('button', { name: 'Exportar CSV' }).click()]);
    const csvPath = path.join(SHOTS, descarga.suggestedFilename() || 'tarifario.csv'); await descarga.saveAs(csvPath);
    const csv = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/);
    ok(csv[0].startsWith('﻿NIT,Razon_Social,Tipo_Prueba,Categoria,Territorio,Monto_Sin_IVA,IVA,Total_Con_IVA') && csv.filter(l => l.startsWith(NIT)).length === 2 && csv.some(l => l.includes('375.00,45.00,420.00')), 'CSV: header con IVA y total, 2 filas del NIT, 375.00 → IVA 45.00 → 420.00');
    ok(erroresJs.length === 0, `sin errores de JavaScript ni diálogos del navegador${erroresJs.length ? `: ${erroresJs[0]}` : ''}`);
  } catch (e) {
    fail++; console.log(`  🔴 excepción: ${(e as Error).message}`);
    await ctx.pages()[0]?.screenshot({ path: path.join(SHOTS, 'error.png'), fullPage: true }).catch(() => null);
  } finally {
    await ctx.close().catch(() => null);
    if (userId) await clerk.users.deleteUser(userId).catch((e: Error) => console.log(`     ✗ clerk: ${e.message}`));
    const { error } = await sb.from('tarifario').delete().eq('nit', NIT); if (error) console.log(`     ✗ limpieza: ${error.message}`);
    const { count } = await sb.from('tarifario').select('id', { count: 'exact', head: true }).eq('nit', NIT);
    const usuarios = await clerk.users.getUserList({ emailAddress: [email] }).catch(() => ({ data: [] as unknown[] }));
    ok((count ?? 0) === 0 && usuarios.data.length === 0, `limpieza verificada: 0 filas del NIT ${NIT}, usuario de Clerk borrado`);
    console.log(`\n== ${pass} 🟢 / ${fail} 🔴 ==\n`);
    process.exit(fail ? 1 : 0);
  }
})();
