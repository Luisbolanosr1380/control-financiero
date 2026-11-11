/**
 * DETALLE DIGITAL (029) · links de aprobación, respuesta del cliente, correo y aviso — SOLO SERVIDOR.
 *
 * Seguridad: el token nace acá (32 bytes), se guarda solo su sha256 y viaja una vez en el link del correo (en el
 * fragmento `#`, que el navegador no manda al servidor ni queda en logs). Al abrir / responder, la app recalcula la
 * huella del documento, arma las referencias HMAC de las líneas y quita todo lo interno antes de mandar nada al
 * navegador. Las RPC solo las ejecuta service_role.
 */
import 'server-only';
import { supabase } from '@/lib/supabase/client';
import { rpc } from '@/lib/supabase/writes';
import { empresaConfig } from '@/lib/config/empresa';
import { precioConIva } from '@/lib/tarifario/canon';
import { ordenLineas } from '@/lib/facturacion-agenda/detalle';
import { generarToken, hashIp, hashToken, linkConfigurado, refDeLinea, tokenValido } from '@/lib/detalle-link/token';
import { clasificarUserAgent } from '@/lib/detalle-link/aperturas';
import { hashDocumento, type DocumentoFirmable } from '@/lib/detalle-link/documento';
import { correoAviso, correoEnvio, textoCopiarLink } from '@/lib/detalle-link/correo';
import { configCorreo, correosValidos, enviarCorreo } from '@/lib/correo/resend';
import { esDecision, etiquetaResultadoPublico, mensajePublico, type AperturaPublica, type DetallePublico, type EnvioCliente, type LineaPublica } from '@/lib/detalle-link/publico';
import { getDetalle, getDetalleBasico, type DetalleCompleto, type LinkDetalle } from './detalle-facturacion';
import type { DetalleFacturacion } from '@/lib/facturacion-agenda/detalle';

/**
 * Lo que se firma: las líneas incluidas del detalle (con su componente), los totales y la versión. Se arma con los
 * datos CRUDOS de la base (persona del expediente, servicio / categoría / territorio del componente y su precio CON IVA),
 * igual que `detalle_link_contenido` en SQL, para que la huella que se calcula al emitir sea la misma al abrir.
 */
export function documentoFirmableDe(datos: DetalleCompleto, version: number): DocumentoFirmable {
  const incluidas = new Set(datos.documento.incluidas.map(l => l.componenteId));
  const persona = new Map(datos.expedientes.map(e => [e.idExterno, e.persona ?? '']));
  return {
    correlativo: datos.detalle.correlativo, version, nit: datos.detalle.nit,
    // 030: el monto firmado es el PRECIO CON IVA de la prueba (el que va en la factura), igual que `detalle_link_contenido`
    lineas: datos.pruebas.filter(p => incluidas.has(p.id)).map(p => ({ componenteId: p.id, persona: persona.get(p.idExterno) ?? '', servicio: p.servicio, categoria: p.categoria ?? '', territorio: p.territorio ?? '', monto: precioConIva(p.montoCalculado ?? 0) })),
    subtotal: datos.documento.subtotal, iva: datos.documento.iva, total: datos.documento.total,
  };
}

const urlLink = (baseUrl: string, token: string) => `${baseUrl.replace(/\/$/, '')}/aprobar-detalle#${token}`;

export interface CorreoEmision { modo: 'resend' | 'mock' | 'copiar_link'; resultado: 'enviado' | 'error' | 'sin_llave'; detalle: string; textoCopiar: string }
export type EmitirLinkResult =
  | { ok: true; detalle: DetalleFacturacion; link: LinkDetalle; url: string; huella: string; correo: CorreoEmision }
  | { ok: false; error: string };

/**
 * "Enviar al cliente" / "Enviar versión corregida": revoca el link anterior, emite uno nuevo (la base sube la versión
 * si venía con observaciones), deja el detalle en `enviada`, manda el correo (o devuelve el texto para copiar) y
 * registra el envío en la bitácora. El token en claro solo vuelve en `url` para el correo / copiar.
 */
export async function emitirLinkDetalle(id: string, actor: { email: string; nombre: string }, input: { destinatarios: string[]; cc?: string[]; asunto?: string; mensaje?: string; baseUrl: string; dias?: number; /** 031: IP de quien envía (x-forwarded-for); se guarda solo su hash para no contar sus propias aperturas */ ip?: string | null }): Promise<EmitirLinkResult> {
  if (!linkConfigurado()) return { ok: false, error: 'Falta configurar DETALLE_LINK_SECRET en este deploy: sin eso no se emiten links de aprobación.' };
  const datos = await getDetalle(id); if (!datos) return { ok: false, error: 'El detalle no existe.' };
  const d = datos.detalle;
  if (!['borrador', 'enviada', 'con_observaciones'].includes(d.estado)) return { ok: false, error: 'Solo se envía un detalle en borrador, enviado o con observaciones.' };
  if (!datos.documento.incluidas.length) return { ok: false, error: 'El detalle no tiene pruebas con precio: no se puede enviar.' };
  const version = d.estado === 'con_observaciones' ? d.version + 1 : d.version;
  const huella = hashDocumento(documentoFirmableDe(datos, version));
  const destinatarios = correosValidos(input.destinatarios), cc = correosValidos(input.cc ?? []);
  const token = generarToken();
  let r: { detalle: Record<string, unknown>; link: Record<string, unknown> };
  try {
    // 031: los 7 argumentos con nombre resuelven a la versión nueva (la de 6 queda como envoltorio en la 031)
    r = await rpc<{ detalle: Record<string, unknown>; link: Record<string, unknown> }>('detalle_link_emitir', { p_actor: actor.email, p_detalle_id: id, p_token_hash: hashToken(token), p_documento_hash: huella, p_destinatarios: destinatarios, p_dias: input.dias ?? 30, p_creador_ip_hash: hashIp(input.ip) });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { ok: false, error: /DETALLE_VACIO/.test(m) ? 'El detalle no tiene pruebas.' : /DETALLE_NO_ENVIABLE/.test(m) ? 'Solo se envía un detalle en borrador, enviado o con observaciones.' : /does not exist|Could not find/i.test(m) ? 'Falta aplicar la migración 031 en esta base.' : m.replace(/^detalle_link_emitir: /, '') };
  }
  const detalle = (await getDetalleBasico(id))!;
  const lk = r.link;
  const link: LinkDetalle = { id: String(lk.id), version: Number(lk.version), creadoEn: String(lk.creado_en), expiraEn: String(lk.expira_en), revocadoEn: null, abiertoEn: null, usadoEn: null, vigente: true, creadorIpHash: (lk.creador_ip_hash as string | null) ?? null };
  const url = urlLink(input.baseUrl, token);
  const emp = empresaConfig();
  const textoCopiar = textoCopiarLink({ correlativo: d.correlativo, cliente: datos.clienteNombre, emisor: emp.nombre, titulo: d.titulo, pruebas: datos.documento.incluidas.length, total: datos.documento.total, link: url, expiraEn: link.expiraEn, version });
  // correo
  const cfg = configCorreo();
  let correo: CorreoEmision;
  if (!destinatarios.length || (!cfg.apiKey && !cfg.mock)) {
    correo = { modo: 'copiar_link', resultado: 'sin_llave', detalle: !destinatarios.length ? 'Sin destinatarios: copiá el link.' : 'Correo no configurado: copiá el link.', textoCopiar };
    await registrarEnvio(id, version, link.id, 'envio', destinatarios, cc, input.asunto ?? '', 'copiar_link', 'sin_llave', null, correo.detalle, actor.email);
  } else {
    const c = correoEnvio({ correlativo: d.correlativo, version, cliente: datos.clienteNombre, emisor: emp.nombre, titulo: d.titulo, dirigidoA: d.dirigidoA, pruebas: datos.documento.incluidas.length, total: datos.documento.total, link: url, expiraEn: link.expiraEn, mensaje: (input.mensaje ?? '').trim().slice(0, 1000), remitenteNombre: actor.nombre || actor.email });
    const asunto = (input.asunto ?? '').trim().slice(0, 200) || c.asunto;
    const res = await enviarCorreo({ para: destinatarios, cc, respuestaA: actor.email, asunto, html: c.html, texto: c.texto });
    if (res.ok) {
      correo = { modo: res.modo, resultado: 'enviado', detalle: res.modo === 'mock' ? `Correo armado en modo prueba (sin Resend) para ${destinatarios.join(', ')}.` : `Correo enviado a ${destinatarios.join(', ')}${cc.length ? ` (cc ${cc.join(', ')})` : ''}.`, textoCopiar };
      await registrarEnvio(id, version, link.id, 'envio', destinatarios, cc, asunto, res.modo, 'enviado', res.id, null, actor.email);
    } else {
      correo = { modo: res.modo === 'sin_llave' ? 'copiar_link' : 'resend', resultado: res.modo === 'sin_llave' ? 'sin_llave' : 'error', detalle: res.modo === 'sin_llave' ? 'Correo no configurado: copiá el link.' : `El correo no salió (${res.error}): copiá el link y mandalo a mano.`, textoCopiar };
      await registrarEnvio(id, version, link.id, 'envio', destinatarios, cc, asunto, res.modo === 'sin_llave' ? 'copiar_link' : 'resend', res.modo === 'sin_llave' ? 'sin_llave' : 'error', null, res.error, actor.email);
    }
  }
  // CENTRO DE COBROS (033): el envío del detalle entra al historial de cobranza del cliente (fail-soft)
  try { const { registrarEventoAutomatico } = await import('./cobranza'); await registrarEventoAutomatico({ idApp: datos.clienteAppId ?? `n-${d.nit}` }, { tipo: 'detalle_enviado', comentario: `Detalle ${d.correlativo} v${version} enviado${destinatarios.length ? ` a ${destinatarios.join(', ')}` : ' (link para copiar)'} · ${datos.documento.incluidas.length} pruebas · Q${datos.documento.total.toFixed(2)}`, monto: datos.documento.total, actor: actor.email, datos: { detalleId: id, version } }); } catch { /* sin historial */ }
  return { ok: true, detalle, link, url, huella, correo };
}

export async function revocarLinkDetalle(id: string, actor: string, motivo?: string): Promise<{ ok: true; revocados: number } | { ok: false; error: string }> {
  try { const n = await rpc<number>('detalle_link_revocar', { p_actor: actor, p_detalle_id: id, p_motivo: (motivo ?? '').trim().slice(0, 200) || null }); return { ok: true, revocados: Number(n) }; }
  catch (e) { return { ok: false, error: (e instanceof Error ? e.message : String(e)).replace(/^detalle_link_revocar: /, '') }; }
}

async function registrarEnvio(detalleId: string, version: number, linkId: string | null, tipo: 'envio' | 'aviso', destinatarios: string[], cc: string[], asunto: string, modo: 'resend' | 'mock' | 'copiar_link', resultado: 'enviado' | 'error' | 'sin_llave', proveedorId: string | null, error: string | null, enviadoPor: string): Promise<void> {
  const sb = supabase(); if (!sb) return;
  const { error: e } = await sb.from('detalle_facturacion_envio').insert({ detalle_id: detalleId, version, link_id: linkId, tipo, destinatarios, cc, asunto: asunto || null, modo, resultado, proveedor_id: proveedorId, error: error ? String(error).slice(0, 500) : null, enviado_por: enviadoPor });
  if (e) console.error('detalle_facturacion_envio:', e.message);
}

/** Rate limit por clave (ip / token) en la base. Si la base falla, se niega (cerrado). */
export async function dentroDelLimite(clave: string, limite: number, ventanaSeg = 60): Promise<boolean> {
  const sb = supabase(); if (!sb) return false;
  const { data, error } = await sb.rpc('detalle_link_rate_limit', { p_clave: clave.slice(0, 120), p_limite: limite, p_ventana_seg: ventanaSeg });
  if (error) { console.error('detalle_link_rate_limit:', error.message); return false; }
  return data === true;
}

// ── Abrir / responder (ruta pública) ──────────────────────────────────────────────────────────────
interface ContenidoRpc {
  correlativo: string; version: number; estado: string; nit: string; titulo: string | null; dirigido_a: string | null; notas: string | null; cliente: string;
  subtotal: number | string; iva: number | string; total: number | string; respondido_en: string | null; respondido_por_nombre: string | null; respondido_por_cargo: string | null; firma_png: string | null; documento_hash: string | null;
  lineas: Array<{ componente_id: string; persona: string | null; puesto: string | null; solicitante: string | null; fecha_ingreso: string | null; servicio: string; estado_prueba: string | null; categoria: string | null; territorio: string | null; monto: number | string }>;
  respuestas: Array<{ componente_id: string; version: number; decision: string; nota: string | null; respuesta_golden: string | null }>;
}
interface AperturaRpc { estado: 'invalido' | 'nueva_version' | 'vigente' | 'respondido'; version?: number; expira_en?: string; huella?: string; contenido?: ContenidoRpc }

const dim = (v: string | null | undefined) => (!v || v === 'UNICA' ? '' : v);
const n2 = (v: number | string | null | undefined) => Math.round(Number(v ?? 0) * 100) / 100;

/** 031: lo que se registra de la petición al abrir: red (solo su hash) y dispositivo / navegador (nunca el user agent completo). */
export interface MetaPeticion { ip: string; userAgent: string }

/**
 * Abre un link por su token: valida en la base, recalcula la huella y arma el DTO público (sin nada interno).
 * 031: registra la apertura (vigente o respondido) con ip_hash + dispositivo + navegador; la base junta las recargas
 * del mismo ip_hash + dispositivo dentro de 10 minutos. Nunca consume el link ni cambia el estado.
 */
export async function abrirLinkPublico(token: string, meta?: MetaPeticion | null): Promise<AperturaPublica & { detalleId?: string; mapaRefs?: Map<string, string>; huella?: string }> {
  if (!tokenValido(token) || !linkConfigurado()) return { estado: 'invalido' };
  const th = hashToken(token);
  const sb = supabase(); if (!sb) return { estado: 'invalido' };
  const ua = clasificarUserAgent(meta?.userAgent);
  // los 4 argumentos con nombre resuelven a la versión de la 031 (la de la 029 queda como envoltorio)
  const { data, error } = await sb.rpc('detalle_link_abrir', { p_token_hash: th, p_ip_hash: hashIp(meta?.ip), p_dispositivo: meta ? ua.dispositivo : null, p_navegador: meta ? ua.navegador : null });
  if (error || !data) { if (error) console.error('detalle_link_abrir:', error.code ?? error.message.slice(0, 80)); return { estado: 'invalido' }; }
  const a = data as AperturaRpc;
  if (a.estado === 'invalido' || a.estado === 'nueva_version' || !a.contenido || !a.huella) return { estado: a.estado === 'nueva_version' ? 'nueva_version' : 'invalido' };
  const c = a.contenido;
  // la huella se recalcula desde la base: si el contenido cambió desde el envío, el link ya no vale
  const version = Number(a.version ?? c.version);
  const recalculada = hashDocumento({ correlativo: c.correlativo, version, nit: c.nit, lineas: c.lineas.map(l => ({ componenteId: l.componente_id, persona: l.persona ?? '', servicio: l.servicio, categoria: l.categoria ?? '', territorio: l.territorio ?? '', monto: n2(l.monto) })), subtotal: n2(c.subtotal), iva: n2(c.iva), total: n2(c.total) });
  if (a.estado === 'vigente' && recalculada !== a.huella) { console.error('detalle_link_abrir: la huella no coincide (el detalle cambió)'); return { estado: 'invalido' }; }
  const mapaRefs = new Map<string, string>();
  const previas = new Map(c.respuestas.filter(r => r.version === version - 1).map(r => [r.componente_id, r]));
  const actuales = new Map(c.respuestas.filter(r => r.version === version).map(r => [r.componente_id, r]));
  const ordenadas = [...c.lineas].sort((x, y) => ordenLineas({ fechaIngreso: x.fecha_ingreso ?? null, persona: x.persona ?? '', servicio: x.servicio }, { fechaIngreso: y.fecha_ingreso ?? null, persona: y.persona ?? '', servicio: y.servicio }));
  const lineas: LineaPublica[] = ordenadas.map(l => {
    const ref = refDeLinea(th, l.componente_id); mapaRefs.set(ref, l.componente_id);
    const p = previas.get(l.componente_id), r = actuales.get(l.componente_id);
    return {
      ref, persona: l.persona ?? '—', puesto: l.puesto ?? '', solicitante: l.solicitante ?? '', fechaIngreso: l.fecha_ingreso, servicio: l.servicio,
      resultado: etiquetaResultadoPublico(l.servicio, l.estado_prueba), categoria: dim(l.categoria), territorio: dim(l.territorio), monto: n2(l.monto),
      previa: p && esDecision(p.decision) ? { decision: p.decision, nota: p.nota ?? '', respuestaGolden: p.respuesta_golden ?? '' } : null,
      respuesta: a.estado === 'respondido' && r && esDecision(r.decision) ? { decision: r.decision, nota: r.nota ?? '' } : null,
    };
  });
  const observaciones = [...actuales.values()].filter(r => r.decision !== 'aprobado').length;
  const detalle: DetallePublico = {
    estado: a.estado, correlativo: c.correlativo, version, titulo: c.titulo ?? '', dirigidoA: c.dirigido_a ?? '', cliente: c.cliente, emisor: empresaConfig().nombre, logoUrl: empresaConfig().logoUrl, notas: c.notas ?? '',
    lineas, subtotal: n2(c.subtotal), iva: n2(c.iva), total: n2(c.total), expiraEn: String(a.expira_en ?? ''), huella: a.huella,
    resultado: a.estado === 'respondido' ? { estado: c.estado === 'aprobada' ? 'aprobada' : 'con_observaciones', respondidoEn: c.respondido_en, nombre: c.respondido_por_nombre ?? '', cargo: c.respondido_por_cargo ?? '', observaciones } : null,
  };
  return { estado: a.estado, detalle, mapaRefs, huella: a.huella };
}

export type ResponderResult = { ok: true; estado: 'aprobada' | 'con_observaciones'; observaciones: number; detalleId: string; version: number } | { ok: false; error: string };

/** Responde un link: refs → componentes desde la base, y la RPC valida todo (una transacción). Errores genéricos. */
export async function responderLinkPublico(envio: EnvioCliente, meta: MetaPeticion): Promise<ResponderResult> {
  const apertura = await abrirLinkPublico(envio.token, meta);
  if (apertura.estado !== 'vigente' || !apertura.mapaRefs || !apertura.huella) return { ok: false, error: apertura.estado === 'nueva_version' ? mensajePublico('LINK_NUEVA_VERSION') : apertura.estado === 'respondido' ? mensajePublico('LINK_USADO') : mensajePublico('LINK_INVALIDO') };
  const respuestas: Array<{ componente_id: string; decision: string; nota: string }> = [];
  for (const r of envio.respuestas) {
    const cid = apertura.mapaRefs.get(r.ref);
    if (!cid) return { ok: false, error: mensajePublico('RESPUESTAS_NO_CUBREN') };
    respuestas.push({ componente_id: cid, decision: r.decision, nota: r.nota });
  }
  const sb = supabase(); if (!sb) return { ok: false, error: mensajePublico('') };
  const th = hashToken(envio.token);
  const { data, error } = await sb.rpc('detalle_link_responder', { p_token_hash: th, p_respuestas: respuestas, p_firma: envio.firma ? { nombre: envio.firma.nombre, cargo: envio.firma.cargo, correo: envio.firma.correo, autoriza: envio.firma.autoriza, png: envio.firma.png } : null, p_ip: meta.ip, p_user_agent: meta.userAgent, p_documento_hash: apertura.huella });
  if (error) { console.error('detalle_link_responder:', (error.message ?? '').replace(/^.*?([A-Z_]{6,}).*$/s, '$1').slice(0, 40)); return { ok: false, error: mensajePublico(error.message ?? '') }; }
  const r = data as { estado: 'aprobada' | 'con_observaciones'; observaciones: number; version: number };
  const { data: lk } = await sb.from('detalle_facturacion_link').select('id, detalle_id').eq('token_hash', th).maybeSingle();
  await marcarAperturaRespondio(String((lk as { id?: string } | null)?.id ?? ''), meta);
  // CENTRO DE COBROS (033): la respuesta del cliente entra a su historial de cobranza (fail-soft)
  try { const dd = await getDetalleBasico(String((lk as { detalle_id?: string } | null)?.detalle_id ?? '')); if (dd) { const { registrarEventoAutomatico } = await import('./cobranza'); await registrarEventoAutomatico({ idApp: dd.clienteId ?? `n-${dd.nit}` }, { tipo: r.estado === 'aprobada' ? 'detalle_aprobado' : 'detalle_observaciones', comentario: r.estado === 'aprobada' ? `Detalle ${dd.correlativo} aprobado y firmado por link` : `Detalle ${dd.correlativo}: el cliente mandó ${r.observaciones} observaciones`, monto: dd.total, datos: { detalleId: dd.id, version: r.version } }); } } catch { /* sin historial */ }
  return { ok: true, estado: r.estado, observaciones: Number(r.observaciones ?? 0), detalleId: String((lk as { detalle_id?: string } | null)?.detalle_id ?? ''), version: Number(r.version) };
}

/** 031: la apertura previa a responder (misma red + dispositivo, la última) queda marcada `respondio`. Informativo, fail-soft. */
async function marcarAperturaRespondio(linkId: string, meta: MetaPeticion): Promise<void> {
  const sb = supabase(); if (!sb || !linkId) return;
  const ipHash = hashIp(meta.ip), { dispositivo } = clasificarUserAgent(meta.userAgent);
  let q = sb.from('detalle_facturacion_link_apertura').select('id').eq('link_id', linkId).eq('dispositivo', dispositivo).order('abierto_en', { ascending: false }).limit(1);
  q = ipHash ? q.eq('ip_hash', ipHash) : q.is('ip_hash', null);
  const { data } = await q.maybeSingle();
  const id = (data as { id?: string } | null)?.id;
  if (id) await sb.from('detalle_facturacion_link_apertura').update({ respondio: true }).eq('id', id);
}

/** Aviso de vuelta: para = casilla principal (FACTURACION_AVISO_CORREO) + quien envió el detalle; cc = FACTURACION_AVISO_CC. Fail-soft. */
export async function avisarRespuesta(detalleId: string, resultado: { estado: 'aprobada' | 'con_observaciones'; observaciones: number }, baseUrl: string): Promise<void> {
  try {
    const datos = await getDetalle(detalleId); if (!datos) return;
    const d = datos.detalle; const cfg = configCorreo();
    const para = correosValidos([...cfg.avisoA, d.enviadaPor]);
    const cc = correosValidos(cfg.avisoCc).filter(x => !para.includes(x));
    const c = correoAviso({ correlativo: d.correlativo, cliente: datos.clienteNombre, estado: resultado.estado, observaciones: resultado.observaciones, nombre: d.respondidoPorNombre, cargo: d.respondidoPorCargo, respondidoEn: d.respondidoEn ?? new Date().toISOString(), linkFinanzas: `${baseUrl.replace(/\/$/, '')}/por-facturar/detalle/${d.id}`, total: datos.documento.total, version: d.version });
    if (!para.length) { await registrarEnvio(d.id, d.version, null, 'aviso', [], [], c.asunto, 'copiar_link', 'sin_llave', null, 'Sin destinatarios para el aviso (enviada_por / FACTURACION_AVISO_CORREO).', 'sistema'); return; }
    const res = await enviarCorreo({ para, cc, asunto: c.asunto, html: c.html, texto: c.texto });
    await registrarEnvio(d.id, d.version, null, 'aviso', para, cc, c.asunto, res.ok ? res.modo : res.modo === 'sin_llave' ? 'copiar_link' : 'resend', res.ok ? 'enviado' : res.modo === 'sin_llave' ? 'sin_llave' : 'error', res.ok ? res.id : null, res.ok ? null : res.error, 'sistema');
  } catch (e) { console.error('avisarRespuesta:', e instanceof Error ? e.message : String(e)); }
}
