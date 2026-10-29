/**
 * FACTURACIÓN AGENDA (migración 016, Fase B) — validador.
 *
 *  A. Estático: 016 (6 tablas, únicos, check de estados, RPC todo-o-nada, sin
 *     drop/delete/commit, RLS), sin migraciones después, secretos solo en env,
 *     el cliente del API no reintenta 409 ni 500 en escrituras, HMAC en tiempo
 *     constante con tolerancia de 5 min, actions con autorizar('facturar_agenda')
 *     en la primera línea, webhook público solo por firma, cron con CRON_SECRET
 *     cada 15 min, pantalla sin diálogos del navegador, nav, hook del cobro.
 *  B. Puro: mapeo tipo/categoría/territorio/COMPLETO, exclusión de PSICOMETRICAS,
 *     "sin tarifa" (Q0, sin categoría, sin tarifario), "cliente sin mapear",
 *     IVA 12 %, detalle de factura (dos renglones por un COMPLETO), cola, resumen,
 *     firma (equivalente al snippet Node del doc), reintentos del cliente HTTP.
 *  C. Ciclo real en la base indicada (HIT) contra un DOBLE del API con las
 *     respuestas del doc: sync paginado + incremental (cambiadosDesde), mapear,
 *     facturar (RPC: factura + detalle + vínculo; trigger 012), write-back 201,
 *     409 sin loop (1 POST) → re-lectura → reintento, 500 parcial sin re-facturar,
 *     503 con backoff, 404 saca de la cola, cobro de vuelta (POST /lote PAGADO),
 *     webhook (firma ok / mala / vieja / repetido). Limpieza verificada.
 *
 * Uso: npx tsx scripts/validate-facturacion-agenda.ts hit [--conservar] [--solo-limpiar]   (sin --conditions=react-server: importa la ruta del webhook)
 *   --conservar  deja los datos de prueba en la base (para smoke-render de las pantallas)
 *   --solo-limpiar  solo borra lo que haya quedado de una corrida con --conservar
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

const base = (process.argv[2] ?? 'hit').toLowerCase();
const CONSERVAR = process.argv.includes('--conservar');
const SOLO_LIMPIAR = process.argv.includes('--solo-limpiar');
const envFile = base === 'hit' ? '.env.hit.vercel' : '.env.local';
for (const line of fs.readFileSync(path.join(process.cwd(), envFile), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('=');
  if (base === 'hit' || !(k.trim() in process.env)) process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  🟢 ${m}`); } else { fail++; console.log(`  🔴 ${m}`); } };
const rd = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const r2 = (n: number) => Math.round(n * 100) / 100;

const NIT_A = '99990011K', NIT_B = '99990012K';
const EMP_A = 'recE2EempA', EMP_B = 'recE2EempB', EMP_C = 'recE2EempC';
const FACTS = ['F-E2E-1', 'F-E2E-2', 'F-E2E-3', 'F-E2E-4', 'F-E2E-5', 'F-E2E-DUP'];

(async () => {
  if (!SOLO_LIMPIAR) {
  console.log('\nA. Estático');
  const mig = rd('supabase/migrations/016_facturacion_agenda.sql');
  const sin = mig.replace(/--.*$/gm, '');
  for (const t of ['cliente_externo', 'facturacion_expediente', 'facturacion_sync_estado', 'facturacion_log', 'facturacion_webhook_evento', 'factura_detalle_expediente']) {
    ok(new RegExp(`create table if not exists ${t} \\(`).test(mig) && new RegExp(`alter table ${t} enable row level security`).test(mig), `016: tabla ${t} (if not exists + RLS)`);
  }
  ok(/unique \(fuente, empresa_id_externo\)/.test(mig) && /unique \(fuente, id_externo\)/.test(mig), '016: únicos (fuente, empresa_id_externo) y (fuente, id_externo)');
  ok(/check \(estado_tarifa in \('resuelta', 'sin_tarifa', 'cliente_sin_mapear', 'excluido_psicometrica'\)\)/.test(mig) && /writeback_estado in \('omitido', 'pendiente', 'confirmado', 'conflicto', 'error'\)/.test(mig), '016: estados de tarifa y de write-back acotados por check');
  ok(/references facturas_clientes\(id\) on delete cascade/.test(mig) && /references facturacion_expediente\(id\)/.test(mig) && /references centros_costo\(id\)/.test(mig) && /monto\s+numeric\(12,2\) not null/.test(mig), '016: factura_detalle_expediente → factura (cascade), expediente, centro de costo; monto sin IVA');
  ok(/create or replace function facturacion_agenda_emitir\(p_actor text, p_factura jsonb, p_lineas jsonb, p_detalle jsonb\)/.test(mig) && /FACTURA_DUPLICADA/.test(mig) && /EXPEDIENTE_NO_FACTURABLE/.test(mig) && /'EMITIDA'/.test(mig) && /insert into factura_detalle_expediente/.test(mig) && /update facturacion_expediente/.test(mig), '016: RPC facturacion_agenda_emitir = factura (mismas columnas que createFactura, EMITIDA, no_factura único) + detalle + vínculo en una transacción');
  ok(!/\b(drop|truncate)\b/i.test(sin) && !/\bdelete\s+from\b/i.test(sin) && !/^\s*(begin|commit)\s*;/im.test(sin) && !/alter table (facturas_clientes|tarifario|clientes)\b/.test(sin), '016: sin drop/truncate/delete/commit; no altera facturas_clientes, tarifario ni clientes (solo agrega)');
  const m17 = rd('supabase/migrations/017_por_facturar_escala.sql');
  const sin17 = m17.replace(/--.*$/gm, '');
  ok(/create index if not exists idx_fact_exp_cola\s+on facturacion_expediente \(fuente, estado_tarifa, nit_resuelto, empresa_id_externo\)\s+where terminado and not cancelado and not eliminado and factura_id is null/.test(m17) && /create or replace function facturacion_agenda_resumen\(p_fuente text default 'agenda'\)/.test(m17) && /create or replace function facturacion_agenda_sin_mapear\(p_fuente text default 'agenda', p_q text default '', p_limit integer default 25, p_offset integer default 0\)/.test(m17) && /facturacion_agenda_cobro_pendiente\(status_cobro_externo\)/.test(m17) && !/\b(drop|truncate|delete|update|insert)\b/i.test(sin17) && !/^\s*(begin|commit)\s*;/im.test(sin17), '017: índice parcial de la cola + RPCs resumen / sin_mapear (solo lectura, misma regla de cola que enCola, sin drop/delete/commit)');
  const m18 = rd('supabase/migrations/018_agenda_no_factura.sql');
  const sin18 = m18.replace(/--.*$/gm, '');
  ok(/alter table cliente_externo add column if not exists no_factura boolean not null default false/.test(m18) && /add column if not exists motivo_no_factura text/.test(m18) && /drop constraint if exists facturacion_expediente_estado_tarifa_check/.test(m18) && /add constraint facturacion_expediente_estado_tarifa_check\s+check \(estado_tarifa in \('resuelta', 'sin_tarifa', 'cliente_sin_mapear', 'excluido_psicometrica', 'excluido_no_factura'\)\)/.test(m18), '018: cliente_externo.no_factura + motivo; check de estado_tarifa recreado (idempotente) con excluido_no_factura');
  ok(/create or replace function facturacion_agenda_resumen/.test(m18) && /estado_tarifa not in \('excluido_psicometrica', 'excluido_no_factura'\)/.test(m18) && /'excluidos_no_factura'/.test(m18) && /'no_facturan'/.test(m18) && !/\bdrop\s+(table|function|index|column)\b/i.test(sin18) && !/\b(truncate|delete\s+from)\b/i.test(sin18) && !/^\s*(begin|commit)\s*;/im.test(sin18), '018: resumen() cuenta excluido_no_factura aparte, nunca entra a grupos/cola, lista las empresas marcadas; sin drop de tablas/funciones ni delete/commit');
  ok(fs.readdirSync('supabase/migrations').filter(f => /^019_|^0[2-9]\d_/.test(f)).length === 0, 'sin migraciones después de la 018');
  const mapeoSrc = rd('src/lib/facturacion-agenda/mapeo.ts');
  const cuerpoClas = mapeoSrc.slice(mapeoSrc.indexOf('export function clasificarExpediente('));
  ok(cuerpoClas.indexOf('esPsicometrica(exp)') < cuerpoClas.indexOf('noFacturaEmpresas?.has(') && cuerpoClas.indexOf('noFacturaEmpresas?.has(') < cuerpoClas.indexOf('nitPorEmpresa.get('), 'motor: orden psicométricas → no se factura → mapeo a NIT → cliente sin mapear');
  for (const fn of ['marcarNoFacturaAction', 'quitarNoFacturaAction']) ok(new RegExp(`export async function ${fn}\\([^)]*\\)[^{]*\\{\\s*const permiso = await autorizar\\('facturar_agenda'\\);`).test(rd('src/app/(app)/por-facturar/actions.ts')), `${fn}: primera línea autorizar('facturar_agenda')`);
  ok(/data-accion="no-factura"/.test(rd('src/components/por-facturar/grupo-detalle.tsx')) && /NoFacturaBanner/.test(rd('src/components/por-facturar/grupo-detalle.tsx')) && /data-tab="no-facturan"/.test(rd('src/components/por-facturar/por-facturar-client.tsx')) && /quitarNoFacturaAction/.test(rd('src/components/por-facturar/por-facturar-client.tsx')), 'pantalla: tercera opción "No se factura" con motivo en el panel Mapear, banner reversible en el detalle y pestaña "No se facturan"');
  const dbSrc = rd('src/lib/db/facturacion-agenda.ts');
  const vistaBody = dbSrc.slice(dbSrc.indexOf('export async function vistaPorFacturar('), dbSrc.indexOf('export interface EmpresaSinMapear'));
  ok(/sb\.rpc\('facturacion_agenda_resumen'/.test(vistaBody) && !/listarExpedientesLocal\(/.test(vistaBody) && !/paginar</.test(vistaBody) && /resumenSinRpc\(/.test(vistaBody), 'vistaPorFacturar: agregados por RPC (017) con fallback liviano; NUNCA listarExpedientesLocal() ni paginar del espejo en el render');
  const smBody = dbSrc.slice(dbSrc.indexOf('export async function empresasSinMapear('), dbSrc.indexOf('export interface ClienteSlim'));
  ok(/sb\.rpc\('facturacion_agenda_sin_mapear'/.test(smBody) && /p_limit: limite, p_offset: desde/.test(smBody), 'empresasSinMapear: agregado por empresa en SQL, con búsqueda y paginación (limit/offset)');
  ok(/\.eq\('terminado', true\)\.eq\('cancelado', false\)\.eq\('eliminado', false\)/.test(dbSrc.slice(dbSrc.indexOf('export async function reclasificar('), dbSrc.indexOf('export interface FiltroExpedientes'))), 'reclasificar: solo re-resuelve la cola (terminados vigentes sin factura), no el espejo entero');
  ok(/vistaPorFacturar\(\)/.test(rd('src/app/(app)/por-facturar/page.tsx')) && /SinMapearLista/.test(rd('src/components/por-facturar/por-facturar-client.tsx')) && /empresasSinMapearAction\(qAplicada, pagina, POR_PAGINA\)/.test(rd('src/components/por-facturar/sin-mapear-lista.tsx')) && /export async function empresasSinMapearAction\([^)]*\)[^{]*\{\s*await exigir\('ver'\);/.test(rd('src/app/(app)/por-facturar/actions.ts')), 'pantalla: pestaña "Sin mapear" pide las empresas on demand (action con exigir(\'ver\')), paginadas');

  const api = rd('src/lib/facturacion-agenda/agenda-api.ts');
  ok(/const REINTENTAR_LECTURA = \[429, 500, 503\]/.test(api) && /const REINTENTAR_ESCRITURA = \[429, 503\]/.test(api) && !/409/.test(api.replace(/\/\*[\s\S]*?\*\/|\/\/.*$|\*.*$/gm, '').replace(/REINTENTAR_\w+ = \[[^\]]*\]/g, '')), 'agenda-api: reintenta 429/503 (y 500 solo en lecturas); un 409 nunca entra a la lista de reintentos');
  ok(/'x-api-key': o\.apiKey/.test(api) && !/apiKey[^\n]*log|log[^\n]*apiKey/.test(api) && !/console\./.test(api), 'agenda-api: la llave viaja SOLO en el header x-api-key y no se loguea');
  const cfg = rd('src/lib/facturacion-agenda/config.ts');
  ok(/env\.FACTURACION_API_KEY_AGENDA/.test(cfg) && /env\.WEBHOOK_SECRET_AGENDA/.test(cfg) && /slug !== 'hit'/.test(cfg) && /'server-only'/.test(cfg), 'config: llaves solo desde env (server-only); write-back forzado OFF en HIT');
  const srcs = execSyncFiles('src').filter(f => /\.(ts|tsx)$/.test(f)).map(f => rd(f)).join('\n');
  const clientesUI = execSyncFiles('src').filter(f => /\.(ts|tsx)$/.test(f) && /^'use client';/m.test(rd(f)));
  const malos = clientesUI.filter(f => /^import (?!type )[^;]*from '@\/lib\/(facturacion-agenda\/(config|agenda-api)|db\/facturacion-agenda)'/m.test(rd(f)));
  ok(malos.length === 0, `ningún módulo 'use client' importa por valor config / agenda-api / db de la Agenda (${clientesUI.length} módulos cliente revisados)`);
  ok(!/whsec_fact_[A-Za-z0-9]{8,}/.test(srcs) && !/x-api-key['"]?\s*:\s*['"][A-Za-z0-9]{12,}/.test(srcs), 'ningún secreto literal en src/ (ni whsec_… ni llaves)');
  const firma = rd('src/lib/facturacion-agenda/firma.ts');
  ok(/timingSafeEqual/.test(firma) && /TOLERANCIA_SEGUNDOS = 300/.test(firma) && /createHmac\('sha256', secreto\)\.update\(`\$\{p\.t\}\.\$\{cuerpoCrudo\}`\)/.test(firma), 'firma: HMAC-SHA256(secreto, t + "." + cuerpo crudo), comparación en tiempo constante, 5 min de tolerancia');
  const acts = rd('src/app/(app)/por-facturar/actions.ts');
  for (const fn of ['sincronizarAgendaAction', 'mapearClienteAction', 'emitirFacturaAgendaAction', 'reintentarWritebackAction']) {
    ok(new RegExp(`export async function ${fn}\\([^)]*\\)[^{]*\\{\\s*const permiso = await autorizar\\('facturar_agenda'\\);`).test(acts), `${fn}: primera línea autorizar('facturar_agenda')`);
  }
  const roles = rd('src/lib/auth/roles.ts');
  ok(/facturar_agenda:\s+CONTROL/.test(roles), "roles: 'facturar_agenda' = CONTROL (admin y contador); ver = todos");
  const wh = rd('src/app/api/webhook/agenda-facturacion/route.ts');
  ok(/const cuerpo = await req\.text\(\)/.test(wh) && wh.indexOf('verificarFirma(') < wh.indexOf('JSON.parse(') && /status: 401/.test(wh) && /registrarEventoWebhook/.test(wh) && /repetido: true/.test(wh), 'webhook: verifica la firma sobre el cuerpo crudo ANTES de parsear; 401 si falla; id repetido se ignora con 200');
  ok(/'\/api\/webhook\(\.\*\)'/.test(rd('src/middleware.ts')), 'middleware: /api/webhook público (la firma HMAC es la auth)');
  const cron = rd('src/app/api/cron/traer-facturacion-agenda/route.ts');
  const vj = JSON.parse(rd('vercel.json')) as { crons: { path: string; schedule: string }[] };
  ok(/verifyCronSecret\(req\)/.test(cron) && /agendaConfigurada\(\)/.test(cron) && vj.crons.some(c => c.path === '/api/cron/traer-facturacion-agenda' && c.schedule === '*/15 * * * *'), 'cron: /api/cron/traer-facturacion-agenda con CRON_SECRET, cada 15 min en vercel.json, se omite sin llave');
  const ui = ['por-facturar-client', 'grupo-detalle', 'reintentar-writeback-button', 'procesos-agenda-section'].map(f => rd(`src/components/por-facturar/${f}.tsx`)).join('\n');
  ok(!/window\.(confirm|alert|prompt)\(|\bconfirm\(/.test(ui) && /role="dialog"/.test(ui) && /Número de factura \(SAT\/FEL\)/.test(ui), 'pantalla: sin diálogos del navegador; "Facturar" pide número SAT/FEL y fecha en un modal propio');
  ok(/disabled=\{!esFacturable\}/.test(ui) && /facturable\(e\)/.test(ui), 'pantalla: solo se seleccionan expedientes en estado resuelta y en cola');
  ok(/'\/por-facturar'/.test(rd('src/components/shell/sidebar.tsx')) && /'\/por-facturar'/.test(rd('src/components/shell/topbar.tsx')) && /startsWith\('\/por-facturar\/'\)/.test(rd('src/components/shell/topbar.tsx')), 'nav: "Por facturar · Agenda" en sidebar y breadcrumb');
  const cobroActs = rd('src/app/(app)/facturacion/[id]/actions.ts');
  ok(/result\.estadoNuevo === 'COBRADO'/.test(cobroActs) && /notificarCobroAgenda\(result\.noFactura, permiso\.email\)/.test(cobroActs), 'cobro de vuelta: registrarCobroAction empuja PAGADO a la Agenda al quedar COBRADA (fail-soft)');
  ok(/procesosDeFactura\(factura\.noFactura\)/.test(rd('src/app/(app)/facturacion/[id]/page.tsx')) && /ProcesosAgendaSection/.test(rd('src/components/facturas/factura-detalle.tsx')), 'detalle de factura: sección "procesos de la Agenda que cubre"');
  for (const p of ['por-facturar', 'por-facturar/[grupo]']) ok(/exigirPagina\('ver'\)/.test(rd(`src/app/(app)/${p}/page.tsx`)), `página /${p} exige 'ver'`);

  console.log('\nB. Puro');
  const M = await import('../src/lib/facturacion-agenda/mapeo');
  const R = await import('../src/lib/facturacion-agenda/resumen');
  const F = await import('../src/lib/facturacion-agenda/firma');
  const A = await import('../src/lib/facturacion-agenda/agenda-api');
  const { canonTipoPrueba, conIva } = await import('../src/lib/tarifario/canon');
  type Tarifa = import('../src/lib/tarifario/lookup').Tarifa;
  type Exp = import('../src/lib/facturacion-agenda/tipos').ExpedienteAgenda;
  type Local = import('../src/lib/facturacion-agenda/tipos').ExpedienteLocal;
  ok(M.tipoCobrado('COMPLETO', 'SOCIOECONOMICO') === 'COMPLETO' && M.tipoCobrado('SOLO POLIGRAFO', 'POLIGRAFO') === 'POLIGRAFO' && M.tipoCobrado('SOLO SOCIOECONOMICO', 'SOCIOECONOMICO') === 'SOCIOECONOMICO' && M.tipoCobrado('BACKGROUND CHECK ', 'BACKGROUND CHECK ') === 'BACKGROUND CHECK' && M.tipoCobrado('CONSULTA INFORNET', 'INFORNET') === 'INFORNET' && M.tipoCobrado('SOCIO EMPRESARIAL', 'SOCIO EMPRESARIAL ') === 'SOCIOECONOMICO EMPRESARIAL' && M.tipoCobrado(null, 'POLIGRAFO BASIC') === 'POLIGRAFO BASIC', 'tipoCobrado: COMPLETO → los dos; SOLO X → X; valores reales del export (BACKGROUND CHECK, CONSULTA INFORNET, SOCIO EMPRESARIAL, POLIGRAFO BASIC)');
  ok(canonTipoPrueba('SOCIOECONOMICO') === 'SOCIOECONOMICO' && canonTipoPrueba('Socio Empresarial') === 'SOCIOECONOMICO EMPRESARIAL' && canonTipoPrueba('SOCIO PRELIMINAR CON REFERENCIAS') === 'SOCIOECONOMICO', 'canon: SOCIO EMPRESARIAL es otro servicio; el resto de "SOCIO…" sigue siendo SOCIOECONOMICO');
  ok(M.territorioDesdeDepto('GUATEMALA') === 'METROPOLITANA' && M.territorioDesdeDepto(' guatemala ') === 'METROPOLITANA' && M.territorioDesdeDepto('SACATEPEQUEZ') === 'DEPARTAMENTAL' && M.territorioDesdeDepto('IZABAL') === 'DEPARTAMENTAL' && M.territorioDesdeDepto('') === '' && M.territorioDesdeDepto(null) === '', 'territorio: GUATEMALA → METROPOLITANA; cualquier otro depto → DEPARTAMENTAL; vacío → no indicado (lo decide el motor)');
  ok(M.esPsicometrica({ tipoPrueba: 'PSICOMETRICAS', procesoSolicitado: 'SOLO POLIGRAFO' }) && M.esPsicometrica({ tipoPrueba: 'POLIGRAFO', procesoSolicitado: 'PSICOMETRICAS' }) && M.esPsicometrica({ tipoPrueba: 'Psicométricas ' }) && !M.esPsicometrica({ tipoPrueba: 'POLIGRAFO', procesoSolicitado: 'SOLO POLIGRAFO' }), 'PSICOMETRICAS (en tipo o en proceso, con tildes/espacios) se excluye por completo');
  const T = (id: string, nit: string, tipo: string, cat: string, ter: string, monto: number, aprobado = true): Tarifa => ({ id, nit, razonSocial: 'E2E', tipoPrueba: tipo, categoria: cat, territorio: ter, monto, anio: '2026', aprobadoPor: aprobado ? 'x' : '', aprobadoEn: aprobado ? '2026-01-01' : null, activo: true });
  const tarifas = [T('t1', '123', 'POLIGRAFO', 'PRE EMPLEO', 'METROPOLITANA', 350), T('t2', '123', 'POLIGRAFO', 'PRE EMPLEO', 'DEPARTAMENTAL', 350), T('t3', '123', 'SOCIOECONOMICO', 'PRE EMPLEO', 'METROPOLITANA', 450), T('t4', '123', 'SOCIOECONOMICO', 'RUTINA', 'METROPOLITANA', 0), T('t5', '123', 'POLIGRAFO', 'RUTINA', 'METROPOLITANA', 300), T('t6', '123', 'POLIGRAFO', 'RUTINA', 'DEPARTAMENTAL', 330)];
  const ctx = { nitPorEmpresa: new Map([['recA', '123']]), tarifas };
  const E = (o: Partial<Exp>): Exp => ({ id: 'rec1', empresa: { id: 'recA', nombre: 'A' }, tipoPrueba: 'POLIGRAFO', procesoSolicitado: 'SOLO POLIGRAFO', categoriaPrueba: 'PRE EMPLEO', deptoVisita: 'GUATEMALA', terminado: true, cancelado: false, eliminado: false, cobro: { statusCobro: 'PENDIENTE' }, actualizadoEn: '2026-10-27T16:40:05.123Z', ...o });
  let c = M.clasificarExpediente(E({}), ctx);
  ok(c.estado === 'resuelta' && c.monto === 350 && c.componentes.length === 1 && c.nit === '123' && c.territorio === 'METROPOLITANA', 'POLIGRAFO PRE EMPLEO GUATEMALA → resuelta Q350 (1 componente)');
  c = M.clasificarExpediente(E({ tipoPrueba: 'SOCIOECONOMICO', procesoSolicitado: 'COMPLETO' }), ctx);
  ok(c.estado === 'resuelta' && c.monto === 800 && c.componentes.length === 2 && c.componentes.map(x => x.tipoPrueba).join('+') === 'POLIGRAFO+SOCIOECONOMICO' && c.tipoCobrado === 'COMPLETO', 'COMPLETO → POLIGRAFO (350) + SOCIOECONOMICO (450) = Q800, dos componentes (lógica del motor)');
  c = M.clasificarExpediente(E({ tipoPrueba: 'SOCIOECONOMICO', procesoSolicitado: 'SOLO SOCIOECONOMICO', categoriaPrueba: 'RUTINA' }), ctx);
  ok(c.estado === 'sin_tarifa' && c.monto === null && /Q0|sin tarifa definida/.test(c.detalle), 'tarifa en Q0 → "sin tarifa" (en blanco, sin valor; no es error ni Q0)');
  c = M.clasificarExpediente(E({ categoriaPrueba: null, categoria: null }), ctx);
  ok(c.estado === 'sin_tarifa' && /categoría/.test(c.detalle), 'categoriaPrueba null → "sin tarifa"');
  c = M.clasificarExpediente(E({ categoriaPrueba: null, categoria: 'PREEMPLEO' }), ctx);
  ok(c.estado === 'resuelta' && c.categoriaCanon === 'PRE EMPLEO', 'alias viejo `categoria` (doc 27-oct) y errata PREEMPLEO → PRE EMPLEO (canon)');
  c = M.clasificarExpediente(E({ empresa: { id: 'recZ', nombre: 'DESCONOCIDA' } }), ctx);
  ok(c.estado === 'cliente_sin_mapear' && c.nit === null && /DESCONOCIDA/.test(c.detalle), 'empresa sin mapeo → "cliente sin mapear" (no se factura)');
  c = M.clasificarExpediente(E({ empresa: { id: 'recZ', nombre: 'X' }, tipoPrueba: 'PSICOMETRICAS', procesoSolicitado: 'PSICOMETRICAS' }), ctx);
  ok(c.estado === 'excluido_psicometrica', 'PSICOMETRICAS → excluido aunque el cliente no esté mapeado (no entra ni como sin tarifa)');
  c = M.clasificarExpediente(E({ deptoVisita: null }), ctx);
  ok(c.estado === 'resuelta' && c.monto === 350 && c.territorio === '', 'sin deptoVisita y mismo precio en ambos territorios → resuelta (polígrafos no tienen visita)');
  c = M.clasificarExpediente(E({ deptoVisita: null, categoriaPrueba: 'RUTINA' }), ctx);
  ok(c.estado === 'sin_tarifa' && /territorio/i.test(c.detalle), 'sin deptoVisita y precio distinto por territorio → sin tarifa con el motivo (ambigua)');
  c = M.clasificarExpediente(E({ empresa: { id: 'recA', nombre: 'A' }, categoriaPrueba: 'ESPECIFICO' }), ctx);
  ok(c.estado === 'sin_tarifa' && /no tiene tarifa para POLIGRAFO ESPECIFICO/.test(c.detalle), 'combinación sin fila en el tarifario → sin tarifa con el detalle del motor');
  const ctxNF = { ...ctx, noFacturaEmpresas: new Map([['recA', 'intercompany'], ['recZ', '']]) };
  c = M.clasificarExpediente(E({}), ctxNF);
  ok(c.estado === 'excluido_no_factura' && c.nit === null && c.monto === null && /intercompany/.test(c.detalle) && M.clasificarExpediente(E({ empresa: { id: 'recZ', nombre: 'X' } }), ctxNF).estado === 'excluido_no_factura' && M.clasificarExpediente(E({ tipoPrueba: 'PSICOMETRICAS', procesoSolicitado: 'PSICOMETRICAS' }), ctxNF).estado === 'excluido_psicometrica', 'empresa marcada "no se factura" → excluido_no_factura aunque esté mapeada o sin mapear; las psicométricas siguen ganando primero');
  ok(conIva(350).iva === 42 && conIva(350).total === 392 && conIva(89.29).total === 100 && M.montoParaAgenda(89.29, 'con_iva') === 100 && M.montoParaAgenda(89.29, 'sin_iva') === 89.29, 'IVA 12 %: 350 → 42 / 392; 89.29 → Q100; monto para la Agenda con IVA (default) o sin IVA');
  const L = (o: Partial<Local>): Local => ({ ...(M.expedienteALocal(E({}), M.clasificarExpediente(E({}), ctx)) as unknown as Local), id: 'x', facturaId: null, facturaAppId: null, noFactura: null, facturadoEn: null, facturadoPor: null, writebackEstado: null, writebackDetalle: null, writebackEn: null, cobroWritebackEstado: null, cobroWritebackDetalle: null, updatedAt: null, ...o });
  const l1 = L({ idExterno: 'r1', persona: 'ANA' });
  const l3 = L({ idExterno: 'r3', persona: 'LUIS', tipoCobrado: 'COMPLETO', montoCalculado: 800, componentes: [{ tipoPrueba: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto: 350, tarifarioId: 't1', aprobada: true }, { tipoPrueba: 'SOCIOECONOMICO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto: 450, tarifarioId: 't3', aprobada: true }] });
  const centros = [{ id: 'ccP', nombre: 'Poligrafia', activo: true }, { id: 'ccX', nombre: 'Poligrafia Xela', activo: true }, { id: 'ccS', nombre: 'Socioeconomicos', activo: true }, { id: 'ccA', nombre: 'Administrativo', activo: true }];
  ok(M.centroPorServicio('POLIGRAFO', centros) === 'ccP' && M.centroPorServicio('POLIGRAFO BASIC', centros) === 'ccP' && M.centroPorServicio('SOCIOECONOMICO', centros) === 'ccS' && M.centroPorServicio('INFORNET', centros) === 'ccS' && M.centroPorServicio('BACKGROUND CHECK', centros) === null, 'centro de costo por servicio: POLIGRAF* → Poligrafia (no Xela); SOCIO/INFORNET → Socioeconomicos; desconocido → lo elige el usuario');
  const fac = M.armarFactura([l1, l3], t => M.centroPorServicio(t, centros));
  ok(fac.detalle.length === 3 && fac.detalle.filter(d => d.idExterno === 'r3').length === 2 && fac.lineas.length === 2 && fac.lineas.find(l => l.centroCostoId === 'ccP')?.subtotal === 700 && fac.lineas.find(l => l.centroCostoId === 'ccS')?.subtotal === 450 && fac.subtotal === 1150 && fac.iva === 138 && fac.total === 1288 && fac.sinCentro.length === 0, 'armarFactura: un COMPLETO = 2 renglones de detalle; líneas por centro (Poligrafia 700, Socio 450); 1150 + IVA 138 = 1288');
  ok(M.armarFactura([l1], () => null).sinCentro.join() === 'POLIGRAFO', 'armarFactura: sin centro para un servicio → se reporta (no se factura a ciegas)');
  ok(M.enCola(l1) && M.facturable(l1) && !M.enCola(L({ statusCobroExterno: 'FACTURADO' })) && M.enCola(L({ statusCobroExterno: null })) && M.enCola(L({ statusCobroExterno: 'SIN_STATUS' })) && !M.enCola(L({ cancelado: true })) && !M.enCola(L({ eliminado: true })) && !M.enCola(L({ terminado: false })) && !M.enCola(L({ facturaId: 'f' })) && !M.facturable(L({ estadoTarifa: 'sin_tarifa', montoCalculado: null })), 'cola = terminado, no cancelado, no eliminado, sin factura local y cobro PENDIENTE / sin estado; facturable = en cola + resuelta');
  ok(!M.enCola(L({ estadoTarifa: 'excluido_no_factura', montoCalculado: null })) && R.kpisPorFacturar([l1, L({ idExterno: 'rN', estadoTarifa: 'excluido_no_factura', montoCalculado: null })]).excluidosNoFactura === 1 && R.agruparPorCliente([L({ idExterno: 'rN', estadoTarifa: 'excluido_no_factura', nitResuelto: null, empresaIdExterno: 'recN' })]).length === 0, 'excluido_no_factura: fuera de la cola, no forma grupo, se cuenta aparte (KPI excluidosNoFactura)');
  const grupos = R.agruparPorCliente([l1, l3, L({ idExterno: 'r5', estadoTarifa: 'sin_tarifa', montoCalculado: null }), L({ idExterno: 'r8', nitResuelto: null, empresaIdExterno: 'recZ', empresaNombreExterno: 'DESCONOCIDA', estadoTarifa: 'cliente_sin_mapear', montoCalculado: null }), L({ idExterno: 'r4', estadoTarifa: 'excluido_psicometrica', montoCalculado: null }), L({ idExterno: 'r9', facturaId: 'f', noFactura: 'A-1', writebackEstado: 'pendiente' })], new Map([['123', 'CLIENTE 123 S.A.']]));
  const gA = grupos.find(g => g.clave === 'n-123')!, gZ = grupos.find(g => g.clave === 'e-recZ')!;
  ok(grupos.length === 2 && gZ && grupos[0].clave === 'e-recZ' && gZ.sinMapear === 1 && gA.nombre === 'CLIENTE 123 S.A.' && gA.listos === 2 && gA.totalSinIva === 1150 && gA.totalConIva === 1288 && gA.sinTarifa === 1 && gA.facturados === 1 && gA.writebackPendiente === 1 && gA.expedientes === 4, 'resumen por cliente: sin mapear primero; listos/total/sin tarifa/facturados/sin confirmar; psicométricas no cuentan');
  const k = R.kpisPorFacturar([l1, l3, L({ idExterno: 'r4', estadoTarifa: 'excluido_psicometrica' }), L({ idExterno: 'r8', nitResuelto: null, empresaIdExterno: 'recZ', estadoTarifa: 'cliente_sin_mapear' })]);
  ok(k.listos === 2 && k.totalSinIva === 1150 && k.excluidos === 1 && k.sinMapear === 1 && k.clientesSinMapear === 1 && k.clientes === 2, 'KPIs globales: listos, total, excluidos, sin mapear (expedientes y empresas)');
  ok(R.filtrarExpedientes([l1, L({ idExterno: 'r2', fechaIngreso: '2026-09-10' }), L({ idExterno: 'r9', facturaId: 'f', noFactura: 'A-1' })], { mes: '2026-09' }).length === 1 && R.filtrarExpedientes([l1, L({ idExterno: 'r9', facturaId: 'f' })], { cobro: 'facturados' }).length === 1 && R.filtrarExpedientes([l1, L({ idExterno: 'r9', facturaId: 'f' })], { cobro: 'todos' }).length === 2 && R.mesesDisponibles([l1, L({ fechaIngreso: '2026-09-10' })]).join() === '2026-09' && JSON.stringify(R.parseClave('n-123')) === '{"tipo":"nit","nit":"123"}' && JSON.stringify(R.parseClave('e-recZ')) === '{"tipo":"ext","empresaId":"recZ"}' && R.parseClave('x') === null, 'filtros por mes (fechaIngreso) y estado de cobro; claves n-<nit> / e-<empresa.id>');
  // Firma: igual al snippet Node del doc
  const secreto = 'whsec_fact_prueba', cuerpo = JSON.stringify({ id: 'fact_evt_1', tipo: 'cobro.actualizado' }), t = Math.floor(Date.now() / 1000);
  const firmaDoc = `t=${t},v1=${createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex')}`;
  const avisoValidoDoc = (cuerpoCrudo: string, fir: string, sec: string) => { const { t: tt, v1 } = Object.fromEntries(fir.split(',').map(x => x.split('='))) as { t: string; v1: string }; if (Math.abs(Date.now() / 1000 - Number(tt)) > 300) return false; const esperada = createHmac('sha256', sec).update(`${tt}.${cuerpoCrudo}`).digest('hex'); return v1.length === esperada.length && timingSafeEqual(Buffer.from(v1), Buffer.from(esperada)); };
  ok(F.firmar(cuerpo, secreto, t) === firmaDoc && F.verificarFirma(cuerpo, firmaDoc, secreto) === 'ok' && avisoValidoDoc(cuerpo, F.firmar(cuerpo, secreto, t), secreto), 'firma: firmar() produce exactamente la firma del snippet Node del doc y verificarFirma la acepta');
  ok(F.verificarFirma(cuerpo, firmaDoc, 'otro') === 'no_coincide' && F.verificarFirma(cuerpo + ' ', firmaDoc, secreto) === 'no_coincide' && F.verificarFirma(cuerpo, F.firmar(cuerpo, secreto, t - 301), secreto) === 'fuera_de_tiempo' && F.verificarFirma(cuerpo, 'v1=abc', secreto) === 'firma_malformada' && F.verificarFirma(cuerpo, null, secreto) === 'sin_firma' && F.verificarFirma(cuerpo, firmaDoc, undefined) === 'sin_secreto', 'firma: otro secreto / cuerpo alterado → no coincide; t > 5 min → fuera de tiempo; malformada / ausente / sin secreto');
  // Cliente HTTP: reintentos
  const llamadas: { m: string; u: string; key: string | null }[] = [];
  const logs: import('../src/lib/facturacion-agenda/agenda-api').LogSaliente[] = [];
  const mk = (seq: Array<[number, unknown]>) => { let i = 0; return (async (u: string | URL | Request, init?: RequestInit) => { const h = init?.headers as Record<string, string>; llamadas.push({ m: init?.method ?? 'GET', u: String(u), key: h?.['x-api-key'] ?? null }); const [st, body] = seq[Math.min(i++, seq.length - 1)]; return new Response(JSON.stringify(body), { status: st, headers: { 'content-type': 'application/json' } }); }) as typeof fetch; };
  let cli = A.crearAgendaApi({ baseUrl: 'http://doble', apiKey: 'LLAVE-SECRETA', fetchImpl: mk([[503, { error: 'no_disponible' }], [500, { error: 'error' }], [200, { expedientes: [], total: 0, pagina: 1, porPagina: 200, paginas: 1 }]]), esperar: async () => {}, log: l => { logs.push(l); } });
  const pag = await cli.listarExpedientes({ cambiadosDesde: '2026-10-28T08:00:00-06:00', porPagina: 200, statusCobro: ['PENDIENTE', 'SIN_STATUS'] });
  ok(pag.paginas === 1 && llamadas.length === 3 && llamadas.every(l => l.key === 'LLAVE-SECRETA') && /cambiadosDesde=2026-10-28T08%3A00%3A00-06%3A00/.test(llamadas[0].u) && /statusCobro=PENDIENTE&statusCobro=SIN_STATUS/.test(llamadas[0].u) && logs.length === 3 && !logs.some(l => JSON.stringify(l).includes('LLAVE-SECRETA')), 'GET: 503 → 500 → 200 = 3 intentos con backoff; filtros repetidos (statusCobro×2); la llave va en el header y no aparece en el log');
  llamadas.length = 0;
  cli = A.crearAgendaApi({ baseUrl: 'http://doble', apiKey: 'k', fetchImpl: mk([[409, { error: 'Conflicto', expediente: { id: 'r1' } }], [201, {}]]), esperar: async () => {} });
  let err: unknown = null; try { await cli.crearFactura({ numeroFactura: 'A-1', fechaFactura: '2026-10-28', expedientes: [{ id: 'r1', monto: 392, siActualizadoEn: 'x' }] }); } catch (e) { err = e; }
  ok(err instanceof A.AgendaApiError && err.status === 409 && llamadas.length === 1, 'POST /facturas 409 → AgendaApiError 409 con UNA sola llamada (no se reintenta en loop)');
  llamadas.length = 0;
  cli = A.crearAgendaApi({ baseUrl: 'http://doble', apiKey: 'k', fetchImpl: mk([[500, { error: 'error', actualizados: ['r1'], fallo: 'r2', pendientes: ['r2'] }], [201, {}]]), esperar: async () => {} });
  err = null; try { await cli.lote([{ id: 'r1' }, { id: 'r2' }]); } catch (e) { err = e; }
  ok(err instanceof A.AgendaApiError && err.status === 500 && llamadas.length === 1 && A.idsDe((err.body as { actualizados: unknown }).actualizados).join() === 'r1' && /actualizados=\["r1"\]/.test(A.resumirCuerpo(err.body)), 'POST 500 → una sola llamada (puede haber escrito a medias) y el cuerpo trae actualizados/fallo/pendientes legibles');
  llamadas.length = 0;
  cli = A.crearAgendaApi({ baseUrl: 'http://doble', apiKey: 'k', fetchImpl: mk([[503, { error: 'no_disponible' }], [201, { actualizados: 1, expedientes: [] }]]), esperar: async () => {} });
  const r503 = await cli.crearFactura({ numeroFactura: 'A-1', fechaFactura: '2026-10-28', expedientes: [{ id: 'r1' }] });
  ok(r503.status === 201 && llamadas.length === 2, 'POST 503 → reintento con backoff → 201 (2 llamadas)');
  ok(A.resumirCuerpo({ error: 'Datos inválidos', detalles: [{ campo: 'statusCobro', problema: 'No es una opción válida' }] }) === 'Datos inválidos · statusCobro: No es una opción válida', 'resumirCuerpo: formato de error del doc (error + detalles[campo, problema])');
  const { configAgenda } = await import('../src/lib/facturacion-agenda/config');
  ok(!configAgenda({ EMPRESA_SLUG: 'hit', FACTURAR_WRITEBACK: 'ON', FACTURACION_API_KEY_AGENDA: 'k' } as unknown as NodeJS.ProcessEnv).writeback && configAgenda({ EMPRESA_SLUG: 'golden', FACTURACION_API_KEY_AGENDA: 'k' } as unknown as NodeJS.ProcessEnv).writeback && !configAgenda({ EMPRESA_SLUG: 'golden', FACTURAR_WRITEBACK: 'OFF' } as unknown as NodeJS.ProcessEnv).writeback && configAgenda({} as unknown as NodeJS.ProcessEnv).montoModo === 'con_iva' && configAgenda({ FACTURACION_AGENDA_MONTO: 'sin_iva' } as unknown as NodeJS.ProcessEnv).montoModo === 'sin_iva', 'config: FACTURAR_WRITEBACK default ON, OFF apaga, en HIT siempre OFF; monto a la Agenda con IVA por default');
  }

  console.log(`\nC. Ciclo real en ${base.toUpperCase()} contra un doble del API`);
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const DB = await import('../src/lib/db/facturacion-agenda');
  const { crearTarifa } = await import('../src/lib/db/tarifario');
  const { crearAgendaApi } = await import('../src/lib/facturacion-agenda/agenda-api');
  const { firmar } = await import('../src/lib/facturacion-agenda/firma');
  const ACTOR = 'validador@agenda';

  // El estado del sync en la base de prueba es SOLO de las pruebas (HIT no tiene llave real): se borra al inicio y al final.
  // (Antes se "restauraba" el previo y una corrida con --conservar dejaba un watermark que volvía incremental la siguiente.)

  const limpiar = async () => {
    // Orden por FKs: detalle (→ expediente) → expedientes (→ facturas, clientes) → facturas → mapeos (→ clientes) → tarifario → clientes.
    const pasos: Array<[string, () => PromiseLike<{ error: { message: string } | null }>]> = [
      ['volumen', () => sb.from('facturacion_expediente').delete().like('id_externo', 'recVOL%')],
      ['factura_detalle_expediente', () => sb.from('factura_detalle_expediente').delete().like('id_externo', 'recE2E%')],
      ['facturacion_expediente', () => sb.from('facturacion_expediente').delete().like('id_externo', 'recE2E%')],
      ['facturas_clientes', () => sb.from('facturas_clientes').delete().in('no_factura', FACTS)],
      ['cliente_externo', () => sb.from('cliente_externo').delete().in('empresa_id_externo', [EMP_A, EMP_B, EMP_C])],
      ['facturacion_webhook_evento', () => sb.from('facturacion_webhook_evento').delete().like('id', 'fact_evt_e2e%')],
      ['facturacion_log', () => sb.from('facturacion_log').delete().eq('actor', ACTOR)],
      ['tarifario', () => sb.from('tarifario').delete().in('nit', [NIT_A, NIT_B])],
      ['clientes', () => sb.from('clientes').delete().in('nit', [NIT_A, NIT_B])],
    ];
    for (const [nombre, fn] of pasos) { const { error } = await fn(); if (error) console.log(`     ✗ limpieza ${nombre}: ${error.message}`); }
    await sb.from('facturacion_sync_estado').delete().eq('fuente', 'agenda');
  };
  if (SOLO_LIMPIAR) { await limpiar(); console.log('  · limpieza hecha'); console.log(`\n${pass} 🟢 / ${fail} 🔴`); process.exit(0); }
  await limpiar();

  // ── Doble del API (respuestas del doc) ──
  type Exp2 = import('../src/lib/facturacion-agenda/tipos').ExpedienteAgenda;
  const exps = new Map<string, Exp2>();
  const mk2 = (id: string, o: Partial<Exp2>): Exp2 => ({ id, nombre: `PERSONA ${id.slice(-3)}`, empresa: { id: EMP_A, nombre: 'E2E AGENDA' }, puesto: 'AUDITOR', categoriaPrueba: 'PRE EMPLEO', categoria: 'PRE EMPLEO', deptoVisita: 'GUATEMALA', solicitante: 'MONICA', fechaIngreso: '2026-10-05', tipoPrueba: 'POLIGRAFO', procesoSolicitado: 'SOLO POLIGRAFO', statusProceso: 'APROBO', terminado: true, cancelado: false, fechaEntrega: '2026-10-10', cobro: { statusCobro: 'PENDIENTE', estatusPago: null, monto: null, numeroFactura: null, fechaFactura: null, cobroMegapaca: null, costoVisita: null }, enVistaFacturacion: true, eliminado: false, creadoEn: '2026-10-01T15:00:00.000Z', actualizadoEn: '2026-10-20T10:00:00.000Z', ...o });
  const seed: Exp2[] = [
    mk2('recE2E001', {}),
    mk2('recE2E002', { tipoPrueba: 'SOCIOECONOMICO', procesoSolicitado: 'SOLO SOCIOECONOMICO', deptoVisita: 'SACATEPEQUEZ', fechaIngreso: '2026-09-28', cobro: { statusCobro: null } }),
    mk2('recE2E003', { tipoPrueba: 'SOCIOECONOMICO', procesoSolicitado: 'COMPLETO', statusProceso: 'AUDITADO -QA', actualizadoEn: '2026-10-21T10:00:00.000Z' }),
    mk2('recE2E004', { tipoPrueba: 'PSICOMETRICAS', procesoSolicitado: 'PSICOMETRICAS' }),
    mk2('recE2E005', { categoriaPrueba: 'RUTINA', categoria: 'RUTINA', tipoPrueba: 'SOCIOECONOMICO', procesoSolicitado: 'SOLO SOCIOECONOMICO' }),
    mk2('recE2E006', { terminado: false, statusProceso: 'AGENDADO' }),
    mk2('recE2E007', { cancelado: true, statusProceso: 'CANCELADO' }),
    mk2('recE2E008', { empresa: { id: EMP_B, nombre: 'OTRA EMPRESA' } }),
    mk2('recE2E009', { cobro: { statusCobro: 'FACTURADO', numeroFactura: 'X-OLD-1', fechaFactura: '2026-09-30', monto: 392 } }),
    mk2('recE2E010', { actualizadoEn: '2026-10-22T10:00:00.000Z' }),
    mk2('recE2E011', { actualizadoEn: '2026-10-22T11:00:00.000Z' }),
    mk2('recE2E012', { actualizadoEn: '2026-10-23T10:00:00.000Z' }),
    mk2('recE2E013', { actualizadoEn: '2026-10-23T11:00:00.000Z', cobro: { statusCobro: 'PENDIENTE', cobroMegapaca: 25 } }),
    mk2('recE2E014', { empresa: { id: EMP_C, nombre: 'GOLDEN TALENT' }, actualizadoEn: '2026-10-23T12:00:00.000Z' }),
  ];
  for (const e of seed) exps.set(e.id, e);
  const modo = { facturas: 'ok' as 'ok' | '500parcial' | '503x1', lote: 'ok' as 'ok' | '409' };
  const conteo: Record<string, number> = {};
  const ultimo: Record<string, unknown> = {};
  const cuenta = (k: string) => { conteo[k] = (conteo[k] ?? 0) + 1; };
  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://doble');
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const json = (st: number, body: unknown) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (req.headers['x-api-key'] !== 'llave-de-prueba') return json(401, { error: 'No autorizado' });
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      const ahora = new Date().toISOString();
      if (req.method === 'GET' && url.pathname === '/expedientes') {
        cuenta('GET /expedientes'); ultimo['GET /expedientes'] = Object.fromEntries(url.searchParams);
        let lista = [...exps.values()];
        const cd = url.searchParams.get('cambiadosDesde');
        if (cd) lista = lista.filter(e => Date.parse(e.actualizadoEn!) > Date.parse(cd)).sort((a, b) => Date.parse(a.actualizadoEn!) - Date.parse(b.actualizadoEn!));
        else lista = lista.sort((a, b) => (b.fechaIngreso ?? '').localeCompare(a.fechaIngreso ?? ''));
        if (url.searchParams.get('incluirEliminados') !== 'true') lista = lista.filter(e => !e.eliminado);
        const porPagina = Math.min(Number(url.searchParams.get('porPagina') ?? 50), 4);   // chico para forzar paginación
        const pagina = Number(url.searchParams.get('pagina') ?? 1);
        const paginas = Math.max(1, Math.ceil(lista.length / porPagina));
        return json(200, { expedientes: lista.slice((pagina - 1) * porPagina, pagina * porPagina), total: lista.length, pagina, porPagina, paginas });
      }
      const m1 = url.pathname.match(/^\/expedientes\/([^/]+)$/);
      if (m1 && req.method === 'GET') { cuenta('GET /expedientes/{id}'); const e = exps.get(decodeURIComponent(m1[1])); return e && !e.eliminado ? json(200, { expediente: e }) : json(404, { error: 'No existe el expediente' }); }
      if (m1 && req.method === 'PATCH') { cuenta('PATCH'); const e = exps.get(decodeURIComponent(m1[1])); if (!e) return json(404, { error: 'No existe' }); if (body.siActualizadoEn && body.siActualizadoEn !== e.actualizadoEn) return json(409, { error: 'Cambió desde que lo leyeron', expediente: e }); Object.assign(e.cobro!, body); e.actualizadoEn = ahora; return json(200, { actualizado: true, expediente: e }); }
      if (req.method === 'POST' && url.pathname === '/facturas') {
        cuenta('POST /facturas'); ultimo['POST /facturas'] = body;
        const items = body.expedientes as { id: string; monto?: number; siActualizadoEn?: string }[];
        for (const it of items) { if (!exps.has(it.id) || exps.get(it.id)!.eliminado) return json(404, { error: 'El expediente no existe', detalles: [{ campo: 'expedientes', id: it.id, problema: 'no existe' }] }); }
        for (const it of items) { const e = exps.get(it.id)!; if (it.siActualizadoEn && it.siActualizadoEn !== e.actualizadoEn) return json(409, { error: 'Cambió desde que lo leyeron', expediente: e }); }
        if (modo.facturas === '503x1') { modo.facturas = 'ok'; return json(503, { error: 'La API de facturación no está disponible' }); }
        const aplicar = (it: { id: string; monto?: number }) => { const e = exps.get(it.id)!; e.cobro = { ...e.cobro, statusCobro: body.statusCobro ?? 'FACTURADO', estatusPago: body.estatusPago ?? e.cobro?.estatusPago ?? null, monto: it.monto ?? e.cobro?.monto ?? null, numeroFactura: body.numeroFactura, fechaFactura: body.fechaFactura }; e.actualizadoEn = ahora; return e; };
        if (modo.facturas === '500parcial' && items.length > 1) { modo.facturas = 'ok'; aplicar(items[0]); return json(500, { error: 'error', actualizados: [items[0].id], fallo: items[1].id, pendientes: items.slice(1).map(i => i.id) }); }
        const hechos = items.map(aplicar);
        return json(201, { factura: { numeroFactura: body.numeroFactura, fechaFactura: body.fechaFactura }, actualizados: hechos.length, expedientes: hechos });
      }
      if (req.method === 'POST' && url.pathname === '/lote') {
        cuenta('POST /lote'); ultimo['POST /lote'] = body;
        const items = body.items as ({ id: string; siActualizadoEn?: string } & Record<string, unknown>)[];
        for (const it of items) { const e = exps.get(it.id); if (!e) return json(404, { error: 'No existe', detalles: [{ id: it.id }] }); if (modo.lote === '409' || (it.siActualizadoEn && it.siActualizadoEn !== e.actualizadoEn)) return json(409, { error: 'Cambió desde que lo leyeron', expediente: e }); }
        const hechos = items.map(it => { const e = exps.get(it.id)!; const { id: _id, siActualizadoEn: _s, ...cambios } = it; void _id; void _s; e.cobro = { ...e.cobro, ...cambios }; e.actualizadoEn = ahora; return e; });
        return json(200, { actualizados: hechos.length, expedientes: hechos });
      }
      return json(400, { error: 'Datos inválidos', detalles: [{ campo: 'ruta', problema: 'no existe' }] });
    });
  });
  await new Promise<void>(r => servidor.listen(0, '127.0.0.1', () => r()));
  const puerto = (servidor.address() as { port: number }).port;
  const URL_DOBLE = `http://127.0.0.1:${puerto}`;
  process.env.FACTURACION_AGENDA_URL = URL_DOBLE;
  process.env.FACTURACION_API_KEY_AGENDA = 'llave-de-prueba';
  process.env.WEBHOOK_SECRET_AGENDA = 'whsec_fact_e2e_secreto';
  process.env.FACTURAR_WRITEBACK = 'ON';
  const slugOriginal = process.env.EMPRESA_SLUG;
  process.env.EMPRESA_SLUG = 'golden';   // en HIT el write-back va forzado OFF; acá probamos el ciclo completo contra el doble
  const apiRapida = () => crearAgendaApi({ baseUrl: URL_DOBLE, apiKey: 'llave-de-prueba', esperar: async () => {}, log: l => DB.registrarLog({ ...l, actor: ACTOR }) });

  const creadosTar: string[] = [];
  try {
    ok(await DB.facturacionAgendaDisponible(), `facturacionAgendaDisponible() detecta la 016 en ${base}`);
    // Clientes y tarifario de prueba
    const { data: cliA } = await sb.from('clientes').insert({ airtable_id: 'sbwE2EAGENDA01', nombre_empresa: 'E2E AGENDA, S.A.', razon_social: 'E2E AGENDA, SOCIEDAD ANONIMA', nit: NIT_A, activo: true }).select('id, airtable_id').single();
    const { data: cliB } = await sb.from('clientes').insert({ airtable_id: 'sbwE2EAGENDA02', nombre_empresa: 'OTRA EMPRESA, S.A.', nit: NIT_B, activo: true }).select('id, airtable_id').single();
    ok(!!cliA && !!cliB, 'clientes de prueba creados en la base (NIT 99990011K y 99990012K)');
    for (const [tipo, cat, ter, monto] of [['POLIGRAFO', 'PRE EMPLEO', 'METROPOLITANA', 350], ['POLIGRAFO', 'PRE EMPLEO', 'DEPARTAMENTAL', 350], ['SOCIOECONOMICO', 'PRE EMPLEO', 'METROPOLITANA', 450], ['SOCIOECONOMICO', 'PRE EMPLEO', 'DEPARTAMENTAL', 450], ['SOCIOECONOMICO', 'RUTINA', 'METROPOLITANA', 0]] as const) {
      const r = await crearTarifa({ nit: NIT_A, razonSocial: 'E2E AGENDA, S.A.', tipoPrueba: tipo, categoria: cat, territorio: ter, monto, anio: '2026' }, ACTOR);
      if (r.ok) creadosTar.push(r.id);
    }
    ok(creadosTar.length === 5, 'tarifario de prueba: POLIGRAFO PRE EMPLEO 350 (ambos), SOCIO PRE EMPLEO 450 (ambos), SOCIO RUTINA Q0');
    const { getCentrosCostoActivos } = await import('../src/lib/db/centros');
    const centros = await getCentrosCostoActivos();
    const ccPol = centros.find(c => /poligraf/i.test(c.nombre))?.id ?? centros[0].id;
    const ccSoc = centros.find(c => /socio/i.test(c.nombre))?.id ?? centros[1]?.id ?? centros[0].id;
    console.log(`     · centros de costo activos en ${base}: ${centros.map(c => c.nombre).join(', ')} → polígrafo=${centros.find(c => c.id === ccPol)?.nombre}, socio=${centros.find(c => c.id === ccSoc)?.nombre}`);

    // Mapeo de la empresa A
    const m = await DB.guardarMapeo({ empresaIdExterno: EMP_A, empresaNombreExterno: 'E2E AGENDA', clienteAppId: cliA!.airtable_id }, ACTOR);
    ok(m.ok && m.nit === NIT_A, `mapear empresa de la Agenda → cliente por NIT: ${m.ok ? m.clienteNombre : m.error}`);
    const mBad = await DB.guardarMapeo({ empresaIdExterno: EMP_B, clienteAppId: 'rec_no_existe' }, ACTOR);
    ok(!mBad.ok && /no existe/.test(mBad.ok ? '' : mBad.error), 'mapear a un cliente inexistente → error claro');

    // Sync primera corrida (desde=) paginada
    const s1 = await DB.sincronizarAgenda({ actor: ACTOR, api: apiRapida() });
    const q1 = ultimo['GET /expedientes'] as Record<string, string>;
    ok(s1.ok && s1.leidos === 14 && s1.paginas === 4 && q1.desde === '2026-01-01' && q1.incluirEliminados === 'true' && q1.porPagina === '200', `primera corrida: desde=2026-01-01, incluirEliminados, 4 páginas, 14 expedientes (${JSON.stringify({ leidos: s1.leidos, paginas: s1.paginas })})`);
    let locales = await DB.listarExpedientesLocal();
    const byId = (id: string) => locales.find(e => e.idExterno === id)!;
    ok(byId('recE2E001').estadoTarifa === 'resuelta' && byId('recE2E001').montoCalculado === 350 && byId('recE2E001').territorioResuelto === 'METROPOLITANA' && byId('recE2E001').nitResuelto === NIT_A && byId('recE2E001').clienteId === cliA!.id, 'e001 POLIGRAFO PRE EMPLEO GUATEMALA → resuelta Q350, METROPOLITANA, NIT y cliente del mapeo');
    ok(byId('recE2E002').estadoTarifa === 'resuelta' && byId('recE2E002').montoCalculado === 450 && byId('recE2E002').territorioResuelto === 'DEPARTAMENTAL', 'e002 SOCIO PRE EMPLEO SACATEPEQUEZ → resuelta Q450 DEPARTAMENTAL (cobro sin estado = en cola)');
    ok(byId('recE2E003').estadoTarifa === 'resuelta' && byId('recE2E003').montoCalculado === 800 && byId('recE2E003').componentes.length === 2 && byId('recE2E003').tipoCobrado === 'COMPLETO', 'e003 COMPLETO → Q800 con 2 componentes');
    ok(byId('recE2E004').estadoTarifa === 'excluido_psicometrica', 'e004 PSICOMETRICAS → excluido');
    ok(byId('recE2E005').estadoTarifa === 'sin_tarifa' && byId('recE2E005').montoCalculado === null && /Q0/.test(byId('recE2E005').detalleTarifa), 'e005 SOCIO RUTINA (Q0) → sin tarifa');
    ok(byId('recE2E008').estadoTarifa === 'cliente_sin_mapear' && byId('recE2E008').nitResuelto === null, 'e008 empresa B sin mapear → cliente sin mapear');
    ok(!byId('recE2E006').terminado && byId('recE2E007').cancelado && byId('recE2E009').statusCobroExterno === 'FACTURADO' && byId('recE2E013').cobroMegapaca === 25, 'e006 no terminado, e007 cancelado, e009 ya FACTURADO en la Agenda (fuera de la cola), e013 conserva cobroMegapaca');
    const vista = await DB.vistaPorFacturar();
    const gA = vista.grupos.find(g => g.clave === `n-${NIT_A}`)!;
    ok(!!gA && gA.listos === 7 && gA.totalSinIva === 350 + 450 + 800 + 350 * 4 && gA.totalConIva === 3360 && gA.sinTarifa === 1 && gA.nombre === 'E2E AGENDA, S.A.' && gA.expedientes === 8 && vista.grupos.length === 1 && vista.agregadoEnSql && vista.kpis.excluidos === 1 && vista.kpis.sinMapear === 2 && vista.kpis.clientesSinMapear === 2 && vista.sinMapear.empresas === 2 && vista.kpis.listos === 7 && vista.kpis.clientes === 1 && vista.total === 14 && vista.kpis.excluidosNoFactura === 0 && vista.noFacturan.length === 0 && vista.sync?.corridas === 1, `vista "Por facturar" (agregados en SQL): solo el cliente A (7 listos por Q${gA?.totalSinIva}, 1 sin tarifa); sin mapear (2 empresas) y psicométricas (1) solo se CUENTAN; total 14 en el espejo`);
    const vistaF = await DB.vistaPorFacturar({ sinRpc: true });
    ok(!vistaF.agregadoEnSql && JSON.stringify(vistaF.grupos) === JSON.stringify(vista.grupos) && JSON.stringify(vistaF.kpis) === JSON.stringify(vista.kpis) && vistaF.total === vista.total, 'fallback sin la 017 (consultas livianas) da exactamente los mismos grupos y KPIs');
    const sm = await DB.empresasSinMapear({});
    const smF = await DB.empresasSinMapear({ sinRpc: true });
    ok(sm.agregadoEnSql && sm.totalEmpresas === 2 && sm.totalExpedientes === 2 && sm.filas.length === 2 && sm.filas.some(f => f.empresaIdExterno === EMP_B && f.empresaNombreExterno === 'OTRA EMPRESA' && f.expedientes === 1) && JSON.stringify(smF.filas) === JSON.stringify(sm.filas) && (await DB.empresasSinMapear({ q: 'otra emp' })).totalEmpresas === 1 && (await DB.empresasSinMapear({ q: 'zzz' })).totalEmpresas === 0, 'pestaña "Sin mapear": las empresas B y C agregadas por SQL (1 expediente cada una), búsqueda por nombre; el fallback coincide');
    const det = await DB.getGrupo(`e-${EMP_B}`);
    ok(!!det && det.sugerencias.some(s => s.id === cliB!.airtable_id) && det.clientes.length > 0 && det.nit === null, 'detalle de empresa sin mapear: sugiere "OTRA EMPRESA, S.A." por nombre (contiene, sin tildes)');
    const m2 = await DB.guardarMapeo({ empresaIdExterno: EMP_B, empresaNombreExterno: 'OTRA EMPRESA', clienteAppId: cliB!.airtable_id }, ACTOR);
    locales = await DB.listarExpedientesLocal();
    ok(m2.ok && m2.reclasificados === 1 && byId('recE2E008').estadoTarifa === 'sin_tarifa' && byId('recE2E008').nitResuelto === NIT_B && /no tiene tarifario/.test(byId('recE2E008').detalleTarifa), 'al mapear la empresa B sus expedientes se re-resuelven solos: ahora "sin tarifa" (NIT sin tarifario) con el detalle');
    const detA = await DB.getGrupo(`n-${NIT_A}`);
    ok(!!detA && detA.cliente?.id === cliA!.airtable_id && detA.expedientes.length === 11 && detA.centros.length === centros.length, 'detalle del cliente A: cliente de financiero resuelto, 11 expedientes (la psicométrica no tiene NIT), centros de costo activos para el diálogo');

    // Emitir: validaciones
    const hoy = (await import('../src/lib/utils/fechas')).obtenerFechaHoyGuatemala();
    const manana = new Date(Date.now() + 86400_000 * 2).toISOString().slice(0, 10);
    let e = await DB.emitirFacturaAgenda({ idsExternos: ['recE2E001'], noFactura: 'F-E2E-X', fechaEmision: manana }, ACTOR);
    ok(!e.ok && /futura/.test(e.ok ? '' : e.error), 'facturar: fecha futura → error');
    e = await DB.emitirFacturaAgenda({ idsExternos: ['recE2E005'], noFactura: 'F-E2E-X', fechaEmision: hoy }, ACTOR);
    ok(!e.ok && /Sin tarifa/.test(e.ok ? '' : e.error), 'facturar: un expediente sin tarifa → error (solo se facturan resueltos)');
    e = await DB.emitirFacturaAgenda({ idsExternos: ['recE2E001', 'recE2E008'], noFactura: 'F-E2E-X', fechaEmision: hoy }, ACTOR);
    ok(!e.ok, 'facturar: expedientes de clientes distintos → error');
    e = await DB.emitirFacturaAgenda({ idsExternos: ['recE2E009'], noFactura: 'F-E2E-X', fechaEmision: hoy }, ACTOR);
    ok(!e.ok && /cobro ya resuelto/.test(e.ok ? '' : e.error), 'facturar: expediente ya FACTURADO en la Agenda → error (no está en cola)');

    // Emitir F-E2E-1 (e001 + e003) → write-back 201
    const cPorTipo = { POLIGRAFO: ccPol, SOCIOECONOMICO: ccSoc };
    e = await DB.emitirFacturaAgenda({ idsExternos: ['recE2E001', 'recE2E003'], noFactura: ' F-E2E-1 ', fechaEmision: hoy, centroPorTipo: cPorTipo }, ACTOR, { api: apiRapida() });
    ok(e.ok && e.noFactura === 'F-E2E-1' && e.expedientes === 2 && e.lineas === (ccPol === ccSoc ? 1 : 2) && e.subtotal === 1150 && e.iva === 138 && e.total === 1288 && e.writeback.estado === 'confirmado', `F-E2E-1 (e001 + COMPLETO e003): factura creada, no_factura recortado por el trigger 012, 1150 + 138 = 1288, write-back confirmado (${e.ok ? e.writeback.detalle : e.error})`);
    const { data: fRows } = await sb.from('facturas_clientes').select('id, airtable_id, no_factura, estado, subtotal, iva, total, cliente_id, centro_costo_id').eq('no_factura', 'F-E2E-1').order('total', { ascending: false });
    ok((fRows ?? []).length === (ccPol === ccSoc ? 1 : 2) && (fRows ?? []).every(r => r.estado === 'EMITIDA' && r.cliente_id === cliA!.id && String(r.airtable_id).startsWith('sbw')) && r2((fRows ?? []).reduce((s, r) => s + Number(r.total), 0)) === 1288 && r2((fRows ?? []).reduce((s, r) => s + Number(r.subtotal), 0)) === 1150, 'facturas_clientes: líneas EMITIDA del cliente, airtable_id sintético, subtotal materializado = total − IVA (misma forma que createFactura)');
    const { data: dRows } = await sb.from('factura_detalle_expediente').select('id_externo, tipo_prueba, monto, centro_costo_id, factura_id').eq('no_factura', 'F-E2E-1');
    ok((dRows ?? []).length === 3 && (dRows ?? []).filter(d => d.id_externo === 'recE2E003').length === 2 && r2((dRows ?? []).reduce((s, d) => s + Number(d.monto), 0)) === 1150 && (dRows ?? []).every(d => d.factura_id === (fRows ?? [])[0]?.id), 'factura_detalle_expediente: 3 renglones (el COMPLETO son 2: polígrafo + socio) colgados de la línea principal');
    locales = await DB.listarExpedientesLocal();
    ok(byId('recE2E001').facturaId === (fRows ?? [])[0]?.id && byId('recE2E001').noFactura === 'F-E2E-1' && byId('recE2E001').writebackEstado === 'confirmado' && byId('recE2E001').statusCobroExterno === 'FACTURADO' && byId('recE2E001').numeroFacturaExterno === 'F-E2E-1' && byId('recE2E003').writebackEstado === 'confirmado', 'expedientes vinculados a la factura y espejo actualizado con lo que devolvió la Agenda (FACTURADO, número)');
    const post1 = ultimo['POST /facturas'] as { numeroFactura: string; fechaFactura: string; statusCobro: string; expedientes: { id: string; monto: number; siActualizadoEn?: string }[] };
    ok(post1.numeroFactura === 'F-E2E-1' && post1.fechaFactura === hoy && post1.statusCobro === 'FACTURADO' && post1.expedientes.length === 2 && post1.expedientes.find(x => x.id === 'recE2E001')?.monto === 392 && post1.expedientes.find(x => x.id === 'recE2E003')?.monto === 896 && post1.expedientes.every(x => !!x.siActualizadoEn), 'POST /facturas: número, fecha, FACTURADO, expedientes con monto CON IVA (392 / 896) y siActualizadoEn');
    const proc = await DB.procesosDeFactura('F-E2E-1');
    ok(!!proc && proc.detalle.length === 3 && proc.subtotal === 1150 && proc.writeback.confirmados === 2 && proc.detalle.every(d => d.centroNombre.length > 0), 'procesosDeFactura: "la factura F-E2E-1 incluye estos servicios" con centro de costo y write-back');
    e = await DB.emitirFacturaAgenda({ idsExternos: ['recE2E010'], noFactura: 'F-E2E-1', fechaEmision: hoy, centroPorTipo: cPorTipo }, ACTOR, { api: apiRapida() });
    ok(!e.ok && /ya existe/.test(e.ok ? '' : e.error), 'mismo número de factura otra vez → "ya existe" (RPC, sin crear nada)');
    e = await DB.emitirFacturaAgenda({ idsExternos: ['recE2E001'], noFactura: 'F-E2E-DUP', fechaEmision: hoy, centroPorTipo: cPorTipo }, ACTOR, { api: apiRapida() });
    ok(!e.ok && /ya está en la factura F-E2E-1/.test(e.ok ? '' : e.error), 'expediente ya facturado no se vuelve a facturar');

    // 409: e002 cambia en la Agenda después de leído
    const antes409 = conteo['POST /facturas'] ?? 0;
    exps.get('recE2E002')!.actualizadoEn = '2026-10-27T12:00:00.000Z'; exps.get('recE2E002')!.puesto = 'CAMBIADO EN LA AGENDA';
    e = await DB.emitirFacturaAgenda({ idsExternos: ['recE2E002'], noFactura: 'F-E2E-2', fechaEmision: hoy, centroPorTipo: cPorTipo }, ACTOR, { api: apiRapida() });
    locales = await DB.listarExpedientesLocal();
    ok(e.ok && e.writeback.estado === 'conflicto' && (conteo['POST /facturas'] ?? 0) === antes409 + 1 && byId('recE2E002').facturaId !== null && byId('recE2E002').writebackEstado === 'conflicto' && byId('recE2E002').puesto === 'CAMBIADO EN LA AGENDA' && byId('recE2E002').actualizadoEnExterno !== null && Date.parse(byId('recE2E002').actualizadoEnExterno!) === Date.parse('2026-10-27T12:00:00.000Z'), '409: UN solo POST (sin loop), factura creada en financiero, expediente en "conflicto" y RE-LEÍDO (espejo con el cambio de la Agenda)');
    const { count: cF2 } = await sb.from('facturas_clientes').select('id', { count: 'exact', head: true }).eq('no_factura', 'F-E2E-2');
    const rr = await DB.reintentarWriteback('F-E2E-2', ACTOR, { api: apiRapida() });
    const { count: cF2b } = await sb.from('facturas_clientes').select('id', { count: 'exact', head: true }).eq('no_factura', 'F-E2E-2');
    locales = await DB.listarExpedientesLocal();
    ok(rr.estado === 'confirmado' && rr.enviados === 1 && (conteo['POST /facturas'] ?? 0) === antes409 + 2 && byId('recE2E002').writebackEstado === 'confirmado' && cF2 === cF2b && exps.get('recE2E002')!.cobro!.numeroFactura === 'F-E2E-2', 'reintento del 409: re-lee, vuelve a postear con el actualizadoEn fresco → confirmado; la factura NO se duplicó');

    // 500 parcial: e010 + e011
    modo.facturas = '500parcial';
    const antes500 = conteo['POST /facturas'] ?? 0;
    e = await DB.emitirFacturaAgenda({ idsExternos: ['recE2E010', 'recE2E011'], noFactura: 'F-E2E-3', fechaEmision: hoy, centroPorTipo: cPorTipo }, ACTOR, { api: apiRapida() });
    locales = await DB.listarExpedientesLocal();
    ok(e.ok && e.writeback.estado === 'pendiente' && (conteo['POST /facturas'] ?? 0) === antes500 + 1 && byId('recE2E010').writebackEstado === 'confirmado' && byId('recE2E011').writebackEstado === 'pendiente' && /500/.test(byId('recE2E011').writebackDetalle ?? ''), '500 parcial: un solo POST; registra hasta dónde llegó (e010 confirmado, e011 pendiente)');
    const rr3 = await DB.reintentarWriteback('F-E2E-3', ACTOR, { api: apiRapida() });
    const post3 = ultimo['POST /facturas'] as { expedientes: { id: string }[] };
    locales = await DB.listarExpedientesLocal();
    ok(rr3.estado === 'confirmado' && post3.expedientes.length === 1 && post3.expedientes[0].id === 'recE2E011' && byId('recE2E011').writebackEstado === 'confirmado' && exps.get('recE2E010')!.cobro!.numeroFactura === 'F-E2E-3', 'reintento tras el 500: solo se reenvía el pendiente (no se re-factura el ya hecho)');

    // 503 con backoff: e012
    modo.facturas = '503x1';
    const antes503 = conteo['POST /facturas'] ?? 0;
    e = await DB.emitirFacturaAgenda({ idsExternos: ['recE2E012'], noFactura: 'F-E2E-4', fechaEmision: hoy, centroPorTipo: cPorTipo }, ACTOR, { api: apiRapida() });
    ok(e.ok && e.writeback.estado === 'confirmado' && (conteo['POST /facturas'] ?? 0) === antes503 + 2, '503 → reintento con backoff → 201 confirmado (2 POST)');

    // 404: e013 desaparece de la Agenda
    exps.get('recE2E013')!.eliminado = true;
    e = await DB.emitirFacturaAgenda({ idsExternos: ['recE2E013'], noFactura: 'F-E2E-5', fechaEmision: hoy, centroPorTipo: cPorTipo }, ACTOR, { api: apiRapida() });
    locales = await DB.listarExpedientesLocal();
    ok(e.ok && e.writeback.estado === 'error' && byId('recE2E013').eliminado && byId('recE2E013').writebackEstado === 'error' && /404/.test(byId('recE2E013').writebackDetalle ?? ''), '404: el expediente ya no existe → sale de la cola (eliminado) con el error visible; la factura local queda para que la contadora decida');

    // Cobro de vuelta
    const cob = await DB.notificarCobroAgenda('F-E2E-1', ACTOR, { api: apiRapida() });
    const lote = ultimo['POST /lote'] as { items: { id: string; statusCobro: string; estatusPago: string; siActualizadoEn?: string }[] };
    locales = await DB.listarExpedientesLocal();
    ok(cob.estado === 'confirmado' && cob.enviados === 2 && lote.items.length === 2 && lote.items.every(i => i.statusCobro === 'PAGADO' && i.estatusPago === 'PAGADO' && !!i.siActualizadoEn) && byId('recE2E001').cobroWritebackEstado === 'confirmado' && byId('recE2E001').statusCobroExterno === 'PAGADO' && exps.get('recE2E003')!.cobro!.estatusPago === 'PAGADO', 'cobro de vuelta: POST /lote con PAGADO/PAGADO y siActualizadoEn para los 2 expedientes de F-E2E-1; espejo en PAGADO');
    const cob2 = await DB.notificarCobroAgenda('F-E2E-1', ACTOR, { api: apiRapida() });
    ok(cob2.estado === 'nada' && cob2.enviados === 0, 'segundo cobro de la misma factura → nada que enviar (no hay loop)');
    modo.lote = '409';
    const cob3 = await DB.notificarCobroAgenda('F-E2E-4', ACTOR, { api: apiRapida() });
    locales = await DB.listarExpedientesLocal();
    ok(cob3.estado === 'conflicto' && (conteo['POST /lote'] ?? 0) === 2 && byId('recE2E012').cobroWritebackEstado === 'conflicto', 'cobro con 409 → conflicto, un solo intento, queda visible');
    modo.lote = 'ok';
    process.env.FACTURAR_WRITEBACK = 'OFF';
    const cobOff = await DB.notificarCobroAgenda('F-E2E-4', ACTOR, { api: apiRapida() });
    e = await DB.emitirFacturaAgenda({ idsExternos: ['recE2E005'], noFactura: 'F-E2E-X', fechaEmision: hoy }, ACTOR);
    process.env.FACTURAR_WRITEBACK = 'ON';
    ok(cobOff.estado === 'omitido', 'FACTURAR_WRITEBACK=OFF: no se escribe nada a la Agenda (cobro omitido)');

    // Webhook
    const { POST: webhook } = await import('../src/app/api/webhook/agenda-facturacion/route');
    type Req = Parameters<typeof webhook>[0];
    const e002 = { ...exps.get('recE2E002')!, cobro: { ...exps.get('recE2E002')!.cobro, statusCobro: 'PAGADO', estatusPago: 'PAGADO' }, actualizadoEn: new Date().toISOString() };
    const aviso = JSON.stringify({ id: 'fact_evt_e2e_1', tipo: 'cobro.actualizado', ocurrido: new Date().toISOString(), cambios: { status_cobro: { antes: 'FACTURADO', despues: 'PAGADO' } }, expediente: e002 });
    const tSeg = Math.floor(Date.now() / 1000);
    const req = (cuerpo: string, firma: string | null, id = 'fact_evt_e2e_1') => new Request('http://localhost/api/webhook/agenda-facturacion', { method: 'POST', body: cuerpo, headers: { 'content-type': 'application/json', 'x-golden-evento': 'cobro.actualizado', 'x-golden-id': id, ...(firma ? { 'x-golden-firma': firma } : {}) } }) as unknown as Req;
    let res = await webhook(req(aviso, firmar(aviso, 'whsec_fact_e2e_secreto', tSeg)));
    let json = await res.json() as { ok?: boolean; procesados?: number; repetido?: boolean; motivo?: string };
    locales = await DB.listarExpedientesLocal();
    ok(res.status === 200 && json.ok === true && json.procesados === 1 && byId('recE2E002').statusCobroExterno === 'PAGADO' && byId('recE2E002').estatusPagoExterno === 'PAGADO', 'webhook con firma válida → 200, el espejo refleja el cobro que Golden cambió directo en la Agenda (PAGADO)');
    res = await webhook(req(aviso, firmar(aviso, 'whsec_fact_e2e_secreto', tSeg))); json = await res.json();
    ok(res.status === 200 && json.repetido === true, 'mismo id de aviso otra vez → 200 repetido, se ignora');
    res = await webhook(req(aviso, firmar(aviso, 'otro-secreto', tSeg))); json = await res.json();
    ok(res.status === 401 && json.motivo === 'no_coincide', 'firma con otro secreto → 401');
    res = await webhook(req(aviso, firmar(aviso, 'whsec_fact_e2e_secreto', tSeg - 400), 'fact_evt_e2e_2')); json = await res.json();
    ok(res.status === 401 && json.motivo === 'fuera_de_tiempo', 't de más de 5 minutos → 401 (fuera de tiempo)');
    res = await webhook(req(aviso, null, 'fact_evt_e2e_3'));
    ok(res.status === 401, 'sin firma → 401');
    const { count: evCount } = await sb.from('facturacion_webhook_evento').select('id', { count: 'exact', head: true }).like('id', 'fact_evt_e2e%');
    ok(evCount === 1, 'solo el aviso válido quedó registrado (los rechazados no se guardan)');

    // Sync incremental
    exps.get('recE2E006')!.terminado = true; exps.get('recE2E006')!.statusProceso = 'APROBO'; exps.get('recE2E006')!.actualizadoEn = new Date(Date.now() + 1000).toISOString();
    const s2 = await DB.sincronizarAgenda({ actor: ACTOR, api: apiRapida() });
    const q2 = ultimo['GET /expedientes'] as Record<string, string>;
    locales = await DB.listarExpedientesLocal();
    const syncE = await DB.getSyncEstado();
    ok(s2.ok && !!q2.cambiadosDesde && !q2.desde && s2.leidos >= 1 && byId('recE2E006').terminado && byId('recE2E006').estadoTarifa === 'resuelta' && M_enCola(byId('recE2E006')) && syncE?.corridas === 2 && Date.parse(syncE?.ultimoActualizadoEn ?? '') === Date.parse(exps.get('recE2E006')!.actualizadoEn!), `segunda corrida: cambiadosDesde=<último actualizadoEn>, trae solo lo cambiado (${s2.leidos}); e006 pasó a terminado y entra en cola; watermark = el más reciente`);
    const { data: logs } = await sb.from('facturacion_log').select('accion, metodo, status_http, ok, ruta, detalle').eq('actor', ACTOR);
    ok((logs ?? []).length > 10 && (logs ?? []).some(l => l.accion === 'facturar' && l.status_http === 409 && !l.ok) && (logs ?? []).some(l => l.accion === 'lote' && l.ok) && !(logs ?? []).some(l => JSON.stringify(l).includes('llave-de-prueba')), `facturacion_log: ${(logs ?? []).length} llamadas registradas (incluye el 409 y el lote), sin la llave`);

    // ── 018: "No se factura" ──
    console.log('\n   018 · marcar / revertir "no se factura"');
    const nf1 = await DB.marcarNoFactura({ empresaIdExterno: EMP_C, empresaNombreExterno: 'GOLDEN TALENT', motivo: '  intercompany  ' }, ACTOR);
    locales = await DB.listarExpedientesLocal();
    ok(nf1.ok && nf1.reclasificados === 1 && byId('recE2E014').estadoTarifa === 'excluido_no_factura' && /intercompany/.test(byId('recE2E014').detalleTarifa) && byId('recE2E014').nitResuelto === null, 'marcar GOLDEN TALENT como no se factura → su expediente pasa a excluido_no_factura con el motivo');
    let vNF = await DB.vistaPorFacturar();
    let smNF = await DB.empresasSinMapear({});
    ok(vNF.kpis.excluidosNoFactura === 1 && vNF.kpis.sinMapear === 0 && vNF.sinMapear.empresas === 0 && smNF.totalEmpresas === 0 && !vNF.grupos.some(g => g.empresaIdExterno === EMP_C) && vNF.noFacturan.length === 1 && vNF.noFacturan[0].empresaIdExterno === EMP_C && vNF.noFacturan[0].motivo === 'intercompany' && vNF.noFacturan[0].expedientes === 1 && vNF.noFacturan[0].marcadoPor === ACTOR, 'sale de la cola y de "Sin mapear"; se cuenta aparte (1) y aparece en "No se facturan" con motivo y 1 expediente');
    const vNFf = await DB.vistaPorFacturar({ sinRpc: true });
    ok(JSON.stringify(vNFf.kpis) === JSON.stringify(vNF.kpis) && JSON.stringify(vNFf.noFacturan.map(n => ({ ...n, marcadoEn: null }))) === JSON.stringify(vNF.noFacturan.map(n => ({ ...n, marcadoEn: null }))), 'fallback sin RPC: mismos KPIs y misma lista de "No se facturan"');
    exps.get('recE2E014')!.actualizadoEn = new Date(Date.now() + 2000).toISOString(); exps.get('recE2E014')!.puesto = 'CAMBIADO';
    const s4 = await DB.sincronizarAgenda({ actor: ACTOR, api: apiRapida() });
    locales = await DB.listarExpedientesLocal();
    ok(s4.ok && s4.leidos >= 1 && byId('recE2E014').puesto === 'CAMBIADO' && byId('recE2E014').estadoTarifa === 'excluido_no_factura', 'un sync posterior trae el cambio del expediente pero respeta la marca (no vuelve a cliente_sin_mapear)');
    const nf2 = await DB.quitarNoFactura(EMP_C, ACTOR);
    locales = await DB.listarExpedientesLocal(); vNF = await DB.vistaPorFacturar(); smNF = await DB.empresasSinMapear({});
    ok(nf2.ok && nf2.reclasificados === 1 && byId('recE2E014').estadoTarifa === 'cliente_sin_mapear' && vNF.noFacturan.length === 0 && vNF.kpis.excluidosNoFactura === 0 && smNF.totalEmpresas === 1 && smNF.filas[0].empresaIdExterno === EMP_C, 'quitar la marca: vuelve a cliente_sin_mapear y reaparece en "Sin mapear"');
    const nf3 = await DB.marcarNoFactura({ empresaIdExterno: EMP_B, motivo: 'reclutamiento — Fase A' }, ACTOR);
    locales = await DB.listarExpedientesLocal();
    ok(nf3.ok && byId('recE2E008').estadoTarifa === 'excluido_no_factura' && !(await DB.vistaPorFacturar()).grupos.some(g => g.nit === NIT_B), 'una empresa YA mapeada también se puede marcar: su grupo desaparece de la lista');
    const nf4 = await DB.quitarNoFactura(EMP_B, ACTOR);
    locales = await DB.listarExpedientesLocal();
    ok(nf4.ok && byId('recE2E008').estadoTarifa === 'sin_tarifa' && byId('recE2E008').nitResuelto === NIT_B, 'al quitarla recupera el mapeo que tenía (vuelve a sin_tarifa con su NIT, no a sin mapear)');
    ok(!(await DB.quitarNoFactura(EMP_B, ACTOR)).ok && !(await DB.marcarNoFactura({ empresaIdExterno: '' }, ACTOR)).ok, 'quitar una marca inexistente / marcar sin empresa → error claro');
    const nf5 = await DB.marcarNoFactura({ empresaIdExterno: EMP_C, empresaNombreExterno: 'GOLDEN TALENT', motivo: 'intercompany' }, ACTOR);
    ok(nf5.ok, 'GOLDEN TALENT queda marcada para la sección de volumen');

    // Sin llave / HIT
    process.env.EMPRESA_SLUG = 'hit';
    const sinKey = await DB.sincronizarAgenda({ actor: ACTOR });   // sin api inyectada: usa la config → HIT no tiene llave real pero sí la de prueba… la quitamos:
    process.env.FACTURACION_API_KEY_AGENDA = '';
    const sinKey2 = await DB.sincronizarAgenda({ actor: ACTOR });
    ok(sinKey.ok && !!sinKey2.omitido, 'sin FACTURACION_API_KEY_AGENDA el sync se omite sin tocar la Agenda');
    process.env.FACTURACION_API_KEY_AGENDA = 'llave-de-prueba';
    process.env.EMPRESA_SLUG = 'golden';

    console.log('\nD. Volumen: ~8,000 filas en el espejo (como Golden)');
    const vol: Record<string, unknown>[] = [];
    for (let i = 0; i < 7000; i++) { const emp = i % 200; vol.push({ fuente: 'agenda', id_externo: `recVOL${String(i).padStart(5, '0')}`, empresa_id_externo: `recVOLemp${String(emp).padStart(3, '0')}`, empresa_nombre_externo: `VOL EMPRESA ${String(emp).padStart(3, '0')}`, estado_tarifa: 'cliente_sin_mapear', terminado: true, cancelado: false, eliminado: false, status_cobro_externo: i % 3 ? 'PENDIENTE' : null, fecha_ingreso: `2026-${String(1 + (i % 9)).padStart(2, '0')}-15`, tipo_prueba: 'POLIGRAFO', persona: `VOL ${i}` }); }
    for (let i = 0; i < 1000; i++) vol.push({ fuente: 'agenda', id_externo: `recVOLpsi${String(i).padStart(4, '0')}`, empresa_id_externo: `recVOLemp${String(i % 13).padStart(3, '0')}`, empresa_nombre_externo: `VOL EMPRESA ${String(i % 13).padStart(3, '0')}`, estado_tarifa: 'excluido_psicometrica', terminado: true, cancelado: false, eliminado: false, status_cobro_externo: 'PENDIENTE', fecha_ingreso: '2026-08-01', tipo_prueba: 'PSICOMETRICAS' });
    for (let i = 0; i < vol.length; i += 1000) { const { error } = await sb.from('facturacion_expediente').insert(vol.slice(i, i + 1000)); if (error) throw new Error(`seed volumen: ${error.message}`); }
    const { count: nVol } = await sb.from('facturacion_expediente').select('id', { count: 'exact', head: true }).eq('fuente', 'agenda');
    ok((nVol ?? 0) >= 8014, `espejo con ${nVol} filas (7,000 sin mapear en 200 empresas + 1,000 psicométricas + las del ciclo)`);
    let t0 = Date.now(); const vistaV = await DB.vistaPorFacturar(); const msRpc = Date.now() - t0;
    ok(msRpc < 2000 && vistaV.agregadoEnSql && vistaV.grupos.length === 2 && vistaV.kpis.listos === 1 && vistaV.kpis.sinTarifa === 2 && vistaV.kpis.sinMapear === 7000 && vistaV.sinMapear.empresas === 200 && vistaV.kpis.excluidos === 1001 && vistaV.kpis.excluidosNoFactura === 1 && vistaV.noFacturan.length === 1 && vistaV.total === (nVol ?? 0), `vistaPorFacturar con ${nVol} filas: ${msRpc} ms (< 2 s); la lista sigue con los 2 clientes del ciclo (1 listo, 2 sin tarifa); KPIs: 7,000 sin mapear en 200 empresas, 1,001 psicométricas — nada de eso se cargó (${JSON.stringify({ grupos: vistaV.grupos.length, kpis: vistaV.kpis })})`);
    t0 = Date.now(); const vistaVF = await DB.vistaPorFacturar({ sinRpc: true }); const msFb = Date.now() - t0;
    ok(JSON.stringify(vistaVF.kpis) === JSON.stringify(vistaV.kpis) && JSON.stringify(vistaVF.grupos) === JSON.stringify(vistaV.grupos), `fallback sin 017 con ${nVol} filas: ${msFb} ms, mismos KPIs y grupos (solo columnas livianas de la cola, nunca el raw)`);
    t0 = Date.now(); const p1 = await DB.empresasSinMapear({ limite: 25 }); const msSm = Date.now() - t0;
    const p8 = await DB.empresasSinMapear({ limite: 25, desde: 175 });
    const p9 = await DB.empresasSinMapear({ limite: 25, desde: 200 });
    const pq = await DB.empresasSinMapear({ q: 'VOL EMPRESA 007' });
    ok(msSm < 2000 && p1.agregadoEnSql && p1.filas.length === 25 && p1.totalEmpresas === 200 && p1.totalExpedientes === 7000 && p1.filas[0].expedientes === 35 && p8.filas.length === 25 && p9.filas.length === 0 && p9.totalEmpresas === 200 && pq.totalEmpresas === 1 && pq.filas[0].empresaNombreExterno === 'VOL EMPRESA 007' && pq.filas[0].expedientes === 35, `"Sin mapear" paginada en SQL: página 1 = 25 de 200 empresas (${msSm} ms), la más cargada con 35; página 8 = las últimas 25, página 9 vacía; búsqueda "VOL EMPRESA 007" → 1`);
    const pqF = await DB.empresasSinMapear({ q: 'VOL EMPRESA 007', sinRpc: true });
    ok(JSON.stringify(pqF.filas) === JSON.stringify(pq.filas) && pqF.totalEmpresas === 1, 'fallback de "Sin mapear" coincide con la RPC');
    const sm1 = Date.now(); const s3 = await DB.sincronizarAgenda({ actor: ACTOR, api: apiRapida() }); const msSync = Date.now() - sm1;
    ok(s3.ok && s3.reclasificados === 0, `el sync con ${nVol} filas sigue incremental (${msSync} ms, ${s3.leidos} leídos, 0 re-resueltos: las filas sin raw se saltan)`);
  } finally {
    process.env.EMPRESA_SLUG = slugOriginal;
    servidor.close();
    if (CONSERVAR) {
      console.log('\n  · --conservar: los datos de prueba quedan en la base (F-E2E-*, NIT 99990011K/99990012K, 8,000 filas recVOL*). Limpiar con --solo-limpiar.');
    } else {
      await limpiar();
      const { count: v } = await sb.from('facturacion_expediente').select('id', { count: 'exact', head: true }).like('id_externo', 'recVOL%');
      const [{ count: a }, { count: b }, { count: c }, { count: d }, { count: f }] = await Promise.all([
        sb.from('facturas_clientes').select('id', { count: 'exact', head: true }).in('no_factura', FACTS),
        sb.from('factura_detalle_expediente').select('id', { count: 'exact', head: true }).in('no_factura', FACTS),
        sb.from('facturacion_expediente').select('id', { count: 'exact', head: true }).like('id_externo', 'recE2E%'),
        sb.from('cliente_externo').select('id', { count: 'exact', head: true }).in('empresa_id_externo', [EMP_A, EMP_B, EMP_C]),
        sb.from('clientes').select('id', { count: 'exact', head: true }).in('nit', [NIT_A, NIT_B]),
      ]);
      ok(a === 0 && b === 0 && c === 0 && d === 0 && f === 0 && v === 0, 'limpieza verificada: 0 facturas / detalle (cascade) / expedientes / mapeos / clientes de prueba / filas de volumen');
    }
  }
  console.log(`\n${pass} 🟢 / ${fail} 🔴`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

function execSyncFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) out.push(...execSyncFiles(p)); else out.push(p); }
  return out;
}
function M_enCola(e: import('../src/lib/facturacion-agenda/tipos').ExpedienteLocal): boolean {
  return e.terminado && !e.cancelado && !e.eliminado && e.estadoTarifa !== 'excluido_psicometrica' && !e.facturaId && (!e.statusCobroExterno || /^(PENDIENTE|SIN_STATUS)$/i.test(e.statusCobroExterno));
}
