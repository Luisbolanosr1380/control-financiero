/**
 * DETALLE DIGITAL · PR 2 (029: aprobación por link + correo) — validador.
 *
 *  A. Estático: ruta pública en el middleware (y header para que el layout no cargue Clerk), cabeceras (no-store,
 *     no-referrer, noindex), endpoint solo POST / JSON / Origin / tope / sin CORS, token solo como hash, refs HMAC,
 *     página sin recursos externos, migración 029 (tablas, RPCs, revoke/grant, estado nuevo, check de la firma),
 *     acciones con permiso, correo sin nombres de candidatos en el asunto, "cobrada" (026) intacta.
 *  B. Puro: huella canónica, validación del envío del cliente, mensajes genéricos, correos armados, decisiones.
 *  C. E2E en HIT (datos sembrados): emitir link (token solo como hash; link vigente), abrir (no consume), responder
 *     con un componente de más / de menos → rechazado, firmar con una línea en corrección → rechazado, nota faltante
 *     → rechazada, todo aprobado → aprobada con canal link y huella; con observaciones → con_observaciones, quitar
 *     línea (recalcula, vuelve a la cola, diferida), respuesta de Golden, reenviar → versión 2 y link 1 revocado
 *     ("nueva versión"), link vencido / revocado / reusado → rechazado, rate limit, anon → denegado, correo en mock.
 *
 *  D. 031 · aperturas del link: creador_ip_hash al emitir; 6 aperturas desde dos «redes» + la de quien envió → 4 filas
 *     (recargas del mismo ip_hash + dispositivo en 10 min son una) y cuentan 3; abrir no consume ni cambia el estado;
 *     link inválido / revocado → no registra; `respondio` en la apertura previa a responder; anon sin la tabla ni la RPC.
 *
 * Uso: npx tsx --conditions=react-server scripts/validate-detalle-digital.ts hit [--conservar | --solo-limpiar]
 *      (SUPABASE_ANON_KEY en el entorno habilita la prueba con la llave pública)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { AperturaLink as AperturaLinkT } from '../src/lib/detalle-link/aperturas';

const BASE = (process.argv[2] ?? 'hit').toLowerCase();
if (BASE !== 'hit') { console.error('Este validador siembra datos: solo corre contra HIT.'); process.exit(2); }
const CONSERVAR = process.argv.includes('--conservar'), SOLO_LIMPIAR = process.argv.includes('--solo-limpiar');
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.hit.vercel'), 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const [k, ...r] = t.split('='); process.env[k.trim()] = r.join('=').trim().replace(/^"|"$/g, '');
}
process.env.DETALLE_LINK_SECRET ||= 'secreto-de-prueba-del-validador-0123456789';
process.env.CORREO_MOCK = '1';
process.env.FACTURACION_AVISO_CORREO ||= 'facturacion-aviso@df-e2e.example';
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log(`  🟢 ${m}`); } else { fail++; console.log(`  🔴 ${m}`); } };
const rd = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export const NIT = '99990032K', EMPRESA = 'recDDE2E01', PREFIJO = 'ddE2E';
const PNG = 'data:image/png;base64,' + Buffer.from('x'.repeat(400)).toString('base64');

(async () => {
  /* ───────────── A. Estático ───────────── */
  console.log('\nA. Estático: ruta pública, endpoint, migración, acciones');
  const mw = rd('src/middleware.ts'), lay = rd('src/app/layout.tsx'), cfg = rd('next.config.mjs'), api = rd('src/app/api/aprobar-detalle/route.ts'), pag = rd('src/app/aprobar-detalle/page.tsx'), cli = rd('src/components/aprobar-detalle/aprobar-detalle-client.tsx');
  const tok = rd('src/lib/detalle-link/token.ts'), dbl = rd('src/lib/db/detalle-link.ts'), m29 = rd('supabase/migrations/029_detalle_aprobacion_digital.sql'), sin29 = m29.replace(/--.*$/gm, '');
  ok(/isRutaPublicaCliente = createRouteMatcher\(\['\/aprobar-detalle\(\.\*\)', '\/api\/aprobar-detalle\(\.\*\)'\]\)/.test(mw) && /if \(isRutaPublicaCliente\(req\)\) \{\n    const h = new Headers\(req\.headers\); h\.set\('x-ruta-publica', '1'\);\n    return NextResponse\.next/.test(mw) && /return conClerk\(req, ev\);/.test(mw), 'middleware: /aprobar-detalle y /api/aprobar-detalle no pasan por Clerk (sin handshake ni cookies: ningún tercero) y se marcan con un header para el layout; todo lo demás sigue igual');
  ok(/\(await headers\(\)\)\.get\('x-ruta-publica'\) === '1'/.test(lay) && /publica \? html : <ClerkProvider/.test(lay) && /\{!publica && <RegistroSW \/>\}/.test(lay), 'layout raíz: la página pública va sin ClerkProvider ni service worker (sin scripts de terceros); fuentes de next/font (mismo dominio)');
  ok(/source: '\/aprobar-detalle\(\.\*\)'/.test(cfg) && /'Referrer-Policy', value: 'no-referrer'/.test(cfg) && /'Cache-Control', value: 'no-store'/.test(cfg) && /'X-Robots-Tag', value: 'noindex, nofollow, noarchive'/.test(cfg) && /'X-Frame-Options', value: 'DENY'/.test(cfg), 'cabeceras: Cache-Control no-store, Referrer-Policy no-referrer, X-Robots-Tag noindex, X-Frame-Options DENY en la página y el endpoint');
  ok(/robots: \{ index: false, follow: false/.test(pag) && /window\.location\.hash/.test(cli) && !/history\.replaceState/.test(cli) && !/https?:\/\/(?!api\.resend)/.test(cli) && !/<script|<link|@import|url\(/.test(cli) && !/<img[^>]*src=["'`]https?:/.test(cli) && /referrerPolicy: 'no-referrer'/.test(cli) && /credentials: 'omit'/.test(cli), 'página pública: noindex, el token va en el fragmento (#) y SE QUEDA en la barra (recargar o volver días después no rompe el link), sin recursos externos (ni fuentes, scripts ni imágenes de terceros; el logo es del mismo dominio), fetch sin referer ni cookies');
  ok(/export async function POST/.test(api) && /export function GET\(\) \{ return responder\(\{ error: 'Método no permitido\.' \}, 405\); \}/.test(api) && /export function OPTIONS/.test(api) && !/Access-Control-Allow/.test(api) && /application\\\/json/.test(api) && /origenPropio\(req\)/.test(api) && /TOPE_CUERPO = 300 \* 1024/.test(api) && /empresa_web/.test(api) && /dentroDelLimite\(`abrir:ip:\$\{ip\}`, 30, 60\)/.test(api) && /dentroDelLimite\(`responder:ip:\$\{ip\}`, 10, 60\)/.test(api) && /dentroDelLimite\(`responder:token:\$\{tokenClave\}`, 5, 60\)/.test(api) && !/console\.log\(.*token/.test(api), 'endpoint: solo POST (GET 405, OPTIONS 405), content-type JSON, Origin propio, tope de 300 KB, honeypot, rate limit por IP (abrir 30/min, responder 10/min) y por token (5/min), sin CORS, sin loguear el token');
  ok(/randomBytes\(32\)\.toString\('base64url'\)/.test(tok) && /createHash\('sha256'\)\.update\(token/.test(tok) && /createHmac\('sha256', secreto\)\.update\(`\$\{tokenHash\}\|\$\{componenteId\}`/.test(tok) && /env\.DETALLE_LINK_SECRET/.test(tok) && /^import 'server-only';/m.test(tok) && !/WEBHOOK_SECRET|CLERK|SUPABASE/.test(tok), 'token: 32 bytes base64url; solo el sha256 va a la base; refs HMAC-SHA256 con DETALLE_LINK_SECRET (propio, solo servidor, sin reusar otros secretos)');
  ok(/p_token_hash: hashToken\(token\)/.test(dbl) && !/token_hash: token\b/.test(dbl) && /\/aprobar-detalle#\$\{token\}/.test(dbl) && /recalculada !== a\.huella/.test(dbl) && /mapaRefs\.get\(r\.ref\)/.test(dbl) && !/console\.(log|error)\([^)]*\btoken\b/.test(dbl), 'db: el token en claro solo vuelve en la URL (#fragmento) para el correo; la huella se recalcula desde la base al abrir; refs → componente desde el mapa del servidor; nada del token en logs');
  ok(/create table if not exists detalle_facturacion_link/.test(m29) && /token_hash\s+text not null unique/.test(m29) && /create table if not exists detalle_facturacion_respuesta/.test(m29) && /unique \(detalle_id, version, componente_id\)/.test(m29) && /create table if not exists detalle_facturacion_envio/.test(m29) && /create table if not exists detalle_link_intento/.test(m29) && /add column if not exists diferida_hasta date/.test(m29) && /'con_observaciones'/.test(m29) && /firma_png is null or \(length\(firma_png\) <= 280000 and firma_png like 'data:image\/png;base64,%'\)/.test(m29), '029: tablas link (token_hash unique) / respuesta (una por línea y versión) / envío / intento, diferida_hasta, estado con_observaciones, firma ≤ 200 KB PNG');
  ok(/create or replace function detalle_facturacion_quitar_linea\(p_actor text, p_detalle_id uuid, p_componente_id uuid, p_motivo text default null, p_diferir_hasta date default null\)/.test(m29) && /create or replace function detalle_link_responder\(p_token_hash text, p_respuestas jsonb, p_firma jsonb default null, p_ip text default null, p_user_agent text default null, p_documento_hash text default null\)/.test(m29) && /v_link\.version < v_row\.version then raise exception 'LINK_NUEVA_VERSION'/.test(m29) && /v_n_resp <> v_n_lineas or v_n_distintas <> v_n_lineas or v_n_fuera > 0/.test(m29) && /NOTA_OBLIGATORIA/.test(m29) && /if v_todas then\n    -- solo se firma con todo aprobado/.test(m29) && /delete from detalle_link_intento where ventana < now\(\) - interval '1 day'/.test(m29), '029 RPCs: quitar línea (borrador / con_observaciones, recalcula, diferida), responder valida link vigente + versión actual + cobertura exacta + notas + firma solo con todo aprobado; rate limit con purga');
  const rpcs = ['detalle_link_rate_limit', 'detalle_facturacion_recalcular', 'detalle_facturacion_quitar_linea', 'detalle_link_emitir', 'detalle_link_revocar', 'detalle_link_contenido', 'detalle_link_abrir', 'detalle_link_responder'];
  ok(rpcs.every(f => new RegExp(`revoke all on function ${f}\\(`).test(m29) && new RegExp(`grant execute on function ${f}\\(`).test(m29)) && (m29.match(/enable row level security/g) ?? []).length === 4 && !/\bdrop\s+(table|function)\b/i.test(sin29) && !/\bdelete\s+from\s+(?!detalle_link_intento)/i.test(sin29) && !/^\s*(begin|commit)\s*;/im.test(sin29), '029: execute revocado a public/anon/authenticated y dado a service_role en las 8 funciones; RLS en las 4 tablas; sin drop de tablas/funciones, sin delete (salvo la purga del rate limit), sin commit');
  ok(!/facturas_clientes|COBRAD|facturacion_factura_cobrada/.test(sin29.replace(/'cobrada'/g, '')) && !/facturacion_componente_en_cola|facturacion_agenda_cobro_pendiente/.test(sin29), '029: no toca "cobrada" (026) ni la regla SQL de la cola ("diferida" es solo marca)');
  const acts = rd('src/app/(app)/por-facturar/actions.ts'), perm = rd('scripts/validate-permisos.ts');
  ok(['enviarDetalleAction', 'revocarLinkDetalleAction', 'quitarLineaDetalleAction', 'responderNotaDetalleAction'].every(a => new RegExp(`export async function ${a}\\([\\s\\S]*?\\{\\n  const permiso = await autorizar\\('facturar_agenda'\\);`).test(acts) && new RegExp(`${a}: 'facturar_agenda'`).test(perm)), 'acciones nuevas (enviar, revocar link, quitar línea, responder nota): permiso facturar_agenda en la primera línea y en el validador de permisos');
  const corr = rd('src/lib/detalle-link/correo.ts'), res = rd('src/lib/correo/resend.ts');
  ok(/asuntoEnvio\(correlativo: string, emisor: string/.test(corr) && !/persona|candidato/i.test(corr.split('export function asuntoEnvio')[1].split('}')[0]) && /env\.RESEND_API_KEY/.test(res) && /'facturacion@golden-talent\.com'/.test(res) && /api\.resend\.com\/emails/.test(res) && /CORREO_MOCK/.test(res) && /^import 'server-only';/m.test(res) && !/resend"/.test(rd('package.json')), 'correo: asunto sin nombres de candidatos; Resend por REST con RESEND_API_KEY solo en el servidor (sin dependencia nueva), from facturacion@golden-talent.com, modo mock para pruebas');
  const dv = rd('src/components/por-facturar/detalle-view.tsx');
  ok(/data-accion="enviar-cliente"/.test(dv) && /Enviar versión corregida/.test(dv) && /data-accion="revocar-link"/.test(dv) && /data-accion="quitar-linea"/.test(dv) && /data-campo="respuesta-golden"/.test(dv) && /data-accion="re-resolver"/.test(dv) && /data-campo="diferir"/.test(dv) && /data-texto-copiar/.test(dv) && /data-sin-correo/.test(dv) && !/window\.(confirm|alert|prompt)/.test(dv + cli), 'Finanzas: Enviar al cliente / versión corregida, revocar link, quitar línea (con diferir), respuesta de Golden, re-resolver, copiar link sin correo; sin diálogos del navegador');
  ok(/data-firma-digital/.test(rd('src/components/por-facturar/detalle-imprimible.tsx')) && /Aprobado digitalmente por/.test(rd('src/components/por-facturar/detalle-imprimible.tsx')) && /data-marcada=/.test(rd('src/components/por-facturar/detalle-imprimible.tsx')) && /con_observaciones/.test(rd('src/components/por-facturar/por-facturar-client.tsx')) && /data-kpi-diferidas/.test(rd('src/components/por-facturar/grupo-detalle.tsx')) && /\.table th\.col-precio, \.table td\.col-precio \{ min-width: 118px/.test(rd('src/app/globals.css')), 'imprimible con firma digital y casillas marcadas; tablero con "Respuestas del cliente"; diferidas en el cliente; fix de la columna de precio (col-precio)');

  // ── 031: aperturas del link ──
  const m31 = rd('supabase/migrations/031_link_aperturas.sql'), sin31 = m31.replace(/--.*$/gm, ''), ap = rd('src/lib/detalle-link/aperturas.ts'), pfc = rd('src/components/por-facturar/por-facturar-client.tsx'), pfp = rd('src/app/(app)/por-facturar/page.tsx');
  ok(/create table if not exists detalle_facturacion_link_apertura/.test(m31) && /add column if not exists creador_ip_hash text/.test(m31) && /check \(dispositivo in \('movil', 'escritorio', 'tablet', 'desconocido'\)\)/.test(m31) && /interval '10 minutes'/.test(m31) && /alter table detalle_facturacion_link_apertura enable row level security/.test(m31) && /revoke all on table detalle_facturacion_link_apertura from public, anon, authenticated/.test(m31) && !/\bdrop\s+(table|function)\b/i.test(sin31) && !/\bdelete\s+from\b/i.test(sin31) && !/^\s*(begin|commit)\s*;/im.test(sin31), '031: tabla de aperturas (RLS, sin anon ni authenticated), creador_ip_hash en el link, recargas a 10 minutos; sin drop / delete / begin / commit');
  ok(/create or replace function detalle_link_abrir\(p_token_hash text, p_ip_hash text, p_dispositivo text, p_navegador text\)/.test(m31) && /create or replace function detalle_link_emitir\(p_actor text, p_detalle_id uuid, p_token_hash text, p_documento_hash text, p_destinatarios text\[\], p_dias integer, p_creador_ip_hash text\)/.test(m31) && ['detalle_link_abrir(text, text, text, text)', 'detalle_link_abrir(text)', 'detalle_link_emitir(text, uuid, text, text, text[], integer, text)', 'detalle_link_emitir(text, uuid, text, text, text[], integer)'].every(f => m31.includes(`revoke all on function ${f} from public, anon, authenticated`) && m31.includes(`grant execute on function ${f} to service_role`)), '031: abrir / emitir nuevos sin defaults (ninguna llamada con nombres es ambigua) y los de la 029 quedan como envoltorios; revoke / grant en los cuatro');
  ok(/if v_link\.usado_en is not null then\n\s+v_estado := 'respondido';/.test(m31) && /if v_link\.abierto_en is null then update detalle_facturacion_link set abierto_en = now\(\)/.test(m31) && !/usado_en = now\(\)/.test(m31) && /return jsonb_build_object\('estado', 'nueva_version'\)/.test(m31) && /left\(p_ip_hash, 16\)/.test(m31) && /left\(p_navegador, 40\)/.test(m31), '031: abrir sigue sin consumir el link ni cambiar el estado; abierto_en del link sigue siendo la primera apertura; inválido / nueva versión salen antes de registrar; solo hash de red y familia de navegador');
  ok(/update ayuda/.test(m31) && /\*\*Abierto\*\* = alguien abrió el link \(puede ser un antivirus del correo\); no confirma quién lo leyó/.test(m31) && /contenido not like '%\*\*Abierto\*\* = alguien abrió el link%'/.test(m31), '031: la ayuda del detalle recibe la línea «Abierto = alguien abrió el link (puede ser un antivirus del correo); no confirma quién lo leyó» (idempotente)');
  ok(/export function hashIp/.test(tok) && /createHash\('sha256'\)\.update\(`\$\{v\}\|\$\{secreto\}`/.test(tok) && /\.slice\(0, 16\)/.test(tok) && /p_creador_ip_hash: hashIp\(input\.ip\)/.test(dbl) && /p_ip_hash: hashIp\(meta\?\.ip\), p_dispositivo: meta \? ua\.dispositivo : null, p_navegador: meta \? ua\.navegador : null/.test(dbl) && /clasificarUserAgent\(meta\?\.userAgent\)/.test(dbl) && !/from 'node:|from "node:|server-only/.test(ap) && !/ip_hash|ipHash/.test(cli), '031: ip_hash = sha256(ip + DETALLE_LINK_SECRET) truncado a 16 (token.ts, solo servidor); dispositivo / navegador se derivan en el servidor; el módulo puro no importa node; nada de esto llega a la página del cliente');
  ok(/x-forwarded-for/.test(acts) && /emitirLinkDetalle\(id, \{ email: permiso\.email, nombre: permiso\.nombre \}, \{ \.\.\.input, baseUrl: await baseUrlPublica\(\), ip \}\)/.test(acts) && /abrirLinkPublico\(token, \{ ip, userAgent/.test(api) && /abrirLinkPublico\(envio\.token, meta\)/.test(dbl) && /marcarAperturaRespondio\(/.test(dbl), '031: Enviar al cliente / Copiar link guardan el hash de la red de quien envía; el endpoint pasa ip + user agent al abrir y al responder (la apertura previa queda `respondio`)');
  ok(/data-aperturas=\{r\.n\}/.test(dv) && /textoAperturas\(r, formatearFechaCompacta\)/.test(dv) && /data-accion="ver-aperturas"/.test(dv) && /data-lista-aperturas/.test(dv) && /ETIQUETA_MARCA_RED\[marca\]/.test(dv) && /data-bitacora-fila="apertura"/.test(dv) && /Abierto = alguien abrió el link \(puede ser un antivirus del correo\); no confirma quién lo leyó/.test(dv) && /data-visto=\{b\.visto \? 'si' : 'no'\}/.test(pfc) && /badgeVisto\(aperturas\[d\.id\], d\.enviadaEn/.test(pfc) && /resumenAperturasPorDetalle\(detallesLista\.filter\(d => d\.estado === 'enviada'\)/.test(pfp) && !/window\.(confirm|alert|prompt)/.test(dv + pfc), '031 Finanzas: «Abierto N veces · primera · última · dispositivos» / «Sin abrir» junto a Enviado con la lista desplegable (red marcada), aperturas en la bitácora junto a los envíos, Visto / Sin abrir en los enviados de la lista; la pantalla dice «abierto», nunca «leído»');

  /* ───────────── B. Puro ───────────── */
  console.log('\nB. Puro');
  const DOC = await import('../src/lib/detalle-link/documento');
  const PUB = await import('../src/lib/detalle-link/publico');
  const COR = await import('../src/lib/detalle-link/correo');
  const base = { correlativo: 'DET-0001', version: 1, nit: '1', lineas: [{ componenteId: 'b', persona: 'B', servicio: 'POLIGRAFO', categoria: 'RUTINA', territorio: 'Metro', monto: 350 }, { componenteId: 'a', persona: 'A', servicio: 'SOCIOECONOMICO', categoria: 'PRE EMPLEO', territorio: 'Depto', monto: 400.004 }], subtotal: 750, iva: 90, total: 840 };
  const h1 = DOC.hashDocumento(base);
  ok(h1.length === 64 && DOC.hashDocumento({ ...base, lineas: [base.lineas[1], base.lineas[0]] }) === h1 && DOC.hashDocumento({ ...base, lineas: [{ ...base.lineas[1], monto: 400 }, base.lineas[0]] }) === h1 && DOC.hashDocumento({ ...base, version: 2 }) !== h1 && DOC.hashDocumento({ ...base, total: 841 }) !== h1 && DOC.canonicoDocumento(base).startsWith('{"correlativo":"DET-0001","version":1,"nit":"1","lineas":[{"componenteId":"a"'), 'huella: canónica (orden de líneas y redondeo no la cambian; versión o total sí); sha256');
  ok(PUB.huellaCorta('a1b2c3d4e5f6789') === 'A1B2 C3D4 E5F6' && PUB.huellaCorta(null) === '', 'huella corta para mostrar (publico.ts, sin crypto: va al navegador)');
  const envioOk = { token: 'A'.repeat(43), respuestas: [{ ref: 'r'.repeat(22), decision: 'aprobado', nota: '' }], firma: { nombre: 'Ana', cargo: 'Gerente', correo: 'ana@cliente.com', autoriza: true, png: PNG } };
  ok(PUB.validarEnvioCliente(envioOk).ok && !PUB.validarEnvioCliente({ ...envioOk, token: 'corto' }).ok && !PUB.validarEnvioCliente({ ...envioOk, respuestas: [] }).ok && !PUB.validarEnvioCliente({ ...envioOk, respuestas: [{ ref: 'r'.repeat(22), decision: 'raro', nota: '' }] }).ok && !PUB.validarEnvioCliente({ ...envioOk, respuestas: [{ ref: 'r'.repeat(22), decision: 'correccion', nota: 'x' }] }).ok && PUB.validarEnvioCliente({ ...envioOk, respuestas: [{ ref: 'r'.repeat(22), decision: 'correccion', nota: 'precio mal' }], firma: null }).ok, 'validarEnvioCliente: token, refs, decisiones y notas obligatorias (≥ 3) en lo no aprobado');
  ok(!PUB.validarEnvioCliente({ ...envioOk, firma: { ...envioOk.firma, autoriza: false } }).ok && !PUB.validarEnvioCliente({ ...envioOk, firma: { ...envioOk.firma, correo: 'no-es-correo' } }).ok && !PUB.validarEnvioCliente({ ...envioOk, firma: { ...envioOk.firma, png: 'data:image/jpeg;base64,xx' } }).ok && !PUB.validarEnvioCliente({ ...envioOk, firma: { ...envioOk.firma, png: 'data:image/png;base64,' + 'A'.repeat(210 * 1024) } }).ok && !PUB.validarEnvioCliente({ ...envioOk, respuestas: [envioOk.respuestas[0], envioOk.respuestas[0]] }).ok, 'firma: casilla, correo válido, PNG data URL ≤ 200 KB; refs repetidas → rechazo');
  ok(PUB.mensajePublico('LINK_NUEVA_VERSION') === 'Hay una versión más nueva de este detalle, revisá tu correo.' && PUB.mensajePublico('cualquier cosa interna') === 'Este link ya no es válido.' && PUB.mensajePublico('NOTA_OBLIGATORIA: 2') === 'Falta el motivo en una línea que no está aprobada.' && !PUB.mensajePublico('RESPUESTAS_NO_CUBREN: 3 respuestas para 4 líneas (1 fuera)').includes('4'), 'mensajes genéricos al cliente (nunca el error interno)');
  const ce = COR.correoEnvio({ correlativo: 'DET-0123', version: 2, cliente: 'ACME', emisor: 'Golden Talent', titulo: 'Polígrafos rutina', dirigidoA: 'Ana', pruebas: 12, total: 4704, link: 'https://x/aprobar-detalle#tok', expiraEn: '2026-12-04T12:00:00Z', mensaje: 'Hola <b>', remitenteNombre: 'Luis' });
  ok(/^Detalle de servicios DET-0123 · Golden Talent · \w{3} \d{4}$/.test(ce.asunto) && /Versión 2 · corregida/.test(ce.html) && /Revisar y aprobar/.test(ce.html) && /Hola &lt;b&gt;/.test(ce.html) && !/<img|<script|<link/.test(ce.html) && /Q4,704\.00/.test(ce.html) && /vence el/.test(ce.texto), 'correo de envío: asunto "Detalle de servicios DET-0123 · Golden Talent · <mes>", HTML sobrio sin recursos externos, texto escapado, versión corregida, vencimiento');
  const ca = COR.correoAviso({ correlativo: 'DET-0123', cliente: 'ACME', estado: 'con_observaciones', observaciones: 3, nombre: 'Ana', cargo: 'Gerente', respondidoEn: '2026-11-04T15:00:00Z', linkFinanzas: 'https://x/por-facturar/detalle/1', total: 4704, version: 1 });
  ok(ca.asunto === 'DET-0123 · ACME mandó 3 observaciones' && COR.asuntoAviso('DET-1', 'ACME', 'aprobada', 0) === 'DET-1 · ACME aprobó y firmó el detalle' && /Abrir el detalle en Finanzas/.test(ca.html), `aviso de vuelta: "aprobó y firmó" / "mandó N observaciones" con el link al detalle en Finanzas (asunto: "${ca.asunto}")`);
  ok(PUB.etiquetaResultadoPublico('POLIGRAFO', 'APROBO') === 'Polígrafo — aprobo' && PUB.exigeNota('proximo_mes') && !PUB.exigeNota('aprobado') && PUB.DECISIONES.length === 4, 'decisiones y etiquetas públicas');

  // ── 031: clasificación del user agent, resumen, marcas de red, textos ──
  const AP = await import('../src/lib/detalle-link/aperturas');
  const uaChromeMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  const uaIphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const uaIpad = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const uaEdgeWin = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
  const uaOutlook = 'Mozilla/4.0 (compatible; ms-office; MSOffice 16)';
  const uaAndroid = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
  const uaBot = 'Mozilla/5.0 (compatible; Proofpoint URL Defense scanner)';
  const cua = AP.clasificarUserAgent;
  ok(JSON.stringify(cua(uaChromeMac)) === '{"dispositivo":"escritorio","navegador":"Chrome"}' && JSON.stringify(cua(uaIphone)) === '{"dispositivo":"movil","navegador":"Safari"}' && cua(uaIpad).dispositivo === 'tablet' && cua(uaEdgeWin).navegador === 'Edge' && cua(uaOutlook).navegador === 'Outlook' && JSON.stringify(cua(uaAndroid)) === '{"dispositivo":"movil","navegador":"Chrome"}' && cua(uaBot).navegador === 'robot / antivirus' && cua('').dispositivo === 'desconocido' && cua(null).navegador === 'desconocido', 'clasificarUserAgent: Chrome/Mac escritorio, iPhone Safari móvil, iPad tablet, Edge, Outlook, Android Chrome móvil, robot / antivirus, vacío → desconocido (nunca el user agent completo)');
  const mkAp = (id: string, iso: string, ip: string | null, disp: AperturaLinkT['dispositivo'] = 'escritorio', nav = 'Chrome', respondio = false): AperturaLinkT => ({ id, linkId: 'L', version: 1, abiertoEn: iso, dispositivo: disp, navegador: nav, ipHash: ip, respondio });
  const aps = [mkAp('1', '2026-11-04T19:20:00Z', 'golden'), mkAp('2', '2026-11-05T15:12:00Z', 'cliA', 'movil', 'Safari'), mkAp('3', '2026-11-04T19:40:00Z', 'cliA'), mkAp('4', '2026-11-05T16:00:00Z', 'cliB', 'escritorio', 'Edge', true)];
  const rAp = AP.resumenAperturas(aps, 'golden');
  ok(rAp.n === 3 && rAp.propias === 1 && rAp.primera === '2026-11-04T19:40:00Z' && rAp.ultima === '2026-11-05T16:00:00Z' && rAp.dispositivos === 3 && rAp.respondio && AP.resumenAperturas(aps, null).n === 4 && AP.resumenAperturas([], 'x').n === 0, 'resumenAperturas: 4 aperturas, 1 desde la red de quien envió → cuentan 3; primera / última sin la propia; 3 dispositivos; respondió');
  ok(AP.marcaRed(aps[0], aps, 'golden') === 'creador' && AP.marcaRed(aps[2], aps, 'golden') === 'primera' && AP.marcaRed(aps[1], aps, 'golden') === 'misma_red' && AP.marcaRed(aps[3], aps, 'golden') === 'otra_red' && AP.marcaRed(aps[0], aps, null) === 'primera', 'marcaRed: «desde la red de quien envió» / «primera apertura» / «misma red que la primera» / «otra red»');
  const fmtAp = (iso: string) => iso.slice(5, 16);
  ok(AP.textoAperturas(rAp, fmtAp) === 'Abierto 3 veces · primera 11-04T19:40 · última 11-05T16:00 · 3 dispositivos' && AP.textoAperturas(AP.resumenAperturas([aps[2]], 'golden'), fmtAp) === 'Abierto 1 vez · 11-04T19:40' && AP.textoAperturas(AP.resumenAperturas([aps[0]], 'golden'), fmtAp) === 'Sin abrir (1 apertura desde la red de quien envió)' && AP.textoAperturas(AP.resumenAperturas([], null), fmtAp) === 'Sin abrir', 'textoAperturas: «Abierto 3 veces · primera … · última … · 3 dispositivos», «Abierto 1 vez · …», «Sin abrir (1 apertura desde la red de quien envió)», «Sin abrir»');
  const ahoraAp = Date.parse('2026-11-08T12:00:00Z');
  const bv1 = AP.badgeVisto(undefined, '2026-11-05T12:00:00Z', fmtAp, ahoraAp), bv2 = AP.badgeVisto(rAp, '2026-11-05T12:00:00Z', fmtAp, ahoraAp), bv3 = AP.badgeVisto(AP.resumenAperturas([aps[0]], 'golden'), '2026-11-08T09:00:00Z', fmtAp, ahoraAp);
  ok(!bv1.visto && bv1.texto === 'Sin abrir' && bv1.title === 'Enviado hace 3 días y sin abrir: hay que llamar' && bv2.visto && bv2.texto === 'Visto' && /^Abierto 3 veces/.test(bv2.title) && /enviado hace 3 días$/.test(bv2.title) && bv3.title === 'Enviado hoy y sin abrir (1 desde la red de quien envió)', 'badgeVisto: «Sin abrir» con "Enviado hace 3 días y sin abrir: hay que llamar"; «Visto» con el resumen en el title; las propias se mencionan aparte');

  /* ───────────── C. E2E en HIT ───────────── */
  console.log(`\nC. E2E en HIT${CONSERVAR ? ' (--conservar)' : SOLO_LIMPIAR ? ' (--solo-limpiar)' : ''}`);
  const { supabase } = await import('../src/lib/supabase/client');
  const sb = supabase()!;
  const limpiar = async () => {
    const { data: exps } = await sb.from('facturacion_expediente').select('id').like('id_externo', `${PREFIJO}%`);
    const ids = (exps ?? []).map(e => e.id as string);
    // primero las pruebas (una aprobada / facturada conserva detalle_id y la FK impediría borrar el detalle), después los detalles
    if (ids.length) { await sb.from('facturacion_componente').delete().in('expediente_id', ids); await sb.from('facturacion_expediente').delete().in('id', ids); }
    const { error: eDel } = await sb.from('detalle_facturacion').delete().eq('nit', NIT);   // links, respuestas, envíos y aperturas van en cascada
    if (eDel) console.error('  limpiar detalles:', eDel.message);
    await sb.from('cliente_externo').delete().eq('nit', NIT);
    await sb.from('clientes').delete().eq('nit', NIT);
    await sb.from('detalle_link_intento').delete().like('clave', '%e2e%');
    const { count } = await sb.from('facturacion_expediente').select('id', { count: 'exact', head: true }).like('id_externo', `${PREFIJO}%`);
    const { count: nDet } = await sb.from('detalle_facturacion').select('id', { count: 'exact', head: true }).eq('nit', NIT);
    return (count ?? 0) + (nDet ?? 0);
  };
  if (SOLO_LIMPIAR) { ok((await limpiar()) === 0, 'limpieza: 0 expedientes ddE2E y 0 detalles del NIT de prueba (con links, respuestas, envíos y aperturas), mapeo y cliente borrados'); console.log(`\n${pass} 🟢 / ${fail} 🔴`); process.exit(fail ? 1 : 0); }
  await limpiar();
  const { data: cliRow } = await sb.from('clientes').insert({ airtable_id: 'sbwDDE2E01', nombre_empresa: 'DD E2E APROBACION', razon_social: 'DD E2E APROBACION, S.A.', nit: NIT, activo: true, email_cobros: 'cobros@dd-e2e.example', correo_cobro: 'rrhh@dd-e2e.example' }).select('id').single();
  await sb.from('cliente_externo').insert({ fuente: 'agenda', empresa_id_externo: EMPRESA, empresa_nombre_externo: 'DD E2E APROBACION', nit: NIT, cliente_id: cliRow?.id ?? null, activo: true, creado_por: 'e2e' });
  const seeds = [['Ana Prueba', 'POLIGRAFO', 'RUTINA', 350], ['Beto Prueba', 'POLIGRAFO', 'PRE EMPLEO', 350], ['Caro Prueba', 'SOCIOECONOMICO', 'PRE EMPLEO', 400], ['Dani Prueba', 'POLIGRAFO', 'RUTINA', 350], ['Eli Prueba', 'INFORNET', null, 50], ['Fer Prueba', 'POLIGRAFO', 'RUTINA', 350]] as const;
  const exps = seeds.map((s, i) => ({ fuente: 'agenda', id_externo: `${PREFIJO}${String(i + 1).padStart(3, '0')}`, empresa_id_externo: EMPRESA, empresa_nombre_externo: 'DD E2E APROBACION', nit_resuelto: NIT, cliente_id: cliRow?.id ?? null, persona: s[0], puesto: 'Puesto', solicitante: 'MARTA SOLICITA', tipo_prueba: s[1], categoria_prueba: s[2], proceso_solicitado: `SOLO ${s[1]}`, depto_visita: 'GUATEMALA', fecha_ingreso: '2026-10-05', fecha_entrega: '2026-10-20', status_proceso: 'APROBO', terminado: true, cancelado: false, eliminado: false, estado_tarifa: 'resuelta', monto_calculado: s[3], status_cobro_externo: 'PENDIENTE', actualizado_en_externo: '2026-10-21T12:00:00.000Z' }));
  const { data: insExps, error: eExp } = await sb.from('facturacion_expediente').insert(exps).select('id, id_externo');
  const idPorExt = new Map((insExps ?? []).map(e => [e.id_externo as string, e.id as string]));
  const { data: comps, error: eComp } = await sb.from('facturacion_componente').insert(seeds.map((s, i) => ({ fuente: 'agenda', expediente_id: idPorExt.get(`${PREFIJO}${String(i + 1).padStart(3, '0')}`), id_externo: `${PREFIJO}${String(i + 1).padStart(3, '0')}`, servicio: s[1], estado_prueba: 'APROBO', situacion: 'cobra', motivo: 'E2E', categoria: s[2], territorio: s[2] ? 'METROPOLITANA' : null, monto_calculado: s[3], estado_tarifa: 'resuelta', fecha_resultado: '2026-10-15T15:00:00.000Z', fecha_resultado_fuente: 'agenda' }))).select('id, id_externo');
  ok(!eExp && !eComp && (comps ?? []).length === 6, `sembrado: cliente ${NIT} (2 correos), 6 pruebas cobrables${eExp ? ' · ' + eExp.message : ''}${eComp ? ' · ' + eComp.message : ''}`);
  const DB = await import('../src/lib/db/detalle-facturacion');
  const DL = await import('../src/lib/db/detalle-link');
  const RES = await import('../src/lib/correo/resend');
  const ids = (comps ?? []).map(c => c.id as string);
  // Detalle 1: 5 pruebas (una queda libre para probar "componente de más")
  const d1 = await DB.crearDetalle({ componenteIds: ids.slice(0, 5), titulo: 'Polígrafos y socios · Oct 2026', dirigidoA: 'Marta Solicita' }, 'e2e@test');
  ok(d1.ok && d1.detalle.pruebas === 5 && d1.detalle.version === 1, `detalle 1 creado (${d1.ok ? d1.detalle.correlativo : d1.error}) · versión 1`);
  if (!d1.ok) process.exit(1);
  const D1 = d1.detalle.id;
  // emitir link
  const actor = { email: 'luis@df-e2e.example', nombre: 'Luis Pruebas' };
  const e1 = await DL.emitirLinkDetalle(D1, actor, { destinatarios: ['cobros@dd-e2e.example', 'no-es-correo'], cc: ['cc@dd-e2e.example'], mensaje: 'Hola', baseUrl: 'http://localhost:3012' });
  ok(e1.ok && e1.detalle.estado === 'enviada' && e1.link.vigente && /^http:\/\/localhost:3012\/aprobar-detalle#[A-Za-z0-9_-]{43}$/.test(e1.url) && e1.correo.modo === 'mock' && e1.correo.resultado === 'enviado' && e1.detalle.destinatarios.join() === 'cobros@dd-e2e.example', `emitir: estado enviada, link vigente, URL con el token en el fragmento, correo en modo mock (${e1.ok ? e1.correo.detalle : e1.error})`);
  if (!e1.ok) process.exit(1);
  const token1 = e1.url.split('#')[1];
  const { data: lk } = await sb.from('detalle_facturacion_link').select('token_hash, documento_hash, abierto_en, usado_en').eq('detalle_id', D1).order('creado_en', { ascending: false }).limit(1).single();
  ok(lk!.token_hash === sha(token1) && lk!.token_hash !== token1 && lk!.documento_hash === e1.huella && !lk!.abierto_en, 'en la base queda SOLO el sha256 del token (nunca el token) y la huella; abierto_en vacío');
  const mock = RES.ultimosMock[RES.ultimosMock.length - 1];
  ok(!!mock && mock.para.join() === 'cobros@dd-e2e.example' && (mock.cc ?? []).join() === 'cc@dd-e2e.example' && mock.from === 'facturacion@golden-talent.com' && mock.respuestaA === actor.email && mock.html.includes(e1.url) && /Detalle de servicios DET-/.test(mock.asunto) && !/Ana Prueba/.test(mock.asunto), 'correo armado (mock): a los destinatarios válidos, cc, from facturacion@golden-talent.com, reply-to quien envía, el link en el cuerpo, sin candidatos en el asunto');
  const { data: env1 } = await sb.from('detalle_facturacion_envio').select('modo, resultado, destinatarios, version').eq('detalle_id', D1);
  ok((env1 ?? []).length === 1 && env1![0].modo === 'mock' && env1![0].resultado === 'enviado' && env1![0].version === 1, 'bitácora: un envío registrado (mock, enviado, versión 1)');
  // abrir: no consume
  const a1 = await DL.abrirLinkPublico(token1);
  const a1b = await DL.abrirLinkPublico(token1);
  const det1 = a1.estado === 'vigente' ? a1.detalle : null;
  ok(a1.estado === 'vigente' && a1b.estado === 'vigente' && !!det1 && det1.lineas.length === 5 && det1.lineas.every(l => /^[A-Za-z0-9_-]{22}$/.test(l.ref)) && JSON.stringify(det1).indexOf(NIT) === -1 && !JSON.stringify(det1).includes(ids[0]) && det1.cliente === 'DD E2E APROBACION' && det1.titulo === 'Polígrafos y socios · Oct 2026' && det1.huella === e1.huella, 'abrir: vigente dos veces (el GET no consume), 5 líneas con refs opacas; el DTO no lleva NIT ni ids internos; cliente, corte y huella');
  const { data: lk2 } = await sb.from('detalle_facturacion_link').select('abierto_en, usado_en').eq('token_hash', sha(token1)).single();
  ok(!!lk2!.abierto_en && !lk2!.usado_en, 'abierto_en se fija al abrir (informativo); usado_en sigue vacío');
  const refs = det1!.lineas.map(l => l.ref);
  const meta = { ip: '203.0.113.9', userAgent: 'e2e' };
  const todasOk = refs.map(ref => ({ ref, decision: 'aprobado' as const, nota: '' }));
  const firma = { nombre: 'Marta Solicita', cargo: 'Gerente RRHH', correo: 'marta@dd-e2e.example', autoriza: true, png: PNG };
  // de menos / de más / ref ajena
  const r1 = await DL.responderLinkPublico({ token: token1, respuestas: todasOk.slice(0, 4), firma }, meta);
  const r2 = await DL.responderLinkPublico({ token: token1, respuestas: [...todasOk, { ref: 'X'.repeat(22), decision: 'aprobado', nota: '' }], firma }, meta);
  ok(!r1.ok && !r2.ok && r1.error === 'Las respuestas no coinciden con el detalle: recargá la página.' && r2.error === r1.error, 'responder con un componente de menos o de más → rechazado con mensaje genérico');
  // firmar con una línea en corrección → rechazado (la RPC ignora la firma y... no: nota obligatoria primero)
  const r3 = await DL.responderLinkPublico({ token: token1, respuestas: [{ ...todasOk[0], decision: 'correccion', nota: '' }, ...todasOk.slice(1)], firma }, meta);
  ok(!r3.ok && /Falta el motivo/.test(r3.error), 'una nota faltante → rechazada');
  // todo aprobado pero sin firma → rechazado (FIRMA_INCOMPLETA)
  const r4 = await DL.responderLinkPublico({ token: token1, respuestas: todasOk, firma: null }, meta);
  ok(!r4.ok && /Para firmar/.test(r4.error), 'todo aprobado sin firma → rechazado');
  const { data: lk3 } = await sb.from('detalle_facturacion_link').select('usado_en').eq('token_hash', sha(token1)).single();
  const d1b = await DB.getDetalleBasico(D1);
  ok(!lk3!.usado_en && d1b!.estado === 'enviada', 'los rechazos no consumen el link ni cambian el estado');
  // con observaciones: 2 líneas (correccion + proximo_mes), con firma (se ignora)
  const conObs = [{ ...todasOk[0], decision: 'correccion' as const, nota: 'El precio está mal' }, { ...todasOk[1], decision: 'proximo_mes' as const, nota: 'Cobrar en noviembre' }, ...todasOk.slice(2)];
  const r5 = await DL.responderLinkPublico({ token: token1, respuestas: conObs, firma }, meta);
  const d1c = await DB.getDetalleBasico(D1);
  ok(r5.ok && r5.estado === 'con_observaciones' && r5.observaciones === 2 && d1c!.estado === 'con_observaciones' && !d1c!.firmaPng && d1c!.respondidoPorNombre === 'Marta Solicita' && !d1c!.aprobadaEn, 'con alguna no aprobada → con_observaciones (2), sin firma ni aprobación; queda quién respondió');
  const resp1 = await DB.respuestasDeDetalle(D1);
  ok(resp1.length === 5 && resp1.filter(r => r.decision !== 'aprobado').length === 2 && resp1.find(r => r.decision === 'correccion')?.nota === 'El precio está mal', '5 respuestas guardadas (versión 1), 2 observaciones con su nota');
  const a2 = await DL.abrirLinkPublico(token1);
  const r6 = await DL.responderLinkPublico({ token: token1, respuestas: todasOk, firma }, meta);
  ok(a2.estado === 'respondido' && (a2.estado === 'respondido' ? a2.detalle.lineas.filter(l => l.respuesta).length === 5 && a2.detalle.resultado?.estado === 'con_observaciones' : false) && !r6.ok && r6.error === 'Este detalle ya fue respondido.', 'después de responder el link es de solo lectura (muestra lo respondido) y un segundo envío es rechazado');
  // aviso de vuelta (mock)
  await DL.avisarRespuesta(D1, { estado: 'con_observaciones', observaciones: 2 }, 'http://localhost:3012');
  const aviso = RES.ultimosMock[RES.ultimosMock.length - 1];
  ok(!!aviso && aviso.para.includes('luis@df-e2e.example') && aviso.para.includes(process.env.FACTURACION_AVISO_CORREO!) && /mandó 2 observaciones/.test(aviso.asunto) && aviso.html.includes(`/por-facturar/detalle/${D1}`), 'aviso de vuelta a quien envió y a la casilla de facturación: "mandó 2 observaciones" con el link al detalle en Finanzas');
  // Finanzas: quitar línea (corrección → vuelve a la cola), diferir (próximo mes), respuesta de Golden
  const corrId = resp1.find(r => r.decision === 'correccion')!.componenteId, proxId = resp1.find(r => r.decision === 'proximo_mes')!.componenteId;
  const q1 = await DB.quitarLineaDetalle(D1, corrId, { motivo: 'Se corrigió la tarifa' }, 'e2e@test');
  const q2 = await DB.quitarLineaDetalle(D1, proxId, { diferirHasta: '2026-12-01' }, 'e2e@test');
  const { data: cDif } = await sb.from('facturacion_componente').select('detalle_id, diferida_hasta').eq('id', proxId).single();
  const { data: cCorr } = await sb.from('facturacion_componente').select('detalle_id, diferida_hasta').eq('id', corrId).single();
  ok(q1.ok && q2.ok && q2.detalle.pruebas === 3 && q2.detalle.subtotal === 800 && q2.detalle.total === 896 && cDif!.detalle_id === null && cDif!.diferida_hasta === '2026-12-01' && cCorr!.detalle_id === null && cCorr!.diferida_hasta === null, 'quitar línea: recalcula (3 pruebas, Q800 + IVA = Q896), las pruebas vuelven a la cola y la de "próximo mes" queda diferida al 2026-12-01');
  const q3 = await DB.quitarLineaDetalle(D1, corrId, {}, 'e2e@test');
  ok(!q3.ok && /ya no está/.test(q3.error), 'quitar una línea que ya no está → error legible');
  const n1 = await DB.responderNotaDetalle(D1, resp1.find(r => r.decision === 'aprobado')!.componenteId, 'Gracias, queda igual', 'e2e@test');
  ok(n1.ok, 'respuesta de Golden a una nota guardada');
  // reenviar: versión 2, link 1 revocado → "nueva versión"
  const e2 = await DL.emitirLinkDetalle(D1, actor, { destinatarios: [], baseUrl: 'http://localhost:3012' });
  const a3 = await DL.abrirLinkPublico(token1);
  ok(e2.ok && e2.detalle.version === 2 && e2.detalle.estado === 'enviada' && e2.link.version === 2 && e2.correo.modo === 'copiar_link' && a3.estado === 'nueva_version', `reenviar sin destinatarios: versión 2, modo copiar link; el link 1 queda revocado y abre como "nueva versión" (${e2.ok ? e2.correo.detalle : e2.error})`);
  const token2 = e2.ok ? e2.url.split('#')[1] : '';
  const r7 = await DL.responderLinkPublico({ token: token1, respuestas: todasOk.slice(0, 3), firma }, meta);
  ok(!r7.ok && r7.error === 'Hay una versión más nueva de este detalle, revisá tu correo.', 'responder sobre el link viejo → mensaje genérico de versión nueva');
  const a4 = await DL.abrirLinkPublico(token2);
  const det2 = a4.estado === 'vigente' ? a4.detalle : null;
  ok(!!det2 && det2.version === 2 && det2.lineas.length === 3 && det2.lineas.every(l => l.previa?.decision === 'aprobado') && det2.lineas.some(l => l.previa?.respuestaGolden === 'Gracias, queda igual') && det2.huella !== e1.huella, 'link 2: versión 2 con 3 líneas, cada una con su respuesta previa y la respuesta de Golden; huella nueva');
  // link vencido → rechazado
  await sb.from('detalle_facturacion_link').update({ expira_en: new Date(Date.now() - 1000).toISOString() }).eq('token_hash', sha(token2));
  const a5 = await DL.abrirLinkPublico(token2);
  await sb.from('detalle_facturacion_link').update({ expira_en: new Date(Date.now() + 86_400_000).toISOString() }).eq('token_hash', sha(token2));
  ok(a5.estado === 'invalido', 'link vencido → inválido');
  // contenido cambiado → inválido (huella)
  await sb.from('detalle_facturacion').update({ subtotal: 801 }).eq('id', D1);
  const a6 = await DL.abrirLinkPublico(token2);
  await sb.from('detalle_facturacion').update({ subtotal: 800 }).eq('id', D1);
  ok(a6.estado === 'invalido', 'si el detalle cambia después del envío, la huella no coincide → inválido (hay que reenviar)');
  // todo aprobado + firma → aprobada por link
  const refs2 = det2!.lineas.map(l => l.ref);
  const r8 = await DL.responderLinkPublico({ token: token2, respuestas: refs2.map(ref => ({ ref, decision: 'aprobado' as const, nota: '' })), firma }, meta);
  const d1d = await DB.getDetalleBasico(D1);
  const { data: lk4 } = await sb.from('detalle_facturacion_link').select('usado_en, ip_respuesta, user_agent_respuesta').eq('token_hash', sha(token2)).single();
  ok(r8.ok && r8.estado === 'aprobada' && d1d!.estado === 'aprobada' && d1d!.aprobadoCanal === 'link' && d1d!.aprobadoPor === 'Marta Solicita' && d1d!.firmaPng === PNG && d1d!.documentoHash === det2!.huella && d1d!.respondidoPorCorreo === 'marta@dd-e2e.example' && !!lk4!.usado_en && lk4!.ip_respuesta === '203.0.113.9', 'todo aprobado + firma → aprobada con canal link, firma guardada, huella, correo del firmante, IP y user agent');
  const a7 = await DL.abrirLinkPublico(token2);
  ok(a7.estado === 'respondido' && (a7.estado === 'respondido' ? a7.detalle.resultado?.estado === 'aprobada' && a7.detalle.resultado.nombre === 'Marta Solicita' : false), 'el link aprobado abre en solo lectura con "aprobada"');
  const det1Comp = await DB.getDetalle(D1);
  ok(!!det1Comp && det1Comp.respuestas.length === 8 && det1Comp.link?.usadoEn !== null && det1Comp.envios.length >= 2 && det1Comp.correosCliente.join() === 'cobros@dd-e2e.example,rrhh@dd-e2e.example', 'getDetalle trae respuestas (5 + 3), el último link, la bitácora y los correos sugeridos del cliente');
  // ── 030 · caso GTL: 16 polígrafos de 401.79 + 12 socios de 424.11 → el cliente ve 450 / 475 y Q12,900.00, y firma sin DOCUMENTO_CAMBIO ──
  const gtlSeeds = [...Array(16).fill(['POLIGRAFO', 'RUTINA', 401.79]), ...Array(12).fill(['SOCIOECONOMICO', 'PRE EMPLEO', 424.11])] as Array<[string, string, number]>;
  const { data: gtlExps } = await sb.from('facturacion_expediente').insert(gtlSeeds.map((g, i) => ({ fuente: 'agenda', id_externo: `${PREFIJO}gtl${String(i + 1).padStart(3, '0')}`, empresa_id_externo: EMPRESA, empresa_nombre_externo: 'DD E2E APROBACION', nit_resuelto: NIT, cliente_id: cliRow?.id ?? null, persona: `GTL ${i + 1}`, puesto: 'Puesto', solicitante: 'GTL RRHH', tipo_prueba: g[0], categoria_prueba: g[1], proceso_solicitado: `SOLO ${g[0]}`, fecha_ingreso: '2026-10-10', fecha_entrega: '2026-10-25', status_proceso: 'APROBO', terminado: true, cancelado: false, eliminado: false, estado_tarifa: 'resuelta', monto_calculado: g[2], status_cobro_externo: 'PENDIENTE', actualizado_en_externo: '2026-10-26T12:00:00.000Z' }))).select('id, id_externo');
  const { data: gtlComps } = await sb.from('facturacion_componente').insert((gtlExps ?? []).map((e, i) => ({ fuente: 'agenda', expediente_id: e.id, id_externo: e.id_externo, servicio: gtlSeeds[i][0], estado_prueba: 'APROBO', situacion: 'cobra', motivo: 'E2E', categoria: gtlSeeds[i][1], territorio: 'METROPOLITANA', monto_calculado: gtlSeeds[i][2], estado_tarifa: 'resuelta', fecha_resultado: '2026-10-20T15:00:00.000Z', fecha_resultado_fuente: 'agenda' }))).select('id');
  const dG = await DB.crearDetalle({ componenteIds: (gtlComps ?? []).map(c => c.id as string), titulo: 'GTL · Oct 2026' }, 'e2e@test');
  ok(dG.ok && dG.detalle.total === 12900 && dG.detalle.subtotal === 11517.86 && dG.detalle.iva === 1382.14 && dG.detalle.pruebas === 28, `030 GTL: la RPC crea el detalle con total ${dG.ok ? dG.detalle.total : dG.error}, base ${dG.ok ? dG.detalle.subtotal : ''}, IVA ${dG.ok ? dG.detalle.iva : ''} (regla FEL)`);
  const eG = dG.ok ? await DL.emitirLinkDetalle(dG.detalle.id, actor, { destinatarios: ['cobros@dd-e2e.example'], baseUrl: 'http://localhost:3012' }) : null;
  const aG = eG?.ok ? await DL.abrirLinkPublico(eG.url.split('#')[1]) : null;
  const detG = aG?.estado === 'vigente' ? aG.detalle : null;
  ok(!!detG && detG.lineas.filter(l => l.monto === 450).length === 16 && detG.lineas.filter(l => l.monto === 475).length === 12 && detG.total === 12900 && detG.subtotal === 11517.86 && detG.iva === 1382.14, `030 GTL: el cliente ve 16 líneas de 450.00 y 12 de 475.00, total Q12,900.00 (base 11,517.86 · IVA 1,382.14)`);
  const rG = eG?.ok && detG ? await DL.responderLinkPublico({ token: eG.url.split('#')[1], respuestas: detG.lineas.map(l => ({ ref: l.ref, decision: 'aprobado' as const, nota: '' })), firma }, meta) : null;
  const dGb = dG.ok ? await DB.getDetalleBasico(dG.detalle.id) : null;
  ok(!!rG && rG.ok && rG.estado === 'aprobada' && dGb?.estado === 'aprobada' && dGb.total === 12900 && dGb.documentoHash === detG?.huella, '030 GTL: firma sin DOCUMENTO_CAMBIO → aprobada por link con la huella del documento con IVA');
  const docG = dG.ok ? await DB.getDetalle(dG.detalle.id) : null;
  ok(!!docG && docG.documento.total === 12900 && docG.documento.incluidas.every(l => l.montoConIva === 450 || l.montoConIva === 475), '030 GTL: el documento (imprimible) muestra 450 / 475 por línea y el mismo total que la base');
  if (dG.ok) await DB.anularDetalle(dG.detalle.id, 'e2e', 'e2e@test');
  // revocar + anulado/facturado invalidan
  const d2 = await DB.crearDetalle({ componenteIds: [ids[5]] }, 'e2e@test');
  const e3 = d2.ok ? await DL.emitirLinkDetalle(d2.detalle.id, actor, { destinatarios: ['cobros@dd-e2e.example'], baseUrl: 'http://localhost:3012' }) : null;
  const token3 = e3?.ok ? e3.url.split('#')[1] : '';
  const rv = d2.ok ? await DL.revocarLinkDetalle(d2.detalle.id, 'e2e@test', 'prueba') : null;
  const a8 = await DL.abrirLinkPublico(token3);
  ok(!!rv && rv.ok && rv.revocados === 1 && a8.estado === 'nueva_version', 'revocar link → el cliente ve "versión más nueva" (genérico)');
  const e4 = d2.ok ? await DL.emitirLinkDetalle(d2.detalle.id, actor, { destinatarios: [], baseUrl: 'http://localhost:3012' }) : null;
  const token4 = e4?.ok ? e4.url.split('#')[1] : '';
  if (d2.ok) await DB.anularDetalle(d2.detalle.id, 'e2e', 'e2e@test');
  const a9 = await DL.abrirLinkPublico(token4);
  ok(a9.estado === 'invalido', 'detalle anulado → su link es inválido');
  // ── 031 · aperturas del link: quién lo abrió, cuántas veces, desde qué red ──
  const TK = await import('../src/lib/detalle-link/token');
  const ipGolden = '198.51.100.10', ipCliA = '203.0.113.21', ipCliB = '203.0.113.99';
  const totalAp = async () => (await sb.from('detalle_facturacion_link_apertura').select('id', { count: 'exact', head: true })).count ?? 0;
  const d4 = await DB.crearDetalle({ componenteIds: [ids[5]], titulo: 'Aperturas 031' }, 'e2e@test');
  const D4 = d4.ok ? d4.detalle.id : '';
  const e5 = d4.ok ? await DL.emitirLinkDetalle(D4, actor, { destinatarios: ['cobros@dd-e2e.example'], baseUrl: 'http://localhost:3012', ip: ipGolden }) : null;
  const token5 = e5?.ok ? e5.url.split('#')[1] : '';
  const { data: lk5 } = await sb.from('detalle_facturacion_link').select('id, creador_ip_hash').eq('token_hash', sha(token5)).maybeSingle();
  ok(!!e5?.ok && !!lk5 && lk5.creador_ip_hash === TK.hashIp(ipGolden) && String(lk5.creador_ip_hash).length === 16 && e5.link.creadorIpHash === lk5.creador_ip_hash && TK.hashIp('desconocida') === null && TK.hashIp('') === null, `031: emitir guarda creador_ip_hash = sha256(ip + secreto) truncado a 16 (nunca la IP; una IP desconocida no se hashea)${e5 && !e5.ok ? ' · ' + e5.error : ''}`);
  // 1) quien envió lo abre (su red) · 2) cliente A escritorio, tres recargas · 3) cliente A móvil · 4) cliente B escritorio
  const t0 = await totalAp();
  await DL.abrirLinkPublico(token5, { ip: ipGolden, userAgent: uaChromeMac });
  for (let i = 0; i < 3; i++) await DL.abrirLinkPublico(token5, { ip: ipCliA, userAgent: uaEdgeWin });
  await DL.abrirLinkPublico(token5, { ip: ipCliA, userAgent: uaIphone });
  const a10 = await DL.abrirLinkPublico(token5, { ip: ipCliB, userAgent: uaChromeMac });
  const { data: filas } = await sb.from('detalle_facturacion_link_apertura').select('*').eq('detalle_id', D4).order('abierto_en');
  const { data: lk5b } = await sb.from('detalle_facturacion_link').select('usado_en, abierto_en').eq('token_hash', sha(token5)).single();
  const d4b = await DB.getDetalleBasico(D4);
  ok(a10.estado === 'vigente' && (filas ?? []).length === 4 && (await totalAp()) === t0 + 4 && filas!.filter(f => f.ip_hash === TK.hashIp(ipCliA) && f.dispositivo === 'escritorio').length === 1 && filas!.every(f => !/203\.0|198\.51|Mozilla/.test(JSON.stringify(f)) && f.version === 1) && filas!.map(f => f.navegador).sort().join() === 'Chrome,Chrome,Edge,Safari', `031: 6 aperturas → ${(filas ?? []).length} filas (las 3 recargas del mismo ip_hash + dispositivo en 10 min son una); sin IP ni user agent en la tabla; dispositivo y navegador cortos`);
  ok(!lk5b!.usado_en && !!lk5b!.abierto_en && d4b!.estado === 'enviada', '031: abrir no consume el link ni cambia el estado; abierto_en del link sigue siendo la primera apertura');
  const det4 = await DB.getDetalle(D4);
  const res4 = det4 ? AP.resumenAperturas(det4.aperturas, det4.link!.creadorIpHash) : null;
  ok(!!res4 && res4.n === 3 && res4.propias === 1 && res4.dispositivos === 3 && det4!.aperturas.length === 4 && det4!.links.length === 1 && det4!.aperturas.filter(a => AP.marcaRed(a, det4!.aperturas, det4!.link!.creadorIpHash) === 'creador').length === 1, '031: en el detalle cuentan 3 aperturas (la de la red de quien envió se marca «probablemente Golden» y no cuenta), 3 dispositivos');
  const lista4 = await DB.resumenAperturasPorDetalle([D4, D1, 'no-existe']);
  ok(lista4[D4]?.n === 3 && lista4[D4]?.propias === 1 && AP.badgeVisto(lista4[D4], d4b!.enviadaEn, fmtAp).texto === 'Visto', '031: resumen para la lista de Por facturar (último link por detalle) → «Visto» con 3 aperturas');
  // link inválido / revocado → no registra
  const t1 = await totalAp();
  const aX = await DL.abrirLinkPublico('Z'.repeat(43), { ip: ipCliB, userAgent: uaChromeMac });
  const rv5 = await DL.revocarLinkDetalle(D4, 'e2e@test', 'prueba 031');
  const a11 = await DL.abrirLinkPublico(token5, { ip: ipCliB, userAgent: uaIphone });
  ok(aX.estado === 'invalido' && rv5.ok && a11.estado === 'nueva_version' && (await totalAp()) === t1, '031: un link inválido o revocado no registra apertura');
  // respondio: abrir y responder desde la misma red + dispositivo → la apertura previa queda marcada; después de responder, abrir sigue registrando
  const e6 = await DL.emitirLinkDetalle(D4, actor, { destinatarios: [], baseUrl: 'http://localhost:3012', ip: ipGolden });
  const token6 = e6.ok ? e6.url.split('#')[1] : '';
  const a12 = await DL.abrirLinkPublico(token6, { ip: ipCliB, userAgent: uaAndroid });
  const r9 = a12.estado === 'vigente' ? await DL.responderLinkPublico({ token: token6, respuestas: a12.detalle.lineas.map(l => ({ ref: l.ref, decision: 'aprobado' as const, nota: '' })), firma }, { ip: ipCliB, userAgent: uaAndroid }) : null;
  const a13 = await DL.abrirLinkPublico(token6, { ip: ipCliA, userAgent: uaOutlook });
  const { data: filas6 } = await sb.from('detalle_facturacion_link_apertura').select('dispositivo, navegador, respondio, ip_hash').eq('link_id', e6.ok ? e6.link.id : '').order('abierto_en');
  ok(!!r9 && r9.ok && r9.estado === 'aprobada' && a13.estado === 'respondido' && (filas6 ?? []).length === 2 && filas6![0].respondio === true && filas6![0].dispositivo === 'movil' && filas6![0].navegador === 'Chrome' && filas6![1].respondio === false && filas6![1].navegador === 'Outlook', '031: la apertura previa a responder queda `respondio`; un link respondido sigue registrando aperturas (Outlook, otra red)');
  await DB.anularDetalle(D4, 'e2e 031', 'e2e@test');
  const nAp = async () => (await sb.from('detalle_facturacion_link_apertura').select('id', { count: 'exact', head: true }).eq('detalle_id', D4)).count ?? 0;
  ok((await nAp()) === 6, '031: anular el detalle conserva sus aperturas (histórico: 4 del link 1 + 2 del link 2); se van en cascada solo con el detalle');

  // rate limit
  const claveRl = `responder:token:e2e-rl-${Date.now().toString(36)}`;   // clave única por corrida (la ventana es de un minuto)
  let permitidos = 0; for (let i = 0; i < 7; i++) if (await DL.dentroDelLimite(claveRl, 5, 60)) permitidos++;
  ok(permitidos === 5, 'rate limit en tabla: 5 permitidos y el resto rechazado en la ventana');
  // anon
  const anon = process.env.SUPABASE_ANON_KEY;
  if (anon) {
    const { createClient } = await import('@supabase/supabase-js');
    const pub = createClient(process.env.SUPABASE_URL!, anon, { auth: { persistSession: false } });
    const { data: dA, error: eA } = await pub.rpc('detalle_link_abrir', { p_token_hash: sha(token2) });
    const { error: eB } = await pub.rpc('detalle_link_responder', { p_token_hash: sha(token2), p_respuestas: [] });
    ok(!dA && /permission denied|42501/i.test(`${eA?.code} ${eA?.message}`) && /permission denied|42501/i.test(`${eB?.code} ${eB?.message}`), `con la llave anon las RPC del link fallan por permiso (${eA?.code})`);
    const { data: dC, error: eC } = await pub.from('detalle_facturacion_link_apertura').select('id').limit(1);
    const { error: eD } = await pub.rpc('detalle_link_abrir', { p_token_hash: sha(token2), p_ip_hash: null, p_dispositivo: null, p_navegador: null });
    ok(!dC?.length && /permission denied|42501/i.test(`${eC?.code} ${eC?.message}`) && /permission denied|42501/i.test(`${eD?.code} ${eD?.message}`), `031: con la llave anon ni la tabla de aperturas ni la RPC de abrir (4 argumentos) responden (${eC?.code} / ${eD?.code})`);
  } else console.log('  ⚪ SUPABASE_ANON_KEY no está en el entorno: prueba con la llave pública omitida (verificada con has_function_privilege en SQL)');
  if (!CONSERVAR) ok((await limpiar()) === 0 && (await nAp()) === 0, 'limpieza verificada: 0 expedientes ddE2E y 0 detalles del NIT de prueba; links, respuestas, envíos, aperturas (cascada), mapeo y cliente borrados');
  else {
    // para el E2E en Chrome: un detalle nuevo en borrador con las 5 pruebas libres (la diferida incluida: "Solo cobrable" la esconde pero el detalle la admite)
    const { data: dets } = await sb.from('detalle_facturacion').select('id, estado').eq('nit', NIT);
    for (const x of (dets ?? []) as { id: string; estado: string }[]) if (x.estado !== 'anulada') await DB.anularDetalle(x.id, 'e2e: liberar', 'e2e@test');
    await sb.from('facturacion_componente').update({ diferida_hasta: null }).in('id', ids);
    const d3 = await DB.crearDetalle({ componenteIds: ids, titulo: 'Corte E2E · Oct 2026', dirigidoA: 'Marta Solicita' }, 'e2e@test');
    console.log(`  ⚪ --conservar: queda el detalle ${d3.ok ? d3.detalle.id : d3.error} en borrador (6 pruebas) para el E2E en Chrome (borrar con --solo-limpiar)`);
  }
  console.log(`\n${pass} 🟢 / ${fail} 🔴`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
