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

const NIT_A = '99990011K', NIT_B = '99990012K', NIT_C = '99990013K';
const EMP_A = 'recE2EempA', EMP_B = 'recE2EempB', EMP_C = 'recE2EempC', EMP_D = 'recE2EempD', EMP_E = 'recE2EempE', EMP_F = 'recE2EempF';
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
  const m19 = rd('supabase/migrations/019_detalle_facturacion.sql');
  const sin19 = m19.replace(/--.*$/gm, '');
  ok(/create table if not exists detalle_facturacion \(/.test(m19) && /check \(estado in \('borrador', 'enviada', 'aprobada', 'facturada', 'anulada'\)\)/.test(m19) && /correlativo\s+text not null unique default \('DET-'/.test(m19) && /aprobado_canal in \('correo', 'link', 'otro'\)/.test(m19) && /alter table facturacion_expediente add column if not exists detalle_id uuid references detalle_facturacion\(id\)/.test(m19) && /create index if not exists idx_fact_exp_detalle/.test(m19), '019: detalle_facturacion (5 estados, correlativo DET-0001, canal de aprobación) + facturacion_expediente.detalle_id con índice');
  ok(/create or replace function detalle_facturacion_crear\(p_actor text, p_ids_externos text\[\], p_notas text default null\)/.test(m19) && /EXPEDIENTE_RESERVADO/.test(m19) && /EXPEDIENTE_NO_FACTURABLE/.test(m19) && /DETALLE_VARIOS_CLIENTES/.test(m19) && /create or replace function detalle_facturacion_anular/.test(m19) && /DETALLE_FACTURADO/.test(m19) && /'detalles',/.test(m19) && !/\b(drop|truncate)\b/i.test(sin19) && !/\bdelete\s+from\b/i.test(sin19) && !/^\s*(begin|commit)\s*;/im.test(sin19) && !/facturacion_agenda_emitir/.test(sin19), '019: RPC crear (reserva todo o nada: resueltos, en cola, un cliente, no reservados) y anular (libera; nunca facturada); resumen cuenta detalles; no toca la RPC de emisión; sin drop/delete/commit');
  const m20 = rd('supabase/migrations/020_clientes_nombre_comercial_aliases.sql');
  const sin20 = m20.replace(/--.*$/gm, '');
  ok(/alter table clientes add column if not exists nombre_comercial text;/.test(m20) && /alter table clientes add column if not exists aliases text\[\] not null default '\{\}';/.test(m20) && /create index if not exists idx_clientes_aliases on clientes using gin \(aliases\);/.test(m20) && !/\b(drop|truncate)\b/i.test(sin20) && !/\bdelete\s+from\b/i.test(sin20) && !/^\s*(begin|commit)\s*;/im.test(sin20) && !/\b(update|insert)\b/i.test(sin20), '020: clientes.nombre_comercial + aliases text[] (default {}) + índice GIN; idempotente, sin drop/delete/commit, no toca datos');
  const m21 = rd('supabase/migrations/021_cobro_pagado_fuera_cola.sql');
  const sin21 = m21.replace(/--.*$/gm, '');
  ok(/create or replace function facturacion_agenda_cobro_pendiente\(s_status text, s_pago text\)/.test(m21) && /upper\(btrim\(coalesce\(s_pago, ''\)\)\) <> 'PAGADO'/.test(m21) && /create or replace function facturacion_agenda_cobro_pendiente\(s text\)/.test(m21) && /select facturacion_agenda_cobro_pendiente\(s, null\)/.test(m21), '021: cobro_pendiente(status, pago) = status pendiente Y pago <> PAGADO (igualdad exacta, sin mayúsculas/espacios); la de un argumento queda como wrapper');
  ok((m21.match(/facturacion_agenda_cobro_pendiente\((e\.)?status_cobro_externo, (e\.)?estatus_pago_externo\)/g) ?? []).length === 4 && !/facturacion_agenda_cobro_pendiente\((e\.)?status_cobro_externo\)/.test(m21) && /create or replace function facturacion_agenda_resumen/.test(m21) && /create or replace function facturacion_agenda_sin_mapear/.test(m21) && /'detalles',/.test(m21) && /en_detalle/.test(m21) && /'no_facturan'/.test(m21), '021: resumen() (cola + 2 filters de conteos) y sin_mapear() pasan AMBOS campos; resumen conserva lo de 018/019 (no_facturan, en_detalle, detalles)');
  ok(!/\b(drop|truncate)\b/i.test(sin21) && !/\bdelete\s+from\b/i.test(sin21) && !/^\s*(begin|commit)\s*;/im.test(sin21) && !/\b(alter|create) table\b/i.test(sin21) && !/\b(update|insert)\b/i.test(sin21), '021: solo funciones; sin tabla, sin drop/delete/commit, no toca datos');
  const m22 = rd('supabase/migrations/022_facturar_desde_por_cliente.sql');
  const sin22 = m22.replace(/--.*$/gm, '');
  ok(/alter table cliente_externo add column if not exists facturar_desde date;/.test(m22) && /create or replace function facturacion_agenda_en_arranque\(p_fuente text, p_empresa text, p_fecha date\)/.test(m22) && /p_fecha is not null and p_fecha < m\.facturar_desde/.test(m22) && (m22.match(/facturacion_agenda_en_arranque\((e\.)?fuente, (e\.)?empresa_id_externo, (e\.)?fecha_ingreso\)/g) ?? []).length === 4 && (m22.match(/facturacion_agenda_cobro_pendiente\((e\.)?status_cobro_externo, (e\.)?estatus_pago_externo\)/g) ?? []).length === 4 && /'detalles',/.test(m22) && /en_detalle/.test(m22), '022: cliente_externo.facturar_desde (date, null = sin corte) + en_arranque(fuente, empresa, fecha) (sin fecha → no excluye); resumen (cola + 2 conteos) y sin_mapear la aplican además de la 021; conservan 018/019');
  ok(!/\b(drop|truncate)\b/i.test(sin22) && !/\bdelete\s+from\b/i.test(sin22) && !/^\s*(begin|commit)\s*;/im.test(sin22) && !/\b(update|insert)\b/i.test(sin22) && !/11854243|GENESIS/i.test(sin22), '022: no clava NIT ni fecha de GENESIS en el SQL (el corte es un dato por cliente); sin drop/delete/commit, no toca datos');
  ok(fs.readdirSync('supabase/migrations').filter(f => /^02[3-9]_|^0[3-9]\d_/.test(f)).length === 0, 'sin migraciones después de la 022');
  const db22 = rd('src/lib/db/facturacion-agenda.ts'), mapeo22 = rd('src/lib/facturacion-agenda/mapeo.ts');
  ok(/export function antesDelArranque\(/.test(mapeo22) && /&& !e\.arranqueExcluido;/.test(mapeo22) && /export const arranquePorEmpresa/.test(db22) && /export const anotarArranque/.test(db22) && /return anotarArranque\(rows\.map\(rowToLocal\), arranquePorEmpresa\(mapeos\)\);/.test(db22) && /empresa_id_externo\.neq\.\$\{empresa\},fecha_ingreso\.gte\.\$\{desde\},fecha_ingreso\.is\.null/.test(db22) && /resumenSinRpc\(sb, arranquePorEmpresa\(mapeos\)\)/.test(db22) && !/facturar_desde/.test(db22.slice(db22.indexOf('export async function guardarMapeo('), db22.indexOf('export async function reclasificar('))), 'app: enCola() respeta arranqueExcluido (anotado al leer desde facturar_desde); el fallback PostgREST filtra por empresa con corte; los upserts del mapeo / no-factura NO tocan facturar_desde (sync-safe)');
  ok(/data-arranque/.test(rd('src/components/por-facturar/grupo-detalle.tsx')) && /data-antes-arranque/.test(rd('src/components/por-facturar/grupo-detalle.tsx')), 'detalle del cliente: aviso del corte y badge "antes del arranque" por fila (siguen en la lista para conciliar)');
  ok(/export function cobroPendiente\(statusCobro: string \| null \| undefined, estatusPago\?: string \| null\)/.test(rd('src/lib/facturacion-agenda/mapeo.ts')) && /normalizarTexto\(estatusPago\) !== 'PAGADO'/.test(rd('src/lib/facturacion-agenda/mapeo.ts')) && /cobroPendiente\(e\.statusCobroExterno, e\.estatusPagoExterno\)/.test(rd('src/lib/facturacion-agenda/mapeo.ts')) && /PAGO_NO_PAGADO_OR = 'estatus_pago_externo\.is\.null,estatus_pago_externo\.not\.ilike\.PAGADO'/.test(rd('src/lib/db/facturacion-agenda.ts')) && /\.or\(COBRO_PENDIENTE_OR\)\.or\(PAGO_NO_PAGADO_OR\)/.test(rd('src/lib/db/facturacion-agenda.ts')), 'filtro gemelo en la app: enCola() y el PostgREST de resumenSinRpc / sin mapear exigen pago <> PAGADO (null y NO PAGADO siguen en cola)');
  const dbSrc19 = rd('src/lib/db/facturacion-agenda.ts');
  // ── PULIDO: buscador por todos los nombres, crear cliente inline, re-resolver, nombre comercial / marcas ──
  const buscarSrc = rd('src/lib/clientes/buscar.ts');
  ok(/normalize\('NFD'\)\.replace\(\/\\p\{Diacritic\}\/gu, ''\)/.test(buscarSrc) && /\.toLowerCase\(\)/.test(buscarSrc) && !/from '@\/lib\/(db|supabase)/.test(buscarSrc), 'buscar.ts: normaliza sin tildes ni mayúsculas en los dos lados; puro (sin IO)');
  const grupoSrc = rd('src/components/por-facturar/grupo-detalle.tsx'), smSrc = rd('src/components/por-facturar/sin-mapear-lista.tsx');
  ok(/buscarClientes\(datos\.clientes, filtro\)/.test(grupoSrc) && /buscarClientes\(clientes, filtroCliente\)/.test(smSrc) && !/slice\(0, 60\)/.test(grupoSrc + smSrc) && /etiquetaOpcionCliente\(c, filtro\)/.test(grupoSrc) && /etiquetaOpcionCliente\(c, filtroCliente\)/.test(smSrc), 'panel de mapeo (individual y lote): buscador por todos los nombres + NIT, sin el tope de 60; la opción dice por qué nombre apareció');
  ok(/data-accion="crear-cliente-inline"/.test(grupoSrc) && /<ModalClienteForm/.test(grupoSrc) && /exigirNit/.test(grupoSrc) && /onCreado=\{c => \{ void mapearA\(c\.id, c\); \}\}/.test(grupoSrc) && /\?generar=1/.test(grupoSrc) && /generarInicial/.test(rd('src/app/(app)/por-facturar/[grupo]/page.tsx')), 'crear cliente inline desde "Mapear": reusa el modal de alta (NIT obligatorio), mapea en el mismo paso y abre "Generar tarifas" en el cliente');
  const pfc = rd('src/components/por-facturar/por-facturar-client.tsx');
  ok(/data-accion="re-resolver"/.test(pfc) && /reresolverPreciosAction/.test(pfc) && /export async function reresolverPrecios\(\)/.test(dbSrc19) && /return \{ ok: true, reclasificados: await reclasificar\(\) \}/.test(dbSrc19), '"Re-resolver precios" en el tablero: reclasificar() local, sin ir a la Agenda');
  ok(/nombresAgendaPorNit/.test(dbSrc19) && /slimDe\(c, agenda\)/.test(dbSrc19) && /nombresDe\(s\)\.map\(nombreBase\)/.test(dbSrc19) && /exacto \? 3 : porNit \? 2 : contiene \? 1 : 0/.test(dbSrc19), 'ClienteSlim lleva razón social / nombre comercial / marcas / nombres en la Agenda; la sugerencia de mapeo los usa (exacto primero)');
  const modal = rd('src/components/clientes/modal-cliente-form.tsx'), card = rd('src/components/clientes/nombres-cliente-card.tsx');
  ok(/aria-label="Nombre comercial"/.test(modal) && /<ChipsInput/.test(modal) && /nombreComercial: nombreComercial\.trim\(\) \|\| undefined/.test(modal) && /editarNombresClienteAction/.test(card) && /data-accion="editar-nombres"/.test(card) && !/window\.(confirm|alert|prompt)\(/.test(modal + card + grupoSrc + smSrc + rd('src/components/clientes/chips-input.tsx')), 'form de cliente (crear) y tarjeta "Nombres y marcas" (editar): nombre comercial + chips de marcas; sin diálogos del navegador');
  ok(/coincideCliente\(\{ id: c\.custId, name: c\.nombre \}, search, terminos\[c\.custId\]\)/.test(rd('src/components/clientes/list-client.tsx')) && /terminosDe\(c\)/.test(rd('src/app/(app)/clientes/page.tsx')), 'lista de Clientes: busca por nombre, razón social, nombre comercial, marcas y NIT (sin tildes)');
  ok(/if \(Object\.keys\(extra020\)\.length && FALTA_020\.test\(msg\)\)/.test(rd('src/lib/db/clientes.ts')) && /export async function actualizarNombresCliente\(/.test(rd('src/lib/db/clientes.ts')), 'db/clientes: alta sin 020 sigue funcionando (los campos nuevos solo viajan si vienen); editar nombres avisa si falta la 020');
  // FIX COMPLETO DOBLE: el precio sale del tipoPrueba de la fila; procesoSolicitado nunca agrega componentes.
  const mapeoFix = rd('src/lib/facturacion-agenda/mapeo.ts');
  ok(/export function serviciosDe\(/.test(mapeoFix) && /export function esMitadDeCompleto\(/.test(mapeoFix) && !/if \(p\.includes\('COMPLET'\)\) return 'COMPLETO'/.test(mapeoFix) && /for \(const s of servicios\)/.test(mapeoFix) && /resolverTarifa\(ctx\.tarifas, \{ nit, tipoPrueba: s,/.test(mapeoFix) && /data-servicio=/.test(rd('src/components/por-facturar/grupo-detalle.tsx')) && /COMPLETO · mitad/.test(rd('src/components/por-facturar/grupo-detalle.tsx')), 'motor: serviciosDe(tipoPrueba) parte la lista y cotiza CADA servicio de la fila; ya no existe "procesoSolicitado COMPLETO → los dos"; la pantalla muestra el servicio real y "COMPLETO · mitad"');
  const emitirBody = dbSrc19.slice(dbSrc19.indexOf('export async function emitirFacturaAgenda('), dbSrc19.indexOf('// ── Write-back a la Agenda'));
  ok(/input\.detalleId/.test(emitirBody) && /detalle\.estado !== 'aprobada'/.test(emitirBody) && /exactamente los/.test(emitirBody), 'emitirFacturaAgenda: exige un detalle APROBADO y exactamente sus expedientes (todo lo de la Agenda pasa por el detalle)');
  const detSrc = rd('src/lib/db/detalle-facturacion.ts');
  ok(/rpc<Row>\('detalle_facturacion_crear'/.test(detSrc) && /rpc<Row>\('detalle_facturacion_anular'/.test(detSrc) && /transicionValida\(d\.estado, a\)/.test(detSrc) && /\.eq\('estado', d\.estado\)/.test(detSrc) && /d\.estado !== 'aprobada'/.test(detSrc), 'db/detalle-facturacion: crear y anular por RPC; transiciones validadas y escritas con el estado previo como condición; facturar solo aprobada');
  const detUI = rd('src/components/por-facturar/detalle-view.tsx');
  ok(/data-accion="marcar-enviada"/.test(detUI) && /data-accion="marcar-aprobada"/.test(detUI) && /aria-label="Quién aprobó"/.test(detUI) && /data-accion="facturar"/.test(detUI) && /d\.estado === 'aprobada' && !anulando && <button/.test(detUI) && /data-accion="anular"/.test(detUI) && /\/imprimir\/detalle\//.test(detUI) && !/window\.(confirm|alert|prompt)\(/.test(detUI), 'detalle: botones por estado (enviada → aprobada con quién/canal → Facturar solo aprobada → anular), Imprimir / PDF; sin diálogos del navegador');
  const grupoUI = rd('src/components/por-facturar/grupo-detalle.tsx');
  ok(/data-accion="generar-detalle"/.test(grupoUI) && /crearDetalleAction/.test(grupoUI) && !/emitirFacturaAgendaAction|Facturar seleccionados/.test(grupoUI) && /En detalle →/.test(grupoUI), 'grupo: la selección genera un DETALLE (ya no factura directo); los reservados muestran "En detalle →"');
  ok(fs.existsSync('src/app/imprimir/detalle/[id]/page.tsx') && /@media print/.test(rd('src/components/por-facturar/detalle-imprimible.tsx')) && /Detalle de servicios/.test(rd('src/components/por-facturar/detalle-imprimible.tsx')) && /Detalle de la factura/.test(rd('src/components/por-facturar/detalle-imprimible.tsx')) && /data-faltantes/.test(rd('src/components/por-facturar/detalle-imprimible.tsx')), 'imprimible fuera del shell: "Detalle de servicios / Pre-liquidación" sin número de SAT; con número cuando ya se facturó; faltantes marcados');
  ok(/data-accion="imprimir-detalle"/.test(rd('src/components/por-facturar/procesos-agenda-section.tsx')) && /data-tab="detalles"/.test(rd('src/components/por-facturar/por-facturar-client.tsx')) && /data-kpi="detalles"/.test(rd('src/components/por-facturar/por-facturar-client.tsx')), 'post-factura: "Imprimir detalle" en la sección de procesos; tablero: pestaña y KPI "Detalles por aprobar"');
  const mapeoSrc = rd('src/lib/facturacion-agenda/mapeo.ts');
  const cuerpoClas = mapeoSrc.slice(mapeoSrc.indexOf('export function clasificarExpediente('));
  ok(cuerpoClas.indexOf('esPsicometrica(exp)') < cuerpoClas.indexOf('noFacturaEmpresas?.has(') && cuerpoClas.indexOf('noFacturaEmpresas?.has(') < cuerpoClas.indexOf('nitPorEmpresa.get('), 'motor: orden psicométricas → no se factura → mapeo a NIT → cliente sin mapear');
  for (const fn of ['marcarNoFacturaAction', 'quitarNoFacturaAction']) ok(new RegExp(`export async function ${fn}\\([^)]*\\)[^{]*\\{\\s*const permiso = await autorizar\\('facturar_agenda'\\);`).test(rd('src/app/(app)/por-facturar/actions.ts')), `${fn}: primera línea autorizar('facturar_agenda')`);
  for (const fn of ['mapearClientesLoteAction', 'marcarNoFacturaLoteAction']) ok(new RegExp(`export async function ${fn}\\([^)]*\\)[^{]*\\{\\s*const permiso = await autorizar\\('facturar_agenda'\\);`).test(rd('src/app/(app)/por-facturar/actions.ts')), `${fn}: primera línea autorizar('facturar_agenda') (masivo)`);
  ok(/export async function empresasSinMapearTodasAction\([^)]*\)[^{]*\{\s*await exigir\('ver'\);/.test(rd('src/app/(app)/por-facturar/actions.ts')), "empresasSinMapearTodasAction: exigir('ver') (seleccionar todo el filtro)");
  const dbLote = rd('src/lib/db/facturacion-agenda.ts');
  ok((dbLote.match(/export async function (guardarMapeoLote|marcarNoFacturaLote)\(/g) ?? []).length === 2 && /\.upsert\(empresas\.map\(/.test(dbLote) && /q\.in\('empresa_id_externo', filtro\.empresasIdExterno\)/.test(dbLote), 'lote: guardarMapeoLote / marcarNoFacturaLote = UN upsert con todas las empresas + una sola re-resolución (reclasificar con in)');
  const smUI = rd('src/components/por-facturar/sin-mapear-lista.tsx');
  ok(/data-barra-masiva/.test(smUI) && /aria-label="Seleccionar toda la página"/.test(smUI) && /data-accion="seleccionar-filtro"/.test(smUI) && /data-accion="confirmar-no-factura-lote"/.test(smUI) && /data-accion="confirmar-mapear-lote"/.test(smUI) && /Mapear →/.test(smUI) && !/window\.(confirm|alert|prompt)\(/.test(smUI), 'pestaña "Sin mapear": checkbox por fila, toda la página, todo el filtro, barra masiva (no se factura con motivo / mapear a un cliente), "Mapear →" individual se mantiene');
  ok(/data-accion="no-factura"/.test(rd('src/components/por-facturar/grupo-detalle.tsx')) && /NoFacturaBanner/.test(rd('src/components/por-facturar/grupo-detalle.tsx')) && /data-tab="no-facturan"/.test(rd('src/components/por-facturar/por-facturar-client.tsx')) && /quitarNoFacturaAction/.test(rd('src/components/por-facturar/por-facturar-client.tsx')), 'pantalla: tercera opción "No se factura" con motivo en el panel Mapear, banner reversible en el detalle y pestaña "No se facturan"');
  const dbSrc = rd('src/lib/db/facturacion-agenda.ts');
  const vistaBody = dbSrc.slice(dbSrc.indexOf('export async function vistaPorFacturar('), dbSrc.indexOf('export interface EmpresaSinMapear'));
  ok(/sb\.rpc\('facturacion_agenda_resumen'/.test(vistaBody) && !/listarExpedientesLocal\(/.test(vistaBody) && !/paginar</.test(vistaBody) && /resumenSinRpc\(/.test(vistaBody), 'vistaPorFacturar: agregados por RPC (017) con fallback liviano; NUNCA listarExpedientesLocal() ni paginar del espejo en el render');
  const smBody = dbSrc.slice(dbSrc.indexOf('export async function empresasSinMapear('), dbSrc.indexOf('export interface GrupoDetalle'));
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
  for (const fn of ['sincronizarAgendaAction', 'mapearClienteAction', 'reintentarWritebackAction', 'crearDetalleAction', 'marcarEnviadaAction', 'marcarAprobadaAction', 'anularDetalleAction', 'facturarDetalleAction']) {
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
  const ui = ['por-facturar-client', 'grupo-detalle', 'reintentar-writeback-button', 'procesos-agenda-section', 'facturar-dialogo', 'detalle-view', 'sin-mapear-lista'].map(f => rd(`src/components/por-facturar/${f}.tsx`)).join('\n');
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
  ok(M.tipoCobrado('COMPLETO', 'SOCIOECONOMICO') === 'SOCIOECONOMICO' && M.tipoCobrado('COMPLETO', 'POLIGRAFO') === 'POLIGRAFO' && M.tipoCobrado('COMPLETO', 'POLIGRAFO, SOCIOECONOMICO') === 'POLIGRAFO + SOCIOECONOMICO' && M.tipoCobrado('COMPLETO', 'COMPLETO, SOCIOECONOMICO') === 'SOCIOECONOMICO' && M.tipoCobrado('COMPLETO', 'COMPLETO') === '' && M.tipoCobrado('COMPLETO', null) === '' && M.tipoCobrado('SOLO POLIGRAFO', null) === 'POLIGRAFO' && M.tipoCobrado('SOLO POLIGRAFO', 'POLIGRAFO') === 'POLIGRAFO' && M.tipoCobrado('SOLO SOCIOECONOMICO', 'SOCIOECONOMICO') === 'SOCIOECONOMICO' && M.tipoCobrado('BACKGROUND CHECK ', 'BACKGROUND CHECK ') === 'BACKGROUND CHECK' && M.tipoCobrado('CONSULTA INFORNET', 'INFORNET') === 'INFORNET' && M.tipoCobrado('SOCIO EMPRESARIAL', 'SOCIO EMPRESARIAL ') === 'SOCIOECONOMICO EMPRESARIAL' && M.tipoCobrado(null, 'POLIGRAFO BASIC') === 'POLIGRAFO BASIC' && M.tipoCobrado('COMPLETO', 'POLIGRAFO, BACKGROUND CHECK') === 'POLIGRAFO + BACKGROUND CHECK' && M.serviciosDe('POLIGRAFO, SOCIOECONOMICO, POLIGRAFO', 'COMPLETO').join() === 'POLIGRAFO,SOCIOECONOMICO', 'tipoCobrado: el precio sale del tipoPrueba de la FILA (POLIGRAFO/COMPLETO → solo polígrafo; SOCIO/COMPLETO → solo socio); lista → cada servicio sin repetir; "COMPLETO" suelto o dentro de la lista no es un servicio; procesoSolicitado solo decide sin tipoPrueba (SOLO X)');
  ok(M.esMitadDeCompleto({ tipoPrueba: 'POLIGRAFO', procesoSolicitado: 'COMPLETO' }) && !M.esMitadDeCompleto({ tipoPrueba: 'POLIGRAFO, SOCIOECONOMICO', procesoSolicitado: 'COMPLETO' }) && !M.esMitadDeCompleto({ tipoPrueba: 'POLIGRAFO', procesoSolicitado: 'SOLO POLIGRAFO' }), 'esMitadDeCompleto: POLIGRAFO/COMPLETO sí; lista/COMPLETO no (completo en un registro); SOLO X no');
  ok(canonTipoPrueba('SOCIOECONOMICO') === 'SOCIOECONOMICO' && canonTipoPrueba('Socio Empresarial') === 'SOCIOECONOMICO EMPRESARIAL' && canonTipoPrueba('SOCIO PRELIMINAR CON REFERENCIAS') === 'SOCIOECONOMICO', 'canon: SOCIO EMPRESARIAL es otro servicio; el resto de "SOCIO…" sigue siendo SOCIOECONOMICO');
  ok(M.territorioDesdeDepto('GUATEMALA') === 'METROPOLITANA' && M.territorioDesdeDepto(' guatemala ') === 'METROPOLITANA' && M.territorioDesdeDepto('SACATEPEQUEZ') === 'DEPARTAMENTAL' && M.territorioDesdeDepto('IZABAL') === 'DEPARTAMENTAL' && M.territorioDesdeDepto('') === '' && M.territorioDesdeDepto(null) === '', 'territorio: GUATEMALA → METROPOLITANA; cualquier otro depto → DEPARTAMENTAL; vacío → no indicado (lo decide el motor)');
  ok(M.esPsicometrica({ tipoPrueba: 'PSICOMETRICAS', procesoSolicitado: 'SOLO POLIGRAFO' }) && M.esPsicometrica({ tipoPrueba: 'POLIGRAFO', procesoSolicitado: 'PSICOMETRICAS' }) && M.esPsicometrica({ tipoPrueba: 'Psicométricas ' }) && !M.esPsicometrica({ tipoPrueba: 'POLIGRAFO', procesoSolicitado: 'SOLO POLIGRAFO' }), 'PSICOMETRICAS (en tipo o en proceso, con tildes/espacios) se excluye por completo');
  const T = (id: string, nit: string, tipo: string, cat: string, ter: string, monto: number, aprobado = true): Tarifa => ({ id, nit, razonSocial: 'E2E', tipoPrueba: tipo, categoria: cat, territorio: ter, monto, anio: '2026', aprobadoPor: aprobado ? 'x' : '', aprobadoEn: aprobado ? '2026-01-01' : null, activo: true });
  const tarifas = [T('t1', '123', 'POLIGRAFO', 'PRE EMPLEO', 'METROPOLITANA', 350), T('t2', '123', 'POLIGRAFO', 'PRE EMPLEO', 'DEPARTAMENTAL', 350), T('t3', '123', 'SOCIOECONOMICO', 'PRE EMPLEO', 'METROPOLITANA', 450), T('t4', '123', 'SOCIOECONOMICO', 'RUTINA', 'METROPOLITANA', 0), T('t5', '123', 'POLIGRAFO', 'RUTINA', 'METROPOLITANA', 300), T('t6', '123', 'POLIGRAFO', 'RUTINA', 'DEPARTAMENTAL', 330), T('t7', '123', 'INFORNET', 'UNICA', 'UNICA', 44.64), T('t8', '123', 'SOCIOECONOMICO EMPRESARIAL', 'UNICA', 'METROPOLITANA', 600), T('t9', '123', 'SOCIOECONOMICO EMPRESARIAL', 'UNICA', 'DEPARTAMENTAL', 600)];
  const ctx = { nitPorEmpresa: new Map([['recA', '123']]), tarifas };
  const E = (o: Partial<Exp>): Exp => ({ id: 'rec1', empresa: { id: 'recA', nombre: 'A' }, tipoPrueba: 'POLIGRAFO', procesoSolicitado: 'SOLO POLIGRAFO', categoriaPrueba: 'PRE EMPLEO', deptoVisita: 'GUATEMALA', terminado: true, cancelado: false, eliminado: false, cobro: { statusCobro: 'PENDIENTE' }, actualizadoEn: '2026-10-27T16:40:05.123Z', ...o });
  let c = M.clasificarExpediente(E({}), ctx);
  ok(c.estado === 'resuelta' && c.monto === 350 && c.componentes.length === 1 && c.nit === '123' && c.territorio === 'METROPOLITANA', 'POLIGRAFO PRE EMPLEO GUATEMALA → resuelta Q350 (1 componente)');
  c = M.clasificarExpediente(E({ tipoPrueba: 'SOCIOECONOMICO', procesoSolicitado: 'COMPLETO' }), ctx);
  const cPol = M.clasificarExpediente(E({ tipoPrueba: 'POLIGRAFO', procesoSolicitado: 'COMPLETO' }), ctx);
  ok(c.estado === 'resuelta' && c.monto === 450 && c.componentes.length === 1 && c.componentes[0].tipoPrueba === 'SOCIOECONOMICO' && c.tipoCobrado === 'SOCIOECONOMICO' && cPol.estado === 'resuelta' && cPol.monto === 350 && cPol.componentes.length === 1 && cPol.tipoCobrado === 'POLIGRAFO' && (c.monto ?? 0) + (cPol.monto ?? 0) === 800, 'FIX COMPLETO DOBLE: las dos filas de un completo (SOCIO/COMPLETO y POLIGRAFO/COMPLETO) cobran SOLO su servicio (Q450 y Q350); ninguna suma las dos; entre ambas = Q800 una sola vez');
  c = M.clasificarExpediente(E({ tipoPrueba: 'POLIGRAFO, SOCIOECONOMICO', procesoSolicitado: 'COMPLETO' }), ctx);
  ok(c.estado === 'resuelta' && c.monto === 800 && c.componentes.length === 2 && c.componentes.map(x => x.tipoPrueba).join('+') === 'POLIGRAFO+SOCIOECONOMICO' && c.tipoCobrado === 'POLIGRAFO + SOCIOECONOMICO', 'lista en tipoPrueba ("POLIGRAFO, SOCIOECONOMICO") = completo entero en UN registro → sí suma: Q800 con 2 componentes');
  c = M.clasificarExpediente(E({ tipoPrueba: 'COMPLETO, SOCIOECONOMICO', procesoSolicitado: 'COMPLETO' }), ctx);
  ok(c.estado === 'resuelta' && c.monto === 450 && c.componentes.length === 1 && c.tipoCobrado === 'SOCIOECONOMICO', '"COMPLETO, SOCIOECONOMICO" → no cuenta un COMPLETO fantasma: socio una vez (Q450)');
  c = M.clasificarExpediente(E({ tipoPrueba: 'COMPLETO', procesoSolicitado: 'COMPLETO' }), ctx);
  const cNulo = M.clasificarExpediente(E({ tipoPrueba: null, procesoSolicitado: 'COMPLETO' }), ctx);
  ok(c.estado === 'sin_tarifa' && c.monto === null && /no trae el servicio/.test(c.detalle) && cNulo.estado === 'sin_tarifa' && /no trae el servicio/.test(cNulo.detalle), '"COMPLETO" suelto (o sin tipoPrueba) no es un servicio → "sin tarifa" con el motivo (dato a limpiar en la Agenda; antes cobraba Q800)');
  c = M.clasificarExpediente(E({ tipoPrueba: 'PDA', procesoSolicitado: 'COMPLETO' }), ctx);
  ok(c.estado === 'sin_tarifa' && /no tiene tarifa para PDA/.test(c.detalle), 'PDA/COMPLETO → se cotiza PDA (sin tarifa), no polígrafo + socio (antes cobraba Q800)');
  // SERVICIOS DE PRECIO ÚNICO: PDA / entrevistas / INSIGHT / MIDOT resuelven sin categoría ni territorio.
  const ctxU = { ...ctx, tarifas: [...tarifas, T('tp', '123', 'PDA', 'UNICA', 'UNICA', 3200), T('tg', '123', 'ENTREVISTA GERENCIAL', 'PRE EMPLEO', 'METROPOLITANA', 0), T('tm', '123', 'MIDOT', 'UNICA', 'UNICA', 950)] };
  c = M.clasificarExpediente(E({ tipoPrueba: 'PDA', procesoSolicitado: 'COMPLETO', categoriaPrueba: null, categoria: null, deptoVisita: null }), ctxU);
  const cPdaDep = M.clasificarExpediente(E({ tipoPrueba: 'PDA', procesoSolicitado: 'PDA', categoriaPrueba: 'AGENDADO', deptoVisita: 'QUETZALTENANGO' }), ctxU);
  ok(c.estado === 'resuelta' && c.monto === 3200 && c.tipoCobrado === 'PDA' && c.componentes[0].categoria === 'UNICA' && cPdaDep.estado === 'resuelta' && cPdaDep.monto === 3200, 'FORMA único: PDA sin categoría ni territorio → Q3,200; con categoría basura y depto → el mismo Q3,200 (ni "sin categoría" ni territorio)');
  c = M.clasificarExpediente(E({ tipoPrueba: 'ENTREVISTA GERENCIL', procesoSolicitado: 'COMPLETO', categoriaPrueba: null, categoria: null }), ctxU);
  ok(c.estado === 'sin_tarifa' && c.tipoCobrado === 'ENTREVISTA GERENCIAL' && /Q0/.test(c.detalle), 'ENTREVISTA GERENCIAL (errata GERENCIL) con tarifa en Q0 → "sin tarifa" por Q0, no por categoría');
  c = M.clasificarExpediente(E({ tipoPrueba: 'MIDOT', procesoSolicitado: 'MIDOT', categoriaPrueba: 'RUTINA', deptoVisita: 'COSTA RICA' }), ctxU);
  ok(c.estado === 'resuelta' && c.monto === 950 && c.tipoCobrado === 'MIDOT', 'MIDOT único → Q950 aunque venga con categoría RUTINA y depto COSTA RICA');
  c = M.clasificarExpediente(E({ tipoPrueba: 'SOCIOECONOMICO', procesoSolicitado: 'SOLO POLIGRAFO' }), ctx);
  ok(c.estado === 'resuelta' && c.monto === 450 && c.tipoCobrado === 'SOCIOECONOMICO', 'si tipoPrueba y procesoSolicitado se contradicen, manda el tipoPrueba de la fila (SOCIO)');
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
  c = M.clasificarExpediente(E({ tipoPrueba: 'INFORNET', procesoSolicitado: 'CONSULTA INFORNET', categoriaPrueba: null, categoria: null, deptoVisita: null }), ctx);
  ok(c.estado === 'resuelta' && c.monto === 44.64 && c.tipoCobrado === 'INFORNET' && c.componentes[0].categoria === 'UNICA', 'FORMA único: INFORNET sin categoría ni territorio → resuelta Q44.64 (no cae en "sin tarifa")');
  c = M.clasificarExpediente(E({ tipoPrueba: 'SOCIO EMPRESARIAL ', procesoSolicitado: 'SOCIO EMPRESARIAL', categoriaPrueba: null, categoria: null, deptoVisita: 'SACATEPEQUEZ' }), ctx);
  ok(c.estado === 'resuelta' && c.monto === 600 && c.tipoCobrado === 'SOCIOECONOMICO EMPRESARIAL' && c.territorio === 'DEPARTAMENTAL' && M.clasificarExpediente(E({ tipoPrueba: 'SOCIO EMPRESARIAL', procesoSolicitado: 'SOCIO EMPRESARIAL', categoriaPrueba: null, deptoVisita: null }), ctx).estado === 'resuelta', 'FORMA por territorio: SOCIO EMPRESARIAL sin categoría → resuelta por territorio (y sin territorio si el precio es igual en ambos)');
  ok(conIva(350).iva === 42 && conIva(350).total === 392 && conIva(89.29).total === 100 && M.montoParaAgenda(89.29, 'con_iva') === 100 && M.montoParaAgenda(89.29, 'sin_iva') === 89.29, 'IVA 12 %: 350 → 42 / 392; 89.29 → Q100; monto para la Agenda con IVA (default) o sin IVA');
  const L = (o: Partial<Local>): Local => ({ ...(M.expedienteALocal(E({}), M.clasificarExpediente(E({}), ctx)) as unknown as Local), id: 'x', facturaId: null, facturaAppId: null, noFactura: null, facturadoEn: null, facturadoPor: null, writebackEstado: null, writebackDetalle: null, writebackEn: null, cobroWritebackEstado: null, cobroWritebackDetalle: null, updatedAt: null, ...o });
  const l1 = L({ idExterno: 'r1', persona: 'ANA' });
  const l3 = L({ idExterno: 'r3', persona: 'LUIS', tipoCobrado: 'POLIGRAFO + SOCIOECONOMICO', montoCalculado: 800, componentes: [{ tipoPrueba: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto: 350, tarifarioId: 't1', aprobada: true }, { tipoPrueba: 'SOCIOECONOMICO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto: 450, tarifarioId: 't3', aprobada: true }] });
  const centros = [{ id: 'ccP', nombre: 'Poligrafia', activo: true }, { id: 'ccX', nombre: 'Poligrafia Xela', activo: true }, { id: 'ccS', nombre: 'Socioeconomicos', activo: true }, { id: 'ccA', nombre: 'Administrativo', activo: true }];
  ok(M.centroPorServicio('POLIGRAFO', centros) === 'ccP' && M.centroPorServicio('POLIGRAFO BASIC', centros) === 'ccP' && M.centroPorServicio('SOCIOECONOMICO', centros) === 'ccS' && M.centroPorServicio('INFORNET', centros) === 'ccS' && M.centroPorServicio('BACKGROUND CHECK', centros) === null, 'centro de costo por servicio: POLIGRAF* → Poligrafia (no Xela); SOCIO/INFORNET → Socioeconomicos; desconocido → lo elige el usuario');
  const fac = M.armarFactura([l1, l3], t => M.centroPorServicio(t, centros));
  ok(fac.detalle.length === 3 && fac.detalle.filter(d => d.idExterno === 'r3').length === 2 && fac.lineas.length === 2 && fac.lineas.find(l => l.centroCostoId === 'ccP')?.subtotal === 700 && fac.lineas.find(l => l.centroCostoId === 'ccS')?.subtotal === 450 && fac.subtotal === 1150 && fac.iva === 138 && fac.total === 1288 && fac.sinCentro.length === 0, 'armarFactura: un COMPLETO = 2 renglones de detalle; líneas por centro (Poligrafia 700, Socio 450); 1150 + IVA 138 = 1288');
  ok(M.armarFactura([l1], () => null).sinCentro.join() === 'POLIGRAFO', 'armarFactura: sin centro para un servicio → se reporta (no se factura a ciegas)');
  ok(M.cobroPendiente('PENDIENTE', 'PAGADO') === false && M.cobroPendiente('PENDIENTE', ' pagado ') === false && M.cobroPendiente('PENDIENTE', 'NO PAGADO') === true && M.cobroPendiente('PENDIENTE', null) === true && M.cobroPendiente(null, null) === true && M.cobroPendiente('SIN_STATUS', undefined) === true && M.cobroPendiente('FACTURADO', null) === false && M.cobroPendiente('FACTURADO', 'PAGADO') === false && M.cobroPendiente('PENDIENTE') === true, '021 cobroPendiente(status, pago): PENDIENTE + PAGADO (aun "pagado ") → fuera; NO PAGADO / null / sin estatus → en cola; FACTURADO siempre fuera');
  ok(!M.enCola(L({ statusCobroExterno: 'PENDIENTE', estatusPagoExterno: 'PAGADO' })) && !M.facturable(L({ statusCobroExterno: 'PENDIENTE', estatusPagoExterno: 'PAGADO' })) && M.enCola(L({ statusCobroExterno: 'PENDIENTE', estatusPagoExterno: 'NO PAGADO' })) && M.enCola(L({ statusCobroExterno: null, estatusPagoExterno: null })) && R.kpisPorFacturar([l1, L({ idExterno: 'rP', statusCobroExterno: 'PENDIENTE', estatusPagoExterno: 'PAGADO' })]).listos === 1 && R.kpisPorFacturar([l1, L({ idExterno: 'rP', statusCobroExterno: 'PENDIENTE', estatusPagoExterno: 'PAGADO' })]).totalSinIva === 350, '021 enCola/facturable/KPIs: una fila PENDIENTE + PAGADO (provisión Génesis) no está en cola ni suma al total; NO PAGADO y null sí');
  ok(M.antesDelArranque('2026-07-31', '2026-08-01') && !M.antesDelArranque('2026-08-01', '2026-08-01') && !M.antesDelArranque('2026-08-10', '2026-08-01') && !M.antesDelArranque(null, '2026-08-01') && !M.antesDelArranque('2026-01-01', null) && !M.enCola(L({ arranqueExcluido: true })) && !M.facturable(L({ arranqueExcluido: true })) && M.enCola(L({ arranqueExcluido: false })) && R.kpisPorFacturar([l1, L({ idExterno: 'rV', arranqueExcluido: true })]).listos === 1, '022 corte de arranque: 31-jul < 1-ago fuera, 1-ago y después dentro, sin fecha o sin corte dentro; un expediente anterior al arranque no está en cola ni es facturable ni suma');
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
  // ── BUSCADOR DE CLIENTES (puro): sin tildes/mayúsculas, por cualquiera de los nombres, por NIT, sin tope ──
  const B = await import('../src/lib/clientes/buscar');
  type Buscable = import('../src/lib/clientes/buscar').ClienteBuscable;
  const cl = (id: string, name: string, nit = '', extra: Partial<Buscable> = {}): Buscable => ({ id, name, nit, ...extra });
  const muchos = Array.from({ length: 80 }, (_, i) => cl(`c${i}`, `CLIENTE ${String(i).padStart(2, '0')} RELLENO, S.A.`, `1000${String(i).padStart(3, '0')}1`));
  const cusc = cl('cus', 'CUSCATLAN TCU', '2222222-2', { razonSocial: 'BANCO CUSCATLAN DE GUATEMALA, S.A.', nombresAgenda: ['BANCO CUSCATLAN'] });
  const supr = cl('sup', 'DISTRIBUIDORA SUPREMA, S.A.', '3333333-3', { nombreComercial: 'Calzado Chicote', aliases: ['Chicote', 'Zapatería Chicote'] });
  const todos = [...muchos.slice(0, 40), cusc, ...muchos.slice(40), supr];
  ok(B.normalizarBusqueda('  Cuscatlán, S.A. ') === 'cuscatlan s a' && B.normalizarBusqueda('ÁÉÍÓÚ ñ') === 'aeiou n', 'normalizarBusqueda: sin tildes, minúsculas, puntuación fuera');
  const ids = (q: string) => B.buscarClientes(todos, q).map(c => c.id);
  ok(ids('cuscatlan')[0] === 'cus' && ids('cuscatlán')[0] === 'cus' && ids('CUSCATLAN')[0] === 'cus' && ids('22222222')[0] === 'cus' && ids('2222222-2').length === 1, '"cuscatlan" / "cuscatlán" / "CUSCATLAN" y el NIT encuentran el mismo cliente');
  ok(ids('banco cuscatlan')[0] === 'cus' && ids('banco cuscatlan de guatemala')[0] === 'cus', '"banco cuscatlan" lo encuentra por el nombre de la Agenda y por la razón social');
  ok(ids('calzado chicote')[0] === 'sup' && ids('zapateria chicote')[0] === 'sup' && ids('chicote').length === 1 && B.nombreQueCoincide(supr, 'calzado chicote') === 'Calzado Chicote' && B.nombreQueCoincide(supr, 'suprema') === '', 'alias "calzado chicote" → Distribuidora Suprema (por su razón social); la etiqueta dice por qué nombre apareció');
  ok(ids('relleno').length === 80 && ids('CLIENTE 75')[0] === 'c75' && ids('').length === 82 && B.buscarClientes(todos, '', { limite: 60 }).length === 60, 'sin tope: los 80 "relleno" aparecen; el cliente 75 (más allá de los primeros 60) se encuentra; con consulta vacía, la lista completa por nombre');
  ok(ids('zzz nada').length === 0 && B.puntajeCliente(cusc, 'cuscatlan tcu') > B.puntajeCliente(cusc, 'tcu') && B.puntajeCliente(supr, 'distribuidora suprema, s.a.') > B.puntajeCliente(supr, 'calzado chicote') && B.puntajeCliente(supr, 'calzado chicote') > B.puntajeCliente(supr, 'zapateria'), 'sin coincidencia → vacío; exacto > contiene; el nombre principal pesa más que una marca');
  ok(B.limpiarAliases([' Chicote ', 'chicoté', '', null, 'DISTRIBUIDORA SUPREMA, S.A.', 'Marca X'], ['Distribuidora Suprema, S.A.']).join('|') === 'Chicote|Marca X' && B.nombresDe(supr).join('|') === 'DISTRIBUIDORA SUPREMA, S.A.|Calzado Chicote|Chicote|Zapatería Chicote', 'limpiarAliases: sin vacíos, sin repetidos (sin tildes), sin el nombre propio; nombresDe en orden nombre → comercial → marcas');
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
      ['detalle_facturacion', () => sb.from('detalle_facturacion').delete().in('nit', [NIT_A, NIT_B])],
      ['facturas_clientes', () => sb.from('facturas_clientes').delete().in('no_factura', FACTS)],
      ['cliente_externo', () => sb.from('cliente_externo').delete().in('empresa_id_externo', [EMP_A, EMP_B, EMP_C, EMP_D, EMP_E, EMP_F])],
      ['facturacion_webhook_evento', () => sb.from('facturacion_webhook_evento').delete().like('id', 'fact_evt_e2e%')],
      ['facturacion_log', () => sb.from('facturacion_log').delete().eq('actor', ACTOR)],
      ['tarifario', () => sb.from('tarifario').delete().in('nit', [NIT_A, NIT_B, NIT_C])],
      ['clientes', () => sb.from('clientes').delete().in('nit', [NIT_A, NIT_B, NIT_C])],
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
    mk2('recE2E002', { nombre: 'WILLIAM QUEVEDO', tipoPrueba: 'SOCIOECONOMICO', procesoSolicitado: 'COMPLETO', deptoVisita: 'SACATEPEQUEZ', fechaIngreso: '2026-09-28', cobro: { statusCobro: null } }),   // mitad SOCIO de un completo
    mk2('recE2E003', { tipoPrueba: 'POLIGRAFO, SOCIOECONOMICO', procesoSolicitado: 'COMPLETO', statusProceso: 'AUDITADO -QA', actualizadoEn: '2026-10-21T10:00:00.000Z' }),   // completo entero en UN registro (lista)
    mk2('recE2E004', { tipoPrueba: 'PSICOMETRICAS', procesoSolicitado: 'PSICOMETRICAS' }),
    mk2('recE2E005', { categoriaPrueba: 'RUTINA', categoria: 'RUTINA', tipoPrueba: 'SOCIOECONOMICO', procesoSolicitado: 'SOLO SOCIOECONOMICO' }),
    mk2('recE2E006', { terminado: false, statusProceso: 'AGENDADO' }),
    mk2('recE2E007', { cancelado: true, statusProceso: 'CANCELADO' }),
    mk2('recE2E008', { empresa: { id: EMP_B, nombre: 'OTRA EMPRESA' } }),
    mk2('recE2E009', { cobro: { statusCobro: 'FACTURADO', numeroFactura: 'X-OLD-1', fechaFactura: '2026-09-30', monto: 392 } }),
    mk2('recE2E010', { nombre: 'WILLIAM QUEVEDO', tipoPrueba: 'POLIGRAFO', procesoSolicitado: 'COMPLETO', actualizadoEn: '2026-10-22T10:00:00.000Z' }),   // mitad POLIGRAFO del mismo completo
    mk2('recE2E011', { actualizadoEn: '2026-10-22T11:00:00.000Z' }),
    mk2('recE2E012', { actualizadoEn: '2026-10-23T10:00:00.000Z', cobro: { statusCobro: 'PENDIENTE', estatusPago: 'NO PAGADO' } }),   // 021: NO PAGADO sigue en cola
    mk2('recE2E013', { actualizadoEn: '2026-10-23T11:00:00.000Z', cobro: { statusCobro: 'PENDIENTE', cobroMegapaca: 25 } }),
    mk2('recE2E014', { empresa: { id: EMP_C, nombre: 'GOLDEN TALENT' }, actualizadoEn: '2026-10-23T12:00:00.000Z' }),
    mk2('recE2E015', { tipoPrueba: 'SOCIO EMPRESARIAL ', procesoSolicitado: 'SOCIO EMPRESARIAL', categoriaPrueba: null, categoria: null, deptoVisita: 'SACATEPEQUEZ', actualizadoEn: '2026-10-23T13:00:00.000Z' }),
    mk2('recE2E016', { tipoPrueba: 'INFORNET', procesoSolicitado: 'CONSULTA INFORNET', categoriaPrueba: null, categoria: null, deptoVisita: null, actualizadoEn: '2026-10-23T14:00:00.000Z' }),
    mk2('recE2E017', { nombre: 'PROVISION GENESIS', cobro: { statusCobro: 'PENDIENTE', estatusPago: 'PAGADO', numeroFactura: 'PROVISION FUNDACION GENESIS EMPRESARIAL AGOSTO 2026' }, actualizadoEn: '2026-10-23T15:00:00.000Z' }),   // 021: ya PAGADO por provisión → fuera de la cola
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

  const DET = await import('../src/lib/db/detalle-facturacion');
  const MM = await import('../src/lib/facturacion-agenda/mapeo');
  type FacVia = Awaited<ReturnType<typeof DET.facturarDetalle>>;
  /** Flujo real (019): generar detalle → enviada → aprobada → facturar. */
  const facturarVia = async (ids: string[], nf: string, fecha: string, centroPorTipo?: Record<string, string>): Promise<FacVia> => {
    const c = await DET.crearDetalle({ idsExternos: ids }, ACTOR); if (!c.ok) return { ok: false, error: `crear: ${c.error}` };
    const en = await DET.marcarEnviada(c.detalle.id, ACTOR); if (!en.ok) return { ok: false, error: `enviar: ${en.error}` };
    const ap = await DET.marcarAprobada(c.detalle.id, { aprobadoPor: 'Contadora del Cliente', canal: 'correo' }, ACTOR); if (!ap.ok) return { ok: false, error: `aprobar: ${ap.error}` };
    return DET.facturarDetalle(c.detalle.id, { noFactura: nf, fechaEmision: fecha, centroPorTipo }, ACTOR, { api: apiRapida() });
  };
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
    ok(s1.ok && s1.leidos === 17 && s1.paginas === 5 && q1.desde === '2026-01-01' && q1.incluirEliminados === 'true' && q1.porPagina === '200', `primera corrida: desde=2026-01-01, incluirEliminados, 5 páginas, 17 expedientes (${JSON.stringify({ leidos: s1.leidos, paginas: s1.paginas })})`);
    let locales = await DB.listarExpedientesLocal();
    const byId = (id: string) => locales.find(e => e.idExterno === id)!;
    ok(byId('recE2E001').estadoTarifa === 'resuelta' && byId('recE2E001').montoCalculado === 350 && byId('recE2E001').territorioResuelto === 'METROPOLITANA' && byId('recE2E001').nitResuelto === NIT_A && byId('recE2E001').clienteId === cliA!.id, 'e001 POLIGRAFO PRE EMPLEO GUATEMALA → resuelta Q350, METROPOLITANA, NIT y cliente del mapeo');
    ok(byId('recE2E002').estadoTarifa === 'resuelta' && byId('recE2E002').montoCalculado === 450 && byId('recE2E002').territorioResuelto === 'DEPARTAMENTAL' && byId('recE2E002').tipoCobrado === 'SOCIOECONOMICO' && byId('recE2E002').componentes.length === 1 && byId('recE2E010').montoCalculado === 350 && byId('recE2E010').tipoCobrado === 'POLIGRAFO' && byId('recE2E010').componentes.length === 1, 'FIX COMPLETO DOBLE: e002 SOCIO/COMPLETO SACATEPEQUEZ → solo socio Q450 DEPARTAMENTAL; e010 POLIGRAFO/COMPLETO → solo polígrafo Q350; las dos mitades de WILLIAM QUEVEDO suman Q800 una sola vez (cobro sin estado = en cola)');
    ok(byId('recE2E003').estadoTarifa === 'resuelta' && byId('recE2E003').montoCalculado === 800 && byId('recE2E003').componentes.length === 2 && byId('recE2E003').tipoCobrado === 'POLIGRAFO + SOCIOECONOMICO', 'e003 completo entero en UN registro ("POLIGRAFO, SOCIOECONOMICO") → Q800 con 2 componentes');
    ok(byId('recE2E004').estadoTarifa === 'excluido_psicometrica', 'e004 PSICOMETRICAS → excluido');
    ok(byId('recE2E005').estadoTarifa === 'sin_tarifa' && byId('recE2E005').montoCalculado === null && /Q0/.test(byId('recE2E005').detalleTarifa), 'e005 SOCIO RUTINA (Q0) → sin tarifa');
    ok(byId('recE2E008').estadoTarifa === 'cliente_sin_mapear' && byId('recE2E008').nitResuelto === null, 'e008 empresa B sin mapear → cliente sin mapear');
    ok(byId('recE2E015').estadoTarifa === 'sin_tarifa' && byId('recE2E015').tipoCobrado === 'SOCIOECONOMICO EMPRESARIAL' && /no tiene tarifa para SOCIOECONOMICO EMPRESARIAL/.test(byId('recE2E015').detalleTarifa) && byId('recE2E016').estadoTarifa === 'sin_tarifa' && byId('recE2E016').tipoCobrado === 'INFORNET' && /precio único/.test(byId('recE2E016').detalleTarifa), 'e015 SOCIO EMPRESARIAL y e016 INFORNET sin categoría → "sin tarifa" por falta de tarifa (no por la categoría): el detalle dice qué cargar');
    ok(!byId('recE2E006').terminado && byId('recE2E007').cancelado && byId('recE2E009').statusCobroExterno === 'FACTURADO' && byId('recE2E013').cobroMegapaca === 25, 'e006 no terminado, e007 cancelado, e009 ya FACTURADO en la Agenda (fuera de la cola), e013 conserva cobroMegapaca');
    const { enCola: enColaM, facturable: facturableM } = await import('../src/lib/facturacion-agenda/mapeo');
    ok(byId('recE2E017').estadoTarifa === 'resuelta' && byId('recE2E017').montoCalculado === 350 && byId('recE2E017').estatusPagoExterno === 'PAGADO' && byId('recE2E017').statusCobroExterno === 'PENDIENTE' && !enColaM(byId('recE2E017')) && !facturableM(byId('recE2E017')) && byId('recE2E012').estatusPagoExterno === 'NO PAGADO' && enColaM(byId('recE2E012')) && facturableM(byId('recE2E012')) && enColaM(byId('recE2E001')) && byId('recE2E001').estatusPagoExterno === null, '021: e017 PENDIENTE + PAGADO (provisión Génesis) resuelve precio y queda en la data, pero NO está en cola ni es facturable; e012 "NO PAGADO" y e001 sin estatus SÍ');
    // Simular el estado VIEJO (bug): la mitad polígrafo guardada con los dos componentes y Q800 → "Re-resolver precios" la corrige sin tocar la Agenda.
    await sb.from('facturacion_expediente').update({ tipo_cobrado: 'COMPLETO', monto_calculado: 800, componentes: [{ tipoPrueba: 'POLIGRAFO', monto: 350 }, { tipoPrueba: 'SOCIOECONOMICO', monto: 450 }] }).eq('id_externo', 'recE2E010');
    const rFix = await DB.reresolverPrecios();
    locales = await DB.listarExpedientesLocal();
    const { serviciosDe: srvDe } = await import('../src/lib/facturacion-agenda/mapeo');
    ok(rFix.ok && rFix.reclasificados === 1 && byId('recE2E010').montoCalculado === 350 && byId('recE2E010').componentes.length === 1 && byId('recE2E010').tipoCobrado === 'POLIGRAFO' && locales.every(e => e.componentes.length <= Math.max(1, srvDe(e.tipoPrueba, e.procesoSolicitado).length)), `re-resolver tras el fix: una mitad guardada con el monto de los dos (Q800) vuelve a Q350 con 1 componente; ninguna fila tiene más componentes que servicios en su tipoPrueba (${rFix.ok ? rFix.reclasificados : rFix.error})`);
    const vista = await DB.vistaPorFacturar();
    const gA = vista.grupos.find(g => g.clave === `n-${NIT_A}`)!;
    ok(!!gA && gA.listos === 7 && gA.totalSinIva === 350 + 450 + 800 + 350 * 4 && gA.totalConIva === 3360 && gA.sinTarifa === 3 && gA.nombre === 'E2E AGENDA, S.A.' && gA.expedientes === 10 && vista.grupos.length === 1 && vista.agregadoEnSql && vista.kpis.excluidos === 1 && vista.kpis.sinMapear === 2 && vista.kpis.clientesSinMapear === 2 && vista.sinMapear.empresas === 2 && vista.kpis.listos === 7 && vista.kpis.clientes === 1 && vista.total === 17 && vista.kpis.excluidosNoFactura === 0 && vista.noFacturan.length === 0 && vista.sync?.corridas === 1, `vista "Por facturar" (agregados en SQL): solo el cliente A (7 listos por Q${gA?.totalSinIva}, 3 sin tarifa); sin mapear (2 empresas) y psicométricas (1) solo se CUENTAN; total 17 en el espejo (la PAGADO no suma)`);
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
    ok(!!detA && detA.cliente?.id === cliA!.airtable_id && detA.expedientes.length === 14 && detA.centros.length === centros.length, 'detalle del cliente A: cliente de financiero resuelto, 14 expedientes (la psicométrica no tiene NIT; la PAGADO se lista pero fuera de la cola), centros de costo activos para el diálogo');

    // Emitir: validaciones
    const hoy = (await import('../src/lib/utils/fechas')).obtenerFechaHoyGuatemala();
    const manana = new Date(Date.now() + 86400_000 * 2).toISOString().slice(0, 10);
    // ── 019: DETALLE DE FACTURACIÓN (pre-liquidación) ──
    console.log('\n   019 · detalle: generar → enviada → aprobada → facturar');
    ok(await DET.detallesDisponibles(), `detallesDisponibles() detecta la 019 en ${base}`);
    let cd = await DET.crearDetalle({ idsExternos: ['recE2E005'] }, ACTOR);
    ok(!cd.ok && /precio resuelto y en cola/.test(cd.ok ? '' : cd.error), 'generar detalle con un expediente sin tarifa → error (solo entran resueltos con precio)');
    cd = await DET.crearDetalle({ idsExternos: ['recE2E009'] }, ACTOR);
    ok(!cd.ok, 'generar detalle con un expediente ya FACTURADO en la Agenda → error (no está en cola)');
    cd = await DET.crearDetalle({ idsExternos: [] }, ACTOR);
    ok(!cd.ok && /al menos un/.test(cd.ok ? '' : cd.error), 'generar detalle sin expedientes → error');
    const d1 = await DET.crearDetalle({ idsExternos: ['recE2E001', 'recE2E003', 'recE2E001'], notas: ' pre-liquidación de octubre ' }, ACTOR);
    locales = await DB.listarExpedientesLocal();
    ok(d1.ok && d1.detalle.estado === 'borrador' && /^DET-\d{4}$/.test(d1.detalle.correlativo) && d1.detalle.nit === NIT_A && d1.detalle.clienteId === cliA!.id && d1.detalle.expedientes === 2 && d1.detalle.subtotal === 1150 && d1.detalle.iva === 138 && d1.detalle.total === 1288 && d1.detalle.creadoPor === ACTOR && d1.detalle.notas === 'pre-liquidación de octubre' && byId('recE2E001').detalleId === d1.detalle.id && byId('recE2E003').detalleId === d1.detalle.id, `generar detalle (e001 + COMPLETO e003, id repetido deduplicado): ${d1.ok ? d1.detalle.correlativo : d1.error} en borrador, totales del tarifario 1150 + 138 = 1288, expedientes RESERVADOS`);
    const D1 = d1.ok ? d1.detalle.id : '';
    cd = await DET.crearDetalle({ idsExternos: ['recE2E001'] }, ACTOR);
    ok(!cd.ok && /otro detalle/.test(cd.ok ? '' : cd.error), 'un expediente reservado no entra en otro detalle');
    const vD = await DB.vistaPorFacturar();
    ok(vD.detalles.borrador.n === 1 && vD.detalles.borrador.total === 1288 && vD.grupos.find(g => g.nit === NIT_A)?.enDetalle === 2 && !MM.facturable(byId('recE2E001')) && MM.conPrecio(byId('recE2E001')), 'tablero: 1 detalle en borrador (Q1,288); el cliente A muestra 2 en detalle; un reservado ya no es seleccionable aunque siga en cola');
    const g1 = await DET.getDetalle(D1);
    ok(!!g1 && g1.documento.incluidas.length === 2 && g1.documento.faltantes.length === 0 && g1.documento.total === 1288 && g1.documento.lineas.find(l => l.idExterno === 'recE2E003')?.componentes.includes('POLIGRAFO Q350.00 + SOCIOECONOMICO Q450.00') === true && g1.clienteNombre === 'E2E AGENDA, S.A.', 'documento imprimible: 2 líneas, el COMPLETO con sus componentes, total 1288, cliente resuelto');
    let tr = await DET.marcarAprobada(D1, { aprobadoPor: 'X' }, ACTOR);
    ok(!tr.ok && /no puede pasar/.test(tr.ok ? '' : tr.error), 'transición inválida: borrador → aprobada se rechaza (primero hay que enviarlo)');
    let fx = await DET.facturarDetalle(D1, { noFactura: 'F-E2E-X', fechaEmision: hoy }, ACTOR, { api: apiRapida() });
    ok(!fx.ok && /solo se factura un detalle aprobado/.test(fx.ok ? '' : fx.error), 'facturar un borrador → error: solo se factura un detalle aprobado');
    const dir = await DB.emitirFacturaAgenda({ idsExternos: ['recE2E001', 'recE2E003'], noFactura: 'F-E2E-X', fechaEmision: hoy }, ACTOR);
    ok(!dir.ok && /detalle de facturación aprobado/.test(dir.ok ? '' : dir.error), 'emitir directo (sin detalle) → error: todo lo de la Agenda pasa por un detalle aprobado');
    tr = await DET.marcarEnviada(D1, ACTOR);
    ok(tr.ok && tr.detalle.estado === 'enviada' && !!tr.detalle.enviadaEn && tr.detalle.enviadaPor === ACTOR, 'borrador → enviada: queda quién y cuándo');
    tr = await DET.marcarAprobada(D1, { aprobadoPor: '   ' }, ACTOR);
    ok(!tr.ok && /quién aprobó/.test(tr.ok ? '' : tr.error), 'aprobar sin decir quién → error');
    tr = await DET.marcarAprobada(D1, { aprobadoPor: '  Contadora  del Cliente ', canal: 'correo' }, ACTOR);
    ok(tr.ok && tr.detalle.estado === 'aprobada' && tr.detalle.aprobadoPor === 'Contadora del Cliente' && tr.detalle.aprobadoCanal === 'correo' && !!tr.detalle.aprobadaEn, 'enviada → aprobada: quién aprobó (texto) y canal correo, con fecha');
    fx = await DET.facturarDetalle(D1, { noFactura: 'F-E2E-X', fechaEmision: manana }, ACTOR, { api: apiRapida() });
    ok(!fx.ok && /futura/.test(fx.ok ? '' : fx.error), 'facturar: fecha futura → error (el detalle sigue aprobado)');

    // Emitir F-E2E-1 (e001 + e003) → write-back 201
    const cPorTipo = { POLIGRAFO: ccPol, SOCIOECONOMICO: ccSoc };
    let e = await DET.facturarDetalle(D1, { noFactura: ' F-E2E-1 ', fechaEmision: hoy, centroPorTipo: cPorTipo }, ACTOR, { api: apiRapida() });
    const dF = e.ok ? e.detalle : null;
    ok(!!dF && dF.estado === 'facturada' && dF.noFactura === 'F-E2E-1' && !!dF.facturaAppId && !!dF.facturadoEn, `aprobada → facturada: el detalle guarda la factura (${dF?.noFactura}) y la fecha`);
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
    const { data: dFac } = await sb.from('detalle_facturacion').select('factura_id').eq('id', D1).maybeSingle();
    ok(!!dFac && (dFac as { factura_id: string | null }).factura_id === (fRows ?? [])[0]?.id && (await DET.listarDetalles({ estados: ['facturada'] })).some(x => x.id === D1), 'detalle facturado: factura_id = la línea principal; aparece en la lista de facturados');
    tr = await DET.anularDetalle(D1, 'x', ACTOR);
    ok(!tr.ok && /anulá la factura/.test(tr.ok ? '' : tr.error), 'un detalle facturado no se anula');
    cd = await DET.crearDetalle({ idsExternos: ['recE2E001'] }, ACTOR);
    ok(!cd.ok, 'expediente ya facturado no entra en un detalle nuevo');
    // Anular libera · faltantes no rompen el documento · número repetido
    const d3 = await DET.crearDetalle({ idsExternos: ['recE2E010', 'recE2E011'] }, ACTOR);
    const D3 = d3.ok ? d3.detalle.id : '';
    await sb.from('facturacion_expediente').update({ estado_tarifa: 'sin_tarifa', monto_calculado: null, detalle_tarifa: 'simulado: la tarifa se borró' }).eq('id_externo', 'recE2E011');
    const g3 = await DET.getDetalle(D3);
    ok(d3.ok && !!g3 && g3.documento.incluidas.length === 1 && g3.documento.faltantes.length === 1 && g3.documento.faltantes[0].motivo === 'sin tarifa' && g3.documento.subtotal === 350 && g3.documento.total === 392 && g3.detalle.total === 784, 'faltante: un proceso que perdió el precio NO rompe el documento: queda "no incluido · sin tarifa" y el total refleja solo lo incluido (Q392 vs Q784 al generar)');
    await sb.from('facturacion_expediente').update({ estado_tarifa: 'resuelta', monto_calculado: 350, detalle_tarifa: '' }).eq('id_externo', 'recE2E011');
    tr = await DET.anularDetalle(D3, 'se rehace', ACTOR);
    locales = await DB.listarExpedientesLocal();
    ok(tr.ok && tr.detalle.estado === 'anulada' && tr.detalle.motivoAnulacion === 'se rehace' && tr.detalle.anuladaPor === ACTOR && byId('recE2E010').detalleId === null && byId('recE2E011').detalleId === null && MM.facturable(byId('recE2E010')), 'anular: libera los expedientes (vuelven a la cola, seleccionables) y guarda motivo y quién');
    const d3b = await DET.crearDetalle({ idsExternos: ['recE2E010', 'recE2E011'] }, ACTOR);
    const D3b = d3b.ok ? d3b.detalle.id : '';
    ok(d3b.ok && (await DET.marcarEnviada(D3b, ACTOR)).ok && (await DET.marcarAprobada(D3b, { aprobadoPor: 'Gerente Cliente' }, ACTOR)).ok, 'los liberados entran en un detalle nuevo (enviado y aprobado)');
    e = await DET.facturarDetalle(D3b, { noFactura: 'F-E2E-1', fechaEmision: hoy, centroPorTipo: cPorTipo }, ACTOR, { api: apiRapida() });
    ok(!e.ok && /ya existe/.test(e.ok ? '' : e.error) && (await DET.getDetalleBasico(D3b))?.estado === 'aprobada', 'mismo número de factura otra vez → "ya existe" (RPC, sin crear nada); el detalle sigue aprobado');

    // 409: e002 cambia en la Agenda después de leído
    const antes409 = conteo['POST /facturas'] ?? 0;
    exps.get('recE2E002')!.actualizadoEn = '2026-10-27T12:00:00.000Z'; exps.get('recE2E002')!.puesto = 'CAMBIADO EN LA AGENDA';
    e = await facturarVia(['recE2E002'], 'F-E2E-2', hoy, cPorTipo);
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
    e = await DET.facturarDetalle(D3b, { noFactura: 'F-E2E-3', fechaEmision: hoy, centroPorTipo: cPorTipo }, ACTOR, { api: apiRapida() });
    locales = await DB.listarExpedientesLocal();
    ok(e.ok && e.writeback.estado === 'pendiente' && (conteo['POST /facturas'] ?? 0) === antes500 + 1 && byId('recE2E010').writebackEstado === 'confirmado' && byId('recE2E011').writebackEstado === 'pendiente' && /500/.test(byId('recE2E011').writebackDetalle ?? ''), '500 parcial: un solo POST; registra hasta dónde llegó (e010 confirmado, e011 pendiente)');
    const rr3 = await DB.reintentarWriteback('F-E2E-3', ACTOR, { api: apiRapida() });
    const post3 = ultimo['POST /facturas'] as { expedientes: { id: string }[] };
    locales = await DB.listarExpedientesLocal();
    ok(rr3.estado === 'confirmado' && post3.expedientes.length === 1 && post3.expedientes[0].id === 'recE2E011' && byId('recE2E011').writebackEstado === 'confirmado' && exps.get('recE2E010')!.cobro!.numeroFactura === 'F-E2E-3', 'reintento tras el 500: solo se reenvía el pendiente (no se re-factura el ya hecho)');

    // 503 con backoff: e012
    modo.facturas = '503x1';
    const antes503 = conteo['POST /facturas'] ?? 0;
    e = await facturarVia(['recE2E012'], 'F-E2E-4', hoy, cPorTipo);
    ok(e.ok && e.writeback.estado === 'confirmado' && (conteo['POST /facturas'] ?? 0) === antes503 + 2, '503 → reintento con backoff → 201 confirmado (2 POST)');

    // 404: e013 desaparece de la Agenda
    exps.get('recE2E013')!.eliminado = true;
    e = await facturarVia(['recE2E013'], 'F-E2E-5', hoy, cPorTipo);
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
    // ── MASIVO ──
    console.log('\n   masivo · lote de "no se factura" y de mapeo al mismo cliente');
    ok(!(await DB.marcarNoFacturaLote({ empresas: [], motivo: 'x' }, ACTOR)).ok && !(await DB.guardarMapeoLote({ empresas: [{ empresaIdExterno: EMP_C }], clienteAppId: 'rec_no' }, ACTOR)).ok, 'lote vacío / cliente inexistente → error claro');
    const lote1 = await DB.marcarNoFacturaLote({ empresas: [{ empresaIdExterno: EMP_B, empresaNombreExterno: 'OTRA EMPRESA' }, { empresaIdExterno: EMP_C, empresaNombreExterno: 'GOLDEN TALENT' }, { empresaIdExterno: EMP_C }], motivo: ' reclutamiento — Fase A ' }, ACTOR);
    locales = await DB.listarExpedientesLocal(); vNF = await DB.vistaPorFacturar(); smNF = await DB.empresasSinMapear({});
    ok(lote1.ok && lote1.aplicadas === 2 && lote1.reclasificados === 2 && byId('recE2E008').estadoTarifa === 'excluido_no_factura' && byId('recE2E014').estadoTarifa === 'excluido_no_factura' && vNF.noFacturan.length === 2 && vNF.noFacturan.every(n => n.motivo === 'reclutamiento — Fase A') && vNF.kpis.excluidosNoFactura === 2 && smNF.totalEmpresas === 0 && !vNF.grupos.some(g => g.nit === NIT_B), 'lote "no se factura" (B mapeada + C sin mapear, con un id repetido): 2 marcadas con UN motivo, sus 2 expedientes fuera de la cola, "Sin mapear" vacía, "No se facturan" con 2');
    ok((await DB.quitarNoFactura(EMP_B, ACTOR)).ok && (await DB.quitarNoFactura(EMP_C, ACTOR)).ok, 'se quitan las dos marcas');
    const lote2 = await DB.guardarMapeoLote({ empresas: [{ empresaIdExterno: EMP_B, empresaNombreExterno: 'OTRA EMPRESA' }, { empresaIdExterno: EMP_C, empresaNombreExterno: 'GOLDEN TALENT' }], clienteAppId: cliA!.airtable_id }, ACTOR);
    locales = await DB.listarExpedientesLocal(); vNF = await DB.vistaPorFacturar(); smNF = await DB.empresasSinMapear({});
    const gAL = vNF.grupos.find(g => g.nit === NIT_A);
    ok(lote2.ok && lote2.aplicadas === 2 && lote2.nit === NIT_A && lote2.reclasificados === 2 && byId('recE2E008').nitResuelto === NIT_A && byId('recE2E008').estadoTarifa === 'resuelta' && byId('recE2E008').montoCalculado === 350 && byId('recE2E014').nitResuelto === NIT_A && byId('recE2E014').estadoTarifa === 'resuelta' && byId('recE2E014').montoCalculado === 350 && smNF.totalEmpresas === 0 && vNF.grupos.length === 1 && !!gAL && gAL.listos === 3, 'lote "mapear todas a un cliente" (caso Walmart → matriz): B y C quedan con el NIT de A y sus expedientes resuelven precio (Q350 c/u); la lista muestra un solo cliente con 3 listos');
    const todas = await DB.empresasSinMapear({ limite: 1000 });
    ok(todas.totalEmpresas === 0 && todas.limite === 1000, 'empresasSinMapear acepta limite 1000 (para "seleccionar todo el filtro")');
    // restaurar: B → su cliente; C → marcada "intercompany" para la sección de volumen
    ok((await DB.guardarMapeo({ empresaIdExterno: EMP_B, empresaNombreExterno: 'OTRA EMPRESA', clienteAppId: cliB!.airtable_id }, ACTOR)).ok, 'B vuelve a su propio cliente');
    const nf5 = await DB.marcarNoFactura({ empresaIdExterno: EMP_C, empresaNombreExterno: 'GOLDEN TALENT', motivo: 'intercompany' }, ACTOR);
    locales = await DB.listarExpedientesLocal();
    ok(nf5.ok && byId('recE2E008').estadoTarifa === 'sin_tarifa' && byId('recE2E014').estadoTarifa === 'excluido_no_factura', 'GOLDEN TALENT queda marcada para la sección de volumen; B sin tarifa con su NIT');

    // ── FORMAS DE PRECIO: CIBUS espejo (socio empresarial + infornet) ──
    console.log('\n   formas de precio · CIBUS espejo: generar tarifas → cargar precios → resuelven');
    const TDB = await import('../src/lib/db/tarifario');
    const plA = await TDB.planGenerarTarifas(NIT_A);
    ok(!('error' in plA) && plA.tiposAgenda.includes('SOCIOECONOMICO EMPRESARIAL') && plA.tiposAgenda.includes('INFORNET') && plA.filas.length === 8 && plA.omitidas.length === 5 && plA.porTipo['SOCIOECONOMICO EMPRESARIAL'] === 2 && plA.porTipo.INFORNET === 1, `plan para el cliente A: lee de la Agenda que pide SOCIO EMPRESARIAL e INFORNET → 5 de plantilla + 2 + 1 = 8 (${'error' in plA ? plA.error : `${plA.resumen} · omitidas: ${plA.omitidas.map(f => `${f.tipoPrueba} ${f.categoria} ${f.territorio}`).join(', ')}`})`);
    const gA2 = await TDB.generarTarifasCliente({ nit: NIT_A }, ACTOR);
    const tarA = (await TDB.getTarifario()).filter(t => t.nit === NIT_A && t.activo);
    const seD = tarA.find(t => t.tipoPrueba === 'SOCIOECONOMICO EMPRESARIAL' && t.territorio === 'DEPARTAMENTAL'), inf = tarA.find(t => t.tipoPrueba === 'INFORNET');
    ok(gA2.ok && gA2.creadas === 8 && !!seD && seD.categoria === 'UNICA' && seD.monto === 0 && !!inf && inf.categoria === 'UNICA' && inf.territorio === 'UNICA' && inf.monto === 0, 'generar: 8 filas en Q0 con la forma correcta (SOCIO EMPRESARIAL UNICA × 2 territorios; INFORNET UNICA/UNICA)');
    locales = await DB.listarExpedientesLocal();
    ok(byId('recE2E015').estadoTarifa === 'sin_tarifa' && byId('recE2E016').estadoTarifa === 'sin_tarifa', 'con las filas en Q0 siguen "sin tarifa" (Q0 no es gratis)');
    ok((await TDB.editarTarifa(seD!.id, { monto: 750 }, ACTOR, 'precio pactado')).ok && (await TDB.editarTarifa(inf!.id, { monto: 44.64 }, ACTOR, 'precio pactado')).ok, 'se cargan los precios: SOCIO EMPRESARIAL DEPARTAMENTAL Q750, INFORNET Q44.64');
    const recl = await DB.reclasificar({ empresaIdExterno: EMP_A });
    locales = await DB.listarExpedientesLocal(); const vFP = await DB.vistaPorFacturar(); const gAFP = vFP.grupos.find(g => g.nit === NIT_A)!;
    ok(recl === 2 && byId('recE2E015').estadoTarifa === 'resuelta' && byId('recE2E015').montoCalculado === 750 && byId('recE2E015').territorioResuelto === 'DEPARTAMENTAL' && byId('recE2E016').estadoTarifa === 'resuelta' && byId('recE2E016').montoCalculado === 44.64 && M_enCola(byId('recE2E015')) && gAFP.listos === 3 && gAFP.sinTarifa === 1, 'al cargar los precios pasan de "sin tarifa" a "resuelta" y facturables (listos 1 → 3; queda 1 sin tarifa: la SOCIO RUTINA en Q0)');

    // ── 020 · NOMBRE COMERCIAL / MARCAS: guardar, leer, sugerir, buscar; RE-RESOLVER por NIT ──
    console.log('\n   020 · nombre comercial / marcas → sugerencia y buscador; re-resolver por NIT');
    const CDB = await import('../src/lib/db/clientes');
    const nb = await CDB.actualizarNombresCliente(cliB!.airtable_id, { nombreComercial: ' Chicote  E2E ', aliases: ['CALZADO CHICOTE E2E', 'calzado chicoté e2e', 'OTRA EMPRESA, S.A.', ''] });
    ok(nb.ok && nb.nombreComercial === 'Chicote E2E' && nb.aliases.join('|') === 'CALZADO CHICOTE E2E', `actualizarNombresCliente: nombre comercial limpio y marcas sin repetidos ni el nombre propio (${nb.ok ? nb.mensaje : nb.error})`);
    const catalogo = await CDB.getClientes();
    const cB = catalogo.find(c => c.id === cliB!.airtable_id)!, cA = catalogo.find(c => c.id === cliA!.airtable_id)!;
    ok(cB.nombreComercial === 'Chicote E2E' && cB.aliases?.join() === 'CALZADO CHICOTE E2E' && cA.razonSocial === 'E2E AGENDA, SOCIEDAD ANONIMA' && cA.nombreComercial === undefined && cA.aliases === undefined, 'getClientes lee nombre comercial, marcas y razón social de la base (020)');
    const nuevo = await CDB.crearCliente({ nombreEmpresa: 'E2E CHICOTE NUEVO, S.A.', razonSocial: 'E2E CHICOTE NUEVO, SOCIEDAD ANONIMA', nit: NIT_C, nombreComercial: 'Chicote Nuevo', aliases: ['Marca Nueva E2E', 'E2E CHICOTE NUEVO, S.A.'] });
    const cC = nuevo.ok ? (await CDB.getClientes()).find(c => c.id === nuevo.clienteId) : undefined;
    ok(nuevo.ok && !!cC && cC.nombreComercial === 'Chicote Nuevo' && cC.aliases?.join() === 'Marca Nueva E2E' && cC.razonSocial === 'E2E CHICOTE NUEVO, SOCIEDAD ANONIMA', `crearCliente con nombre comercial y marcas (${nuevo.ok ? nuevo.mensaje : nuevo.error})`);
    // Empresa de la Agenda que se llama como la MARCA del cliente B (con tilde) → la sugerencia la encuentra por el alias.
    const { error: eD } = await sb.from('facturacion_expediente').insert({ fuente: 'agenda', id_externo: 'recE2E900', empresa_id_externo: EMP_D, empresa_nombre_externo: 'CALZADO CHICOTÉ E2E', estado_tarifa: 'cliente_sin_mapear', detalle_tarifa: 'sin mapear', terminado: true, cancelado: false, eliminado: false, status_cobro_externo: 'PENDIENTE', fecha_ingreso: '2026-10-09', tipo_prueba: 'POLIGRAFO', proceso_solicitado: 'SOLO POLIGRAFO', categoria_prueba: 'PRE EMPLEO', depto_visita: 'GUATEMALA', persona: 'PERSONA 900', raw: { id: 'recE2E900', empresa: { id: EMP_D, nombre: 'CALZADO CHICOTÉ E2E' }, tipoPrueba: 'POLIGRAFO', procesoSolicitado: 'SOLO POLIGRAFO', categoriaPrueba: 'PRE EMPLEO', deptoVisita: 'GUATEMALA', terminado: true, cancelado: false, eliminado: false, fechaIngreso: '2026-10-09', cobro: { statusCobro: 'PENDIENTE' }, actualizadoEn: '2026-10-20T10:00:00.000Z', nombre: 'PERSONA 900' } });
    const detD = await DB.getGrupo(`e-${EMP_D}`);
    ok(!eD && !!detD && detD.sugerencias[0]?.id === cliB!.airtable_id && detD.sugerencias.length === 1, `Agenda "CALZADO CHICOTÉ E2E" → sugiere "OTRA EMPRESA, S.A." por su marca (sin tildes), y solo a ese (${eD ? eD.message : detD?.sugerencias.map(x => x.name).join(', ')})`);
    const slimA = detD!.clientes.find(c => c.id === cliA!.airtable_id)!, slimB = detD!.clientes.find(c => c.id === cliB!.airtable_id)!;
    ok(slimA.razonSocial === 'E2E AGENDA, SOCIEDAD ANONIMA' && slimA.nombresAgenda?.join() === 'E2E AGENDA' && slimB.nombreComercial === 'Chicote E2E' && slimB.aliases?.join() === 'CALZADO CHICOTE E2E' && slimB.nombresAgenda?.join() === 'OTRA EMPRESA', `los clientes del panel llevan razón social, nombre comercial, marcas y los nombres con los que ya aparecen en la Agenda (sin las marcadas "no se factura") (A: ${slimA.nombresAgenda?.join('|')} · B: ${slimB.nombresAgenda?.join('|')})`);
    const { buscarClientes: buscarC } = await import('../src/lib/clientes/buscar');
    const idNuevo = nuevo.ok ? nuevo.clienteId : 'x';
    ok(buscarC(detD!.clientes, 'calzado chicote')[0]?.id === cliB!.airtable_id && buscarC(detD!.clientes, 'otra émpresa')[0]?.id === cliB!.airtable_id && buscarC(detD!.clientes, 'e2e agenda')[0]?.id === cliA!.airtable_id && buscarC(detD!.clientes, 'agénda sociedad anonima')[0]?.id === cliA!.airtable_id && buscarC(detD!.clientes, NIT_B)[0]?.id === cliB!.airtable_id && buscarC(detD!.clientes, 'marca nueva')[0]?.id === idNuevo, 'buscador del panel: por marca, nombre en la Agenda (con tilde), razón social, NIT y la marca del cliente recién creado');
    // Re-resolver por NIT: cargar precio a la SOCIO RUTINA Q0 del cliente A → e005 pasa a resuelta SIN sync; volver a Q0 → vuelve a "sin tarifa".
    const rutina = (await TDB.getTarifario()).find(t => t.nit === NIT_A && t.tipoPrueba === 'SOCIOECONOMICO' && t.categoria === 'RUTINA' && t.territorio === 'METROPOLITANA' && t.activo)!;   // e005 es GUATEMALA → METROPOLITANA (la generada en DEPARTAMENTAL no es la suya)
    ok((await TDB.editarTarifa(rutina.id, { monto: 500 }, ACTOR, 'precio pactado')).ok, 'se carga Q500 a SOCIO RUTINA (estaba en Q0)');
    const firma = (e: import('../src/lib/facturacion-agenda/tipos').ExpedienteLocal) => JSON.stringify([e.estadoTarifa, e.montoCalculado, e.detalleTarifa, e.tipoCobrado, e.nitResuelto]);
    const antesNit = new Map((await DB.listarExpedientesLocal()).map(e => [e.idExterno, firma(e)]));
    const rNit = await DB.reclasificar({ nit: NIT_A });
    locales = await DB.listarExpedientesLocal();
    const cambiosNit = locales.filter(e => antesNit.get(e.idExterno) !== firma(e)).map(e => `${e.idExterno} ${antesNit.get(e.idExterno)} → ${firma(e)}`);
    ok(rNit === 1 && byId('recE2E005').estadoTarifa === 'resuelta' && byId('recE2E005').montoCalculado === 500 && byId('recE2E008').estadoTarifa === 'sin_tarifa', `reclasificar({ nit }) re-resuelve SOLO la cola de ese NIT: e005 → resuelta Q500 sin "Traer ahora"; el cliente B no se toca (${rNit} cambios: ${cambiosNit.join(' | ')})`);
    ok((await TDB.editarTarifa(rutina.id, { monto: 0 }, ACTOR, 'revertir')).ok && (await DB.reclasificar({ nit: NIT_A })) === 1 && (await DB.listarExpedientesLocal()).find(e => e.idExterno === 'recE2E005')!.estadoTarifa === 'sin_tarifa', 'volver a Q0 → e005 regresa a "sin tarifa" (reversible)');
    await sb.from('facturacion_expediente').delete().eq('id_externo', 'recE2E900');   // la empresa D (sembrada a mano) no entra a la sección de volumen
    // 021: la PAGADO sigue fuera tras todos los syncs (a prueba de sync) y una PAGADO ya facturada no reaparece; SQL y app cuentan lo mismo.
    const v21 = await DB.vistaPorFacturar(), v21f = await DB.vistaPorFacturar({ sinRpc: true });
    const colaApp = locales.filter(e => enColaM(e) && e.nitResuelto === NIT_A && ['resuelta', 'sin_tarifa'].includes(e.estadoTarifa)).length;
    const gA21 = v21.grupos.find(g => g.nit === NIT_A)!;
    ok(!enColaM(byId('recE2E017')) && byId('recE2E017').estatusPagoExterno === 'PAGADO' && !!byId('recE2E001').facturaId && !enColaM(byId('recE2E001')) && gA21.listos + gA21.sinTarifa === colaApp && JSON.stringify(v21.grupos) === JSON.stringify(v21f.grupos) && JSON.stringify(v21.kpis) === JSON.stringify(v21f.kpis), `021: tras varios syncs la provisión PAGADO sigue fuera y la facturada no reaparece; paridad SQL (resumen) = app (enCola) = fallback PostgREST: ${gA21.listos + gA21.sinTarifa} en cola del cliente A`);
    const rrPrecios = await DB.reresolverPrecios();
    ok(rrPrecios.ok && rrPrecios.reclasificados === 0, `"Re-resolver precios" (toda la cola, local): nada pendiente → 0 cambios (${rrPrecios.ok ? rrPrecios.reclasificados : rrPrecios.error})`);

    // ── SERVICIOS DE PRECIO ÚNICO · E2E en HIT: PDA Q3,200 único → los expedientes PDA del cliente resuelven sin importar categoría/territorio ──
    console.log('\n   precio único · PDA Q3,200 → expedientes PDA resuelven sin categoría/territorio');
    const filaPda = (id: string, cat: string | null, depto: string | null) => ({ fuente: 'agenda', id_externo: id, empresa_id_externo: EMP_A, empresa_nombre_externo: 'E2E AGENDA', nit_resuelto: NIT_A, tipo_cobrado: 'PDA', estado_tarifa: 'sin_tarifa', detalle_tarifa: 'sembrado', terminado: true, cancelado: false, eliminado: false, status_cobro_externo: 'PENDIENTE', fecha_ingreso: '2026-10-11', tipo_prueba: 'PDA', proceso_solicitado: 'COMPLETO', categoria_prueba: cat, depto_visita: depto, persona: `PERSONA ${id.slice(-3)}`, raw: { id, empresa: { id: EMP_A, nombre: 'E2E AGENDA' }, tipoPrueba: 'PDA', procesoSolicitado: 'COMPLETO', categoriaPrueba: cat, deptoVisita: depto, terminado: true, cancelado: false, eliminado: false, fechaIngreso: '2026-10-11', cobro: { statusCobro: 'PENDIENTE' }, actualizadoEn: '2026-10-20T10:00:00.000Z', nombre: `PERSONA ${id.slice(-3)}` } });
    const { error: ePda } = await sb.from('facturacion_expediente').insert([filaPda('recE2E910', null, null), filaPda('recE2E911', 'AGENDADO', 'QUETZALTENANGO'), filaPda('recE2E912', 'PRE EMPLEO', 'GUATEMALA')]);
    const plPda = await TDB.planGenerarTarifas(NIT_A);
    ok(!ePda && !('error' in plPda) && plPda.tiposAgenda.includes('PDA') && plPda.porTipo.PDA === 1 && plPda.filas.find(f => f.tipoPrueba === 'PDA')?.categoria === 'UNICA' && plPda.filas.find(f => f.tipoPrueba === 'PDA')?.territorio === 'UNICA', `el plan de "Generar tarifas" lee de la Agenda que el cliente pide PDA → 1 fila UNICA/UNICA (${'error' in plPda ? plPda.error : plPda.resumen})`);
    const gPda = await TDB.generarTarifasCliente({ nit: NIT_A }, ACTOR);
    const tPda = (await TDB.getTarifario()).find(t => t.nit === NIT_A && t.tipoPrueba === 'PDA' && t.activo);
    ok(gPda.ok && gPda.creadas === 1 && !!tPda && tPda.categoria === 'UNICA' && tPda.territorio === 'UNICA' && tPda.monto === 0 && (await TDB.generarTarifasCliente({ nit: NIT_A }, ACTOR) as { creadas?: number }).creadas === 0, 'generar crea la PDA en Q0 (UNICA/UNICA) y una segunda corrida crea 0 (no duplica)');
    ok((await TDB.editarTarifa(tPda!.id, { monto: 3200 }, ACTOR, 'precio pactado PDA')).ok && (await DB.reclasificar({ nit: NIT_A })) === 3, 'se carga Q3,200 → reclasificar({ nit }) re-resuelve los 3 PDA');
    locales = await DB.listarExpedientesLocal();
    ok(['recE2E910', 'recE2E911', 'recE2E912'].every(id => byId(id).estadoTarifa === 'resuelta' && byId(id).montoCalculado === 3200 && byId(id).tipoCobrado === 'PDA' && byId(id).componentes[0]?.categoria === 'UNICA'), 'los 3 PDA (sin categoría/depto, con categoría basura + Quetzaltenango, con PRE EMPLEO + Guatemala) → resuelta Q3,200 cada uno');
    // Patrón legacy: una PDA Q3,200 "matriz" + celdas en Q0 → sigue resolviendo Q3,200 (Q0 no es un precio) con el aviso de normalizar.
    const rPdaSinConf = await TDB.crearTarifa({ nit: NIT_A, tipoPrueba: 'PDA', categoria: 'RUTINA', territorio: 'DEPARTAMENTAL', monto: 0 }, ACTOR);
    const rPdaLegacy = await TDB.crearTarifa({ nit: NIT_A, tipoPrueba: 'PDA', categoria: 'RUTINA', territorio: 'DEPARTAMENTAL', monto: 0, confirmarDuplicado: true }, ACTOR);
    const lk = await TDB.resolverTarifaExpediente({ nit: NIT_A, tipoPrueba: 'PDA', categoria: '', territorio: '' });
    ok(!rPdaSinConf.ok && !!rPdaSinConf.duplicado && !rPdaLegacy.ok && /candado de la base/.test(rPdaLegacy.error), `crear una "segunda PDA" con categoría/territorio de matriz: la llave efectiva es UNICA/UNICA → aviso de repetida y, confirmando, el candado de la base la rechaza (no quedan dos filas) (${rPdaLegacy.ok ? 'creó' : rPdaLegacy.error})`);
    ok(lk.estado === 'ok' && lk.monto === 3200, 'lookup PDA del cliente (sin categoría ni territorio) → Q3,200');
    await sb.from('facturacion_expediente').delete().in('id_externo', ['recE2E910', 'recE2E911', 'recE2E912']);   // fuera antes de la sección de volumen
    await TDB.activarTarifa(tPda!.id, false, ACTOR);
    ok((await DB.reclasificar({ nit: NIT_A })) === 0, 'sin los PDA sembrados y con la tarifa desactivada, la cola de A queda igual (0 cambios)');

    // ── 022 · CORTE DE ARRANQUE (facturar_desde por cliente): lo anterior sale de la cola y de "sin mapear"; sigue en la data ──
    console.log('\n   022 · corte de arranque: facturar_desde por cliente');
    const mE = await DB.guardarMapeo({ empresaIdExterno: EMP_E, empresaNombreExterno: 'E2E GENESIS', clienteAppId: idNuevo }, ACTOR);
    // El cliente nuevo necesita tarifa: el sync re-clasifica TODA la cola desde el raw (también lo anterior al arranque) y sin tarifa los dejaría "sin tarifa".
    const tC = await TDB.crearTarifa({ nit: NIT_C, razonSocial: 'E2E CHICOTE NUEVO, S.A.', tipoPrueba: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto: 300, anio: '2026' }, ACTOR);
    const { error: eFd } = await sb.from('cliente_externo').update({ facturar_desde: '2026-08-01' }).eq('fuente', 'agenda').eq('empresa_id_externo', EMP_E);
    const { error: eFdF } = await sb.from('cliente_externo').insert({ fuente: 'agenda', empresa_id_externo: EMP_F, empresa_nombre_externo: 'E2E GENESIS SUCURSAL', nit: '', activo: false, creado_por: ACTOR, facturar_desde: '2026-08-01' });
    const filaG = (id: string, emp: string, nombre: string, fecha: string, estado: string, nit: string | null) => ({ fuente: 'agenda', id_externo: id, empresa_id_externo: emp, empresa_nombre_externo: nombre, nit_resuelto: nit, tipo_cobrado: 'POLIGRAFO', estado_tarifa: estado, monto_calculado: estado === 'resuelta' ? 300 : null, detalle_tarifa: 'sembrado', terminado: true, cancelado: false, eliminado: false, status_cobro_externo: 'PENDIENTE', fecha_ingreso: fecha, tipo_prueba: 'POLIGRAFO', proceso_solicitado: 'SOLO POLIGRAFO', categoria_prueba: 'PRE EMPLEO', depto_visita: 'GUATEMALA', persona: `PERSONA ${id.slice(-3)}`, componentes: estado === 'resuelta' ? [{ tipoPrueba: 'POLIGRAFO', categoria: 'PRE EMPLEO', territorio: 'METROPOLITANA', monto: 300, aprobada: true }] : [], raw: { id, empresa: { id: emp, nombre }, tipoPrueba: 'POLIGRAFO', procesoSolicitado: 'SOLO POLIGRAFO', categoriaPrueba: 'PRE EMPLEO', deptoVisita: 'GUATEMALA', terminado: true, cancelado: false, eliminado: false, fechaIngreso: fecha, cobro: { statusCobro: 'PENDIENTE' }, actualizadoEn: '2026-10-20T10:00:00.000Z', nombre: `PERSONA ${id.slice(-3)}` } });
    const smAntes = await DB.empresasSinMapear({});
    const { error: eG } = await sb.from('facturacion_expediente').insert([
      filaG('recE2E930', EMP_E, 'E2E GENESIS', '2026-07-15', 'resuelta', NIT_C), filaG('recE2E931', EMP_E, 'E2E GENESIS', '2026-08-05', 'resuelta', NIT_C), filaG('recE2E932', EMP_E, 'E2E GENESIS', '2026-07-31', 'sin_tarifa', NIT_C),
      filaG('recE2E933', EMP_F, 'E2E GENESIS SUCURSAL', '2026-07-10', 'cliente_sin_mapear', null), filaG('recE2E934', EMP_F, 'E2E GENESIS SUCURSAL', '2026-08-10', 'cliente_sin_mapear', null),
    ]);
    ok(mE.ok && tC.ok && !eFd && !eFdF && !eG, `semilla 022: E2E GENESIS mapeada al cliente nuevo con facturar_desde 2026-08-01 (3 exp.: 15-jul resuelta, 5-ago resuelta, 31-jul sin tarifa) + sucursal SIN mapear con corte (10-jul y 10-ago)${[eFd, eFdF, eG].filter(Boolean).map(x => ' · ' + x!.message).join('')}`);
    const v22 = await DB.vistaPorFacturar(), v22f = await DB.vistaPorFacturar({ sinRpc: true });
    const gC = v22.grupos.find(g => g.nit === NIT_C);
    ok(!!gC && gC.listos === 1 && gC.totalSinIva === 300 && gC.sinTarifa === 0 && gC.expedientes === 1 && gC.fechaIngresoMasAntigua === '2026-08-05', `resumen (SQL): el cliente con corte solo cuenta agosto (1 listo, Q300, 0 sin tarifa); el 15-jul y el 31-jul quedan fuera (${JSON.stringify(gC)})`);
    const smDespues = await DB.empresasSinMapear({}), smF2 = await DB.empresasSinMapear({ sinRpc: true });
    ok(smDespues.totalEmpresas === smAntes.totalEmpresas + 1 && smDespues.totalExpedientes === smAntes.totalExpedientes + 1 && smDespues.filas.find(f => f.empresaIdExterno === EMP_F)?.expedientes === 1 && smDespues.filas.find(f => f.empresaIdExterno === EMP_F)?.fechaMasAntigua === '2026-08-10' && JSON.stringify(smF2.filas) === JSON.stringify(smDespues.filas) && smF2.totalExpedientes === smDespues.totalExpedientes, '"sin mapear" (SQL y fallback): la sucursal sin mapear con corte muestra 1 expediente (10-ago); el de julio no entra');
    ok(JSON.stringify(v22f.grupos) === JSON.stringify(v22.grupos) && JSON.stringify(v22f.kpis) === JSON.stringify(v22.kpis), 'paridad: fallback PostgREST (filtro por empresa con corte) = resumen SQL');
    const locC = await DB.listarExpedientesLocal({ nit: NIT_C });
    const lc = (id: string) => locC.find(e => e.idExterno === id)!;
    ok(locC.length === 3 && lc('recE2E930').arranqueExcluido === true && !enColaM(lc('recE2E930')) && lc('recE2E932').arranqueExcluido === true && !enColaM(lc('recE2E932')) && !lc('recE2E931').arranqueExcluido && enColaM(lc('recE2E931')) && facturableM(lc('recE2E931')) && !facturableM(lc('recE2E930')), 'app: los 3 siguen en la data; 15-jul y 31-jul marcados "antes del arranque" (ni en cola ni facturables); 5-ago en cola y facturable');
    const gDet = await DB.getGrupo(`n-${NIT_C}`);
    ok(!!gDet && gDet.arranque?.facturarDesde === '2026-08-01' && gDet.arranque?.fuera === 2 && gDet.grupo?.listos === 1 && gDet.expedientes.length === 3, 'detalle del cliente: aviso "desde 2026-08-01 · 2 fuera"; el grupo cuenta 1 listo; la lista trae los 3');
    const mE2 = await DB.guardarMapeo({ empresaIdExterno: EMP_E, empresaNombreExterno: 'E2E GENESIS', clienteAppId: idNuevo }, ACTOR);
    const sE = await DB.sincronizarAgenda({ actor: ACTOR, api: apiRapida() });
    const fdE = (await DB.getMapeos()).find(m => m.empresaIdExterno === EMP_E)?.facturarDesde;
    const v22b = await DB.vistaPorFacturar();
    const locC2 = await DB.listarExpedientesLocal({ nit: NIT_C });
    ok(mE2.ok && sE.ok && fdE === '2026-08-01' && v22b.grupos.find(g => g.nit === NIT_C)?.listos === 1 && locC2.length === 3 && locC2.filter(e => e.arranqueExcluido).length === 2 && locC2.every(e => e.estadoTarifa === 'resuelta' && e.montoCalculado === 300), `durable y a prueba de sync: volver a mapear la empresa y correr el sync (que re-clasifica toda la cola) no pisan facturar_desde; el corte sigue aplicando y las 3 filas siguen en la data con precio (${JSON.stringify({ mapeo: mE2.ok, sync: sE.ok, facturarDesde: fdE, listos: v22b.grupos.find(g => g.nit === NIT_C)?.listos, estados: locC2.map(e => `${e.idExterno}:${e.estadoTarifa}:${e.montoCalculado}:${e.arranqueExcluido ? 'fuera' : 'cola'}`) })})`);
    ok((await DB.getMapeos()).find(m => m.empresaIdExterno === EMP_A)?.facturarDesde === null && v22.grupos.find(g => g.nit === NIT_A)?.listos === v21.grupos.find(g => g.nit === NIT_A)?.listos, 'un cliente sin facturar_desde (A) se comporta exactamente como antes');
    await sb.from('facturacion_expediente').delete().in('id_externo', ['recE2E930', 'recE2E931', 'recE2E932', 'recE2E933', 'recE2E934']);
    await sb.from('cliente_externo').delete().in('empresa_id_externo', [EMP_E, EMP_F]);

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
    ok((nVol ?? 0) >= 8016, `espejo con ${nVol} filas (7,000 sin mapear en 200 empresas + 1,000 psicométricas + las del ciclo)`);
    let t0 = Date.now(); const vistaV = await DB.vistaPorFacturar(); const msRpc = Date.now() - t0;
    ok(msRpc < 2000 && vistaV.agregadoEnSql && vistaV.grupos.length === 2 && vistaV.kpis.listos === 3 && vistaV.kpis.sinTarifa === 2 && vistaV.kpis.sinMapear === 7000 && vistaV.sinMapear.empresas === 200 && vistaV.kpis.excluidos === 1001 && vistaV.kpis.excluidosNoFactura === 1 && vistaV.noFacturan.length === 1 && vistaV.total === (nVol ?? 0), `vistaPorFacturar con ${nVol} filas: ${msRpc} ms (< 2 s); la lista sigue con los 2 clientes del ciclo (3 listos, 2 sin tarifa); KPIs: 7,000 sin mapear en 200 empresas, 1,001 psicométricas — nada de eso se cargó (${JSON.stringify({ grupos: vistaV.grupos.length, kpis: vistaV.kpis })})`);
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
      const { count: dd } = await sb.from('detalle_facturacion').select('id', { count: 'exact', head: true }).in('nit', [NIT_A, NIT_B]);
      const [{ count: a }, { count: b }, { count: c }, { count: d }, { count: f }] = await Promise.all([
        sb.from('facturas_clientes').select('id', { count: 'exact', head: true }).in('no_factura', FACTS),
        sb.from('factura_detalle_expediente').select('id', { count: 'exact', head: true }).in('no_factura', FACTS),
        sb.from('facturacion_expediente').select('id', { count: 'exact', head: true }).like('id_externo', 'recE2E%'),
        sb.from('cliente_externo').select('id', { count: 'exact', head: true }).in('empresa_id_externo', [EMP_A, EMP_B, EMP_C, EMP_D, EMP_E, EMP_F]),
        sb.from('clientes').select('id', { count: 'exact', head: true }).in('nit', [NIT_A, NIT_B, NIT_C]),
      ]);
      ok(a === 0 && b === 0 && c === 0 && d === 0 && f === 0 && v === 0 && dd === 0, 'limpieza verificada: 0 facturas / detalle (cascade) / expedientes / mapeos / clientes de prueba / filas de volumen / detalles de facturación');
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
  return e.terminado && !e.cancelado && !e.eliminado && e.estadoTarifa !== 'excluido_psicometrica' && !e.facturaId && (!e.statusCobroExterno || /^(PENDIENTE|SIN_STATUS)$/i.test(e.statusCobroExterno)) && String(e.estatusPagoExterno ?? '').trim().toUpperCase() !== 'PAGADO';
}
