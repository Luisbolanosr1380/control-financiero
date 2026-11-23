/**
 * PRECIO ESPECIAL POR PRUEBA (037) — E2E en Chrome a 1280 y 390 px sobre un `next start` (HIT). Siembra sus propios
 * datos (cliente «PEE E2E PRECIO ESPECIAL», NIT 99990062K, 3 pruebas) y los borra al terminar.
 *  1. contador a 1280 · Por facturar → cliente: lápiz de la línea → modal (con IVA 274.40 → guarda 245.00 → sale 274.40;
 *     motivo obligatorio con sugerencias) → la línea queda con la tarifa tachada, el precio nuevo y el badge.
 *  2. Generar detalle con las 3 pruebas: nace con el monto efectivo; historial «Precios especiales».
 *  3. Marcar como enviada → lápiz en otra línea (el modal avisa que hay que reenviar) → el total se recalcula, sube la
 *     versión y aparece «Cambió después de enviado: reenviar».
 *  4. PDF: precio ajustado sin tachar; en Observaciones solo el motivo de tipo cliente.
 *  5. Reenviar (link para copiar; el servidor corre SIN llave de correo) → link público: precio ajustado y la observación
 *     de tipo cliente; el motivo interno no aparece.
 *  6. Quitar el precio especial desde el detalle: vuelve a la tarifa.
 *  7. 390 px: el modal entra en la pantalla y la página no se ensancha.
 *  8. rol lectura: ve los precios especiales, sin lápiz.
 * Usuarios descartables de Clerk; se borran al final.
 *
 * Uso: npx tsx scripts/e2e-precio-especial.ts --env hit --base http://localhost:3112 --out /ruta/capturas [--solo-limpiar]
 *      (el servidor tiene que correr contra HIT y SIN llave de correo ni de la Agenda: las variables de .env.hit.vercel
 *       en el entorno, más RESEND_API_KEY y LLAVE_FACTURACION vacías, y `npx next start -p 3112`)
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const arg = (f: string, d: string) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ENV = arg('--env', 'hit');
if (ENV !== 'hit') { console.error('Este E2E siembra datos: solo corre contra HIT.'); process.exit(2); }
const BASE = arg('--base', 'http://localhost:3112').replace(/\/$/, '');
const OUT = arg('--out', path.join(os.tmpdir(), 'e2e-precio-especial'));
const CHROME = arg('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const SOLO_LIMPIAR = process.argv.includes('--solo-limpiar');
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.hit.vercel'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('='); process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  🟢 ${m}`); } else { fail++; console.log(`  🔴 ${m}`); } };
const SLUG = (process.env.EMPRESA_SLUG || 'golden').toLowerCase();
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const NIT = '99990062K', PREFIJO = 'PEE-', EMPRESA = 'pee-emp-a', CLIENTE = 'PEE E2E PRECIO ESPECIAL';
const MOTIVO_CLIENTE = 'Proceso incompleto: faltó papelería', MOTIVO_INTERNO = 'Precio pactado con el cliente';
/** El primer monto del texto («Q1,144.40 IVA incl.» → 1144.4). */
const num = (s: string | null | undefined) => Number((String(s ?? '').match(/-?\d[\d,]*(\.\d+)?/) ?? ['NaN'])[0].replace(/,/g, ''));

(async () => {
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const limpiar = async (): Promise<number> => {
    const { data: exps } = await sb.from('facturacion_expediente').select('id').like('id_externo', `${PREFIJO}%`);
    const eids = (exps ?? []).map(e => e.id as string);
    if (eids.length) {
      const { data: cs } = await sb.from('facturacion_componente').select('id').in('expediente_id', eids);
      const cids = (cs ?? []).map(c => c.id as string);
      if (cids.length) await sb.from('facturacion_componente_ajuste').delete().in('componente_id', cids);
      await sb.from('facturacion_componente').delete().in('expediente_id', eids);
      await sb.from('facturacion_expediente').delete().in('id', eids);
    }
    await sb.from('detalle_facturacion').delete().eq('nit', NIT);
    const { data: clis } = await sb.from('clientes').select('id').eq('nit', NIT);
    const cu = (clis ?? []).map(c => c.id as string);
    if (cu.length) await sb.from('cobranza_evento').delete().in('cliente_id', cu);
    await sb.from('cliente_externo').delete().eq('nit', NIT);
    await sb.from('clientes').delete().eq('nit', NIT);
    const a = await sb.from('facturacion_expediente').select('id', { count: 'exact', head: true }).like('id_externo', `${PREFIJO}%`);
    const b = await sb.from('detalle_facturacion').select('id', { count: 'exact', head: true }).eq('nit', NIT);
    const c = await sb.from('clientes').select('id', { count: 'exact', head: true }).eq('nit', NIT);
    return (a.count ?? 0) + (b.count ?? 0) + (c.count ?? 0);
  };
  if (SOLO_LIMPIAR) { ok((await limpiar()) === 0, 'limpieza: 0 expedientes PEE, detalles ni cliente'); console.log(`\n${pass} 🟢 / ${fail} 🔴`); process.exit(fail ? 1 : 0); }
  await limpiar();

  // ── sembrado ──
  const { data: cli, error: eCli } = await sb.from('clientes').insert([{ airtable_id: 'sbwPEE01', nombre_empresa: CLIENTE, razon_social: 'PEE E2E, S.A.', nit: NIT, activo: true, dias_credito: 30 }]).select('id');
  const cliId = cli?.[0]?.id as string;
  const { error: eMap } = await sb.from('cliente_externo').insert([{ fuente: 'agenda', empresa_id_externo: EMPRESA, empresa_nombre_externo: CLIENTE, nit: NIT, cliente_id: cliId, activo: true, creado_por: 'e2e' }]);
  const SEEDS = [{ ext: 'S1', persona: 'Zoila Especial', servicio: 'SOCIOECONOMICO', monto: 375 }, { ext: 'S2', persona: 'Milena Especial', servicio: 'SOCIOECONOMICO', monto: 375 }, { ext: 'P1', persona: 'Ana Tarifa', servicio: 'POLIGRAFO', monto: 401.79 }];
  const { data: insE, error: eExp } = await sb.from('facturacion_expediente').insert(SEEDS.map(s => ({ fuente: 'agenda', id_externo: `${PREFIJO}${s.ext}`, empresa_id_externo: EMPRESA, empresa_nombre_externo: CLIENTE, nit_resuelto: NIT, cliente_id: cliId, persona: s.persona, puesto: 'Puesto', solicitante: 'RRHH', tipo_prueba: s.servicio, categoria_prueba: 'PRE EMPLEO', proceso_solicitado: s.servicio, fecha_ingreso: '2026-10-01', fecha_entrega: '2026-10-15', status_proceso: 'TERMINADO', terminado: true, cancelado: false, eliminado: false, status_cobro_externo: 'PENDIENTE', estatus_pago_externo: null, estado_tarifa: 'resuelta', tipo_cobrado: s.servicio, monto_calculado: s.monto, categoria_canon: 'PRE EMPLEO', territorio_resuelto: 'METROPOLITANA' }))).select('id, id_externo');
  const expId = new Map((insE ?? []).map(e => [String(e.id_externo).slice(PREFIJO.length), e.id as string]));
  const { data: insC, error: eComp } = await sb.from('facturacion_componente').insert(SEEDS.map(s => ({ expediente_id: expId.get(s.ext), fuente: 'agenda', id_externo: `${PREFIJO}${s.ext}`, servicio: s.servicio, estado_prueba: 'TERMINADO', situacion: 'cobra', motivo: 'E2E', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto_calculado: s.monto, estado_tarifa: 'resuelta', detalle_tarifa: 'tarifa E2E', aprobada: true, fecha_resultado: '2026-10-05T15:00:00Z', fecha_resultado_fuente: 'agenda' }))).select('id, id_externo');
  const cid = (ext: string) => String((insC ?? []).find(c => c.id_externo === `${PREFIJO}${ext}`)?.id ?? '');
  ok(!eCli && !eMap && !eExp && !eComp && (insC ?? []).length === 3, `sembrado en HIT: cliente «${CLIENTE}» mapeado y 3 pruebas terminadas a tarifa (2 socioeconómicos a Q375.00 y 1 polígrafo a Q401.79)${[eCli, eMap, eExp, eComp].filter(Boolean).map(e => ' · ' + e!.message).join('')}`);

  const { chromium } = await import('playwright-core');
  const { createClerkClient } = await import(path.resolve(process.cwd(), 'node_modules/@clerk/backend/dist/index.mjs'));
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  const STAMP = Date.now().toString(36);
  const usuarios: string[] = [];
  fs.mkdirSync(OUT, { recursive: true });
  const entrar = async (rol: string, viewport: { width: number; height: number }) => {
    const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-pee-')), { executablePath: CHROME, headless: true, args: [`--user-agent=${UA}`], viewport, userAgent: UA, locale: 'es-GT' });
    const u = await clerk.users.createUser({ emailAddress: [`e2e.precio+${rol}${STAMP}@example.com`], password: `E2e-${STAMP}-${Math.random().toString(36).slice(2)}!Aa9`, firstName: 'E2E', lastName: `Precio ${rol}`, skipPasswordChecks: true, publicMetadata: { accesos: [{ empresa_slug: SLUG, rol }] } });
    usuarios.push(u.id);
    const ticket = (await clerk.signInTokens.createSignInToken({ userId: u.id, expiresInSeconds: 600 })).token;
    const page = ctx.pages()[0] ?? await ctx.newPage();
    page.setDefaultTimeout(30_000);
    // si el servidor no responde, no dejar el usuario descartable ni los datos sembrados
    try { await page.goto(`${BASE}/sign-in`); } catch (e) { await ctx.close().catch(() => null); for (const id of usuarios) await clerk.users.deleteUser(id).catch(() => null); await limpiar(); throw e; }
    await page.waitForFunction(() => (window as unknown as { Clerk?: { loaded?: boolean } }).Clerk?.loaded === true, null, { timeout: 30_000 });
    await page.evaluate(async (t) => {
      const C = (window as unknown as { Clerk: { client: { signIn: { create: (a: unknown) => Promise<{ createdSessionId: string }> } }; setActive: (a: unknown) => Promise<void> } }).Clerk;
      const si = await C.client.signIn.create({ strategy: 'ticket', ticket: t });
      await C.setActive({ session: si.createdSessionId });
    }, ticket);
    await page.waitForURL(u2 => !u2.pathname.startsWith('/sign-in'), { timeout: 20_000 }).catch(() => null);
    return { ctx, page };
  };
  const URL_CLIENTE = `${BASE}/por-facturar/${encodeURIComponent('n-' + NIT)}`;
  const DLG = '[data-dialogo-precio-especial]';
  let detalleId = '', correlativo = '';

  console.log(`\nE2E precio especial · HIT · ${BASE}`);
  const { ctx, page } = await entrar('contador', { width: 1280, height: 900 });
  const errores: string[] = []; page.on('pageerror', e => errores.push(e.message));
  try {
    ok(true, `sesión real de Clerk para usuario descartable rol contador en ${SLUG}`);

    // ── 1. Por facturar: lápiz → modal → guardar ──
    await page.goto(URL_CLIENTE);
    await page.waitForSelector(`tr[data-prueba="${cid('S1')}"]`);
    const antes = await page.evaluate(() => ({ lapices: document.querySelectorAll('[data-accion="precio-especial"]').length, total: document.querySelector('[data-kpi="total"] .kpi-value')?.textContent ?? '', conIva: document.querySelector('[data-kpi="total"] .kpi-delta')?.textContent ?? '' }));
    ok(antes.lapices === 3 && num(antes.total) === 1151.79 && num(antes.conIva) === 1290, `Por facturar → cliente: un lápiz «Precio especial» por línea (${antes.lapices}); total a tarifa ${antes.total} sin IVA · ${antes.conIva.trim()}`);
    await page.click(`tr[data-prueba="${cid('S1')}"] [data-accion="precio-especial"]`);
    await page.waitForSelector(DLG);
    const m0 = await page.evaluate((d) => ({ tarifa: document.querySelector(`${d} [data-tarifa]`)?.getAttribute('data-tarifa'), base: document.querySelector(`${d} [data-selector-iva]`)?.getAttribute('data-selector-iva'), guardar: (document.querySelector(`${d} [data-accion="guardar-precio-especial"]`) as HTMLButtonElement).disabled, sugerencias: [...document.querySelectorAll(`${d} [data-sugerencia]`)].map(b => b.getAttribute('data-sugerencia')), quitar: !!document.querySelector(`${d} [data-accion="quitar-precio-especial"]`), texto: document.querySelector(d)?.textContent ?? '' }), DLG);
    ok(m0.tarifa === '375' && m0.base === 'con_iva' && m0.guardar && m0.sugerencias.join('|') === `${MOTIVO_CLIENTE}|${MOTIVO_INTERNO}|Cortesía parcial` && !m0.quitar && /Zoila Especial/.test(m0.texto), 'modal «Precio especial»: persona, tarifa (Q375.00 sin IVA · Q420.00 con IVA), selector con IVA / sin IVA, las 3 sugerencias de motivo y «Guardar» deshabilitado');
    await page.fill(`${DLG} [data-campo="monto"]`, '274.40');
    const m1 = await page.evaluate((d) => ({ sin: document.querySelector(`${d} [data-resultado-precio]`)?.getAttribute('data-sin-iva'), con: document.querySelector(`${d} [data-resultado-precio]`)?.getAttribute('data-con-iva'), noCuadra: !!document.querySelector(`${d} [data-no-cuadra]`), guardar: (document.querySelector(`${d} [data-accion="guardar-precio-especial"]`) as HTMLButtonElement).disabled }), DLG);
    ok(m1.sin === '245' && m1.con === '274.4' && !m1.noCuadra && m1.guardar, `con IVA 274.40 → se guarda ${Number(m1.sin).toFixed(2)} sin IVA → la línea sale en ${Number(m1.con).toFixed(2)} con IVA (cuadra); sin motivo no deja guardar`);
    await page.click(`${DLG} [data-sugerencia="${MOTIVO_CLIENTE}"]`);
    const m2 = await page.evaluate((d) => ({ motivo: (document.querySelector(`${d} [data-campo="motivo"]`) as HTMLInputElement).value, cliente: (document.querySelector(`${d} [data-campo="motivo-cliente"]`) as HTMLInputElement).checked, guardar: (document.querySelector(`${d} [data-accion="guardar-precio-especial"]`) as HTMLButtonElement).disabled }), DLG);
    await page.click(`${DLG} [data-base="sin_iva"]`);
    const sinIvaTxt = await page.inputValue(`${DLG} [data-campo="monto"]`);
    await page.click(`${DLG} [data-base="con_iva"]`);
    const conIvaTxt = await page.inputValue(`${DLG} [data-campo="monto"]`);
    ok(m2.motivo === MOTIVO_CLIENTE && m2.cliente && !m2.guardar && sinIvaTxt === '245.00' && conIvaTxt === '274.40', `la sugerencia «${MOTIVO_CLIENTE}» llena el motivo y marca «Mostrar el motivo al cliente»; el selector convierte el monto (sin IVA ${sinIvaTxt} ↔ con IVA ${conIvaTxt})`);
    await page.screenshot({ path: path.join(OUT, 'modal-precio-especial-1280.png') });
    await page.click(`${DLG} [data-accion="guardar-precio-especial"]`);
    await page.waitForSelector(`tr[data-prueba="${cid('S1')}"] [data-precio-especial="245"]`);
    const f1 = await page.evaluate((id) => { const tr = document.querySelector(`tr[data-prueba="${id}"]`)!; return { tachado: tr.querySelector('s')?.textContent ?? '', nuevo: tr.querySelector('[data-precio-especial] .cell-strong')?.textContent ?? '', badge: tr.querySelector('[data-badge-precio-especial]')?.textContent ?? '', title: tr.querySelector('[data-badge-precio-especial]')?.getAttribute('title') ?? '', total: document.querySelector('[data-kpi="total"] .kpi-value')?.textContent ?? '', conIva: document.querySelector('[data-kpi="total"] .kpi-delta')?.textContent ?? '', dlg: !!document.querySelector('[data-dialogo-precio-especial]') }; }, cid('S1'));
    ok(num(f1.tachado) === 375 && num(f1.nuevo) === 245 && f1.badge === 'Precio especial' && f1.title.includes(MOTIVO_CLIENTE) && num(f1.total) === 1021.79 && num(f1.conIva) === 1144.4 && !f1.dlg, `la línea queda con la tarifa tachada (${f1.tachado}), el precio nuevo (${f1.nuevo}) y el badge «Precio especial» con el motivo en el title; el total del cliente baja a ${f1.total} sin IVA · ${f1.conIva.trim()}`);
    await page.screenshot({ path: path.join(OUT, 'por-facturar-linea-1280.png') });

    // ── 2. generar el detalle con las 3 pruebas ──
    await page.check('input[aria-label="Seleccionar todos los facturables visibles"]');
    await page.click('[data-accion="generar-detalle"]');
    await page.waitForURL(u => /\/por-facturar\/detalle\//.test(u.pathname), { timeout: 30_000 });
    await page.waitForSelector('[data-lista="detalle"]');
    detalleId = new URL(page.url()).pathname.split('/').pop() ?? '';
    const leerDetalle = () => page.evaluate((ids) => {
      // sin funciones con nombre acá adentro: tsx les inyecta un helper (__name) que no existe en la página
      const filas = ids.map(id => { const tr = document.querySelector(`tr[data-prueba="${id}"]`); return { especial: tr?.querySelector('[data-precio-especial-linea]')?.getAttribute('data-precio-especial-linea') ?? '', sinIva: tr?.querySelector('[data-precio-especial]')?.getAttribute('data-precio-especial') ?? '', conIva: tr?.querySelector('[data-precio-iva]')?.getAttribute('data-precio-iva') ?? '', tachados: tr?.querySelectorAll('s').length ?? 0, lapiz: !!tr?.querySelector('[data-accion="precio-especial"]') }; });
      return { total: document.querySelector('[data-total]')?.getAttribute('data-total') ?? '', estado: document.querySelector('[data-estado]')?.getAttribute('data-estado') ?? '', titulo: document.querySelector('h1')?.textContent ?? '', historial: document.querySelector('[data-historial-precios]')?.getAttribute('data-historial-precios') ?? '0', cambio: document.querySelector('[data-cambio-tras-envio]')?.getAttribute('data-cambio-tras-envio') ?? '', s1: filas[0], s2: filas[1], p1: filas[2] };
    }, [cid('S1'), cid('S2'), cid('P1')]);
    const d1 = await leerDetalle();
    correlativo = (d1.titulo.match(/DET-\d+/) ?? [''])[0];
    ok(!!detalleId && d1.estado === 'borrador' && d1.total === '1144.4' && d1.s1.especial === 'si' && d1.s1.sinIva === '245' && d1.s1.conIva === '274.4' && d1.s1.tachados === 2 && d1.s2.conIva === '420' && d1.s2.tachados === 0 && d1.s1.lapiz && d1.s2.lapiz && d1.p1.lapiz && d1.historial === '1' && d1.cambio === '',
      `detalle ${correlativo} en borrador: nace con el monto efectivo (total ${d1.total}); la línea ajustada muestra tarifa tachada y 274.40 con IVA; lápiz en cada línea; historial «Precios especiales» con 1 ajuste`);

    // ── 3. marcar enviada → ajustar otra línea → recalcula, sube versión, pide reenviar ──
    await page.click('[data-accion="marcar-enviada"]');
    await page.waitForSelector('[data-estado="enviada"]');
    await page.click(`tr[data-prueba="${cid('S2')}"] [data-accion="precio-especial"]`);
    await page.waitForSelector(DLG);
    const aviso = await page.evaluate(() => document.querySelector('[data-aviso-reenviar]')?.textContent ?? '');
    await page.fill(`${DLG} [data-campo="monto"]`, '274.40');
    await page.click(`${DLG} [data-sugerencia="${MOTIVO_INTERNO}"]`);
    const interno = await page.evaluate((d) => (document.querySelector(`${d} [data-campo="motivo-cliente"]`) as HTMLInputElement).checked, DLG);
    await page.click(`${DLG} [data-accion="guardar-precio-especial"]`);
    await page.waitForSelector('[data-cambio-tras-envio]');
    const d2 = await leerDetalle();
    const banner = await page.evaluate(() => document.querySelector('[data-cambio-tras-envio]')?.textContent ?? '');
    ok(/ya se envió/.test(aviso) && /reenviarlo/i.test(aviso) && !interno && d2.estado === 'enviada' && d2.total === '998.8' && d2.cambio === '2' && /Cambió después de enviado: reenviar\./.test(banner) && d2.s2.sinIva === '245' && d2.historial === '2',
      `detalle enviado: el modal avisa que hay que reenviar; «${MOTIVO_INTERNO}» queda interno; al guardar el total se recalcula (1,144.40 → ${d2.total}), sube a la versión ${d2.cambio} y aparece «Cambió después de enviado: reenviar»`);
    await page.screenshot({ path: path.join(OUT, 'detalle-cambio-tras-envio-1280.png'), fullPage: true });

    // ── 4. PDF ──
    await page.goto(`${BASE}/imprimir/detalle/${detalleId}`);
    await page.waitForSelector('[data-imprimible]');
    const pdf = await page.evaluate(() => ({ precios: [...document.querySelectorAll('[data-tabla-doc] [data-precio-iva]')].map(td => td.getAttribute('data-precio-iva')).sort().join(','), tachados: document.querySelectorAll('s').length, obs: document.querySelector('[data-observaciones-precio]')?.getAttribute('data-observaciones-precio') ?? '0', obsTexto: document.querySelector('[data-observaciones-precio]')?.textContent ?? '', total: document.querySelector('[data-total]')?.getAttribute('data-total') ?? '', cuerpo: document.querySelector('[data-imprimible]')?.textContent ?? '' }));
    ok(pdf.precios === '274.4,274.4,450' && pdf.tachados === 0 && pdf.obs === '1' && pdf.obsTexto.includes(MOTIVO_CLIENTE) && /Zoila Especial/.test(pdf.obsTexto) && !pdf.cuerpo.includes(MOTIVO_INTERNO) && !/375\.00|420\.00/.test(pdf.cuerpo) && pdf.total === '998.8',
      `PDF: las dos líneas salen en Q274.40 sin tachar ni mostrar la tarifa; Observaciones trae solo «${MOTIVO_CLIENTE}» (el motivo interno no sale); total ${pdf.total}`);
    await page.screenshot({ path: path.join(OUT, 'pdf-precio-especial-1280.png'), fullPage: true });

    // ── 5. reenviar (link para copiar) → link público ──
    await page.goto(`${BASE}/por-facturar/detalle/${detalleId}`);
    await page.waitForSelector('[data-accion="reenviar-por-cambio"]');
    await page.click('[data-accion="reenviar-por-cambio"]');
    await page.waitForSelector('[data-dialogo-enviar]');
    await page.fill('[data-dialogo-enviar] [data-campo="destinatarios"]', '');
    await page.click('[data-accion="confirmar-enviar"]');
    await page.waitForSelector('[data-resultado-envio]');
    const envio = await page.evaluate(() => ({ modo: document.querySelector('[data-resultado-envio]')?.getAttribute('data-resultado-envio') ?? '', texto: (document.querySelector('[data-texto-copiar]') as HTMLTextAreaElement | null)?.value ?? '' }));
    const link = (envio.texto.match(/https?:\/\/\S+\/aprobar-detalle#[A-Za-z0-9_-]+/) ?? [''])[0];
    const pub = await ctx.newPage();
    await pub.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
    await pub.waitForSelector('[data-lineas] [data-linea]');
    const pb = await pub.evaluate(() => ({ lineas: [...document.querySelectorAll('[data-lineas] [data-linea]')].map(li => ({ persona: li.querySelector('.ad-persona strong')?.textContent ?? '', monto: li.querySelector('.ad-monto')?.textContent ?? '', nota: li.querySelector('[data-nota-precio]')?.textContent ?? '' })), total: document.querySelector('.ad-total')?.textContent ?? '', cuerpo: document.body.textContent ?? '', tachados: document.querySelectorAll('s').length }));
    const pz = pb.lineas.find(l => /Zoila/.test(l.persona)), pm = pb.lineas.find(l => /Milena/.test(l.persona));
    ok(envio.modo !== 'enviado' && !!link && pb.lineas.length === 3 && num(pz?.monto) === 274.4 && (pz?.nota ?? '').includes(MOTIVO_CLIENTE) && num(pm?.monto) === 274.4 && pm?.nota === '' && num(pb.total) === 998.8 && !pb.cuerpo.includes(MOTIVO_INTERNO) && pb.tachados === 0 && /[Vv]ersi[oó]n 2/.test(pb.cuerpo),
      `reenviado (link para copiar, sin correo) → link público versión 2: las dos líneas en Q274.40 sin tachar, «Observación: ${MOTIVO_CLIENTE}» solo en la de tipo cliente, el motivo interno no aparece; total ${pb.total.replace(/\s+/g, ' ').trim()}`);
    await pub.screenshot({ path: path.join(OUT, 'link-publico-1280.png'), fullPage: true });
    await pub.close();
    await page.reload();
    await page.waitForSelector('[data-lista="detalle"]');
    const d3 = await leerDetalle();
    ok(d3.cambio === '' && d3.estado === 'enviada', 'después de reenviar, el aviso «Cambió después de enviado» desaparece');

    // ── 6. quitar el precio especial desde el detalle ──
    await page.click(`tr[data-prueba="${cid('S2')}"] [data-accion="precio-especial"]`);
    await page.waitForSelector(`${DLG} [data-accion="quitar-precio-especial"]`);
    const pre = await page.evaluate((d) => ({ monto: (document.querySelector(`${d} [data-campo="monto"]`) as HTMLInputElement).value, motivo: (document.querySelector(`${d} [data-campo="motivo"]`) as HTMLInputElement).value }), DLG);
    await page.click(`${DLG} [data-accion="quitar-precio-especial"]`);
    await page.waitForFunction((id) => !document.querySelector(`tr[data-prueba="${id}"] [data-precio-especial]`) && !document.querySelector('[data-dialogo-precio-especial]'), cid('S2'));
    await page.waitForSelector('[data-cambio-tras-envio="3"]');
    const d4 = await leerDetalle();
    ok(pre.monto === '274.40' && pre.motivo === MOTIVO_INTERNO && d4.total === '1144.4' && d4.s2.especial === '' && d4.s2.conIva === '420' && d4.s2.tachados === 0 && d4.cambio === '3' && d4.historial === '3',
      `quitar: el modal abre con el precio vigente (${pre.monto} con IVA · ${pre.motivo}); «Quitar precio especial» devuelve la línea a la tarifa (Q420.00), el total vuelve a ${d4.total}, versión ${d4.cambio} y pide reenviar; historial con 3 movimientos`);
    await page.screenshot({ path: path.join(OUT, 'detalle-historial-1280.png'), fullPage: true });

    // ── 7. 390 px ──
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/por-facturar/detalle/${detalleId}`);
    await page.waitForSelector('[data-lista="detalle"]');
    await page.evaluate((id) => (document.querySelector(`tr[data-prueba="${id}"] [data-accion="precio-especial"]`) as HTMLButtonElement).click(), cid('P1'));
    await page.waitForSelector(DLG);
    const mv = await page.evaluate((d) => { const r = document.querySelector(d)!.getBoundingClientRect(); return { izq: r.left, der: r.right, vp: window.innerWidth, ancho: document.documentElement.scrollWidth, botones: [...document.querySelectorAll(`${d} button`)].every(b => { const x = b.getBoundingClientRect(); return x.left >= 0 && x.right <= window.innerWidth + 1; }) }; }, DLG);
    await page.screenshot({ path: path.join(OUT, 'modal-precio-especial-390.png') });
    ok(mv.izq >= 0 && mv.der <= mv.vp + 1 && mv.ancho <= mv.vp + 1 && mv.botones, `390 px: el modal entra en la pantalla (${Math.round(mv.izq)}–${Math.round(mv.der)} de ${mv.vp}) con todos sus botones y la página no se ensancha (${mv.ancho} ≤ ${mv.vp})`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-dialogo-precio-especial]'));
    ok(errores.length === 0, `sin errores JS en la sesión contador${errores.length ? ': ' + errores.join(' | ') : ''}`);
  } catch (e) {
    ok(false, `el E2E se cortó: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    await page.screenshot({ path: path.join(OUT, 'fallo.png'), fullPage: true }).catch(() => null);
  } finally { await ctx.close().catch(() => null); }

  // ── 8. rol lectura ──
  if (detalleId) {
    const { ctx: ctx2, page: p2 } = await entrar('lectura', { width: 1280, height: 900 });
    try {
      await p2.goto(`${BASE}/por-facturar/detalle/${detalleId}`);
      await p2.waitForSelector('[data-lista="detalle"]');
      const l1 = await p2.evaluate(() => ({ lapices: document.querySelectorAll('[data-accion="precio-especial"]').length, especiales: document.querySelectorAll('[data-precio-especial]').length, historial: !!document.querySelector('[data-historial-precios]'), reenviar: !!document.querySelector('[data-accion="reenviar-por-cambio"]') }));
      await p2.goto(`${URL_CLIENTE}?cobro=todos`);   // las pruebas ya están en un detalle: «Por facturar» las oculta
      await p2.waitForSelector('tr[data-prueba]');
      const l2 = await p2.evaluate(() => ({ lapices: document.querySelectorAll('[data-accion="precio-especial"]').length, especiales: document.querySelectorAll('[data-precio-especial]').length }));
      ok(l1.lapices === 0 && l1.especiales === 1 && l1.historial && !l1.reenviar && l2.lapices === 0 && l2.especiales === 1, 'rol lectura: ve el precio especial (tarifa tachada, badge) y el historial, sin lápiz ni «Reenviar»');
    } catch (e) { ok(false, `rol lectura: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`); await p2.screenshot({ path: path.join(OUT, 'fallo-lectura.png'), fullPage: true }).catch(() => null); }
    finally { await ctx2.close().catch(() => null); }
  }

  for (const id of usuarios) await clerk.users.deleteUser(id).catch(() => null);
  ok((await limpiar()) === 0, 'limpieza: HIT queda sin datos PEE (cliente, pruebas, bitácora, detalle y links) y sin usuarios descartables');
  console.log(`\n${pass} 🟢 / ${fail} 🔴 · capturas en ${OUT}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
