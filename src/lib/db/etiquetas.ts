// ============================================================
// F-ETIQUETAS — Etiquetas de documentos (facturas Y gastos).
//
// Modelo confirmado: tabla `etiquetas` COMPARTIDA + puente POR TIPO
// con FK real y cascade (integridad en la base); la generalidad vive
// acá — una sola implementación parametrizada por tipo de documento.
// Agregar un tipo nuevo = 1 tabla puente (molde de 5 líneas en la
// migración 008) + 1 entrada en TIPOS_DOCUMENTO.
//
// Metadata PURA: cero efecto contable (motores/RPCs no leen esto).
// En facturas multi-línea el vínculo va a la LÍNEA PRINCIPAL (el
// record que la app usa como Invoice.id). Fail-soft completo mientras
// la 008 no esté aplicada (listas vacías, escrituras con error claro).
// ============================================================

import { dataSource, writeSource } from '../config/data-source';
import { fetchAll, supabase } from '../supabase/client';
import { uuidRequerido } from '../supabase/writes';

export type TipoDocumentoEtiqueta = 'factura' | 'gasto';

const TIPOS_DOCUMENTO: Record<TipoDocumentoEtiqueta, { puente: string; fk: string; tablaDoc: string }> = {
  factura: { puente: 'factura_etiquetas', fk: 'factura_id', tablaDoc: 'facturas_clientes' },
  gasto:   { puente: 'gasto_etiquetas',   fk: 'gasto_id',   tablaDoc: 'gastos' },
};

export interface Etiqueta {
  id: string;            // uuid (sin id de app: tablas nacidas en Supabase)
  nombre: string;
  color: string | null;
}

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Color automático estable por nombre, para chips sin color elegido.
const PALETA = ['#6d28d9', '#1d4ed8', '#0f766e', '#b45309', '#9f1239', '#4d7c0f', '#0e7490', '#86198f'];
export function colorEtiqueta(e: { nombre: string; color: string | null }): string {
  if (e.color) return e.color;
  let h = 0;
  for (const ch of norm(e.nombre)) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return PALETA[h % PALETA.length];
}

/** Todas las etiquetas (compartidas entre tipos). Fail-soft: []. */
export async function getEtiquetas(): Promise<Etiqueta[]> {
  if (dataSource('etiquetas') !== 'supabase') return [];
  try {
    const rows = await fetchAll<{ id: string; nombre: string; color: string | null }>(
      'etiquetas', { select: 'id, nombre, color' });
    return rows
      .map(r => ({ id: String(r.id), nombre: String(r.nombre), color: r.color ?? null }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  } catch {
    return [];
  }
}

/** Crea o REUSA (case/acento-insensible, estilo Gmail/Trello) una etiqueta. */
export async function obtenerOCrearEtiqueta(nombre: string): Promise<Etiqueta> {
  if (writeSource('facturacion') !== 'supabase') throw new Error('Las etiquetas requieren el backend Supabase.');
  const limpio = nombre.replace(/\s+/g, ' ').trim();
  if (!limpio) throw new Error('El nombre de la etiqueta no puede estar vacío.');
  const ya = (await getEtiquetas()).find(e => norm(e.nombre) === norm(limpio));
  if (ya) return ya;
  const sb = supabase();
  if (!sb) throw new Error('Supabase no está configurado.');
  const { data, error } = await sb.from('etiquetas')
    .insert({ nombre: limpio }).select('id, nombre, color').single();
  if (error) {
    if (error.code === '23505') {   // carrera con el unique → reusar
      const otra = (await getEtiquetas()).find(e => norm(e.nombre) === norm(limpio));
      if (otra) return otra;
    }
    throw new Error(`etiquetas: ${error.message}`);
  }
  return { id: String(data.id), nombre: String(data.nombre), color: data.color ?? null };
}

/** Reemplaza el set de etiquetas de un documento (por nombres; crea las que falten). */
export async function setEtiquetasDocumento(
  tipo: TipoDocumentoEtiqueta, docAppId: string, nombres: string[],
): Promise<Etiqueta[]> {
  if (writeSource('facturacion') !== 'supabase') throw new Error('Las etiquetas requieren el backend Supabase.');
  const cfg = TIPOS_DOCUMENTO[tipo];
  const sb = supabase();
  if (!sb) throw new Error('Supabase no está configurado.');
  const docUuid = await uuidRequerido(cfg.tablaDoc, docAppId, `setEtiquetas.${tipo}`);
  const limpios = [...new Set(nombres.map(n => n.replace(/\s+/g, ' ').trim()).filter(Boolean))];
  const etiquetas: Etiqueta[] = [];
  for (const n of limpios) etiquetas.push(await obtenerOCrearEtiqueta(n));
  const { error: delErr } = await sb.from(cfg.puente).delete().eq(cfg.fk, docUuid);
  if (delErr) throw new Error(`${cfg.puente}: ${delErr.message}`);
  if (etiquetas.length > 0) {
    const { error } = await sb.from(cfg.puente)
      .insert(etiquetas.map(e => ({ [cfg.fk]: docUuid, etiqueta_id: e.id })));
    if (error) throw new Error(`${cfg.puente}: ${error.message}`);
  }
  return etiquetas;
}

/** Etiquetas de UN documento. Fail-soft: []. */
export async function getEtiquetasDeDocumento(
  tipo: TipoDocumentoEtiqueta, docAppId: string,
): Promise<Etiqueta[]> {
  if (dataSource('etiquetas') !== 'supabase') return [];
  try {
    const cfg = TIPOS_DOCUMENTO[tipo];
    const sb = supabase();
    if (!sb) return [];
    const docUuid = await uuidRequerido(cfg.tablaDoc, docAppId, `getEtiquetas.${tipo}`);
    const { data, error } = await sb.from(cfg.puente)
      .select('etiqueta:etiquetas(id, nombre, color)').eq(cfg.fk, docUuid);
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown as Array<{ etiqueta: { id: string; nombre: string; color: string | null } | null }>)
      .filter(r => r.etiqueta)
      .map(r => ({ id: String(r.etiqueta!.id), nombre: String(r.etiqueta!.nombre), color: r.etiqueta!.color ?? null }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  } catch {
    return [];
  }
}

/** Mapa docAppId → etiquetas, por tipo (para listados y filtros). Fail-soft: {}. */
export async function getEtiquetasPorDocumento(
  tipo: TipoDocumentoEtiqueta,
): Promise<Record<string, Etiqueta[]>> {
  if (dataSource('etiquetas') !== 'supabase') return {};
  try {
    const cfg = TIPOS_DOCUMENTO[tipo];
    const rows = await fetchAll<{
      doc: { airtable_id: string } | null;
      etiqueta: { id: string; nombre: string; color: string | null } | null;
    }>(cfg.puente, { select: `doc:${cfg.tablaDoc}(airtable_id), etiqueta:etiquetas(id, nombre, color)` });
    const out: Record<string, Etiqueta[]> = {};
    for (const r of rows) {
      if (!r.doc?.airtable_id || !r.etiqueta) continue;
      (out[r.doc.airtable_id] ??= []).push({
        id: String(r.etiqueta.id), nombre: String(r.etiqueta.nombre), color: r.etiqueta.color ?? null,
      });
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => a.nombre.localeCompare(b.nombre));
    return out;
  } catch {
    return {};
  }
}

/** Uso por etiqueta (facturas + gastos), para la gestión y el borrado. */
export async function getUsoEtiquetas(): Promise<Record<string, { facturas: number; gastos: number }>> {
  if (dataSource('etiquetas') !== 'supabase') return {};
  const out: Record<string, { facturas: number; gastos: number }> = {};
  for (const [tipo, campo] of [['factura', 'facturas'], ['gasto', 'gastos']] as const) {
    try {
      const rows = await fetchAll<{ etiqueta_id: string }>(TIPOS_DOCUMENTO[tipo].puente, { select: 'etiqueta_id' });
      for (const r of rows) {
        const e = (out[String(r.etiqueta_id)] ??= { facturas: 0, gastos: 0 });
        e[campo]++;
      }
    } catch { /* tabla pendiente → 0 */ }
  }
  return out;
}

/** Gestión: renombrar / cambiar color (choque de nombre bloqueado). */
export async function editarEtiqueta(
  id: string, cambios: { nombre?: string; color?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (writeSource('facturacion') !== 'supabase') return { ok: false, error: 'Requiere Supabase.' };
  const sb = supabase();
  if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
  const patch: Record<string, unknown> = {};
  if (cambios.nombre !== undefined) {
    const limpio = cambios.nombre.replace(/\s+/g, ' ').trim();
    if (!limpio) return { ok: false, error: 'El nombre no puede quedar vacío.' };
    const choque = (await getEtiquetas()).find(e => e.id !== id && norm(e.nombre) === norm(limpio));
    if (choque) return { ok: false, error: `Ya existe la etiqueta "${choque.nombre}".` };
    patch.nombre = limpio;
  }
  if (cambios.color !== undefined) patch.color = cambios.color;
  const { error } = await sb.from('etiquetas').update(patch).eq('id', id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Gestión: borrar (los puentes caen en cascada; el caller confirma si tiene uso). */
export async function borrarEtiqueta(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (writeSource('facturacion') !== 'supabase') return { ok: false, error: 'Requiere Supabase.' };
  const sb = supabase();
  if (!sb) return { ok: false, error: 'Supabase no está configurado.' };
  const { error } = await sb.from('etiquetas').delete().eq('id', id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Mapa facturaInAppId → etiquetas DEL GASTO que generó (para la bandeja
 * de /gastos, donde las filas son FACTURAS_IN). Embed anidado con hint:
 * gastos↔facturas_in tiene DOS FKs (gastos.factura_in_id y
 * facturas_in.gasto_id) — sin hint, PGRST201.
 */
export async function getEtiquetasPorFacturaIn(): Promise<Record<string, Etiqueta[]>> {
  if (dataSource('etiquetas') !== 'supabase') return {};
  try {
    const rows = await fetchAll<{
      etiqueta: { id: string; nombre: string; color: string | null } | null;
      gasto: { factura_in: { airtable_id: string } | null } | null;
    }>('gasto_etiquetas', {
      select: 'etiqueta:etiquetas(id, nombre, color), gasto:gastos(factura_in:facturas_in!gastos_factura_in_id_fkey(airtable_id))',
    });
    const out: Record<string, Etiqueta[]> = {};
    for (const r of rows) {
      const fiId = r.gasto?.factura_in?.airtable_id;
      if (!fiId || !r.etiqueta) continue;
      (out[fiId] ??= []).push({ id: String(r.etiqueta.id), nombre: String(r.etiqueta.nombre), color: r.etiqueta.color ?? null });
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => a.nombre.localeCompare(b.nombre));
    return out;
  } catch {
    return {};
  }
}
