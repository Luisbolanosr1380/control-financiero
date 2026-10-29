/**
 * TARIFARIO · FORMAS DE PRECIO — E2E en Chrome sobre un `next start` con la base de HIT.
 * Usuario descartable de Clerk (contador). Prueba el form de alta: con INFORNET se
 * ocultan categoría y territorio (precio único); con SOCIO EMPRESARIAL se oculta la
 * categoría y quedan los territorios; al guardar, la tabla muestra "—" en las
 * dimensiones que no aplican y en la base queda el centinela UNICA. Limpia todo.
 *
 * Uso: npx tsx scripts/e2e-formas-precio.ts --env hit --base http://localhost:3012
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
const NIT = '99990031K';

(async () => {
  const { chromium } = await import('playwright-core');
  const { createClerkClient } = await import(path.resolve(process.cwd(), 'node_modules/@clerk/backend/dist/index.mjs'));
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  const STAMP = Date.now().toString(36);
  const email = `e2e.formas+${STAMP}@example.com`;
  let userId: string | null = null;
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-formas-'));
  const ctx = await chromium.launchPersistentContext(perfil, { executablePath: CHROME, headless: true, args: [`--user-agent=${UA}`], viewport: { width: 1440, height: 900 }, userAgent: UA, locale: 'es-GT' });
  console.log(`\nE2E formas de precio · ${ENV.toUpperCase()} · ${BASE}`);
  try {
    await sb.from('tarifario').delete().eq('nit', NIT);
    const u = await clerk.users.createUser({ emailAddress: [email], password: `E2e-${STAMP}-${Math.random().toString(36).slice(2)}!Aa9`, firstName: 'E2E', lastName: 'Formas', skipPasswordChecks: true, publicMetadata: { accesos: [{ empresa_slug: SLUG, rol: 'contador' }] } });
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

    await page.goto(`${BASE}/tarifario`);
    await page.waitForSelector('h1.page-title');
    await page.getByRole('tab', { name: 'Ver todas' }).click();
    await page.getByRole('button', { name: 'Nueva tarifa' }).click();
    const dlg = page.locator('[role=dialog]');
    await dlg.locator('#tf-nit').fill(NIT);
    await dlg.locator('#tf-razon').fill('E2E FORMAS S.A.');
    ok(await dlg.locator('#tf-cat').isVisible() && await dlg.getByLabel('METROPOLITANA', { exact: true }).isVisible(), 'POLIGRAFO (matriz): el form muestra categoría y territorios');
    await dlg.locator('#tf-tipo').selectOption('INFORNET');
    await page.waitForSelector('[role=dialog] [data-forma="unico"]');
    ok(await dlg.locator('#tf-cat').count() === 0 && await dlg.getByLabel('METROPOLITANA', { exact: true }).count() === 0 && /Precio único por cliente/.test(await dlg.innerText()), 'INFORNET (único): se ocultan categoría y territorio y se explica la forma');
    await dlg.locator('#tf-monto').fill('44.64');
    await dlg.getByRole('button', { name: 'Guardar tarifa' }).click();
    await page.waitForFunction((n) => [...document.querySelectorAll('table tbody tr')].some(r => r.textContent?.includes(`NIT ${n}`) && r.textContent?.includes('INFORNET')), NIT, { timeout: 30_000 });
    const filaInf = page.locator('table tbody tr', { hasText: `NIT ${NIT}` }).filter({ hasText: 'INFORNET' }).first();
    const celdas = await filaInf.locator('td').allInnerTexts();
    ok(celdas[2].trim() === '—' && celdas[3].trim() === '—' && /44\.64/.test(celdas[4]), `tabla: INFORNET con "—" en categoría y territorio y Q44.64 (${celdas.slice(1, 5).map(c => c.trim()).join(' | ')})`);
    const { data: enBase } = await sb.from('tarifario').select('tipo_prueba, categoria, territorio, monto').eq('nit', NIT);
    ok((enBase ?? []).length === 1 && enBase![0].tipo_prueba === 'INFORNET' && enBase![0].categoria === 'UNICA' && enBase![0].territorio === 'UNICA' && Number(enBase![0].monto) === 44.64, 'en la base: una sola fila INFORNET · UNICA · UNICA');

    await page.getByRole('button', { name: 'Nueva tarifa' }).click();
    await dlg.locator('#tf-nit').fill(NIT);
    await dlg.locator('#tf-tipo').selectOption('SOCIOECONOMICO EMPRESARIAL');
    await page.waitForSelector('[role=dialog] [data-forma="territorio"]');
    ok(await dlg.locator('#tf-cat').count() === 0 && await dlg.getByLabel('METROPOLITANA', { exact: true }).isVisible() && await dlg.getByLabel('DEPARTAMENTAL', { exact: true }).isVisible(), 'SOCIO EMPRESARIAL (por territorio): sin categoría, con los dos territorios');
    await dlg.locator('#tf-monto').fill('600');
    await dlg.getByRole('button', { name: 'Guardar tarifa' }).click();
    await page.waitForFunction((n) => [...document.querySelectorAll('table tbody tr')].filter(r => r.textContent?.includes(`NIT ${n}`) && r.textContent?.includes('SOCIOECONOMICO EMPRESARIAL')).length === 2, NIT, { timeout: 30_000 });
    const filasSE = page.locator('table tbody tr', { hasText: `NIT ${NIT}` }).filter({ hasText: 'SOCIOECONOMICO EMPRESARIAL' });
    const c1 = await filasSE.nth(0).locator('td').allInnerTexts();
    ok(await filasSE.count() === 2 && c1[2].trim() === '—' && /METROPOLITANA|DEPARTAMENTAL/.test(c1[3]), 'tabla: 2 filas SOCIO EMPRESARIAL con "—" en categoría y su territorio');
    const { data: enBase2 } = await sb.from('tarifario').select('tipo_prueba, categoria, territorio').eq('nit', NIT).eq('tipo_prueba', 'SOCIOECONOMICO EMPRESARIAL');
    ok((enBase2 ?? []).length === 2 && enBase2!.every(r => r.categoria === 'UNICA') && new Set(enBase2!.map(r => r.territorio)).size === 2, 'en la base: SOCIOECONOMICO EMPRESARIAL · UNICA · METROPOLITANA / DEPARTAMENTAL');
    // Simulador: INFORNET sin categoría ni territorio resuelve
    await page.getByLabel('NIT', { exact: true }).fill(NIT);
    await page.getByLabel('Tipo de prueba').selectOption('INFORNET');
    await page.getByRole('button', { name: 'Resolver precio' }).click();
    await page.waitForFunction(() => /Q44\.64 sin IVA/.test(document.body.innerText), null, { timeout: 30_000 });
    ok(true, 'simulador: INFORNET para el NIT → Q44.64 sin IVA (sin pedir categoría ni territorio)');
    ok(erroresJs.length === 0, `sin errores JS ni diálogos del navegador${erroresJs.length ? ': ' + erroresJs.join(' | ') : ''}`);
  } finally {
    await ctx.close().catch(() => null);
    if (userId) await clerk.users.deleteUser(userId).catch((e: Error) => console.log(`     ✗ clerk: ${e.message}`));
    await sb.from('tarifario').delete().eq('nit', NIT);
    const { count } = await sb.from('tarifario').select('id', { count: 'exact', head: true }).eq('nit', NIT);
    ok((count ?? 0) === 0, 'limpieza verificada: 0 filas del NIT de prueba, usuario de Clerk borrado');
    console.log(`\n== ${pass} 🟢 / ${fail} 🔴 ==\n`);
    process.exit(fail ? 1 : 0);
  }
})();
