/**
 * TARIFARIO (migración 014) — lectura y escritura en Supabase.
 * Tabla `tarifario`: una fila por (NIT, tipo de prueba, categoría,
 * territorio) con el monto SIN IVA. Solo Supabase (no existe en Airtable).
 */
import { supabase, fetchAll } from '@/lib/supabase/client';
import { nitComparable, nitEsPlaceholder } from '@/lib/clientes/nit';
import { canonCategoria, canonTerritorio, canonTipoPrueba, normalizarTexto, round2 } from '@/lib/tarifario/canon';
import { buscarDuplicado, resolverTarifa, type AliasCliente, type Expediente, type ResultadoLookup, type Tarifa } from '@/lib/tarifario/lookup';
import { resumenPorEmpresa, type EmpresaTarifario } from '@/lib/tarifario/resumen';
import { getClientes, nitValido } from './clientes';

interface Row {
  id: string; nit: string; razon_social: string | null; tipo_prueba: string; categoria: string; territorio: string;
  monto: number | string; anio: string | null; aprobado_por: string | null; aprobado_en: string | null; activo: boolean;
}

const rowToTarifa = (r: Row): Tarifa => ({
  id: r.id, nit: r.nit, razonSocial: r.razon_social ?? '', tipoPrueba: r.tipo_prueba, categoria: r.categoria, territorio: r.territorio,
  monto: Number(r.monto), anio: r.anio ?? '', aprobadoPor: r.aprobado_por ?? '', aprobadoEn: r.aprobado_en, activo: !!r.activo,
});

/** true si la tabla existe en esta base (migración 014 aplicada). */
export async function tarifarioDisponible(): Promise<boolean> {
  const sb = supabase(); if (!sb) return false;
  const { error } = await sb.from('tarifario').select('id').limit(1);   // GET: un HEAD sobre tabla inexistente falla en silencio
  return !error;
}

export async function getTarifario(): Promise<Tarifa[]> {
  const rows = await fetchAll<Row>('tarifario', { order: { column: 'razon_social', ascending: true } });
  return rows.map(rowToTarifa);
}

/** MAESTRO: una fila por NIT con conteos (activas / pendientes / Q0) y semáforo, ordenadas por acción requerida. */
export async function listarEmpresasTarifario(): Promise<EmpresaTarifario[]> {
  return resumenPorEmpresa(await getTarifario());
}

/** DETALLE: las tarifas de un NIT (activas e inactivas; la pantalla filtra). El NIT se compara normalizado. */
export async function listarTarifasPorNit(nit: string): Promise<Tarifa[]> {
  const k = nitComparable(nit);
  if (!k) return [];
  const rows = await fetchAll<Row>('tarifario', { eq: { nit: k }, order: { column: 'tipo_prueba', ascending: true } });
  return rows.map(rowToTarifa);
}

export type AprobarLoteResult = { ok: true; aprobadas: number; omitidasQ0: number; mensaje: string } | { ok: false; error: string };

/** Aprueba en lote las pendientes de un cliente: activas, sin aprobar y con monto. Las Q0 quedan fuera. */
export async function aprobarTarifasPorNit(nit: string, actor: string): Promise<AprobarLoteResult> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'El tarifario requiere el backend Supabase.' };
  const k = nitComparable(nit);
  if (!k) return { ok: false, error: 'NIT inválido.' };
  const propias = await listarTarifasPorNit(k);
  const activas = propias.filter(t => t.activo);
  if (activas.length === 0) return { ok: false, error: `El NIT ${k} no tiene tarifas activas.` };
  const aprobables = activas.filter(t => !t.aprobadoEn && t.monto > 0);
  const omitidasQ0 = activas.filter(t => t.monto <= 0).length;
  if (aprobables.length === 0) return { ok: true, aprobadas: 0, omitidasQ0, mensaje: omitidasQ0 ? `Nada que aprobar: las ${omitidasQ0} en Q0 no se aprueban (sin tarifa definida).` : 'Nada que aprobar: todas las tarifas ya están aprobadas.' };
  const ahora = new Date().toISOString();
  const { error } = await sb.from('tarifario').update({ aprobado_por: actor, aprobado_en: ahora, updated_at: ahora }).in('id', aprobables.map(t => t.id));
  if (error) return { ok: false, error: error.message };
  return { ok: true, aprobadas: aprobables.length, omitidasQ0, mensaje: `${aprobables.length} tarifa${aprobables.length === 1 ? '' : 's'} aprobada${aprobables.length === 1 ? '' : 's'} por ${actor}${omitidasQ0 ? ` · ${omitidasQ0} en Q0 quedaron fuera (sin tarifa definida)` : ''}.` };
}

export async function getTarifa(id: string): Promise<Tarifa | null> {
  const sb = supabase(); if (!sb) return null;
  const { data } = await sb.from('tarifario').select('*').eq('id', id).maybeSingle();
  return data ? rowToTarifa(data as Row) : null;
}

/** Alias (nombre y razón social de cada cliente activo) para identificar el NIT desde la Agenda. */
export async function aliasClientes(): Promise<AliasCliente[]> {
  const clientes = await getClientes().catch(() => []);
  return clientes.filter(c => c.activo !== false).flatMap(c => [{ nombre: c.name, nit: c.nit }, { nombre: c.short, nit: c.nit }]);
}

export interface TarifaInput {
  nit: string; razonSocial?: string; tipoPrueba: string; categoria: string; territorio: string;
  /** Sin IVA. 0 = sin tarifa definida. */
  monto: number; anio?: string;
  /** El usuario ya vio el aviso de combinación repetida y quiere guardar igual. */
  confirmarDuplicado?: boolean;
}
export type TarifaResult = { ok: true; id: string; mensaje: string } | { ok: false; error: string; duplicado?: { id: string; descripcion: string } };

function validar(input: TarifaInput): { nit: string; razonSocial: string; tipoPrueba: string; categoria: string; territorio: string; monto: number; anio: string } | string {
  const nit = nitComparable(input.nit);
  if (!nit || nitEsPlaceholder(nit)) return 'El NIT es requerido (no vale 0 ni CF: la tarifa es por cliente).';
  if (!nitValido(input.nit) && !/^[0-9]{5,12}[0-9K]$/.test(nit)) return `"${input.nit}" no parece un NIT de Guatemala.`;
  const tipoPrueba = canonTipoPrueba(input.tipoPrueba), categoria = canonCategoria(input.categoria), territorio = canonTerritorio(input.territorio);
  if (!tipoPrueba) return 'El tipo de prueba es requerido.';
  if (tipoPrueba === 'COMPLETO') return 'COMPLETO no se tarifa: cargá POLIGRAFO y SOCIOECONOMICO por separado (el motor los suma).';
  if (!categoria) return 'La categoría es requerida.';
  if (!territorio) return 'El territorio es requerido (METROPOLITANA o DEPARTAMENTAL).';
  const monto = Number(input.monto);
  if (!Number.isFinite(monto) || monto < 0) return 'El monto debe ser un número ≥ 0 (0 = sin tarifa definida).';
  const anio = String(input.anio ?? '').trim();
  if (anio && !/^20\d{2}$/.test(anio)) return 'El año debe ser de 4 dígitos (ej. 2026).';
  return { nit, razonSocial: normalizarTexto(input.razonSocial), tipoPrueba, categoria, territorio, monto: round2(monto), anio };
}

const descTarifa = (t: Tarifa) => `${t.razonSocial || t.nit} · ${t.tipoPrueba} · ${t.categoria} · ${t.territorio} · Q${t.monto.toFixed(2)}`;

export async function crearTarifa(input: TarifaInput, actor: string): Promise<TarifaResult> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'El tarifario requiere el backend Supabase.' };
  const v = validar(input); if (typeof v === 'string') return { ok: false, error: v };
  const todas = await getTarifario();
  const dup = buscarDuplicado(todas, v);
  if (dup && !input.confirmarDuplicado) return { ok: false, error: `Ya existe una tarifa para esta combinación: ${descTarifa(dup)}.`, duplicado: { id: dup.id, descripcion: descTarifa(dup) } };
  const razon = v.razonSocial || todas.find(t => nitComparable(t.nit) === v.nit)?.razonSocial || (await getClientes().catch(() => [])).find(c => nitComparable(c.nit) === v.nit)?.name || '';
  const { data, error } = await sb.from('tarifario').insert({
    nit: v.nit, razon_social: razon || null, tipo_prueba: v.tipoPrueba, categoria: v.categoria, territorio: v.territorio,
    monto: v.monto, anio: v.anio || null, activo: true,
  }).select('id').single();
  if (error) return { ok: false, error: /uq_tarifario_llave/.test(error.message) ? 'Esa combinación exacta ya existe en el tarifario (candado de la base).' : error.message };
  void actor;
  return { ok: true, id: String((data as { id: string }).id), mensaje: `Tarifa creada: ${v.tipoPrueba} · ${v.categoria} · ${v.territorio} · Q${v.monto.toFixed(2)}${v.monto === 0 ? ' (sin tarifa definida)' : ''}` };
}

/** Edita monto/año/razón social (la llave no cambia: para eso se desactiva y se crea otra). Cambiar el monto de una tarifa aprobada la deja pendiente de aprobación. */
export async function editarTarifa(id: string, cambios: { monto?: number; anio?: string; razonSocial?: string }): Promise<TarifaResult> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'El tarifario requiere el backend Supabase.' };
  const t = await getTarifa(id); if (!t) return { ok: false, error: 'Tarifa no encontrada.' };
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (cambios.monto !== undefined) {
    const m = Number(cambios.monto);
    if (!Number.isFinite(m) || m < 0) return { ok: false, error: 'El monto debe ser un número ≥ 0 (0 = sin tarifa definida).' };
    patch.monto = round2(m);
    if (round2(m) !== t.monto && t.aprobadoEn) { patch.aprobado_por = null; patch.aprobado_en = null; }
  }
  if (cambios.anio !== undefined) { const a = cambios.anio.trim(); if (a && !/^20\d{2}$/.test(a)) return { ok: false, error: 'El año debe ser de 4 dígitos.' }; patch.anio = a || null; }
  if (cambios.razonSocial !== undefined) patch.razon_social = normalizarTexto(cambios.razonSocial) || null;
  const { error } = await sb.from('tarifario').update(patch).eq('id', id);
  if (error) return { ok: false, error: error.message };
  const reaprobar = patch.aprobado_en === null;
  return { ok: true, id, mensaje: reaprobar ? 'Tarifa actualizada; cambió el monto, queda pendiente de aprobación.' : 'Tarifa actualizada.' };
}

export async function aprobarTarifa(id: string, actor: string): Promise<TarifaResult> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'El tarifario requiere el backend Supabase.' };
  const t = await getTarifa(id); if (!t) return { ok: false, error: 'Tarifa no encontrada.' };
  if (!t.activo) return { ok: false, error: 'La tarifa está inactiva.' };
  if (t.monto <= 0) return { ok: false, error: 'No se aprueba una tarifa en Q0: primero hay que cargar el monto pactado.' };
  const { error } = await sb.from('tarifario').update({ aprobado_por: actor, aprobado_en: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, id, mensaje: `Tarifa aprobada por ${actor}.` };
}

/** Desactiva (nunca se borra: queda el histórico) o reactiva. Al reactivar se avisa si la llave ya está ocupada. */
export async function activarTarifa(id: string, activo: boolean): Promise<TarifaResult> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'El tarifario requiere el backend Supabase.' };
  const t = await getTarifa(id); if (!t) return { ok: false, error: 'Tarifa no encontrada.' };
  if (activo) { const dup = buscarDuplicado(await getTarifario(), t, id); if (dup) return { ok: false, error: `No se puede reactivar: ya hay una tarifa activa para esa combinación (${descTarifa(dup)}).` }; }
  const { error } = await sb.from('tarifario').update({ activo, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, id, mensaje: activo ? 'Tarifa reactivada.' : 'Tarifa desactivada.' };
}

/** Lookup con IO: carga tarifario + alias de clientes y resuelve el expediente. */
export async function resolverTarifaExpediente(exp: Expediente): Promise<ResultadoLookup> {
  const [tarifas, alias] = await Promise.all([getTarifario(), aliasClientes()]);
  return resolverTarifa(tarifas, exp, alias);
}

/** Para el aviso en el form, antes de guardar. */
export async function verificarDuplicadoTarifa(nueva: { nit: string; tipoPrueba: string; categoria: string; territorio: string }, excluirId?: string): Promise<{ id: string; descripcion: string } | null> {
  const dup = buscarDuplicado(await getTarifario(), nueva, excluirId);
  return dup ? { id: dup.id, descripcion: descTarifa(dup) } : null;
}
