/**
 * DETALLE DE FACTURACIÓN (migración 019) — pre-liquidación con aprobación del cliente.
 *
 * Flujo: seleccionar procesos → generar DETALLE (borrador) → imprimir / enviar al cliente
 * (enviada) → el cliente aprueba (aprobada) → emitir la factura SAT (facturada).
 * 'anulada' libera los expedientes. Crear y anular van por RPC (reserva / liberación en
 * una transacción). Facturar reusa `emitirFacturaAgenda` (RPC de emisión + write-back, sin
 * tocar) exigiendo un detalle aprobado y exactamente sus expedientes.
 */
import { supabase } from '@/lib/supabase/client';
import { rpc } from '@/lib/supabase/writes';
import { nitComparable } from '@/lib/clientes/nit';
import { documentoDetalle, transicionValida, type CanalAprobacion, type DetalleFacturacion, type DocumentoDetalle, type EstadoDetalle, type RespuestaDetalle } from '@/lib/facturacion-agenda/detalle';
import type { ExpedienteLocal } from '@/lib/facturacion-agenda/tipos';
import { emitirFacturaAgenda, listarExpedientesLocal, pruebasDeDetalle, type EmitirResult } from './facturacion-agenda';
import type { PruebaLocal } from '@/lib/facturacion-agenda/tipos';
import { getClientes } from './clientes';
import { getCentrosCostoActivos, type CentroCosto } from './centros';
import type { AgendaApi } from '@/lib/facturacion-agenda/agenda-api';
import { archivosDeDetalle, type ArchivoDetalle } from './detalle-archivo';
import { resumenAperturas, type AperturaLink, type ResumenAperturas } from '@/lib/detalle-link/aperturas';

const FUENTE = 'agenda';

interface Row {
  id: string; fuente: string; cliente_id: string | null; nit: string; correlativo: string; estado: EstadoDetalle;
  subtotal: number | string; iva: number | string; total: number | string; expedientes: number; /** 024 */ pruebas?: number | null;
  creado_por: string | null; created_at: string; enviada_en: string | null; enviada_por: string | null;
  aprobada_en: string | null; aprobado_por: string | null; aprobado_canal: CanalAprobacion | null;
  factura_id: string | null; factura_app_id: string | null; no_factura: string | null; facturado_en: string | null;
  anulada_en: string | null; anulada_por: string | null; motivo_anulacion: string | null; notas: string | null; updated_at: string | null;
  /** 028 */ titulo?: string | null; dirigido_a?: string | null;
  /** 029 */ version?: number | null; destinatarios?: string[] | null; respondido_en?: string | null; respondido_por_nombre?: string | null; respondido_por_cargo?: string | null; respondido_por_correo?: string | null; firma_png?: string | null; documento_hash?: string | null;
}
const rowToDetalle = (r: Row): DetalleFacturacion => ({
  id: r.id, fuente: r.fuente, clienteId: r.cliente_id, nit: r.nit, correlativo: r.correlativo, estado: r.estado,
  subtotal: Number(r.subtotal), iva: Number(r.iva), total: Number(r.total), expedientes: Number(r.expedientes), pruebas: Number(r.pruebas ?? r.expedientes),
  creadoPor: r.creado_por ?? '', createdAt: r.created_at, enviadaEn: r.enviada_en, enviadaPor: r.enviada_por ?? '',
  aprobadaEn: r.aprobada_en, aprobadoPor: r.aprobado_por ?? '', aprobadoCanal: r.aprobado_canal,
  facturaId: r.factura_id, facturaAppId: r.factura_app_id, noFactura: r.no_factura, facturadoEn: r.facturado_en,
  anuladaEn: r.anulada_en, anuladaPor: r.anulada_por ?? '', motivoAnulacion: r.motivo_anulacion ?? '', notas: r.notas ?? '', updatedAt: r.updated_at,
  titulo: r.titulo ?? '', dirigidoA: r.dirigido_a ?? '',
  version: Number(r.version ?? 1), destinatarios: Array.isArray(r.destinatarios) ? r.destinatarios.map(String) : [],
  respondidoEn: r.respondido_en ?? null, respondidoPorNombre: r.respondido_por_nombre ?? '', respondidoPorCargo: r.respondido_por_cargo ?? '', respondidoPorCorreo: r.respondido_por_correo ?? '',
  firmaPng: r.firma_png ?? null, documentoHash: r.documento_hash ?? null,
});

/** 028: sin la migración, la base no tiene titulo / dirigido_a; el detalle se crea igual y el encabezado no se guarda. */
const falta028 = (m: string) => /titulo|dirigido_a/.test(m) && /column|schema cache/i.test(m);

/** Encabezado del detalle (028): título del corte y "dirigido a", limpios y acotados. */
export const encabezadoLimpio = (input: { titulo?: string | null; dirigidoA?: string | null }) => ({
  titulo: String(input.titulo ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || null,
  dirigido_a: String(input.dirigidoA ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || null,
});

/** true si la 019 está aplicada en esta base. */
export async function detallesDisponibles(): Promise<boolean> {
  const sb = supabase(); if (!sb) return false;
  const { error } = await sb.from('detalle_facturacion').select('id').limit(1);
  return !error;
}

export type DetalleResult = { ok: true; detalle: DetalleFacturacion } | { ok: false; error: string };

const errorLegible = (m: string): string => {
  if (/EXPEDIENTE_RESERVADO/.test(m)) return 'Alguno de los expedientes ya está en otro detalle de facturación.';
  if (/EXPEDIENTE_NO_FACTURABLE/.test(m)) return 'Solo entran pruebas con resultado cobrable, precio resuelto y en cola (pendientes, sin tarifa, sin mapear o ya facturadas no).';
  if (/DETALLE_VARIOS_CLIENTES/.test(m)) return 'Un detalle es de UN cliente: los expedientes elegidos son de clientes distintos.';
  if (/DETALLE_SIN_EXPEDIENTES/.test(m)) return 'Elegí al menos un expediente.';
  if (/EXPEDIENTE_DESCONOCIDO/.test(m)) return 'Algún expediente ya no está en la cola: recargá la pantalla.';
  if (/DETALLE_FACTURADO/.test(m)) return 'Un detalle facturado no se anula: anulá la factura.';
  if (/DETALLE_NO_EXISTE/.test(m)) return 'El detalle no existe.';
  if (/DETALLE_NO_EDITABLE/.test(m)) return 'Solo se quitan líneas de un detalle en borrador o con observaciones.';
  if (/LINEA_NO_ESTA/.test(m)) return 'Esa prueba ya no está en el detalle.';
  if (/DETALLE_NO_ENVIABLE/.test(m)) return 'Solo se envía un detalle en borrador, enviado o con observaciones.';
  if (/DETALLE_VACIO/.test(m)) return 'El detalle no tiene pruebas: no se puede enviar.';
  if (/detalle_facturacion_link|detalle_link_|quitar_linea|diferida_hasta/.test(m) && /does not exist|Could not find|schema cache/i.test(m)) return 'Falta aplicar la migración 029_detalle_aprobacion_digital en esta base.';
  if (/detalle_facturacion.*does not exist|Could not find the (table|function)/i.test(m)) return 'Falta aplicar la migración 019_detalle_facturacion en esta base.';
  return m.replace(/^detalle_facturacion_\w+: /, '');
};

/**
 * Crea el detalle en borrador y reserva sus PRUEBAS (024, RPC detalle_facturacion_crear_pruebas: todo o nada).
 * `componenteIds` = las pruebas elegidas; `idsExternos` (compatibilidad) = TODAS las pruebas facturables hoy de esos expedientes.
 */
export async function crearDetalle(input: { idsExternos?: string[]; componenteIds?: string[]; notas?: string; /** 028 */ titulo?: string; dirigidoA?: string }, actor: string): Promise<DetalleResult> {
  let ids = [...new Set((input.componenteIds ?? []).map(s => String(s).trim()).filter(Boolean))];
  if (!ids.length && input.idsExternos?.length) {
    const exps = await listarExpedientesLocal({ idsExternos: [...new Set(input.idsExternos.map(s => String(s).trim()).filter(Boolean))] });
    // Las pruebas cobrables con precio (también las reservadas: la RPC avisa "otro detalle"); sin factura.
    ids = exps.flatMap(e => e.pruebas.filter(p => p.situacion === 'cobra' && p.estadoTarifa === 'resuelta' && (p.montoCalculado ?? 0) > 0 && !p.facturaId).map(p => p.id));
    if (!ids.length) return { ok: false, error: 'Esos expedientes no tienen pruebas con resultado, precio resuelto y en cola.' };
  }
  if (!ids.length) return { ok: false, error: 'Elegí al menos una prueba.' };
  if (ids.length > 200) return { ok: false, error: 'Un detalle cubre hasta 200 pruebas (límite de la factura en la Agenda).' };
  try {
    const r = await rpc<Row>('detalle_facturacion_crear_pruebas', { p_actor: actor, p_componente_ids: ids, p_notas: (input.notas ?? '').trim().slice(0, 500) || null });
    // 028: título del corte y "dirigido a" (la RPC no cambia; sin la migración el detalle igual queda creado).
    const enc = encabezadoLimpio(input);
    if (enc.titulo || enc.dirigido_a) {
      const sb = supabase();
      const { data, error } = sb ? await sb.from('detalle_facturacion').update(enc).eq('id', r.id).select('*').maybeSingle() : { data: null, error: null };
      if (error && !falta028(error.message)) console.error('crearDetalle (encabezado 028):', error.message);
      if (data) return { ok: true, detalle: rowToDetalle(data as Row) };
    }
    return { ok: true, detalle: rowToDetalle(r) };
  } catch (e) { return { ok: false, error: errorLegible(e instanceof Error ? e.message : String(e)) }; }
}

export async function getDetalleBasico(id: string): Promise<DetalleFacturacion | null> {
  const sb = supabase(); if (!sb || !id) return null;
  const { data, error } = await sb.from('detalle_facturacion').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return rowToDetalle(data as Row);
}

export interface LinkDetalle { id: string; version: number; creadoEn: string; expiraEn: string; revocadoEn: string | null; abiertoEn: string | null; usadoEn: string | null; vigente: boolean; /** 031: hash de la red de quien envió (sus aperturas no cuentan) */ creadorIpHash: string | null }
export interface EnvioDetalle { id: string; version: number; tipo: 'envio' | 'aviso'; destinatarios: string[]; cc: string[]; asunto: string; modo: string; resultado: string; error: string; enviadoPor: string; createdAt: string }
export interface DetalleCompleto {
  detalle: DetalleFacturacion; expedientes: ExpedienteLocal[]; /** 024: las pruebas reservadas en el detalle */ pruebas: PruebaLocal[]; documento: DocumentoDetalle;
  clienteNombre: string; clienteAppId: string | null; centros: CentroCosto[]; empresaNombreExterno: string;
  /** 029: respuestas del cliente (todas las versiones), el último link y la bitácora de envíos; correos sugeridos del cliente. */
  respuestas: RespuestaDetalle[]; link: LinkDetalle | null; envios: EnvioDetalle[]; correosCliente: string[];
  /** 032: el detalle firmado en papel (vigentes y anteriores, el más nuevo primero; miniaturas firmadas de 5 min para las imágenes). Sin la 032 → []. */
  archivos: ArchivoDetalle[];
  /** 031: todos los links (el más nuevo primero; `link` es el primero) y las aperturas (todas las versiones, la más nueva primero). Sin la 031 → []. */
  links: LinkDetalle[]; aperturas: AperturaLink[];
}

const rowToRespuesta = (r: Record<string, unknown>): RespuestaDetalle => ({ id: String(r.id), version: Number(r.version), componenteId: String(r.componente_id), decision: r.decision as RespuestaDetalle['decision'], nota: String(r.nota ?? ''), respuestaGolden: String(r.respuesta_golden ?? ''), createdAt: String(r.created_at ?? '') });
const rowToLink = (r: Record<string, unknown>): LinkDetalle => { const revocadoEn = (r.revocado_en as string | null) ?? null, usadoEn = (r.usado_en as string | null) ?? null, expiraEn = String(r.expira_en); return { id: String(r.id), version: Number(r.version), creadoEn: String(r.creado_en), expiraEn, revocadoEn, abiertoEn: (r.abierto_en as string | null) ?? null, usadoEn, vigente: !revocadoEn && !usadoEn && Date.parse(expiraEn) > Date.now(), creadorIpHash: (r.creador_ip_hash as string | null) ?? null }; };
const DISPOSITIVOS = new Set(['movil', 'escritorio', 'tablet', 'desconocido']);
const rowToApertura = (r: Record<string, unknown>): AperturaLink => ({ id: String(r.id), linkId: String(r.link_id), version: Number(r.version), abiertoEn: String(r.abierto_en), dispositivo: (DISPOSITIVOS.has(String(r.dispositivo)) ? String(r.dispositivo) : 'desconocido') as AperturaLink['dispositivo'], navegador: String(r.navegador ?? 'desconocido'), ipHash: (r.ip_hash as string | null) ?? null, respondio: r.respondio === true });
const rowToEnvio = (r: Record<string, unknown>): EnvioDetalle => ({ id: String(r.id), version: Number(r.version), tipo: (r.tipo as 'envio' | 'aviso') ?? 'envio', destinatarios: Array.isArray(r.destinatarios) ? r.destinatarios.map(String) : [], cc: Array.isArray(r.cc) ? r.cc.map(String) : [], asunto: String(r.asunto ?? ''), modo: String(r.modo ?? ''), resultado: String(r.resultado ?? ''), error: String(r.error ?? ''), enviadoPor: String(r.enviado_por ?? ''), createdAt: String(r.created_at ?? '') });

/** 029: respuestas del cliente de un detalle (todas las versiones, la última primero). Sin la 029 → []. */
export async function respuestasDeDetalle(id: string): Promise<RespuestaDetalle[]> {
  const sb = supabase(); if (!sb) return [];
  const { data, error } = await sb.from('detalle_facturacion_respuesta').select('*').eq('detalle_id', id).order('version', { ascending: false }).order('created_at');
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map(rowToRespuesta);
}
/** 029/031: los links emitidos del detalle, el más nuevo primero (sin el token: en la base solo vive su hash). */
export async function linksDeDetalle(id: string): Promise<LinkDetalle[]> {
  const sb = supabase(); if (!sb) return [];
  // select('*'): en una base sin la 031 no existe creador_ip_hash y pedirla a mano tiraría los links enteros
  const { data, error } = await sb.from('detalle_facturacion_link').select('*').eq('detalle_id', id).order('creado_en', { ascending: false }).limit(50);
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map(rowToLink);
}
/** 029: el último link emitido del detalle. */
export async function ultimoLinkDeDetalle(id: string): Promise<LinkDetalle | null> { return (await linksDeDetalle(id))[0] ?? null; }
/** 031: aperturas del link del detalle (todas las versiones, la más nueva primero). Sin la 031 → []. */
export async function aperturasDeDetalle(id: string): Promise<AperturaLink[]> {
  const sb = supabase(); if (!sb) return [];
  const { data, error } = await sb.from('detalle_facturacion_link_apertura').select('*').eq('detalle_id', id).order('abierto_en', { ascending: false }).limit(500);
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map(rowToApertura);
}
/**
 * 031: para la lista de Por facturar: el resumen de aperturas del ÚLTIMO link de cada detalle (las de la red de quien
 * envió no cuentan). Dos consultas (links → aperturas), fail-soft: sin la 031 → {}.
 */
export async function resumenAperturasPorDetalle(detalleIds: string[]): Promise<Record<string, ResumenAperturas>> {
  const sb = supabase(); const ids = [...new Set(detalleIds)].filter(x => /^[0-9a-f-]{36}$/i.test(x)); if (!sb || !ids.length) return {};
  const { data: links, error } = await sb.from('detalle_facturacion_link').select('*').in('detalle_id', ids).order('creado_en', { ascending: false }).limit(2000);
  if (error || !links?.length) return {};
  const ultimo = new Map<string, LinkDetalle & { detalleId: string }>();
  for (const r of links as Record<string, unknown>[]) { const d = String(r.detalle_id); if (!ultimo.has(d)) ultimo.set(d, { ...rowToLink(r), detalleId: d }); }
  const { data: aps, error: e2 } = await sb.from('detalle_facturacion_link_apertura').select('*').in('link_id', [...ultimo.values()].map(l => l.id)).limit(5000);
  if (e2) return {};
  const porLink = new Map<string, AperturaLink[]>();
  for (const r of (aps ?? []) as Record<string, unknown>[]) { const a = rowToApertura(r); porLink.set(a.linkId, [...(porLink.get(a.linkId) ?? []), a]); }
  const out: Record<string, ResumenAperturas> = {};
  for (const l of ultimo.values()) out[l.detalleId] = resumenAperturas(porLink.get(l.id) ?? [], l.creadorIpHash);
  return out;
}
export async function enviosDeDetalle(id: string): Promise<EnvioDetalle[]> {
  const sb = supabase(); if (!sb) return [];
  const { data, error } = await sb.from('detalle_facturacion_envio').select('*').eq('detalle_id', id).order('created_at', { ascending: false }).limit(50);
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map(rowToEnvio);
}
/** Correos del cliente (email_cobros / correo_cobro) para sugerir destinatarios. */
export async function correosDelCliente(nit: string): Promise<string[]> {
  const sb = supabase(); if (!sb) return [];
  const { data } = await sb.from('clientes').select('nit, email_cobros, correo_cobro, activo');
  const re = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const out = new Set<string>();
  for (const c of (data ?? []) as { nit: string | null; email_cobros: string | null; correo_cobro: string | null; activo: boolean | null }[]) {
    if (c.activo === false || nitComparable(c.nit) !== nitComparable(nit)) continue;
    for (const v of [c.email_cobros, c.correo_cobro]) for (const x of String(v ?? '').split(/[,;\s]+/)) { const t = x.trim().toLowerCase(); if (re.test(t)) out.add(t); }
  }
  return [...out];
}

/** El detalle con sus pruebas y expedientes, el documento imprimible (faltantes marcados) y el cliente. */
export async function getDetalle(id: string): Promise<DetalleCompleto | null> {
  const detalle = await getDetalleBasico(id); if (!detalle) return null;
  const [pruebas, expedientes, clientes, centros, respuestas, links, envios, correosCliente, aperturas, archivos] = await Promise.all([pruebasDeDetalle(id), listarExpedientesLocal({ detalleId: id }), getClientes(), getCentrosCostoActivos(), respuestasDeDetalle(id), linksDeDetalle(id), enviosDeDetalle(id), correosDelCliente(detalle.nit), aperturasDeDetalle(id), archivosDeDetalle(id, { miniaturas: true })]);
  const link = links[0] ?? null;
  // Una facturada conserva detalle_id en sus pruebas (histórico); una anulada las liberó (la lista queda vacía).
  const c = clientes.find(x => x.activo !== false && nitComparable(x.nit) === detalle.nit) ?? clientes.find(x => nitComparable(x.nit) === detalle.nit);
  return { detalle, expedientes, pruebas, documento: documentoDetalle(expedientes, pruebas), clienteNombre: c?.name ?? expedientes.find(e => e.empresaNombreExterno)?.empresaNombreExterno ?? `NIT ${detalle.nit}`, clienteAppId: c?.id ?? null, centros, empresaNombreExterno: expedientes.find(e => e.empresaNombreExterno)?.empresaNombreExterno ?? '', respuestas, link, links, envios, correosCliente, aperturas, archivos };
}

export async function listarDetalles(f: { nit?: string; estados?: EstadoDetalle[]; limite?: number } = {}): Promise<DetalleFacturacion[]> {
  const sb = supabase(); if (!sb) return [];
  let q = sb.from('detalle_facturacion').select('*').eq('fuente', FUENTE).order('created_at', { ascending: false }).limit(Math.min(f.limite ?? 300, 1000));
  if (f.nit) q = q.eq('nit', f.nit);
  if (f.estados?.length) q = q.in('estado', f.estados);
  const { data, error } = await q;
  if (error) { if (!/detalle_facturacion/.test(error.message)) console.error('listarDetalles:', error.message); return []; }
  return ((data ?? []) as Row[]).map(rowToDetalle);
}

async function transicion(id: string, a: EstadoDetalle, patch: Record<string, unknown>): Promise<DetalleResult> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
  const d = await getDetalleBasico(id); if (!d) return { ok: false, error: 'El detalle no existe.' };
  if (!transicionValida(d.estado, a)) return { ok: false, error: `El detalle ${d.correlativo} está en "${d.estado}": no puede pasar a "${a}".` };
  const { data, error } = await sb.from('detalle_facturacion').update({ ...patch, estado: a, updated_at: new Date().toISOString() }).eq('id', id).eq('estado', d.estado).select('*').maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'El detalle cambió de estado mientras tanto: recargá.' };
  return { ok: true, detalle: rowToDetalle(data as Row) };
}

/** 028: editar el título del corte y "dirigido a" mientras el detalle no esté facturado ni anulado. */
export async function editarEncabezadoDetalle(id: string, input: { titulo?: string | null; dirigidoA?: string | null }, actor: string): Promise<DetalleResult> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
  const d = await getDetalleBasico(id); if (!d) return { ok: false, error: 'El detalle no existe.' };
  if (d.estado === 'facturada' || d.estado === 'anulada') return { ok: false, error: `El detalle ${d.correlativo} está ${d.estado}: su encabezado ya no se edita.` };
  void actor;
  const { data, error } = await sb.from('detalle_facturacion').update({ ...encabezadoLimpio(input), updated_at: new Date().toISOString() }).eq('id', id).select('*').maybeSingle();
  if (error) return { ok: false, error: falta028(error.message) ? 'Falta aplicar la migración 028_detalle_titulo_dirigido en esta base.' : error.message };
  if (!data) return { ok: false, error: 'El detalle no existe.' };
  return { ok: true, detalle: rowToDetalle(data as Row) };
}

/** borrador → enviada (se mandó al cliente por correo). */
export const marcarEnviada = (id: string, actor: string): Promise<DetalleResult> => transicion(id, 'enviada', { enviada_en: new Date().toISOString(), enviada_por: actor });

/** enviada → aprobada: quién aprobó del lado del cliente y por qué canal. */
export async function marcarAprobada(id: string, input: { aprobadoPor: string; canal?: CanalAprobacion }, actor: string): Promise<DetalleResult> {
  const quien = String(input.aprobadoPor ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
  if (!quien) return { ok: false, error: 'Indicá quién aprobó el detalle del lado del cliente.' };
  const canal: CanalAprobacion = input.canal === 'link' || input.canal === 'otro' || input.canal === 'papel' ? input.canal : 'correo';
  const r = await transicion(id, 'aprobada', { aprobada_en: new Date().toISOString(), aprobado_por: quien, aprobado_canal: canal });
  // CENTRO DE COBROS (033): la aprobación entra al historial de cobranza del cliente (fail-soft)
  if (r.ok) { try { const { registrarEventoAutomatico } = await import('./cobranza'); await registrarEventoAutomatico({ idApp: r.detalle.clienteId ?? `n-${r.detalle.nit}` }, { tipo: 'detalle_aprobado', comentario: `Detalle ${r.detalle.correlativo} aprobado por ${quien} (${canal})`, monto: r.detalle.total, actor, datos: { detalleId: id, canal } }); } catch { /* sin historial */ } }
  return r;
}

/** 029: quita una línea del detalle (borrador / con observaciones): la prueba vuelve a la cola, los totales se recalculan; opcionalmente queda diferida. */
export async function quitarLineaDetalle(id: string, componenteId: string, input: { motivo?: string; diferirHasta?: string | null }, actor: string): Promise<DetalleResult> {
  const dif = input.diferirHasta && /^\d{4}-\d{2}-\d{2}$/.test(input.diferirHasta) ? input.diferirHasta : null;
  try {
    const r = await rpc<Row>('detalle_facturacion_quitar_linea', { p_actor: actor, p_detalle_id: id, p_componente_id: componenteId, p_motivo: (input.motivo ?? '').trim().slice(0, 300) || null, p_diferir_hasta: dif });
    return { ok: true, detalle: rowToDetalle(r) };
  } catch (e) { return { ok: false, error: errorLegible(e instanceof Error ? e.message : String(e)) }; }
}
/** 029: respuesta de Golden a la nota del cliente en una línea (la verá en la versión siguiente). */
export async function responderNotaDetalle(id: string, componenteId: string, respuesta: string, actor: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
  const d = await getDetalleBasico(id); if (!d) return { ok: false, error: 'El detalle no existe.' };
  const { error } = await sb.from('detalle_facturacion_respuesta').update({ respuesta_golden: respuesta.trim().slice(0, 500) || null, respondida_por: actor, updated_at: new Date().toISOString() }).eq('detalle_id', id).eq('version', d.version).eq('componente_id', componenteId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Anula y libera los expedientes (RPC). No una facturada. */
export async function anularDetalle(id: string, motivo: string, actor: string): Promise<DetalleResult> {
  try {
    const r = await rpc<Row>('detalle_facturacion_anular', { p_actor: actor, p_id: id, p_motivo: (motivo ?? '').trim().slice(0, 300) || null });
    return { ok: true, detalle: rowToDetalle(r) };
  } catch (e) { return { ok: false, error: errorLegible(e instanceof Error ? e.message : String(e)) }; }
}

export type FacturarDetalleResult = (EmitirResult & { ok: true; detalle: DetalleFacturacion }) | { ok: false; error: string };

/** aprobada → facturada: emite la factura (RPC 016 + write-back, sin tocar) con exactamente los expedientes del detalle. */
export async function facturarDetalle(id: string, input: { noFactura: string; fechaEmision: string; centroPorTipo?: Record<string, string> }, actor: string, opts: { api?: AgendaApi } = {}): Promise<FacturarDetalleResult> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
  const d = await getDetalleBasico(id); if (!d) return { ok: false, error: 'El detalle no existe.' };
  if (d.estado !== 'aprobada') return { ok: false, error: `El detalle ${d.correlativo} está en "${d.estado}": solo se factura un detalle aprobado por el cliente.` };
  const pruebas = await pruebasDeDetalle(id);
  if (!pruebas.length) return { ok: false, error: 'El detalle no tiene pruebas.' };
  const r = await emitirFacturaAgenda({ componenteIds: pruebas.map(p => p.id), noFactura: input.noFactura, fechaEmision: input.fechaEmision, centroPorTipo: input.centroPorTipo, detalleId: id }, actor, { api: opts.api });
  if (!r.ok) return r;
  const { data } = await sb.from('detalle_facturacion').update({ estado: 'facturada', factura_app_id: r.facturaAppId, no_factura: r.noFactura, facturado_en: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id).select('*').maybeSingle();
  // factura_id (uuid) desde la fila principal
  const { data: fac } = await sb.from('facturas_clientes').select('id').eq('airtable_id', r.facturaAppId).maybeSingle();
  if (fac) await sb.from('detalle_facturacion').update({ factura_id: (fac as { id: string }).id }).eq('id', id);
  const detalle = data ? rowToDetalle(data as Row) : (await getDetalleBasico(id))!;
  return { ...r, detalle };
}
