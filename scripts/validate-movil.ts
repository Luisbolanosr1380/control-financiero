/**
 * MÓVIL / PWA — validador.
 *
 *  A. Puro: mapa de secciones por rol, detección de teléfono, conciencia de
 *     calendario (ventanas, mismo día, bloque), reintentos sin duplicar, iniciales.
 *  B. Estático: manifest (instalable), service worker (no cachea datos),
 *     offline, regla de calendario en el prompt, tools nuevas, guards de las
 *     actions de alta que reusa la captura, permisos del auxiliar.
 *  C. Tools de Auros en la base indicada (datos de prueba, limpiados): mes en
 *     curso en cero → mes anterior y ritmo al mismo día; "quién facturó menos";
 *     última factura del cliente.
 *
 * Uso: npx tsx --conditions=react-server scripts/validate-movil.ts [hit|golden] [--sin-datos]
 */
import fs from 'node:fs';
import path from 'node:path';

const base = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'hit';
const envFile = base === 'hit' ? '.env.hit.vercel' : '.env.local';
for (const line of fs.readFileSync(path.join(process.cwd(), envFile), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('=');
  if (base === 'hit' || !(k.trim() in process.env)) process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  🟢 ${m}`); } else { fail++; console.log(`  🔴 ${m}`); } };
const fin = () => { console.log(`\n== ${pass} 🟢 / ${fail} 🔴 ==\n`); process.exit(fail ? 1 : 0); };
const leer = (p: string) => fs.readFileSync(p, 'utf8');
const primeraLinea = (src: string, fn: string) => {
  const i = src.indexOf(`export async function ${fn}`);
  return src.slice(src.indexOf('{\n', src.indexOf(')', i)) + 2).trim().split('\n')[0];
};

(async () => {
  /* ───────────── A. Puro ───────────── */
  console.log('\nA. Lógica pura');
  const S = await import('../src/lib/movil/secciones');
  ok(S.homeMovil('admin') === 'auros' && S.homeMovil('lectura') === 'auros' && S.homeMovil('contador') === 'captura' && S.homeMovil('auxiliar') === 'captura',
    'home por rol: admin/lectura → Auros · contador/auxiliar → captura');
  ok(JSON.stringify(S.seccionesMovil('auxiliar')) === '["captura"]' && JSON.stringify(S.seccionesMovil('lectura')) === '["auros"]'
    && JSON.stringify(S.seccionesMovil('contador')) === '["auros","captura"]' && JSON.stringify(S.seccionesMovil('admin')) === '["auros","captura"]',
    'secciones: auxiliar solo captura (sin Auros) · lectura solo Auros (no registra) · contador y admin ambas');
  ok(JSON.stringify(S.tiposCaptura('auxiliar')) === '["gasto","factura","cobro"]' && S.tiposCaptura('lectura').length === 0 && S.homeMovil(null) === null,
    'captura = REGISTRAN (auxiliar puede gasto/factura/cobro; lectura nada)');
  const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
  const UA_IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const UA_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
  ok(S.esTelefono(UA_IPHONE) && S.esTelefono(UA_ANDROID) && !S.esTelefono(UA_IPAD) && !S.esTelefono(UA_MAC) && !S.esTelefono(null),
    'teléfono (iPhone/Android) → /m; iPad y escritorio → /dashboard');
  ok(S.SUGERENCIAS_MOVIL.length === 6 && S.SUGERENCIAS_MOVIL.some(x => /vs el mes pasado/.test(x)), '6 sugerencias del brief, redactadas contra el cero de inicio de mes');

  const C = await import('../src/lib/ai/contexto-calendario');
  const v = C.ventanasCalendario('2026-10-04');
  ok(v.diaDelMes === 4 && v.mesRecienEmpieza && v.mesActual.desde === '2026-10-01' && v.mesAnterior.desde === '2026-09-01' && v.mesAnterior.hasta === '2026-09-30' && v.mesAnteriorAlMismoDia.hasta === '2026-09-04',
    'día 4 de octubre: mes recién empieza; septiembre completo y septiembre al día 4');
  const v31 = C.ventanasCalendario('2026-03-31');
  ok(!v31.mesRecienEmpieza && v31.mesAnteriorAlMismoDia.hasta === '2026-02-28' && C.ventanasCalendario('2027-01-15').mesAnterior.desde === '2026-12-01',
    '31 de marzo → "mismo día" de febrero acotado al 28; enero → diciembre del año anterior');
  const movs = [{ fecha: '2026-09-02', monto: 18000 }, { fecha: '2026-09-20', monto: 302000 }, { fecha: '2026-08-30', monto: 999 }];
  const met = C.metricaCalendario(movs, v);
  ok(met.mesActualAHoyQ === 0 && met.mesAnteriorQ === 320000 && met.mesAnteriorAlMismoDiaQ === 18000 && met.ritmoVsMismoDiaPct === -100,
    'ejemplo del brief: Q0 hasta hoy · septiembre cerró en Q320,000 · a estas alturas llevaba Q18,000');
  const bl = C.bloqueCalendario(v, { facturado: met });
  ok(bl.mes_recien_empieza && bl.mes_en_curso_en_cero && /NUNCA respondas solo el cero/.test(bl.instruccion) && bl.facturado?.mes_anterior_Q === 320000,
    'bloque contexto_calendario marca inicio de mes + cero y trae la instrucción');
  ok(bl.facturado?.frase_base === 'Vamos día 4 de octubre, el mes apenas arranca: Q0 facturado hasta ahora. Septiembre cerró en Q320,000 y a estas alturas (día 4) llevaba Q18,000.',
    `frase_base con cifras reales: "${bl.facturado?.frase_base}"`);

  const RI = await import('../src/lib/movil/reintentos');
  const entorno = (online: boolean[]) => {
    let i = 0; const log: string[] = [];
    return { log, e: { enLinea: () => online[Math.min(i, online.length - 1)], esperarConexion: async () => { log.push('espera'); i++; }, dormir: async (ms: number) => { log.push(`dormir${ms}`); } } };
  };
  {
    const { e, log } = entorno([false, true]); let llamadas = 0;
    const r = await RI.enviarConReintentos(async () => { llamadas++; return 'ok'; }, { idempotente: false, entorno: e });
    ok(r.estado === 'ok' && llamadas === 1 && log[0] === 'espera', 'sin señal antes de enviar: espera la conexión y envía una sola vez (seguro hasta para un cobro)');
  }
  {
    const { e } = entorno([true]); let llamadas = 0;
    const r = await RI.enviarConReintentos(async () => { llamadas++; if (llamadas < 3) throw new Error('Failed to fetch'); return 'ok'; }, { idempotente: true, entorno: e });
    ok(r.estado === 'ok' && r.intentos === 3, 'gasto/factura (idempotentes): se reintenta tras un corte de red');
  }
  {
    const { e } = entorno([true]); let llamadas = 0;
    const r = await RI.enviarConReintentos(async () => { llamadas++; throw new Error('Failed to fetch'); }, { idempotente: false, entorno: e });
    ok(r.estado === 'error_red' && r.posibleGuardado && llamadas === 1, 'cobro (no idempotente): NO se reintenta a ciegas — avisa "puede que se haya guardado"');
  }
  {
    const { e } = entorno([true]); let llamadas = 0;
    const r = await RI.enviarConReintentos(async () => { llamadas++; return { ok: false }; }, { idempotente: true, entorno: e });
    ok(r.estado === 'ok' && llamadas === 1, 'un error de negocio del servidor no se reintenta');
  }
  const G = await import('../src/lib/ai/guardas');
  ok(G.cifrasNuevas('Septiembre cerró en Q343,620 y llevabas Q10,382.', []).length === 2 && G.cifrasNuevas('Q0 hasta ahora; septiembre cerró en Q0.', []).length === 2,
    'guarda: montos sin tool en el primer mensaje → se fuerza una ronda de tools (Q0 incluido)');
  ok(G.cifrasNuevas('Eso es Q343,620, como te dije.', [{ role: 'assistant', content: 'Septiembre cerró en Q343,620.' }]).length === 0
    && G.cifrasNuevas('Ahora Q1,000.', [{ role: 'assistant', content: 'Fueron Q10,382 y 0 facturas.' }]).length === 1,
    'guarda: un monto ya dicho en la conversación no se re-consulta; uno nuevo sí');
  const { inicialesEmpresa } = await import('../src/lib/config/empresa');
  ok(inicialesEmpresa('High Impact Talent S.A') === 'HIT' && inicialesEmpresa('Golden Talent') === 'GT', 'ícono por empresa: iniciales HIT / GT cuando no hay logo');

  /* ───────────── B. Estático ───────────── */
  console.log('\nB. PWA, prompt, tools y permisos');
  const man = (await import('../src/app/manifest')).default();
  const tam = (p: string) => (man.icons ?? []).some(i => i.sizes === p);
  ok(man.display === 'standalone' && man.start_url === '/m' && !!man.name && !!man.short_name && !!man.theme_color && tam('192x192') && tam('512x512')
    && (man.icons ?? []).some(i => i.purpose === 'maskable'), 'manifest instalable: standalone, start_url /m, nombre, theme_color, íconos 192/512 + maskable');
  const sw = leer('public/sw.js');
  ok(/req\.method !== 'GET'/.test(sw) && /mode === 'navigate'/.test(sw) && /offline\.html/.test(sw) && !/\/api\//.test(sw.replace(/\/\*[\s\S]*?\*\//, '')),
    'service worker: solo GET, navegación red-primero con /offline.html, no cachea API ni datos');
  ok(fs.existsSync('public/offline.html') && /next\.config/.test('next.config') && /\/sw\.js/.test(leer('next.config.mjs')), '/offline.html existe y sw.js se sirve sin caché');
  const mw = leer('src/middleware.ts');
  ok(/webmanifest/.test(mw) && /png/.test(mw) && /\(\?:html\?/.test(mw), 'el middleware deja pasar manifest, íconos .png, sw.js y offline.html sin sesión');
  const prompt = leer('src/lib/ai/system-prompt.ts');
  ok(/CONCIENCIA DE CALENDARIO/.test(prompt) && /Prohibido responder solo "Q0"/.test(prompt) && /mes RECIÉN EMPIEZA/.test(prompt) && !/Q320,000|Q18,000/.test(prompt),
    'system prompt: regla "nunca un cero pelado" + aviso de inicio de mes, sin montos de ejemplo copiables');
  const ruta = leer('src/app/api/ai/chat/route.ts');
  ok(/consultar\(true\)/.test(ruta) && /thinkingBudget: 0/.test(ruta) && /cifrasNuevas\(result\.text, historial\)/.test(ruta) && /toolChoice: 'required'/.test(ruta) && /hoyGuatemala\(\)/.test(ruta),
    'ruta de Auros: reintento ante respuesta vacía, cifras sin tool → ronda de tools forzada, fecha en hora de Guatemala');
  const tools = leer('src/lib/ai/tools.ts');
  ok(/getMesEnCursoConReferencia: tool\(/.test(tools) && /orden: z\.enum\(\['desc', 'asc'\]\)/.test(tools) && /ultima_factura: await ultimaFacturaCliente/.test(tools),
    'tools: getMesEnCursoConReferencia, orden asc ("quién facturó menos"), ultima_factura');
  ok(!/\.(insert|update|upsert|delete)\(/.test(tools), 'tools de Auros siguen READ-ONLY');
  for (const [archivo, fn, acc] of [
    ['src/app/(app)/gastos/_actions/procesar-facturas.ts', 'procesarFacturasAction', 'registrar_gasto'],
    ['src/app/(app)/facturacion/nueva/actions.ts', 'crearFacturaAction', 'emitir_factura'],
    ['src/app/(app)/facturacion/[id]/actions.ts', 'registrarCobroAction', 'registrar_cobro'],
  ] as const) {
    ok(primeraLinea(leer(archivo), fn).includes(`autorizar('${acc}')`), `captura reusa ${fn}: primera línea autorizar('${acc}')`);
  }
  const captura = leer('src/components/movil/captura-movil.tsx');
  ok(!/'use server'/.test(captura) && /procesarFacturasAction/.test(captura) && /crearFacturaAction/.test(captura) && /registrarCobroAction/.test(captura),
    'la pantalla de captura no trae lógica de servidor propia: llama las 3 actions existentes');
  const R = await import('../src/lib/auth/roles');
  const P = await import('../src/lib/auth/permissions');
  ok(R.puede('auxiliar', 'registrar_gasto') && R.puede('auxiliar', 'emitir_factura') && R.puede('auxiliar', 'registrar_cobro')
    && !R.puede('auxiliar', 'aprobar_gasto') && !R.puede('auxiliar', 'pagar') && !P.PERMISSIONS.auxiliar.aurosChat,
    'auxiliar: captura sí; aprobar/pagar NO; sin Auros');
  ok(/aprobarFacturaAction[\s\S]{0,400}autorizar\('aprobar_gasto'\)/.test(leer('src/app/(app)/gastos/_actions/aprobar-factura.ts')), 'aprobar el gasto capturado exige aprobar_gasto (Contador/Admin)');

  if (process.argv.includes('--sin-datos')) return fin();

  /* ───────────── C. Tools en la base ───────────── */
  console.log(`\nC. Tools de Auros en ${base.toUpperCase()} (datos de prueba)`);
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const { aiTools } = await import('../src/lib/ai/tools');
  const { obtenerFechaHoyGuatemala } = await import('../src/lib/utils/fechas');
  const hoy = obtenerFechaHoyGuatemala();
  const vh = C.ventanasCalendario(hoy);
  const STAMP = Date.now().toString(36);
  const TAG = `E2E-MOV-${STAMP}`;
  const creados: Array<[string, string]> = [];
  const crear = async (tabla: string, fila: Record<string, unknown>) => {
    const { data, error } = await sb.from(tabla).insert(fila).select('id').single();
    if (error) throw new Error(`${tabla}: ${error.message}`);
    creados.push([tabla, String(data.id)]); return String(data.id);
  };
  const ejecutar = async <T,>(t: unknown, args: unknown) =>
    ((t as { execute: (a: unknown, o: unknown) => Promise<T> }).execute)(args, { toolCallId: 'x', messages: [] });

  try {
    const antes = await ejecutar<Record<string, any>>(aiTools.getMesEnCursoConReferencia, { incluirTopClientes: false, orden: 'desc' });
    const ca = await crear('clientes', { airtable_id: `sbwmov${STAMP}a`, razon_social: `${TAG} ALFA`, nombre_empresa: `${TAG} ALFA` });
    const cb = await crear('clientes', { airtable_id: `sbwmov${STAMP}b`, razon_social: `${TAG} BETA`, nombre_empresa: `${TAG} BETA` });
    const dAnt = (d: number) => `${vh.mesAnterior.desde.slice(0, 8)}${String(Math.min(d, Number(vh.mesAnterior.hasta.slice(8)))).padStart(2, '0')}`;
    const fac = (k: string, cli: string, fecha: string, total: number, estado = 'EMITIDA') =>
      crear('facturas_clientes', { airtable_id: `sbwmov${STAMP}${k}`, no_factura: `${TAG}-${k}`, cliente_id: cli, fecha_emision: fecha, total, subtotal: total, estado });
    // Mes anterior: Q18,000 antes del "mismo día" y Q302,000 después → cerró en Q320,000 (el ejemplo del brief).
    await fac('F1', ca, dAnt(1), 18000);
    await fac('F2', cb, dAnt(Math.max(vh.diaDelMes + 1, 25)), 302000);
    await fac('F3', ca, dAnt(Math.max(vh.diaDelMes + 2, 26)), 5000, 'ANULADO');   // anulada: no suma

    const r = await ejecutar<Record<string, any>>(aiTools.getMesEnCursoConReferencia, { incluirTopClientes: true, orden: 'desc' });
    const delta = (k: 'mes_actual_a_hoy_Q' | 'mes_anterior_Q' | 'mes_anterior_al_mismo_dia_Q') => r.facturado[k] - antes.facturado[k];
    ok(r.dia_del_mes === vh.diaDelMes && r.mes_recien_empieza === vh.mesRecienEmpieza && r.mes_anterior === vh.mesAnterior.etiqueta,
      `día ${r.dia_del_mes} de ${r.dias_del_mes}, mes recién empieza = ${r.mes_recien_empieza}, referencia ${r.mes_anterior}`);
    ok(delta('mes_anterior_Q') === 320000 && delta('mes_actual_a_hoy_Q') === 0, `mes anterior +Q320,000 (la anulada no suma), mes en curso sin cambio (${r.facturado.mes_actual_a_hoy_Q})`);
    ok(delta('mes_anterior_al_mismo_dia_Q') === 18000, `mes anterior al mismo día (${r.mes_anterior_al_mismo_dia_hasta}): +Q18,000 — el ritmo comparable`);
    ok(/NUNCA respondas solo el cero/.test(r.instruccion) && r.top_mes_anterior?.top?.some((t: { cliente: string; monto_Q: number }) => t.cliente.includes(`${TAG} BETA`) && t.monto_Q === 302000),
      'con incluirTopClientes: trae el ranking del mes anterior (BETA Q302,000) para "quién facturó más este mes"');

    const asc = await ejecutar<Record<string, any>>(aiTools.topClientes, { desde: vh.mesAnterior.desde, hasta: vh.mesAnterior.hasta, limite: 10, orden: 'asc' });
    const mios = (asc.top as Array<{ cliente: string; monto_Q: number }>).filter(t => t.cliente.includes(TAG));
    const idxA = asc.top.findIndex((t: { cliente: string }) => t.cliente.includes(`${TAG} ALFA`)), idxB = asc.top.findIndex((t: { cliente: string }) => t.cliente.includes(`${TAG} BETA`));
    ok(asc.orden === 'asc' && (asc.top as Array<{ monto_Q: number }>).every((t, i, a) => i === 0 || a[i - 1].monto_Q <= t.monto_Q) && (idxA === -1 || idxB === -1 || idxA < idxB) && mios.some(t => t.monto_Q === 18000),
      `"¿quién facturó menos?": topClientes orden=asc de menor a mayor (ALFA Q18,000 antes que BETA)`);

    const uf = await ejecutar<Record<string, any>>(aiTools.facturadoCliente, { nombreCliente: `${TAG} ALFA`, desde: vh.mesAnterior.desde, hasta: vh.mesAnterior.hasta });
    ok(uf.ok && uf.ultima_factura?.noFactura === `${TAG}-F1` && uf.ultima_factura?.total_Q === 18000 && uf.ultima_factura?.fecha === dAnt(1),
      `"última factura de ALFA": ${uf.ultima_factura?.noFactura} · ${uf.ultima_factura?.fecha} · Q${uf.ultima_factura?.total_Q} (la anulada posterior se ignora)`);
    const kp = await ejecutar<Record<string, any>>(aiTools.getKPIs, { periodo: 'mes_actual' });
    const tm = await ejecutar<Record<string, any>>(aiTools.topClientesDelMes, { mes: hoy.slice(0, 7), topN: 3 });
    ok(!!kp.contexto_calendario && !!tm.contexto_calendario?.top_mes_anterior, 'getKPIs(mes_actual) y topClientesDelMes(mes en curso) adjuntan contexto_calendario');
    const kpAnt = await ejecutar<Record<string, any>>(aiTools.getKPIs, { periodo: 'mes_anterior' });
    ok(!kpAnt.contexto_calendario, 'períodos cerrados no cargan el bloque (sin costo extra)');
  } catch (e) {
    ok(false, `error: ${e instanceof Error ? e.message : e}`);
  } finally {
    for (const t of ['facturas_clientes', 'clientes']) {
      const ids = creados.filter(([x]) => x === t).map(([, id]) => id);
      if (ids.length) await sb.from(t).delete().in('id', ids);
    }
    const { count: c1 } = await sb.from('facturas_clientes').select('id', { count: 'exact', head: true }).like('no_factura', `${TAG}%`);
    const { count: c2 } = await sb.from('clientes').select('id', { count: 'exact', head: true }).like('razon_social', `${TAG}%`);
    ok((c1 ?? 0) + (c2 ?? 0) === 0, `limpieza verificada: 0 filas con ${TAG}`);
    fin();
  }
})();
