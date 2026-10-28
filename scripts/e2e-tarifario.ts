/**
 * TARIFARIO — E2E en navegador real (Chrome) sobre un `next start` con la base
 * del env indicado (HIT: tarifario vacío). Usuario DESCARTABLE de Clerk rol
 * contador (catalogos). Prueba la pantalla: alta con el aviso de combinación
 * repetida (otra grafía) y su confirmación, edición inline del monto, aprobar,
 * el simulador de precio (motor de lookup) y el CSV. Limpia todo.
 *
 * MAESTRO-DETALLE: siembra una empresa espejo de MEGAPACA (MPRH, 8 tarifas:
 * RUTINA Q89.29, PRE EMPLEO Q178.57, SOCIO PRE EMPLEO Q312.50 y 2 en Q0),
 * abre la lista de empresas → entra a su matriz (Q89.29 sin IVA = Q100 con
 * IVA) → edita una → aprueba en lote (las Q0 quedan fuera) → vuelve → busca.
 *
 * HISTÓRICO (015): edita el monto 2 veces con motivo → "Histórico" muestra los
 * 2 cambios con % y usuario y el sparkline → el lote deja 'Aprobación' →
 * desactivar deja 'Desactivación' → un UPDATE por SQL directo (sin GUC) también
 * queda, con usuario "—". Badges de antigüedad ("desde 2024 · estancada") y
 * KPI/filtro de estancadas en la lista de empresas.
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
const NIT_MP = '99990003K';   // espejo de MEGAPACA (MPRH, S.A.) para el flujo maestro-detalle

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
    ok(await page.getByRole('tab', { name: 'Por empresa' }).getAttribute('aria-selected') === 'true' && await page.getByLabel('Buscar empresa').isVisible(), 'modo por defecto: lista de empresas (maestro)');
    await page.getByRole('tab', { name: 'Ver todas' }).click();
    ok(await page.locator('input[placeholder="NIT o razón social…"]').isVisible(), '"Ver todas" recupera el listado plano con sus filtros');

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
    await filaMetro.locator('input[aria-label^="Motivo del cambio de"]').fill('ajuste anual');
    await inp.press('Enter');
    await page.waitForFunction(() => /queda pendiente de aprobación/.test(document.body.innerText), null, { timeout: 30_000 });
    await page.waitForFunction((n) => { const tr = [...document.querySelectorAll('table tbody tr')].find(r => r.textContent?.includes(`NIT ${n}`) && r.textContent?.includes('METROPOLITANA')); return /Q375/.test(tr?.textContent ?? '') && /Pendiente/.test(tr?.textContent ?? ''); }, NIT, { timeout: 30_000 });
    ok(true, 'editar monto inline (Enter) con motivo "ajuste anual" → Q375 y vuelve a "Pendiente"');
    // segundo cambio con motivo
    await filaMetro.getByRole('button', { name: /Editar monto de/ }).click();
    await filaMetro.locator('input[aria-label^="Monto de"]').fill('400');
    await filaMetro.locator('input[aria-label^="Motivo del cambio de"]').fill('renegociación');
    await filaMetro.getByRole('button', { name: 'Guardar' }).click();
    await page.waitForFunction((n) => { const tr = [...document.querySelectorAll('table tbody tr')].find(r => r.textContent?.includes(`NIT ${n}`) && r.textContent?.includes('METROPOLITANA')); return /Q400/.test(tr?.textContent ?? ''); }, NIT, { timeout: 30_000 });
    ok(/última subida: este mes/.test(await filaMetro.innerText()), 'segundo cambio (Guardar) → Q400; badge "última subida: este mes" (precio desde = la bitácora, no el año)');
    // ver histórico
    await filaMetro.getByRole('button', { name: /Ver histórico de/ }).click();
    const panel = page.locator('tr[data-historial-de]');
    await panel.waitFor();
    await page.waitForFunction(() => /renegociación/.test(document.querySelector('tr[data-historial-de]')?.textContent ?? ''), null, { timeout: 30_000 });
    const txtHist = (await panel.innerText()).replace(/\s+/g, ' ');
    ok(/Cambio de precio/.test(txtHist) && /Q350\.00 → Q375\.00/.test(txtHist) && /\+7\.14 %/.test(txtHist) && /Q375\.00 → Q400\.00/.test(txtHist) && /\+6\.67 %/.test(txtHist), `"Histórico": los 2 cambios de precio con su %: "${txtHist.slice(0, 160)}"`);
    ok(/ajuste anual/.test(txtHist) && /renegociación/.test(txtHist) && (txtHist.match(/e2e\.tarifario/g) ?? []).length >= 3 && /Alta/.test(txtHist) && /Aprobación/.test(txtHist), 'cada renglón trae motivo y usuario; también la Alta y la Aprobación previas');
    const spark = panel.locator('svg[role=img]');
    ok(await spark.count() === 1 && (await spark.getAttribute('aria-label')) === 'Precio: Q350.00 → Q375.00 → Q400.00' && /Cómo creció/.test(txtHist) && /Q350\.00 → Q400\.00/.test(txtHist) && /\+14\.29 %/.test(txtHist), 'sparkline con los 3 puntos de precio y crecimiento total Q350 → Q400 (+14.29 %)');
    await page.screenshot({ path: path.join(SHOTS, 'historico.png'), fullPage: true });
    await filaMetro.getByRole('button', { name: /Ver histórico de/ }).click();
    ok((await panel.count()) === 0, 'el botón vuelve a cerrar el histórico');

    // ── Simulador (motor) ──
    await page.getByLabel('Empresa', { exact: true }).fill('e2e tarifario ui s.a.');
    await page.getByLabel('Tipo de prueba', { exact: true }).selectOption('POLIGRAFO');
    await page.getByLabel('Categoría', { exact: true }).selectOption('PRE EMPLEO');
    await page.getByRole('button', { name: 'Resolver precio' }).click();
    // METRO quedó en Q400 y DEPARTAMENTAL en Q350: sin territorio el motor debe pedirlo (ambigua), no adivinar.
    await page.waitForSelector('[role=status]:has-text("Ambigua"), [role=status]:has-text("sin IVA"), [role=status]:has-text("No encontrada")');
    const simTxt = await page.locator('[role=status]').filter({ hasText: /Ambigua|sin IVA|No encontrada/ }).first().innerText();
    ok(/Ambigua/.test(simTxt) && /cambia según el territorio/.test(simTxt) && /METROPOLITANA Q400\.00/.test(simTxt) && /DEPARTAMENTAL Q350\.00/.test(simTxt), `simulador por empresa (alias) sin territorio y precios distintos → ambigua: ${simTxt.replace(/\s+/g, ' ').slice(0, 150)}`);
    await page.getByLabel('Territorio', { exact: true }).selectOption('DEPARTAMENTAL');
    await page.getByRole('button', { name: 'Resolver precio' }).click();
    await page.waitForFunction(() => /Q350\.00 sin IVA/.test(document.body.innerText), null, { timeout: 30_000 });
    const simTxt2 = await page.locator('[role=status]').filter({ hasText: /sin IVA/ }).first().innerText();
    ok(/Q350\.00 sin IVA/.test(simTxt2) && /total Q392\.00/.test(simTxt2) && /Tarifa no aprobada/.test(simTxt2), `simulador con territorio DEPARTAMENTAL → Q350.00 sin IVA, total Q392.00, no aprobada: ${simTxt2.replace(/\s+/g, ' ').slice(0, 120)}`);
    await page.screenshot({ path: path.join(SHOTS, 'tarifario.png'), fullPage: true });

    // ── CSV ──
    await page.locator('input[placeholder="NIT o razón social…"]').fill(NIT);
    const [descarga] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByRole('button', { name: /CSV/ }).click()]);
    const csvPath = path.join(SHOTS, descarga.suggestedFilename() || 'tarifario.csv'); await descarga.saveAs(csvPath);
    const csv = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/);
    ok(csv[0].startsWith('﻿NIT,Razon_Social,Tipo_Prueba,Categoria,Territorio,Monto_Sin_IVA,IVA,Total_Con_IVA') && csv.filter(l => l.startsWith(NIT)).length === 2 && csv.some(l => l.includes('400.00,48.00,448.00')) && /Precio_Desde,Meses_Sin_Cambio,Estancada/.test(csv[0]) && csv.some(l => l.startsWith(NIT) && /,0,no$/.test(l.trim())), 'CSV: header con IVA, total y antigüedad; 2 filas del NIT; 400.00 → IVA 48.00 → 448.00; precio desde hoy = 0 meses, no estancada');

    // ── Maestro-detalle con una empresa espejo de MEGAPACA ──
    const mp = (t: string, c: string, ter: string, m: number, anio = '2026') => ({ nit: NIT_MP, razon_social: 'E2E MPRH, SOCIEDAD ANONIMA (MEGAPACA)', tipo_prueba: t, categoria: c, territorio: ter, monto: m, anio, activo: true });
    const { error: eMp } = await sb.from('tarifario').insert([
      mp('POLIGRAFO', 'ESPECIFICA', 'DEPARTAMENTAL', 0), mp('POLIGRAFO', 'ESPECIFICA', 'METROPOLITANA', 0),
      mp('POLIGRAFO', 'PRE EMPLEO', 'DEPARTAMENTAL', 178.57, '2024'), mp('POLIGRAFO', 'PRE EMPLEO', 'METROPOLITANA', 178.57, '2024'),
      mp('POLIGRAFO', 'RUTINA', 'DEPARTAMENTAL', 89.29), mp('POLIGRAFO', 'RUTINA', 'METROPOLITANA', 89.29),
      mp('SOCIOECONOMICO', 'PRE EMPLEO', 'DEPARTAMENTAL', 312.5), mp('SOCIOECONOMICO', 'PRE EMPLEO', 'METROPOLITANA', 312.5),
    ]);
    if (eMp) throw new Error(eMp.message);
    await page.goto(`${BASE}/tarifario`);
    await page.waitForSelector('h1.page-title');
    const filaMp = page.locator('table tbody tr', { hasText: `NIT ${NIT_MP}` });
    const filaE2e = page.locator('table tbody tr', { hasText: `NIT ${NIT}` });
    const txtMp = (await filaMp.innerText()).replace(/\s+/g, ' ');
    ok(/MEGAPACA/.test(txtMp) && /\b8\b/.test(txtMp) && /\b6\b/.test(txtMp) && /\b2\b/.test(txtMp) && /Sin tarifa/.test(txtMp), `lista de empresas: MPRH (MEGAPACA) con 8 activas · 6 pendientes · 2 Q0 · rojo "Sin tarifa" → "${txtMp.slice(0, 110)}"`);
    const idxMp = await page.locator('table tbody tr').evaluateAll((rows, n) => rows.findIndex(r => r.textContent?.includes(`NIT ${n}`)), NIT_MP);
    const idxE2e = await page.locator('table tbody tr').evaluateAll((rows, n) => rows.findIndex(r => r.textContent?.includes(`NIT ${n}`)), NIT);
    ok(idxMp >= 0 && idxE2e >= 0 && idxMp < idxE2e, `orden: la roja (MPRH) antes que la amarilla (E2E TARIFARIO UI, 2 pendientes) → posiciones ${idxMp} < ${idxE2e}`);
    const kpiEmpresas = await page.locator('.kpi', { hasText: 'Empresas' }).locator('.kpi-value').innerText();
    ok(Number(kpiEmpresas) >= 2, `KPI "Empresas" = ${kpiEmpresas}`);
    const kpiEst = await page.locator('.kpi[data-kpi="estancadas"] .kpi-value').innerText();
    ok(Number(kpiEst) >= 2 && /2 estancadas/.test(txtMp) && /2024/.test(txtMp), `KPI "Tarifas estancadas" = ${kpiEst}; la fila de MPRH marca "2 estancadas" y precio desde 2024 (las PRE EMPLEO de 2024 sin cambios)`);
    await page.getByLabel('Solo con tarifas estancadas').check();
    ok(await page.locator('table tbody tr', { hasText: `NIT ${NIT_MP}` }).count() === 1 && await page.locator('table tbody tr', { hasText: `NIT ${NIT}` }).count() === 0, 'filtro "Solo con tarifas estancadas" → queda MPRH, no E2E TARIFARIO UI (su precio cambió hoy)');
    await page.getByLabel('Solo con tarifas estancadas').uncheck();
    await filaMp.click();
    await page.waitForURL(`**/tarifario/${NIT_MP}`);
    await page.waitForSelector('h1.page-title');
    ok(/MEGAPACA/.test(await page.locator('h1.page-title').innerText()) && (await page.locator('body').innerText()).includes(`NIT ${NIT_MP}`), 'click en la fila → /tarifario/[nit] con la razón social y el NIT en el encabezado');
    const filasDet = page.locator('table tbody tr');
    ok(await filasDet.count() === 8 && (await page.locator('body').innerText()).split(`NIT ${NIT}`).length === 1, 'la matriz trae solo las 8 tarifas de ese NIT (nada de la otra empresa)');
    const rutinaMetro = filasDet.filter({ hasText: 'RUTINA' }).filter({ hasText: 'METROPOLITANA' });
    const txtRutina = (await rutinaMetro.innerText()).replace(/\s+/g, ' ');
    ok(/Q89\.29/.test(txtRutina) && /Q100(\.00)?\b/.test(txtRutina) && /Pendiente/.test(txtRutina), `RUTINA METROPOLITANA: Q89.29 sin IVA = Q100 con IVA, pendiente → "${txtRutina.slice(0, 120)}"`);
    const btnLote = page.getByRole('button', { name: /Aprobar todas las de este cliente/ });
    ok(/\(6\)/.test(await btnLote.innerText()), 'botón "Aprobar todas las de este cliente (6)": cuenta solo las pendientes con monto');
    const kpiEstDet = page.locator('.kpi[data-kpi="estancadas"]');
    ok((await kpiEstDet.locator('.kpi-value').innerText()) === '2' && /precio sin revisar desde 2024/.test(await kpiEstDet.innerText()), 'KPI del cliente: 2 estancadas · "precio sin revisar desde 2024"');
    const preMetro = filasDet.filter({ hasText: 'PRE EMPLEO' }).filter({ hasText: 'METROPOLITANA' }).filter({ hasText: 'POLIGRAFO' });
    ok(/desde 2024 · estancada/.test(await preMetro.innerText()), 'fila PRE EMPLEO METRO (2024, sin historial): badge "desde 2024 · estancada"');
    // editar una (PRE EMPLEO METRO 178.57 → 180) y validar
    await preMetro.getByRole('button', { name: /Editar monto de/ }).click();
    const inpMp = preMetro.locator('input[aria-label^="Monto de"]');
    await inpMp.fill('180');
    await inpMp.press('Enter');
    await page.waitForFunction(() => /Tarifa actualizada/.test(document.body.innerText), null, { timeout: 30_000 });
    await page.waitForFunction((n) => [...document.querySelectorAll('table tbody tr')].some(r => /POLIGRAFO/.test(r.textContent ?? '') && /PRE EMPLEO/.test(r.textContent ?? '') && /METROPOLITANA/.test(r.textContent ?? '') && /Q180(\.00)?\b/.test(r.textContent ?? '') && !!n), NIT_MP, { timeout: 30_000 });
    const { data: ed180 } = await sb.from('tarifario').select('monto').eq('nit', NIT_MP).eq('tipo_prueba', 'POLIGRAFO').eq('categoria', 'PRE EMPLEO').eq('territorio', 'METROPOLITANA').single();
    ok(Number(ed180?.monto) === 180, 'edición inline en el detalle → Q180.00 en la base');
    await page.waitForFunction(() => (document.querySelector('.kpi[data-kpi="estancadas"] .kpi-value')?.textContent ?? '') === '1', null, { timeout: 30_000 });
    ok(/última subida: este mes/.test(await preMetro.innerText()) && !/estancada/.test(await preMetro.innerText()), 'tras subir el precio: la fila pasa a "última subida: este mes" y el KPI baja a 1 estancada');
    // aprobar en lote: confirmación en línea; las Q0 quedan fuera
    await btnLote.click();
    const dlg = page.locator('[role=alertdialog]');
    ok(/Se aprueban 6 tarifas/.test(await dlg.innerText()) && /2 en Q0/.test(await dlg.innerText()), 'confirmación en línea: "Se aprueban 6 … las 2 en Q0 quedan fuera"');
    await dlg.getByRole('button', { name: 'Confirmar aprobación' }).click();
    await page.waitForFunction(() => /6 tarifas aprobadas por/.test(document.body.innerText), null, { timeout: 30_000 });
    await page.waitForFunction(() => { const v = document.querySelector('.kpi .kpi-value'); return !!v && [...document.querySelectorAll('.kpi')].some(k => /Pendientes/.test(k.textContent ?? '') && /\b0\b/.test(k.querySelector('.kpi-value')?.textContent ?? '')); }, null, { timeout: 30_000 });
    const { data: trasLote } = await sb.from('tarifario').select('monto, aprobado_en, aprobado_por').eq('nit', NIT_MP);
    ok((trasLote ?? []).filter(r => Number(r.monto) > 0).every(r => !!r.aprobado_en && /e2e\.tarifario/.test(r.aprobado_por ?? '')) && (trasLote ?? []).filter(r => Number(r.monto) === 0).every(r => !r.aprobado_en), 'lote en la base: las 6 con monto selladas con el usuario; las 2 Q0 sin aprobar');
    ok(/Aprobada/.test((await rutinaMetro.innerText())) && /Sin tarifa/.test(await filasDet.filter({ hasText: 'ESPECIFICO' }).first().innerText()), 'matriz tras el lote: RUTINA "Aprobada", ESPECIFICO sigue "Sin tarifa"');
    ok((await btnLote.isDisabled()), 'el botón de lote queda deshabilitado (ya no hay pendientes con monto)');
    await page.screenshot({ path: path.join(SHOTS, 'empresa-detalle.png'), fullPage: true });
    // histórico tras el lote: Aprobación con el usuario; desactivar → Desactivación
    await rutinaMetro.getByRole('button', { name: /Ver histórico de/ }).click();
    const panelMp = page.locator('tr[data-historial-de]');
    await page.waitForFunction(() => /Aprobación/.test(document.querySelector('tr[data-historial-de]')?.textContent ?? ''), null, { timeout: 30_000 });
    let txtMpHist = (await panelMp.innerText()).replace(/\s+/g, ' ');
    ok(/Aprobación/.test(txtMpHist) && /e2e\.tarifario/.test(txtMpHist) && /Alta/.test(txtMpHist) && !/Cambio de precio/.test(txtMpHist), `histórico de RUTINA METRO tras el lote: "Aprobación" con el usuario (y la Alta sembrada): "${txtMpHist.slice(0, 120)}"`);
    await rutinaMetro.getByRole('button', { name: 'Desactivar' }).click();
    await page.waitForFunction(() => /Tarifa desactivada/.test(document.body.innerText), null, { timeout: 30_000 });
    await page.waitForFunction(() => /Desactivación/.test(document.querySelector('tr[data-historial-de]')?.textContent ?? ''), null, { timeout: 30_000 });
    txtMpHist = (await panelMp.innerText()).replace(/\s+/g, ' ');
    // al refrescar, la fila sale del filtro "Activas"; en "Inactivas" queda marcada Inactiva
    await page.waitForFunction(() => ![...document.querySelectorAll('table tbody tr')].some(r => /RUTINA/.test(r.textContent ?? '') && /METROPOLITANA/.test(r.textContent ?? '')), null, { timeout: 30_000 });
    await page.locator('select[title="Estado"]').selectOption('inactivas');
    ok(/Desactivación/.test(txtMpHist) && /Inactiva/.test(await rutinaMetro.innerText()), 'Desactivar → el histórico (recargado solo) muestra "Desactivación"; la fila sale de "Activas" y queda "Inactiva"');
    await page.locator('select[title="Estado"]').selectOption('activas');
    const { data: hRutina } = await sb.from('tarifario_historial').select('accion, usuario').eq('nit', NIT_MP).eq('tipo_prueba', 'POLIGRAFO').eq('categoria', 'RUTINA').eq('territorio', 'METROPOLITANA').order('seq');
    ok((hRutina ?? []).map(r => r.accion).join(',') === 'alta,aprobacion,desactivacion' && hRutina?.[0].usuario === null && (hRutina ?? []).slice(1).every(r => /e2e\.tarifario/.test(r.usuario ?? '')), `bitácora en la base: alta (sembrada por SQL → usuario null), aprobacion y desactivacion con el usuario (${JSON.stringify(hRutina)})`);
    // SQL directo sin GUC: el trigger registra igual, con usuario null → "—" en pantalla
    const { error: eDir } = await sb.from('tarifario').update({ monto: 90 }).eq('nit', NIT_MP).eq('tipo_prueba', 'POLIGRAFO').eq('categoria', 'RUTINA').eq('territorio', 'DEPARTAMENTAL');
    if (eDir) throw new Error(eDir.message);
    await page.reload();
    await page.waitForSelector('h1.page-title');
    const rutinaDepto = page.locator('table tbody tr').filter({ hasText: 'RUTINA' }).filter({ hasText: 'DEPARTAMENTAL' });
    await rutinaDepto.getByRole('button', { name: /Ver histórico de/ }).click();
    await page.waitForFunction(() => /Cambio de precio/.test(document.querySelector('tr[data-historial-de]')?.textContent ?? ''), null, { timeout: 30_000 });
    const filaDir = page.locator('tr[data-historial-de] tbody tr', { hasText: 'Cambio de precio' });
    const txtDir = (await filaDir.innerText()).replace(/\s+/g, ' ');
    ok(/Q89\.29 → Q90\.00/.test(txtDir) && /\+0\.80 %/.test(txtDir) && /—/.test(txtDir), `UPDATE directo por SQL (sin RPC ni GUC) también queda en la bitácora: Q89.29 → Q90.00 (+0.80 %) con usuario "—": "${txtDir}"`);
    // volver y buscar
    await page.getByRole('link', { name: '← Tarifario' }).click();
    await page.waitForURL('**/tarifario');
    await page.waitForSelector('h1.page-title');
    const txtMp2 = (await page.locator('table tbody tr', { hasText: `NIT ${NIT_MP}` }).innerText()).replace(/\s+/g, ' ');
    ok(/Sin tarifa/.test(txtMp2) && !/Pendientes/.test(txtMp2) && /1 estancada\b/.test(txtMp2), 'de vuelta en la lista: MPRH sigue roja (Q0), sin pendientes y con 1 estancada (PRE EMPLEO DEPTO 2024)');
    await page.getByLabel('Buscar empresa').fill('megapaca');
    ok(await page.locator('table tbody tr').filter({ hasText: 'NIT ' }).count() === 1 && await page.locator('table tbody tr', { hasText: `NIT ${NIT_MP}` }).count() === 1, 'buscador de empresas por razón social → solo MPRH (MEGAPACA)');
    await page.getByLabel('Buscar empresa').fill(NIT);
    ok(await page.locator('table tbody tr', { hasText: `NIT ${NIT}` }).count() === 1 && await page.locator('table tbody tr').filter({ hasText: 'NIT ' }).count() === 1, 'buscador por NIT → solo E2E TARIFARIO UI');
    await page.screenshot({ path: path.join(SHOTS, 'empresas-lista.png'), fullPage: true });
    const r404 = await page.goto(`${BASE}/tarifario/00000000X`);
    const cuerpo404 = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    ok(r404?.status() === 404 || /404|no se encontr|not found/i.test(cuerpo404), `/tarifario/[nit] sin tarifas → 404 (HTTP ${r404?.status()}: "${cuerpo404.slice(0, 80)}")`);

    ok(erroresJs.length === 0, `sin errores de JavaScript ni diálogos del navegador${erroresJs.length ? `: ${erroresJs[0]}` : ''}`);
  } catch (e) {
    fail++; console.log(`  🔴 excepción: ${(e as Error).message}`);
    await ctx.pages()[0]?.screenshot({ path: path.join(SHOTS, 'error.png'), fullPage: true }).catch(() => null);
  } finally {
    await ctx.close().catch(() => null);
    if (userId) await clerk.users.deleteUser(userId).catch((e: Error) => console.log(`     ✗ clerk: ${e.message}`));
    const { error } = await sb.from('tarifario').delete().in('nit', [NIT, NIT_MP]); if (error) console.log(`     ✗ limpieza: ${error.message}`);
    const { count } = await sb.from('tarifario').select('id', { count: 'exact', head: true }).in('nit', [NIT, NIT_MP]);
    const usuarios = await clerk.users.getUserList({ emailAddress: [email] }).catch(() => ({ data: [] as unknown[] }));
    ok((count ?? 0) === 0 && usuarios.data.length === 0, `limpieza verificada: 0 filas de ${NIT} y ${NIT_MP}, usuario de Clerk borrado`);
    console.log(`\n== ${pass} 🟢 / ${fail} 🔴 ==\n`);
    process.exit(fail ? 1 : 0);
  }
})();
