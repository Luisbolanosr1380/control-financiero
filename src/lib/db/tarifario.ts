/**
 * TARIFARIO (migraciones 014 + 015) — lectura y escritura en Supabase.
 * Tabla `tarifario`: una fila por (NIT, tipo de prueba, categoría,
 * territorio) con el monto SIN IVA. Solo Supabase (no existe en Airtable).
 *
 * HISTÓRICO (015): la bitácora `tarifario_historial` la escribe un trigger
 * en la base (única fuente). Para que quede quién y por qué, TODOS los
 * writes van por las RPCs `tarifario_insertar` / `tarifario_actualizar`,
 * que fijan los GUCs `app.actor` / `app.motivo` en la misma transacción.
 * Si la 015 todavía no está aplicada en la base (la RPC no existe), se
 * escribe directo —sin bitácora— para no frenar la operación, y la pantalla
 * avisa que falta la migración.
 */
import { supabase, fetchAll } from '@/lib/supabase/client';
import { nitComparable, nitEsPlaceholder } from '@/lib/clientes/nit';
import { canonCategoria, canonTerritorio, canonTipoPrueba, dimTexto, llaveEfectiva, normalizarTexto, round2, usaCategoria, usaTerritorio } from '@/lib/tarifario/canon';
import { planGenerar, resumenPlan, type PlanGenerar } from '@/lib/tarifario/generar';
import { buscarDuplicado, resolverTarifa, type AliasCliente, type Expediente, type ResultadoLookup, type Tarifa } from '@/lib/tarifario/lookup';
import { resumenPorEmpresa, type EmpresaTarifario } from '@/lib/tarifario/resumen';
import { antiguedades, ultimoCambioPrecio, umbralEstancadaMeses, type AccionHistorial, type AntiguedadPrecio, type HistorialTarifa } from '@/lib/tarifario/antiguedad';
import { getClientes, nitValido } from './clientes';

interface Row {
  id: string; nit: string; razon_social: string | null; tipo_prueba: string; categoria: string; territorio: string;
  monto: number | string; anio: string | null; aprobado_por: string | null; aprobado_en: string | null; activo: boolean; updated_at: string | null;
}
interface HistRow {
  id: string; seq: number | string; tarifario_id: string; nit: string; tipo_prueba: string; categoria: string; territorio: string; accion: AccionHistorial;
  monto_anterior: number | string | null; monto_nuevo: number | string | null; variacion_pct: number | string | null; usuario: string | null; motivo: string | null; anio: string | null; created_at: string;
}

const rowToTarifa = (r: Row): Tarifa => ({
  id: r.id, nit: r.nit, razonSocial: r.razon_social ?? '', tipoPrueba: r.tipo_prueba, categoria: r.categoria, territorio: r.territorio,
  monto: Number(r.monto), anio: r.anio ?? '', aprobadoPor: r.aprobado_por ?? '', aprobadoEn: r.aprobado_en, activo: !!r.activo, updatedAt: r.updated_at ?? null,
});
const num = (v: number | string | null): number | null => (v === null || v === undefined ? null : Number(v));
const rowToHist = (r: HistRow): HistorialTarifa => ({
  id: r.id, seq: Number(r.seq), tarifarioId: r.tarifario_id, nit: r.nit, tipoPrueba: r.tipo_prueba, categoria: r.categoria, territorio: r.territorio, accion: r.accion,
  montoAnterior: num(r.monto_anterior), montoNuevo: num(r.monto_nuevo), variacionPct: num(r.variacion_pct), usuario: r.usuario ?? '', motivo: r.motivo ?? '', anio: r.anio ?? '', createdAt: r.created_at,
});

/** true si la tabla existe en esta base (migración 014 aplicada). */
export async function tarifarioDisponible(): Promise<boolean> {
  const sb = supabase(); if (!sb) return false;
  const { error } = await sb.from('tarifario').select('id').limit(1);   // GET: un HEAD sobre tabla inexistente falla en silencio
  return !error;
}

/** true si la bitácora existe en esta base (migración 015 aplicada). */
export async function historialDisponible(): Promise<boolean> {
  const sb = supabase(); if (!sb) return false;
  const { error } = await sb.from('tarifario_historial').select('id').limit(1);
  return !error;
}

/** Umbral de "tarifa estancada" para esta base (env TARIFARIO_UMBRAL_ESTANCADA_MESES; default 12). */
export const umbralEstancada = (): number => umbralEstancadaMeses(process.env.TARIFARIO_UMBRAL_ESTANCADA_MESES);

export async function getTarifario(): Promise<Tarifa[]> {
  const rows = await fetchAll<Row>('tarifario', { order: { column: 'razon_social', ascending: true } });
  return rows.map(rowToTarifa);
}

/** MAESTRO: una fila por NIT con conteos (activas / pendientes / Q0 / estancadas) y semáforo, ordenadas por acción requerida. */
export async function listarEmpresasTarifario(): Promise<EmpresaTarifario[]> {
  const tarifas = await getTarifario();
  return resumenPorEmpresa(tarifas, await antiguedadesTarifario(tarifas));
}

/** DETALLE: las tarifas de un NIT (activas e inactivas; la pantalla filtra). El NIT se compara normalizado. */
export async function listarTarifasPorNit(nit: string): Promise<Tarifa[]> {
  const k = nitComparable(nit);
  if (!k) return [];
  const rows = await fetchAll<Row>('tarifario', { eq: { nit: k }, order: { column: 'tipo_prueba', ascending: true } });
  return rows.map(rowToTarifa);
}

// ── Histórico (015) ─────────────────────────────────────────────────────────

/** Línea de tiempo de una tarifa, en orden. Vacía si la 015 no está aplicada. */
export async function listarHistorialTarifa(id: string): Promise<HistorialTarifa[]> {
  try { return (await fetchAll<HistRow>('tarifario_historial', { eq: { tarifario_id: id }, order: { column: 'seq', ascending: true } })).map(rowToHist); }
  catch { return []; }
}

/** Toda la bitácora de un cliente (NIT normalizado). */
export async function listarHistorialPorNit(nit: string): Promise<HistorialTarifa[]> {
  const k = nitComparable(nit); if (!k) return [];
  try { return (await fetchAll<HistRow>('tarifario_historial', { eq: { nit: k }, order: { column: 'seq', ascending: true } })).map(rowToHist); }
  catch { return []; }
}

/**
 * id → antigüedad del precio para un lote de tarifas: último cambio_precio de
 * la bitácora, si no el año de la tarifa, si no updated_at. Una sola lectura
 * (solo los renglones cambio_precio) agregada en memoria.
 */
export async function antiguedadesTarifario(tarifas: readonly Tarifa[], hoy: Date = new Date()): Promise<Record<string, AntiguedadPrecio>> {
  let cambios: Pick<HistorialTarifa, 'tarifarioId' | 'accion' | 'createdAt'>[] = [];
  try {
    const rows = await fetchAll<Pick<HistRow, 'tarifario_id' | 'created_at'>>('tarifario_historial', { select: 'id, tarifario_id, created_at', eq: { accion: 'cambio_precio' }, order: { column: 'created_at', ascending: true } });
    cambios = rows.map(r => ({ tarifarioId: r.tarifario_id, accion: 'cambio_precio' as const, createdAt: r.created_at }));
  } catch { /* 015 sin aplicar: cae al año de la tarifa */ }
  return antiguedades(tarifas, ultimoCambioPrecio(cambios), umbralEstancada(), hoy);
}

// ── Escritura (RPC con actor + motivo; fallback directo si falta la 015) ────

type SB = NonNullable<ReturnType<typeof supabase>>;
const rpcNoExiste = (e: { code?: string; message: string }) => e.code === 'PGRST202' || /could not find the function|function .* does not exist/i.test(e.message);

async function insertarFila(sb: SB, fila: Record<string, unknown>, actor: string, motivo?: string): Promise<{ id: string } | { error: string }> {
  const { data, error } = await sb.rpc('tarifario_insertar', { p_actor: actor, p_motivo: motivo ?? '', p_fila: fila });
  if (!error) return { id: String(data) };
  if (!rpcNoExiste(error)) return { error: error.message };
  const r = await sb.from('tarifario').insert(fila).select('id').single();   // 015 sin aplicar: directo, sin bitácora
  return r.error ? { error: r.error.message } : { id: String((r.data as { id: string }).id) };
}

/** Actualiza columnas de una o varias filas. Devuelve el error (texto) o null. */
async function actualizarFilas(sb: SB, ids: string[], patch: Record<string, unknown>, actor: string, motivo?: string): Promise<string | null> {
  const { error } = await sb.rpc('tarifario_actualizar', { p_actor: actor, p_motivo: motivo ?? '', p_ids: ids, p_patch: patch });
  if (!error) return null;
  if (!rpcNoExiste(error)) return error.message;
  const r = await sb.from('tarifario').update({ ...patch, updated_at: new Date().toISOString() }).in('id', ids);
  return r.error ? r.error.message : null;
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
  const error = await actualizarFilas(sb, aprobables.map(t => t.id), { aprobado_por: actor, aprobado_en: new Date().toISOString() }, actor);
  if (error) return { ok: false, error };
  return { ok: true, aprobadas: aprobables.length, omitidasQ0, mensaje: `${aprobables.length} tarifa${aprobables.length === 1 ? '' : 's'} aprobada${aprobables.length === 1 ? '' : 's'} por ${actor}${omitidasQ0 ? ` · ${omitidasQ0} en Q0 quedaron fuera (sin tarifa definida)` : ''}.` };
}

export async function getTarifa(id: string): Promise<Tarifa | null> {
  const sb = supabase(); if (!sb) return null;
  const { data } = await sb.from('tarifario').select('*').eq('id', id).maybeSingle();
  return data ? rowToTarifa(data as Row) : null;
}

/** Alias (nombre, razón social, nombre comercial y marcas —020— de cada cliente activo) para identificar el NIT desde la Agenda. */
export async function aliasClientes(): Promise<AliasCliente[]> {
  const clientes = await getClientes().catch(() => []);
  return clientes.filter(c => c.activo !== false).flatMap(c => [c.name, c.short, c.razonSocial, c.nombreComercial, ...(c.aliases ?? [])].filter((n): n is string => !!n && n.trim() !== '').map(nombre => ({ nombre, nit: c.nit })));
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
  const tipoPrueba = canonTipoPrueba(input.tipoPrueba);
  if (!tipoPrueba) return 'El tipo de prueba es requerido.';
  if (tipoPrueba === 'COMPLETO') return 'COMPLETO no se tarifa: cargá POLIGRAFO y SOCIOECONOMICO por separado (el motor los suma).';
  // FORMAS DE PRECIO: las dimensiones que el tipo no usa se guardan con el centinela UNICA (sin migración).
  const e = llaveEfectiva({ tipoPrueba, categoria: input.categoria, territorio: input.territorio });
  const categoria = e.categoria, territorio = e.territorio;
  if (usaCategoria(e.forma) && !categoria) return 'La categoría es requerida.';
  if (usaTerritorio(e.forma) && !territorio) return 'El territorio es requerido (METROPOLITANA o DEPARTAMENTAL).';
  const monto = Number(input.monto);
  if (!Number.isFinite(monto) || monto < 0) return 'El monto debe ser un número ≥ 0 (0 = sin tarifa definida).';
  const anio = String(input.anio ?? '').trim();
  if (anio && !/^20\d{2}$/.test(anio)) return 'El año debe ser de 4 dígitos (ej. 2026).';
  return { nit, razonSocial: normalizarTexto(input.razonSocial), tipoPrueba, categoria, territorio, monto: round2(monto), anio };
}

const descTarifa = (t: Tarifa) => `${t.razonSocial || t.nit} · ${t.tipoPrueba} · ${dimTexto(t.categoria)} · ${dimTexto(t.territorio)} · Q${t.monto.toFixed(2)}`;

export async function crearTarifa(input: TarifaInput, actor: string): Promise<TarifaResult> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'El tarifario requiere el backend Supabase.' };
  const v = validar(input); if (typeof v === 'string') return { ok: false, error: v };
  const todas = await getTarifario();
  const dup = buscarDuplicado(todas, v);
  if (dup && !input.confirmarDuplicado) return { ok: false, error: `Ya existe una tarifa para esta combinación: ${descTarifa(dup)}.`, duplicado: { id: dup.id, descripcion: descTarifa(dup) } };
  const razon = v.razonSocial || todas.find(t => nitComparable(t.nit) === v.nit)?.razonSocial || (await getClientes().catch(() => [])).find(c => nitComparable(c.nit) === v.nit)?.name || '';
  const r = await insertarFila(sb, {
    nit: v.nit, razon_social: razon || null, tipo_prueba: v.tipoPrueba, categoria: v.categoria, territorio: v.territorio,
    monto: v.monto, anio: v.anio || null, activo: true,
  }, actor);
  if ('error' in r) return { ok: false, error: /uq_tarifario_llave/.test(r.error) ? 'Esa combinación exacta ya existe en el tarifario (candado de la base).' : r.error };
  return { ok: true, id: r.id, mensaje: `Tarifa creada: ${v.tipoPrueba} · ${dimTexto(v.categoria)} · ${dimTexto(v.territorio)} · Q${v.monto.toFixed(2)}${v.monto === 0 ? ' (sin tarifa definida)' : ''}` };
}

// ── Generar tarifas para un cliente ─────────────────────────────────────────

/** Tipos de prueba que la empresa pide en la Agenda (expedientes vigentes del NIT, incluidos los ya facturados). */
async function tiposAgendaDeNit(nit: string): Promise<string[]> {
  const sb = supabase(); if (!sb) return [];
  const { data, error } = await sb.from('facturacion_expediente').select('tipo_cobrado, componentes').eq('fuente', 'agenda').eq('nit_resuelto', nit).eq('terminado', true).eq('cancelado', false).eq('eliminado', false).limit(2000);
  if (error || !data) return [];
  const tipos = new Set<string>();
  for (const r of data as { tipo_cobrado: string | null; componentes: { tipoPrueba?: string }[] | null }[]) {
    const t = canonTipoPrueba(r.tipo_cobrado);
    if (t === 'COMPLETO') { tipos.add('POLIGRAFO'); tipos.add('SOCIOECONOMICO'); } else if (t) tipos.add(t);
    for (const c of r.componentes ?? []) { const ct = canonTipoPrueba(c?.tipoPrueba); if (ct) tipos.add(ct); }
  }
  return [...tipos].sort();
}

export interface PlanGenerarCliente extends PlanGenerar { razonSocial: string; tiposAgenda: string[]; resumen: string; existentes: number }

/** Qué se crearía para un NIT (plantilla + lo que pide en la Agenda + extras), sin escribir nada. */
export async function planGenerarTarifas(nit: string, opts: { tiposExtra?: string[]; incluirAgenda?: boolean } = {}): Promise<PlanGenerarCliente | { error: string }> {
  const k = nitComparable(nit);
  if (!k || nitEsPlaceholder(k)) return { error: 'El NIT es requerido (no vale 0 ni CF).' };
  const [todas, tiposAgenda] = await Promise.all([getTarifario(), opts.incluirAgenda === false ? Promise.resolve([] as string[]) : tiposAgendaDeNit(k)]);
  const delNit = todas.filter(t => nitComparable(t.nit) === k);
  const plan = planGenerar(k, delNit, tiposAgenda, opts.tiposExtra ?? []);
  const razonSocial = delNit.find(t => t.razonSocial)?.razonSocial || (await getClientes().catch(() => [])).find(c => nitComparable(c.nit) === k)?.name || '';
  return { ...plan, razonSocial, tiposAgenda, resumen: resumenPlan(plan), existentes: delNit.length };
}

export type GenerarResult = { ok: true; creadas: number; omitidas: number; resumen: string; nit: string; razonSocial: string } | { ok: false; error: string };

/** Crea en Q0 (por la RPC, con bitácora 'alta') las filas del plan. Idempotente: una segunda corrida crea 0. */
export async function generarTarifasCliente(input: { nit: string; razonSocial?: string; tiposExtra?: string[]; incluirAgenda?: boolean }, actor: string): Promise<GenerarResult> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'El tarifario requiere el backend Supabase.' };
  const plan = await planGenerarTarifas(input.nit, { tiposExtra: input.tiposExtra, incluirAgenda: input.incluirAgenda });
  if ('error' in plan) return { ok: false, error: plan.error };
  const razon = normalizarTexto(input.razonSocial) || plan.razonSocial || '';
  let creadas = 0;
  for (const f of plan.filas) {
    const r = await insertarFila(sb, { nit: plan.nit, razon_social: razon || null, tipo_prueba: f.tipoPrueba, categoria: f.categoria, territorio: f.territorio, monto: 0, anio: String(new Date().getFullYear()), activo: true }, actor, 'generadas en Q0 para completar el tarifario del cliente');
    if ('error' in r) { if (!/uq_tarifario_llave/.test(r.error)) return { ok: false, error: `Se crearon ${creadas} y falló ${f.tipoPrueba} ${f.categoria} ${f.territorio}: ${r.error}` }; continue; }
    creadas++;
  }
  return { ok: true, creadas, omitidas: plan.omitidas.length, resumen: plan.resumen, nit: plan.nit, razonSocial: razon };
}

/**
 * Edita monto/año/razón social (la llave no cambia: para eso se desactiva y se crea otra). Cambiar el monto de una
 * tarifa aprobada la deja pendiente de aprobación. `motivo` (opcional, ej. "ajuste anual") queda en la bitácora.
 */
export async function editarTarifa(id: string, cambios: { monto?: number; anio?: string; razonSocial?: string }, actor: string, motivo?: string): Promise<TarifaResult> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'El tarifario requiere el backend Supabase.' };
  const t = await getTarifa(id); if (!t) return { ok: false, error: 'Tarifa no encontrada.' };
  const patch: Record<string, unknown> = {};
  if (cambios.monto !== undefined) {
    const m = Number(cambios.monto);
    if (!Number.isFinite(m) || m < 0) return { ok: false, error: 'El monto debe ser un número ≥ 0 (0 = sin tarifa definida).' };
    patch.monto = round2(m);
    if (round2(m) !== t.monto && t.aprobadoEn) { patch.aprobado_por = null; patch.aprobado_en = null; }
  }
  if (cambios.anio !== undefined) { const a = cambios.anio.trim(); if (a && !/^20\d{2}$/.test(a)) return { ok: false, error: 'El año debe ser de 4 dígitos.' }; patch.anio = a || null; }
  if (cambios.razonSocial !== undefined) patch.razon_social = normalizarTexto(cambios.razonSocial) || null;
  const error = await actualizarFilas(sb, [id], patch, actor, (motivo ?? '').trim().replace(/\s+/g, ' ').slice(0, 200) || undefined);
  if (error) return { ok: false, error };
  const reaprobar = patch.aprobado_en === null;
  return { ok: true, id, mensaje: reaprobar ? 'Tarifa actualizada; cambió el monto, queda pendiente de aprobación.' : 'Tarifa actualizada.' };
}

export async function aprobarTarifa(id: string, actor: string): Promise<TarifaResult> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'El tarifario requiere el backend Supabase.' };
  const t = await getTarifa(id); if (!t) return { ok: false, error: 'Tarifa no encontrada.' };
  if (!t.activo) return { ok: false, error: 'La tarifa está inactiva.' };
  if (t.monto <= 0) return { ok: false, error: 'No se aprueba una tarifa en Q0: primero hay que cargar el monto pactado.' };
  const error = await actualizarFilas(sb, [id], { aprobado_por: actor, aprobado_en: new Date().toISOString() }, actor);
  if (error) return { ok: false, error };
  return { ok: true, id, mensaje: `Tarifa aprobada por ${actor}.` };
}

/** Desactiva (nunca se borra: queda el histórico) o reactiva. Al reactivar se avisa si la llave ya está ocupada. */
export async function activarTarifa(id: string, activo: boolean, actor: string): Promise<TarifaResult> {
  const sb = supabase(); if (!sb) return { ok: false, error: 'El tarifario requiere el backend Supabase.' };
  const t = await getTarifa(id); if (!t) return { ok: false, error: 'Tarifa no encontrada.' };
  if (activo) { const dup = buscarDuplicado(await getTarifario(), t, id); if (dup) return { ok: false, error: `No se puede reactivar: ya hay una tarifa activa para esa combinación (${descTarifa(dup)}).` }; }
  const error = await actualizarFilas(sb, [id], { activo }, actor);
  if (error) return { ok: false, error };
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
