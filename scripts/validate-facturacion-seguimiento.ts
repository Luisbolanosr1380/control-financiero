/**
 * SEGUIMIENTO DE COBRO A LA VISTA (Facturación) — validador.
 *
 *  A. Estático: el texto del buscador va al servidor (hayBusquedaServidor con texto; Enter), la búsqueda mira todos los
 *     nombres del cliente (src/lib/clientes/buscar.ts), las pestañas de cartera cargan TODAS las abiertas con UNA consulta
 *     de cobranza (sin llamadas por fila), orden y chips en la URL, columna «Cobranza», sección en la factura con el
 *     MISMO formulario del Centro de Cobros y el botón solo con gestionar_cobranza (la acción valida en el servidor),
 *     tabs desplazables, ayuda; sin migración nueva; sin diálogos del navegador; no toca estado (033), cobrada (026),
 *     emisión ni cobros.
 *  B. Puro: cada badge en su caso (paga hoy, promesa futura, incumplida, disputa, pide documentos, dice que pagó,
 *     seguimiento hoy / atrasado, sin gestión, cobrada sin badge), prioridad y title, última nota, chips, KPI de promesas,
 *     orden por días vencida (y por columna), pestañas, búsqueda de texto por nombre comercial / alias / NIT sin tildes.
 *  C. HIT (datos sembrados): un cliente «FOGEL E2E» con nombre comercial y alias y 11 facturas (una de nov-2025
 *     PENDIENTE con espacio, como la 2931640115 de FOGEL en Golden), eventos por factura para cada badge; «fogel» con
 *     Enter la encuentra aunque el mes sea otro (también por alias y nombre comercial); la cartera con seguimiento
 *     ordenada por días vencida con una sola consulta de cobranza; cada chip; paridad del estado con la RPC 033; la
 *     sección de la factura solo con sus eventos (+ los generales con el interruptor); registrar desde la factura crea el
 *     evento con la factura incluida y exige seguimiento; el rol lectura no tiene gestionar_cobranza.
 *
 * Uso: npx tsx scripts/validate-facturacion-seguimiento.ts hit [--conservar | --solo-limpiar]   (--conservar deja el cliente CS-E2E para el E2E en Chrome)
 */
import fs from 'node:fs';
import path from 'node:path';
import type { EventoLite, FacturaBase, SeguimientoFactura } from '../src/lib/cobranza/seguimiento';

const BASE = (process.argv[2] ?? 'hit').toLowerCase();
if (BASE !== 'hit') { console.error('Este validador siembra datos: solo corre contra HIT.'); process.exit(2); }
const CONSERVAR = process.argv.includes('--conservar'), SOLO_LIMPIAR = process.argv.includes('--solo-limpiar');
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.hit.vercel'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('='); process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  🟢 ${m}`); } else { fail++; console.log(`  🔴 ${m}`); } };
const rd = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const NIT = '99990037K', PREFIJO = 'CS-E2E-', APP = 'sbwCSE2E01', ACTOR = 'contador@cs-e2e.example';

(async () => {
  /* ───────────── A. Estático ───────────── */
  console.log('\nA. Estático');
  const puro = rd('src/lib/facturacion/buscar-monto.ts'), srv = rd('src/lib/db/facturas-buscar.ts'), pg = rd('src/app/(app)/facturacion/page.tsx'), lc = rd('src/components/facturas/list-client.tsx');
  const segSrc = rd('src/lib/cobranza/seguimiento.ts'), cf = rd('src/lib/db/cobranza-facturas.ts'), tabla = rd('src/components/facturas/cartera-tabla.tsx'), sec = rd('src/components/facturas/seguimiento-cobro-section.tsx'), det = rd('src/components/facturas/factura-detalle.tsx'), pgDet = rd('src/app/(app)/facturacion/[id]/page.tsx'), acts = rd('src/app/(app)/cobranza/actions.ts');
  ok(/\|\| !!c\.texto;/.test(puro) && /import \{ coincideCliente, normalizarBusqueda \} from '@\/lib\/clientes\/buscar'/.test(puro) && /export const coincideTexto/.test(puro) && /aliases: f\.clienteNombres \?\? null/.test(puro) && /nombre_comercial, aliases\)'/.test(srv) && /clienteNombres: \[cli\?\.razon_social, cli\?\.nombre_comercial/.test(srv), 'A: el texto también manda al servidor; la búsqueda mira nombre, razón social, nombre comercial, aliases y NIT sin tildes (src/lib/clientes/buscar.ts)');
  ok(/else if \(interpretacion\.tipo === 'texto'\) irABusqueda\(\{ \.\.\.criteriosBase, texto: interpretacion\.texto \}\)/.test(lc) && /data-accion="buscar-texto"/.test(lc) && /Enter para buscar «/.test(lc) && /coincideLocal\(i\.noFactura, i\.custId\)/.test(lc), 'A: Enter con texto va al servidor sobre todas las facturas; chip «Enter para buscar … en todas»; la vista previa local usa los mismos nombres');
  ok(/const esCartera = !busqueda && esTabCartera\(initialTab\)/.test(pg) && /esCartera \? getCarteraConSeguimiento\(\) : Promise\.resolve\(null\)/.test(pg) && /esOrdenCartera\(ordenRaw\)/.test(pg) && /esFiltroCobranza\(uno\('cob'\)\)/.test(pg) && /pasaFiltroCobranza\(f\.seguimiento, filtroCob, carteraDatos\.hoy\)/.test(pg) && /export const TABS_CARTERA: readonly TabCartera\[\] = \['cartera_total', 'por_cobrar', 'vencidas', 'pendientes', 'parciales'\]/.test(segSrc) && !/export const TABS_CARTERA/.test(lc) && !/import \{[^}]*TABS_CARTERA[^}]*\} from '@\/components\/facturas\/list-client'/.test(pg), 'B: en Cartera total / Por cobrar / Vencidas / Pendientes / Parciales el servidor carga TODA la cartera abierta; orden (`orden`, `dir`) y chip (`cob`) desde la URL; TABS_CARTERA vive en el módulo puro (un valor exportado de un módulo use client llega al servidor como referencia, no como arreglo)');
  ok(/getFacturasPendientesCobro\(\)/.test(cf) && /sb\.from\('cobranza_evento'\)\.select\(SELECT_LITE\)\.in\('tipo', TIPOS_SEGUIMIENTO\)/.test(cf) && /cliente:clientes\(airtable_id\)/.test(cf) && (cf.match(/sb\.from\('cobranza_evento'\)/g) ?? []).length === 1 && /consultasCobranza: 1/.test(cf) && !/for \(const f of pend\.p\.filas\) \{[\s\S]*?await/.test(cf) && /seguimientosPorFactura\(/.test(cf) && !/\.insert\(|\.update\(|\.delete\(|\.rpc\(/.test(cf), 'C: una sola consulta a cobranza_evento (con el cliente embebido) para toda la página, nada por fila; el loader solo lee');
  ok(/export const ORDEN_BADGE: ClaveBadge\[\] = \['paga_hoy', 'promesa_incumplida', 'seguimiento_atrasado', 'seguimiento_hoy', 'dice_que_pago', 'en_disputa', 'pide_documentos', 'promesa', 'sin_gestion'\]/.test(segSrc) && /DIAS_SIN_GESTION = 7/.test(segSrc) && /FILTROS_COBRANZA = \['pagan_hoy', 'promesas_semana', 'promesas_incumplidas', 'seguimiento_hoy', 'vencidas_sin_gestion'\]/.test(segSrc) && /estadoFactura\(\{ fechaEmision: f\.fechaEmision/.test(segSrc) && !/from 'node:|server-only|supabase/.test(segSrc), 'C: badges con prioridad fija, «sin gestión» = vencida sin evento en 7 días, 5 chips; el módulo es puro y reusa el estado 033 (no lo redefine)');
  ok(/data-chip-cobranza=\{f\}/.test(tabla) && /data-kpi-promesas-semana/.test(tabla) && /data-cobranza>/.test(tabla) && /title=\{nota\.completa\}/.test(tabla) && /data-orden=\{k\}/.test(tabla) && /data-totales-cartera/.test(tabla) && /data-suma-saldo/.test(tabla) && /ordenarCartera\(rows, orden, dir\)/.test(tabla) && /router\.push\(`\/facturacion\$\{qs \? `\?\$\{qs\}` : ''\}`, \{ scroll: false \}\)/.test(tabla) && /Días vencida/.test(tabla) && /data-accion="exportar-csv-cartera"/.test(tabla), 'B/C: tabla con Factura, Cliente, Emisión, Vence, Días vencida, Total, Saldo, Cobranza (badge + nota con title), Estado; encabezados ordenables a la URL; pie con cantidad y saldo; CSV');
  ok(/import \{ GestionForm \} from '@\/components\/cobranza\/gestion-form'/.test(sec) && /facturasPre=\{\[d\.noFactura\]\}/.test(sec) && /puede\('gestionar_cobranza'\) && !cobrada && <button/.test(sec) && /data-accion="registrar-seguimiento"/.test(sec) && /data-campo="incluir-cliente"/.test(sec) && /data-accion="ver-ficha-cobranza"/.test(sec) && /useState\(!cobrada\)/.test(sec) && /router\.refresh\(\)/.test(sec) && /<SeguimientoCobroSection datos=\{seguimiento\} \/>/.test(det) && /getSeguimientoFactura\(factura, saldoPendiente\)/.test(pgDet) && /const permiso = await autorizar\('gestionar_cobranza'\);\n  if \(!permiso\.ok\) return \{ ok: false, error: permiso\.error \};\n  const r = await registrarGestion/.test(acts) && /revalidatePath\('\/facturacion\/\[id\]', 'page'\)/.test(acts), 'D: sección en la factura con el MISMO formulario (factura preseleccionada), plegada si está cobrada, interruptor del cliente, enlace a la ficha; botón solo con gestionar_cobranza y la acción valida en el servidor; la lista y la factura se revalidan');
  ok(/overflowX: 'auto', flexWrap: 'nowrap'/.test(lc) && /data-tabs-facturacion/.test(lc) && !/window\.(confirm|alert|prompt)/.test(lc + tabla + sec) && !fs.existsSync('supabase/migrations/034_facturacion_seguimiento.sql') && /Seguimiento de cobro en la factura:/.test(rd('supabase/ayuda_facturacion_seguimiento_cobro.sql')) && /slug = 'centro-de-cobros'/.test(rd('supabase/ayuda_facturacion_seguimiento_cobro.sql')), 'de paso: tabs desplazables a 390 px; sin diálogos del navegador; sin migración; ayuda de Facturación y del Centro de Cobros');
  const estadoTs = rd('src/lib/cobranza/estado.ts'), m33 = rd('supabase/migrations/033_cobranza_nucleo.sql'), ef = rd('src/lib/facturacion-agenda/estado-factura.ts');
  const { execSync } = await import('node:child_process');
  const cambiados = execSync('git diff --name-only origin/main...HEAD; git diff --name-only', { encoding: 'utf8' }).split('\n').filter(Boolean);
  ok(!cambiados.some(f => /src\/lib\/cobranza\/estado\.ts|033_cobranza_nucleo|estado-factura\.ts|src\/lib\/db\/cobros\.ts|src\/lib\/db\/facturas\.ts$/.test(f)) && /DIAS_POR_VENCER = 5/.test(estadoTs) && /facturacion_factura_cobrada\(p_no_factura\)/.test(m33) && /export function facturaCobrada/.test(ef), `no tocar: estado 033, regla «cobrada» 026, emisión y cobros no cambian en esta rama (${cambiados.length} archivos tocados)`);

  /* ───────────── B. Puro ───────────── */
  console.log('\nB. Puro');
  const S = await import('../src/lib/cobranza/seguimiento');
  const E0 = await import('../src/lib/cobranza/estado');
  const P = await import('../src/lib/facturacion/buscar-monto');
  const hoy = '2026-11-10';
  const F = (nf: string, extra: Partial<FacturaBase> = {}): FacturaBase => ({ noFactura: nf, clienteUuid: 'c1', fechaEmision: '2026-09-01', diasCredito: 30, cobrada: false, parcial: false, ...extra });
  let n = 0;
  const E = (tipo: EventoLite['tipo'], fecha: string, extra: Partial<EventoLite> = {}): EventoLite => ({ id: `e${++n}`, clienteUuid: 'c1', tipo, fecha: `${fecha}T12:00:00Z`, facturas: [], ...extra });
  const b = (f: FacturaBase, evs: EventoLite[]) => { const s = S.seguimientoDe(f, evs, hoy); return `${s.badge?.clave ?? '-'}|${s.badges.map(x => x.clave).join('+')}`; };
  ok(b(F('A'), []) === 'sin_gestion|sin_gestion' && b(F('A', { fechaEmision: '2026-11-01' }), []) === '-|' && b(F('A'), [E('gestion', '2026-11-05', { resultado: 'contactado', comentario: 'ok', proximoSeguimiento: '2026-11-20' })]) === '-|' && b(F('A'), [E('gestion', '2026-11-02', { resultado: 'contactado', proximoSeguimiento: '2026-11-20' })]) === 'sin_gestion|sin_gestion' && b(F('A', { cobrada: true }), []) === '-|', 'sin gestión = vencida sin evento en 7 días o más (al día sin eventos no lleva badge; con gestión hace 5 días no; hace 8 sí; cobrada nunca)');
  ok(b(F('A'), [E('promesa', '2026-11-08', { fechaPromesa: '2026-11-10', promesaEstado: 'pendiente', facturas: ['A'] })]) === 'paga_hoy|paga_hoy' && b(F('A'), [E('promesa', '2026-11-08', { fechaPromesa: '2026-11-15', promesaEstado: 'pendiente' })]) === 'promesa|promesa' && S.seguimientoDe(F('A'), [E('promesa', '2026-11-08', { fechaPromesa: '2026-11-15', promesaEstado: 'pendiente' })], hoy).badge?.texto === 'Promesa 15-nov' && b(F('A'), [E('promesa', '2026-11-01', { fechaPromesa: '2026-11-05', promesaEstado: 'pendiente' })]) === 'promesa_incumplida|promesa_incumplida' && b(F('A'), [E('promesa', '2026-11-01', { fechaPromesa: '2026-11-05', promesaEstado: 'incumplida' })]) === 'promesa_incumplida|promesa_incumplida+sin_gestion' && b(F('A'), [E('promesa', '2026-10-20', { fechaPromesa: '2026-11-05', promesaEstado: 'cumplida' })]) === 'sin_gestion|sin_gestion' && b(F('A'), [E('promesa', '2026-11-08', { fechaPromesa: '2026-11-05', promesaEstado: 'cumplida' })]) === '-|', 'promesas: hoy → «Paga hoy»; futura → «Promesa 15-nov»; pasada sin cobro o marcada incumplida → «Promesa incumplida» (y «sin gestión» detrás si ya pasaron 7 días sin nada); cumplida no lleva badge propio (si la factura sigue vencida sin evento en 7 días, es sin gestión)');
  ok(b(F('A'), [E('gestion', '2026-11-09', { resultado: 'disputa', comentario: 'precio', proximoSeguimiento: '2026-11-20' })]) === 'en_disputa|en_disputa' && b(F('A'), [E('gestion', '2026-11-09', { resultado: 'pide_documentos', proximoSeguimiento: '2026-11-20' })]) === 'pide_documentos|pide_documentos' && b(F('A'), [E('gestion', '2026-11-09', { resultado: 'dice_que_pago', proximoSeguimiento: '2026-11-20' })]) === 'dice_que_pago|dice_que_pago' && b(F('A'), [E('gestion', '2026-11-09', { resultado: 'contactado', proximoSeguimiento: '2026-11-10' })]) === 'seguimiento_hoy|seguimiento_hoy' && b(F('A'), [E('gestion', '2026-11-05', { resultado: 'contactado', proximoSeguimiento: '2026-11-08' })]) === 'seguimiento_atrasado|seguimiento_atrasado' && b(F('A'), [E('gestion', '2026-11-05', { resultado: 'contactado', proximoSeguimiento: '2026-11-08', seguimientoHechoEn: '2026-11-08T10:00:00Z' })]) === '-|', 'gestiones: en disputa, pide documentos, dice que pagó; seguimiento hoy / atrasado (un seguimiento ya hecho no cuenta)');
  const combo = S.seguimientoDe(F('A'), [E('promesa', '2026-11-01', { fechaPromesa: '2026-11-05', promesaEstado: 'pendiente', facturas: ['A'] }), E('gestion', '2026-11-09', { resultado: 'pide_documentos', comentario: 'quieren la contraseña', contactoTexto: 'Liseth', canal: 'llamada', creadoPor: 'ana@x', proximoSeguimiento: '2026-11-09' })], hoy);
  ok(combo.badge?.clave === 'promesa_incumplida' && combo.badges.map(x => x.clave).join('+') === 'promesa_incumplida+seguimiento_atrasado+pide_documentos' && combo.badges.map(x => x.texto).join(' · ') === 'Promesa incumplida · Seguimiento atrasado · Pide documentos' && combo.proximoSeguimiento === '2026-11-09' && combo.promesa?.fecha === '2026-11-05', 'varios casos a la vez: el badge principal es el más urgente y el title lleva todos («Promesa incumplida · Seguimiento atrasado · Pide documentos»)');
  const notaTxt = S.textoNota(combo.ultimaNota!, hoy);
  ok(notaTxt.corta === '9-nov · Llamada a Liseth: quieren la contraseña' && notaTxt.completa === '9-nov · Llamada a Liseth: quieren la contraseña — ana@x' && S.textoNota({ ...combo.ultimaNota!, texto: 'x'.repeat(100) }, hoy).corta.length === 70 && S.textoNota({ ...combo.ultimaNota!, texto: 'x'.repeat(100) }, hoy).corta.endsWith('…'), 'última nota en una línea: «9-nov · Llamada a Liseth: quieren la contraseña» (cortada a 70 con el texto completo y el autor en el title)');
  const porCliente = S.seguimientoDe(F('B'), [E('gestion', '2026-11-09', { resultado: 'dice_que_pago', proximoSeguimiento: '2026-11-20' }), E('gestion', '2026-11-08', { resultado: 'disputa', facturas: ['C'], proximoSeguimiento: '2026-11-20' })], hoy);
  ok(porCliente.badge?.clave === 'dice_que_pago' && S.seguimientoDe(F('C'), [E('gestion', '2026-11-08', { resultado: 'disputa', facturas: ['C'], proximoSeguimiento: '2026-11-20' })], hoy).badge?.clave === 'en_disputa' && S.seguimientoDe(F('D'), [E('gestion', '2026-11-08', { resultado: 'disputa', facturas: ['C'], proximoSeguimiento: '2026-11-20' })], hoy).badge?.clave === 'sin_gestion', 'un evento sin facturas aplica a todas las del cliente; uno con facturas solo a esas (la D no lo hereda)');
  const segs = S.seguimientosPorFactura([F('A'), F('B', { clienteUuid: 'c2' }), F('C', { clienteUuid: null })], [E('promesa', '2026-11-08', { fechaPromesa: '2026-11-12', promesaEstado: 'pendiente', monto: 500 }), E('promesa', '2026-11-08', { clienteUuid: 'c2', fechaPromesa: '2026-11-10', promesaEstado: 'pendiente', facturas: ['B'] }), E('promesa', '2026-11-08', { clienteUuid: 'c2', fechaPromesa: '2026-11-30', promesaEstado: 'pendiente', facturas: ['Z'] })], hoy);
  ok(segs.A.badge?.clave === 'promesa' && segs.B.badge?.clave === 'paga_hoy' && segs.C.badge?.clave === 'sin_gestion', 'seguimientosPorFactura agrupa por cliente: A promesa, B paga hoy (cliente 2), C sin cliente → sin gestión');
  const kpi = S.kpiPromesasSemana(segs, { A: 1000, B: 250, C: 0 }, hoy);
  ok(kpi.n === 2 && kpi.monto === 750 && S.kpiPromesasSemana(S.seguimientosPorFactura([F('A')], [E('promesa', '2026-11-08', { fechaPromesa: '2026-11-18', promesaEstado: 'pendiente', monto: 9 })], hoy), { A: 1 }, hoy).n === 0, 'KPI promesas de esta semana: 2 promesas (monto prometido 500 + saldo 250 de la que no dio monto); una a 8 días no entra');
  const pf = (s: SeguimientoFactura, f: Parameters<typeof S.pasaFiltroCobranza>[1]) => S.pasaFiltroCobranza(s, f, hoy);
  ok(pf(segs.B, 'pagan_hoy') && !pf(segs.A, 'pagan_hoy') && pf(segs.A, 'promesas_semana') && pf(segs.B, 'promesas_semana') && !pf(segs.C, 'promesas_semana') && pf(combo, 'promesas_incumplidas') && pf(combo, 'seguimiento_hoy') && pf(segs.C, 'vencidas_sin_gestion') && !pf(segs.A, 'vencidas_sin_gestion'), 'chips: pagan hoy, promesas esta semana, promesas incumplidas, seguimiento para hoy (incluye atrasados), vencidas sin gestión');
  const filas = [{ noFactura: 'F1', cliente: 'Zeta', fechaEmision: '2026-09-01', fechaVencimiento: '2026-10-01', diasVencidos: 40, total: 100, saldo: 100, seguimiento: segs.A }, { noFactura: 'F2', cliente: 'Alfa', fechaEmision: '2025-11-13', fechaVencimiento: '2025-12-13', diasVencidos: 332, total: 1100, saldo: 1100, seguimiento: segs.C }, { noFactura: 'F3', cliente: 'Beta', fechaEmision: '2026-11-01', fechaVencimiento: '2026-12-01', diasVencidos: -21, total: 50, saldo: 50, seguimiento: segs.B }];
  const ord = (o: Parameters<typeof S.ordenarCartera>[1], d: 'asc' | 'desc') => S.ordenarCartera(filas, o, d).map(f => f.noFactura).join(',');
  ok(ord('dias', 'desc') === 'F2,F1,F3' && ord('dias', 'asc') === 'F3,F1,F2' && ord('cliente', 'asc') === 'F2,F3,F1' && ord('saldo', 'desc') === 'F2,F1,F3' && ord('cobranza', 'desc') === 'F3,F1,F2' && ord('emision', 'asc') === 'F2,F1,F3', 'orden: por defecto días sin pagar de mayor a menor (la de nov-2025 primero); por cliente, saldo, emisión y por urgencia de cobranza (paga hoy primero)');
  const t = (f: { estadoBruto: 'emitida' | 'pendiente' | 'cobrado_parcial'; vencida: boolean }) => ['cartera_total', 'por_cobrar', 'vencidas', 'pendientes', 'parciales', 'todas'].filter(tab => S.filaEnTabCartera(f, tab)).join(',');
  ok(t({ estadoBruto: 'emitida', vencida: true }) === 'cartera_total,por_cobrar,vencidas' && t({ estadoBruto: 'emitida', vencida: false }) === 'cartera_total,por_cobrar' && t({ estadoBruto: 'pendiente', vencida: true }) === 'cartera_total,pendientes' && t({ estadoBruto: 'cobrado_parcial', vencida: true }) === 'cartera_total,por_cobrar,vencidas,parciales', 'pestañas: emitida vencida → cartera, por cobrar, vencidas; pendiente → cartera y pendientes; parcial vencida → las cuatro');
  const fb = { noFactura: '2931640115', fechaEmision: '2025-11-13', clienteNombre: 'FOGEL DE CENTROAMERICA, SOCIEDAD ANONIMA', nit: '1234567-8', total: 1100, subtotal: 982.14, saldo: 1100, cobrada: false, estado: 'pendiente' as const, clienteNombres: ['FOGEL DE CENTROAMERICA, SOCIEDAD ANONIMA', 'Fogel', 'Refrigeración Fogel'] };
  ok(P.coincideTexto(fb, 'fogel') && P.coincideTexto(fb, 'FOGEL CENTROAMERICA') && P.coincideTexto(fb, 'refrigeracion') && P.coincideTexto(fb, 'Refrigeración') && P.coincideTexto(fb, '2931640115') && P.coincideTexto(fb, '1234567') && !P.coincideTexto(fb, 'megapaca') && P.hayBusquedaServidor({ ...P.CRITERIOS_VACIOS, texto: 'fogel' }) && !P.hayBusquedaServidor(P.CRITERIOS_VACIOS) && P.coincideCriterios(fb, { ...P.CRITERIOS_VACIOS, texto: 'fogel', estado: 'pendientes' }) && !P.coincideCriterios(fb, { ...P.CRITERIOS_VACIOS, texto: 'fogel', estado: 'pagadas' }), 'búsqueda de texto: «fogel», dos palabras, alias con tilde y sin tilde, número y NIT; «megapaca» no; el texto solo ya es búsqueda del servidor y se combina con el estado');

  /* ───────────── C. HIT ───────────── */
  console.log(`\nC. HIT${CONSERVAR ? ' (--conservar)' : SOLO_LIMPIAR ? ' (--solo-limpiar)' : ''}`);
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const limpiar = async () => {
    const { data: cl } = await sb.from('clientes').select('id').eq('nit', NIT);
    const ids = (cl ?? []).map(c => c.id as string);
    if (ids.length) {
      const { data: fs2 } = await sb.from('facturas_clientes').select('id').in('cliente_id', ids);
      const fids = (fs2 ?? []).map(f => f.id as string);
      if (fids.length) { await sb.from('cobros_clientes').delete().in('factura_id', fids); await sb.from('facturas_clientes').delete().in('id', fids); }
      await sb.from('clientes').delete().in('id', ids);   // cascada a contactos y eventos
    }
    const { count } = await sb.from('clientes').select('id', { count: 'exact', head: true }).eq('nit', NIT);
    return count ?? 0;
  };
  if (SOLO_LIMPIAR) { ok((await limpiar()) === 0, 'limpieza: cliente de prueba borrado con facturas, cobros, eventos y contactos'); console.log(`\n${pass} 🟢 / ${fail} 🔴`); process.exit(fail ? 1 : 0); }
  await limpiar();
  const hoyR = (await import('../src/lib/utils/fechas')).obtenerFechaHoyGuatemala();
  const d = (k: number) => E0.sumarDias(hoyR, k);
  const { data: cli1, error: eCli } = await sb.from('clientes').insert({ airtable_id: APP, nombre_empresa: 'FOGEL E2E DE CENTROAMERICA', razon_social: 'FOGEL E2E DE CENTROAMERICA, SOCIEDAD ANONIMA', nombre_comercial: 'Refrigeración Fogel E2E', aliases: ['Fogelito'], nit: NIT, activo: true, dias_credito: 30, responsable_cobro: ACTOR }).select('id').single();
  const U = String(cli1?.id ?? '');
  await sb.from('cliente_contacto').insert({ cliente_id: U, nombre: 'Liseth Ramírez', rol: 'cuentas_por_pagar', correo: 'pagos@cs-e2e.example', telefono: '2222-3333', whatsapp: '5555-9876', preferido: true, origen: 'manual', creado_por: ACTOR });
  // 11 facturas: la 001 es «la de FOGEL» (nov-2025, PENDIENTE con espacio, Q1,100); las demás, un caso de badge cada una
  const fx = [
    { n: '001', fecha: '2025-11-13', total: 1100, estado: 'PENDIENTE ' },   // sin gestión (vencida, sin eventos)
    { n: '002', fecha: d(-45), total: 2000, estado: 'EMITIDA' },             // paga hoy
    { n: '003', fecha: d(-44), total: 3000, estado: 'EMITIDA' },             // promesa futura (en 5 días)
    { n: '004', fecha: d(-43), total: 4000, estado: 'EMITIDA' },             // promesa incumplida
    { n: '005', fecha: d(-42), total: 5000, estado: 'EMITIDA' },             // en disputa
    { n: '006', fecha: d(-41), total: 6000, estado: 'EMITIDA' },             // pide documentos
    { n: '007', fecha: d(-40), total: 7000, estado: 'EMITIDA' },             // dice que pagó
    { n: '008', fecha: d(-39), total: 8000, estado: 'EMITIDA' },             // seguimiento hoy
    { n: '009', fecha: d(-38), total: 9000, estado: 'EMITIDA' },             // seguimiento atrasado
    { n: '010', fecha: d(-37), total: 1000, estado: 'COBRADO PARCIAL ' },    // gestionada hace 2 días: sin badge, parcial
    { n: '011', fecha: d(-80), total: 1500, estado: 'COBRADO ' },            // cobrada: fuera de la cartera
  ].map((f, i) => ({ airtable_id: `recCSE2E${String(i + 1).padStart(3, '0')}`, no_factura: `${PREFIJO}${f.n}`, cliente_id: U, fecha_emision: f.fecha, subtotal: Math.round(f.total / 1.12 * 100) / 100, iva: Math.round((f.total - f.total / 1.12) * 100) / 100, total: f.total, estado: f.estado }));
  const { data: insF, error: eF } = await sb.from('facturas_clientes').insert(fx).select('id, no_factura');
  const fid = (n: string) => (insF ?? []).find(r => r.no_factura === `${PREFIJO}${n}`)?.id as string;
  const { error: eCob } = await sb.from('cobros_clientes').insert([{ factura_id: fid('010'), monto_cobrado: 400, monto_cobro_gtq: 400, fecha_cobro: d(-2), estado_cobro: 'Activo', metodo: 'Transferencia', estado: 'Pendiente' }, { factura_id: fid('011'), monto_cobrado: 1500, monto_cobro_gtq: 1500, fecha_cobro: d(-20), estado_cobro: 'Activo', metodo: 'Transferencia', estado: 'Pendiente' }]);
  const nf = (n: string) => `${PREFIJO}${n}`;
  const ev = (tipo: string, fecha: string, extra: Record<string, unknown>) => ({ cliente_id: U, tipo, origen: 'manual', fecha: `${fecha}T15:00:00.000Z`, creado_por: ACTOR, facturas: [], ...extra });
  const { error: eEv } = await sb.from('cobranza_evento').insert([
    ev('gestion', d(-2), { canal: 'llamada', resultado: 'promesa', comentario: 'Pagan hoy por transferencia', contacto_texto: 'Liseth', facturas: [nf('002')], proximo_seguimiento: d(1) }),
    ev('promesa', d(-2), { facturas: [nf('002')], monto: 2000, fecha_promesa: hoyR, promesa_estado: 'pendiente' }),
    ev('gestion', d(-1), { canal: 'correo', resultado: 'promesa', comentario: 'Prometen el viernes', facturas: [nf('003')], proximo_seguimiento: d(6) }),
    ev('promesa', d(-1), { facturas: [nf('003')], monto: 3000, fecha_promesa: d(5), promesa_estado: 'pendiente' }),
    ev('gestion', d(-10), { canal: 'whatsapp', resultado: 'promesa', comentario: 'Dijeron que pagaban la semana pasada', facturas: [nf('004')], proximo_seguimiento: d(-3), seguimiento_hecho_en: `${d(-3)}T12:00:00.000Z` }),
    ev('promesa', d(-10), { facturas: [nf('004')], monto: 4000, fecha_promesa: d(-4), promesa_estado: 'pendiente' }),
    ev('gestion', d(-3), { canal: 'llamada', resultado: 'disputa', comentario: 'No reconocen dos pruebas', disputa_motivo: 'cantidad de pruebas', facturas: [nf('005')], proximo_seguimiento: d(7) }),
    ev('gestion', d(-3), { canal: 'correo', resultado: 'pide_documentos', comentario: 'quieren la contraseña', contacto_texto: 'Liseth', facturas: [nf('006')], proximo_seguimiento: d(7) }),
    ev('gestion', d(-1), { canal: 'whatsapp', resultado: 'dice_que_pago', comentario: 'mandó boleta', facturas: [nf('007')], proximo_seguimiento: d(2) }),
    ev('gestion', d(-5), { canal: 'llamada', resultado: 'contactado', comentario: 'Llamar hoy a tesorería', facturas: [nf('008')], proximo_seguimiento: hoyR }),
    ev('gestion', d(-9), { canal: 'llamada', resultado: 'reprogramar', comentario: 'Llamen la otra semana', facturas: [nf('009')], proximo_seguimiento: d(-2) }),
    ev('gestion', d(-2), { canal: 'llamada', resultado: 'contactado', comentario: 'Pagaron 400, el resto a fin de mes', facturas: [nf('010')], proximo_seguimiento: d(15) }),
    ev('factura_emitida', '2025-11-13', { origen: 'automatico', comentario: `Factura ${nf('001')} emitida`, facturas: [nf('001')], monto: 1100, creado_por: 'sistema' }),
    ev('cambio_condicion', d(-30), { origen: 'automatico', comentario: 'Condiciones de cobro: diaPago', creado_por: 'sistema' }),   // general del cliente (sin facturas)
  ]);
  ok(!eCli && !eF && !eCob && !eEv && (insF ?? []).length === 11, `sembrado: cliente ${NIT} «FOGEL E2E» (nombre comercial «Refrigeración Fogel E2E», alias «Fogelito», 30 días de crédito), 11 facturas, 2 cobros, 14 eventos${[eCli, eF, eCob, eEv].filter(Boolean).map(e => ' · ' + e!.message).join('')}`);

  // A · buscar por cliente en todas las facturas
  const FB = await import('../src/lib/db/facturas-buscar');
  const buscar = (texto: string, extra: Record<string, unknown> = {}) => FB.buscarFacturas({ ...P.CRITERIOS_VACIOS, texto, ...extra });
  const r1 = await buscar('fogel'), r2 = await buscar('fogelito'), r3 = await buscar('refrigeracion fogel'), r4 = await buscar(NIT), r5 = await buscar('fogel', { estado: 'pendientes' }), r6 = await buscar('fogel', { desde: 2000, hasta: 3000 }), r7 = await buscar('fogel', { estado: 'pagadas' });
  const tiene = (r: typeof r1, n: string) => r.filas.some(f => f.noFactura === nf(n));
  ok(r1.cantidad >= 10 && tiene(r1, '001') && r1.filas.find(f => f.noFactura === nf('001'))?.fechaEmision === '2025-11-13' && tiene(r2, '001') && tiene(r3, '001') && tiene(r4, '001') && tiene(r1, '011'), `«fogel» con Enter encuentra la ${nf('001')} de nov-2025 aunque el mes sea otro (${r1.cantidad} facturas del cliente); también por alias («fogelito»), nombre comercial («refrigeracion fogel») y NIT`);
  ok(r5.cantidad === 9 && tiene(r5, '001') && !tiene(r5, '010') && !tiene(r5, '011') && r6.filas.map(f => f.noFactura).sort().join() === [nf('002'), nf('003')].join() && r7.filas.map(f => f.noFactura).join() === nf('011'), '«fogel» + estado pendientes (no pagadas, sin la parcial) → 9, con la 001; + rango 2000-3000 → la 002 y la 003; + pagadas → la 011 («COBRADO » con espacio)');

  // B/C · la cartera con seguimiento (una consulta de cobranza)
  const CF = await import('../src/lib/db/cobranza-facturas');
  const cart = await CF.getCarteraConSeguimiento();
  const mias = cart.filas.filter(f => f.custId === APP);
  const seg = (n: string) => mias.find(f => f.noFactura === nf(n))?.seguimiento;
  ok(mias.length === 10 && !mias.some(f => f.noFactura === nf('011')) && cart.consultasCobranza === 1 && !cart.error, `cartera abierta con seguimiento: 10 facturas del cliente (la cobrada queda fuera) · ${cart.filas.length} en total · UNA consulta de cobranza (${cart.ms.cobranza} ms; cartera ${cart.ms.cartera} ms; total ${cart.ms.total} ms)`);
  const ordenada = S.ordenarCartera(cart.filas, 'dias', 'desc');
  const idx001 = ordenada.findIndex(f => f.noFactura === nf('001'));
  ok(idx001 >= 0 && ordenada.every((f, i, a) => i === 0 || a[i - 1].diasVencidos >= f.diasVencidos) && ordenada.slice(0, idx001).every(f => f.diasVencidos >= ordenada[idx001].diasVencidos) && ordenada[idx001].diasVencidos > 300, `orden por días vencida sobre TODAS las abiertas (${ordenada.length}); la ${nf('001')} con ${ordenada[idx001]?.diasVencidos} días queda en la posición ${idx001 + 1}`);
  const esperado: Record<string, string> = { '001': 'sin_gestion', '002': 'paga_hoy', '003': 'promesa', '004': 'promesa_incumplida', '005': 'en_disputa', '006': 'pide_documentos', '007': 'dice_que_pago', '008': 'seguimiento_hoy', '009': 'seguimiento_atrasado', '010': '' };
  const obtenido = Object.fromEntries(Object.keys(esperado).map(n => [n, seg(n)?.badge?.clave ?? '']));
  ok(Object.entries(esperado).every(([n, c]) => obtenido[n] === c), `cada badge en su caso: ${Object.entries(obtenido).map(([n, c]) => `${n}=${c || '—'}`).join(' ')}`);
  const nota = seg('006')?.ultimaNota ? S.textoNota(seg('006')!.ultimaNota!, cart.hoy) : null;
  ok(!!nota && nota.corta === `${S.fechaCorta(d(-3), cart.hoy)} · Correo a Liseth: quieren la contraseña` && nota.completa.endsWith(`— ${ACTOR}`) && seg('003')?.badge?.texto === `Promesa ${S.fechaCorta(d(5), cart.hoy)}` && seg('010')?.estado.modificadores.includes('cobrada_parcial') === true, `última nota: «${nota?.corta}» con el autor en el title; «Promesa ${S.fechaCorta(d(5), cart.hoy)}»; la parcial lleva su modificador`);
  const chip = (f: Parameters<typeof S.pasaFiltroCobranza>[1]) => mias.filter(x => S.pasaFiltroCobranza(x.seguimiento, f, cart.hoy)).map(x => x.noFactura.slice(-3)).join(',');
  ok(chip('pagan_hoy') === '002' && chip('promesas_semana') === '002,003' && chip('promesas_incumplidas') === '004' && chip('seguimiento_hoy') === '008,009' && chip('vencidas_sin_gestion') === '001,009', `chips: pagan hoy ${chip('pagan_hoy')} · promesas esta semana ${chip('promesas_semana')} · incumplidas ${chip('promesas_incumplidas')} · seguimiento para hoy ${chip('seguimiento_hoy')} · vencidas sin gestión ${chip('vencidas_sin_gestion')} (la 009 lleva seguimiento atrasado y 9 días sin evento)`);
  ok(cart.kpiPromesas.n >= 2 && cart.kpiPromesas.monto >= 5000, `KPI promesas de esta semana: ${cart.kpiPromesas.n} · Q${cart.kpiPromesas.monto} (incluye las 2 del cliente: 2,000 hoy + 3,000 en 5 días)`);
  // paridad con la RPC 033 (estado y modificadores)
  let paridad = 0;
  for (const n of Object.keys(esperado)) {
    const { data } = await sb.rpc('cobranza_estado_factura', { p_no_factura: nf(n), p_hoy: cart.hoy });
    const r = (data ?? {}) as { estado: string; modificadores: string[] }; const s = seg(n)!.estado;
    if (r.estado === s.estado && [...(r.modificadores ?? [])].sort().join() === [...s.modificadores].sort().join()) paridad++;
  }
  ok(paridad === 10, `paridad TS = SQL (cobranza_estado_factura) en estado y modificadores: ${paridad}/10`);

  // D · la sección de la factura: solo sus eventos + los generales con el interruptor
  const { getFactura } = await import('../src/lib/db/facturas');
  const inv001 = await getFactura(`recCSE2E001`), inv006 = await getFactura(`recCSE2E006`), inv011 = await getFactura(`recCSE2E011`);
  const s001 = inv001 ? await CF.getSeguimientoFactura(inv001, inv001.balance) : null, s006 = inv006 ? await CF.getSeguimientoFactura(inv006, inv006.balance) : null, s011 = inv011 ? await CF.getSeguimientoFactura(inv011, 0) : null;
  ok(!!s001 && s001.eventosFactura.length === 1 && s001.eventosFactura[0].tipo === 'factura_emitida' && s001.eventosCliente.length === 1 && s001.eventosCliente[0].tipo === 'cambio_condicion' && s001.seguimiento.badge?.clave === 'sin_gestion' && s001.seguimiento.estado.diasVencida > 300 && s001.contactoPreferido?.nombre === 'Liseth Ramírez' && s001.responsable === ACTOR, `sección de la ${nf('001')}: solo su evento (factura emitida), el general del cliente aparte para el interruptor, badge sin gestión, ${s001?.seguimiento.estado.diasVencida} días, contacto preferido y responsable`);
  ok(!!s006 && s006.eventosFactura.length === 1 && s006.eventosFactura[0].resultado === 'pide_documentos' && s006.seguimiento.badge?.clave === 'pide_documentos' && s006.seguimiento.proximoSeguimiento === d(7) && !!s011 && s011.seguimiento.estado.cobrada && s011.seguimiento.badge === null, `sección de la ${nf('006')}: su gestión (pide documentos) y el próximo seguimiento; la cobrada ${nf('011')} no lleva badge (se muestra plegada)`);
  // registrar desde la factura: el MISMO registrarGestion con la factura incluida; sin seguimiento se rechaza
  const C = await import('../src/lib/db/cobranza');
  const sinSeg = await C.registrarGestion(APP, { canal: 'llamada', resultado: 'contactado', comentario: 'x', facturas: [nf('001')], proximoSeguimiento: '' }, ACTOR);
  const conProm = await C.registrarGestion(APP, { canal: 'llamada', resultado: 'promesa', comentario: 'Pagan hoy', facturas: [nf('001')], promesaMonto: 1100, promesaFecha: hoyR, proximoSeguimiento: d(1) }, ACTOR);
  const s001b = inv001 ? await CF.getSeguimientoFactura(inv001, inv001.balance) : null;
  ok(!sinSeg.ok && /próximo seguimiento es obligatoria/.test(sinSeg.ok ? '' : sinSeg.error) && conProm.ok && !!s001b && s001b.eventosFactura.some(e => e.tipo === 'gestion' && e.facturas.includes(nf('001'))) && s001b.eventosFactura.some(e => e.tipo === 'promesa' && e.fechaPromesa === hoyR) && s001b.seguimiento.badge?.clave === 'paga_hoy' && s001b.seguimiento.promesa?.monto === 1100, `registrar desde la factura: sin seguimiento se rechaza; con promesa para hoy crea gestión + promesa con la ${nf('001')} incluida y la sección pasa a «Paga hoy»`);
  const cart2 = await CF.getCarteraConSeguimiento();
  const f001 = cart2.filas.find(f => f.noFactura === nf('001'));
  ok(f001?.seguimiento.badge?.clave === 'paga_hoy' && S.pasaFiltroCobranza(f001!.seguimiento, 'pagan_hoy', cart2.hoy) && cart2.filas.filter(f => f.custId === APP && S.pasaFiltroCobranza(f.seguimiento, 'pagan_hoy', cart2.hoy)).length === 2, 'en la lista la 001 sale «Paga hoy» y entra en el chip «Pagan hoy» (con la 002)');
  const R = await import('../src/lib/auth/roles');
  ok(!R.puede('lectura', 'gestionar_cobranza') && !R.puede('auxiliar', 'gestionar_cobranza') && R.puede('lectura', 'ver') && R.puede('contador', 'gestionar_cobranza') && R.puede('cobranza', 'gestionar_cobranza') && R.puede('admin', 'gestionar_cobranza'), 'permisos: lectura y auxiliar ven la columna y la sección (ver) pero no tienen gestionar_cobranza; admin, contador y cobranza sí (la acción lo valida en el servidor)');

  if (CONSERVAR) {
    // para el E2E: la 001 vuelve a «sin gestión» (el E2E registra la promesa de hoy desde la página de la factura)
    const { data: nuevos } = await sb.from('cobranza_evento').select('id').eq('cliente_id', U).contains('facturas', [nf('001')]).in('tipo', ['gestion', 'promesa']);
    if (nuevos?.length) await sb.from('cobranza_evento').delete().in('id', nuevos.map(x => x.id as string));
    // los seguimientos que la gestión nueva marcó hechos vuelven a pendientes
    await sb.from('cobranza_evento').update({ seguimiento_hecho_en: null }).eq('cliente_id', U).eq('tipo', 'gestion').not('facturas', 'cs', `{${nf('004')}}`);
    const cart3 = await CF.getCarteraConSeguimiento();
    const b001 = cart3.filas.find(f => f.noFactura === nf('001'))?.seguimiento.badge?.clave;
    ok(b001 === 'sin_gestion', `--conservar: el cliente ${NIT} queda sembrado para el E2E (la ${nf('001')} otra vez «sin gestión»: ${b001})`);
  } else {
    ok((await limpiar()) === 0, 'limpieza: cliente de prueba borrado con facturas, cobros, eventos y contactos');
  }
  console.log(`\n${pass} 🟢 / ${fail} 🔴`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
