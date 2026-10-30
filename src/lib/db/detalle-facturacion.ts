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
import { documentoDetalle, transicionValida, type CanalAprobacion, type DetalleFacturacion, type DocumentoDetalle, type EstadoDetalle } from '@/lib/facturacion-agenda/detalle';
import type { ExpedienteLocal } from '@/lib/facturacion-agenda/tipos';
import { emitirFacturaAgenda, listarExpedientesLocal, pruebasDeDetalle, type EmitirResult } from './facturacion-agenda';
import type { PruebaLocal } from '@/lib/facturacion-agenda/tipos';
import { getClientes } from './clientes';
import { getCentrosCostoActivos, type CentroCosto } from './centros';
import type { AgendaApi } from '@/lib/facturacion-agenda/agenda-api';

const FUENTE = 'agenda';

interface Row {
  id: string; fuente: string; cliente_id: string | null; nit: string; correlativo: string; estado: EstadoDetalle;
  subtotal: number | string; iva: number | string; total: number | string; expedientes: number; /** 024 */ pruebas?: number | null;
  creado_por: string | null; created_at: string; enviada_en: string | null; enviada_por: string | null;
  aprobada_en: string | null; aprobado_por: string | null; aprobado_canal: CanalAprobacion | null;
  factura_id: string | null; factura_app_id: string | null; no_factura: string | null; facturado_en: string | null;
  anulada_en: string | null; anulada_por: string | null; motivo_anulacion: string | null; notas: string | null; updated_at: string | null;
}
const rowToDetalle = (r: Row): DetalleFacturacion => ({
  id: r.id, fuente: r.fuente, clienteId: r.cliente_id, nit: r.nit, correlativo: r.correlativo, estado: r.estado,
  subtotal: Number(r.subtotal), iva: Number(r.iva), total: Number(r.total), expedientes: Number(r.expedientes), pruebas: Number(r.pruebas ?? r.expedientes),
  creadoPor: r.creado_por ?? '', createdAt: r.created_at, enviadaEn: r.enviada_en, enviadaPor: r.enviada_por ?? '',
  aprobadaEn: r.aprobada_en, aprobadoPor: r.aprobado_por ?? '', aprobadoCanal: r.aprobado_canal,
  facturaId: r.factura_id, facturaAppId: r.factura_app_id, noFactura: r.no_factura, facturadoEn: r.facturado_en,
  anuladaEn: r.anulada_en, anuladaPor: r.anulada_por ?? '', motivoAnulacion: r.motivo_anulacion ?? '', notas: r.notas ?? '', updatedAt: r.updated_at,
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
  if (/detalle_facturacion.*does not exist|Could not find the (table|function)/i.test(m)) return 'Falta aplicar la migración 019_detalle_facturacion en esta base.';
  return m.replace(/^detalle_facturacion_\w+: /, '');
};

/**
 * Crea el detalle en borrador y reserva sus PRUEBAS (024, RPC detalle_facturacion_crear_pruebas: todo o nada).
 * `componenteIds` = las pruebas elegidas; `idsExternos` (compatibilidad) = TODAS las pruebas facturables hoy de esos expedientes.
 */
export async function crearDetalle(input: { idsExternos?: string[]; componenteIds?: string[]; notas?: string }, actor: string): Promise<DetalleResult> {
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
    return { ok: true, detalle: rowToDetalle(r) };
  } catch (e) { return { ok: false, error: errorLegible(e instanceof Error ? e.message : String(e)) }; }
}

export async function getDetalleBasico(id: string): Promise<DetalleFacturacion | null> {
  const sb = supabase(); if (!sb || !id) return null;
  const { data, error } = await sb.from('detalle_facturacion').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return rowToDetalle(data as Row);
}

export interface DetalleCompleto { detalle: DetalleFacturacion; expedientes: ExpedienteLocal[]; /** 024: las pruebas reservadas en el detalle */ pruebas: PruebaLocal[]; documento: DocumentoDetalle; clienteNombre: string; clienteAppId: string | null; centros: CentroCosto[]; empresaNombreExterno: string }

/** El detalle con sus pruebas y expedientes, el documento imprimible (faltantes marcados) y el cliente. */
export async function getDetalle(id: string): Promise<DetalleCompleto | null> {
  const detalle = await getDetalleBasico(id); if (!detalle) return null;
  const [pruebas, expedientes, clientes, centros] = await Promise.all([pruebasDeDetalle(id), listarExpedientesLocal({ detalleId: id }), getClientes(), getCentrosCostoActivos()]);
  // Una facturada conserva detalle_id en sus pruebas (histórico); una anulada las liberó (la lista queda vacía).
  const c = clientes.find(x => x.activo !== false && nitComparable(x.nit) === detalle.nit) ?? clientes.find(x => nitComparable(x.nit) === detalle.nit);
  return { detalle, expedientes, pruebas, documento: documentoDetalle(expedientes, pruebas), clienteNombre: c?.name ?? expedientes.find(e => e.empresaNombreExterno)?.empresaNombreExterno ?? `NIT ${detalle.nit}`, clienteAppId: c?.id ?? null, centros, empresaNombreExterno: expedientes.find(e => e.empresaNombreExterno)?.empresaNombreExterno ?? '' };
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

/** borrador → enviada (se mandó al cliente por correo). */
export const marcarEnviada = (id: string, actor: string): Promise<DetalleResult> => transicion(id, 'enviada', { enviada_en: new Date().toISOString(), enviada_por: actor });

/** enviada → aprobada: quién aprobó del lado del cliente y por qué canal. */
export async function marcarAprobada(id: string, input: { aprobadoPor: string; canal?: CanalAprobacion }, actor: string): Promise<DetalleResult> {
  const quien = String(input.aprobadoPor ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
  if (!quien) return { ok: false, error: 'Indicá quién aprobó el detalle del lado del cliente.' };
  const canal: CanalAprobacion = input.canal === 'link' || input.canal === 'otro' ? input.canal : 'correo';
  void actor;   // quien registra la aprobación queda en el log de la app; el detalle guarda quién aprobó del lado del cliente
  return transicion(id, 'aprobada', { aprobada_en: new Date().toISOString(), aprobado_por: quien, aprobado_canal: canal });
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
